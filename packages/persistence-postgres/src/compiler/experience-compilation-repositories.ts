import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import {
  EXPERIENCE_COMPILATION_CONTRACT_VERSION,
  createCohortDefinition,
  createExperienceTrace,
  type CohortDefinition,
  type ExperienceTrace,
  type ExperienceTraceBody,
  type ExperienceTraceEvent,
} from '../../../domain/src/index.js';
import type { JsonObject, JsonValue } from '../../../domain/src/compiler/contracts.js';
import type {
  CompilationRun,
  CompilationRunRepository,
  CompilationRunType,
  ExperienceCompilationRepository,
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
        assertSameJson(
          existing.rows[0].definition,
          definition,
          'EXPERIENCE_COMPILATION_PATTERN_IDEMPOTENCY_CONFLICT',
        );
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
          JSON.stringify(definition),
          JSON.stringify(supportRefs),
          JSON.stringify(contradictionRefs),
          input.discoveredPattern.quality.fitness,
          createdAt,
        ],
      );
      for (const traceId of supportRefs) {
        await insertPatternSupport(
          client,
          input.discoveredPattern.patternId,
          traceId,
          input.cohort.tenantId,
          'support',
          createdAt,
        );
      }
      for (const traceId of contradictionRefs) {
        await insertPatternSupport(
          client,
          input.discoveredPattern.patternId,
          traceId,
          input.cohort.tenantId,
          'contradiction',
          createdAt,
        );
      }
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
             SELECT definition->'workflowPattern'->>'workflowPatternId'
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

export class PostgresCompilationRunRepository implements CompilationRunRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async createNormalizationRun(
    sourceEpisodeId: string,
    now: string,
    maxAttempts = 5,
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
         run_id,run_type,source_episode_id,tenant_id,user_scope_id,cohort_fingerprint,
         status,attempt,max_attempts,available_at,lease_owner,lease_token,lease_expires_at,
         idempotency_key,payload,result_ref,last_error_code,last_error_summary,created_at,updated_at)
       VALUES($1,'normalization',$2,$3,$4,NULL,'pending',0,$5,$6,NULL,NULL,NULL,$7,$8::jsonb,
         NULL,NULL,NULL,$6,$6)
       ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [
        stableId('compilation-normalization-run', sourceEpisodeId),
        sourceEpisodeId,
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
  ): Promise<CompilationRun> {
    const cohort = createCohortDefinition(input);
    const idempotencyKey = `process-mining:${cohortFingerprint}:${now}`;
    const result = await this.#pool.query<CompilationRunRow>(
      `INSERT INTO compilation_run(
         run_id,run_type,source_episode_id,tenant_id,user_scope_id,cohort_fingerprint,
         status,attempt,max_attempts,available_at,lease_owner,lease_token,lease_expires_at,
         idempotency_key,payload,result_ref,last_error_code,last_error_summary,created_at,updated_at)
       VALUES($1,'process_mining',NULL,$2,NULL,$3,'pending',0,$4,$5,NULL,NULL,NULL,$6,$7::jsonb,
         NULL,NULL,NULL,$5,$5)
       ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [
        stableId('compilation-mining-run', `${cohortFingerprint}:${now}`),
        cohort.tenantId,
        cohortFingerprint,
        maxAttempts,
        now,
        idempotencyKey,
        JSON.stringify({ cohort }),
      ],
    );
    return mapRun(requiredRow(result.rows[0]));
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
  traceId: string,
  tenantId: string,
  supportKind: 'support' | 'contradiction',
  createdAt: string,
): Promise<void> {
  await client.query(
    `INSERT INTO pattern_candidate_support(
       pattern_id,trace_id,tenant_id,support_kind,created_at)
     VALUES($1,$2,$3,$4,$5)`,
    [patternId, traceId, tenantId, supportKind, createdAt],
  );
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
