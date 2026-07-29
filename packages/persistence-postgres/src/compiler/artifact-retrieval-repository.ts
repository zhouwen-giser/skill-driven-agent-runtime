import type { Pool, PoolClient } from 'pg';

import type {
  ArtifactMatchAuditInput,
  ArtifactMatchAuditRepository,
  ArtifactRevalidationSignalPort,
  ArtifactValidationDependencyPort,
  RuntimeCandidateDecisionRepository,
} from '../../../application/src/index.js';
import {
  createArtifactRevalidationTrigger,
  type ArtifactRevalidationTrigger,
  type RuntimeExecutionDecision,
} from '../../../domain/src/index.js';

export class PostgresArtifactMatchAuditRepository implements ArtifactMatchAuditRepository {
  constructor(private readonly pool: Pool | PoolClient) {}

  async append(input: ArtifactMatchAuditInput): Promise<void> {
    const payload = [
      input.matchId,
      input.requestId,
      input.taskId,
      input.artifactId,
      JSON.stringify(input.score),
      JSON.stringify(input.applicability),
      input.decision,
      JSON.stringify([...input.reasonCodes]),
      input.policySnapshotHash,
      input.createdAt,
    ];
    const inserted = await this.pool.query(
      `INSERT INTO artifact_match_log(
         match_id,request_id,task_id,candidate_artifact_id,score,applicability,decision,
         reason_codes,policy_snapshot_hash,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9,$10)
       ON CONFLICT(match_id) DO NOTHING RETURNING match_id`,
      payload,
    );
    if (inserted.rowCount === 1) return;
    const existing = await this.pool.query<{ same: boolean }>(
      `SELECT request_id=$2 AND task_id=$3 AND candidate_artifact_id=$4
         AND score=$5::jsonb AND applicability=$6::jsonb AND decision=$7
         AND reason_codes=$8::jsonb AND policy_snapshot_hash=$9 AND created_at=$10::timestamptz AS same
       FROM artifact_match_log WHERE match_id=$1`,
      payload,
    );
    if (existing.rows[0]?.same !== true) {
      throw Object.assign(new Error('ARTIFACT_MATCH_AUDIT_IDEMPOTENCY_CONFLICT'), {
        code: 'ARTIFACT_MATCH_AUDIT_IDEMPOTENCY_CONFLICT',
      });
    }
  }
}

export class PostgresRuntimeCandidateDecisionRepository implements RuntimeCandidateDecisionRepository {
  constructor(private readonly pool: Pool | PoolClient) {}

  async append(
    input: Readonly<{ decision: RuntimeExecutionDecision; matchId?: string }>,
  ): Promise<void> {
    const decision = input.decision;
    const payload = [
      decision.decisionId,
      input.matchId ?? null,
      decision.requestId,
      decision.path,
      decision.selectedArtifactRef ?? null,
      JSON.stringify(decision.parameterBindings),
      JSON.stringify(decision.missingParameters),
      JSON.stringify(decision.requiredConfirmations),
      JSON.stringify(decision.reasonCodes),
      decision.matcherSnapshotHash,
      decision.policySnapshotHash,
      decision.createdAt,
    ];
    const inserted = await this.pool.query(
      `INSERT INTO runtime_candidate_decision(
         decision_id,match_id,request_id,path,selected_artifact_ref,parameter_bindings,
         missing_parameters,required_confirmations,reason_codes,matcher_snapshot_hash,
         policy_snapshot_hash,created_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)
       ON CONFLICT(decision_id) DO NOTHING RETURNING decision_id`,
      payload,
    );
    if (inserted.rowCount === 1) return;
    const existing = await this.pool.query<{ same: boolean }>(
      `SELECT match_id IS NOT DISTINCT FROM $2 AND request_id=$3 AND path=$4
         AND selected_artifact_ref IS NOT DISTINCT FROM $5 AND parameter_bindings=$6::jsonb
         AND missing_parameters=$7::jsonb AND required_confirmations=$8::jsonb
         AND reason_codes=$9::jsonb AND matcher_snapshot_hash=$10
         AND policy_snapshot_hash=$11 AND created_at=$12::timestamptz AS same
       FROM runtime_candidate_decision WHERE decision_id=$1`,
      payload,
    );
    if (existing.rows[0]?.same !== true) {
      throw Object.assign(new Error('RUNTIME_CANDIDATE_DECISION_IDEMPOTENCY_CONFLICT'), {
        code: 'RUNTIME_CANDIDATE_DECISION_IDEMPOTENCY_CONFLICT',
      });
    }
  }
}

/**
 * Reads the versions from the immutable validation and promotion records that
 * made this Artifact eligible. It has no lifecycle write path and deliberately
 * returns no value when evidence is absent, which makes P07 fail closed.
 */
export class PostgresArtifactValidationDependencyRepository implements ArtifactValidationDependencyPort {
  constructor(private readonly pool: Pool | PoolClient) {}

  async load(
    input: Readonly<{ artifactId: string; artifactVersion: number }>,
  ): Promise<Readonly<{ validatorVersion?: string; promotionPolicyVersion?: string }>> {
    const result = await this.pool.query<{
      validator_version: string | null;
      promotion_policy_version: string | null;
    }>(
      `SELECT
         (
           SELECT validation.validator_version
           FROM artifact_validation_run validation
           WHERE validation.artifact_id=$1 AND validation.artifact_version=$2
             AND validation.validation_type IN ('replay','revalidation')
             AND validation.status='passed' AND validation.validator_version IS NOT NULL
           ORDER BY validation.completed_at DESC NULLS LAST,validation.validation_run_id DESC
           LIMIT 1
         ) AS validator_version,
         (
           SELECT promotion.promotion_policy_version
           FROM artifact_promotion_package promotion
           WHERE promotion.artifact_id=$1 AND promotion.artifact_version=$2
             AND promotion.eligibility='eligible_for_review'
           ORDER BY promotion.created_at DESC,promotion.promotion_package_id DESC
           LIMIT 1
         ) AS promotion_policy_version`,
      [input.artifactId, input.artifactVersion],
    );
    const row = result.rows[0];
    return Object.freeze({
      ...(row?.validator_version === null || row?.validator_version === undefined
        ? {}
        : { validatorVersion: row.validator_version }),
      ...(row?.promotion_policy_version === null || row?.promotion_policy_version === undefined
        ? {}
        : { promotionPolicyVersion: row.promotion_policy_version }),
    });
  }
}

/** P07 asks the P06 authority to atomically create the worker-consumable run. */
export class ArtifactRevalidationSignalAdapter implements ArtifactRevalidationSignalPort {
  constructor(
    private readonly recorder: Readonly<{
      scheduleDependencyRevalidation(input: ArtifactRevalidationTrigger): Promise<void>;
    }>,
  ) {}

  signal(
    input: Readonly<{
      triggerId: string;
      artifactId: string;
      artifactVersion: number;
      artifactRef: string;
      sourceRefs: readonly string[];
      createdAt: string;
    }>,
  ): Promise<void> {
    if (input.artifactRef !== `${input.artifactId}:${String(input.artifactVersion)}`) {
      return Promise.reject(
        Object.assign(new Error('ARTIFACT_REVALIDATION_SIGNAL_REF_INVALID'), {
          code: 'ARTIFACT_REVALIDATION_SIGNAL_REF_INVALID',
        }),
      );
    }
    return this.recorder.scheduleDependencyRevalidation(
      createArtifactRevalidationTrigger({
        triggerId: input.triggerId,
        artifactRef: input.artifactRef,
        triggerType: triggerType(input.sourceRefs),
        sourceRefs: input.sourceRefs,
        severity: 'normal',
        createdAt: input.createdAt,
      }),
    );
  }
}

function triggerType(reasonCodes: readonly string[]): ArtifactRevalidationTrigger['triggerType'] {
  if (reasonCodes.includes('DEPENDENCY_CATALOG_MISMATCH')) return 'capability_catalog_changed';
  if (reasonCodes.includes('DEPENDENCY_POLICY_MISMATCH')) return 'policy_changed';
  if (reasonCodes.includes('DEPENDENCY_TASK_TYPE_MISMATCH')) return 'task_type_changed';
  if (reasonCodes.includes('DEPENDENCY_SCHEMA_MISMATCH')) return 'schema_changed';
  if (reasonCodes.includes('DEPENDENCY_COMPILER_MISMATCH')) return 'compiler_changed';
  return 'skill_changed';
}
