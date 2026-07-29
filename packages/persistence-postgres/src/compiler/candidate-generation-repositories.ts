import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  candidatePersistence,
  type CandidateGenerationCatalog,
  type CandidateGenerationCompletion,
  type CandidateGenerationRun,
  type CandidateGenerationRunRepository,
  type CandidateGenerationSource,
  type CandidateGenerationTrigger,
  type CandidateGenerationTriggerSource,
} from '../../../application/src/compiler/candidate-generation.js';
import type { SkillVersion } from '../../../domain/src/index.js';
import { PostgresArtifactRepository } from './artifact-repositories.js';
import { PostgresExperienceCompilationRepository } from './experience-compilation-repositories.js';

interface CandidateGenerationRunRow extends QueryResultRow {
  run_id: string;
  tenant_id: string;
  source_pattern_ref: string;
  source_event_id: string | null;
  status: CandidateGenerationRun['status'];
  result_artifact_ref: string | null;
  attempt: number;
  max_attempts: number;
  available_at: Date | string;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  idempotency_key: string;
  payload: unknown;
  last_error_code: string | null;
  last_error_summary: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresCandidateGenerationCatalog implements CandidateGenerationCatalog {
  readonly #skills: Readonly<{
    listEnabledVersions(): Promise<readonly SkillVersion[]>;
  }>;

  constructor(
    skills: Readonly<{
      listEnabledVersions(): Promise<readonly SkillVersion[]>;
    }>,
  ) {
    this.#skills = skills;
  }

  async listKnownCapabilityIds(): Promise<readonly string[]> {
    return unique(
      (await this.#skills.listEnabledVersions()).flatMap((skill) => skill.capabilities),
    );
  }

  async listTaskTypeCapabilityIds(taskTypeId: string): Promise<readonly string[]> {
    const skills = await this.#skills.listEnabledVersions();
    return unique(
      skills
        .filter((skill) =>
          (skill.usageSpecification?.taskBindings ?? []).some(
            (binding) => binding.taskType === taskTypeId,
          ),
        )
        .flatMap((skill) => skill.capabilities),
    );
  }
}

export class PostgresCandidateGenerationRepository
  implements CandidateGenerationRunRepository, CandidateGenerationTriggerSource
{
  readonly #pool: Pool;
  readonly #experience: PostgresExperienceCompilationRepository;

  constructor(pool: Pool) {
    this.#pool = pool;
    this.#experience = new PostgresExperienceCompilationRepository(pool);
  }

  async listPending(limit = 100): Promise<readonly CandidateGenerationTrigger[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('CANDIDATE_GENERATION_TRIGGER_LIMIT_INVALID');
    }
    const result = await this.#pool.query<
      QueryResultRow & {
        event_id: string;
        pattern_id: string;
        tenant_id: string;
        occurred_at: Date | string;
      }
    >(
      `SELECT event.event_id,event.aggregate_id AS pattern_id,
              min(support.tenant_id) AS tenant_id,event.occurred_at
       FROM cognitive_runtime_outbox event
       JOIN pattern_candidate pattern ON pattern.pattern_id=event.aggregate_id
       JOIN pattern_candidate_support support ON support.pattern_id=pattern.pattern_id
       WHERE event.event_type='compiler.pattern_discovered'
         AND NOT EXISTS (
           SELECT 1 FROM candidate_generation_run run
           WHERE run.source_event_id=event.event_id
         )
       GROUP BY event.event_id,event.aggregate_id,event.occurred_at
       ORDER BY event.occurred_at,event.event_id LIMIT $1`,
      [limit],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          triggerId: row.event_id,
          tenantId: row.tenant_id,
          sourcePatternRef: row.pattern_id,
          occurredAt: timestamp(row.occurred_at),
        }),
      ),
    );
  }

  async createRun(
    tenantId: string,
    sourcePatternRef: string,
    sourceEventId: string,
    now: string,
    maxAttempts = 5,
  ): Promise<CandidateGenerationRun> {
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
      throw new Error('CANDIDATE_GENERATION_MAX_ATTEMPTS_INVALID');
    }
    const idempotencyKey = `candidate-generation:${tenantId}:${sourcePatternRef}`;
    const result = await this.#pool.query<CandidateGenerationRunRow>(
      `INSERT INTO candidate_generation_run(
         run_id,tenant_id,source_pattern_ref,source_event_id,status,result_artifact_ref,
         attempt,max_attempts,available_at,lease_owner,lease_token,lease_expires_at,
         idempotency_key,payload,last_error_code,last_error_summary,started_at,completed_at,
         created_at,updated_at)
       VALUES($1,$2,$3,$4,'pending',NULL,0,$5,$6,NULL,NULL,NULL,$7,$8::jsonb,NULL,NULL,$6,NULL,$6,$6)
       ON CONFLICT(idempotency_key) DO UPDATE
       SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [
        stableId('candidate-generation-run', idempotencyKey),
        tenantId,
        sourcePatternRef,
        sourceEventId,
        maxAttempts,
        now,
        idempotencyKey,
        JSON.stringify({ tenantId, sourcePatternRef, sourceEventId }),
      ],
    );
    return mapRun(requiredRow(result.rows[0]));
  }

  async claim(
    workerId: string,
    now: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly CandidateGenerationRun[]> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await deadLetterExpiredExhausted(client, now);
      const selected = await client.query<CandidateGenerationRunRow>(
        `SELECT * FROM candidate_generation_run
         WHERE attempt < max_attempts
           AND (
             (status IN ('pending','retry_wait') AND available_at <= $1)
             OR (status='leased' AND lease_expires_at <= $1)
           )
         ORDER BY available_at,run_id
         LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [now, limit],
      );
      const claimed: CandidateGenerationRun[] = [];
      for (const row of selected.rows) {
        const leaseToken = randomUUID();
        const updated = await client.query<CandidateGenerationRunRow>(
          `UPDATE candidate_generation_run
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

  async loadSource(run: CandidateGenerationRun): Promise<CandidateGenerationSource | undefined> {
    const source = await this.#experience.findProcessMiningSource(
      run.tenantId,
      run.sourcePatternRef,
    );
    if (source === undefined) return undefined;
    const traceRefs = new Set(source.workflowPattern.sourceTraceRefs);
    const traces = (await this.#experience.listTraces(source.cohort, 10_000)).filter((trace) =>
      traceRefs.has(trace.traceId),
    );
    if (traces.length !== traceRefs.size) {
      throw new Error('CANDIDATE_GENERATION_SOURCE_TRACE_MISSING');
    }
    const scopes = await this.#pool.query<
      QueryResultRow & {
        user_scope_id: string | null;
        snapshot_temporary_skill_id: string | null;
        task_temporary_skill_id: string | null;
      }
    >(
      `SELECT source.user_scope_id,
              NULLIF(COALESCE(
                episode.snapshot #>> '{task,temporarySkillId}',
                episode.snapshot #>> '{task,temporary_skill_id}'
              ),'') AS snapshot_temporary_skill_id,
              task.temporary_skill_id AS task_temporary_skill_id
       FROM experience_trace_source source
       JOIN goal_experience_episode episode
         ON episode.episode_id=source.source_episode_id
       LEFT JOIN agent_task task ON task.task_id=episode.task_id
       WHERE source.trace_id=ANY($1::text[])
       ORDER BY source.trace_id`,
      [[...traceRefs]],
    );
    const sourceUserScopeIds = unique(
      scopes.rows.flatMap((row) => (row.user_scope_id === null ? [] : [row.user_scope_id])),
    );
    const userCount = sourceUserScopeIds.length;
    const environmentClasses = unique(traces.map((trace) => trace.trace.environmentClass));
    const deviceClasses = unique(
      traces.flatMap((trace) =>
        trace.trace.deviceClass === undefined ? [] : [trace.trace.deviceClass],
      ),
    );
    const requiredCapabilities = unique(
      source.workflowPattern.activityPatterns.flatMap((activity) => activity.capabilityRefs),
    );
    const domainSeed = requiredCapabilities[0] ?? source.workflowPattern.taskTypeId;
    const domain = domainSeed.split(/[.:]/u)[0] ?? 'general';
    return Object.freeze({
      tenantId: run.tenantId,
      domain,
      workflowPattern: source.workflowPattern,
      discoveredPattern: source.discoveredPattern,
      environmentClasses,
      deviceClasses,
      userScope: userCount < 2 ? 'single' : 'multi',
      sourceUserScopeIds,
      scopeEvidence: Object.freeze({
        tenantCount: 1,
        userCount,
        deviceClassCount: deviceClasses.length,
        environmentClassCount: environmentClasses.length,
        successCount: traces.filter((trace) => trace.trace.outcomeStatus === 'succeeded').length,
        failureCount: traces.filter((trace) => trace.trace.outcomeStatus === 'failed').length,
        hasTemporaryAuthorization: scopes.rows.some(
          (row) => row.snapshot_temporary_skill_id !== null || row.task_temporary_skill_id !== null,
        ),
        hasFailureBoundary:
          source.workflowPattern.recoveryPatterns.length > 0 ||
          source.discoveredPattern.failureVariants.length > 0,
      }),
      sourceEpisodeRefs: unique(traces.map((trace) => trace.sourceEpisodeId)),
      sourceCorrectionRefs: unique(traces.flatMap((trace) => trace.trace.correctionRefs)),
    });
  }

  async findExistingFingerprints(
    artifactType: string,
    domain: string,
    taskTypeId: string,
  ): Promise<readonly string[]> {
    const result = await this.#pool.query<QueryResultRow & { fingerprint: string }>(
      `SELECT fingerprint FROM candidate_fingerprint
       WHERE artifact_type=$1 AND domain=$2 AND task_type_id=$3
       ORDER BY fingerprint`,
      [artifactType, domain, taskTypeId],
    );
    return Object.freeze(result.rows.map((row) => row.fingerprint));
  }

  async completeAtomically(
    run: CandidateGenerationRun,
    workerId: string,
    leaseToken: string,
    completion: CandidateGenerationCompletion,
    now: string,
  ): Promise<boolean> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<CandidateGenerationRunRow>(
        `SELECT * FROM candidate_generation_run
         WHERE run_id=$1 FOR UPDATE`,
        [run.runId],
      );
      const current = locked.rows[0];
      if (
        current?.status !== 'leased' ||
        current.lease_owner !== workerId ||
        current.lease_token !== leaseToken
      ) {
        await client.query('ROLLBACK');
        return false;
      }
      const fused = completion.fusedPattern;
      const generalized = completion.generalizedPattern;
      if (
        fused.sourceProcessPatternRef !== run.sourcePatternRef ||
        fused.structuralPattern.workflowPatternId !== fused.sourceWorkflowPatternRef ||
        generalized.sourceFusedPatternRef !== fused.fusedPatternId
      ) {
        throw new Error('CANDIDATE_LINEAGE_SOURCE_CHAIN_INVALID');
      }
      const savedFused = await client.query(
        `INSERT INTO fused_pattern(
           fused_pattern_id,tenant_id,workflow_pattern_id,source_process_pattern_ref,
           source_trace_refs,content,content_hash,fusion_version,created_at)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)
         ON CONFLICT(fused_pattern_id) DO UPDATE
         SET fused_pattern_id=EXCLUDED.fused_pattern_id
         WHERE fused_pattern.content_hash=EXCLUDED.content_hash
           AND fused_pattern.tenant_id=EXCLUDED.tenant_id
           AND fused_pattern.workflow_pattern_id=EXCLUDED.workflow_pattern_id
           AND fused_pattern.source_process_pattern_ref=EXCLUDED.source_process_pattern_ref
         RETURNING fused_pattern_id`,
        [
          fused.fusedPatternId,
          run.tenantId,
          fused.sourceWorkflowPatternRef,
          fused.sourceProcessPatternRef,
          JSON.stringify(fused.sourceTraceRefs),
          JSON.stringify(fused),
          fused.contentHash,
          fused.fusionVersion,
          now,
        ],
      );
      if (savedFused.rowCount !== 1) {
        throw new Error('FUSED_PATTERN_IMMUTABLE_CONFLICT');
      }
      const savedGeneralized = await client.query(
        `INSERT INTO generalized_pattern(
           generalized_pattern_id,tenant_id,domain,task_type_id,source_fused_pattern_ref,
           content,content_hash,generalizer_version,created_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
         ON CONFLICT(generalized_pattern_id) DO UPDATE
         SET generalized_pattern_id=EXCLUDED.generalized_pattern_id
         WHERE generalized_pattern.content_hash=EXCLUDED.content_hash
           AND generalized_pattern.tenant_id=EXCLUDED.tenant_id
           AND generalized_pattern.domain=EXCLUDED.domain
           AND generalized_pattern.task_type_id=EXCLUDED.task_type_id
           AND generalized_pattern.source_fused_pattern_ref=EXCLUDED.source_fused_pattern_ref
         RETURNING generalized_pattern_id`,
        [
          generalized.generalizedPatternId,
          run.tenantId,
          generalized.domain,
          generalized.taskTypeId,
          generalized.sourceFusedPatternRef,
          JSON.stringify(generalized),
          generalized.contentHash,
          generalized.generalizerVersion,
          now,
        ],
      );
      if (savedGeneralized.rowCount !== 1) {
        throw new Error('GENERALIZED_PATTERN_IMMUTABLE_CONFLICT');
      }
      await assertResolvableLineage(client, run, completion);
      await new PostgresArtifactRepository(client).saveCandidate(candidatePersistence(completion));
      await client.query(
        `INSERT INTO candidate_fingerprint(
           fingerprint,artifact_type,domain,task_type_id,artifact_ref,generator_version,created_at)
         VALUES($1,'plan_template',$2,$3,$4,$5,$6)
         ON CONFLICT(fingerprint) DO NOTHING`,
        [
          completion.candidate.fingerprint,
          generalized.domain,
          generalized.taskTypeId,
          completion.candidate.artifact.artifactId,
          completion.candidate.artifact.dependencySnapshot.compilerVersion,
          now,
        ],
      );
      const validation = completion.candidate.validation;
      await client.query(
        `INSERT INTO candidate_static_validation(
           validation_id,artifact_ref,schema_valid,activity_identity_valid,dag_valid,
           parallel_semantics_valid,required_criteria_covered,capability_shape_valid,
           capability_catalog_aligned,parameter_policy_valid,parameter_schema_aligned,
           applicability_evaluable,lineage_complete,recovery_semantics_valid,
           side_effect_replay_safe,bounds_valid,duplicate_fingerprint,errors,warnings,
           validator_version,result,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,
           $19::jsonb,$20,$21,$22)
         ON CONFLICT(validation_id) DO NOTHING`,
        [
          `validation-${validation.artifactRef}-${validation.validatorVersion}`,
          validation.artifactRef,
          validation.schemaValid,
          validation.activityIdentityValid,
          validation.dagValid,
          validation.parallelSemanticsValid,
          validation.requiredCriteriaCovered,
          validation.capabilityShapeValid,
          validation.capabilityCatalogAligned,
          validation.parameterPolicyValid,
          validation.parameterSchemaAligned,
          validation.applicabilityEvaluable,
          validation.lineageComplete,
          validation.recoverySemanticsValid,
          validation.sideEffectReplaySafe,
          validation.boundsValid,
          validation.duplicateFingerprint ?? null,
          JSON.stringify(validation.errors),
          JSON.stringify(validation.warnings),
          validation.validatorVersion,
          validation.result,
          now,
        ],
      );
      const completed = await client.query(
        `UPDATE candidate_generation_run
         SET status='completed',result_artifact_ref=$4,completed_at=$5,
             lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=$5
         WHERE run_id=$1 AND status='leased' AND lease_owner=$2 AND lease_token=$3`,
        [run.runId, workerId, leaseToken, completion.candidate.artifact.artifactId, now],
      );
      if (completed.rowCount !== 1) {
        throw new Error('CANDIDATE_GENERATION_FENCE_REJECTED');
      }
      await client.query('COMMIT');
      return true;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
      `UPDATE candidate_generation_run
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

  async listRequeueable(now: string, limit = 100): Promise<readonly CandidateGenerationRun[]> {
    await deadLetterExpiredExhausted(this.#pool, now);
    const result = await this.#pool.query<CandidateGenerationRunRow>(
      `SELECT * FROM candidate_generation_run
       WHERE attempt < max_attempts
         AND (
           (status IN ('pending','retry_wait') AND available_at <= $1)
           OR (status='leased' AND lease_expires_at <= $1)
         )
       ORDER BY available_at,run_id LIMIT $2`,
      [now, limit],
    );
    return Object.freeze(result.rows.map(mapRun));
  }
}

async function assertResolvableLineage(
  client: PoolClient,
  run: CandidateGenerationRun,
  completion: CandidateGenerationCompletion,
): Promise<void> {
  const { fusedPattern, generalizedPattern, candidate } = completion;
  const expectedPatternRefs = unique([
    fusedPattern.sourceWorkflowPatternRef,
    fusedPattern.sourceProcessPatternRef,
    ...fusedPattern.sourceTraceRefs,
    fusedPattern.fusedPatternId,
    generalizedPattern.generalizedPatternId,
  ]);
  if (
    canonicalJson(unique(candidate.lineage.sourcePatternRefs)) !==
    canonicalJson(expectedPatternRefs)
  ) {
    throw new Error('CANDIDATE_LINEAGE_PATTERN_REFERENCE_DRIFT');
  }
  await assertReferenceSet(
    client,
    'SELECT episode_id AS ref FROM goal_experience_episode WHERE episode_id=ANY($1::text[])',
    candidate.lineage.sourceEpisodeRefs,
    'EPISODE',
  );
  await assertReferenceSet(
    client,
    'SELECT trace_id AS ref FROM experience_trace WHERE trace_id=ANY($1::text[])',
    fusedPattern.sourceTraceRefs,
    'TRACE',
  );
  await assertReferenceSet(
    client,
    'SELECT pattern_id AS ref FROM pattern_candidate WHERE pattern_id=ANY($1::text[])',
    [run.sourcePatternRef],
    'PROCESS_PATTERN',
  );
  await assertReferenceSet(
    client,
    'SELECT correction_id AS ref FROM planning_correction_fact WHERE correction_id=ANY($1::text[])',
    candidate.lineage.sourceCorrectionRefs,
    'CORRECTION',
  );
  await assertReferenceSet(
    client,
    'SELECT workflow_pattern_id AS ref FROM fused_pattern WHERE workflow_pattern_id=ANY($1::text[])',
    [fusedPattern.sourceWorkflowPatternRef],
    'WORKFLOW_PATTERN',
  );
  await assertReferenceSet(
    client,
    'SELECT fused_pattern_id AS ref FROM fused_pattern WHERE fused_pattern_id=ANY($1::text[])',
    [fusedPattern.fusedPatternId],
    'FUSED_PATTERN',
  );
  await assertReferenceSet(
    client,
    'SELECT generalized_pattern_id AS ref FROM generalized_pattern WHERE generalized_pattern_id=ANY($1::text[])',
    [generalizedPattern.generalizedPatternId],
    'GENERALIZED_PATTERN',
  );
}

async function assertReferenceSet(
  client: PoolClient,
  sql: string,
  references: readonly string[],
  kind: string,
): Promise<void> {
  const expected = unique(references);
  if (expected.length === 0) return;
  const result = await client.query<QueryResultRow & { ref: string }>(sql, [expected]);
  const resolved = unique(result.rows.map((row) => row.ref));
  const missing = expected.filter((reference) => !resolved.includes(reference));
  if (missing.length > 0) {
    throw new Error(`CANDIDATE_LINEAGE_REFERENCE_UNRESOLVED:${kind}:${missing.join(',')}`);
  }
}

async function deadLetterExpiredExhausted(
  queryable: Pick<Pool, 'query'>,
  now: string,
): Promise<void> {
  await queryable.query(
    `UPDATE candidate_generation_run
     SET status='dead_letter',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
         last_error_code=COALESCE(
           last_error_code,'CANDIDATE_GENERATION_LEASE_ATTEMPTS_EXHAUSTED'
         ),
         last_error_summary=COALESCE(
           last_error_summary,'Worker lease expired after the terminal permitted attempt.'
         ),
         updated_at=$1
     WHERE status='leased' AND lease_expires_at <= $1 AND attempt >= max_attempts`,
    [now],
  );
}

function mapRun(row: CandidateGenerationRunRow): CandidateGenerationRun {
  const payload = row.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('CANDIDATE_GENERATION_RUN_PAYLOAD_INVALID');
  }
  return Object.freeze({
    runId: row.run_id,
    tenantId: row.tenant_id,
    sourcePatternRef: row.source_pattern_ref,
    ...(row.source_event_id === null ? {} : { sourceEventId: row.source_event_id }),
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    availableAt: timestamp(row.available_at),
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.lease_token === null ? {} : { leaseToken: row.lease_token }),
    ...(row.lease_expires_at === null ? {} : { leaseExpiresAt: timestamp(row.lease_expires_at) }),
    idempotencyKey: row.idempotency_key,
    payload: payload as CandidateGenerationRun['payload'],
    ...(row.result_artifact_ref === null ? {} : { resultArtifactRef: row.result_artifact_ref }),
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
    ...(row.last_error_summary === null ? {} : { lastErrorSummary: row.last_error_summary }),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  });
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function requiredRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('CANDIDATE_GENERATION_ROW_MISSING');
  return row;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function redactError(value: string): string {
  return value
    .replace(/(password|secret|token|authorization|credential)=[^\s]+/giu, '$1=[REDACTED]')
    .slice(0, 2_048);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
