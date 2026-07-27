import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { brotliCompress, brotliDecompressSync, constants as zlibConstants } from 'node:zlib';

import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import {
  EXPERIENCE_COMPILATION_CONTRACT_VERSION,
  createCohortDefinition,
  createExperienceTrace,
  createWorkflowPattern,
  type CohortDefinition,
  type ExperienceTrace,
  type ExperienceTraceBody,
  type ExperienceTraceEvent,
  type WorkflowPattern,
} from '../../../domain/src/index.js';
import type { JsonObject, JsonValue } from '../../../domain/src/compiler/contracts.js';
import type {
  CompilationRun,
  CompilationRunRepository,
  CompilationRunType,
  ExperienceCompilationRepository,
  ExperienceCompilationTrigger,
  ExperienceCompilationTriggerSource,
  ProcessMiningResult,
} from '../../../application/src/compiler/experience-compilation.js';
import type { ExperienceTraceNormalizationReport } from '../../../application/src/compiler/experience-normalizer.js';
import { PostgresGoalExperienceEpisodeRepository } from '../cognitive/experience-repository.js';

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    JsonObjectSchema,
  ]),
);
const brotliCompressAsync = promisify(brotliCompress);
const JsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), JsonValueSchema);
const TraceEventSchema = z
  .object({
    eventId: z.string(),
    sequence: z.number().int().nonnegative(),
    occurredAt: z.string(),
    eventType: z.enum([
      'goal_created',
      'goal_contract_confirmed',
      'plan_created',
      'plan_confirmed',
      'skill_goal_ready',
      'skill_attempt_started',
      'skill_attempt_completed',
      'workflow_waiting',
      'workflow_failed',
      'recovery_started',
      'human_intervention',
      'plan_revised',
      'business_event_observed',
      'goal_completed',
      'goal_failed',
    ]),
    actorType: z.enum(['user', 'agent', 'runtime', 'provider']),
    capabilityRefs: z.array(z.string()),
    authorityRefs: z.array(z.string()),
    parentEventRefs: z.array(z.string()),
    concurrencyGroup: z.string().optional(),
    branchRef: z.string().optional(),
    payloadSummary: JsonValueSchema,
  })
  .strict();
const TraceBodySchema = z
  .object({
    schemaVersion: z.literal(EXPERIENCE_COMPILATION_CONTRACT_VERSION),
    tenantId: z.string(),
    events: z.array(TraceEventSchema),
    correctionRefs: z.array(z.string()),
    outcomeRef: z.string().optional(),
    outcomeStatus: z.enum(['succeeded', 'failed', 'partial', 'unknown']),
    missingFactCodes: z.array(z.string()),
    environmentClass: z.string(),
    deviceClass: z.string().optional(),
  })
  .strict();
const StringArraySchema = z.array(z.string());
const PatternQualitySchema = z
  .object({
    support: z.number(),
    successRate: z.number(),
    traceCoverage: z.number(),
    fitness: z.number(),
    precisionProxy: z.number(),
    environmentCoverage: z.number(),
    contradictionRate: z.number(),
    generalization: z.number(),
    mandatoryThreshold: z.number(),
  })
  .strict();
const RecoveryPatternSchema = z
  .object({
    triggerActivity: z.string(),
    resumeActivity: z.string().optional(),
    activitySequence: z.array(z.string()),
    supportRefs: z.array(z.string()),
  })
  .strict();
const WorkflowPatternSchema = z
  .object({
    workflowPatternId: z.string(),
    taskTypeId: z.string(),
    activityPatterns: z.array(
      z
        .object({
          activity: z.string(),
          required: z.boolean(),
          supportRate: z.number(),
          capabilityRefs: z.array(z.string()),
        })
        .strict(),
    ),
    dependencyPatterns: z.array(
      z
        .object({
          predecessorActivity: z.string(),
          successorActivity: z.string(),
          relation: z.enum(['direct_follows', 'precedes', 'parallel']),
          supportRefs: z.array(z.string()),
          contradictionRefs: z.array(z.string()),
        })
        .strict(),
    ),
    recoveryPatterns: z.array(RecoveryPatternSchema),
    sourcePatternRef: z.string(),
    sourceTraceRefs: z.array(z.string()),
    quality: PatternQualitySchema,
  })
  .strict();
const CompressedPatternDefinitionSchema = z
  .object({
    schemaVersion: z.literal(EXPERIENCE_COMPILATION_CONTRACT_VERSION),
    encoding: z.literal('br+base64'),
    contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    uncompressedBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
    workflowPatternId: z.string(),
    supportCount: z.number().int().positive().max(65_536),
    contradictionCount: z.number().int().nonnegative().max(65_536),
    payload: z.string().max(1_000_000),
  })
  .strict();

interface TraceRow extends QueryResultRow {
  trace_id: string;
  source_episode_id: string;
  task_type_refs: unknown;
  goal_fingerprint: string;
  capability_fingerprint: string;
  environment_fingerprint: string;
  trace: unknown;
  completeness: string | number;
  created_at: Date | string;
  normalizer_version: string;
  source_hash: string;
  data_classification: ExperienceTrace['dataClassification'];
}

interface CompilationRunRow extends QueryResultRow {
  run_id: string;
  run_type: CompilationRun['runType'];
  source_episode_id: string | null;
  source_event_id: string | null;
  tenant_id: string | null;
  user_scope_id: string | null;
  cohort_fingerprint: string | null;
  status: CompilationRun['status'];
  attempt: number;
  max_attempts: number;
  available_at: Date | string;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  idempotency_key: string;
  payload: unknown;
  result_ref: string | null;
  last_error_code: string | null;
  last_error_summary: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresExperienceCompilationRepository implements ExperienceCompilationRepository {
  readonly #pool: Pool;
  readonly #episodes: PostgresGoalExperienceEpisodeRepository;

  constructor(pool: Pool) {
    this.#pool = pool;
    this.#episodes = new PostgresGoalExperienceEpisodeRepository(pool);
  }

  findSourceEpisode(episodeId: string) {
    return this.#episodes.findById(episodeId);
  }

  async findTrace(traceId: string): Promise<ExperienceTrace | undefined> {
    const result = await this.#pool.query<TraceRow>(traceSelect('trace.trace_id=$1'), [traceId]);
    return result.rows[0] === undefined ? undefined : mapTrace(result.rows[0]);
  }

  async findTraceBySource(
    sourceEpisodeId: string,
    normalizerVersion: string,
    sourceHash: string,
  ): Promise<ExperienceTrace | undefined> {
    const result = await this.#pool.query<TraceRow>(
      traceSelect(
        'source.source_episode_id=$1 AND source.normalizer_version=$2 AND source.source_hash=$3',
      ),
      [sourceEpisodeId, normalizerVersion, sourceHash],
    );
    return result.rows[0] === undefined ? undefined : mapTrace(result.rows[0]);
  }

  async saveTrace(
    report: ExperienceTraceNormalizationReport,
  ): Promise<Readonly<{ trace: ExperienceTrace; inserted: boolean }>> {
    const trace = createExperienceTrace(report.trace);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `experience-trace:${trace.sourceEpisodeId}:${trace.normalizerVersion}:${trace.sourceHash}`,
      ]);
      const source = await client.query<
        QueryResultRow & {
          source_hash: string;
          tenant_id: string | null;
          user_scope_id: string | null;
        }
      >(
        `SELECT episode.source_hash,episode.tenant_id,
                COALESCE(episode.user_scope_id,task.user_id) AS user_scope_id
         FROM goal_experience_episode episode
         LEFT JOIN agent_task task ON task.task_id=episode.task_id
         WHERE episode.episode_id=$1 FOR SHARE OF episode`,
        [trace.sourceEpisodeId],
      );
      const sourceRow = source.rows[0];
      if (sourceRow === undefined) throw new Error('EXPERIENCE_COMPILATION_EPISODE_NOT_FOUND');
      if (sourceRow.source_hash !== trace.sourceHash) {
        throw new Error('EXPERIENCE_COMPILATION_SOURCE_HASH_DRIFT');
      }
      const existing = await client.query<TraceRow>(
        traceSelect(
          'source.source_episode_id=$1 AND source.normalizer_version=$2 AND source.source_hash=$3',
        ),
        [trace.sourceEpisodeId, trace.normalizerVersion, trace.sourceHash],
      );
      if (existing.rows[0] !== undefined) {
        const persisted = mapTrace(existing.rows[0]);
        assertSameJson(persisted, trace, 'EXPERIENCE_COMPILATION_TRACE_IDEMPOTENCY_CONFLICT');
        await client.query('COMMIT');
        return Object.freeze({ trace: persisted, inserted: false });
      }
      const tenantId = trace.trace.tenantId;
      if (sourceRow.tenant_id !== null && sourceRow.tenant_id !== tenantId) {
        throw new Error('EXPERIENCE_COMPILATION_TENANT_SCOPE_DRIFT');
      }
      await client.query(
        `INSERT INTO experience_trace(
           trace_id,source_episode_id,task_type_refs,goal_fingerprint,capability_fingerprint,
           environment_fingerprint,trace,completeness,created_at)
         VALUES($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb,$8,$9)`,
        [
          trace.traceId,
          trace.sourceEpisodeId,
          JSON.stringify(trace.taskTypeRefs),
          trace.goalFingerprint,
          trace.capabilityFingerprint,
          trace.environmentFingerprint,
          JSON.stringify(trace.trace),
          trace.completeness,
          trace.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO experience_trace_source(
           trace_id,source_episode_id,tenant_id,user_scope_id,normalizer_version,source_hash,
           data_classification,redaction_codes,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [
          trace.traceId,
          trace.sourceEpisodeId,
          tenantId,
          sourceRow.user_scope_id,
          trace.normalizerVersion,
          trace.sourceHash,
          trace.dataClassification,
          JSON.stringify(report.redactionCodes),
          trace.createdAt,
        ],
      );
      await insertOutbox(client, {
        eventId: stableId('experience-trace-created', trace.traceId),
        eventType: 'experience.trace_created',
        aggregateType: 'experience_trace',
        aggregateId: trace.traceId,
        payload: {
          traceId: trace.traceId,
          sourceEpisodeId: trace.sourceEpisodeId,
          tenantId,
          normalizerVersion: trace.normalizerVersion,
          sourceHash: trace.sourceHash,
        },
        occurredAt: trace.createdAt,
      });
      await client.query('COMMIT');
      return Object.freeze({ trace, inserted: true });
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listTraces(input: CohortDefinition, limit = 10_000): Promise<readonly ExperienceTrace[]> {
    const cohort = createCohortDefinition(input);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000) {
      throw new Error('EXPERIENCE_COMPILATION_TRACE_LIMIT_INVALID');
    }
    const result = await this.#pool.query<TraceRow>(
      `${traceSelect(`source.tenant_id=$1
        AND trace.task_type_refs @> $2::jsonb
        AND trace.completeness >= $3
        AND ($4::text IS NULL OR trace.goal_fingerprint=$4)
        AND ($5::text IS NULL OR trace.capability_fingerprint=$5)
        AND ($6::text IS NULL OR trace.trace->>'environmentClass'=$6)
        AND ($7::text IS NULL OR trace.trace->>'deviceClass'=$7)
        AND ($8::timestamptz IS NULL OR trace.created_at >= $8)
        AND ($9::timestamptz IS NULL OR trace.created_at <= $9)`)}
       ORDER BY trace.created_at,trace.trace_id LIMIT $10`,
      [
        cohort.tenantId,
        JSON.stringify([cohort.taskTypeId]),
        cohort.minimumCompleteness,
        cohort.goalFingerprint ?? null,
        cohort.capabilityFingerprint ?? null,
        cohort.environmentClass ?? null,
        cohort.deviceClass ?? null,
        cohort.timeRange?.from ?? null,
        cohort.timeRange?.to ?? null,
        limit,
      ],
    );
    return Object.freeze(result.rows.map(mapTrace));
  }

  async saveProcessMiningResult(
    input: ProcessMiningResult,
    createdAt: string,
  ): Promise<
    Readonly<{ workflowPattern: ProcessMiningResult['workflowPattern']; inserted: boolean }>
  > {
    const definition = {
      schemaVersion: EXPERIENCE_COMPILATION_CONTRACT_VERSION,
      cohort: input.cohort,
      variants: input.variants,
      discoveredPattern: input.discoveredPattern,
      workflowPattern: input.workflowPattern,
    };
    const definitionEnvelope = await encodePatternDefinition(definition, input.workflowPattern);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `process-pattern:${input.discoveredPattern.patternId}`,
      ]);
      const existing = await client.query<QueryResultRow & { definition: unknown }>(
        'SELECT definition FROM pattern_candidate WHERE pattern_id=$1',
        [input.discoveredPattern.patternId],
      );
      if (existing.rows[0] !== undefined) {
        const persisted = CompressedPatternDefinitionSchema.parse(existing.rows[0].definition);
        if (persisted.contentHash !== definitionEnvelope.contentHash) {
          throw new Error('EXPERIENCE_COMPILATION_PATTERN_IDEMPOTENCY_CONFLICT');
        }
        await client.query('COMMIT');
        return Object.freeze({ workflowPattern: input.workflowPattern, inserted: false });
      }
      const supportRefs = [...input.discoveredPattern.supportRefs];
      const contradictionRefs = [...input.discoveredPattern.contradictionRefs];
      const allRefs = unique([...supportRefs, ...contradictionRefs]);
      const traces = await client.query<QueryResultRow & { trace_id: string; tenant_id: string }>(
        `SELECT trace.trace_id,source.tenant_id
         FROM experience_trace trace
         JOIN experience_trace_source source ON source.trace_id=trace.trace_id
         WHERE trace.trace_id=ANY($1::text[]) FOR SHARE OF trace,source`,
        [allRefs],
      );
      if (traces.rowCount !== allRefs.length) {
        throw new Error('EXPERIENCE_COMPILATION_PATTERN_TRACE_MISSING');
      }
      if (traces.rows.some((row) => row.tenant_id !== input.cohort.tenantId)) {
        throw new Error('EXPERIENCE_COMPILATION_PATTERN_TENANT_MISMATCH');
      }
      await client.query(
        `INSERT INTO pattern_candidate(
           pattern_id,pattern_type,cohort_fingerprint,definition,support_refs,
           contradiction_refs,confidence,status,created_at)
         VALUES($1,'workflow_pattern',$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,'discovered',$7)`,
        [
          input.discoveredPattern.patternId,
          input.cohortFingerprint,
          JSON.stringify(definitionEnvelope),
          JSON.stringify(supportRefs.slice(0, 4_096)),
          JSON.stringify(contradictionRefs.slice(0, 4_096)),
          input.discoveredPattern.quality.fitness,
          createdAt,
        ],
      );
      await insertPatternSupport(
        client,
        input.discoveredPattern.patternId,
        supportRefs,
        input.cohort.tenantId,
        'support',
        createdAt,
      );
      await insertPatternSupport(
        client,
        input.discoveredPattern.patternId,
        contradictionRefs,
        input.cohort.tenantId,
        'contradiction',
        createdAt,
      );
      await insertOutbox(client, {
        eventId: stableId('compiler-pattern-discovered', input.discoveredPattern.patternId),
        eventType: 'compiler.pattern_discovered',
        aggregateType: 'pattern_candidate',
        aggregateId: input.discoveredPattern.patternId,
        payload: {
          patternId: input.discoveredPattern.patternId,
          workflowPatternId: input.workflowPattern.workflowPatternId,
          cohortFingerprint: input.cohortFingerprint,
        },
        occurredAt: createdAt,
      });
      await client.query('COMMIT');
      return Object.freeze({ workflowPattern: input.workflowPattern, inserted: true });
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findWorkflowPattern(
    tenantId: string,
    workflowPatternId: string,
  ): Promise<WorkflowPattern | undefined> {
    const result = await this.#pool.query<QueryResultRow & { definition: unknown }>(
      `SELECT pattern.definition FROM pattern_candidate pattern
       WHERE pattern.definition->>'workflowPatternId'=$2
         AND EXISTS (
           SELECT 1 FROM pattern_candidate_support support
           WHERE support.pattern_id=pattern.pattern_id AND support.tenant_id=$1
         )
       ORDER BY pattern.created_at DESC,pattern.pattern_id LIMIT 1`,
      [tenantId, workflowPatternId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const definition = decodePatternDefinition(row.definition);
    if (definition.workflowPattern.workflowPatternId !== workflowPatternId) {
      throw new Error('EXPERIENCE_COMPILATION_WORKFLOW_PATTERN_PROJECTION_DRIFT');
    }
    return definition.workflowPattern;
  }

  async deleteUserScope(userScopeId: string, actorId: string): Promise<number> {
    if (userScopeId.trim().length === 0 || actorId.trim().length === 0) {
      throw new Error('EXPERIENCE_COMPILATION_DELETION_IDENTITY_REQUIRED');
    }
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `experience-compilation-deletion:${userScopeId}`,
      ]);
      const traces = await client.query<QueryResultRow & { trace_id: string }>(
        `SELECT trace_id FROM experience_trace_source
         WHERE user_scope_id=$1 ORDER BY trace_id FOR UPDATE`,
        [userScopeId],
      );
      const traceIds = traces.rows.map((row) => row.trace_id);
      const patterns =
        traceIds.length === 0
          ? []
          : (
              await client.query<QueryResultRow & { pattern_id: string }>(
                `SELECT DISTINCT pattern_id FROM pattern_candidate_support
                 WHERE trace_id=ANY($1::text[]) ORDER BY pattern_id`,
                [traceIds],
              )
            ).rows.map((row) => row.pattern_id);
      await client.query('DELETE FROM compilation_run WHERE user_scope_id=$1', [userScopeId]);
      if (patterns.length > 0) {
        await client.query(
          `DELETE FROM compilation_run
           WHERE result_ref IN (
             SELECT definition->>'workflowPatternId'
             FROM pattern_candidate WHERE pattern_id=ANY($1::text[])
           )`,
          [patterns],
        );
        await client.query('DELETE FROM pattern_candidate WHERE pattern_id=ANY($1::text[])', [
          patterns,
        ]);
      }
      if (traceIds.length > 0) {
        await client.query('DELETE FROM experience_trace WHERE trace_id=ANY($1::text[])', [
          traceIds,
        ]);
      }
      await client.query('COMMIT');
      return traceIds.length + patterns.length;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresExperienceCompilationTriggerSource implements ExperienceCompilationTriggerSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listPending(limit = 100): Promise<readonly ExperienceCompilationTrigger[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('EXPERIENCE_COMPILATION_TRIGGER_LIMIT_INVALID');
    }
    const result = await this.#pool.query<
      QueryResultRow & {
        trigger_ids: string[];
        run_type: CompilationRunType;
        source_episode_id: string | null;
        tenant_id: string | null;
        task_type_id: string | null;
        occurred_at: Date | string;
      }
    >(
      `WITH normalization_trigger AS (
         SELECT ARRAY[event.event_id] AS trigger_ids,'normalization'::text AS run_type,
                event.aggregate_id AS source_episode_id,NULL::text AS tenant_id,
                NULL::text AS task_type_id,event.occurred_at
         FROM cognitive_runtime_outbox event
         WHERE event.event_type='experience.episode_created'
           AND NOT EXISTS (
             SELECT 1 FROM compilation_run run WHERE run.source_event_id=event.event_id
           )
         ORDER BY event.occurred_at,event.event_id LIMIT $1
       ),
       mining_candidate AS (
         SELECT event.event_id,source.tenant_id,task_type.task_type_id,event.occurred_at
         FROM cognitive_runtime_outbox event
         JOIN experience_trace trace ON trace.trace_id=event.aggregate_id
         JOIN experience_trace_source source ON source.trace_id=trace.trace_id
         CROSS JOIN LATERAL (
           SELECT value AS task_type_id
           FROM jsonb_array_elements_text(trace.task_type_refs) AS value
           ORDER BY value LIMIT 1
         ) task_type
         WHERE event.event_type='experience.trace_created'
           AND trace.completeness >= 0.5
           AND event.occurred_at <= clock_timestamp() - interval '2 seconds'
           AND NOT EXISTS (
             SELECT 1 FROM compilation_run run
             WHERE run.source_event_id=event.event_id
                OR COALESCE(run.payload->'sourceEventIds','[]'::jsonb) ? event.event_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM compilation_run recent
             WHERE recent.run_type='process_mining'
               AND recent.tenant_id=source.tenant_id
               AND recent.payload->'cohort'->>'taskTypeId'=task_type.task_type_id
               AND (
                 recent.status IN ('pending','leased','retry_wait')
                 OR recent.created_at > clock_timestamp() - interval '60 seconds'
               )
           )
         ORDER BY event.occurred_at,event.event_id LIMIT $1
       ),
       mining_trigger AS (
         SELECT array_agg(event_id ORDER BY occurred_at,event_id) AS trigger_ids,
                'process_mining'::text AS run_type,
                NULL::text AS source_episode_id,source.tenant_id,
                source.task_type_id,max(source.occurred_at) AS occurred_at
         FROM mining_candidate source
         GROUP BY source.tenant_id,source.task_type_id
       )
       SELECT * FROM normalization_trigger
       UNION ALL
       SELECT * FROM mining_trigger
       ORDER BY occurred_at,trigger_ids LIMIT $1`,
      [limit],
    );
    return Object.freeze(
      result.rows.map((row): ExperienceCompilationTrigger => {
        if (row.run_type === 'normalization') {
          if (row.source_episode_id === null) {
            throw new Error('EXPERIENCE_COMPILATION_TRIGGER_EPISODE_MISSING');
          }
          const triggerId = row.trigger_ids[0];
          if (triggerId === undefined) {
            throw new Error('EXPERIENCE_COMPILATION_TRIGGER_SOURCE_MISSING');
          }
          return Object.freeze({
            triggerId,
            runType: 'normalization',
            sourceEpisodeId: row.source_episode_id,
            occurredAt: timestamp(row.occurred_at),
          });
        }
        if (row.tenant_id === null || row.task_type_id === null) {
          throw new Error('EXPERIENCE_COMPILATION_TRIGGER_COHORT_MISSING');
        }
        if (row.trigger_ids.length === 0) {
          throw new Error('EXPERIENCE_COMPILATION_TRIGGER_SOURCE_MISSING');
        }
        return Object.freeze({
          triggerIds: Object.freeze([...row.trigger_ids]),
          runType: 'process_mining',
          cohort: createCohortDefinition({
            tenantId: row.tenant_id,
            taskTypeId: row.task_type_id,
            minimumCompleteness: 0.5,
          }),
          occurredAt: timestamp(row.occurred_at),
        });
      }),
    );
  }
}

export class PostgresCompilationRunRepository implements CompilationRunRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async createNormalizationRun(
    sourceEpisodeId: string,
    now: string,
    maxAttempts = 5,
    sourceEventId?: string,
  ): Promise<CompilationRun> {
    const episode = await this.#pool.query<
      QueryResultRow & { tenant_id: string | null; user_scope_id: string | null }
    >(
      `SELECT episode.tenant_id,COALESCE(episode.user_scope_id,task.user_id) AS user_scope_id
       FROM goal_experience_episode episode
       LEFT JOIN agent_task task ON task.task_id=episode.task_id
       WHERE episode.episode_id=$1`,
      [sourceEpisodeId],
    );
    const scope = episode.rows[0];
    if (scope === undefined) throw new Error('EXPERIENCE_COMPILATION_EPISODE_NOT_FOUND');
    const idempotencyKey = `normalization:${sourceEpisodeId}`;
    const result = await this.#pool.query<CompilationRunRow>(
      `INSERT INTO compilation_run(
         run_id,run_type,source_episode_id,source_event_id,tenant_id,user_scope_id,cohort_fingerprint,
         status,attempt,max_attempts,available_at,lease_owner,lease_token,lease_expires_at,
         idempotency_key,payload,result_ref,last_error_code,last_error_summary,created_at,updated_at)
       VALUES($1,'normalization',$2,$3,$4,$5,NULL,'pending',0,$6,$7,NULL,NULL,NULL,$8,$9::jsonb,
         NULL,NULL,NULL,$7,$7)
       ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [
        stableId('compilation-normalization-run', sourceEpisodeId),
        sourceEpisodeId,
        sourceEventId ?? null,
        scope.tenant_id,
        scope.user_scope_id,
        maxAttempts,
        now,
        idempotencyKey,
        JSON.stringify({ sourceEpisodeId }),
      ],
    );
    return mapRun(requiredRow(result.rows[0]));
  }

  async createProcessMiningRun(
    input: CohortDefinition,
    cohortFingerprint: string,
    now: string,
    maxAttempts = 5,
    sourceEventIds?: readonly string[],
  ): Promise<CompilationRun> {
    const cohort = createCohortDefinition(input);
    const eventIds = unique(sourceEventIds ?? []);
    if (eventIds.length > 1_000) {
      throw new Error('EXPERIENCE_COMPILATION_TRIGGER_BATCH_TOO_LARGE');
    }
    const batchIdentity =
      eventIds.length === 0 ? now : stableId('source-event-batch', canonicalJson(eventIds));
    const idempotencyKey = `process-mining:${cohortFingerprint}:${batchIdentity}`;
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      if (eventIds.length > 0) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `process-mining-trigger:${cohort.tenantId}:${cohort.taskTypeId}`,
        ]);
        const recent = await client.query<CompilationRunRow>(
          `SELECT * FROM compilation_run
           WHERE run_type='process_mining'
             AND tenant_id=$1
             AND payload->'cohort'->>'taskTypeId'=$2
             AND (
               status IN ('pending','leased','retry_wait')
               OR created_at > clock_timestamp() - interval '60 seconds'
             )
           ORDER BY created_at DESC,run_id DESC LIMIT 1`,
          [cohort.tenantId, cohort.taskTypeId],
        );
        if (recent.rows[0] !== undefined) {
          await client.query('COMMIT');
          return mapRun(recent.rows[0]);
        }
      }
      const result = await client.query<CompilationRunRow>(
        `INSERT INTO compilation_run(
           run_id,run_type,source_episode_id,source_event_id,tenant_id,user_scope_id,
           cohort_fingerprint,status,attempt,max_attempts,available_at,lease_owner,lease_token,
           lease_expires_at,idempotency_key,payload,result_ref,last_error_code,last_error_summary,
           created_at,updated_at)
         VALUES($1,'process_mining',NULL,$2,$3,NULL,$4,'pending',0,$5,$6,NULL,NULL,NULL,$7,$8::jsonb,
           NULL,NULL,NULL,$6,$6)
         ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
         RETURNING *`,
        [
          stableId('compilation-mining-run', `${cohortFingerprint}:${batchIdentity}`),
          eventIds[0] ?? null,
          cohort.tenantId,
          cohortFingerprint,
          maxAttempts,
          now,
          idempotencyKey,
          JSON.stringify({ cohort, sourceEventIds: eventIds }),
        ],
      );
      await client.query('COMMIT');
      return mapRun(requiredRow(result.rows[0]));
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claim(
    runType: CompilationRunType,
    workerId: string,
    now: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly CompilationRun[]> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await deadLetterExpiredExhausted(client, runType, now);
      const selected = await client.query<CompilationRunRow>(
        `SELECT * FROM compilation_run
         WHERE run_type=$1
           AND attempt < max_attempts
           AND (
             (status IN ('pending','retry_wait') AND available_at <= $2)
             OR (status='leased' AND lease_expires_at <= $2)
           )
         ORDER BY available_at,run_id
         LIMIT $3 FOR UPDATE SKIP LOCKED`,
        [runType, now, limit],
      );
      const claimed: CompilationRun[] = [];
      for (const row of selected.rows) {
        const leaseToken = randomUUID();
        const updated = await client.query<CompilationRunRow>(
          `UPDATE compilation_run
           SET status='leased',attempt=attempt+1,lease_owner=$2,lease_token=$3,
               lease_expires_at=$4,updated_at=$5
           WHERE run_id=$1 RETURNING *`,
          [
            row.run_id,
            workerId,
            leaseToken,
            new Date(Date.parse(now) + leaseMs).toISOString(),
            now,
          ],
        );
        claimed.push(mapRun(requiredRow(updated.rows[0])));
      }
      await client.query('COMMIT');
      return Object.freeze(claimed);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(
    runId: string,
    workerId: string,
    leaseToken: string,
    resultRef: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE compilation_run
       SET status='completed',result_ref=$4,lease_owner=NULL,lease_token=NULL,
           lease_expires_at=NULL,updated_at=$5
       WHERE run_id=$1 AND status='leased' AND lease_owner=$2 AND lease_token=$3`,
      [runId, workerId, leaseToken, resultRef, now],
    );
    return result.rowCount === 1;
  }

  async fail(
    runId: string,
    workerId: string,
    leaseToken: string,
    errorCode: string,
    errorSummary: string,
    now: string,
    retryAt?: string,
  ): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE compilation_run
       SET status=$4,available_at=$5,last_error_code=$6,last_error_summary=$7,
           lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=$8
       WHERE run_id=$1 AND status='leased' AND lease_owner=$2 AND lease_token=$3`,
      [
        runId,
        workerId,
        leaseToken,
        retryAt === undefined ? 'dead_letter' : 'retry_wait',
        retryAt ?? now,
        errorCode.slice(0, 128),
        redactError(errorSummary),
        now,
      ],
    );
    return result.rowCount === 1;
  }

  async listRequeueable(
    runType: CompilationRunType,
    now: string,
    limit = 100,
  ): Promise<readonly CompilationRun[]> {
    await deadLetterExpiredExhausted(this.#pool, runType, now);
    const result = await this.#pool.query<CompilationRunRow>(
      `SELECT * FROM compilation_run
       WHERE run_type=$1
         AND attempt < max_attempts
         AND (
           (status IN ('pending','retry_wait') AND available_at <= $2)
           OR (status='leased' AND lease_expires_at <= $2)
         )
       ORDER BY available_at,run_id LIMIT $3`,
      [runType, now, limit],
    );
    return Object.freeze(result.rows.map(mapRun));
  }
}

async function deadLetterExpiredExhausted(
  queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  runType: CompilationRunType,
  now: string,
): Promise<void> {
  await queryable.query(
    `UPDATE compilation_run
     SET status='dead_letter',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
         last_error_code=COALESCE(
           last_error_code,'EXPERIENCE_COMPILATION_LEASE_ATTEMPTS_EXHAUSTED'
         ),
         last_error_summary=COALESCE(
           last_error_summary,'Worker lease expired after the terminal permitted attempt.'
         ),
         updated_at=$2
     WHERE run_type=$1 AND status='leased' AND lease_expires_at <= $2
       AND attempt >= max_attempts`,
    [runType, now],
  );
}

function traceSelect(where: string): string {
  return `SELECT trace.*,source.normalizer_version,source.source_hash,
           source.data_classification
          FROM experience_trace trace
          JOIN experience_trace_source source ON source.trace_id=trace.trace_id
          WHERE ${where}`;
}

function mapTrace(row: TraceRow): ExperienceTrace {
  return createExperienceTrace({
    traceId: row.trace_id,
    sourceEpisodeId: row.source_episode_id,
    taskTypeRefs: StringArraySchema.parse(row.task_type_refs),
    goalFingerprint: row.goal_fingerprint,
    capabilityFingerprint: row.capability_fingerprint,
    environmentFingerprint: row.environment_fingerprint,
    trace: mapTraceBody(row.trace),
    completeness: Number(row.completeness),
    dataClassification: row.data_classification,
    normalizerVersion: row.normalizer_version,
    sourceHash: row.source_hash,
    createdAt: timestamp(row.created_at),
  });
}

function mapTraceBody(value: unknown): ExperienceTraceBody {
  const parsed = TraceBodySchema.parse(value);
  return {
    schemaVersion: parsed.schemaVersion,
    tenantId: parsed.tenantId,
    events: parsed.events.map((event): ExperienceTraceEvent => ({
      eventId: event.eventId,
      sequence: event.sequence,
      occurredAt: event.occurredAt,
      eventType: event.eventType,
      actorType: event.actorType,
      capabilityRefs: event.capabilityRefs,
      authorityRefs: event.authorityRefs,
      parentEventRefs: event.parentEventRefs,
      ...(event.concurrencyGroup === undefined ? {} : { concurrencyGroup: event.concurrencyGroup }),
      ...(event.branchRef === undefined ? {} : { branchRef: event.branchRef }),
      payloadSummary: event.payloadSummary,
    })),
    correctionRefs: parsed.correctionRefs,
    ...(parsed.outcomeRef === undefined ? {} : { outcomeRef: parsed.outcomeRef }),
    outcomeStatus: parsed.outcomeStatus,
    missingFactCodes: parsed.missingFactCodes,
    environmentClass: parsed.environmentClass,
    ...(parsed.deviceClass === undefined ? {} : { deviceClass: parsed.deviceClass }),
  };
}

function mapRun(row: CompilationRunRow): CompilationRun {
  return Object.freeze({
    runId: row.run_id,
    runType: row.run_type,
    ...(row.source_episode_id === null ? {} : { sourceEpisodeId: row.source_episode_id }),
    ...(row.source_event_id === null ? {} : { sourceEventId: row.source_event_id }),
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.user_scope_id === null ? {} : { userScopeId: row.user_scope_id }),
    ...(row.cohort_fingerprint === null ? {} : { cohortFingerprint: row.cohort_fingerprint }),
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    availableAt: timestamp(row.available_at),
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.lease_token === null ? {} : { leaseToken: row.lease_token }),
    ...(row.lease_expires_at === null ? {} : { leaseExpiresAt: timestamp(row.lease_expires_at) }),
    idempotencyKey: row.idempotency_key,
    payload: JsonObjectSchema.parse(row.payload),
    ...(row.result_ref === null ? {} : { resultRef: row.result_ref }),
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
    ...(row.last_error_summary === null ? {} : { lastErrorSummary: row.last_error_summary }),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  });
}

async function insertPatternSupport(
  client: PoolClient,
  patternId: string,
  traceIds: readonly string[],
  tenantId: string,
  supportKind: 'support' | 'contradiction',
  createdAt: string,
): Promise<void> {
  if (traceIds.length === 0) return;
  await client.query(
    `INSERT INTO pattern_candidate_support(
       pattern_id,trace_id,tenant_id,support_kind,created_at)
     SELECT $1,trace_id,$3,$4,$5
     FROM unnest($2::text[]) AS trace_id`,
    [patternId, traceIds, tenantId, supportKind, createdAt],
  );
}

async function encodePatternDefinition(
  definition: Readonly<Record<string, unknown>>,
  workflowPattern: WorkflowPattern,
): Promise<z.infer<typeof CompressedPatternDefinitionSchema>> {
  const serialized = canonicalJson(definition);
  const compressed = await brotliCompressAsync(serialized, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  });
  const envelope = {
    schemaVersion: EXPERIENCE_COMPILATION_CONTRACT_VERSION,
    encoding: 'br+base64' as const,
    contentHash: `sha256:${createHash('sha256').update(serialized).digest('hex')}`,
    uncompressedBytes: Buffer.byteLength(serialized),
    workflowPatternId: workflowPattern.workflowPatternId,
    supportCount: workflowPattern.sourceTraceRefs.length,
    contradictionCount: definitionContradictionCount(definition),
    payload: compressed.toString('base64'),
  };
  if (Buffer.byteLength(JSON.stringify(envelope)) > 1_048_576) {
    throw new Error('EXPERIENCE_COMPILATION_PATTERN_DEFINITION_COMPRESSED_BOUND_EXCEEDED');
  }
  return CompressedPatternDefinitionSchema.parse(envelope);
}

function decodePatternDefinition(value: unknown): Readonly<{ workflowPattern: WorkflowPattern }> {
  const envelope = CompressedPatternDefinitionSchema.parse(value);
  const compressed = Buffer.from(envelope.payload, 'base64');
  const decompressed = brotliDecompressSync(compressed, {
    maxOutputLength: 64 * 1024 * 1024,
  });
  if (decompressed.byteLength !== envelope.uncompressedBytes) {
    throw new Error('EXPERIENCE_COMPILATION_PATTERN_DEFINITION_SIZE_DRIFT');
  }
  const serialized = decompressed.toString('utf8');
  const contentHash = `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
  if (contentHash !== envelope.contentHash) {
    throw new Error('EXPERIENCE_COMPILATION_PATTERN_DEFINITION_HASH_DRIFT');
  }
  const decoded: unknown = JSON.parse(serialized);
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new Error('EXPERIENCE_COMPILATION_PATTERN_DEFINITION_INVALID');
  }
  const workflowPattern = WorkflowPatternSchema.parse(
    (decoded as Readonly<Record<string, unknown>>)['workflowPattern'],
  );
  return Object.freeze({
    workflowPattern: createWorkflowPattern({
      ...workflowPattern,
      recoveryPatterns: workflowPattern.recoveryPatterns.map((pattern) => ({
        triggerActivity: pattern.triggerActivity,
        ...(pattern.resumeActivity === undefined ? {} : { resumeActivity: pattern.resumeActivity }),
        activitySequence: pattern.activitySequence,
        supportRefs: pattern.supportRefs,
      })),
    }),
  });
}

function definitionContradictionCount(definition: Readonly<Record<string, unknown>>): number {
  const discovered = definition['discoveredPattern'];
  if (typeof discovered !== 'object' || discovered === null || Array.isArray(discovered)) return 0;
  const refs = (discovered as Readonly<Record<string, unknown>>)['contradictionRefs'];
  return Array.isArray(refs) ? refs.length : 0;
}

async function insertOutbox(
  client: PoolClient,
  input: Readonly<{
    eventId: string;
    eventType: 'experience.trace_created' | 'compiler.pattern_discovered';
    aggregateType: 'experience_trace' | 'pattern_candidate';
    aggregateId: string;
    payload: JsonObject;
    occurredAt: string;
  }>,
): Promise<void> {
  await client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       correlation,payload,occurred_at,published_at)
     VALUES($1,$2,$3,$4,1,$5::jsonb,$6::jsonb,$7,NULL)`,
    [
      input.eventId,
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      JSON.stringify({ correlationId: input.eventId }),
      JSON.stringify(input.payload),
      input.occurredAt,
    ],
  );
}

function assertSameJson(left: unknown, right: unknown, code: string): void {
  if (canonicalJson(left) !== canonicalJson(right)) throw new Error(code);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('EXPERIENCE_COMPILATION_NON_FINITE_JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error('EXPERIENCE_COMPILATION_NON_JSON_VALUE');
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function stableId(namespace: string, value: string): string {
  return `${namespace}-${createHash('sha256').update(value).digest('hex').slice(0, 40)}`;
}

function timestamp(value: Date | string): string {
  const timestampValue = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestampValue.getTime())) {
    throw new Error('EXPERIENCE_COMPILATION_TIMESTAMP_INVALID');
  }
  return timestampValue.toISOString();
}

function requiredRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('EXPERIENCE_COMPILATION_ROW_MISSING');
  return row;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function redactError(value: string): string {
  return value
    .replace(/(password|secret|token|authorization|credential)=[^\s]+/giu, '$1=[REDACTED]')
    .slice(0, 2048);
}
