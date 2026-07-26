import type { Pool, QueryResultRow } from 'pg';
import { z } from 'zod';

import {
  createPromotionProvenanceReport,
  type GoalExperienceEpisode,
  type PlanningReplayMetrics,
  type PromotionProvenanceReport,
} from '../../../domain/src/index.js';
import type {
  PlanningReplayDatasetSource,
  PlanningReplaySourceRecord,
  PromotionCandidateRecord,
  PromotionProvenanceReportRepository,
} from '../../../application/src/index.js';
import { PostgresGoalExperienceEpisodeRepository } from './experience-repository.js';

const evidenceTables = {
  planning_heuristic: 'planning_heuristic_evidence',
  task_type: 'task_type_evidence',
  capability_pattern: 'capability_pattern_evidence',
} as const;

const JsonObjectSchema = z.record(z.string(), z.unknown());
const ReportEnvelopeSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    reportId: z.string(),
    reportRef: z.string(),
    knowledgeKind: z.enum(['planning_heuristic', 'task_type', 'capability_pattern']),
    knowledgeId: z.string(),
    knowledgeRevision: z.number().int().positive(),
    dataset: z.unknown(),
    mutateDevCaseIds: z.array(z.string()),
    promotionTestCaseIds: z.array(z.string()),
    shadow: z.unknown(),
    replayPassedCount: z.number().int().nonnegative(),
    replayFailedCount: z.number().int().nonnegative(),
    status: z.enum(['incubating', 'passed', 'failed']),
    gates: z.array(z.unknown()),
    generatedAt: z.string(),
    reportHash: z.string(),
  })
  .loose();

export class PostgresPlanningReplayDatasetSource implements PlanningReplayDatasetSource {
  readonly #pool: Pool;
  readonly #episodes: PostgresGoalExperienceEpisodeRepository;

  constructor(pool: Pool) {
    this.#pool = pool;
    this.#episodes = new PostgresGoalExperienceEpisodeRepository(pool);
  }

  async load(candidate: PromotionCandidateRecord): Promise<readonly PlanningReplaySourceRecord[]> {
    const table = evidenceTables[candidate.kind];
    const evidence = await this.#pool.query<{ source_ref: unknown } & QueryResultRow>(
      `SELECT source_ref FROM ${table}
       WHERE knowledge_id=$1 AND knowledge_revision=$2 ORDER BY evidence_id`,
      [candidate.knowledgeId, candidate.revision],
    );
    const episodeIds = new Set<string>();
    for (const row of evidence.rows) {
      const source = JsonObjectSchema.parse(row.source_ref);
      for (const episodeId of extractEpisodeIds(source)) episodeIds.add(episodeId);
    }
    const catalogHash = await this.resolveCatalogHash(candidate);
    if (catalogHash === undefined) throw new Error('PLANNING_REPLAY_CATALOG_HASH_UNAVAILABLE');
    const episodes = await Promise.all(
      [...episodeIds].sort().map((episodeId) => this.#episodes.findById(episodeId)),
    );
    return Object.freeze(
      episodes.flatMap((episode) =>
        episode === undefined ? [] : toSourceRecord(episode, catalogHash),
      ),
    );
  }

  async resolveCatalogHash(candidate: PromotionCandidateRecord): Promise<string | undefined> {
    if (candidate.catalogHash !== undefined) return candidate.catalogHash;
    const catalog = await this.#pool.query<{ catalog_hash: string } & QueryResultRow>(
      `SELECT catalog_hash FROM runtime_capability_summary
       WHERE status='active' ORDER BY revision DESC LIMIT 1`,
    );
    return catalog.rows[0]?.catalog_hash;
  }
}

export class PostgresPromotionProvenanceReportRepository implements PromotionProvenanceReportRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async find(candidate: PromotionCandidateRecord): Promise<PromotionProvenanceReport | undefined> {
    const result = await this.#pool.query<{ report: unknown } & QueryResultRow>(
      `SELECT report FROM promotion_provenance_report
       WHERE knowledge_kind=$1 AND knowledge_id=$2 AND knowledge_revision=$3`,
      [candidate.kind, candidate.knowledgeId, candidate.revision],
    );
    return result.rows[0] === undefined ? undefined : parseReport(result.rows[0].report);
  }

  async save(report: PromotionProvenanceReport): Promise<PromotionProvenanceReport> {
    const candidate = createPromotionProvenanceReport(report);
    const result = await this.#pool.query<{ report: unknown } & QueryResultRow>(
      `INSERT INTO promotion_provenance_report(
         report_id,knowledge_kind,knowledge_id,knowledge_revision,dataset_hash,
         report_hash,status,report,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       ON CONFLICT(knowledge_kind,knowledge_id,knowledge_revision)
       DO UPDATE SET report_id=promotion_provenance_report.report_id
       RETURNING report`,
      [
        candidate.reportId,
        candidate.knowledgeKind,
        candidate.knowledgeId,
        candidate.knowledgeRevision,
        candidate.dataset.datasetHash,
        candidate.reportHash,
        candidate.status,
        JSON.stringify(candidate),
        candidate.generatedAt,
      ],
    );
    return parseReport(result.rows[0]?.report);
  }
}

function toSourceRecord(
  episode: GoalExperienceEpisode,
  catalogHash: string,
): readonly PlanningReplaySourceRecord[] {
  const snapshot = episode.snapshot;
  const contractEnvelope = object(snapshot['contract']);
  const planEnvelope = object(snapshot['currentPlan']);
  const acceptedContract = object(contractEnvelope?.['contract']);
  const acceptedPlan = object(planEnvelope?.['plan']);
  const judgment = object(snapshot['userGoalJudgment']);
  const terminal = object(snapshot['terminalOutcome']);
  const request =
    findString(snapshot['interactions'], ['originalRequest', 'requestText']) ??
    findString(acceptedContract, ['objective', 'title', 'summary']);
  if (
    request === undefined ||
    acceptedContract === undefined ||
    acceptedPlan === undefined ||
    judgment === undefined ||
    terminal === undefined
  ) {
    return [];
  }
  const attempts = array(snapshot['attempts']);
  const recovery = array(snapshot['recovery']);
  const interactions = array(snapshot['interactions']);
  const corrections = interactions.flatMap((item) => {
    const interaction = object(item);
    const interactionSnapshot = object(interaction?.['snapshot']);
    return array(interactionSnapshot?.['corrections']).flatMap((correction) => {
      const parsed = object(correction);
      return parsed === undefined ? [] : [parsed];
    });
  });
  const achieved = judgment['status'] === 'achieved';
  const startedAt = findString(snapshot['task'], ['createdAt', 'created_at']);
  const completedAt = findString(terminal, ['committedAt', 'committed_at']);
  const latencyMs =
    startedAt === undefined || completedAt === undefined
      ? 0
      : Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
  const baselineMetrics: PlanningReplayMetrics = {
    missingDimensionCount: countUnresolvedCritical(snapshot),
    coverage: achieved ? 1 : 0,
    patchCount: corrections.length,
    attemptCount: attempts.length,
    recoveryCount: recovery.length,
    riskScore: terminal['kind'] === 'failed' ? 1 : 0,
    tokenCount: 0,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : 0,
    hardFailureCount: achieved ? 0 : 1,
    dimensionScores: {
      understanding: request.length > 0 ? 1 : 0,
      contract: 1,
      plan: 1,
      injection: 1,
      task_type_recognition: countUnresolvedCritical(snapshot) === 0 ? 1 : 0,
      capability_gap: terminal['kind'] === 'capability_gap' ? 0 : 1,
    },
  };
  return [
    Object.freeze({
      episodeId: episode.episodeId,
      request,
      worldSummary: Object.freeze({
        ...(object(snapshot['task']) === undefined ? {} : { task: object(snapshot['task']) }),
        eventImpacts: array(snapshot['eventImpacts']),
      }),
      acceptedContract,
      acceptedPlan,
      corrections: Object.freeze(corrections),
      outcome: Object.freeze({ judgment, terminal }),
      catalogHash,
      sourceHash: episode.sourceHash,
      createdAt: episode.createdAt,
      baselineMetrics,
    }),
  ];
}

function extractEpisodeIds(source: Readonly<Record<string, unknown>>): readonly string[] {
  const result = new Set<string>();
  if (typeof source['episodeId'] === 'string') result.add(source['episodeId']);
  for (const episodeId of array(source['sourceEpisodeIds'])) {
    if (typeof episodeId === 'string') result.add(episodeId);
  }
  for (const item of array(source['sourceRefs'])) {
    const ref = object(item);
    if (ref?.['sourceKind'] === 'goal_experience_episode' && typeof ref['sourceId'] === 'string') {
      result.add(ref['sourceId']);
    }
  }
  return [...result];
}

function countUnresolvedCritical(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + countUnresolvedCritical(item), 0);
  }
  const item = object(value);
  if (item === undefined) return 0;
  const current = item['severity'] === 'critical' && item['resolved'] !== true ? 1 : 0;
  return (
    current +
    Object.values(item).reduce<number>((sum, nested) => sum + countUnresolvedCritical(nested), 0)
  );
}

function findString(value: unknown, keys: readonly string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const item = object(value);
  if (item === undefined) return undefined;
  for (const key of keys) {
    const candidate = item[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  }
  for (const nested of Object.values(item)) {
    const found = findString(nested, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function object(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const parsed = JsonObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseReport(value: unknown): PromotionProvenanceReport {
  return createPromotionProvenanceReport(
    ReportEnvelopeSchema.parse(value) as unknown as PromotionProvenanceReport,
  );
}
