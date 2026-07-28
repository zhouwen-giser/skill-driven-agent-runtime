import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import {
  ARTIFACT_REPLAY_VALIDATOR_VERSION,
  VALIDATION_METRIC_CATALOG_VERSION,
  type HistoricalReplayOutcome,
  type ReplayOperation,
  type ReplayDatasetBuild,
  type ReplayValidationCaseFixture,
  type ReplayValidationCompletion,
  type ReplayValidationRepository,
  type ReplayValidationRunRecord,
  type ReplayValidationSource,
  type ReplayValidationTrigger,
  type ReplayValidationWork,
} from '../../../application/src/index.js';
import {
  createArtifactReplayCase,
  createArtifactValidationResult,
  createReplayDatasetManifest,
  createUserGoalCompletionContract,
  validateUserGoalPlan,
  type ArtifactReplayCase,
  type CandidateStaticValidationResult,
  type ReplayDatasetManifest,
} from '../../../domain/src/index.js';
import { PostgresArtifactRepository } from './artifact-repositories.js';

const StringListSchema = z.array(z.string().min(1).max(512)).max(4_096);
const HistoricalSchema = z
  .object({
    succeeded: z.boolean(),
    evidenceRefs: StringListSchema,
    artifactRefs: StringListSchema,
    activityRefs: StringListSchema.optional(),
    modelCallCount: z.number().int().nonnegative(),
    tokenInput: z.number().int().nonnegative(),
    tokenOutput: z.number().int().nonnegative(),
    estimatedCostUnits: z.number().nonnegative(),
    humanInteractionCount: z.number().int().nonnegative(),
    fallbackCount: z.number().int().nonnegative(),
    userPatchCount: z.number().int().nonnegative(),
    planningLatencyMs: z.number().nonnegative(),
  })
  .strict();
const ReplayOperationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('snapshot_read'),
      snapshotRef: z.string().min(1).max(512),
    })
    .strict(),
  z
    .object({
      kind: z.enum([
        'credential_read',
        'network_request',
        'mcp_tool',
        'provider_task',
        'device_control',
        'external_write',
        'formal_notification',
        'formal_outcome_write',
        'formal_evidence_write',
        'active_pointer_write',
        'remote_task_control',
      ]),
      targetRef: z.string().min(1).max(512),
    })
    .strict(),
]);
const ReplaySnapshotSchema = z
  .object({
    goalContract: z.unknown(),
    parameterValues: z.record(z.string(), z.unknown()),
    knownCapabilityIds: StringListSchema,
    readyCapabilityIds: StringListSchema,
    authorityDecision: z.enum(['allow', 'deny', 'require_confirmation']),
    contextStatus: z.enum(['known', 'unknown', 'conflict']).optional(),
    policyOverride: z.enum(['allow', 'deny', 'require_confirmation']).optional(),
    historicalRiskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    historical: HistoricalSchema,
    acceptedPlan: z.unknown().optional(),
    worldState: z.unknown().optional(),
    syntheticSeedRef: z.string().min(1).max(512).optional(),
    counterexample: z.boolean().optional(),
    replayOperations: z.array(ReplayOperationSchema).max(4_096).optional(),
  })
  .strict();
const StoredFixtureSchema = z
  .object({
    sourceEpisodeRef: z.string().min(1).max(512),
    goalContract: z.unknown(),
    parameterValues: z.record(z.string(), z.unknown()),
    knownCapabilityIds: StringListSchema,
    readyCapabilityIds: StringListSchema,
    authorityDecision: z.enum(['allow', 'deny', 'require_confirmation']),
    contextStatus: z.enum(['known', 'unknown', 'conflict']).optional(),
    policyOverride: z.enum(['allow', 'deny', 'require_confirmation']).optional(),
    historicalRiskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    historical: HistoricalSchema,
    acceptedPlan: z.unknown().optional(),
    replayOperations: z.array(ReplayOperationSchema).max(4_096).optional(),
  })
  .strict();
const ReplayTraceSchema = z
  .object({
    tenantId: z.string().min(1).max(512),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1).max(512),
          eventType: z.string().min(1).max(128),
          activity: z
            .object({ activityKey: z.string().min(1).max(512) })
            .loose()
            .nullable()
            .optional(),
        })
        .loose(),
    ),
    outcomeStatus: z.enum(['succeeded', 'failed', 'partial', 'unknown']),
    environmentClass: z.string().min(1).max(512),
    deviceClass: z.string().min(1).max(512).optional(),
  })
  .loose();

interface TriggerRow extends QueryResultRow {
  event_id: string;
  artifact_id: string;
  artifact_version: number;
  artifact_hash: string;
  tenant_id: string;
  task_type_id: string;
  candidate_source_trace_refs: unknown;
  occurred_at: Date | string;
}

interface SourceRow extends QueryResultRow {
  trace_id: string;
  source_episode_id: string;
  tenant_id: string;
  user_scope_id: string | null;
  trace: unknown;
  episode_snapshot: unknown;
  episode_revision: number;
  goal_id: string;
  goal_version: number;
  episode_hash: string;
  episode_completeness: string | number;
  episode_created_at: Date | string;
}

interface RunRow extends QueryResultRow {
  validation_run_id: string;
  tenant_id: string;
  artifact_id: string;
  artifact_version: number;
  artifact_hash: string;
  dataset_ref: string;
  dataset_version: number;
  dataset_hash: string;
  work_state: ReplayValidationRunRecord['workState'];
  attempt: number;
  max_attempts: number;
  available_at: Date | string;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  cancel_requested_at: Date | string | null;
  idempotency_key: string;
  last_error_code: string | null;
  last_error_summary: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DatasetRow extends QueryResultRow {
  content: unknown;
  content_hash: string;
  promotion_eligible: boolean;
}

interface CaseRow extends QueryResultRow {
  replay_case_id: string;
  content: unknown;
  fixture: unknown;
}

interface StaticValidationRow extends QueryResultRow {
  artifact_ref: string;
  schema_valid: boolean;
  activity_identity_valid: boolean;
  dag_valid: boolean;
  parallel_semantics_valid: boolean;
  required_criteria_covered: boolean;
  capability_shape_valid: boolean;
  capability_catalog_aligned: boolean;
  parameter_policy_valid: boolean;
  parameter_schema_aligned: boolean;
  applicability_evaluable: boolean;
  lineage_complete: boolean;
  recovery_semantics_valid: boolean;
  side_effect_replay_safe: boolean;
  bounds_valid: boolean;
  duplicate_fingerprint: string | null;
  errors: unknown;
  warnings: unknown;
  validator_version: string;
  result: CandidateStaticValidationResult['result'];
}

export class PostgresArtifactReplayValidationRepository implements ReplayValidationRepository {
  constructor(private readonly pool: Pool) {}

  async listPendingTriggers(limit = 100): Promise<readonly ReplayValidationTrigger[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('ARTIFACT_REPLAY_TRIGGER_LIMIT_INVALID');
    }
    const result = await this.pool.query<TriggerRow>(
      `SELECT event.event_id,artifact.artifact_id,artifact.version AS artifact_version,
              artifact.content_hash AS artifact_hash,artifact.tenant_id,
              artifact.definition #>> '{artifact,scope,taskTypeIds,0}' AS task_type_id,
              ARRAY(
                SELECT source_ref
                FROM jsonb_array_elements_text(lineage.source_pattern_refs) source_ref
                WHERE EXISTS(
                  SELECT 1 FROM experience_trace trace WHERE trace.trace_id=source_ref
                )
                ORDER BY source_ref
              ) AS candidate_source_trace_refs,
              event.occurred_at
       FROM cognitive_runtime_outbox event
       JOIN compiled_artifact artifact
         ON artifact.artifact_id=event.aggregate_id
        AND artifact.version=event.aggregate_version
       JOIN artifact_lineage lineage ON lineage.lineage_id=artifact.lineage_id
       WHERE event.event_type='compiler.artifact_candidate_created'
         AND artifact.artifact_type='plan_template'
         AND artifact.status='candidate'
         AND artifact.tenant_id IS NOT NULL
         AND NOT EXISTS(
           SELECT 1 FROM artifact_replay_tenant_deletion deletion
           WHERE deletion.tenant_id=artifact.tenant_id
         )
         AND artifact.definition #>> '{artifact,scope,taskTypeIds,0}' IS NOT NULL
         AND NOT EXISTS(
           SELECT 1 FROM artifact_validation_run run WHERE run.source_event_id=event.event_id
         )
       ORDER BY event.occurred_at,event.event_id LIMIT $1`,
      [limit],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          triggerId: row.event_id,
          tenantId: row.tenant_id,
          artifactId: row.artifact_id,
          artifactVersion: row.artifact_version,
          artifactHash: row.artifact_hash,
          taskTypeId: row.task_type_id,
          candidateSourceTraceRefs: parseStringList(row.candidate_source_trace_refs),
          occurredAt: timestamp(row.occurred_at),
        }),
      ),
    );
  }

  async listSources(trigger: ReplayValidationTrigger): Promise<readonly ReplayValidationSource[]> {
    const result = await this.pool.query<SourceRow>(
      `SELECT trace.trace_id,source.source_episode_id,source.tenant_id,source.user_scope_id,
              trace.trace,episode.snapshot AS episode_snapshot,episode.revision AS episode_revision,
              episode.goal_id,episode.goal_version,episode.episode_hash,
              episode.completeness AS episode_completeness,
              episode.created_at AS episode_created_at
       FROM experience_trace trace
       JOIN experience_trace_source source ON source.trace_id=trace.trace_id
       JOIN goal_experience_episode episode ON episode.episode_id=source.source_episode_id
       WHERE source.tenant_id=$1
         AND trace.task_type_refs @> $2::jsonb
       ORDER BY episode.created_at,trace.trace_id
       LIMIT 100000`,
      [trigger.tenantId, JSON.stringify([trigger.taskTypeId])],
    );
    return Object.freeze(result.rows.map((row) => mapSource(row, trigger)));
  }

  async persistDatasetAndCreateRun(
    trigger: ReplayValidationTrigger,
    build: ReplayDatasetBuild,
    fixtures: Readonly<Record<string, ReplayValidationCaseFixture>>,
    now: string,
    maxAttempts = 5,
  ): Promise<ReplayValidationRunRecord> {
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 32) {
      throw new Error('ARTIFACT_REPLAY_MAX_ATTEMPTS_INVALID');
    }
    const holdout = build.manifests.promotion_holdout;
    const idempotencyKey = `artifact-replay:${trigger.artifactId}:v${String(trigger.artifactVersion)}:${holdout.contentHash}`;
    const validationRunId = stableId('artifact-validation-run', idempotencyKey);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const candidate = await client.query<{
        status: string;
        content_hash: string;
        tenant_id: string | null;
      }>(
        `SELECT status,content_hash,tenant_id FROM compiled_artifact
         WHERE artifact_id=$1 AND version=$2 FOR SHARE`,
        [trigger.artifactId, trigger.artifactVersion],
      );
      const artifact = candidate.rows[0];
      if (
        artifact?.status !== 'candidate' ||
        artifact.content_hash !== trigger.artifactHash ||
        artifact.tenant_id !== trigger.tenantId
      ) {
        throw new Error('ARTIFACT_REPLAY_STALE_CANDIDATE');
      }
      for (const replayCase of build.cases) {
        const fixture = fixtures[replayCase.replayCaseId];
        if (fixture === undefined) {
          throw new Error(`ARTIFACT_REPLAY_FIXTURE_MISSING:${replayCase.replayCaseId}`);
        }
        const sourceEpisodeId = replayCase.sourceEpisodeRefs[0];
        if (sourceEpisodeId === undefined) {
          throw new Error(`ARTIFACT_REPLAY_SOURCE_EPISODE_MISSING:${replayCase.replayCaseId}`);
        }
        const inserted = await client.query(
          `INSERT INTO artifact_replay_case(
             replay_case_id,tenant_id,task_type_id,primary_source_episode_id,content,fixture,
             content_hash,snapshot_completeness,retention_until,created_at)
           VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::timestamptz + interval '365 days',$9)
           ON CONFLICT(replay_case_id) DO NOTHING RETURNING replay_case_id`,
          [
            replayCase.replayCaseId,
            replayCase.tenantId,
            replayCase.taskTypeId,
            sourceEpisodeId,
            JSON.stringify(replayCase),
            JSON.stringify(fixture),
            replayCase.contentHash,
            replayCase.snapshotCompleteness,
            now,
          ],
        );
        if (inserted.rowCount !== 1) {
          const existing = await client.query<{ same: boolean }>(
            `SELECT content_hash=$2 AND tenant_id=$3 AND fixture=$4::jsonb AS same
             FROM artifact_replay_case WHERE replay_case_id=$1`,
            [
              replayCase.replayCaseId,
              replayCase.contentHash,
              replayCase.tenantId,
              JSON.stringify(fixture),
            ],
          );
          if (existing.rows[0]?.same !== true) {
            throw new Error('ARTIFACT_REPLAY_CASE_IMMUTABLE_CONFLICT');
          }
        }
      }
      for (const manifest of Object.values(build.manifests)) {
        const inserted = await client.query(
          `INSERT INTO replay_dataset_manifest(
             dataset_id,dataset_version,purpose,tenant_id,content,source_hash,content_hash,
             leakage_check_ref,created_at)
           VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
           ON CONFLICT(dataset_id,dataset_version) DO NOTHING RETURNING dataset_id`,
          [
            manifest.datasetId,
            manifest.datasetVersion,
            manifest.purpose,
            manifest.tenantId,
            JSON.stringify(manifest),
            manifest.sourceHash,
            manifest.contentHash,
            manifest.leakageCheckRef,
            manifest.createdAt,
          ],
        );
        if (inserted.rowCount !== 1) {
          const existing = await client.query<{ same: boolean }>(
            `SELECT content_hash=$3 AND tenant_id=$4 AS same
             FROM replay_dataset_manifest WHERE dataset_id=$1 AND dataset_version=$2`,
            [manifest.datasetId, manifest.datasetVersion, manifest.contentHash, manifest.tenantId],
          );
          if (existing.rows[0]?.same !== true) {
            throw new Error('REPLAY_DATASET_IMMUTABLE_CONFLICT');
          }
        }
        for (const [ordinal, replayCaseId] of manifest.caseRefs.entries()) {
          await client.query(
            `INSERT INTO replay_dataset_case(
               dataset_id,dataset_version,replay_case_id,ordinal)
             VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [manifest.datasetId, manifest.datasetVersion, replayCaseId, ordinal],
          );
        }
      }
      const run = await client.query<RunRow>(
        `INSERT INTO artifact_validation_run(
           validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,
           result,metrics,counterexample_refs,started_at,completed_at,tenant_id,dataset_version,
           artifact_hash,dataset_hash,validator_version,metric_catalog_version,result_hash,
           result_payload,work_state,attempt,max_attempts,available_at,lease_owner,lease_token,
           lease_expires_at,cancel_requested_at,idempotency_key,source_event_id,last_error_code,
           last_error_summary,created_at,updated_at)
         VALUES($1,$2,$3,'replay',$4,'pending',NULL,'{}'::jsonb,'[]'::jsonb,$5,NULL,$6,$7,
           $8,$9,$10,$11,NULL,NULL,'pending',0,$12,$5,NULL,NULL,NULL,NULL,$13,$14,NULL,NULL,$5,$5)
         ON CONFLICT(idempotency_key) DO UPDATE
         SET idempotency_key=EXCLUDED.idempotency_key
         RETURNING *`,
        [
          validationRunId,
          trigger.artifactId,
          trigger.artifactVersion,
          holdout.datasetId,
          now,
          trigger.tenantId,
          holdout.datasetVersion,
          trigger.artifactHash,
          holdout.contentHash,
          ARTIFACT_REPLAY_VALIDATOR_VERSION,
          VALIDATION_METRIC_CATALOG_VERSION,
          maxAttempts,
          idempotencyKey,
          trigger.triggerId,
        ],
      );
      await client.query('COMMIT');
      return mapRun(requiredRow(run.rows[0]));
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claim(
    workerId: string,
    now: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly ReplayValidationRunRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await terminalizeCanceled(client, now);
      await deadLetterExpiredExhausted(client, now);
      const selected = await client.query<RunRow>(
        `SELECT * FROM artifact_validation_run
         WHERE validation_type='replay' AND promotion_eligible=true
           AND cancel_requested_at IS NULL
           AND attempt < max_attempts
           AND (
             (work_state IN ('pending','retry_wait') AND available_at <= $1)
             OR (work_state='leased' AND lease_expires_at <= $1)
           )
         ORDER BY available_at,validation_run_id
         LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [now, limit],
      );
      const claimed: ReplayValidationRunRecord[] = [];
      for (const row of selected.rows) {
        const leaseToken = randomUUID();
        const updated = await client.query<RunRow>(
          `UPDATE artifact_validation_run
           SET status='running',work_state='leased',attempt=attempt+1,lease_owner=$2,
               lease_token=$3,lease_expires_at=$4,updated_at=$5
           WHERE validation_run_id=$1 RETURNING *`,
          [
            row.validation_run_id,
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

  async loadWork(run: ReplayValidationRunRecord): Promise<ReplayValidationWork | undefined> {
    const [artifact, datasetResult, caseResult, staticResult] = await Promise.all([
      new PostgresArtifactRepository(this.pool).getDefinition({
        artifactId: run.artifactId,
        version: run.artifactVersion,
      }),
      this.pool.query<DatasetRow>(
        `SELECT content,content_hash,promotion_eligible FROM replay_dataset_manifest
         WHERE dataset_id=$1 AND dataset_version=$2`,
        [run.datasetId, run.datasetVersion],
      ),
      this.pool.query<CaseRow>(
        `SELECT replay.replay_case_id,replay.content,replay.fixture
         FROM replay_dataset_case member
         JOIN artifact_replay_case replay ON replay.replay_case_id=member.replay_case_id
         WHERE member.dataset_id=$1 AND member.dataset_version=$2
         ORDER BY member.ordinal`,
        [run.datasetId, run.datasetVersion],
      ),
      this.pool.query<StaticValidationRow>(
        `SELECT * FROM candidate_static_validation
         WHERE artifact_ref=$1 ORDER BY created_at DESC,validation_id DESC LIMIT 1`,
        [run.artifactId],
      ),
    ]);
    const datasetRow = datasetResult.rows[0];
    const staticRow = staticResult.rows[0];
    if (artifact === undefined || datasetRow === undefined || staticRow === undefined) {
      return undefined;
    }
    if (
      artifact.status !== 'candidate' ||
      artifact.contentHash !== run.artifactHash ||
      datasetRow.content_hash !== run.datasetHash ||
      datasetRow.promotion_eligible !== true
    ) {
      throw new Error('ARTIFACT_REPLAY_VALIDATION_STALE_PIN');
    }
    const dataset = createReplayDatasetManifest(datasetRow.content as ReplayDatasetManifest);
    const cases = caseResult.rows.map((row) =>
      createArtifactReplayCase(row.content as ArtifactReplayCase),
    );
    const fixtures = Object.fromEntries(
      caseResult.rows.map((row) => [row.replay_case_id, parseFixture(row.fixture)]),
    );
    return Object.freeze({
      artifact,
      staticValidation: mapStaticValidation(staticRow),
      dataset,
      cases: Object.freeze(cases),
      fixtures: Object.freeze(fixtures),
    });
  }

  async completeAtomically(
    run: ReplayValidationRunRecord,
    workerId: string,
    leaseToken: string,
    completion: ReplayValidationCompletion,
    now: string,
  ): Promise<boolean> {
    const result = createArtifactValidationResult(completion.validationResult);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<RunRow>(
        `SELECT * FROM artifact_validation_run
         WHERE validation_run_id=$1 FOR UPDATE`,
        [run.validationRunId],
      );
      const current = locked.rows[0];
      if (
        current?.work_state !== 'leased' ||
        current.lease_owner !== workerId ||
        current.lease_token !== leaseToken ||
        current.cancel_requested_at !== null
      ) {
        await client.query('ROLLBACK');
        return false;
      }
      const pins = await client.query<{
        artifact_hash: string;
        artifact_status: string;
        dataset_hash: string;
        dataset_version: number;
        dataset_promotion_eligible: boolean;
      }>(
        `SELECT artifact.content_hash AS artifact_hash,artifact.status AS artifact_status,
                dataset.content_hash AS dataset_hash,dataset.dataset_version,
                dataset.promotion_eligible AS dataset_promotion_eligible
         FROM compiled_artifact artifact
         JOIN replay_dataset_manifest dataset
           ON dataset.dataset_id=$3 AND dataset.dataset_version=$4
         WHERE artifact.artifact_id=$1 AND artifact.version=$2 FOR SHARE OF artifact,dataset`,
        [run.artifactId, run.artifactVersion, run.datasetId, run.datasetVersion],
      );
      const pin = pins.rows[0];
      if (
        pin?.artifact_status !== 'candidate' ||
        pin.artifact_hash !== run.artifactHash ||
        pin.dataset_hash !== run.datasetHash ||
        pin.dataset_version !== run.datasetVersion ||
        pin.dataset_promotion_eligible !== true ||
        result.artifactHash !== run.artifactHash ||
        result.datasetHash !== run.datasetHash
      ) {
        throw new Error('ARTIFACT_REPLAY_VALIDATION_STALE_PIN');
      }
      for (const evaluation of completion.caseEvaluations) {
        await client.query(
          `INSERT INTO artifact_replay_case_result(
             validation_run_id,replay_case_id,evaluation,metrics,result_hash,created_at)
           VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6)
           ON CONFLICT(validation_run_id,replay_case_id) DO NOTHING`,
          [
            run.validationRunId,
            evaluation.replayCaseRef,
            JSON.stringify(evaluation),
            JSON.stringify(evaluation.metrics),
            hash(evaluation),
            now,
          ],
        );
      }
      for (const failure of completion.failures) {
        await client.query(
          `INSERT INTO artifact_validation_failure(
             failure_id,validation_run_id,replay_case_id,category,severity,content,created_at)
           VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(failure_id) DO NOTHING`,
          [
            failure.failureId,
            run.validationRunId,
            failure.replayCaseRef,
            failure.category,
            failure.severity,
            JSON.stringify(failure),
            now,
          ],
        );
      }
      for (const counterexample of completion.counterexamples) {
        await client.query(
          `INSERT INTO artifact_counterexample(
             counterexample_id,artifact_id,artifact_version,replay_case_id,failure_id,
             validation_run_id,content,condition_fingerprint,status,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
           ON CONFLICT(counterexample_id) DO NOTHING`,
          [
            counterexample.counterexampleId,
            run.artifactId,
            run.artifactVersion,
            counterexample.replayCaseRef,
            counterexample.failureRef,
            run.validationRunId,
            JSON.stringify(counterexample),
            counterexample.conditionFingerprint,
            counterexample.status,
            counterexample.createdAt,
          ],
        );
      }
      const completed = await client.query(
        `UPDATE artifact_validation_run
         SET status=$4,result=$5,metrics=$6::jsonb,counterexample_refs=$7::jsonb,
             completed_at=$8,result_hash=$9,result_payload=$10::jsonb,work_state='completed',
             lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=$8
         WHERE validation_run_id=$1 AND work_state='leased'
           AND lease_owner=$2 AND lease_token=$3`,
        [
          run.validationRunId,
          workerId,
          leaseToken,
          result.result === 'passed' ? 'passed' : 'failed',
          result.result,
          JSON.stringify(result.metrics),
          JSON.stringify(result.counterexampleRefs),
          now,
          result.resultHash,
          JSON.stringify(result),
        ],
      );
      if (completed.rowCount !== 1) {
        throw new Error('ARTIFACT_REPLAY_VALIDATION_FENCE_REJECTED');
      }
      await writeOutbox(client, {
        eventId: `artifact-validation-completed-${run.validationRunId}`,
        eventType: 'artifact.validation_completed',
        aggregateId: run.validationRunId,
        occurredAt: now,
        payload: {
          validationRunId: run.validationRunId,
          artifactId: run.artifactId,
          artifactVersion: run.artifactVersion,
          artifactHash: run.artifactHash,
          datasetId: run.datasetId,
          datasetVersion: run.datasetVersion,
          datasetHash: run.datasetHash,
          result: result.result,
          resultHash: result.resultHash,
        },
      });
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
    failureCode: string,
    failureSummary: string,
    now: string,
    retryAt?: string,
  ): Promise<boolean> {
    const canceled = failureCode === 'ARTIFACT_REPLAY_VALIDATION_CANCELED';
    const terminal = retryAt === undefined;
    const result = await this.pool.query(
      `UPDATE artifact_validation_run
       SET status=$4,work_state=$5,available_at=$6,last_error_code=$7,last_error_summary=$8,
           result=$9,completed_at=$10,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
           updated_at=$11
       WHERE validation_run_id=$1 AND work_state='leased'
         AND lease_owner=$2 AND lease_token=$3`,
      [
        runId,
        workerId,
        leaseToken,
        terminal ? 'failed' : 'pending',
        terminal ? (canceled ? 'canceled' : 'dead_letter') : 'retry_wait',
        retryAt ?? now,
        failureCode.slice(0, 128),
        redactError(failureSummary),
        terminal ? failureCode : null,
        terminal ? now : null,
        now,
      ],
    );
    return result.rowCount === 1;
  }

  async listRequeueable(now: string, limit = 100): Promise<readonly ReplayValidationRunRecord[]> {
    await terminalizeCanceled(this.pool, now);
    await deadLetterExpiredExhausted(this.pool, now);
    const result = await this.pool.query<RunRow>(
      `SELECT * FROM artifact_validation_run
       WHERE validation_type='replay' AND promotion_eligible=true
         AND cancel_requested_at IS NULL
         AND attempt < max_attempts
         AND (
           (work_state IN ('pending','retry_wait') AND available_at <= $1)
           OR (work_state='leased' AND lease_expires_at <= $1)
         )
       ORDER BY available_at,validation_run_id LIMIT $2`,
      [now, limit],
    );
    return Object.freeze(result.rows.map(mapRun));
  }

  async requestCancellation(runId: string, now: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE artifact_validation_run
       SET cancel_requested_at=$2,
           status=CASE WHEN work_state IN ('pending','retry_wait') THEN 'failed' ELSE status END,
           work_state=CASE
             WHEN work_state IN ('pending','retry_wait') THEN 'canceled' ELSE work_state
           END,
           result=CASE
             WHEN work_state IN ('pending','retry_wait')
             THEN 'ARTIFACT_REPLAY_VALIDATION_CANCELED' ELSE result
           END,
           completed_at=CASE
             WHEN work_state IN ('pending','retry_wait') THEN $2 ELSE completed_at
           END,
           updated_at=$2
       WHERE validation_run_id=$1
         AND validation_type='replay'
         AND work_state IN ('pending','retry_wait','leased')`,
      [runId, now],
    );
    return result.rowCount === 1;
  }

  async purgeTenant(tenantId: string): Promise<number> {
    const client = await this.pool.connect();
    const now = new Date().toISOString();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO artifact_replay_tenant_deletion(tenant_id,deleted_at)
         VALUES($1,$2) ON CONFLICT(tenant_id) DO NOTHING`,
        [tenantId, now],
      );
      const selected = await client.query<{ replay_case_id: string }>(
        `SELECT replay_case_id FROM artifact_replay_case
         WHERE tenant_id=$1 ORDER BY replay_case_id FOR UPDATE`,
        [tenantId],
      );
      const replayCaseIds = selected.rows.map((row) => row.replay_case_id);
      await invalidateDatasetsForCases(client, replayCaseIds, now, 'tenant_source_deleted');
      const result =
        replayCaseIds.length === 0
          ? { rowCount: 0 }
          : await client.query(
              'DELETE FROM artifact_replay_case WHERE replay_case_id=ANY($1::text[])',
              [replayCaseIds],
            );
      await client.query('COMMIT');
      return result.rowCount ?? 0;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async purgeExpired(now: string, limit = 1_000): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new Error('ARTIFACT_REPLAY_RETENTION_LIMIT_INVALID');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<{ replay_case_id: string }>(
        `SELECT replay_case_id FROM artifact_replay_case
         WHERE retention_until IS NOT NULL AND retention_until <= $1
         ORDER BY retention_until,replay_case_id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [now, limit],
      );
      const replayCaseIds = selected.rows.map((row) => row.replay_case_id);
      await invalidateDatasetsForCases(client, replayCaseIds, now, 'retention_expired');
      const result =
        replayCaseIds.length === 0
          ? { rowCount: 0 }
          : await client.query(
              'DELETE FROM artifact_replay_case WHERE replay_case_id=ANY($1::text[])',
              [replayCaseIds],
            );
      await client.query('COMMIT');
      return result.rowCount ?? 0;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

interface InvalidationDatasetRow extends QueryResultRow {
  dataset_id: string;
  dataset_version: number;
  purpose: ReplayDatasetManifest['purpose'];
  tenant_id: string;
  content: unknown;
}

async function invalidateDatasetsForCases(
  client: PoolClient,
  replayCaseIds: readonly string[],
  now: string,
  reason: string,
): Promise<void> {
  if (replayCaseIds.length === 0) return;
  const affected = await client.query<InvalidationDatasetRow>(
    `SELECT manifest.dataset_id,manifest.dataset_version,manifest.purpose,
            manifest.tenant_id,manifest.content
     FROM replay_dataset_manifest manifest
     WHERE manifest.promotion_eligible=true
       AND EXISTS(
         SELECT 1 FROM replay_dataset_case member
         WHERE member.dataset_id=manifest.dataset_id
           AND member.dataset_version=manifest.dataset_version
           AND member.replay_case_id=ANY($1::text[])
       )
     ORDER BY manifest.dataset_id,manifest.dataset_version
     FOR UPDATE`,
    [replayCaseIds],
  );
  for (const row of affected.rows) {
    const current = createReplayDatasetManifest(row.content as ReplayDatasetManifest);
    const remaining = await client.query<{
      replay_case_id: string;
      content_hash: string;
    }>(
      `SELECT member.replay_case_id,replay.content_hash
       FROM replay_dataset_case member
       JOIN artifact_replay_case replay ON replay.replay_case_id=member.replay_case_id
       WHERE member.dataset_id=$1 AND member.dataset_version=$2
         AND NOT(member.replay_case_id=ANY($3::text[]))
       ORDER BY member.ordinal`,
      [row.dataset_id, row.dataset_version, replayCaseIds],
    );
    const nextVersionResult = await client.query<{ next_version: number }>(
      `SELECT COALESCE(MAX(dataset_version),0)::integer + 1 AS next_version
       FROM replay_dataset_manifest WHERE dataset_id=$1`,
      [row.dataset_id],
    );
    const nextVersion = requiredRow(nextVersionResult.rows[0]).next_version;
    const caseRefs = remaining.rows.map((item) => item.replay_case_id);
    const sourceHash = hash(
      remaining.rows.map((item) => ({
        replayCaseId: item.replay_case_id,
        contentHash: item.content_hash,
      })),
    );
    const manifestIdentity = {
      datasetVersion: nextVersion,
      purpose: current.purpose,
      tenantId: current.tenantId,
      taskTypeIds: current.taskTypeIds,
      caseRefs,
      splitPolicyVersion: current.splitPolicyVersion,
      sourceRange: current.sourceRange,
      sourceHash,
      leakageCheckRef: stableId(
        'replay-leakage',
        `${row.dataset_id}:${String(nextVersion)}:${sourceHash}`,
      ),
      createdAt: now,
    };
    const successor = createReplayDatasetManifest({
      datasetId: row.dataset_id,
      ...manifestIdentity,
      contentHash: hash(manifestIdentity),
    });
    await client.query(
      `INSERT INTO replay_dataset_manifest(
         dataset_id,dataset_version,purpose,tenant_id,content,source_hash,content_hash,
         leakage_check_ref,promotion_eligible,invalidated_at,invalidation_reason,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,false,$9,$10,$9)`,
      [
        successor.datasetId,
        successor.datasetVersion,
        successor.purpose,
        successor.tenantId,
        JSON.stringify(successor),
        successor.sourceHash,
        successor.contentHash,
        successor.leakageCheckRef,
        now,
        `${reason}:requires_resplit`,
      ],
    );
    for (const [ordinal, replayCaseId] of successor.caseRefs.entries()) {
      await client.query(
        `INSERT INTO replay_dataset_case(dataset_id,dataset_version,replay_case_id,ordinal)
         VALUES($1,$2,$3,$4)`,
        [successor.datasetId, successor.datasetVersion, replayCaseId, ordinal],
      );
    }
    await client.query(
      `UPDATE replay_dataset_manifest
       SET promotion_eligible=false,invalidated_at=$3,invalidation_reason=$4,
           successor_dataset_id=$1,successor_dataset_version=$5
       WHERE dataset_id=$1 AND dataset_version=$2`,
      [row.dataset_id, row.dataset_version, now, reason, nextVersion],
    );
    await client.query(
      `UPDATE artifact_validation_run
       SET promotion_eligible=false,
           source_invalidated_at=COALESCE(source_invalidated_at,$3),
           source_invalidation_reason=COALESCE(source_invalidation_reason,$4),
           status=CASE
             WHEN work_state IN ('pending','retry_wait','leased') THEN 'failed' ELSE status
           END,
           work_state=CASE
             WHEN work_state IN ('pending','retry_wait','leased') THEN 'canceled' ELSE work_state
           END,
           result=CASE
             WHEN work_state IN ('pending','retry_wait','leased')
               THEN 'ARTIFACT_REPLAY_SOURCE_INVALIDATED'
             ELSE result
           END,
           completed_at=CASE
             WHEN work_state IN ('pending','retry_wait','leased') THEN $3 ELSE completed_at
           END,
           lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=$3
       WHERE dataset_ref=$1 AND dataset_version=$2`,
      [row.dataset_id, row.dataset_version, now, reason],
    );
  }
}

function mapSource(row: SourceRow, trigger: ReplayValidationTrigger): ReplayValidationSource {
  const snapshot = record(row.episode_snapshot, 'ARTIFACT_REPLAY_EPISODE_SNAPSHOT_INVALID');
  const trace = ReplayTraceSchema.parse(row.trace);
  if (trace.tenantId !== trigger.tenantId) {
    throw new Error('ARTIFACT_REPLAY_TRACE_SCOPE_INVALID');
  }
  const replayInput = replaySnapshotFromEpisode(snapshot, trace);
  const replay = replayInput.snapshot;
  const contract = createUserGoalCompletionContract(
    replay.goalContract as UserGoalCompletionContractInput,
  );
  const acceptedPlan =
    replay.acceptedPlan === undefined
      ? undefined
      : validateUserGoalPlan(contract, replay.acceptedPlan);
  const historical: HistoricalReplayOutcome = Object.freeze({
    ...replay.historical,
    activityRefs: Object.freeze(
      replay.historical.activityRefs ??
        trace.events
          .flatMap((event) => (event.activity === null ? [] : [event.activity?.activityKey]))
          .filter((value): value is string => value !== undefined),
    ),
  });
  const task = record(snapshot['task'], 'ARTIFACT_REPLAY_TASK_SNAPSHOT_INVALID');
  const requestFingerprint = hash({
    requestText: task['requestText'],
    taskTypeId: trigger.taskTypeId,
  });
  const source: ReplayValidationSource['source'] = Object.freeze({
    tenantId: trigger.tenantId,
    sourceEpisodeRef: row.source_episode_id,
    sourceEpisodeRevisionRef: `${row.source_episode_id}:v${String(row.episode_revision)}`,
    goalLineageHash: hash({ goalId: row.goal_id, goalVersion: row.goal_version }),
    requestSnapshotRef: `${row.source_episode_id}:snapshot:task`,
    requestFingerprint,
    nearDuplicateFingerprint: hash(normalizedText(task['requestText'])),
    ...(replayInput.refs.goalContract === undefined
      ? {}
      : {
          goalContractSnapshotRef: `${row.source_episode_id}:snapshot:${replayInput.refs.goalContract}`,
        }),
    ...(replayInput.refs.capabilityCatalog === undefined
      ? {}
      : {
          capabilityCatalogSnapshotRef: `${row.source_episode_id}:snapshot:${replayInput.refs.capabilityCatalog}`,
        }),
    ...(replayInput.refs.worldState === undefined
      ? {}
      : {
          worldStateSnapshotRef: `${row.source_episode_id}:snapshot:${replayInput.refs.worldState}`,
        }),
    ...(replayInput.refs.policy === undefined
      ? {}
      : {
          policySnapshotRef: `${row.source_episode_id}:snapshot:${replayInput.refs.policy}`,
        }),
    ...(replayInput.refs.readiness === undefined
      ? {}
      : {
          readinessSnapshotRef: `${row.source_episode_id}:snapshot:${replayInput.refs.readiness}`,
        }),
    ...(acceptedPlan === undefined || replayInput.refs.acceptedPlan === undefined
      ? {}
      : {
          acceptedPlanSnapshotRef: `${row.source_episode_id}:snapshot:${replayInput.refs.acceptedPlan}`,
          acceptedPlanRevisionRef: `${acceptedPlan.planId}:r${String(acceptedPlan.revision)}`,
        }),
    executionTraceSnapshotRef: `${row.trace_id}:snapshot`,
    outcomeSnapshotRef: `${row.source_episode_id}:snapshot:terminalOutcome`,
    correctionRefs: Object.freeze(
      trace.events
        .filter((event) => event.eventType === 'plan_revised')
        .map((event) => event.eventId),
    ),
    environmentClass: trace.environmentClass,
    ...(trace.deviceClass === undefined ? {} : { deviceClass: trace.deviceClass }),
    taskTypeId: trigger.taskTypeId,
    sourceTraceRefs: [row.trace_id],
    ...(replay.syntheticSeedRef === undefined ? {} : { syntheticSeedRef: replay.syntheticSeedRef }),
    counterexample:
      (replay.counterexample ?? false) ||
      !replay.historical.succeeded ||
      trace.outcomeStatus === 'failed',
    occurredAt: timestamp(row.episode_created_at),
  });
  const fixture: ReplayValidationCaseFixture = Object.freeze({
    sourceEpisodeRef: row.source_episode_id,
    goalContract: contract,
    parameterValues: Object.freeze({ ...replay.parameterValues }),
    knownCapabilityIds: Object.freeze([...new Set(replay.knownCapabilityIds)].sort()),
    readyCapabilityIds: Object.freeze([...new Set(replay.readyCapabilityIds)].sort()),
    authorityDecision: replay.authorityDecision,
    ...(replay.contextStatus === undefined ? {} : { contextStatus: replay.contextStatus }),
    ...(replay.policyOverride === undefined ? {} : { policyOverride: replay.policyOverride }),
    ...(replay.historicalRiskLevel === undefined
      ? {}
      : { historicalRiskLevel: replay.historicalRiskLevel }),
    historical,
    ...(acceptedPlan === undefined ? {} : { acceptedPlan }),
    ...(replay.replayOperations === undefined
      ? {}
      : { replayOperations: Object.freeze([...replay.replayOperations]) }),
  });
  return Object.freeze({ source, fixture });
}

function replaySnapshotFromEpisode(
  episode: Readonly<Record<string, unknown>>,
  trace: z.infer<typeof ReplayTraceSchema>,
): Readonly<{
  snapshot: z.infer<typeof ReplaySnapshotSchema>;
  refs: Readonly<{
    goalContract?: string;
    capabilityCatalog?: string;
    worldState?: string;
    policy?: string;
    readiness?: string;
    acceptedPlan?: string;
  }>;
}> {
  if (episode['replayValidation'] !== undefined) {
    const snapshot = ReplaySnapshotSchema.parse(episode['replayValidation']);
    return Object.freeze({
      snapshot,
      refs: Object.freeze({
        goalContract: 'replayValidation.goalContract',
        capabilityCatalog: 'replayValidation.knownCapabilityIds',
        ...(snapshot.worldState === undefined ? {} : { worldState: 'replayValidation.worldState' }),
        policy: 'replayValidation.authorityDecision',
        readiness: 'replayValidation.readyCapabilityIds',
        ...(snapshot.acceptedPlan === undefined
          ? {}
          : { acceptedPlan: 'replayValidation.acceptedPlan' }),
      }),
    });
  }

  const contractEnvelope = record(
    episode['contract'],
    'ARTIFACT_REPLAY_NATIVE_GOAL_CONTRACT_MISSING',
  );
  const goalContract = contractEnvelope['contract'];
  if (goalContract === undefined) {
    throw new Error('ARTIFACT_REPLAY_NATIVE_GOAL_CONTRACT_MISSING');
  }
  const planRevisions = recordList(episode['planRevisions']);
  const currentPlan = optionalRecord(episode['currentPlan']) ?? planRevisions.at(-1);
  const acceptedPlan = currentPlan?.['plan'];
  const plan =
    acceptedPlan === undefined
      ? undefined
      : record(acceptedPlan, 'ARTIFACT_REPLAY_NATIVE_ACCEPTED_PLAN_INVALID');
  const skillGoals = recordList(plan?.['skillGoals']);
  const attempts = recordList(episode['attempts']);
  const recovery = recordList(episode['recovery']);
  const capabilityCatalog = optionalRecord(episode['capabilityCatalogSnapshot']);
  const policyDecision = optionalRecord(episode['policyDecisionSnapshot']);
  const worldState = episode['worldStateSnapshot'];
  const catalogKnown = stringListValue(capabilityCatalog?.['knownCapabilityIds']);
  const catalogReady = stringListValue(capabilityCatalog?.['readyCapabilityIds']);
  const authorityDecision = policyDecision?.['authorityDecision'];
  const policyAvailable =
    typeof authorityDecision === 'string' &&
    ['allow', 'deny', 'require_confirmation'].includes(authorityDecision);
  const contextStatus = policyDecision?.['contextStatus'];
  const validContextStatus =
    typeof contextStatus === 'string' && ['known', 'unknown', 'conflict'].includes(contextStatus);
  const policyOverride = policyDecision?.['policyOverride'];
  const validPolicyOverride =
    typeof policyOverride === 'string' &&
    ['allow', 'deny', 'require_confirmation'].includes(policyOverride);
  const historicalRiskLevel = policyDecision?.['historicalRiskLevel'];
  const validHistoricalRiskLevel =
    typeof historicalRiskLevel === 'string' &&
    ['low', 'medium', 'high', 'critical'].includes(historicalRiskLevel);
  const successfulAttemptStatuses = new Set(['completed', 'achieved', 'succeeded']);
  const successfulSkillGoalIds = new Set(
    attempts.flatMap((attempt) =>
      successfulAttemptStatuses.has(stringValue(attempt['status']))
        ? stringListValue(attempt['skill_goal_id'] ?? attempt['skillGoalId'])
        : [],
    ),
  );
  const successfulCapabilityIds = new Set(
    attempts.flatMap((attempt) =>
      successfulAttemptStatuses.has(stringValue(attempt['status']))
        ? stringListValue(attempt['capability_refs'])
        : [],
    ),
  );
  const knownCapabilityIds = uniqueSorted(catalogKnown);
  const readyCapabilityIds = uniqueSorted(catalogReady);
  const parameterValues: Record<string, unknown> = {};
  for (const attempt of attempts) {
    const attemptPayload = optionalRecord(attempt['attempt_json']);
    const resolvedInput =
      optionalRecord(attempt['resolved_input']) ??
      optionalRecord(attempt['resolvedInput']) ??
      optionalRecord(attemptPayload?.['resolvedInput']);
    if (resolvedInput !== undefined) Object.assign(parameterValues, resolvedInput);
  }

  const terminal = optionalRecord(episode['terminalOutcome']);
  const judgment = optionalRecord(episode['userGoalJudgment']);
  const terminalStatus = stringValue(
    terminal?.['controlStatus'] ?? terminal?.['kind'] ?? judgment?.['status'],
  );
  const succeeded =
    terminalStatus.length > 0
      ? ['achieved', 'completed', 'succeeded'].includes(terminalStatus)
      : trace.outcomeStatus === 'succeeded';
  const achievedGoals = skillGoals.filter(
    (goal) =>
      successfulSkillGoalIds.has(stringValue(goal['skillGoalId'])) ||
      stringListValue(goal['capabilityNeeds']).some((capabilityId) =>
        successfulCapabilityIds.has(capabilityId),
      ),
  );
  const progress = recordList(episode['progress']);
  const interactions = recordList(episode['interactions']);
  const task = optionalRecord(episode['task']);
  const planCreatedAt = stringValue(currentPlan?.['createdAt'] ?? currentPlan?.['created_at']);
  const taskCreatedAt = stringValue(task?.['createdAt'] ?? task?.['created_at']);
  const planningLatencyMs =
    Number.isFinite(Date.parse(planCreatedAt)) && Number.isFinite(Date.parse(taskCreatedAt))
      ? Math.max(0, Date.parse(planCreatedAt) - Date.parse(taskCreatedAt))
      : 0;
  const replayOperations = [
    ...operationList(episode['replayOperations']),
    ...attempts.flatMap((attempt) => [
      ...operationList(attempt['replay_operations']),
      ...operationList(attempt['replayOperations']),
      ...operationList(optionalRecord(attempt['attempt_json'])?.['replayOperations']),
    ]),
  ];
  const snapshot = ReplaySnapshotSchema.parse({
    goalContract,
    parameterValues,
    knownCapabilityIds,
    readyCapabilityIds,
    authorityDecision: policyAvailable ? authorityDecision : 'deny',
    ...(validContextStatus ? { contextStatus } : {}),
    ...(validPolicyOverride ? { policyOverride } : {}),
    ...(validHistoricalRiskLevel ? { historicalRiskLevel } : {}),
    historical: {
      succeeded,
      evidenceRefs: uniqueSorted([
        ...achievedGoals.flatMap((goal) => stringListValue(goal['evidenceRequirements'])),
        ...progress.flatMap((item) =>
          stringListValue(item['evidence_refs'] ?? item['evidenceRefs']),
        ),
      ]),
      artifactRefs: uniqueSorted([
        ...achievedGoals.flatMap((goal) => stringListValue(goal['artifactRequirements'])),
        ...attempts.flatMap((attempt) =>
          stringListValue(
            attempt['artifact_refs'] ??
              attempt['artifactRefs'] ??
              optionalRecord(attempt['attempt_json'])?.['artifactRefs'],
          ),
        ),
      ]),
      activityRefs: uniqueSorted(
        trace.events.flatMap((event) =>
          event.activity?.activityKey === undefined ? [] : [event.activity.activityKey],
        ),
      ),
      modelCallCount: sumNumbers(interactions, ['modelCallCount', 'model_call_count']),
      tokenInput: sumNumbers(interactions, ['tokenInput', 'token_input']),
      tokenOutput: sumNumbers(interactions, ['tokenOutput', 'token_output']),
      estimatedCostUnits: sumNumbers(interactions, ['estimatedCostUnits', 'estimated_cost_units']),
      humanInteractionCount: interactions.length,
      fallbackCount: recovery.length,
      userPatchCount: Math.max(0, planRevisions.length - 1),
      planningLatencyMs,
    },
    ...(acceptedPlan === undefined ? {} : { acceptedPlan }),
    ...(worldState === undefined ? {} : { worldState }),
    counterexample: !succeeded || trace.outcomeStatus === 'failed',
    ...(replayOperations.length === 0 ? {} : { replayOperations }),
  });
  return Object.freeze({
    snapshot,
    refs: Object.freeze({
      goalContract: 'contract.contract',
      ...(capabilityCatalog === undefined || !Array.isArray(capabilityCatalog['knownCapabilityIds'])
        ? {}
        : { capabilityCatalog: 'capabilityCatalogSnapshot.knownCapabilityIds' }),
      ...(worldState === undefined ? {} : { worldState: 'worldStateSnapshot' }),
      ...(policyAvailable ? { policy: 'policyDecisionSnapshot.authorityDecision' } : {}),
      ...(capabilityCatalog === undefined || !Array.isArray(capabilityCatalog['readyCapabilityIds'])
        ? {}
        : { readiness: 'capabilityCatalogSnapshot.readyCapabilityIds' }),
      ...(acceptedPlan === undefined ? {} : { acceptedPlan: 'currentPlan.plan' }),
    }),
  });
}

type UserGoalCompletionContractInput = Parameters<typeof createUserGoalCompletionContract>[0];

function parseFixture(value: unknown): ReplayValidationCaseFixture {
  const fixture = StoredFixtureSchema.parse(value);
  const contract = createUserGoalCompletionContract(
    fixture.goalContract as UserGoalCompletionContractInput,
  );
  const acceptedPlan =
    fixture.acceptedPlan === undefined
      ? undefined
      : validateUserGoalPlan(contract, fixture.acceptedPlan);
  return Object.freeze({
    sourceEpisodeRef: fixture.sourceEpisodeRef,
    goalContract: contract,
    parameterValues: Object.freeze({ ...fixture.parameterValues }),
    knownCapabilityIds: Object.freeze([...new Set(fixture.knownCapabilityIds)].sort()),
    readyCapabilityIds: Object.freeze([...new Set(fixture.readyCapabilityIds)].sort()),
    authorityDecision: fixture.authorityDecision,
    ...(fixture.contextStatus === undefined ? {} : { contextStatus: fixture.contextStatus }),
    ...(fixture.policyOverride === undefined ? {} : { policyOverride: fixture.policyOverride }),
    ...(fixture.historicalRiskLevel === undefined
      ? {}
      : { historicalRiskLevel: fixture.historicalRiskLevel }),
    historical: Object.freeze({
      ...fixture.historical,
      activityRefs: Object.freeze(fixture.historical.activityRefs ?? []),
    }),
    ...(acceptedPlan === undefined ? {} : { acceptedPlan }),
    ...(fixture.replayOperations === undefined
      ? {}
      : { replayOperations: Object.freeze([...fixture.replayOperations]) }),
  });
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function recordList(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = optionalRecord(item);
        return parsed === undefined ? [] : [parsed];
      })
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringListValue(value: unknown): readonly string[] {
  if (typeof value === 'string') return value.length === 0 ? [] : [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function operationList(value: unknown): readonly ReplayOperation[] {
  return value === undefined ? [] : ReplayOperationSchema.array().parse(value);
}

function sumNumbers(
  values: readonly Readonly<Record<string, unknown>>[],
  keys: readonly string[],
): number {
  return values.reduce((sum, value) => {
    const item = keys.map((key) => value[key]).find((candidate) => typeof candidate === 'number');
    return sum + (typeof item === 'number' && Number.isFinite(item) && item >= 0 ? item : 0);
  }, 0);
}

function mapStaticValidation(row: StaticValidationRow): CandidateStaticValidationResult {
  return Object.freeze({
    artifactRef: row.artifact_ref,
    schemaValid: row.schema_valid,
    activityIdentityValid: row.activity_identity_valid,
    dagValid: row.dag_valid,
    parallelSemanticsValid: row.parallel_semantics_valid,
    requiredCriteriaCovered: row.required_criteria_covered,
    capabilityShapeValid: row.capability_shape_valid,
    capabilityCatalogAligned: row.capability_catalog_aligned,
    parameterPolicyValid: row.parameter_policy_valid,
    parameterSchemaAligned: row.parameter_schema_aligned,
    applicabilityEvaluable: row.applicability_evaluable,
    lineageComplete: row.lineage_complete,
    recoverySemanticsValid: row.recovery_semantics_valid,
    sideEffectReplaySafe: row.side_effect_replay_safe,
    boundsValid: row.bounds_valid,
    ...(row.duplicate_fingerprint === null
      ? {}
      : { duplicateFingerprint: row.duplicate_fingerprint }),
    errors: parseIssues(row.errors),
    warnings: parseIssues(row.warnings),
    validatorVersion: row.validator_version,
    result: row.result,
  });
}

function mapRun(row: RunRow): ReplayValidationRunRecord {
  return Object.freeze({
    validationRunId: row.validation_run_id,
    tenantId: row.tenant_id,
    artifactId: row.artifact_id,
    artifactVersion: row.artifact_version,
    artifactHash: row.artifact_hash,
    datasetId: row.dataset_ref,
    datasetVersion: row.dataset_version,
    datasetHash: row.dataset_hash,
    workState: row.work_state,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    availableAt: timestamp(row.available_at),
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.lease_token === null ? {} : { leaseToken: row.lease_token }),
    ...(row.lease_expires_at === null ? {} : { leaseExpiresAt: timestamp(row.lease_expires_at) }),
    ...(row.cancel_requested_at === null
      ? {}
      : { cancelRequestedAt: timestamp(row.cancel_requested_at) }),
    idempotencyKey: row.idempotency_key,
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
    ...(row.last_error_summary === null ? {} : { lastErrorSummary: row.last_error_summary }),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  });
}

async function terminalizeCanceled(
  queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  now: string,
): Promise<void> {
  await queryable.query(
    `UPDATE artifact_validation_run
     SET status='failed',work_state='canceled',result='ARTIFACT_REPLAY_VALIDATION_CANCELED',
         completed_at=$1,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=$1
     WHERE validation_type='replay' AND cancel_requested_at IS NOT NULL
       AND work_state IN ('pending','retry_wait')
        OR (
          validation_type='replay' AND cancel_requested_at IS NOT NULL
          AND work_state='leased' AND lease_expires_at <= $1
        )`,
    [now],
  );
}

async function deadLetterExpiredExhausted(
  queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  now: string,
): Promise<void> {
  await queryable.query(
    `UPDATE artifact_validation_run
     SET status='failed',work_state='dead_letter',
         result='ARTIFACT_REPLAY_VALIDATION_LEASE_ATTEMPTS_EXHAUSTED',
         completed_at=$1,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
         last_error_code=COALESCE(
           last_error_code,'ARTIFACT_REPLAY_VALIDATION_LEASE_ATTEMPTS_EXHAUSTED'
         ),
         last_error_summary=COALESCE(
           last_error_summary,'Worker lease expired after the terminal permitted attempt.'
         ),
         updated_at=$1
     WHERE validation_type='replay' AND work_state='leased'
       AND lease_expires_at <= $1 AND attempt >= max_attempts`,
    [now],
  );
}

async function writeOutbox(
  client: PoolClient,
  event: Readonly<{
    eventId: string;
    eventType: string;
    aggregateId: string;
    occurredAt: string;
    payload: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
  const payload = JSON.stringify(event.payload);
  const inserted = await client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       correlation,payload,occurred_at,published_at)
     VALUES($1,$2,'artifact_validation_run',$3,1,'{}'::jsonb,$4::jsonb,$5,NULL)
     ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
    [event.eventId, event.eventType, event.aggregateId, payload, event.occurredAt],
  );
  if (inserted.rowCount === 1) return;
  const existing = await client.query<{ same: boolean }>(
    `SELECT event_type=$2 AND aggregate_type='artifact_validation_run'
       AND aggregate_id=$3 AND aggregate_version=1 AND payload=$4::jsonb
       AND occurred_at=$5::timestamptz AS same
     FROM cognitive_runtime_outbox WHERE event_id=$1`,
    [event.eventId, event.eventType, event.aggregateId, payload, event.occurredAt],
  );
  if (existing.rows[0]?.same !== true) {
    throw new Error('ARTIFACT_REPLAY_OUTBOX_IDEMPOTENCY_CONFLICT');
  }
}

function parseIssues(value: unknown): CandidateStaticValidationResult['errors'] {
  const parsed = z
    .array(
      z
        .object({
          code: z.string(),
          message: z.string(),
          path: z.string().optional(),
        })
        .strict(),
    )
    .parse(value);
  return Object.freeze(
    parsed.map((issue) =>
      Object.freeze({
        code: issue.code,
        message: issue.message,
        ...(issue.path === undefined ? {} : { path: issue.path }),
      }),
    ),
  );
}

function parseStringList(value: unknown): readonly string[] {
  return Object.freeze(StringListSchema.parse(value));
}

function record(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Readonly<Record<string, unknown>>;
}

function normalizedText(value: unknown): string {
  return typeof value === 'string'
    ? value.toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim()
    : canonicalJson(value);
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function redactError(value: string): string {
  return value
    .replace(/(password|secret|token|authorization|credential)=[^\s]+/giu, '$1=[REDACTED]')
    .slice(0, 2_048);
}

function requiredRow<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('ARTIFACT_REPLAY_ROW_MISSING');
  return value;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
