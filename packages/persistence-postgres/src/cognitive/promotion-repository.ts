import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type {
  KnowledgePromotionRepository,
  PromotionCandidateRecord,
  PromotionRevalidationCandidate,
  PromotionReplayEvaluationRunner,
} from '../../../application/src/cognitive/index.js';
import {
  createKnowledgePromotionEvaluation,
  createKnowledgeStatusTransition,
  createPromotionEvidenceSummary,
  type KnowledgeKind,
  type KnowledgePromotionEvaluation,
  type KnowledgeStatus,
  type KnowledgeStatusTransition,
  type PromotionEvidenceSummary,
  type PromotionReplayReport,
} from '../../../domain/src/index.js';

const JsonObjectSchema = z.record(z.string(), z.unknown());
const JsonArraySchema = z.array(z.unknown());
const StringArraySchema = z.array(z.string());

interface DefinitionRow extends QueryResultRow {
  knowledge_id: string;
  revision: number;
  status: KnowledgeStatus;
  scope: PromotionCandidateRecord['scope'];
  tenant_id: string | null;
  user_id: string | null;
  risk: PromotionCandidateRecord['risk'];
  definition: unknown;
  version: number;
  created_at: Date | string;
  fingerprint: string | null;
  catalog_hash: string | null;
}

interface EvidenceRow extends QueryResultRow {
  evidence_id: string;
  polarity: 'support' | 'contradiction';
  source_ref: unknown;
}

interface EpisodeRow extends QueryResultRow {
  episode_id: string;
  goal_id: string;
  user_scope_id: string | null;
  status: 'partial' | 'complete';
  snapshot: unknown;
}

const tables: Readonly<
  Record<
    KnowledgeKind,
    Readonly<{
      definition: string;
      evidence: string;
      fingerprintExpression: string;
      embeddedStatus: boolean;
      embeddedVersion: boolean;
    }>
  >
> = Object.freeze({
  planning_heuristic: {
    definition: 'planning_heuristic',
    evidence: 'planning_heuristic_evidence',
    fingerprintExpression: "definition->>'fingerprint'",
    embeddedStatus: false,
    embeddedVersion: false,
  },
  task_type: {
    definition: 'task_type_definition',
    evidence: 'task_type_evidence',
    fingerprintExpression: 'fingerprint',
    embeddedStatus: true,
    embeddedVersion: false,
  },
  capability_pattern: {
    definition: 'capability_pattern_definition',
    evidence: 'capability_pattern_evidence',
    fingerprintExpression: 'fingerprint',
    embeddedStatus: true,
    embeddedVersion: true,
  },
});

export class PostgresKnowledgePromotionRepository implements KnowledgePromotionRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async find(kind: KnowledgeKind, knowledgeId: string) {
    const row = await this.#findRow(this.#pool, kind, knowledgeId);
    if (row === undefined) return undefined;
    return {
      record: mapRecord(kind, row),
      evidence: await aggregateEvidence(this.#pool, kind, row),
    };
  }

  async findActive(
    kind: KnowledgeKind,
    knowledgeId: string,
  ): Promise<PromotionCandidateRecord | undefined> {
    const table = tables[kind];
    const result = await this.#pool.query<DefinitionRow>(
      `${selectDefinition(table)}
       WHERE knowledge_id=$1 AND status='active' ORDER BY revision DESC LIMIT 1`,
      [knowledgeId],
    );
    return result.rows[0] === undefined ? undefined : mapRecord(kind, result.rows[0]);
  }

  async findDuplicate(
    record: PromotionCandidateRecord,
  ): Promise<PromotionCandidateRecord | undefined> {
    if (record.fingerprint === undefined) return undefined;
    const table = tables[record.kind];
    const result = await this.#pool.query<DefinitionRow>(
      `${selectDefinition(table)}
       WHERE status IN ('active','validating')
         AND knowledge_id<>$1 AND ${table.fingerprintExpression}=$2
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,revision DESC
       LIMIT 1`,
      [record.knowledgeId, record.fingerprint],
    );
    return result.rows[0] === undefined ? undefined : mapRecord(record.kind, result.rows[0]);
  }

  async complete(input: Parameters<KnowledgePromotionRepository['complete']>[0]) {
    const evaluation = createKnowledgePromotionEvaluation(input.evaluation);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await lockKnowledge(client, evaluation.knowledgeKind, evaluation.knowledgeId);
      const row = await this.#findRow(
        client,
        evaluation.knowledgeKind,
        evaluation.knowledgeId,
        true,
      );
      if (row === undefined) throw new Error('KNOWLEDGE_PROMOTION_VERSION_CONFLICT');
      if (
        row.revision !== evaluation.knowledgeRevision ||
        row.version !== input.expectedVersion ||
        row.status !== 'candidate'
      ) {
        throw new Error('KNOWLEDGE_PROMOTION_VERSION_CONFLICT');
      }
      await insertEvaluation(client, evaluation);
      let current = row;
      for (const transition of input.transitions) {
        if (transition.toStatus === 'active') {
          await deprecatePriorActive(
            client,
            evaluation.knowledgeKind,
            current,
            evaluation.decidedBy ?? transition.actorId,
            transition.occurredAt,
          );
        }
        current = await applyTransition(client, evaluation.knowledgeKind, current, transition);
      }
      if (current.status !== input.finalStatus) {
        throw new Error('KNOWLEDGE_PROMOTION_FINAL_STATUS_MISMATCH');
      }
      await client.query('COMMIT');
      return mapRecord(evaluation.knowledgeKind, current);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async transition(input: Parameters<KnowledgePromotionRepository['transition']>[0]) {
    const transition = createKnowledgeStatusTransition(input.transition);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await lockKnowledge(client, input.kind, input.knowledgeId);
      const row = await this.#findRow(
        client,
        input.kind,
        input.knowledgeId,
        true,
        input.knowledgeRevision,
      );
      if (row === undefined) throw new Error('KNOWLEDGE_PROMOTION_VERSION_CONFLICT');
      if (row.revision !== input.knowledgeRevision || row.version !== input.expectedVersion) {
        throw new Error('KNOWLEDGE_PROMOTION_VERSION_CONFLICT');
      }
      if (input.evaluation !== undefined) {
        await insertEvaluation(client, createKnowledgePromotionEvaluation(input.evaluation));
      }
      const updated = await applyTransition(client, input.kind, row, transition);
      if (updated.status !== input.toStatus) {
        throw new Error('KNOWLEDGE_PROMOTION_FINAL_STATUS_MISMATCH');
      }
      await client.query('COMMIT');
      return mapRecord(input.kind, updated);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listActive(): Promise<readonly PromotionCandidateRecord[]> {
    const records: PromotionCandidateRecord[] = [];
    for (const kind of Object.keys(tables) as KnowledgeKind[]) {
      const table = tables[kind];
      const result = await this.#pool.query<DefinitionRow>(
        `${selectDefinition(table)} WHERE status='active' ORDER BY knowledge_id,revision DESC`,
      );
      records.push(...result.rows.map((row) => mapRecord(kind, row)));
    }
    return Object.freeze(records);
  }

  async listRevalidationCandidates(
    policyVersion: string,
  ): Promise<readonly PromotionRevalidationCandidate[]> {
    const candidates: PromotionRevalidationCandidate[] = [];
    for (const kind of Object.keys(tables) as KnowledgeKind[]) {
      const table = tables[kind];
      const result = await this.#pool.query<
        DefinitionRow & {
          contradiction_detected: boolean;
          policy_changed: boolean;
          promotion_evidence_summary: unknown;
        }
      >(
        `${selectDefinition(
          table,
          ',invalidation.contradiction_detected,invalidation.policy_changed,invalidation.promotion_evidence_summary',
        )}
         CROSS JOIN LATERAL (
           SELECT
             EXISTS (
               SELECT 1
               FROM ${table.evidence} newer
               WHERE newer.knowledge_id=${table.definition}.knowledge_id
                 AND newer.polarity='contradiction'
                 AND (
                   (
                     newer.knowledge_revision=${table.definition}.revision
                     AND newer.created_at>(
                       SELECT COALESCE(e.decided_at,e.created_at)
                       FROM knowledge_promotion_evaluation e
                       WHERE e.knowledge_kind=$1
                         AND e.knowledge_id=${table.definition}.knowledge_id
                         AND e.knowledge_revision=${table.definition}.revision
                         AND e.status='passed'
                       ORDER BY COALESCE(e.decided_at,e.created_at) DESC
                       LIMIT 1
                     )
                   )
                   OR (
                     newer.knowledge_revision>${table.definition}.revision
                     AND NOT EXISTS (
                       SELECT 1 FROM ${table.evidence} prior
                       WHERE prior.knowledge_id=newer.knowledge_id
                         AND prior.knowledge_revision=${table.definition}.revision
                         AND prior.evidence_id=newer.evidence_id
                     )
                   )
                 )
             ) AS contradiction_detected,
             EXISTS (
               SELECT 1 FROM knowledge_promotion_evaluation e
               WHERE e.knowledge_kind=$1
                 AND e.knowledge_id=${table.definition}.knowledge_id
                 AND e.knowledge_revision=${table.definition}.revision
                 AND e.status='passed'
                 AND e.policy_version<>$2
             ) AS policy_changed,
             (
               SELECT e.evidence_summary
               FROM knowledge_promotion_evaluation e
               WHERE e.knowledge_kind=$1
                 AND e.knowledge_id=${table.definition}.knowledge_id
                 AND e.knowledge_revision=${table.definition}.revision
                 AND e.status='passed'
               ORDER BY COALESCE(e.decided_at,e.created_at) DESC
               LIMIT 1
             ) AS promotion_evidence_summary
         ) invalidation
         WHERE ${table.definition}.status='active'
         ORDER BY ${table.definition}.knowledge_id,${table.definition}.revision`,
        [kind, policyVersion],
      );
      for (const row of result.rows) {
        let reason: PromotionRevalidationCandidate['reason'] | undefined;
        if (row.contradiction_detected) reason = 'contradiction_detected';
        else if (row.policy_changed) reason = 'policy_changed';
        else {
          const promoted = promotionEvidence(row.promotion_evidence_summary);
          if (promoted !== undefined) {
            const current = await aggregateEvidence(this.#pool, kind, row);
            if (rejectionRatio(current) > rejectionRatio(promoted)) {
              reason = 'contradiction_detected';
            }
          }
        }
        if (reason !== undefined) {
          candidates.push(Object.freeze({ record: mapRecord(kind, row), reason }));
        }
      }
    }
    return Object.freeze(candidates);
  }

  #findRow(
    executor: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    kind: KnowledgeKind,
    knowledgeId: string,
    forUpdate = false,
    knowledgeRevision?: number,
  ): Promise<DefinitionRow | undefined> {
    const table = tables[kind];
    return executor
      .query<DefinitionRow>(
        `${selectDefinition(table)}
         WHERE knowledge_id=$1${knowledgeRevision === undefined ? '' : ' AND revision=$2'}
         ORDER BY revision DESC LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
        knowledgeRevision === undefined ? [knowledgeId] : [knowledgeId, knowledgeRevision],
      )
      .then((result) => result.rows[0]);
  }
}

export class PostgresPromotionReplayEvaluationRunner implements PromotionReplayEvaluationRunner {
  readonly #repository: Pick<KnowledgePromotionRepository, 'find'>;

  constructor(repository: Pick<KnowledgePromotionRepository, 'find'>) {
    this.#repository = repository;
  }

  async run(candidate: PromotionCandidateRecord): Promise<PromotionReplayReport> {
    const loaded = await this.#repository.find(candidate.kind, candidate.knowledgeId);
    if (loaded?.record.revision !== candidate.revision) {
      throw new Error('KNOWLEDGE_PROMOTION_REPLAY_SOURCE_MISSING');
    }
    return Object.freeze({
      reportRef: `promotion-replay:${candidate.kind}:${candidate.knowledgeId}:${String(candidate.revision)}`,
      passedCount: loaded.evidence.successfulOutcomeCount,
      failedCount: loaded.evidence.failedOutcomeCount,
    });
  }
}

function selectDefinition(table: (typeof tables)[KnowledgeKind], additionalColumns = ''): string {
  const fingerprint =
    table.fingerprintExpression === "definition->>'fingerprint'"
      ? `${table.fingerprintExpression} AS fingerprint`
      : 'fingerprint';
  const catalogHash =
    table.definition === 'capability_pattern_definition' ? 'catalog_hash' : 'NULL AS catalog_hash';
  return `SELECT knowledge_id,revision,status,scope,tenant_id,user_id,risk,definition,
    version,created_at,${fingerprint},${catalogHash}${additionalColumns} FROM ${table.definition}`;
}

function mapRecord(kind: KnowledgeKind, row: DefinitionRow): PromotionCandidateRecord {
  const definition = JsonObjectSchema.parse(row.definition);
  const title = stringField(definition, 'title');
  const summary = stringField(definition, 'summary');
  const definitionStatus = definition['status'];
  const definitionVersion = definition['version'];
  const table = tables[kind];
  if (
    (table.embeddedStatus && definitionStatus !== row.status) ||
    (table.embeddedVersion && definitionVersion !== row.version)
  ) {
    throw new Error('KNOWLEDGE_PROMOTION_PERSISTENCE_INTEGRITY_VIOLATION');
  }
  return Object.freeze({
    schemaVersion: '1.0',
    knowledgeId: row.knowledge_id,
    revision: row.revision,
    version: row.version,
    status: row.status,
    kind,
    scope: row.scope,
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.user_id === null ? {} : { userId: row.user_id }),
    risk: row.risk,
    title,
    summary,
    definition: Object.freeze(definition),
    supportSourceRefs: [],
    contradictionSourceRefs: [],
    ...(row.fingerprint === null ? {} : { fingerprint: row.fingerprint }),
    ...(row.catalog_hash === null ? {} : { catalogHash: row.catalog_hash }),
    createdAt: timestamp(row.created_at),
  });
}

async function aggregateEvidence(
  pool: Pool,
  kind: KnowledgeKind,
  row: DefinitionRow,
): Promise<PromotionEvidenceSummary> {
  const table = tables[kind];
  const evidence = await pool.query<EvidenceRow>(
    `SELECT evidence_id,polarity,source_ref FROM ${table.evidence}
     WHERE knowledge_id=$1 AND knowledge_revision=$2 ORDER BY evidence_id`,
    [row.knowledge_id, row.revision],
  );
  const episodeIds = new Set<string>();
  const supportingRefs: string[] = [];
  const contradictingRefs: string[] = [];
  for (const item of evidence.rows) {
    (item.polarity === 'support' ? supportingRefs : contradictingRefs).push(item.evidence_id);
    const source = JsonObjectSchema.parse(item.source_ref);
    for (const episodeId of extractEpisodeIds(source)) episodeIds.add(episodeId);
  }
  const episodes =
    episodeIds.size === 0
      ? { rows: [] as EpisodeRow[] }
      : await pool.query<EpisodeRow>(
          `SELECT episode_id,goal_id,user_scope_id,status,snapshot
           FROM goal_experience_episode WHERE episode_id=ANY($1::text[])`,
          [[...episodeIds]],
        );
  if (episodes.rows.length !== episodeIds.size) {
    throw new Error('KNOWLEDGE_PROMOTION_EPISODE_LINEAGE_MISSING');
  }
  let successfulOutcomeCount = 0;
  let failedOutcomeCount = 0;
  const goalIds = new Set<string>();
  const userIds = new Set<string>();
  for (const episode of episodes.rows) {
    goalIds.add(episode.goal_id);
    if (episode.user_scope_id !== null) userIds.add(episode.user_scope_id);
    const status = judgmentStatus(episode.snapshot);
    if (status === 'achieved') successfulOutcomeCount += 1;
    else if (status !== undefined) failedOutcomeCount += 1;
  }
  const planning =
    goalIds.size === 0
      ? { rows: [] as { action: 'accept' | 'reject'; count: number }[] }
      : await pool.query<{ action: 'accept' | 'reject'; count: number } & QueryResultRow>(
          `SELECT t.action,count(*)::integer AS count
           FROM interactive_planning_turn t
           JOIN interactive_planning_session s ON s.session_id=t.session_id
           WHERE s.goal_id=ANY($1::text[]) AND t.action IN ('accept','reject')
           GROUP BY t.action`,
          [[...goalIds]],
        );
  return createPromotionEvidenceSummary({
    uniqueGoalCount: goalIds.size,
    uniqueUserCount: userIds.size,
    successfulOutcomeCount,
    failedOutcomeCount,
    userAcceptedPlanningCount: planning.rows.find((item) => item.action === 'accept')?.count ?? 0,
    userRejectedPlanningCount: planning.rows.find((item) => item.action === 'reject')?.count ?? 0,
    replayPassedCount: 0,
    replayFailedCount: 0,
    shadowImprovedCount: 0,
    shadowRegressedCount: 0,
    supportingRefs,
    contradictingRefs,
  });
}

async function lockKnowledge(
  client: PoolClient,
  kind: KnowledgeKind,
  knowledgeId: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `knowledge-promotion:${kind}:${knowledgeId}`,
  ]);
}

async function insertEvaluation(
  client: PoolClient,
  evaluation: KnowledgePromotionEvaluation,
): Promise<void> {
  const prior = await client.query(
    `SELECT 1 FROM knowledge_promotion_evaluation
     WHERE knowledge_kind=$1 AND knowledge_id=$2 AND knowledge_revision=$3
       AND status IN ('passed','failed','rejected')`,
    [evaluation.knowledgeKind, evaluation.knowledgeId, evaluation.knowledgeRevision],
  );
  if (prior.rowCount !== 0) throw new Error('KNOWLEDGE_PROMOTION_EVALUATION_CONFLICT');
  await client.query(
    `INSERT INTO knowledge_promotion_evaluation(
       evaluation_id,knowledge_kind,knowledge_id,knowledge_revision,policy_version,status,
       evidence_summary,replay_report_ref,shadow_report_ref,human_approved,decided_by,
       created_at,decided_at)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)`,
    [
      evaluation.evaluationId,
      evaluation.knowledgeKind,
      evaluation.knowledgeId,
      evaluation.knowledgeRevision,
      evaluation.policyVersion,
      evaluation.status,
      JSON.stringify({
        evidence: evaluation.evidence,
        gates: evaluation.gates,
        policyAllowed: evaluation.policyAllowed,
        decisionSummary: evaluation.decisionSummary,
        ...(evaluation.duplicateKnowledgeId === undefined
          ? {}
          : { duplicateKnowledgeId: evaluation.duplicateKnowledgeId }),
      }),
      evaluation.replayReportRef ?? null,
      evaluation.shadowReportRef ?? null,
      evaluation.humanApproved,
      evaluation.decidedBy ?? null,
      evaluation.createdAt,
      evaluation.decidedAt ?? null,
    ],
  );
}

async function applyTransition(
  client: PoolClient,
  kind: KnowledgeKind,
  current: DefinitionRow,
  input: KnowledgeStatusTransition,
): Promise<DefinitionRow> {
  const transition = createKnowledgeStatusTransition(input);
  if (
    transition.knowledgeId !== current.knowledge_id ||
    transition.knowledgeRevision !== current.revision ||
    transition.expectedVersion !== current.version ||
    transition.fromStatus !== current.status
  ) {
    throw new Error('KNOWLEDGE_PROMOTION_VERSION_CONFLICT');
  }
  const table = tables[kind];
  const nextVersion = current.version + 1;
  let definitionExpression = 'definition';
  if (table.embeddedStatus) {
    definitionExpression = "jsonb_set(definition,'{status}',to_jsonb($4::text),false)";
  }
  if (table.embeddedVersion) {
    definitionExpression = `jsonb_set(${definitionExpression},'{version}',to_jsonb($5::integer),false)`;
  }
  const result = await client.query<DefinitionRow>(
    `UPDATE ${table.definition}
     SET status=$4,version=$5,definition=${definitionExpression}
     WHERE knowledge_id=$1 AND revision=$2 AND version=$3 AND status=$6
     RETURNING knowledge_id,revision,status,scope,tenant_id,user_id,risk,definition,
       version,created_at,${table.fingerprintExpression === "definition->>'fingerprint'" ? `${table.fingerprintExpression} AS fingerprint` : 'fingerprint'},
       ${kind === 'capability_pattern' ? 'catalog_hash' : 'NULL AS catalog_hash'}`,
    [
      current.knowledge_id,
      current.revision,
      current.version,
      transition.toStatus,
      nextVersion,
      transition.fromStatus,
    ],
  );
  const updated = result.rows[0];
  if (updated === undefined) throw new Error('KNOWLEDGE_PROMOTION_VERSION_CONFLICT');
  await client.query(
    `INSERT INTO knowledge_status_transition(
       transition_id,knowledge_kind,knowledge_id,knowledge_revision,expected_version,
       from_status,to_status,reason,actor_id,human_approved,occurred_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      transition.transitionId,
      kind,
      transition.knowledgeId,
      transition.knowledgeRevision,
      transition.expectedVersion,
      transition.fromStatus,
      transition.toStatus,
      transition.reason,
      transition.actorId,
      transition.humanApproved,
      transition.occurredAt,
    ],
  );
  const eventType =
    transition.toStatus === 'validating'
      ? 'knowledge.validating'
      : transition.toStatus === 'active'
        ? 'knowledge.promoted'
        : transition.toStatus === 'rejected'
          ? 'knowledge.rejected'
          : transition.toStatus === 'deprecated'
            ? 'knowledge.deprecated'
            : 'knowledge.validation_failed';
  await client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       correlation,payload,occurred_at,published_at)
     VALUES($1,$2,$3,$4,$5,jsonb_build_object('correlationId',$4::text),
       jsonb_build_object(
         'knowledgeKind',$3::text,'knowledgeId',$4::text,'revision',$6::integer,
         'fromStatus',$7::text,'toStatus',$8::text,'reason',$9::text
       ),$10,NULL)`,
    [
      stableId('outbox-knowledge-transition', transition.transitionId),
      eventType,
      kind,
      transition.knowledgeId,
      nextVersion,
      transition.knowledgeRevision,
      transition.fromStatus,
      transition.toStatus,
      transition.reason,
      transition.occurredAt,
    ],
  );
  return updated;
}

async function deprecatePriorActive(
  client: PoolClient,
  kind: KnowledgeKind,
  current: DefinitionRow,
  actorId: string,
  occurredAt: string,
): Promise<void> {
  const table = tables[kind];
  const prior = await client.query<DefinitionRow>(
    `${selectDefinition(table)}
     WHERE knowledge_id=$1 AND revision<>$2 AND status='active'
     ORDER BY revision DESC FOR UPDATE`,
    [current.knowledge_id, current.revision],
  );
  for (const row of prior.rows) {
    const transition = createKnowledgeStatusTransition({
      schemaVersion: '1.0',
      transitionId: stableId(
        'knowledge-revision-superseded',
        `${kind}:${row.knowledge_id}:${String(row.revision)}:${String(row.version)}`,
      ),
      knowledgeId: row.knowledge_id,
      knowledgeRevision: row.revision,
      expectedVersion: row.version,
      fromStatus: 'active',
      toStatus: 'deprecated',
      reason: 'revision_superseded',
      actorId,
      humanApproved: true,
      occurredAt,
    });
    await applyTransition(client, kind, row, transition);
  }
}

function extractEpisodeIds(source: Readonly<Record<string, unknown>>): readonly string[] {
  const result = new Set<string>();
  if (typeof source['episodeId'] === 'string') result.add(source['episodeId']);
  for (const value of StringArraySchema.safeParse(source['sourceEpisodeIds']).data ?? []) {
    result.add(value);
  }
  for (const ref of JsonArraySchema.safeParse(source['sourceRefs']).data ?? []) {
    const parsed = JsonObjectSchema.safeParse(ref);
    if (
      parsed.success &&
      parsed.data['sourceKind'] === 'goal_experience_episode' &&
      typeof parsed.data['sourceId'] === 'string'
    ) {
      result.add(parsed.data['sourceId']);
    }
  }
  return [...result];
}

function judgmentStatus(value: unknown): string | undefined {
  const snapshot = JsonObjectSchema.safeParse(value);
  if (!snapshot.success) return undefined;
  const judgment = JsonObjectSchema.safeParse(snapshot.data['userGoalJudgment']);
  return judgment.success && typeof judgment.data['status'] === 'string'
    ? judgment.data['status']
    : undefined;
}

function promotionEvidence(value: unknown): PromotionEvidenceSummary | undefined {
  const summary = JsonObjectSchema.safeParse(value);
  if (!summary.success) return undefined;
  const evidence = JsonObjectSchema.safeParse(summary.data['evidence']);
  if (!evidence.success) return undefined;
  try {
    return createPromotionEvidenceSummary(evidence.data as unknown as PromotionEvidenceSummary);
  } catch {
    return undefined;
  }
}

function rejectionRatio(evidence: PromotionEvidenceSummary): number {
  const decisions = evidence.userAcceptedPlanningCount + evidence.userRejectedPlanningCount;
  return decisions === 0 ? 0 : evidence.userRejectedPlanningCount / decisions;
}

function stringField(input: Readonly<Record<string, unknown>>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('KNOWLEDGE_PROMOTION_DEFINITION_INVALID');
  }
  return value;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
