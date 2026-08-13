import type { Pool } from 'pg';

import { canonicalHash } from '../../application/src/index.js';
import type {
  GovernedControlAuthorityStore,
  GovernedControlConfirmation,
  GovernedControlConfirmationStore,
  GovernedControlRuntimeAuthoritySnapshot,
} from '../../application/src/index.js';

interface GovernedControlRow {
  readonly task_id: string;
  readonly task_phase: string;
  readonly task_plan_id: string;
  readonly selected_skill_id: string;
  readonly selected_skill_version: number;
  readonly binding_id: string;
  readonly capability_id: string;
  readonly capability_version: number;
  readonly input_snapshot: unknown;
  readonly constraint_snapshot: unknown;
  readonly evidence_requirement_snapshot: unknown;
  readonly initial_implementation_refs: unknown;
  readonly binding_hash: string;
  readonly attempt_id: string;
  readonly attempt_status: string;
  readonly attempt_plan_id: string | null;
  readonly skill_version_refs: unknown;
  readonly provider_binding_refs: unknown;
  readonly plan_id: string;
  readonly plan_confirmation_status: string;
  readonly plan_definition: unknown;
  readonly skill_id: string;
  readonly skill_version: number;
  readonly current_skill_version: number;
  readonly skill_status: string;
  readonly skill_validation_passed: boolean;
  readonly skill_capabilities: unknown;
  readonly skill_tool_policy: unknown;
  readonly skill_runtime_policy: unknown;
  readonly skill_outcome_specification: unknown;
  readonly readiness_id: string;
  readonly readiness_plan_id: string;
  readonly readiness_check_phase: string;
  readonly readiness_dsl_hash: string;
  readonly readiness_disposition: string;
  readonly readiness_guard_action: string;
  readonly readiness_confirmation_required: boolean;
  readonly readiness_server_id: string;
  readonly readiness_operation_name: string;
  readonly readiness_arguments_hash: string;
  readonly readiness_availability: string;
  readonly readiness_risk_level: string;
  readonly readiness_valid_until: Date | string | null;
  readonly readiness_checked_at: Date | string;
  readonly confirmation_id: string;
  readonly confirmation_task_id: string;
  readonly confirmation_capability_binding_id: string;
  readonly confirmation_capability_id: string;
  readonly confirmation_capability_version: number;
  readonly confirmation_plan_id: string;
  readonly confirmation_plan_hash: string;
  readonly confirmation_skill_id: string;
  readonly confirmation_skill_version: number;
  readonly confirmation_actor_id: string;
  readonly confirmation_actor_kind: 'human';
  readonly confirmation_authentication_method: string;
  readonly confirmation_actor_roles: unknown;
  readonly confirmation_reason: string;
  readonly confirmation_confirmed_at: Date | string;
  readonly confirmation_expires_at: Date | string;
  readonly confirmation_revoked_at: Date | string | null;
  readonly confirmation_revoked_by: string | null;
}

interface ConfirmationRow {
  readonly confirmation_id: string;
  readonly task_id: string;
  readonly capability_binding_id: string;
  readonly capability_id: string;
  readonly capability_version: number;
  readonly plan_id: string;
  readonly plan_hash: string;
  readonly skill_id: string;
  readonly skill_version: number;
  readonly actor_id: string;
  readonly actor_kind: 'human';
  readonly authentication_method: string;
  readonly actor_roles_json: unknown;
  readonly reason: string;
  readonly confirmed_at: Date | string;
  readonly expires_at: Date | string;
  readonly revoked_at: Date | string | null;
  readonly revoked_by: string | null;
}

/** PostgreSQL is the sole restart-safe authority for physical-control confirmation and admission. */
export class PostgresGovernedControlAuthorityRepository
  implements GovernedControlAuthorityStore, GovernedControlConfirmationStore
{
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async saveConfirmation(
    confirmation: GovernedControlConfirmation,
  ): Promise<GovernedControlConfirmation> {
    const result = await this.#pool.query<ConfirmationRow>(
      `INSERT INTO governed_control_confirmation(
         confirmation_id,task_id,capability_binding_id,capability_id,capability_version,
         plan_id,plan_hash,skill_id,skill_version,actor_id,actor_kind,authentication_method,
         actor_roles_json,reason,confirmed_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)
       RETURNING *`,
      [
        confirmation.confirmationId,
        confirmation.taskId,
        confirmation.capabilityBindingId,
        confirmation.capabilityId,
        confirmation.capabilityVersion,
        confirmation.planId,
        confirmation.planHash,
        confirmation.skillId,
        confirmation.skillVersion,
        confirmation.actorId,
        confirmation.actorKind,
        confirmation.authenticationMethod,
        JSON.stringify(confirmation.actorRoles),
        confirmation.reason,
        confirmation.confirmedAt,
        confirmation.expiresAt,
      ],
    );
    return mapConfirmation(requiredRow(result.rows[0]));
  }

  async revokeConfirmation(
    confirmationId: string,
    revokedBy: string,
    revokedAt: string,
  ): Promise<GovernedControlConfirmation | undefined> {
    const result = await this.#pool.query<ConfirmationRow>(
      `WITH updated AS (
         UPDATE governed_control_confirmation
            SET revoked_at=$3,revoked_by=$2
          WHERE confirmation_id=$1 AND revoked_at IS NULL
          RETURNING *
       )
       SELECT * FROM updated
       UNION ALL
       SELECT * FROM governed_control_confirmation
        WHERE confirmation_id=$1 AND NOT EXISTS(SELECT 1 FROM updated)
       LIMIT 1`,
      [confirmationId, revokedBy, revokedAt],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapConfirmation(row);
  }

  async load(
    input: Readonly<{
      taskId: string;
      serverId: string;
      toolName: string;
      argumentsHash: string;
    }>,
  ): Promise<GovernedControlRuntimeAuthoritySnapshot | undefined> {
    const result = await this.#pool.query<GovernedControlRow>(
      `SELECT
         task.task_id,task.phase AS task_phase,task.plan_id AS task_plan_id,
         task.selected_skill_id,task.selected_skill_version,
         binding.binding_id,binding.requested_capability_id AS capability_id,
         binding.capability_version,binding.input_snapshot,binding.constraint_snapshot,
         binding.evidence_requirement_snapshot,binding.initial_implementation_refs,
         binding.binding_hash,
         attempt.attempt_id,attempt.status AS attempt_status,attempt.plan_id AS attempt_plan_id,
         attempt.skill_version_refs,attempt.provider_binding_refs,
         plan.plan_id,plan.confirmation_status AS plan_confirmation_status,
         plan.definition_json AS plan_definition,
         version.skill_id,version.version AS skill_version,skill.current_version AS current_skill_version,
         CASE governance.lifecycle_status
           WHEN 'published' THEN 'enabled'
           WHEN 'suspended' THEN 'disabled'
           WHEN 'deprecated' THEN 'deprecated'
           WHEN 'retired' THEN 'deprecated'
           ELSE version.status
         END AS skill_status,
         version.validation_passed AS skill_validation_passed,
         version.capabilities_json AS skill_capabilities,
         version.tool_policy_json AS skill_tool_policy,
         version.runtime_policy_json AS skill_runtime_policy,
         outcome.specification_json AS skill_outcome_specification,
         readiness.readiness_id,readiness.workflow_plan_id AS readiness_plan_id,
         readiness.check_phase AS readiness_check_phase,readiness.dsl_hash AS readiness_dsl_hash,
         readiness.disposition AS readiness_disposition,
         readiness.guard_action AS readiness_guard_action,
         readiness.confirmation_required AS readiness_confirmation_required,
         readiness.server_id AS readiness_server_id,
         readiness.operation_name AS readiness_operation_name,
         readiness.arguments_hash AS readiness_arguments_hash,
         readiness.availability AS readiness_availability,
         readiness.risk_level AS readiness_risk_level,
         readiness.valid_until AS readiness_valid_until,
         readiness.checked_at AS readiness_checked_at,
         confirmation.confirmation_id,confirmation.task_id AS confirmation_task_id,
         confirmation.capability_binding_id AS confirmation_capability_binding_id,
         confirmation.capability_id AS confirmation_capability_id,
         confirmation.capability_version AS confirmation_capability_version,
         confirmation.plan_id AS confirmation_plan_id,
         confirmation.plan_hash AS confirmation_plan_hash,
         confirmation.skill_id AS confirmation_skill_id,
         confirmation.skill_version AS confirmation_skill_version,
         confirmation.actor_id AS confirmation_actor_id,
         confirmation.actor_kind AS confirmation_actor_kind,
         confirmation.authentication_method AS confirmation_authentication_method,
         confirmation.actor_roles_json AS confirmation_actor_roles,
         confirmation.reason AS confirmation_reason,
         confirmation.confirmed_at AS confirmation_confirmed_at,
         confirmation.expires_at AS confirmation_expires_at,
         confirmation.revoked_at AS confirmation_revoked_at,
         confirmation.revoked_by AS confirmation_revoked_by
       FROM agent_task task
       JOIN task_capability_binding binding ON binding.task_id=task.task_id
       JOIN LATERAL (
         SELECT current_attempt.*
           FROM task_capability_execution_attempt current_attempt
          WHERE current_attempt.task_id=task.task_id
          ORDER BY current_attempt.attempt_no DESC
          LIMIT 1
       ) attempt ON true
       JOIN workflow_plan plan ON plan.plan_id=task.plan_id
       JOIN skill ON skill.skill_id=task.selected_skill_id
       JOIN skill_version version
         ON version.skill_id=task.selected_skill_id
        AND version.version=task.selected_skill_version
       LEFT JOIN runtime_skill_version_governance governance
         ON governance.skill_id=version.skill_id AND governance.skill_version=version.version
       LEFT JOIN skill_outcome_specification outcome
         ON outcome.skill_id=version.skill_id AND outcome.skill_version=version.version
       JOIN LATERAL (
         SELECT execution.*,availability.server_id,availability.operation_name,
                availability.arguments_hash,availability.availability,availability.risk_level,
                availability.valid_until,availability.checked_at
           FROM task_execution_readiness execution
           JOIN task_availability_snapshot availability
             ON availability.readiness_id=execution.readiness_id
          WHERE execution.workflow_plan_id=plan.plan_id
            AND execution.check_phase='pre_invocation'
            AND availability.server_id=$2
            AND availability.operation_name=$3
            AND availability.arguments_hash=$4
          ORDER BY execution.created_at DESC,execution.readiness_id DESC
          LIMIT 1
       ) readiness ON true
       JOIN LATERAL (
         SELECT current_confirmation.*
           FROM governed_control_confirmation current_confirmation
          WHERE current_confirmation.task_id=task.task_id
            AND current_confirmation.capability_binding_id=binding.binding_id
            AND current_confirmation.plan_id=plan.plan_id
            AND current_confirmation.skill_id=version.skill_id
            AND current_confirmation.skill_version=version.version
          ORDER BY current_confirmation.confirmed_at DESC,current_confirmation.confirmation_id DESC
          LIMIT 1
       ) confirmation ON true
       WHERE task.task_id=$1`,
      [input.taskId, input.serverId, input.toolName, input.argumentsHash],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapAuthority(row);
  }
}

function mapAuthority(row: GovernedControlRow): GovernedControlRuntimeAuthoritySnapshot {
  return Object.freeze({
    task: Object.freeze({
      taskId: row.task_id,
      phase: row.task_phase,
      planId: row.task_plan_id,
      selectedSkillId: row.selected_skill_id,
      selectedSkillVersion: row.selected_skill_version,
    }),
    binding: Object.freeze({
      bindingId: row.binding_id,
      capabilityId: row.capability_id,
      capabilityVersion: row.capability_version,
      inputSnapshot: row.input_snapshot,
      constraintSnapshot: recordArray(row.constraint_snapshot),
      evidenceRequirementSnapshot: recordArray(row.evidence_requirement_snapshot),
      initialImplementationRefs: stringArray(row.initial_implementation_refs),
      bindingHash: row.binding_hash,
    }),
    attempt: Object.freeze({
      attemptId: row.attempt_id,
      status: row.attempt_status,
      ...(row.attempt_plan_id === null ? {} : { planId: row.attempt_plan_id }),
      skillVersionRefs: stringArray(row.skill_version_refs),
      providerBindingRefs: stringArray(row.provider_binding_refs),
    }),
    plan: Object.freeze({
      planId: row.plan_id,
      confirmationStatus: row.plan_confirmation_status,
      definitionHash: canonicalHash(row.plan_definition),
    }),
    skill: Object.freeze({
      skillId: row.skill_id,
      skillVersion: row.skill_version,
      currentVersion: row.current_skill_version,
      status: row.skill_status,
      validationPassed: row.skill_validation_passed,
      capabilities: stringArray(row.skill_capabilities),
      toolPolicy: record(row.skill_tool_policy),
      runtimePolicy: record(row.skill_runtime_policy),
      ...(row.skill_outcome_specification === null
        ? {}
        : { outcomeSpecification: record(row.skill_outcome_specification) }),
    }),
    readiness: Object.freeze({
      readinessId: row.readiness_id,
      workflowPlanId: row.readiness_plan_id,
      checkPhase: row.readiness_check_phase,
      dslHash: row.readiness_dsl_hash,
      disposition: row.readiness_disposition,
      guardAction: row.readiness_guard_action,
      confirmationRequired: row.readiness_confirmation_required,
      serverId: row.readiness_server_id,
      operationName: row.readiness_operation_name,
      argumentsHash: row.readiness_arguments_hash,
      availability: row.readiness_availability,
      riskLevel: row.readiness_risk_level,
      ...(row.readiness_valid_until === null ? {} : { validUntil: iso(row.readiness_valid_until) }),
      checkedAt: iso(row.readiness_checked_at),
    }),
    confirmation: mapConfirmation({
      confirmation_id: row.confirmation_id,
      task_id: row.confirmation_task_id,
      capability_binding_id: row.confirmation_capability_binding_id,
      capability_id: row.confirmation_capability_id,
      capability_version: row.confirmation_capability_version,
      plan_id: row.confirmation_plan_id,
      plan_hash: row.confirmation_plan_hash,
      skill_id: row.confirmation_skill_id,
      skill_version: row.confirmation_skill_version,
      actor_id: row.confirmation_actor_id,
      actor_kind: row.confirmation_actor_kind,
      authentication_method: row.confirmation_authentication_method,
      actor_roles_json: row.confirmation_actor_roles,
      reason: row.confirmation_reason,
      confirmed_at: row.confirmation_confirmed_at,
      expires_at: row.confirmation_expires_at,
      revoked_at: row.confirmation_revoked_at,
      revoked_by: row.confirmation_revoked_by,
    }),
  });
}

function mapConfirmation(row: ConfirmationRow): GovernedControlConfirmation {
  return Object.freeze({
    confirmationId: row.confirmation_id,
    taskId: row.task_id,
    capabilityBindingId: row.capability_binding_id,
    capabilityId: row.capability_id,
    capabilityVersion: row.capability_version,
    planId: row.plan_id,
    planHash: row.plan_hash,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    actorId: row.actor_id,
    actorKind: row.actor_kind,
    authenticationMethod: row.authentication_method,
    actorRoles: stringArray(row.actor_roles_json),
    reason: row.reason,
    confirmedAt: iso(row.confirmed_at),
    expiresAt: iso(row.expires_at),
    ...(row.revoked_at === null ? {} : { revokedAt: iso(row.revoked_at) }),
    ...(row.revoked_by === null ? {} : { revokedBy: row.revoked_by }),
  });
}

function requiredRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('GOVERNED_CONTROL_CONFIRMATION_NOT_PERSISTED');
  return row;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return Object.freeze({});
  return value as Readonly<Record<string, unknown>>;
}

function recordArray(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))
    ? Object.freeze(value as Readonly<Record<string, unknown>>[])
    : Object.freeze([]);
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? Object.freeze([...value])
    : Object.freeze([]);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
