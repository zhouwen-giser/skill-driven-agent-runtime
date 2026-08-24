import type { Pool } from 'pg';

import {
  GovernedControlConfirmationIssueConflictError,
  canonicalHash,
  confirmationExactScope,
} from '../../application/src/index.js';
import type {
  Clock,
  CurrentGovernedCapabilityAuthority,
  CurrentGovernedCapabilityAuthorityPort,
  CurrentMcpProviderBindingAuthorityPort,
  GovernedControlAuthorityStore,
  GovernedControlConfirmation,
  GovernedControlConfirmationConsumption,
  GovernedControlConsumedConfirmationReader,
  GovernedControlConfirmationOnceStore,
  GovernedControlConfirmationStore,
  GovernedControlRuntimeAuthoritySnapshot,
  GovernedControlConfirmationExactScope,
  GovernedControlConfirmationIssueResult,
  McpRuntimeBindingAuthorityVerifier,
  TaskAvailabilityBatchReader,
  UgvGovernedControlAuthoritySnapshot,
  UgvGovernedControlDispatchAuthorityReader,
  UgvGovernedControlDispatchAuthoritySnapshot,
  UgvGovernedControlInputAdapterPort,
  UgvGovernedControlIssueAuthorityReader,
} from '../../application/src/index.js';
import {
  createSelectedTaskOperation,
  hashCanonicalEvidenceJson,
  type McpTool,
  type SelectedTaskOperation,
  type SelectedTaskOperationDraft,
} from '../../domain/src/index.js';

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
  readonly confirmation_capability_attempt_id: string;
  readonly confirmation_plan_id: string;
  readonly confirmation_plan_hash: string;
  readonly confirmation_skill_id: string;
  readonly confirmation_skill_version: number;
  readonly confirmation_provider_binding_id: string;
  readonly confirmation_server_id: string;
  readonly confirmation_tool_name: string;
  readonly confirmation_arguments_hash: string;
  readonly confirmation_actor_id: string;
  readonly confirmation_actor_kind: 'human';
  readonly confirmation_authentication_method: string;
  readonly confirmation_actor_roles: unknown;
  readonly confirmation_reason: string;
  readonly confirmation_confirmed_at: Date | string;
  readonly confirmation_expires_at: Date | string;
  readonly confirmation_revoked_at: Date | string | null;
  readonly confirmation_revoked_by: string | null;
  readonly confirmation_consumed_invocation_id: string | null;
  readonly confirmation_consumed_dispatch_hash: string | null;
  readonly confirmation_consumed_at: Date | string | null;
}

interface ConfirmationRow {
  readonly confirmation_id: string;
  readonly task_id: string;
  readonly capability_binding_id: string;
  readonly capability_id: string;
  readonly capability_version: number;
  readonly capability_attempt_id: string;
  readonly plan_id: string;
  readonly plan_hash: string;
  readonly skill_id: string;
  readonly skill_version: number;
  readonly provider_binding_id: string;
  readonly server_id: string;
  readonly tool_name: string;
  readonly arguments_hash: string;
  readonly actor_id: string;
  readonly actor_kind: 'human';
  readonly authentication_method: string;
  readonly actor_roles_json: unknown;
  readonly reason: string;
  readonly confirmed_at: Date | string;
  readonly expires_at: Date | string;
  readonly revoked_at: Date | string | null;
  readonly revoked_by: string | null;
  readonly consumed_invocation_id: string | null;
  readonly consumed_dispatch_hash: string | null;
  readonly consumed_at: Date | string | null;
}

interface UgvGovernedControlBaseRow {
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
  readonly skill_runtime_policy: unknown;
  readonly skill_usage_specification: unknown;
  readonly skill_outcome_specification: unknown;
  readonly package_checksum: string;
  readonly selected_reference_count: number;
  readonly selected_reference_kind: string;
  readonly selected_reference_id: string;
  readonly selected_reference_type: string;
  readonly selected_reference_source_system: string;
  readonly selected_reference_checksum: string | null;
  readonly selected_reference_produced_at: Date | string | null;
  readonly selected_reference_producer_refs: unknown;
  readonly selected_reference_metadata: unknown;
  readonly confirmation_count: number | null;
  readonly ugv_confirmation_id: string | null;
  readonly ugv_confirmation_task_id: string | null;
  readonly ugv_confirmation_capability_binding_id: string | null;
  readonly ugv_confirmation_capability_id: string | null;
  readonly ugv_confirmation_capability_version: number | null;
  readonly ugv_confirmation_capability_attempt_id: string | null;
  readonly ugv_confirmation_plan_id: string | null;
  readonly ugv_confirmation_plan_hash: string | null;
  readonly ugv_confirmation_skill_id: string | null;
  readonly ugv_confirmation_skill_version: number | null;
  readonly ugv_confirmation_provider_binding_id: string | null;
  readonly ugv_confirmation_server_id: string | null;
  readonly ugv_confirmation_tool_name: string | null;
  readonly ugv_confirmation_arguments_hash: string | null;
  readonly ugv_confirmation_actor_id: string | null;
  readonly ugv_confirmation_actor_kind: 'human' | null;
  readonly ugv_confirmation_authentication_method: string | null;
  readonly ugv_confirmation_actor_roles: unknown;
  readonly ugv_confirmation_reason: string | null;
  readonly ugv_confirmation_confirmed_at: Date | string | null;
  readonly ugv_confirmation_expires_at: Date | string | null;
  readonly ugv_confirmation_revoked_at: Date | string | null;
  readonly ugv_confirmation_revoked_by: string | null;
  readonly ugv_confirmation_consumed_invocation_id: string | null;
  readonly ugv_confirmation_consumed_dispatch_hash: string | null;
  readonly ugv_confirmation_consumed_at: Date | string | null;
}

type UgvRuntimeBindingAuthorityPort = Pick<
  McpRuntimeBindingAuthorityVerifier,
  'loadRuntimeAuthority' | 'assertCurrent'
>;

/** PostgreSQL is the sole restart-safe authority for physical-control confirmation and admission. */
export class PostgresGovernedControlAuthorityRepository
  implements
    GovernedControlAuthorityStore,
    GovernedControlConfirmationStore,
    GovernedControlConfirmationOnceStore,
    GovernedControlConsumedConfirmationReader
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
         capability_attempt_id,plan_id,plan_hash,skill_id,skill_version,provider_binding_id,
         server_id,tool_name,arguments_hash,actor_id,actor_kind,authentication_method,
         actor_roles_json,reason,confirmed_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21)
       RETURNING *`,
      [
        confirmation.confirmationId,
        confirmation.taskId,
        confirmation.capabilityBindingId,
        confirmation.capabilityId,
        confirmation.capabilityVersion,
        confirmation.capabilityAttemptId,
        confirmation.planId,
        confirmation.planHash,
        confirmation.skillId,
        confirmation.skillVersion,
        confirmation.providerBindingId,
        confirmation.serverId,
        confirmation.toolName,
        confirmation.argumentsHash,
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

  async issueOnce(
    confirmation: GovernedControlConfirmation,
  ): Promise<GovernedControlConfirmationIssueResult> {
    // UGV confirmation ids are deterministic over the exact profile scope. The existing primary
    // key is therefore the narrow uniqueness authority needed for concurrent and restart retries.
    const inserted = await this.#pool.query<ConfirmationRow>(
      `INSERT INTO governed_control_confirmation(
         confirmation_id,task_id,capability_binding_id,capability_id,capability_version,
         capability_attempt_id,plan_id,plan_hash,skill_id,skill_version,provider_binding_id,
         server_id,tool_name,arguments_hash,actor_id,actor_kind,authentication_method,
         actor_roles_json,reason,confirmed_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21)
       ON CONFLICT (confirmation_id) DO NOTHING
       RETURNING *`,
      [...confirmationValues(confirmation)],
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow !== undefined)
      return Object.freeze({ confirmation: mapConfirmation(insertedRow), replayed: false });

    const replay = await this.findExact(confirmationExactScope(confirmation));
    if (replay === undefined) throw new GovernedControlConfirmationIssueConflictError();
    return Object.freeze({ confirmation: replay, replayed: true });
  }

  async findExact(
    scope: GovernedControlConfirmationExactScope,
  ): Promise<GovernedControlConfirmation | undefined> {
    const result = await this.#pool.query<ConfirmationRow>(
      `SELECT *
         FROM governed_control_confirmation
        WHERE confirmation_id=$1
          AND task_id=$2
          AND capability_binding_id=$3
          AND capability_id=$4
          AND capability_version=$5
          AND capability_attempt_id=$6
          AND plan_id=$7
          AND plan_hash=$8
          AND skill_id=$9
          AND skill_version=$10
          AND provider_binding_id=$11
          AND server_id=$12
          AND tool_name=$13
          AND arguments_hash=$14
          AND actor_id=$15
          AND actor_kind=$16
          AND authentication_method=$17
          AND actor_roles_json=$18::jsonb
          AND reason=$19
        LIMIT 1`,
      [...exactScopeValues(scope)],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapConfirmation(row);
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
          WHERE confirmation_id=$1 AND revoked_at IS NULL AND consumed_at IS NULL
          RETURNING *
       )
       SELECT * FROM updated
       UNION ALL
       SELECT * FROM governed_control_confirmation
        WHERE confirmation_id=$1 AND revoked_at IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM updated)
       LIMIT 1`,
      [confirmationId, revokedBy, revokedAt],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapConfirmation(row);
  }

  async consumeConfirmation(
    input: GovernedControlConfirmationConsumption,
  ): Promise<GovernedControlConfirmation | undefined> {
    const result = await this.#pool.query<ConfirmationRow>(
      `UPDATE governed_control_confirmation
          SET consumed_invocation_id=$9,consumed_dispatch_hash=$10,consumed_at=$11
        WHERE confirmation_id=$1
          AND task_id=$2
          AND capability_binding_id=$3
          AND capability_attempt_id=$4
          AND provider_binding_id=$5
          AND server_id=$6
          AND tool_name=$7
          AND arguments_hash=$8
          AND revoked_at IS NULL
          AND consumed_at IS NULL
          AND confirmed_at <= $11
          AND expires_at > $11
        RETURNING *`,
      [
        input.confirmationId,
        input.taskId,
        input.capabilityBindingId,
        input.capabilityAttemptId,
        input.providerBindingId,
        input.serverId,
        input.toolName,
        input.argumentsHash,
        input.invocationId,
        input.dispatchHash,
        input.consumedAt,
      ],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapConfirmation(row);
  }

  async findConsumedByInvocation(
    invocationId: string,
  ): Promise<GovernedControlConfirmation | undefined> {
    if (invocationId.trim() === '' || invocationId !== invocationId.trim())
      invalidUgvPersistedAuthority('Consumed UGV invocation id is invalid.');
    const result = await this.#pool.query<ConfirmationRow>(
      `SELECT *
         FROM governed_control_confirmation
        WHERE consumed_invocation_id=$1
          AND consumed_at IS NOT NULL
          AND consumed_dispatch_hash IS NOT NULL
          AND revoked_at IS NULL
        ORDER BY confirmation_id
        LIMIT 2`,
      [invocationId],
    );
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      row?.consumed_invocation_id !== invocationId ||
      row.consumed_dispatch_hash === null ||
      row.consumed_at === null ||
      row.revoked_at !== null
    )
      invalidUgvPersistedAuthority(
        'Consumed UGV invocation does not identify one exact complete confirmation.',
      );
    return mapConfirmation(row);
  }

  async load(
    input: Readonly<{
      taskId: string;
      capabilityAttemptId: string;
      providerBindingId: string;
      serverId: string;
      toolName: string;
      argumentsHash: string;
      readinessArgumentsHash: string;
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
         confirmation.capability_attempt_id AS confirmation_capability_attempt_id,
         confirmation.plan_id AS confirmation_plan_id,
         confirmation.plan_hash AS confirmation_plan_hash,
         confirmation.skill_id AS confirmation_skill_id,
         confirmation.skill_version AS confirmation_skill_version,
         confirmation.provider_binding_id AS confirmation_provider_binding_id,
         confirmation.server_id AS confirmation_server_id,
         confirmation.tool_name AS confirmation_tool_name,
         confirmation.arguments_hash AS confirmation_arguments_hash,
         confirmation.actor_id AS confirmation_actor_id,
         confirmation.actor_kind AS confirmation_actor_kind,
         confirmation.authentication_method AS confirmation_authentication_method,
         confirmation.actor_roles_json AS confirmation_actor_roles,
         confirmation.reason AS confirmation_reason,
         confirmation.confirmed_at AS confirmation_confirmed_at,
         confirmation.expires_at AS confirmation_expires_at,
         confirmation.revoked_at AS confirmation_revoked_at,
         confirmation.revoked_by AS confirmation_revoked_by,
         confirmation.consumed_invocation_id AS confirmation_consumed_invocation_id,
         confirmation.consumed_dispatch_hash AS confirmation_consumed_dispatch_hash,
         confirmation.consumed_at AS confirmation_consumed_at
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
            AND availability.arguments_hash=$7
          ORDER BY execution.created_at DESC,execution.readiness_id DESC
          LIMIT 1
       ) readiness ON true
       JOIN LATERAL (
         SELECT current_confirmation.*
           FROM governed_control_confirmation current_confirmation
           WHERE current_confirmation.task_id=task.task_id
             AND current_confirmation.capability_binding_id=binding.binding_id
             AND current_confirmation.capability_attempt_id=attempt.attempt_id
             AND current_confirmation.plan_id=plan.plan_id
             AND current_confirmation.skill_id=version.skill_id
             AND current_confirmation.skill_version=version.version
             AND current_confirmation.provider_binding_id=$5
             AND current_confirmation.server_id=$2
             AND current_confirmation.tool_name=$3
             AND current_confirmation.arguments_hash=$4
          ORDER BY
            CASE WHEN current_confirmation.revoked_at IS NULL
                       AND current_confirmation.consumed_at IS NULL
              THEN 0 ELSE 1 END,
            current_confirmation.confirmed_at DESC,current_confirmation.confirmation_id DESC
          LIMIT 1
       ) confirmation ON true
       WHERE task.task_id=$1 AND attempt.attempt_id=$6`,
      [
        input.taskId,
        input.serverId,
        input.toolName,
        input.argumentsHash,
        input.providerBindingId,
        input.capabilityAttemptId,
        input.readinessArgumentsHash,
      ],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapAuthority(row);
  }
}

/**
 * Rebuilds the UGV confirmation/admission snapshot from PostgreSQL system-of-record state and
 * freshly read mutable Node Binding, Runtime Catalog, and exact-argument availability authority.
 */
export class PostgresUgvGovernedControlAuthorityReader
  implements UgvGovernedControlIssueAuthorityReader, UgvGovernedControlDispatchAuthorityReader
{
  readonly #pool: Pool;
  readonly #capabilities: CurrentGovernedCapabilityAuthorityPort;
  readonly #providerBindings: CurrentMcpProviderBindingAuthorityPort;
  readonly #runtimeBindings: UgvRuntimeBindingAuthorityPort;
  readonly #availability: TaskAvailabilityBatchReader;
  readonly #inputAdapter: UgvGovernedControlInputAdapterPort;
  readonly #clock: Clock;

  constructor(
    dependencies: Readonly<{
      pool: Pool;
      capabilities: CurrentGovernedCapabilityAuthorityPort;
      providerBindings: CurrentMcpProviderBindingAuthorityPort;
      runtimeBindings: UgvRuntimeBindingAuthorityPort;
      availability: TaskAvailabilityBatchReader;
      inputAdapter: UgvGovernedControlInputAdapterPort;
      clock: Clock;
    }>,
  ) {
    this.#pool = dependencies.pool;
    this.#capabilities = dependencies.capabilities;
    this.#providerBindings = dependencies.providerBindings;
    this.#runtimeBindings = dependencies.runtimeBindings;
    this.#availability = dependencies.availability;
    this.#inputAdapter = dependencies.inputAdapter;
    this.#clock = dependencies.clock;
  }

  async loadForIssue(taskId: string): Promise<UgvGovernedControlAuthoritySnapshot | undefined> {
    return (await this.#load(taskId, undefined))?.snapshot;
  }

  async loadForPreInvocation(
    input: Readonly<{ taskId: string; capabilityAttemptId: string }>,
  ): Promise<UgvGovernedControlDispatchAuthoritySnapshot | undefined> {
    const loaded = await this.#load(input.taskId, input.capabilityAttemptId);
    if (loaded?.snapshot.attempt.capabilityAttemptId !== input.capabilityAttemptId)
      return undefined;
    const confirmation = exactUgvConfirmation(loaded.row);
    return Object.freeze({ ...loaded.snapshot, confirmation });
  }

  async #load(
    taskId: string,
    expectedAttemptId: string | undefined,
  ): Promise<
    | Readonly<{
        snapshot: UgvGovernedControlAuthoritySnapshot;
        row: UgvGovernedControlBaseRow;
      }>
    | undefined
  > {
    const row = await this.#loadPostgresSnapshot(taskId);
    if (
      row === undefined ||
      (expectedAttemptId !== undefined && row.attempt_id !== expectedAttemptId)
    )
      return undefined;
    const selected = selectedTaskOperationFromRow(row);
    assertExactUgvBindingInput(this.#inputAdapter, row.input_snapshot, selected);
    const [capability, providerBinding, runtime] = await Promise.all([
      this.#capabilities.load(row.capability_id, row.capability_version),
      this.#providerBindings.loadCurrentMcpProviderBinding({
        bindingId: selected.providerBinding.bindingId,
        localServerId: selected.server.serverId,
      }),
      this.#runtimeBindings.loadRuntimeAuthority(selected.server.serverId),
    ]);
    await this.#runtimeBindings.assertCurrent({
      authority: providerBinding,
      bindingId: selected.providerBinding.bindingId,
      localServerId: selected.server.serverId,
      providerId: selected.provider.providerId,
      runtimeAuthority: runtime,
    });
    const nodeId = `ugv-governed-control:${row.task_id}:${row.attempt_id}`;
    const availability = await this.#availability.checkTaskAvailability({
      serverId: selected.server.serverId,
      requests: Object.freeze([
        Object.freeze({
          nodeId,
          operationName: selected.operation.operationName,
          arguments: Object.freeze({
            unresolved: false as const,
            value: selected.resolvedArguments,
          }),
        }),
      ]),
      executionContext: Object.freeze({
        mode: 'simulation' as const,
        simulationId: selected.execution.simulationId,
      }),
    });
    const checkedAt = normalizedTimestamp(this.#clock.now());
    return Object.freeze({
      snapshot: buildUgvAuthoritySnapshot({
        row,
        selected,
        capability,
        providerBinding,
        runtime,
        availability,
        availabilityNodeId: nodeId,
        checkedAt,
      }),
      row,
    });
  }

  async #loadPostgresSnapshot(taskId: string): Promise<UgvGovernedControlBaseRow | undefined> {
    const result = await this.#pool.query<UgvGovernedControlBaseRow>(
      `SELECT
         task.task_id,task.phase AS task_phase,task.plan_id AS task_plan_id,
         task.selected_skill_id,task.selected_skill_version,
         binding.binding_id,binding.requested_capability_id AS capability_id,
         binding.capability_version,binding.input_snapshot,binding.constraint_snapshot,
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
         version.runtime_policy_json AS skill_runtime_policy,
         version.usage_specification_json AS skill_usage_specification,
         outcome.specification_json AS skill_outcome_specification,
         package.package_checksum,
         selected_ref.selected_reference_count,selected_ref.kind AS selected_reference_kind,
         selected_ref.reference_id AS selected_reference_id,
         selected_ref.reference_type AS selected_reference_type,
         selected_ref.source_system AS selected_reference_source_system,
         selected_ref.checksum AS selected_reference_checksum,
         selected_ref.produced_at AS selected_reference_produced_at,
         selected_ref.producer_refs_json AS selected_reference_producer_refs,
         selected_ref.metadata_json AS selected_reference_metadata,
         confirmation.confirmation_count,
         confirmation.confirmation_id AS ugv_confirmation_id,
         confirmation.task_id AS ugv_confirmation_task_id,
         confirmation.capability_binding_id AS ugv_confirmation_capability_binding_id,
         confirmation.capability_id AS ugv_confirmation_capability_id,
         confirmation.capability_version AS ugv_confirmation_capability_version,
         confirmation.capability_attempt_id AS ugv_confirmation_capability_attempt_id,
         confirmation.plan_id AS ugv_confirmation_plan_id,
         confirmation.plan_hash AS ugv_confirmation_plan_hash,
         confirmation.skill_id AS ugv_confirmation_skill_id,
         confirmation.skill_version AS ugv_confirmation_skill_version,
         confirmation.provider_binding_id AS ugv_confirmation_provider_binding_id,
         confirmation.server_id AS ugv_confirmation_server_id,
         confirmation.tool_name AS ugv_confirmation_tool_name,
         confirmation.arguments_hash AS ugv_confirmation_arguments_hash,
         confirmation.actor_id AS ugv_confirmation_actor_id,
         confirmation.actor_kind AS ugv_confirmation_actor_kind,
         confirmation.authentication_method AS ugv_confirmation_authentication_method,
         confirmation.actor_roles_json AS ugv_confirmation_actor_roles,
         confirmation.reason AS ugv_confirmation_reason,
         confirmation.confirmed_at AS ugv_confirmation_confirmed_at,
         confirmation.expires_at AS ugv_confirmation_expires_at,
         confirmation.revoked_at AS ugv_confirmation_revoked_at,
         confirmation.revoked_by AS ugv_confirmation_revoked_by,
         confirmation.consumed_invocation_id AS ugv_confirmation_consumed_invocation_id,
         confirmation.consumed_dispatch_hash AS ugv_confirmation_consumed_dispatch_hash,
         confirmation.consumed_at AS ugv_confirmation_consumed_at
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
       JOIN skill_package_import_audit package
         ON package.skill_id=version.skill_id AND package.skill_version=version.version
       JOIN skill_execution_record execution
         ON execution.task_id=task.task_id
        AND execution.workflow_plan_id=plan.plan_id
        AND execution.skill_id=version.skill_id
        AND execution.skill_version=version.version
       JOIN LATERAL (
         SELECT current_reference.*,
                count(*) OVER()::integer AS selected_reference_count
           FROM skill_execution_reference current_reference
          WHERE current_reference.execution_id=execution.execution_id
            AND current_reference.reference_type='ugv.selected_task_operation/v1'
          ORDER BY current_reference.created_at,current_reference.link_id
          LIMIT 1
       ) selected_ref ON true
       LEFT JOIN skill_outcome_specification outcome
         ON outcome.skill_id=version.skill_id AND outcome.skill_version=version.version
       LEFT JOIN LATERAL (
         SELECT current_confirmation.*,
                count(*) OVER()::integer AS confirmation_count
           FROM governed_control_confirmation current_confirmation
          WHERE current_confirmation.task_id=task.task_id
            AND current_confirmation.capability_binding_id=binding.binding_id
            AND current_confirmation.capability_attempt_id=attempt.attempt_id
            AND current_confirmation.plan_id=plan.plan_id
            AND current_confirmation.skill_id=version.skill_id
            AND current_confirmation.skill_version=version.version
            AND current_confirmation.provider_binding_id=
                selected_ref.metadata_json #>> '{snapshot,providerBinding,bindingId}'
            AND current_confirmation.server_id=
                selected_ref.metadata_json #>> '{snapshot,server,serverId}'
            AND current_confirmation.tool_name=
                selected_ref.metadata_json #>> '{snapshot,operation,operationName}'
            AND current_confirmation.arguments_hash=
                substring(selected_ref.metadata_json #>> '{snapshot,argumentsHash}' FROM 8)
            AND current_confirmation.revoked_at IS NULL
            AND current_confirmation.consumed_at IS NULL
          ORDER BY current_confirmation.confirmed_at,current_confirmation.confirmation_id
          LIMIT 1
       ) confirmation ON true
       WHERE task.task_id=$1`,
      [taskId],
    );
    return result.rows[0];
  }
}

type CurrentProviderBinding = Awaited<
  ReturnType<CurrentMcpProviderBindingAuthorityPort['loadCurrentMcpProviderBinding']>
>;
type RuntimeCatalog = Awaited<ReturnType<UgvRuntimeBindingAuthorityPort['loadRuntimeAuthority']>>;
type AvailabilityRead = Awaited<ReturnType<TaskAvailabilityBatchReader['checkTaskAvailability']>>;

function assertExactUgvBindingInput(
  adapter: UgvGovernedControlInputAdapterPort,
  inputSnapshot: unknown,
  selected: SelectedTaskOperation,
): void {
  try {
    const adapted = adapter.adapt(inputSnapshot);
    const adaptedArgumentsHash = hashCanonicalEvidenceJson(adapted.providerArguments);
    if (
      adapted.argumentsHash !== selected.argumentsHash ||
      adaptedArgumentsHash !== selected.argumentsHash ||
      adaptedArgumentsHash !== hashCanonicalEvidenceJson(selected.resolvedArguments)
    )
      invalidUgvPersistedAuthority(
        'Frozen UGV Binding input does not adapt to the persisted Selected Task arguments.',
      );
  } catch (error: unknown) {
    if (error instanceof PostgresUgvGovernedControlAuthorityError) throw error;
    invalidUgvPersistedAuthority('Frozen UGV Binding input cannot be deterministically adapted.');
  }
}

function buildUgvAuthoritySnapshot(
  input: Readonly<{
    row: UgvGovernedControlBaseRow;
    selected: SelectedTaskOperation;
    capability: CurrentGovernedCapabilityAuthority;
    providerBinding: CurrentProviderBinding;
    runtime: RuntimeCatalog;
    availability: AvailabilityRead;
    availabilityNodeId: string;
    checkedAt: string;
  }>,
): UgvGovernedControlAuthoritySnapshot {
  const { row, selected } = input;
  const definition = strictRecord(input.capability.definition);
  const constraints = strictRecordArray(definition['constraints']);
  const physical = exactlyOneRecord(constraints, 'physical_side_effect_policy');
  const implementations = input.capability.implementationBindings.filter(
    (candidate) =>
      candidate['capability_id'] === row.capability_id &&
      candidate['capability_version'] === row.capability_version &&
      candidate['implementation_type'] === 'skill' &&
      candidate['implementation_id'] === selected.skill.skillId &&
      candidate['implementation_version'] === String(selected.skill.version) &&
      candidate['role'] === 'primary' &&
      candidate['status'] === 'active',
  );
  const implementation = implementations[0];
  const providerOverride = strictRecord(implementation?.['provider_policy_override']);
  if (
    implementations.length !== 1 ||
    canonicalHash(constraints) !== canonicalHash(row.constraint_snapshot) ||
    physical['sideEffecting'] !== true ||
    physical['dispatchMaximum'] !== 1 ||
    providerOverride['selection'] !== 'required' ||
    providerOverride['mcpProviderBindingId'] !== selected.providerBinding.bindingId ||
    providerOverride['localServerId'] !== selected.server.serverId ||
    providerOverride['mcpToolName'] !== selected.operation.operationName ||
    providerOverride['requireActive'] !== true ||
    providerOverride['requireAvailable'] !== true ||
    providerOverride['requireUnexpiredFreshness'] !== true ||
    providerOverride['denyFallback'] !== true
  )
    invalidUgvPersistedAuthority('Current Capability implementation authority is not exact.');

  const provider = input.runtime.snapshot.providerCatalog;
  const currentBinding = input.providerBinding.binding;
  if (
    provider === undefined ||
    currentBinding.originType !== 'smpp_registry' ||
    currentBinding.bindingId !== selected.providerBinding.bindingId ||
    currentBinding.revision !== selected.providerBinding.revision ||
    currentBinding.localServerId !== selected.server.serverId ||
    currentBinding.providerId !== selected.provider.providerId ||
    input.runtime.record.server.serverId !== selected.server.serverId
  )
    invalidUgvPersistedAuthority('Current SMPP Binding or Runtime Provider identity is not exact.');
  const navigate = exactRuntimeTool(input.runtime.tools, selected.operation.operationName);
  const finalState = exactRuntimeTool(input.runtime.tools, selected.finalStateRead.operationName);
  const availability = exactAvailability(input.availability, input.availabilityNodeId, selected);
  const runtimePolicy = strictRecord(row.skill_runtime_policy);
  const outcome = strictRecord(row.skill_outcome_specification);
  const usage = strictRecord(row.skill_usage_specification);
  const evidencePolicy = strictRecord(usage['evidencePolicy']);
  const finalPosition = strictRecordArray(evidencePolicy['requirements']).filter(
    (candidate) => candidate['requirementId'] === 'final-position',
  );
  const finalPositionRequirement = finalPosition[0];
  return Object.freeze({
    selectedTaskOperation: selected,
    task: Object.freeze({
      taskId: row.task_id,
      phase: row.task_phase,
      planId: row.task_plan_id,
      selectedSkillId: row.selected_skill_id,
      selectedSkillVersion: row.selected_skill_version,
    }),
    capability: Object.freeze({
      capabilityId: requiredDatabaseString(definition['capability_id']),
      capabilityVersion: positiveDatabaseInteger(definition['version']),
      status: requiredDatabaseString(definition['status']),
      riskLevel: requiredDatabaseString(definition['risk_level']),
      supportedModes: stringArray(definition['supported_modes']),
      implementationSkillId: requiredDatabaseString(implementation?.['implementation_id']),
      implementationSkillVersion: positiveDatabaseInteger(
        Number(implementation?.['implementation_version']),
      ),
      dispatchMaximum: positiveDatabaseInteger(physical['dispatchMaximum']),
    }),
    binding: Object.freeze({
      capabilityBindingId: row.binding_id,
      capabilityId: row.capability_id,
      capabilityVersion: row.capability_version,
      providerBindingId: selected.providerBinding.bindingId,
      providerBindingRevision: selected.providerBinding.revision,
      selectedTaskOperationSnapshotHash: selected.snapshotHash,
      bindingHash: row.binding_hash.trim(),
    }),
    attempt: Object.freeze({
      capabilityAttemptId: row.attempt_id,
      status: row.attempt_status,
      planId: row.attempt_plan_id ?? '',
      skillVersionRefs: stringArray(row.skill_version_refs),
      providerBindingRefs: stringArray(row.provider_binding_refs),
    }),
    plan: Object.freeze({
      planId: row.plan_id,
      definitionHash: canonicalHash(row.plan_definition),
      confirmationStatus: row.plan_confirmation_status,
      selectedTaskOperationSnapshotHash: selected.snapshotHash,
    }),
    skill: Object.freeze({
      skillId: row.skill_id,
      skillVersion: row.skill_version,
      currentVersion: row.current_skill_version,
      status: row.skill_status,
      validationPassed: row.skill_validation_passed,
      packageChecksum: row.package_checksum.trim(),
      capabilities: stringArray(row.skill_capabilities),
      runtimePolicy: Object.freeze({
        autoConfirmPlan: runtimePolicy['autoConfirmPlan'] === true,
        maxMcpCalls: integerOrZero(runtimePolicy['maxMcpCalls']),
      }),
      outcome: Object.freeze({
        effects: stringArray(outcome['effects']),
        evidence: stringArray(outcome['evidence']),
        finalPositionHardGate:
          finalPosition.length === 1 &&
          finalPositionRequirement?.['required'] === true &&
          finalPositionRequirement['hardGate'] === true,
        rejectSuccessWithoutRequiredEvidence:
          evidencePolicy['rejectSuccessWithoutRequiredEvidence'] === true,
      }),
    }),
    providerBinding: Object.freeze({
      bindingId: currentBinding.bindingId,
      revision: currentBinding.revision,
      status: 'active',
      availability: availability.availability,
      availabilityValidUntil: currentBinding.availabilityValidUntil,
      providerId: provider.providerId,
      providerType: provider.providerType,
      providerVersion: provider.providerVersion,
      manifestHash: provider.manifestHash,
      serverId: input.runtime.record.server.serverId,
      catalogRevision: input.runtime.catalogAuthority.catalogRevision,
      catalogChecksum: input.runtime.catalogAuthority.catalogChecksum,
    }),
    catalog: Object.freeze({
      providerId: provider.providerId,
      providerType: provider.providerType,
      providerVersion: provider.providerVersion,
      manifestHash: provider.manifestHash,
      serverId: input.runtime.record.server.serverId,
      discoverySnapshotId: input.runtime.snapshot.snapshotId,
      catalogRevision: input.runtime.catalogAuthority.catalogRevision,
      catalogChecksum: input.runtime.catalogAuthority.catalogChecksum,
      navigate: catalogOperation(navigate, input.runtime.record.server.toolRevision),
      finalStateRead: catalogOperation(finalState, input.runtime.record.server.toolRevision),
    }),
    readiness: Object.freeze({
      checkPhase: 'pre_invocation',
      disposition: availability.availability === 'available' ? 'ready' : 'blocked',
      guardAction: availability.availability === 'available' ? 'proceed' : 'abort',
      confirmationRequired: false,
      providerBindingId: currentBinding.bindingId,
      providerBindingRevision: currentBinding.revision,
      serverId: selected.server.serverId,
      providerId: provider.providerId,
      operationName: selected.operation.operationName,
      resourceId: selected.resource.resourceId,
      argumentsHash: selected.argumentsHash,
      selectedTaskOperationSnapshotHash: selected.snapshotHash,
      catalogRevision: input.runtime.catalogAuthority.catalogRevision,
      catalogChecksum: input.runtime.catalogAuthority.catalogChecksum,
      toolRevision: input.runtime.record.server.toolRevision,
      availability: availability.availability,
      riskLevel: availability.riskLevel,
      checkedAt: input.checkedAt,
      validUntil: requiredDatabaseString(availability.validUntil),
    }),
  });
}

function selectedTaskOperationFromRow(row: UgvGovernedControlBaseRow): SelectedTaskOperation {
  const metadata = strictRecord(row.selected_reference_metadata);
  const raw = strictRecord(metadata['snapshot']);
  const claimedHash = raw['snapshotHash'];
  if (
    row.selected_reference_count !== 1 ||
    row.selected_reference_kind !== 'remote_task_binding' ||
    row.selected_reference_type !== 'ugv.selected_task_operation/v1' ||
    row.selected_reference_source_system !== 'ugv-agent-profile' ||
    metadata['schemaVersion'] !== 'ugv.selected_task_operation/v1' ||
    typeof claimedHash !== 'string'
  )
    invalidUgvPersistedAuthority(
      'Exactly one valid Selected Task operation reference is required.',
    );
  const draft = Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== 'snapshotHash'),
  ) as unknown as SelectedTaskOperationDraft;
  let selected: SelectedTaskOperation;
  try {
    selected = createSelectedTaskOperation(draft);
  } catch {
    return invalidUgvPersistedAuthority('Selected Task operation cannot be reconstructed.');
  }
  const expectedProducerRefs = [
    ...new Set([
      selected.skill.packageChecksum,
      selected.provider.manifestHash,
      selected.server.catalogChecksum,
    ]),
  ];
  if (
    selected.snapshotHash !== claimedHash ||
    selected.snapshotHash !== row.selected_reference_id ||
    selected.snapshotHash.slice('sha256:'.length) !== row.selected_reference_checksum ||
    row.selected_reference_produced_at === null ||
    normalizedTimestamp(row.selected_reference_produced_at) !== selected.selectedAt ||
    !sameStringArrays(stringArray(row.selected_reference_producer_refs), expectedProducerRefs) ||
    row.package_checksum.trim() !== selected.skill.packageChecksum
  )
    invalidUgvPersistedAuthority('Selected Task operation lineage or package checksum is invalid.');
  return selected;
}

function exactUgvConfirmation(row: UgvGovernedControlBaseRow): GovernedControlConfirmation {
  if (
    row.confirmation_count !== 1 ||
    row.ugv_confirmation_id === null ||
    row.ugv_confirmation_task_id === null ||
    row.ugv_confirmation_capability_binding_id === null ||
    row.ugv_confirmation_capability_id === null ||
    row.ugv_confirmation_capability_version === null ||
    row.ugv_confirmation_capability_attempt_id === null ||
    row.ugv_confirmation_plan_id === null ||
    row.ugv_confirmation_plan_hash === null ||
    row.ugv_confirmation_skill_id === null ||
    row.ugv_confirmation_skill_version === null ||
    row.ugv_confirmation_provider_binding_id === null ||
    row.ugv_confirmation_server_id === null ||
    row.ugv_confirmation_tool_name === null ||
    row.ugv_confirmation_arguments_hash === null ||
    row.ugv_confirmation_actor_id === null ||
    row.ugv_confirmation_actor_kind === null ||
    row.ugv_confirmation_authentication_method === null ||
    row.ugv_confirmation_reason === null ||
    row.ugv_confirmation_confirmed_at === null ||
    row.ugv_confirmation_expires_at === null
  )
    invalidUgvPersistedAuthority(
      'Pre-invocation authority requires exactly one current unconsumed confirmation.',
    );
  return mapConfirmation({
    confirmation_id: row.ugv_confirmation_id,
    task_id: row.ugv_confirmation_task_id,
    capability_binding_id: row.ugv_confirmation_capability_binding_id,
    capability_id: row.ugv_confirmation_capability_id,
    capability_version: row.ugv_confirmation_capability_version,
    capability_attempt_id: row.ugv_confirmation_capability_attempt_id,
    plan_id: row.ugv_confirmation_plan_id,
    plan_hash: row.ugv_confirmation_plan_hash,
    skill_id: row.ugv_confirmation_skill_id,
    skill_version: row.ugv_confirmation_skill_version,
    provider_binding_id: row.ugv_confirmation_provider_binding_id,
    server_id: row.ugv_confirmation_server_id,
    tool_name: row.ugv_confirmation_tool_name,
    arguments_hash: row.ugv_confirmation_arguments_hash,
    actor_id: row.ugv_confirmation_actor_id,
    actor_kind: row.ugv_confirmation_actor_kind,
    authentication_method: row.ugv_confirmation_authentication_method,
    actor_roles_json: row.ugv_confirmation_actor_roles,
    reason: row.ugv_confirmation_reason,
    confirmed_at: row.ugv_confirmation_confirmed_at,
    expires_at: row.ugv_confirmation_expires_at,
    revoked_at: row.ugv_confirmation_revoked_at,
    revoked_by: row.ugv_confirmation_revoked_by,
    consumed_invocation_id: row.ugv_confirmation_consumed_invocation_id,
    consumed_dispatch_hash: row.ugv_confirmation_consumed_dispatch_hash,
    consumed_at: row.ugv_confirmation_consumed_at,
  });
}

function exactRuntimeTool(tools: readonly McpTool[], operationName: string): McpTool {
  const matching = tools.filter((tool) => tool.toolName === operationName);
  const tool = matching[0];
  if (
    matching.length !== 1 ||
    tool?.outputSchema === undefined ||
    tool.taskExecutionProfile === undefined
  )
    invalidUgvPersistedAuthority(`Current Catalog lacks one exact ${operationName} contract.`);
  return tool;
}

function catalogOperation(tool: McpTool, toolRevision: number) {
  const profile = tool.taskExecutionProfile;
  if (profile === undefined || tool.outputSchema === undefined)
    invalidUgvPersistedAuthority('Current UGV Tool contract is incomplete.');
  return Object.freeze({
    operationName: tool.toolName,
    toolRevision,
    inputSchemaHash: hashCanonicalEvidenceJson(tool.inputSchema),
    outputSchemaHash: hashCanonicalEvidenceJson(tool.outputSchema),
    executionSemantics: tool.executionSemantics,
    taskExecutionProfile: profile,
  });
}

function exactAvailability(
  read: AvailabilityRead,
  nodeId: string,
  selected: SelectedTaskOperation,
) {
  if (
    read.kind !== 'results' ||
    read.protocolRevision !== selected.availability.protocolRevision ||
    read.availabilitySchemaRevision !== selected.availability.schemaRevision
  )
    invalidUgvPersistedAuthority('Current exact-argument availability could not be read.');
  const matching = read.results.filter(
    (candidate) =>
      candidate.nodeId === nodeId && candidate.operationName === selected.operation.operationName,
  );
  const result = matching[0];
  if (matching.length !== 1 || result?.validUntil === undefined)
    invalidUgvPersistedAuthority('Current UGV readiness is missing or ambiguous.');
  return result;
}

function exactlyOneRecord(
  records: readonly Readonly<Record<string, unknown>>[],
  type: string,
): Readonly<Record<string, unknown>> {
  const matching = records.filter((candidate) => candidate['type'] === type);
  const result = matching[0];
  if (matching.length !== 1 || result === undefined)
    invalidUgvPersistedAuthority(`Current authority requires exactly one ${type}.`);
  return result;
}

function strictRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalidUgvPersistedAuthority('UGV authority contains a malformed object.');
  return value as Readonly<Record<string, unknown>>;
}

function strictRecordArray(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value))
    invalidUgvPersistedAuthority('UGV authority contains a malformed object array.');
  return value.map(strictRecord);
}

function requiredDatabaseString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '')
    invalidUgvPersistedAuthority('UGV authority contains a missing string.');
  return value.trim();
}

function positiveDatabaseInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    invalidUgvPersistedAuthority('UGV authority contains an invalid positive integer.');
  return value;
}

function integerOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
}

function normalizedTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf()))
    invalidUgvPersistedAuthority('UGV authority timestamp is invalid.');
  return date.toISOString();
}

function sameStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class PostgresUgvGovernedControlAuthorityError extends Error {
  readonly code = 'UGV_GOVERNED_CONTROL_PERSISTED_AUTHORITY_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'PostgresUgvGovernedControlAuthorityError';
  }
}

function invalidUgvPersistedAuthority(message: string): never {
  throw new PostgresUgvGovernedControlAuthorityError(message);
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
      capability_attempt_id: row.confirmation_capability_attempt_id,
      plan_id: row.confirmation_plan_id,
      plan_hash: row.confirmation_plan_hash,
      skill_id: row.confirmation_skill_id,
      skill_version: row.confirmation_skill_version,
      provider_binding_id: row.confirmation_provider_binding_id,
      server_id: row.confirmation_server_id,
      tool_name: row.confirmation_tool_name,
      arguments_hash: row.confirmation_arguments_hash,
      actor_id: row.confirmation_actor_id,
      actor_kind: row.confirmation_actor_kind,
      authentication_method: row.confirmation_authentication_method,
      actor_roles_json: row.confirmation_actor_roles,
      reason: row.confirmation_reason,
      confirmed_at: row.confirmation_confirmed_at,
      expires_at: row.confirmation_expires_at,
      revoked_at: row.confirmation_revoked_at,
      revoked_by: row.confirmation_revoked_by,
      consumed_invocation_id: row.confirmation_consumed_invocation_id,
      consumed_dispatch_hash: row.confirmation_consumed_dispatch_hash,
      consumed_at: row.confirmation_consumed_at,
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
    capabilityAttemptId: row.capability_attempt_id,
    planId: row.plan_id,
    planHash: row.plan_hash,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    providerBindingId: row.provider_binding_id,
    serverId: row.server_id,
    toolName: row.tool_name,
    argumentsHash: row.arguments_hash.trim(),
    actorId: row.actor_id,
    actorKind: row.actor_kind,
    authenticationMethod: row.authentication_method,
    actorRoles: stringArray(row.actor_roles_json),
    reason: row.reason,
    confirmedAt: iso(row.confirmed_at),
    expiresAt: iso(row.expires_at),
    ...(row.revoked_at === null ? {} : { revokedAt: iso(row.revoked_at) }),
    ...(row.revoked_by === null ? {} : { revokedBy: row.revoked_by }),
    ...(row.consumed_invocation_id === null
      ? {}
      : { consumedInvocationId: row.consumed_invocation_id }),
    ...(row.consumed_dispatch_hash === null
      ? {}
      : { consumedDispatchHash: row.consumed_dispatch_hash }),
    ...(row.consumed_at === null ? {} : { consumedAt: iso(row.consumed_at) }),
  });
}

function confirmationValues(confirmation: GovernedControlConfirmation): readonly unknown[] {
  return Object.freeze([
    ...exactScopeValues(confirmationExactScope(confirmation)),
    confirmation.confirmedAt,
    confirmation.expiresAt,
  ]);
}

function exactScopeValues(scope: GovernedControlConfirmationExactScope): readonly unknown[] {
  return Object.freeze([
    scope.confirmationId,
    scope.taskId,
    scope.capabilityBindingId,
    scope.capabilityId,
    scope.capabilityVersion,
    scope.capabilityAttemptId,
    scope.planId,
    scope.planHash,
    scope.skillId,
    scope.skillVersion,
    scope.providerBindingId,
    scope.serverId,
    scope.toolName,
    scope.argumentsHash,
    scope.actorId,
    scope.actorKind,
    scope.authenticationMethod,
    JSON.stringify(scope.actorRoles),
    scope.reason,
  ]);
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
