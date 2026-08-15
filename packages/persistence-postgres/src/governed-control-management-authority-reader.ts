import type { Pool } from 'pg';

import {
  canonicalHash,
  GovernedControlManagementError,
  type GovernedControlIssueAuthority,
  type GovernedControlManagementAuthorityReader,
  type GovernedControlRevocationAuthority,
} from '../../application/src/index.js';

interface AuthorityRow {
  readonly task_id: string;
  readonly task_phase: string;
  readonly task_plan_id: string | null;
  readonly selected_skill_id: string | null;
  readonly selected_skill_version: number | null;
  readonly binding_id: string | null;
  readonly capability_id: string | null;
  readonly capability_version: number | null;
  readonly input_snapshot: unknown;
  readonly constraint_snapshot: unknown;
  readonly initial_implementation_refs: unknown;
  readonly attempt_id: string | null;
  readonly attempt_status: string | null;
  readonly attempt_plan_id: string | null;
  readonly attempt_skill_version_refs: unknown;
  readonly attempt_provider_binding_refs: unknown;
  readonly plan_id: string | null;
  readonly plan_confirmation_status: string | null;
  readonly plan_definition: unknown;
  readonly skill_id: string | null;
  readonly skill_version: number | null;
  readonly current_skill_version: number | null;
  readonly skill_status: string | null;
  readonly skill_validation_passed: boolean | null;
  readonly skill_capabilities: unknown;
  readonly skill_tool_policy: unknown;
  readonly skill_runtime_policy: unknown;
  readonly skill_outcome_specification: unknown;
}

const TERMINAL_TASK_PHASES = new Set(['completed', 'failed', 'canceled', 'invalidated']);
const ACTIVE_ATTEMPT_STATUSES = new Set(['prepared', 'running', 'waiting']);

/** Reads the complete confirmation scope from one PostgreSQL statement snapshot. */
export class PostgresGovernedControlManagementAuthorityReader implements GovernedControlManagementAuthorityReader {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async issueAuthority(taskId: string): Promise<GovernedControlIssueAuthority | undefined> {
    const result = await this.#pool.query<AuthorityRow>(
      `SELECT task.task_id,task.phase AS task_phase,task.plan_id AS task_plan_id,
              task.selected_skill_id,task.selected_skill_version,
              binding.binding_id,binding.requested_capability_id AS capability_id,
              binding.capability_version,binding.input_snapshot,binding.constraint_snapshot,
              binding.initial_implementation_refs,
              attempt.attempt_id,attempt.status AS attempt_status,
              attempt.plan_id AS attempt_plan_id,
              attempt.skill_version_refs AS attempt_skill_version_refs,
              attempt.provider_binding_refs AS attempt_provider_binding_refs,
              plan.plan_id,plan.confirmation_status AS plan_confirmation_status,
              plan.definition_json AS plan_definition,
              version.skill_id,version.version AS skill_version,
              skill.current_version AS current_skill_version,
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
              outcome.specification_json AS skill_outcome_specification
         FROM agent_task task
         LEFT JOIN task_capability_binding binding ON binding.task_id=task.task_id
         LEFT JOIN LATERAL (
           SELECT current_attempt.*
             FROM task_capability_execution_attempt current_attempt
            WHERE current_attempt.task_id=task.task_id
            ORDER BY current_attempt.attempt_no DESC
            LIMIT 1
         ) attempt ON true
         LEFT JOIN workflow_plan plan ON plan.plan_id=task.plan_id
         LEFT JOIN skill ON skill.skill_id=task.selected_skill_id
         LEFT JOIN skill_version version
           ON version.skill_id=task.selected_skill_id
          AND version.version=task.selected_skill_version
         LEFT JOIN runtime_skill_version_governance governance
           ON governance.skill_id=version.skill_id AND governance.skill_version=version.version
         LEFT JOIN skill_outcome_specification outcome
           ON outcome.skill_id=version.skill_id AND outcome.skill_version=version.version
        WHERE task.task_id=$1`,
      [taskId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return deriveAuthority(row);
  }

  async revocationAuthority(
    taskId: string,
    confirmationId: string,
  ): Promise<GovernedControlRevocationAuthority | undefined> {
    const result = await this.#pool.query<{
      readonly task_id: string;
      readonly confirmation_id: string;
      readonly revoked_at: Date | string | null;
      readonly consumed_at: Date | string | null;
    }>(
      `SELECT task_id,confirmation_id,revoked_at,consumed_at
         FROM governed_control_confirmation
        WHERE task_id=$1 AND confirmation_id=$2`,
      [taskId, confirmationId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return Object.freeze({
      taskId: row.task_id,
      confirmationId: row.confirmation_id,
      ...(row.revoked_at === null ? {} : { revokedAt: iso(row.revoked_at) }),
      ...(row.consumed_at === null ? {} : { consumedAt: iso(row.consumed_at) }),
    });
  }
}

function deriveAuthority(row: AuthorityRow): GovernedControlIssueAuthority {
  if (
    TERMINAL_TASK_PHASES.has(row.task_phase) ||
    row.task_plan_id === null ||
    row.selected_skill_id === null ||
    row.selected_skill_version === null ||
    row.binding_id === null ||
    row.capability_id === null ||
    row.capability_version === null ||
    row.attempt_id === null ||
    row.attempt_status === null ||
    !ACTIVE_ATTEMPT_STATUSES.has(row.attempt_status) ||
    row.plan_id === null ||
    !['awaiting_confirmation', 'confirmed'].includes(row.plan_confirmation_status ?? '') ||
    row.skill_id === null ||
    row.skill_version === null ||
    row.current_skill_version === null ||
    row.skill_status !== 'enabled' ||
    row.skill_validation_passed !== true ||
    row.task_plan_id !== row.plan_id ||
    row.selected_skill_id !== row.skill_id ||
    row.selected_skill_version !== row.skill_version ||
    row.current_skill_version !== row.skill_version ||
    (row.attempt_plan_id !== null && row.attempt_plan_id !== row.plan_id) ||
    row.plan_definition === null
  )
    invalidAuthority();

  const constraints = recordArray(row.constraint_snapshot);
  const provider = exactlyOne(constraints, 'provider_binding_policy');
  const exactSkill = exactlyOne(constraints, 'exact_skill_version');
  const confirmation = exactlyOne(constraints, 'confirmation_policy');
  const resource = exactlyOne(constraints, 'resource_policy');
  const physical = exactlyOneOf(constraints, ['physical_side_effect_policy', 'side_effect_policy']);
  const providerBindingId = requiredString(provider['mcpProviderBindingId']);
  const serverId = requiredString(provider['localServerId']);
  const toolName = requiredString(provider['mcpToolName']);
  const argumentsRecord = record(row.input_snapshot);
  const resourceId = requiredString(argumentsRecord['resourceId']);
  const skillRef = `skill:${row.skill_id}:${String(row.skill_version)}`;
  const confirmationStage = String(confirmation['stage']);
  const requiredTools = recordArray(record(row.skill_tool_policy)['required']);
  const optionalTools = recordArray(record(row.skill_tool_policy)['optional']);
  const requiredTool = requiredTools[0];
  const sideEffectPolicy = record(record(row.skill_outcome_specification)['sideEffectPolicy']);
  const runtimePolicy = record(row.skill_runtime_policy);
  const dispatchMaximum = frozenDispatchMaximum(physical);
  assertBoundedMovementAuthority(
    constraints,
    argumentsRecord,
    toolName,
    dispatchMaximum,
    sideEffectPolicy,
  );

  if (
    exactSkill['skillId'] !== row.skill_id ||
    exactSkill['skillVersion'] !== row.skill_version ||
    exactSkill['taskType'] !== toolName ||
    toolName === 'vehicle_fire_weapon' ||
    confirmation['required'] !== true ||
    !['before_execution', 'pre_dispatch'].includes(confirmationStage) ||
    (confirmationStage === 'before_execution' && confirmation['autoConfirmPlan'] !== false) ||
    (confirmationStage === 'pre_dispatch' && confirmation['trustedActorRequired'] !== true) ||
    physical['sideEffecting'] !== true ||
    (physical['type'] === 'side_effect_policy' && physical['effectClass'] !== 'physical_control') ||
    provider['requiredStatus'] !== 'active' ||
    provider['requiredAvailabilityStatus'] !== 'available' ||
    provider['requiredFreshness'] !== 'unexpired' ||
    provider['fallback'] !== 'deny' ||
    (Array.isArray(provider['allowedResourceIds']) &&
      !stringArray(provider['allowedResourceIds']).includes(resourceId)) ||
    !stringArray(resource['allowedResourceIds']).includes(resourceId) ||
    !exactlyOneString(row.initial_implementation_refs, skillRef) ||
    !stringArray(row.skill_capabilities).includes(row.capability_id) ||
    requiredTools.length !== 1 ||
    requiredTool?.['serverId'] !== serverId ||
    requiredTool['toolName'] !== toolName ||
    optionalTools.length !== 0 ||
    runtimePolicy['autoConfirmPlan'] !== false ||
    runtimePolicy['maxMcpCalls'] !== dispatchMaximum ||
    sideEffectPolicy['sideEffecting'] !== true ||
    !['required', 'required_before_execution'].includes(String(sideEffectPolicy['confirmation'])) ||
    !exactlyOneString(row.attempt_skill_version_refs, skillRef) ||
    !exactlyOneString(row.attempt_provider_binding_refs, providerBindingId) ||
    (physical['type'] === 'physical_side_effect_policy' &&
      (physical['dispatchMaximum'] !== dispatchMaximum ||
        physical['uncertainDispatchPolicy'] !== 'reconcile_never_redispatch' ||
        physical['remoteTaskTerminalEvidenceRequired'] !== true))
  )
    invalidAuthority();

  return Object.freeze({
    taskId: row.task_id,
    capabilityBindingId: row.binding_id,
    capabilityId: row.capability_id,
    capabilityVersion: row.capability_version,
    capabilityAttemptId: row.attempt_id,
    planId: row.plan_id,
    planHash: canonicalHash(row.plan_definition),
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    providerBindingId,
    serverId,
    toolName,
    arguments: row.input_snapshot,
    argumentsHash: canonicalHash(row.input_snapshot),
  });
}

function assertBoundedMovementAuthority(
  constraints: readonly Readonly<Record<string, unknown>>[],
  arguments_: Readonly<Record<string, unknown>>,
  toolName: string,
  dispatchMaximum: number,
  sideEffectPolicy: Readonly<Record<string, unknown>>,
): void {
  const matches = constraints.filter(
    (constraint) => constraint['type'] === 'bounded_movement_policy',
  );
  if (matches.length === 0) {
    if (dispatchMaximum !== 1) invalidAuthority();
    return;
  }
  if (matches.length !== 1 || matches[0] === undefined) invalidAuthority();
  const movement = matches[0];
  const constraintId = requiredString(movement['constraintId']);
  const missionType = requiredString(movement['missionType']);
  const missionTypeArgumentPath = argumentPath(movement['missionTypeArgumentPath']);
  const directionArgumentPath = argumentPath(movement['directionArgumentPath']);
  const distanceArgumentPath = argumentPath(movement['distanceArgumentPath']);
  const allowedDirections = nonEmptyStringArray(movement['allowedDirections']);
  const exclusiveMinimum = finiteNumber(movement['exclusiveMinimum']);
  const maximumInclusive = finiteNumber(movement['maximumInclusive']);
  const exactDirection = requiredString(movement['exactDirection']);
  const exactDistancePerDispatch = finiteNumber(movement['exactDistancePerDispatch']);
  const exactDispatchCount = positiveInteger(movement['exactDispatchCount']);
  const exactTotalDistance = finiteNumber(movement['exactTotalDistance']);
  if (
    movement['toolName'] !== toolName ||
    !allowedDirections.includes(exactDirection) ||
    maximumInclusive <= exclusiveMinimum ||
    exactDistancePerDispatch <= exclusiveMinimum ||
    exactDistancePerDispatch > maximumInclusive ||
    exactDispatchCount !== dispatchMaximum ||
    exactTotalDistance !== exactDistancePerDispatch * exactDispatchCount ||
    typeof movement['unit'] !== 'string' ||
    movement['unit'].trim() === '' ||
    movement['scope'] !== 'per_dispatch' ||
    movement['strictSequential'] !== true ||
    movement['terminalBeforeNext'] !== true ||
    sideEffectPolicy['dispatchMaximum'] !== dispatchMaximum ||
    !exactlyOneString(sideEffectPolicy['requiredArgumentConstraintIds'], constraintId) ||
    valueAtArgumentPath(arguments_, missionTypeArgumentPath) !== missionType ||
    valueAtArgumentPath(arguments_, directionArgumentPath) !== exactDirection ||
    valueAtArgumentPath(arguments_, distanceArgumentPath) !== exactDistancePerDispatch
  )
    invalidAuthority();
}

function frozenDispatchMaximum(physical: Readonly<Record<string, unknown>>): number {
  if (physical['type'] === 'side_effect_policy') return 1;
  return positiveInteger(physical['dispatchMaximum']);
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalidAuthority();
  return value;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalidAuthority();
  return value;
}

function argumentPath(value: unknown): readonly string[] {
  const path = nonEmptyStringArray(value);
  if (path.length === 0) invalidAuthority();
  return path;
}

function nonEmptyStringArray(value: unknown): readonly string[] {
  const values = stringArray(value);
  if (
    values.length === 0 ||
    values.some((item) => item.trim() === '') ||
    new Set(values).size !== values.length
  )
    invalidAuthority();
  return values;
}

function valueAtArgumentPath(
  arguments_: Readonly<Record<string, unknown>>,
  path: readonly string[],
): unknown {
  let current: unknown = arguments_;
  for (const segment of path) {
    const object = record(current);
    if (!Object.prototype.hasOwnProperty.call(object, segment)) invalidAuthority();
    current = object[segment];
  }
  return current;
}

function exactlyOne(
  constraints: readonly Readonly<Record<string, unknown>>[],
  type: string,
): Readonly<Record<string, unknown>> {
  const matches = constraints.filter((constraint) => constraint['type'] === type);
  if (matches.length !== 1 || matches[0] === undefined) invalidAuthority();
  return matches[0];
}

function exactlyOneOf(
  constraints: readonly Readonly<Record<string, unknown>>[],
  types: readonly string[],
): Readonly<Record<string, unknown>> {
  const matches = constraints.filter((constraint) => types.includes(String(constraint['type'])));
  if (matches.length !== 1 || matches[0] === undefined) invalidAuthority();
  return matches[0];
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidAuthority();
  return value as Readonly<Record<string, unknown>>;
}

function recordArray(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) invalidAuthority();
  return value.map(record);
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) invalidAuthority();
  return value;
}

function exactlyOneString(value: unknown, expected: string): boolean {
  const values = stringArray(value);
  return values.length === 1 && values[0] === expected;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') invalidAuthority();
  return value.trim();
}

function invalidAuthority(): never {
  throw new GovernedControlManagementError('GOVERNED_CONTROL_AUTHORITY_SCOPE_INVALID', 409);
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) invalidAuthority();
  return date.toISOString();
}
