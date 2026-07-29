import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  createArtifactActivationRecord,
  createArtifactApprovalRecord,
  createArtifactCounterexample,
  createArtifactPromotionPackage,
  createArtifactRevalidationTrigger,
  createArtifactShadowResult,
  createArtifactShadowRun,
  createArtifactValidationResult,
  hashArtifactApprovalRecord,
  hashCanonical,
  createCompiledArtifact,
  type ArtifactActivationRecord,
  type ArtifactApprovalRecord,
  type ArtifactCounterexample,
  type ArtifactPromotionPackage,
  type ArtifactRevalidationTrigger,
  type ArtifactShadowResult,
  type ArtifactValidationResult,
  type CompiledArtifact,
} from '../../../domain/src/index.js';
import {
  type ArtifactShadowEnrollment,
  type ArtifactPromotionEvidenceAssessment,
  type PromotionCoverage,
  type ArtifactShadowRepository,
  type ArtifactShadowRunRecord,
  type ArtifactShadowWork,
  type ShadowCompletion,
  type ShadowProjectionSnapshot,
} from '../../../application/src/index.js';

interface ShadowRunRow extends QueryResultRow {
  shadow_run_id: string;
  artifact_id: string;
  artifact_version: number;
  artifact_ref: string;
  artifact_hash: string;
  tenant_id: string | null;
  formal_request_ref: string;
  formal_goal_ref: string | null;
  formal_plan_ref: string | null;
  formal_goal_version: number | null;
  formal_plan_version: number | null;
  status: ArtifactShadowRunRecord['status'];
  shadow_mode: ArtifactShadowRunRecord['shadowMode'];
  policy_snapshot_hash: string;
  capability_catalog_hash: string;
  work_state: ArtifactShadowRunRecord['workState'];
  attempt: number;
  max_attempts: number;
  available_at: Date | string;
  expires_at: Date | string;
  idempotency_key: string;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  last_error_code: string | null;
  last_error_summary: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  formal_projection: unknown;
  candidate_projection: unknown;
  declared_operations: unknown;
  current_policy_snapshot_hash: string;
  current_capability_catalog_hash: string;
  current_formal_goal_version: number | null;
  current_formal_plan_version: number | null;
  formal_outcome_ref: string | null;
}

interface ArtifactRow extends QueryResultRow {
  artifact_id: string;
  artifact_key: string;
  version: number;
  tenant_id: string | null;
  artifact_status: string;
  content_hash: string;
  definition: unknown;
  applicability: unknown;
  dependency_snapshot: unknown;
  lineage_id: string;
  validation_summary_id: string | null;
  artifact_type: CompiledArtifact['artifactType'];
  domain: string;
  risk_level: CompiledArtifact['riskLevel'];
  created_at: Date | string;
}

interface ShadowWorkRow extends ShadowRunRow, ArtifactRow {
  formal_projection: unknown;
  candidate_projection: unknown;
  declared_operations: unknown;
  current_policy_snapshot_hash: string;
  current_capability_catalog_hash: string;
  current_formal_goal_version: number | null;
  current_formal_plan_version: number | null;
  formal_outcome_ref: string | null;
}

interface ShadowResultRow extends QueryResultRow {
  shadow_run_id: string;
  artifact_ref: string;
  shadow_decision_ref: string | null;
  shadow_plan_ref: string | null;
  formal_plan_ref: string | null;
  formal_outcome_ref: string | null;
  comparison: unknown;
  policy_violation: boolean;
  unsafe_attempt: boolean;
  stale: boolean;
  result_hash: string;
  evaluator_version: string;
  completed_at: Date | string;
  formal_goal_ref?: string | null;
  formal_projection?: unknown;
}

/**
 * P06 child projections. Every authoritative artifact status, active pointer,
 * approval, audit, and outbox mutation remains in the P02 tables and transaction.
 */
export class PostgresArtifactShadowGovernanceRepository implements ArtifactShadowRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async enqueue(input: ArtifactShadowEnrollment): Promise<ArtifactShadowRunRecord> {
    return inTransaction(this.#pool, async (client) => {
      const formalProjection = input.formalProjection ?? emptyProjection();
      const declaredOperations = input.declaredOperations ?? [];
      const currentPolicySnapshotHash = input.currentPolicySnapshotHash ?? input.policySnapshotHash;
      const currentCapabilityCatalogHash =
        input.currentCapabilityCatalogHash ?? input.capabilityCatalogHash;
      const currentFormalGoalVersion =
        input.currentFormalGoalVersion ?? input.formalGoalVersion ?? null;
      const currentFormalPlanVersion =
        input.currentFormalPlanVersion ?? input.formalPlanVersion ?? null;
      const artifact = await selectArtifact(client, input.artifactId, input.artifactVersion, false);
      if (artifact.content_hash !== input.artifactHash)
        throw coded('ARTIFACT_SHADOW_STALE_ARTIFACT');
      if (input.tenantId !== undefined && input.tenantId !== artifact.tenant_id) {
        throw coded('ARTIFACT_TENANT_SCOPE_DENIED');
      }
      const candidateProjection = compileCandidateProjection(mapArtifact(artifact));
      if (input.maximumQueueDepth !== undefined) {
        const depth = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM artifact_shadow_run
           WHERE work_state IN ('pending','leased','retry_wait') AND expires_at > $1`,
          [input.createdAt],
        );
        if (Number(depth.rows[0]?.count ?? 0) >= input.maximumQueueDepth) {
          throw coded('ARTIFACT_SHADOW_BACKPRESSURE');
        }
      }
      await client.query(
        `INSERT INTO artifact_validation_run(
           validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,
           result,metrics,counterexample_refs,started_at,completed_at,work_state,attempt,
           max_attempts,available_at,idempotency_key,created_at,updated_at)
         VALUES($1,$2,$3,'shadow',$4,'pending',NULL,'{}'::jsonb,'[]'::jsonb,$5,NULL,
           'pending',0,1,$5,$6,$5,$5)
         ON CONFLICT(validation_run_id) DO NOTHING`,
        [
          input.shadowRunId,
          input.artifactId,
          input.artifactVersion,
          `shadow:${input.formalRequestRef}`,
          input.createdAt,
          `shadow:${input.idempotencyKey}`,
        ],
      );
      const validationParent = await client.query<{
        artifact_id: string;
        artifact_version: number;
        validation_type: string;
        dataset_ref: string;
        idempotency_key: string | null;
      }>(
        `SELECT artifact_id,artifact_version,validation_type,dataset_ref,idempotency_key
         FROM artifact_validation_run WHERE validation_run_id=$1 FOR SHARE`,
        [input.shadowRunId],
      );
      const parent = required(validationParent.rows[0], 'ARTIFACT_SHADOW_PARENT_MISSING');
      if (
        parent.artifact_id !== input.artifactId ||
        parent.artifact_version !== input.artifactVersion ||
        parent.validation_type !== 'shadow' ||
        parent.dataset_ref !== `shadow:${input.formalRequestRef}` ||
        parent.idempotency_key !== `shadow:${input.idempotencyKey}`
      ) {
        throw coded('ARTIFACT_SHADOW_IDEMPOTENCY_CONFLICT');
      }
      const inserted = await client.query<ShadowRunRow>(
        `INSERT INTO artifact_shadow_run(
           shadow_run_id,artifact_id,artifact_version,artifact_ref,artifact_hash,tenant_id,
           formal_request_ref,formal_goal_ref,formal_plan_ref,formal_goal_version,formal_plan_version,
           shadow_mode,policy_snapshot_hash,capability_catalog_hash,status,work_state,attempt,
           max_attempts,available_at,expires_at,idempotency_key,formal_projection,candidate_projection,
           declared_operations,current_policy_snapshot_hash,current_capability_catalog_hash,
           current_formal_goal_version,current_formal_plan_version,formal_outcome_ref,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'queued','pending',0,1,$15,$16,
           $17,$18::jsonb,$19::jsonb,$20::jsonb,$21,$22,$23,$24,$25,$15,$15)
         ON CONFLICT(artifact_id,artifact_version,idempotency_key) DO NOTHING
         RETURNING *`,
        [
          input.shadowRunId,
          input.artifactId,
          input.artifactVersion,
          input.artifactRef,
          input.artifactHash,
          input.tenantId ?? null,
          input.formalRequestRef,
          input.formalGoalRef ?? null,
          input.formalPlanRef ?? null,
          input.formalGoalVersion ?? null,
          input.formalPlanVersion ?? null,
          input.shadowMode,
          input.policySnapshotHash,
          input.capabilityCatalogHash,
          input.createdAt,
          input.expiresAt,
          input.idempotencyKey,
          JSON.stringify(formalProjection),
          JSON.stringify(candidateProjection),
          JSON.stringify(declaredOperations),
          currentPolicySnapshotHash,
          currentCapabilityCatalogHash,
          currentFormalGoalVersion,
          currentFormalPlanVersion,
          input.formalOutcomeRef ?? null,
        ],
      );
      const row =
        inserted.rows[0] ??
        required(
          (
            await client.query<ShadowRunRow>(
              `SELECT * FROM artifact_shadow_run
               WHERE artifact_id=$1 AND artifact_version=$2 AND idempotency_key=$3 FOR SHARE`,
              [input.artifactId, input.artifactVersion, input.idempotencyKey],
            )
          ).rows[0],
          'ARTIFACT_SHADOW_RUN_MISSING',
        );
      assertSameShadowEnrollment(row, {
        input,
        formalProjection,
        candidateProjection,
        declaredOperations,
        currentPolicySnapshotHash,
        currentCapabilityCatalogHash,
        currentFormalGoalVersion,
        currentFormalPlanVersion,
      });
      await writeOutbox(client, {
        eventId: `artifact-shadow-started-${row.shadow_run_id}`,
        eventType: 'artifact.shadow_started',
        aggregateType: 'artifact_shadow_run',
        aggregateId: row.shadow_run_id,
        aggregateVersion: 1,
        occurredAt: input.createdAt,
        payload: {
          shadowRunId: row.shadow_run_id,
          artifactId: row.artifact_id,
          artifactVersion: row.artifact_version,
          formalRequestRef: row.formal_request_ref,
        },
      });
      return mapShadowRun(row);
    });
  }

  async claim(
    workerId: string,
    now: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly ArtifactShadowRunRecord[]> {
    return inTransaction(this.#pool, async (client) => {
      await client.query(
        `WITH expired AS (
           UPDATE artifact_shadow_run
           SET work_state='discarded_stale',status='discarded_stale',updated_at=$1,
               last_error_code='ARTIFACT_SHADOW_TTL_EXPIRED'
           WHERE work_state IN ('pending','retry_wait') AND expires_at <= $1
           RETURNING shadow_run_id
         )
         UPDATE artifact_validation_run parent
         SET status='failed',work_state='completed',result='ARTIFACT_SHADOW_TTL_EXPIRED',
             completed_at=$1,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=$1
         FROM expired WHERE parent.validation_run_id=expired.shadow_run_id`,
        [now],
      );
      const claimed = await client.query<ShadowRunRow>(
        `WITH candidates AS (
           SELECT shadow_run_id FROM artifact_shadow_run
           WHERE work_state IN ('pending','retry_wait') AND available_at <= $1 AND expires_at > $1
           ORDER BY available_at,shadow_run_id FOR UPDATE SKIP LOCKED LIMIT $2
         )
         UPDATE artifact_shadow_run run SET
           work_state='leased',status='running',attempt=attempt+1,lease_owner=$3,
           lease_token=md5(run.shadow_run_id || ':' || $3 || ':' || $1::text || ':' || random()::text),
           lease_expires_at=$1::timestamptz + ($4::bigint * interval '1 millisecond'),updated_at=$1
         FROM candidates WHERE run.shadow_run_id=candidates.shadow_run_id RETURNING run.*`,
        [now, Math.max(1, Math.min(limit, 10)), workerId, leaseMs],
      );
      for (const row of claimed.rows) {
        await client.query(
          `UPDATE artifact_validation_run SET status='running',work_state='leased',attempt=$2,
             lease_owner=$3,lease_token=$4,lease_expires_at=$5,updated_at=$6
           WHERE validation_run_id=$1`,
          [
            row.shadow_run_id,
            row.attempt,
            row.lease_owner,
            row.lease_token,
            row.lease_expires_at,
            now,
          ],
        );
      }
      return Object.freeze(claimed.rows.map(mapShadowRun));
    });
  }

  async loadWork(run: ArtifactShadowRunRecord): Promise<ArtifactShadowWork | undefined> {
    const result = await this.#pool.query<ShadowWorkRow>(
      `SELECT run.*,artifact.artifact_key,artifact.status AS artifact_status,artifact.content_hash,artifact.definition,artifact.applicability,
         artifact.dependency_snapshot,artifact.lineage_id,artifact.validation_summary_id,artifact.artifact_type,artifact.domain,
         artifact.risk_level,artifact.created_at
       FROM artifact_shadow_run run
       JOIN compiled_artifact artifact
         ON artifact.artifact_id=run.artifact_id AND artifact.version=run.artifact_version
       WHERE run.shadow_run_id=$1`,
      [run.shadowRunId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return Object.freeze({
      run: mapShadowRun(row),
      artifact: mapArtifact(row),
      formal: projection(row.formal_projection),
      candidate: projection(row.candidate_projection),
      ...(row.formal_outcome_ref === null ? {} : { formalOutcomeRef: row.formal_outcome_ref }),
      declaredOperations: stringList(row.declared_operations),
      currentPolicySnapshotHash: row.current_policy_snapshot_hash,
      currentCapabilityCatalogHash: row.current_capability_catalog_hash,
      ...(row.current_formal_goal_version === null
        ? {}
        : { currentFormalGoalVersion: row.current_formal_goal_version }),
      ...(row.current_formal_plan_version === null
        ? {}
        : { currentFormalPlanVersion: row.current_formal_plan_version }),
    });
  }

  async complete(
    run: ArtifactShadowRunRecord,
    workerId: string,
    leaseToken: string,
    completion: ShadowCompletion,
    now: string,
  ): Promise<boolean> {
    return inTransaction(this.#pool, async (client) => {
      const shadow = createArtifactShadowResult(completion.result);
      const updated = await client.query(
        `UPDATE artifact_shadow_run SET
           work_state=$4,status=$5,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
           updated_at=$6
         WHERE shadow_run_id=$1 AND work_state='leased' AND lease_owner=$2 AND lease_token=$3`,
        [
          run.shadowRunId,
          workerId,
          leaseToken,
          completion.stale ? 'discarded_stale' : 'completed',
          completion.stale ? 'discarded_stale' : 'completed',
          now,
        ],
      );
      if (updated.rowCount !== 1) return false;
      await client.query(
        `UPDATE artifact_validation_run SET status=$2,work_state='completed',result=$3,
           metrics=$4::jsonb,completed_at=$5,lease_owner=NULL,lease_token=NULL,
           lease_expires_at=NULL,updated_at=$5
         WHERE validation_run_id=$1`,
        [
          run.shadowRunId,
          completion.stale || completion.unsafe ? 'failed' : 'passed',
          completion.stale
            ? 'ARTIFACT_SHADOW_STALE'
            : completion.unsafe
              ? 'ARTIFACT_SHADOW_UNSAFE'
              : 'ARTIFACT_SHADOW_COMPLETED',
          JSON.stringify(shadow.comparison),
          now,
        ],
      );
      await client.query(
        `INSERT INTO artifact_shadow_result(
           shadow_run_id,artifact_ref,shadow_decision_ref,shadow_plan_ref,formal_plan_ref,
           formal_outcome_ref,comparison,policy_violation,unsafe_attempt,stale,result_hash,
           evaluator_version,completed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)
         ON CONFLICT(shadow_run_id) DO NOTHING`,
        [
          shadow.shadowRunRef,
          shadow.artifactRef,
          shadow.shadowDecisionRef ?? null,
          shadow.shadowPlanRef ?? null,
          shadow.formalPlanRef ?? null,
          shadow.formalOutcomeRef ?? null,
          JSON.stringify(shadow.comparison),
          shadow.policyViolation,
          shadow.unsafeAttempt,
          shadow.stale,
          shadow.resultHash,
          shadow.evaluatorVersion,
          shadow.completedAt,
        ],
      );
      if (completion.unsafe) {
        await createSafetyTrigger(client, run, now);
      }
      await writeOutbox(client, {
        eventId: `artifact-shadow-completed-${run.shadowRunId}`,
        eventType: 'artifact.shadow_completed',
        aggregateType: 'artifact_shadow_run',
        aggregateId: run.shadowRunId,
        aggregateVersion: 2,
        occurredAt: now,
        payload: {
          shadowRunId: run.shadowRunId,
          artifactId: run.artifactId,
          artifactVersion: run.artifactVersion,
          stale: completion.stale,
          unsafeAttempt: completion.unsafe,
        },
      });
      return true;
    });
  }

  async discardStale(
    run: ArtifactShadowRunRecord,
    workerId: string,
    leaseToken: string,
    reasonCode: string,
    now: string,
  ): Promise<boolean> {
    return inTransaction(this.#pool, async (client) => {
      const changed = await client.query(
        `UPDATE artifact_shadow_run SET work_state='discarded_stale',status='discarded_stale',
           lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code=$4,updated_at=$5
         WHERE shadow_run_id=$1 AND work_state='leased' AND lease_owner=$2 AND lease_token=$3`,
        [run.shadowRunId, workerId, leaseToken, reasonCode, now],
      );
      if (changed.rowCount !== 1) return false;
      await client.query(
        `UPDATE artifact_validation_run SET status='failed',work_state='completed',result=$2,
           completed_at=$3,updated_at=$3 WHERE validation_run_id=$1`,
        [run.shadowRunId, reasonCode, now],
      );
      return true;
    });
  }

  async fail(
    run: ArtifactShadowRunRecord,
    workerId: string,
    leaseToken: string,
    errorCode: string,
    errorSummary: string,
    now: string,
    retryAt?: string,
  ): Promise<boolean> {
    const terminal = run.attempt >= run.maxAttempts || retryAt === undefined;
    return inTransaction(this.#pool, async (client) => {
      const result = await client.query(
        `UPDATE artifact_shadow_run SET
         work_state=$4,status=$5,available_at=COALESCE($6::timestamptz,available_at),
         lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code=$7,
         last_error_summary=$8,updated_at=$9
       WHERE shadow_run_id=$1 AND work_state='leased' AND lease_owner=$2 AND lease_token=$3`,
        [
          run.shadowRunId,
          workerId,
          leaseToken,
          terminal ? 'failed' : 'retry_wait',
          terminal ? 'failed' : 'queued',
          retryAt ?? null,
          errorCode,
          errorSummary.slice(0, 2048),
          now,
        ],
      );
      if (result.rowCount !== 1) return false;
      await client.query(
        `UPDATE artifact_validation_run SET status=$2,work_state=$3,
           available_at=COALESCE($4::timestamptz,available_at),last_error_code=$5,
           last_error_summary=$6,result=$7,completed_at=$8,lease_owner=NULL,lease_token=NULL,
           lease_expires_at=NULL,updated_at=$9
         WHERE validation_run_id=$1`,
        [
          run.shadowRunId,
          terminal ? 'failed' : 'pending',
          terminal ? 'dead_letter' : 'retry_wait',
          retryAt ?? null,
          errorCode,
          errorSummary.slice(0, 2048),
          terminal ? errorCode : null,
          terminal ? now : null,
          now,
        ],
      );
      return true;
    });
  }

  async listRequeueable(now: string, limit = 100): Promise<readonly ArtifactShadowRunRecord[]> {
    const result = await this.#pool.query<ShadowRunRow>(
      `SELECT * FROM artifact_shadow_run
       WHERE work_state IN ('pending','retry_wait') AND available_at <= $1 AND expires_at > $1
       ORDER BY available_at,shadow_run_id LIMIT $2`,
      [now, Math.max(1, Math.min(limit, 500))],
    );
    return Object.freeze(result.rows.map(mapShadowRun));
  }

  async createPromotionPackage(
    input: ArtifactPromotionPackage,
    assessment: ArtifactPromotionEvidenceAssessment,
  ): Promise<ArtifactPromotionPackage> {
    const value = createArtifactPromotionPackage(input);
    const { contentHash, ...packageContent } = value;
    if (contentHash !== hashCanonical(packageContent)) {
      throw coded('ARTIFACT_PROMOTION_CONTENT_HASH_INVALID');
    }
    return inTransaction(this.#pool, async (client) => {
      const [artifactId, artifactVersion] = artifactRef(value.artifactRef);
      const artifact = await selectArtifact(client, artifactId, artifactVersion, true);
      if (artifact.content_hash !== value.artifactHash)
        throw coded('ARTIFACT_PROMOTION_ARTIFACT_HASH_MISMATCH');
      const dependencyHash = hashCanonical(record(artifact.dependency_snapshot));
      if (dependencyHash !== value.dependencySnapshotHash) {
        throw coded('ARTIFACT_PROMOTION_DEPENDENCY_HASH_MISMATCH');
      }
      const validation = await client.query<{ result_hash: string | null; status: string }>(
        `SELECT result_hash,status FROM artifact_validation_run
         WHERE validation_run_id=$1 AND artifact_id=$2 AND artifact_version=$3`,
        [value.validationSummaryRef, artifactId, artifactVersion],
      );
      const validationRow = required(
        validation.rows[0],
        'ARTIFACT_PROMOTION_VALIDATION_EVIDENCE_INVALID',
      );
      if (
        validationRow.status !== 'passed' ||
        validationRow.result_hash !== value.validationSummaryHash
      ) {
        throw coded('ARTIFACT_PROMOTION_VALIDATION_EVIDENCE_INVALID');
      }
      const [shadowRows, counterexampleRows] = await Promise.all([
        client.query<ShadowResultRow>(
          `SELECT result.* FROM artifact_shadow_result result
           JOIN artifact_shadow_run run ON run.shadow_run_id=result.shadow_run_id
           WHERE run.artifact_id=$1 AND run.artifact_version=$2 AND result.stale=false
           ORDER BY result.completed_at,result.shadow_run_id`,
          [artifactId, artifactVersion],
        ),
        client.query<{ content: unknown }>(
          `SELECT content FROM artifact_counterexample
           WHERE artifact_id=$1 AND artifact_version=$2 ORDER BY created_at,counterexample_id`,
          [artifactId, artifactVersion],
        ),
      ]);
      const shadowSummaryHash = hashCanonical(shadowRows.rows.map(mapShadowResult));
      const counterexampleSummaryHash = hashCanonical(
        counterexampleRows.rows.map((row) =>
          createArtifactCounterexample(record(row.content) as unknown as ArtifactCounterexample),
        ),
      );
      if (
        value.shadowSummaryHash !== shadowSummaryHash ||
        value.counterexampleSummaryHash !== counterexampleSummaryHash
      ) {
        throw coded('ARTIFACT_PROMOTION_EVIDENCE_HASH_MISMATCH');
      }
      const expectedRiskReviewHash = hashCanonical({
        promotionPolicyVersion: value.promotionPolicyVersion,
        validationSummaryHash: value.validationSummaryHash,
        shadowSummaryHash,
        counterexampleSummaryHash,
        coverage: assessment.coverage,
        eligibility: value.eligibility,
        reasonCodes: assessment.reasonCodes,
      });
      const expectedEvidenceHash = hashCanonical({
        validationSummaryHash: value.validationSummaryHash,
        shadowSummaryHash,
        counterexampleSummaryHash,
        riskReviewHash: value.riskReviewHash,
      });
      if (
        value.riskReviewHash !== expectedRiskReviewHash ||
        assessment.evidenceHash !== expectedEvidenceHash
      ) {
        throw coded('ARTIFACT_PROMOTION_ASSESSMENT_HASH_MISMATCH');
      }
      const persistedPolicy = await client.query<{ promotion_policy_version: string }>(
        `INSERT INTO artifact_promotion_policy(
           promotion_policy_version,policy_hash,definition,created_at,created_by)
         VALUES($1,$2,$3::jsonb,$4,'system:artifact-promotion-policy')
         ON CONFLICT(promotion_policy_version) DO UPDATE
         SET promotion_policy_version=EXCLUDED.promotion_policy_version
         WHERE artifact_promotion_policy.policy_hash=EXCLUDED.policy_hash
           AND artifact_promotion_policy.definition=EXCLUDED.definition
         RETURNING promotion_policy_version`,
        [
          value.promotionPolicyVersion,
          hashCanonical(assessment.policy),
          JSON.stringify(assessment.policy),
          value.createdAt,
        ],
      );
      if (persistedPolicy.rowCount !== 1) {
        throw coded('ARTIFACT_PROMOTION_POLICY_VERSION_CONFLICT');
      }
      const inserted = await client.query<{ promotion_package_id: string }>(
        `INSERT INTO artifact_promotion_package(
           promotion_package_id,artifact_id,artifact_version,artifact_ref,artifact_hash,
           validation_summary_ref,validation_summary_hash,shadow_summary_ref,shadow_summary_hash,
           counterexample_summary_ref,counterexample_summary_hash,risk_review_ref,risk_review_hash,
           dependency_snapshot_ref,dependency_snapshot_hash,promotion_policy_version,eligibility,
           content_hash,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT(artifact_id,artifact_version,content_hash) DO NOTHING
         RETURNING promotion_package_id`,
        [
          value.promotionPackageId,
          artifactId,
          artifactVersion,
          value.artifactRef,
          value.artifactHash,
          value.validationSummaryRef,
          value.validationSummaryHash,
          value.shadowSummaryRef,
          value.shadowSummaryHash,
          value.counterexampleSummaryRef,
          value.counterexampleSummaryHash,
          value.riskReviewRef,
          value.riskReviewHash,
          value.dependencySnapshotRef,
          value.dependencySnapshotHash,
          value.promotionPolicyVersion,
          value.eligibility,
          value.contentHash,
          value.createdAt,
        ],
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query<{ promotion_package_id: string }>(
          `SELECT promotion_package_id FROM artifact_promotion_package
           WHERE artifact_id=$1 AND artifact_version=$2 AND content_hash=$3 FOR SHARE`,
          [artifactId, artifactVersion, value.contentHash],
        );
        if (existing.rows[0]?.promotion_package_id !== value.promotionPackageId) {
          throw coded('ARTIFACT_PROMOTION_IDEMPOTENCY_CONFLICT');
        }
      }
      const persistedAssessment = await client.query<{ promotion_package_id: string }>(
        `INSERT INTO artifact_promotion_assessment(
           promotion_package_id,coverage,reason_codes,evidence_hash,risk_review_hash,created_at)
         VALUES($1,$2::jsonb,$3::jsonb,$4,$5,$6)
         ON CONFLICT(promotion_package_id) DO UPDATE
         SET promotion_package_id=EXCLUDED.promotion_package_id
         WHERE artifact_promotion_assessment.coverage=EXCLUDED.coverage
           AND artifact_promotion_assessment.reason_codes=EXCLUDED.reason_codes
           AND artifact_promotion_assessment.evidence_hash=EXCLUDED.evidence_hash
           AND artifact_promotion_assessment.risk_review_hash=EXCLUDED.risk_review_hash
         RETURNING promotion_package_id`,
        [
          value.promotionPackageId,
          JSON.stringify(assessment.coverage),
          JSON.stringify(assessment.reasonCodes),
          assessment.evidenceHash,
          value.riskReviewHash,
          value.createdAt,
        ],
      );
      if (persistedAssessment.rowCount !== 1) {
        throw coded('ARTIFACT_PROMOTION_ASSESSMENT_IDEMPOTENCY_CONFLICT');
      }
      if (value.eligibility === 'eligible_for_review') {
        const changed = await client.query(
          `UPDATE compiled_artifact SET status='awaiting_approval'
           WHERE artifact_id=$1 AND version=$2 AND status IN ('candidate','validating')`,
          [artifactId, artifactVersion],
        );
        if (changed.rowCount === 0 && artifact.artifact_status !== 'awaiting_approval') {
          throw coded('ARTIFACT_PROMOTION_STATE_INVALID');
        }
        await writeOutbox(client, {
          eventId: `artifact-promotion-ready-${value.promotionPackageId}`,
          eventType: 'artifact.promotion_ready',
          aggregateType: 'artifact_promotion_package',
          aggregateId: value.promotionPackageId,
          aggregateVersion: 1,
          occurredAt: value.createdAt,
          payload: {
            promotionPackageId: value.promotionPackageId,
            artifactId,
            artifactVersion,
            contentHash: value.contentHash,
          },
        });
      }
      return value;
    });
  }

  async listPromotionEvidence(
    input: Readonly<{ artifactId: string; artifactVersion: number }>,
  ): Promise<
    | Readonly<{
        validationResult: ArtifactValidationResult;
        counterexamples: readonly ArtifactCounterexample[];
        shadowRuns: readonly ArtifactShadowResult[];
        artifact: CompiledArtifact;
        coverage: PromotionCoverage;
      }>
    | undefined
  > {
    const artifact = await selectArtifact(
      this.#pool,
      input.artifactId,
      input.artifactVersion,
      false,
    );
    const validation = await this.#pool.query<{
      validation_run_id: string;
      dataset_ref: string;
      result_payload: unknown;
    }>(
      `SELECT validation_run_id,dataset_ref,result_payload FROM artifact_validation_run
       WHERE artifact_id=$1 AND artifact_version=$2 AND status='passed' AND result_payload IS NOT NULL
       ORDER BY completed_at DESC,validation_run_id DESC LIMIT 1`,
      [input.artifactId, input.artifactVersion],
    );
    const validationPayload = validation.rows[0]?.result_payload;
    if (validationPayload === undefined || validationPayload === null) return undefined;
    const validationResult = createArtifactValidationResult(
      // PostgreSQL JSON is an external persistence boundary; the domain factory
      // immediately validates and freezes the resulting immutable P05 fact.
      record(validationPayload) as unknown as ArtifactValidationResult,
    );
    const shadowRows = await this.#pool.query<ShadowResultRow>(
      `SELECT result.*,run.formal_goal_ref,run.formal_projection FROM artifact_shadow_result result
       JOIN artifact_shadow_run run ON run.shadow_run_id=result.shadow_run_id
       WHERE run.artifact_id=$1 AND run.artifact_version=$2 AND result.stale=false
       ORDER BY result.completed_at`,
      [input.artifactId, input.artifactVersion],
    );
    const counters = await this.#pool.query<{ content: unknown }>(
      `SELECT content FROM artifact_counterexample
       WHERE artifact_id=$1 AND artifact_version=$2 ORDER BY created_at,counterexample_id`,
      [input.artifactId, input.artifactVersion],
    );
    const replayCases = await this.#pool.query<{
      environment_class: string;
      device_class: string | null;
    }>(
      `SELECT replay.content->>'environmentClass' AS environment_class,
              NULLIF(replay.content->>'deviceClass','') AS device_class
       FROM artifact_replay_case_result result
       JOIN artifact_replay_case replay ON replay.replay_case_id=result.replay_case_id
       WHERE result.validation_run_id=$1 ORDER BY replay.replay_case_id`,
      [validationResult.validationRunId],
    );
    const shadowEvidence = shadowRows.rows.map((row) => ({
      result: mapShadowResult(row),
      ...(row.formal_goal_ref === null || row.formal_goal_ref === undefined
        ? {}
        : { formalGoalRef: row.formal_goal_ref }),
      evidenceRefs: projection(row.formal_projection ?? {}).evidenceRefs,
    }));
    const counterexamples = counters.rows.map((row) =>
      createArtifactCounterexample(record(row.content) as unknown as ArtifactCounterexample),
    );
    return Object.freeze({
      validationResult,
      counterexamples: Object.freeze(counterexamples),
      shadowRuns: Object.freeze(shadowEvidence.map((item) => item.result)),
      artifact: mapArtifact(artifact),
      coverage: derivePromotionCoverage({
        validationResult,
        shadowEvidence,
        counterexamples,
        replayCases: replayCases.rows,
      }),
    });
  }

  async recordRevalidationTrigger(
    input: ArtifactRevalidationTrigger,
    validationRunId?: string,
  ): Promise<void> {
    const value = createArtifactRevalidationTrigger(input);
    const [artifactId, artifactVersion] = artifactRef(value.artifactRef);
    await inTransaction(this.#pool, async (client) => {
      const artifact = await selectArtifact(client, artifactId, artifactVersion, true);
      if (validationRunId !== undefined) {
        const parent = await client.query<{
          artifact_id: string;
          artifact_version: number;
          validation_type: string;
          dataset_ref: string;
          status: string;
        }>(
          `SELECT artifact_id,artifact_version,validation_type,dataset_ref,status
           FROM artifact_validation_run WHERE validation_run_id=$1 FOR UPDATE`,
          [validationRunId],
        );
        const run = required(parent.rows[0], 'ARTIFACT_REVALIDATION_RUN_MISSING');
        if (
          run.artifact_id !== artifactId ||
          run.artifact_version !== artifactVersion ||
          run.validation_type !== 'revalidation' ||
          run.status !== 'pending'
        ) {
          throw coded('ARTIFACT_REVALIDATION_RUN_INVALID');
        }
        const dataset = await client.query<{
          dataset_version: number;
          content_hash: string;
          tenant_id: string;
          promotion_eligible: boolean;
        }>(
          `SELECT dataset_version,content_hash,tenant_id,promotion_eligible
           FROM replay_dataset_manifest
           WHERE dataset_id=$1 AND promotion_eligible=true AND invalidated_at IS NULL
           ORDER BY dataset_version DESC LIMIT 1 FOR SHARE`,
          [run.dataset_ref],
        );
        const datasetRow = required(dataset.rows[0], 'ARTIFACT_REVALIDATION_DATASET_INVALID');
        if (artifact.tenant_id === null || artifact.tenant_id !== datasetRow.tenant_id) {
          throw coded('ARTIFACT_REVALIDATION_TENANT_DATASET_MISMATCH');
        }
        await client.query(
          `UPDATE artifact_validation_run SET tenant_id=$2,dataset_version=$3,artifact_hash=$4,
             dataset_hash=$5,validator_version='artifact-replay-validator/1.1',
             metric_catalog_version='artifact-replay-metrics/1.1',promotion_eligible=true,
             work_state='pending',available_at=$6,updated_at=$6
           WHERE validation_run_id=$1`,
          [
            validationRunId,
            artifact.tenant_id,
            datasetRow.dataset_version,
            artifact.content_hash,
            datasetRow.content_hash,
            value.createdAt,
          ],
        );
      }
      const inserted = await client.query<{ trigger_id: string }>(
        `INSERT INTO artifact_revalidation_trigger(
           trigger_id,artifact_id,artifact_version,artifact_ref,trigger_type,source_refs,severity,
           validation_run_id,created_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
         ON CONFLICT(trigger_id) DO NOTHING RETURNING trigger_id`,
        [
          value.triggerId,
          artifactId,
          artifactVersion,
          value.artifactRef,
          value.triggerType,
          JSON.stringify(value.sourceRefs),
          value.severity,
          validationRunId ?? null,
          value.createdAt,
        ],
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query<{
          artifact_ref: string;
          trigger_type: string;
          source_refs: unknown;
          severity: string;
          validation_run_id: string | null;
          created_at: Date | string;
        }>(
          `SELECT artifact_ref,trigger_type,source_refs,severity,validation_run_id,created_at
           FROM artifact_revalidation_trigger WHERE trigger_id=$1 FOR SHARE`,
          [value.triggerId],
        );
        const current = required(existing.rows[0], 'ARTIFACT_REVALIDATION_TRIGGER_MISSING');
        if (
          current.artifact_ref !== value.artifactRef ||
          current.trigger_type !== value.triggerType ||
          current.severity !== value.severity ||
          current.validation_run_id !== (validationRunId ?? null) ||
          timestamp(current.created_at) !== value.createdAt ||
          hashCanonical(stringList(current.source_refs)) !== hashCanonical(value.sourceRefs)
        ) {
          throw coded('ARTIFACT_REVALIDATION_IDEMPOTENCY_CONFLICT');
        }
        return;
      }
      if (value.severity === 'critical') {
        await client.query(
          `UPDATE compiled_artifact SET status='deprecated'
           WHERE artifact_id=$1 AND version=$2 AND status IN ('active','revalidating')`,
          [artifactId, artifactVersion],
        );
        // A critical P06 incident is a real kill switch: remove the P02 active pointer
        // in the same transaction. Incrementing its version leaves a stale executable
        // reference behind; reactivation must go through fresh approval/activation.
        await client.query(
          `DELETE FROM artifact_active_pointer
           WHERE artifact_key=$1 AND artifact_id=$2 AND artifact_version=$3`,
          [artifact.artifact_key, artifactId, artifactVersion],
        );
      } else if (artifact.artifact_status === 'active') {
        await client.query(
          `UPDATE compiled_artifact SET status='revalidating'
           WHERE artifact_id=$1 AND version=$2 AND status='active'`,
          [artifactId, artifactVersion],
        );
      }
      await writeOutbox(client, {
        eventId: `artifact-revalidation-${value.triggerId}`,
        eventType: value.severity === 'critical' ? 'artifact.deprecated' : 'artifact.revalidating',
        aggregateType: 'artifact_revalidation_trigger',
        aggregateId: value.triggerId,
        aggregateVersion: 1,
        occurredAt: value.createdAt,
        payload: {
          triggerId: value.triggerId,
          artifactId,
          artifactVersion,
          severity: value.severity,
          triggerType: value.triggerType,
        },
      });
    });
  }

  async requestRevalidationAtomically(
    input: Readonly<{
      trigger: ArtifactRevalidationTrigger;
      command: Readonly<{
        artifactId: string;
        version: number;
        validationRunId: string;
        validationType: 'revalidation';
        datasetRef: string;
        expectedVersion: number;
        idempotencyKey: string;
        occurredAt: string;
      }>;
      actorId: string;
      tenantId?: string;
    }>,
  ): Promise<void> {
    const trigger = createArtifactRevalidationTrigger(input.trigger);
    if (
      trigger.artifactRef !== `${input.command.artifactId}:${String(input.command.version)}` ||
      trigger.createdAt !== input.command.occurredAt
    ) {
      throw coded('ARTIFACT_REVALIDATION_TRIGGER_MISMATCH');
    }
    await inTransaction(this.#pool, async (client) => {
      const artifact = await selectArtifact(
        client,
        input.command.artifactId,
        input.command.version,
        true,
      );
      if (artifact.artifact_status !== 'active') {
        throw coded('ARTIFACT_REVALIDATION_STATE_INVALID');
      }
      if (artifact.version !== input.command.expectedVersion) {
        throw coded('ARTIFACT_EXPECTED_VERSION_CONFLICT');
      }
      if (input.tenantId !== undefined && input.tenantId !== artifact.tenant_id) {
        throw coded('ARTIFACT_TENANT_SCOPE_DENIED');
      }
      const dataset = await client.query<{
        dataset_version: number;
        content_hash: string;
        tenant_id: string;
      }>(
        `SELECT dataset_version,content_hash,tenant_id
         FROM replay_dataset_manifest
         WHERE dataset_id=$1 AND promotion_eligible=true AND invalidated_at IS NULL
         ORDER BY dataset_version DESC LIMIT 1 FOR SHARE`,
        [input.command.datasetRef],
      );
      const datasetRow = required(dataset.rows[0], 'ARTIFACT_REVALIDATION_DATASET_INVALID');
      if (artifact.tenant_id === null || datasetRow.tenant_id !== artifact.tenant_id) {
        throw coded('ARTIFACT_REVALIDATION_TENANT_DATASET_MISMATCH');
      }
      const transitioned = await client.query(
        `UPDATE compiled_artifact SET status='revalidating',validation_summary_id=NULL
         WHERE artifact_id=$1 AND version=$2 AND status='active'`,
        [artifact.artifact_id, artifact.version],
      );
      if (transitioned.rowCount !== 1) throw coded('ARTIFACT_STATE_CAS_CONFLICT');
      await client.query(
        `INSERT INTO artifact_validation_run(
           validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,result,
           metrics,counterexample_refs,started_at,completed_at,tenant_id,dataset_version,artifact_hash,
           dataset_hash,validator_version,metric_catalog_version,result_hash,result_payload,
           promotion_eligible,work_state,attempt,max_attempts,available_at,lease_owner,lease_token,
           lease_expires_at,cancel_requested_at,idempotency_key,source_event_id,last_error_code,
           last_error_summary,created_at,updated_at)
         VALUES($1,$2,$3,'revalidation',$4,'pending',NULL,'{}'::jsonb,'[]'::jsonb,$5,NULL,
           $6,$7,$8,$9,'artifact-replay-validator/1.1','artifact-replay-metrics/1.1',NULL,NULL,
           true,'pending',0,5,$5,NULL,NULL,NULL,NULL,$10,$11,NULL,NULL,$5,$5)
         ON CONFLICT(validation_run_id) DO NOTHING`,
        [
          input.command.validationRunId,
          artifact.artifact_id,
          artifact.version,
          input.command.datasetRef,
          input.command.occurredAt,
          artifact.tenant_id,
          datasetRow.dataset_version,
          artifact.content_hash,
          datasetRow.content_hash,
          input.command.idempotencyKey,
          trigger.triggerId,
        ],
      );
      const parent = await client.query<{
        artifact_id: string;
        artifact_version: number;
        validation_type: string;
        dataset_ref: string;
        dataset_version: number | null;
        artifact_hash: string | null;
        dataset_hash: string | null;
        work_state: string;
      }>(
        `SELECT artifact_id,artifact_version,validation_type,dataset_ref,dataset_version,artifact_hash,
                dataset_hash,work_state FROM artifact_validation_run
         WHERE validation_run_id=$1 FOR SHARE`,
        [input.command.validationRunId],
      );
      const validation = required(parent.rows[0], 'ARTIFACT_REVALIDATION_RUN_MISSING');
      if (
        validation.artifact_id !== artifact.artifact_id ||
        validation.artifact_version !== artifact.version ||
        validation.validation_type !== 'revalidation' ||
        validation.dataset_ref !== input.command.datasetRef ||
        validation.dataset_version !== datasetRow.dataset_version ||
        validation.artifact_hash !== artifact.content_hash ||
        validation.dataset_hash !== datasetRow.content_hash ||
        validation.work_state !== 'pending'
      ) {
        throw coded('ARTIFACT_REVALIDATION_IDEMPOTENCY_CONFLICT');
      }
      const inserted = await client.query<{ trigger_id: string }>(
        `INSERT INTO artifact_revalidation_trigger(
           trigger_id,artifact_id,artifact_version,artifact_ref,trigger_type,source_refs,severity,
           validation_run_id,created_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
         ON CONFLICT(trigger_id) DO NOTHING RETURNING trigger_id`,
        [
          trigger.triggerId,
          artifact.artifact_id,
          artifact.version,
          trigger.artifactRef,
          trigger.triggerType,
          JSON.stringify(trigger.sourceRefs),
          trigger.severity,
          input.command.validationRunId,
          trigger.createdAt,
        ],
      );
      if (inserted.rowCount !== 1) throw coded('ARTIFACT_REVALIDATION_IDEMPOTENCY_CONFLICT');
      if (trigger.severity === 'critical') {
        await client.query(
          `UPDATE compiled_artifact SET status='deprecated'
           WHERE artifact_id=$1 AND version=$2 AND status='revalidating'`,
          [artifact.artifact_id, artifact.version],
        );
        await client.query(
          `DELETE FROM artifact_active_pointer
           WHERE artifact_key=$1 AND artifact_id=$2 AND artifact_version=$3`,
          [artifact.artifact_key, artifact.artifact_id, artifact.version],
        );
      }
      await writeOutbox(client, {
        eventId: `artifact-revalidating-${input.command.validationRunId}`,
        eventType:
          trigger.severity === 'critical' ? 'artifact.deprecated' : 'artifact.revalidating',
        aggregateType: 'artifact_validation',
        aggregateId: input.command.validationRunId,
        aggregateVersion: 1,
        occurredAt: input.command.occurredAt,
        payload: {
          artifactId: artifact.artifact_id,
          artifactVersion: artifact.version,
          validationRunId: input.command.validationRunId,
          actorId: input.actorId,
          triggerId: trigger.triggerId,
        },
      });
      await writeOutbox(client, {
        eventId: `artifact-revalidation-${trigger.triggerId}`,
        eventType:
          trigger.severity === 'critical' ? 'artifact.deprecated' : 'artifact.revalidating',
        aggregateType: 'artifact_revalidation_trigger',
        aggregateId: trigger.triggerId,
        aggregateVersion: 1,
        occurredAt: trigger.createdAt,
        payload: {
          triggerId: trigger.triggerId,
          artifactId: artifact.artifact_id,
          artifactVersion: artifact.version,
          severity: trigger.severity,
          triggerType: trigger.triggerType,
          validationRunId: input.command.validationRunId,
        },
      });
    });
  }

  async loadRevalidationValidationRun(triggerId: string): Promise<string | undefined> {
    const result = await this.#pool.query<{ validation_run_id: string | null }>(
      `SELECT trigger.validation_run_id
       FROM artifact_revalidation_trigger trigger
       JOIN artifact_validation_run run ON run.validation_run_id=trigger.validation_run_id
       WHERE trigger.trigger_id=$1 AND run.validation_type='revalidation'
         AND run.status='pending' AND run.work_state IN ('pending','retry_wait')`,
      [triggerId],
    );
    return result.rows[0]?.validation_run_id ?? undefined;
  }

  async listPendingRevalidationTriggers(limit = 100): Promise<readonly string[]> {
    const result = await this.#pool.query<{ trigger_id: string }>(
      `SELECT trigger.trigger_id
       FROM artifact_revalidation_trigger trigger
       JOIN artifact_validation_run run ON run.validation_run_id=trigger.validation_run_id
       WHERE run.validation_type='revalidation' AND run.status='pending'
         AND run.work_state IN ('pending','retry_wait')
       ORDER BY trigger.created_at,trigger.trigger_id LIMIT $1`,
      [Math.max(1, Math.min(limit, 500))],
    );
    return Object.freeze(result.rows.map((row) => row.trigger_id));
  }

  async recordApproval(input: P06ApprovalInput): Promise<ArtifactApprovalRecord> {
    const approval = createArtifactApprovalRecord(input.approval);
    return inTransaction(this.#pool, async (client) => {
      const approvalHash = hashArtifactApprovalRecord(approval);
      const existing = await client.query<{
        approval_hash: string | null;
        promotion_package_id: string | null;
      }>(
        `SELECT approval_hash,promotion_package_id FROM artifact_approval
         WHERE approval_id=$1 FOR SHARE`,
        [approval.approvalId],
      );
      if (existing.rows[0] !== undefined) {
        if (
          existing.rows[0].approval_hash !== approvalHash ||
          existing.rows[0].promotion_package_id !== input.promotionPackageId
        ) {
          throw coded('ARTIFACT_APPROVAL_IDEMPOTENCY_CONFLICT');
        }
        return approval;
      }
      const artifact = await selectArtifact(
        client,
        approval.artifactId,
        approval.artifactVersion,
        true,
      );
      if (artifact.artifact_status !== 'awaiting_approval')
        throw coded('ARTIFACT_APPROVAL_STATE_INVALID');
      if (input.expectedVersion !== approval.artifactVersion) {
        throw coded('ARTIFACT_EXPECTED_VERSION_CONFLICT');
      }
      if (input.tenantId !== undefined && artifact.tenant_id !== input.tenantId) {
        throw coded('ARTIFACT_TENANT_SCOPE_DENIED');
      }
      const packageRow = await client.query<{
        content_hash: string;
        validation_summary_hash: string;
        eligibility: string;
      }>(
        `SELECT content_hash,validation_summary_hash,eligibility FROM artifact_promotion_package
         WHERE promotion_package_id=$1 AND artifact_id=$2 AND artifact_version=$3`,
        [input.promotionPackageId, approval.artifactId, approval.artifactVersion],
      );
      const promotion = packageRow.rows[0];
      if (
        promotion?.content_hash !== approval.promotionPackageHash ||
        promotion.validation_summary_hash !== approval.validationSummaryHash ||
        promotion.eligibility !== 'eligible_for_review'
      ) {
        throw coded('ARTIFACT_APPROVAL_EVIDENCE_INVALID');
      }
      const inserted = await client.query<{ approval_id: string }>(
        `INSERT INTO artifact_approval(
           approval_id,artifact_id,artifact_version,approver_id,decision,reason,validation_summary_hash,
           promotion_package_id,promotion_package_hash,approval_hash,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(approval_id) DO NOTHING RETURNING approval_id`,
        [
          approval.approvalId,
          approval.artifactId,
          approval.artifactVersion,
          approval.approverId,
          approval.decision,
          approval.reason,
          approval.validationSummaryHash,
          input.promotionPackageId,
          approval.promotionPackageHash,
          approvalHash,
          approval.createdAt,
        ],
      );
      if (inserted.rowCount === 0) {
        throw coded('ARTIFACT_APPROVAL_IDEMPOTENCY_CONFLICT');
      }
      if (approval.decision === 'rejected') {
        await client.query(
          `UPDATE compiled_artifact SET status='rejected'
           WHERE artifact_id=$1 AND version=$2 AND status='awaiting_approval'`,
          [approval.artifactId, approval.artifactVersion],
        );
      }
      await writeOutbox(client, {
        eventId: `artifact-approval-${approval.approvalId}`,
        eventType: 'artifact.approval_recorded',
        aggregateType: 'artifact_approval',
        aggregateId: approval.approvalId,
        aggregateVersion: 1,
        occurredAt: approval.createdAt,
        payload: {
          approvalId: approval.approvalId,
          artifactId: approval.artifactId,
          artifactVersion: approval.artifactVersion,
          decision: approval.decision,
          promotionPackageHash: approval.promotionPackageHash,
          approvalHash,
        },
      });
      return approval;
    });
  }

  async activateApproved(input: P06ActivationInput): Promise<ArtifactActivationRecord> {
    return inTransaction(this.#pool, async (client) => {
      // Activation ids are externally supplied idempotency identities. Lock them
      // separately from the artifact key so a malformed duplicate cannot mutate
      // a second artifact before hitting the global primary-key constraint.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `artifact-activation:${input.activationId}`,
      ]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `artifact-key:${input.artifactKey}`,
      ]);
      const existing = await client.query<{
        activation_id: string;
        artifact_id: string;
        artifact_version: number;
        artifact_ref: string;
        artifact_hash: string;
        approval_id: string;
        approval_hash: string;
        previous_active_artifact_ref: string | null;
        active_pointer_version: number;
        activated_by: string;
        activated_at: Date | string;
      }>(
        `SELECT activation_id,artifact_id,artifact_version,artifact_ref,artifact_hash,approval_id,
                approval_hash,previous_active_artifact_ref,active_pointer_version,activated_by,activated_at
         FROM artifact_activation_record WHERE activation_id=$1 FOR SHARE`,
        [input.activationId],
      );
      if (existing.rows[0] !== undefined) {
        const activation = mapActivationRecord(existing.rows[0]);
        if (
          existing.rows[0].artifact_id !== input.artifactId ||
          existing.rows[0].artifact_version !== input.artifactVersion ||
          existing.rows[0].approval_id !== input.approvalId ||
          activation.approvalHash !== input.approvalHash ||
          activation.activatedBy !== input.actorId ||
          activation.activatedAt !== input.activatedAt
        ) {
          throw coded('ARTIFACT_ACTIVATION_IDEMPOTENCY_CONFLICT');
        }
        return activation;
      }
      const artifact = await selectArtifact(client, input.artifactId, input.artifactVersion, true);
      if (artifact.artifact_status !== 'awaiting_approval')
        throw coded('ARTIFACT_ACTIVATION_STATE_INVALID');
      if (input.expectedVersion !== input.artifactVersion)
        throw coded('ARTIFACT_EXPECTED_VERSION_CONFLICT');
      if (input.tenantId !== undefined && input.tenantId !== artifact.tenant_id) {
        throw coded('ARTIFACT_TENANT_SCOPE_DENIED');
      }
      const approval = await client.query<{
        approval_id: string;
        approval_hash: string | null;
        decision: string;
        promotion_package_hash: string | null;
      }>(
        `SELECT approval_id,approval_hash,decision,promotion_package_hash FROM artifact_approval
         WHERE approval_id=$1 AND artifact_id=$2 AND artifact_version=$3 FOR UPDATE`,
        [input.approvalId, input.artifactId, input.artifactVersion],
      );
      const approvalRow = approval.rows[0];
      if (
        approvalRow?.decision !== 'approved' ||
        approvalRow.approval_hash !== input.approvalHash ||
        approvalRow.promotion_package_hash !== input.promotionPackageHash
      ) {
        throw coded('ARTIFACT_ACTIVATION_APPROVAL_INVALID');
      }
      const evidence = await client.query<{
        content_hash: string;
        artifact_hash: string;
        dependency_snapshot_hash: string;
        eligibility: string;
        validation_summary_ref: string;
      }>(
        `SELECT content_hash,artifact_hash,dependency_snapshot_hash,eligibility,validation_summary_ref
         FROM artifact_promotion_package WHERE content_hash=$1 AND artifact_id=$2 AND artifact_version=$3`,
        [input.promotionPackageHash, input.artifactId, input.artifactVersion],
      );
      const packageRow = evidence.rows[0];
      if (
        packageRow?.eligibility !== 'eligible_for_review' ||
        packageRow.artifact_hash !== artifact.content_hash ||
        packageRow.dependency_snapshot_hash !== hashCanonical(record(artifact.dependency_snapshot))
      ) {
        throw coded('ARTIFACT_ACTIVATION_EVIDENCE_STALE');
      }
      const pointer = await client.query<{
        artifact_id: string;
        artifact_version: number;
        lock_version: number;
      }>(
        `SELECT artifact_id,artifact_version,lock_version FROM artifact_active_pointer
         WHERE artifact_key=$1 FOR UPDATE`,
        [input.artifactKey],
      );
      const previous = pointer.rows[0];
      const currentLock = previous?.lock_version ?? 0;
      if (currentLock !== input.expectedLockVersion) throw coded('ARTIFACT_CAS_CONFLICT');
      if (previous !== undefined) {
        await client.query(
          `UPDATE compiled_artifact SET status='deprecated'
           WHERE artifact_id=$1 AND version=$2 AND status='active'`,
          [previous.artifact_id, previous.artifact_version],
        );
      }
      await client.query(
        `UPDATE compiled_artifact SET status='active',validation_summary_id=$3
         WHERE artifact_id=$1 AND version=$2 AND status='awaiting_approval'`,
        [input.artifactId, input.artifactVersion, packageRow.validation_summary_ref],
      );
      await client.query(
        `INSERT INTO artifact_active_pointer(
           artifact_key,artifact_id,artifact_version,activated_by,activated_at,lock_version)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(artifact_key) DO UPDATE SET artifact_id=EXCLUDED.artifact_id,
           artifact_version=EXCLUDED.artifact_version,activated_by=EXCLUDED.activated_by,
           activated_at=EXCLUDED.activated_at,lock_version=EXCLUDED.lock_version`,
        [
          input.artifactKey,
          input.artifactId,
          input.artifactVersion,
          input.actorId,
          input.activatedAt,
          currentLock + 1,
        ],
      );
      const activation = createArtifactActivationRecord({
        activationId: input.activationId,
        artifactRef: `${input.artifactId}:${String(input.artifactVersion)}`,
        artifactHash: artifact.content_hash,
        approvalRef: input.approvalId,
        approvalHash: input.approvalHash,
        ...(previous === undefined
          ? {}
          : {
              previousActiveArtifactRef: `${previous.artifact_id}:${String(previous.artifact_version)}`,
            }),
        activePointerVersion: currentLock + 1,
        activatedBy: input.actorId,
        activatedAt: input.activatedAt,
      });
      const inserted = await client.query<{ activation_id: string }>(
        `INSERT INTO artifact_activation_record(
           activation_id,artifact_id,artifact_version,artifact_ref,artifact_hash,approval_id,approval_hash,
           previous_active_artifact_ref,active_pointer_version,activated_by,activated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(activation_id) DO NOTHING RETURNING activation_id`,
        [
          activation.activationId,
          input.artifactId,
          input.artifactVersion,
          activation.artifactRef,
          activation.artifactHash,
          activation.approvalRef,
          activation.approvalHash,
          activation.previousActiveArtifactRef ?? null,
          activation.activePointerVersion,
          activation.activatedBy,
          activation.activatedAt,
        ],
      );
      if (inserted.rowCount !== 1) throw coded('ARTIFACT_ACTIVATION_IDEMPOTENCY_CONFLICT');
      await writeOutbox(client, {
        eventId: `artifact-activated-${activation.activationId}`,
        eventType: 'artifact.activated',
        aggregateType: 'artifact_activation',
        aggregateId: activation.activationId,
        aggregateVersion: activation.activePointerVersion,
        occurredAt: activation.activatedAt,
        payload: {
          activationId: activation.activationId,
          artifactId: input.artifactId,
          artifactVersion: input.artifactVersion,
          artifactKey: input.artifactKey,
          pointerLockVersion: activation.activePointerVersion,
        },
      });
      return activation;
    });
  }
}

export interface P06ApprovalInput {
  readonly approval: ArtifactApprovalRecord;
  readonly promotionPackageId: string;
  readonly expectedVersion: number;
  readonly tenantId?: string;
}

export interface P06ActivationInput {
  readonly activationId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly artifactKey: string;
  readonly expectedVersion: number;
  readonly expectedLockVersion: number;
  readonly approvalId: string;
  readonly approvalHash: string;
  readonly promotionPackageHash: string;
  readonly actorId: string;
  readonly tenantId?: string;
  readonly activatedAt: string;
}

async function createSafetyTrigger(
  client: PoolClient,
  run: ArtifactShadowRunRecord,
  now: string,
): Promise<void> {
  const trigger = createArtifactRevalidationTrigger({
    triggerId: `safety-${randomUUID()}`,
    artifactRef: run.artifactRef,
    triggerType: 'safety_incident',
    sourceRefs: [run.shadowRunId],
    severity: 'critical',
    createdAt: now,
  });
  const validationRunId = `safety-revalidation-${trigger.triggerId}`;
  const source = await client.query<{
    dataset_ref: string;
    dataset_version: number;
    tenant_id: string;
    artifact_hash: string;
    dataset_hash: string;
  }>(
    `SELECT validation.dataset_ref,validation.dataset_version,validation.tenant_id,
            validation.artifact_hash,validation.dataset_hash
     FROM artifact_validation_run validation
     WHERE validation.artifact_id=$1 AND validation.artifact_version=$2
       AND validation.validation_type='replay' AND validation.status='passed'
       AND validation.dataset_version IS NOT NULL AND validation.tenant_id IS NOT NULL
       AND validation.artifact_hash IS NOT NULL AND validation.dataset_hash IS NOT NULL
     ORDER BY validation.completed_at DESC,validation.validation_run_id DESC LIMIT 1 FOR SHARE`,
    [run.artifactId, run.artifactVersion],
  );
  const replaySource = source.rows[0];
  if (replaySource === undefined) {
    await client.query(
      `INSERT INTO artifact_validation_run(
         validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,result,
         metrics,counterexample_refs,started_at,completed_at,work_state,attempt,max_attempts,
         available_at,idempotency_key,source_event_id,last_error_code,last_error_summary,created_at,updated_at)
       VALUES($1,$2,$3,'revalidation',$4,'failed','ARTIFACT_REVALIDATION_SOURCE_MISSING',
         '{}'::jsonb,'[]'::jsonb,$5,$5,'dead_letter',0,1,$5,$6,$7,
         'ARTIFACT_REVALIDATION_SOURCE_MISSING','No passed P05 replay dataset is available.', $5,$5)`,
      [
        validationRunId,
        run.artifactId,
        run.artifactVersion,
        `safety:${run.shadowRunId}`,
        now,
        `safety:${trigger.triggerId}`,
        trigger.triggerId,
      ],
    );
  } else {
    await client.query(
      `INSERT INTO artifact_validation_run(
         validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,result,
         metrics,counterexample_refs,started_at,completed_at,tenant_id,dataset_version,artifact_hash,
         dataset_hash,validator_version,metric_catalog_version,promotion_eligible,work_state,attempt,
         max_attempts,available_at,idempotency_key,source_event_id,created_at,updated_at)
       VALUES($1,$2,$3,'revalidation',$4,'pending',NULL,'{}'::jsonb,'[]'::jsonb,$5,NULL,
         $6,$7,$8,$9,'artifact-replay-validator/1.1','artifact-replay-metrics/1.1',true,
         'pending',0,5,$5,$10,$11,$5,$5)`,
      [
        validationRunId,
        run.artifactId,
        run.artifactVersion,
        replaySource.dataset_ref,
        now,
        replaySource.tenant_id,
        replaySource.dataset_version,
        replaySource.artifact_hash,
        replaySource.dataset_hash,
        `safety:${trigger.triggerId}`,
        trigger.triggerId,
      ],
    );
  }
  await client.query(
    `INSERT INTO artifact_revalidation_trigger(
       trigger_id,artifact_id,artifact_version,artifact_ref,trigger_type,source_refs,severity,
       validation_run_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
    [
      trigger.triggerId,
      run.artifactId,
      run.artifactVersion,
      trigger.artifactRef,
      trigger.triggerType,
      JSON.stringify(trigger.sourceRefs),
      trigger.severity,
      validationRunId,
      trigger.createdAt,
    ],
  );
  await client.query(
    `UPDATE compiled_artifact SET status='deprecated'
     WHERE artifact_id=$1 AND version=$2 AND status IN ('active','revalidating')`,
    [run.artifactId, run.artifactVersion],
  );
  await client.query(
    `DELETE FROM artifact_active_pointer
     WHERE artifact_id=$1 AND artifact_version=$2`,
    [run.artifactId, run.artifactVersion],
  );
  await writeOutbox(client, {
    eventId: `artifact-revalidation-safety-${trigger.triggerId}`,
    eventType: 'artifact.deprecated',
    aggregateType: 'artifact_revalidation_trigger',
    aggregateId: trigger.triggerId,
    aggregateVersion: 1,
    occurredAt: now,
    payload: {
      triggerId: trigger.triggerId,
      artifactId: run.artifactId,
      artifactVersion: run.artifactVersion,
      severity: trigger.severity,
      triggerType: trigger.triggerType,
      validationRunId,
      replayQueued: replaySource !== undefined,
      source: 'artifact_shadow_safety_boundary',
    },
  });
}

function emptyProjection(): ShadowProjectionSnapshot {
  return Object.freeze({
    criterionRefs: Object.freeze([]),
    evidenceRefs: Object.freeze([]),
    correctionRefs: Object.freeze([]),
  });
}

/**
 * This is deliberately a projection compiler, not an artifact executor.  It
 * reads only the immutable P02 definition and produces comparison data without
 * calling Skills, MCP, Providers, or the formal runtime.
 */
function compileCandidateProjection(artifact: CompiledArtifact): ShadowProjectionSnapshot {
  const definition = artifact.definition;
  if ('skillGoalGraph' in definition) {
    return Object.freeze({
      plan: Object.freeze({
        nodeKeys: definition.skillGoalGraph.nodes.map((node) => node.nodeKey),
        dependencies: definition.skillGoalGraph.dependencies.map((dependency) => ({
          predecessorNodeKey: dependency.predecessorNodeKey,
          successorNodeKey: dependency.successorNodeKey,
          predicate: dependency.predicate,
        })),
      }),
      criterionRefs: Object.freeze(
        definition.completionContractTemplate.criteria.map(
          (criterion) => criterion.criterionTemplateId,
        ),
      ),
      evidenceRefs: Object.freeze(definition.completionContractTemplate.evidenceRequirements),
      riskLevel: artifact.riskLevel,
      correctionRefs: Object.freeze([]),
    });
  }
  if ('decision' in definition) {
    return Object.freeze({
      decision: Object.freeze({
        decisionType: definition.decision.decisionType,
        parameters: definition.decision.parameters,
        explanationCode: definition.decision.explanationCode,
      }),
      criterionRefs: Object.freeze([]),
      evidenceRefs: Object.freeze([]),
      riskLevel: artifact.riskLevel,
      correctionRefs: Object.freeze([]),
    });
  }
  if ('solutionPattern' in definition) {
    return Object.freeze({
      decision: Object.freeze({
        decisionSuggestions: definition.solutionPattern.decisionSuggestions,
      }),
      plan: Object.freeze({
        planPatchTemplate: definition.solutionPattern.planPatchTemplate,
        recoveryPlanTemplate: definition.solutionPattern.recoveryPlanTemplate,
      }),
      criterionRefs: Object.freeze([]),
      evidenceRefs: Object.freeze([]),
      riskLevel: artifact.riskLevel,
      correctionRefs: Object.freeze(
        definition.failureBoundaries.map((boundary) => boundary.reasonCode),
      ),
    });
  }
  return Object.freeze({
    decision: Object.freeze(
      'route' in definition
        ? { route: definition.route, fallbackRoutes: definition.fallbackRoutes }
        : { nextPath: definition.nextPath, taskTypeId: definition.taskTypeId },
    ),
    criterionRefs: Object.freeze([]),
    evidenceRefs: Object.freeze([]),
    riskLevel: artifact.riskLevel,
    correctionRefs: Object.freeze([]),
  });
}

/**
 * Promotion coverage is reconstructed from P05 replay-case records and P06
 * formal-sidecar evidence, never supplied by the promotion caller. The formal
 * observer writes these stable evidence references beside each ShadowRun.
 */
function derivePromotionCoverage(
  input: Readonly<{
    validationResult: ArtifactValidationResult;
    shadowEvidence: readonly Readonly<{
      result: ArtifactShadowResult;
      formalGoalRef?: string;
      evidenceRefs: readonly string[];
    }>[];
    counterexamples: readonly ArtifactCounterexample[];
    replayCases: readonly Readonly<{ environment_class: string; device_class: string | null }>[];
  }>,
): PromotionCoverage {
  const evidenceRefs = input.shadowEvidence.flatMap((item) => item.evidenceRefs);
  const environmentClasses = new Set([
    ...input.replayCases.map((item) => item.environment_class),
    ...prefixedEvidence(evidenceRefs, 'environment-class:'),
  ]);
  const deviceClasses = new Set([
    ...input.replayCases.flatMap((item) => (item.device_class === null ? [] : [item.device_class])),
    ...prefixedEvidence(evidenceRefs, 'device-class:'),
  ]);
  return Object.freeze({
    independentGoals: new Set(
      input.shadowEvidence.flatMap((item) =>
        item.formalGoalRef === undefined ? [] : [item.formalGoalRef],
      ),
    ).size,
    holdoutCases: input.replayCases.length,
    shadowRuns: input.shadowEvidence.length,
    environmentClasses: Object.freeze([...environmentClasses].sort()),
    deviceClasses: Object.freeze([...deviceClasses].sort()),
    userPreferenceIsolated: evidenceRefs.includes('preference-isolation:verified'),
    temporaryAuthorizationObserved: evidenceRefs.includes('authorization:temporary'),
    dependencyValid: true,
    unresolvedCriticalCounterexample: input.counterexamples.some(
      (counterexample) => counterexample.status === 'recorded',
    ),
    snapshotComplete: input.validationResult.result === 'passed',
  });
}

function prefixedEvidence(values: readonly string[], prefix: string): readonly string[] {
  return values
    .filter((value) => value.startsWith(prefix) && value.length > prefix.length)
    .map((value) => value.slice(prefix.length));
}

function assertSameShadowEnrollment(
  row: ShadowRunRow,
  value: Readonly<{
    input: ArtifactShadowEnrollment;
    formalProjection: ShadowProjectionSnapshot;
    candidateProjection: ShadowProjectionSnapshot;
    declaredOperations: readonly string[];
    currentPolicySnapshotHash: string;
    currentCapabilityCatalogHash: string;
    currentFormalGoalVersion: number | null;
    currentFormalPlanVersion: number | null;
  }>,
): void {
  const { input } = value;
  const different =
    row.shadow_run_id !== input.shadowRunId ||
    row.artifact_ref !== input.artifactRef ||
    row.artifact_hash !== input.artifactHash ||
    row.tenant_id !== (input.tenantId ?? null) ||
    row.formal_request_ref !== input.formalRequestRef ||
    row.formal_goal_ref !== (input.formalGoalRef ?? null) ||
    row.formal_plan_ref !== (input.formalPlanRef ?? null) ||
    row.formal_goal_version !== (input.formalGoalVersion ?? null) ||
    row.formal_plan_version !== (input.formalPlanVersion ?? null) ||
    row.shadow_mode !== input.shadowMode ||
    row.policy_snapshot_hash !== input.policySnapshotHash ||
    row.capability_catalog_hash !== input.capabilityCatalogHash ||
    row.current_policy_snapshot_hash !== value.currentPolicySnapshotHash ||
    row.current_capability_catalog_hash !== value.currentCapabilityCatalogHash ||
    row.current_formal_goal_version !== value.currentFormalGoalVersion ||
    row.current_formal_plan_version !== value.currentFormalPlanVersion ||
    row.formal_outcome_ref !== (input.formalOutcomeRef ?? null) ||
    timestamp(row.expires_at) !== input.expiresAt ||
    timestamp(row.created_at) !== input.createdAt ||
    hashCanonical(record(row.formal_projection)) !== hashCanonical(value.formalProjection) ||
    hashCanonical(record(row.candidate_projection)) !== hashCanonical(value.candidateProjection) ||
    hashCanonical(stringList(row.declared_operations)) !== hashCanonical(value.declaredOperations);
  if (different) throw coded('ARTIFACT_SHADOW_IDEMPOTENCY_CONFLICT');
}

async function selectArtifact(
  queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  artifactId: string,
  version: number,
  lock: boolean,
): Promise<ArtifactRow> {
  const result = await queryable.query<ArtifactRow>(
    `SELECT artifact_id,artifact_key,version,tenant_id,status AS artifact_status,content_hash,definition,applicability,
       dependency_snapshot,lineage_id,validation_summary_id,artifact_type,domain,risk_level,created_at
     FROM compiled_artifact WHERE artifact_id=$1 AND version=$2${lock ? ' FOR UPDATE' : ''}`,
    [artifactId, version],
  );
  return required(result.rows[0], 'ARTIFACT_NOT_FOUND');
}

function mapShadowRun(row: ShadowRunRow): ArtifactShadowRunRecord {
  return Object.freeze({
    ...createArtifactShadowRun({
      shadowRunId: row.shadow_run_id,
      artifactRef: row.artifact_ref,
      artifactHash: row.artifact_hash,
      formalRequestRef: row.formal_request_ref,
      ...(row.formal_goal_ref === null ? {} : { formalGoalRef: row.formal_goal_ref }),
      ...(row.formal_plan_ref === null ? {} : { formalPlanRef: row.formal_plan_ref }),
      ...(row.formal_goal_version === null ? {} : { formalGoalVersion: row.formal_goal_version }),
      ...(row.formal_plan_version === null ? {} : { formalPlanVersion: row.formal_plan_version }),
      status: row.status,
      shadowMode: row.shadow_mode,
      startedAt: timestamp(row.created_at),
      ...(['completed', 'discarded_stale', 'failed', 'cancelled'].includes(row.status)
        ? { completedAt: timestamp(row.updated_at) }
        : {}),
    }),
    artifactId: row.artifact_id,
    artifactVersion: row.artifact_version,
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    policySnapshotHash: row.policy_snapshot_hash,
    capabilityCatalogHash: row.capability_catalog_hash,
    workState: row.work_state,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    availableAt: timestamp(row.available_at),
    expiresAt: timestamp(row.expires_at),
    idempotencyKey: row.idempotency_key,
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.lease_token === null ? {} : { leaseToken: row.lease_token }),
    ...(row.lease_expires_at === null ? {} : { leaseExpiresAt: timestamp(row.lease_expires_at) }),
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
    ...(row.last_error_summary === null ? {} : { lastErrorSummary: row.last_error_summary }),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  });
}

function mapShadowResult(row: ShadowResultRow): ArtifactShadowResult {
  const base = {
    shadowRunRef: row.shadow_run_id,
    artifactRef: row.artifact_ref,
    ...(row.shadow_decision_ref === null ? {} : { shadowDecisionRef: row.shadow_decision_ref }),
    ...(row.shadow_plan_ref === null ? {} : { shadowPlanRef: row.shadow_plan_ref }),
    ...(row.formal_plan_ref === null ? {} : { formalPlanRef: row.formal_plan_ref }),
    ...(row.formal_outcome_ref === null ? {} : { formalOutcomeRef: row.formal_outcome_ref }),
    comparison: record(row.comparison) as Readonly<Record<string, number | undefined>>,
    policyViolation: row.policy_violation,
    unsafeAttempt: row.unsafe_attempt,
    stale: row.stale,
    resultHash: row.result_hash,
    evaluatorVersion: row.evaluator_version,
    completedAt: timestamp(row.completed_at),
  };
  return createArtifactShadowResult(base);
}

function mapActivationRecord(
  row: Readonly<{
    activation_id: string;
    artifact_ref: string;
    artifact_hash: string;
    approval_id: string;
    approval_hash: string;
    previous_active_artifact_ref: string | null;
    active_pointer_version: number;
    activated_by: string;
    activated_at: Date | string;
  }>,
): ArtifactActivationRecord {
  return createArtifactActivationRecord({
    activationId: row.activation_id,
    artifactRef: row.artifact_ref,
    artifactHash: row.artifact_hash,
    approvalRef: row.approval_id,
    approvalHash: row.approval_hash,
    ...(row.previous_active_artifact_ref === null
      ? {}
      : { previousActiveArtifactRef: row.previous_active_artifact_ref }),
    activePointerVersion: row.active_pointer_version,
    activatedBy: row.activated_by,
    activatedAt: timestamp(row.activated_at),
  });
}

function mapArtifact(row: ArtifactRow): CompiledArtifact {
  const envelope = record(row.definition);
  const stored = envelope['artifact'];
  if (!isRecord(stored)) throw coded('ARTIFACT_PERSISTENCE_ENVELOPE_INVALID');
  return createCompiledArtifact(
    {
      ...(stored as unknown as CompiledArtifact),
      status: row.artifact_status as CompiledArtifact['status'],
      ...(row.validation_summary_id === null
        ? {}
        : { validationSummaryRef: row.validation_summary_id }),
    },
    row.artifact_status === 'active'
      ? { validationPassed: true, approvalRecorded: true }
      : undefined,
  );
}

function projection(value: unknown): ShadowProjectionSnapshot {
  const source = record(value);
  return Object.freeze({
    ...(isRecord(source['decision']) ? { decision: source['decision'] } : {}),
    ...(isRecord(source['plan']) ? { plan: source['plan'] } : {}),
    criterionRefs: stringList(source['criterionRefs']),
    evidenceRefs: stringList(source['evidenceRefs']),
    ...(isRisk(source['riskLevel']) ? { riskLevel: source['riskLevel'] } : {}),
    ...(isFiniteNumber(source['estimatedCostUnits'])
      ? { estimatedCostUnits: source['estimatedCostUnits'] }
      : {}),
    ...(isFiniteNumber(source['estimatedLatencyMs'])
      ? { estimatedLatencyMs: source['estimatedLatencyMs'] }
      : {}),
    correctionRefs: stringList(source['correctionRefs']),
  });
}

async function writeOutbox(
  client: PoolClient,
  event: Readonly<{
    eventId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    occurredAt: string;
    payload: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
  const payload = JSON.stringify(event.payload);
  const inserted = await client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       correlation,payload,occurred_at,published_at)
     VALUES($1,$2,$3,$4,$5,'{}'::jsonb,$6::jsonb,$7,NULL)
     ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
    [
      event.eventId,
      event.eventType,
      event.aggregateType,
      event.aggregateId,
      event.aggregateVersion,
      payload,
      event.occurredAt,
    ],
  );
  if (inserted.rowCount === 1) return;
  const existing = await client.query<{ same: boolean }>(
    `SELECT event_type=$2 AND aggregate_type=$3 AND aggregate_id=$4
       AND aggregate_version=$5 AND payload=$6::jsonb AND occurred_at=$7::timestamptz AS same
     FROM cognitive_runtime_outbox WHERE event_id=$1`,
    [
      event.eventId,
      event.eventType,
      event.aggregateType,
      event.aggregateId,
      event.aggregateVersion,
      payload,
      event.occurredAt,
    ],
  );
  if (existing.rows[0]?.same !== true) throw coded('ARTIFACT_OUTBOX_IDEMPOTENCY_CONFLICT');
}

async function inTransaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await action(client);
    await client.query('COMMIT');
    return value;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function artifactRef(value: string): readonly [string, number] {
  const match = /^(.*):(\d+)$/u.exec(value);
  const artifactId = match?.[1];
  const versionText = match?.[2];
  if (artifactId === undefined || artifactId.length === 0 || versionText === undefined) {
    throw coded('ARTIFACT_REF_INVALID');
  }
  const version = Number(versionText);
  if (!Number.isSafeInteger(version) || version < 1) throw coded('ARTIFACT_REF_INVALID');
  return [artifactId, version];
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw coded('ARTIFACT_PERSISTED_JSON_INVALID');
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): readonly string[] {
  return Object.freeze(
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [],
  );
}

function isRisk(value: unknown): value is 'low' | 'medium' | 'high' | 'critical' {
  return typeof value === 'string' && ['low', 'medium', 'high', 'critical'].includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function required<T>(value: T | undefined, code: string): T {
  if (value === undefined) throw coded(code);
  return value;
}

function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}
