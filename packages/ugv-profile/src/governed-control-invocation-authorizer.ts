import {
  GovernedControlAuthorityError,
  HARD_DENIED_CONTROL_TOOLS,
  type CurrentGovernedCapabilityAuthority,
  type CurrentGovernedCapabilityAuthorityPort,
  type GovernedControlAuthorityErrorCode,
  type GovernedControlAuthorityKind,
  type GovernedControlAuthorityStore,
  type GovernedControlDispatchReceipt,
  type GovernedControlInvocation,
  type GovernedControlInvocationAuthorityPort,
  type GovernedControlRuntimeAuthoritySnapshot,
  type WeaponControlEvidenceAuthorityPort,
} from '../../application/src/governed-control-authority.js';
import { canonicalHash } from '../../application/src/mcp-task-readiness.js';

const CONTROL_APPROVER_ROLE = 'physical_control_approver';

const MAX_CONFIRMATION_TTL_MS = 15 * 60 * 1_000;

const ACTIVE_CAPABILITY_ATTEMPT_STATUSES = new Set(['prepared', 'running', 'waiting']);

const PHYSICAL_CONTROL_RISK_LEVELS = new Set(['medium', 'high', 'critical']);

const TERMINAL_TASK_PHASES = new Set(['completed', 'failed', 'canceled']);

/**
 * Rechecks every mutable authority immediately before a Provider transport is crossed. Catalog
 * discovery is deliberately absent from this API: a discovered Tool can identify the target, but
 * it cannot manufacture Capability, Skill, plan, confirmation, readiness, or Task binding facts.
 */
export class GovernedControlInvocationAuthorizer implements GovernedControlInvocationAuthorityPort {
  readonly #store: GovernedControlAuthorityStore;
  readonly #capabilities: CurrentGovernedCapabilityAuthorityPort;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #hardDeniedTools: ReadonlySet<string>;
  readonly #weaponEvidence: WeaponControlEvidenceAuthorityPort | undefined;

  constructor(
    dependencies: Readonly<{
      store: GovernedControlAuthorityStore;
      capabilities: CurrentGovernedCapabilityAuthorityPort;
      clock: Readonly<{ now(): string }>;
      hardDeniedTools?: readonly string[];
      weaponEvidence?: WeaponControlEvidenceAuthorityPort;
    }>,
  ) {
    this.#store = dependencies.store;
    this.#capabilities = dependencies.capabilities;
    this.#clock = dependencies.clock;
    this.#hardDeniedTools = new Set(dependencies.hardDeniedTools ?? HARD_DENIED_CONTROL_TOOLS);
    this.#weaponEvidence = dependencies.weaponEvidence;
  }

  async authorizeAndConsume(
    input: GovernedControlInvocation,
  ): Promise<GovernedControlDispatchReceipt> {
    if (this.#hardDeniedTools.has(input.toolName))
      fail(
        'GOVERNED_CONTROL_TOOL_HARD_DENIED',
        'vehicle_fire_weapon has no execution authority in this Runtime.',
      );
    if (input.toolName === 'vehicle_fire_weapon') {
      if (this.#weaponEvidence === undefined)
        fail(
          'WEAPON_CONTROL_STRICT_EVIDENCE_REQUIRED',
          'Weapon control requires current strict target-lock and payload readiness authority.',
        );
      await this.#weaponEvidence.assertReady(input);
    }
    if (
      input.executionSemantics.effect !== 'side_effecting' ||
      input.executionSemantics.execution === 'unknown'
    )
      fail(
        'GOVERNED_CONTROL_SEMANTICS_NOT_EXPLICIT',
        'Physical control requires explicit side-effect and execution semantics.',
      );
    const invocationId = required(input.invocationId, 'invocationId');
    const exactDispatchHash = dispatchHash(input.dispatchHash);
    const argumentsHash = canonicalHash(input.arguments);
    const readinessArgumentsHash = canonicalHash({ unresolved: false, value: input.arguments });
    const snapshot = await this.#store.load({
      taskId: input.taskId,
      capabilityAttemptId: input.capabilityAttemptId,
      providerBindingId: input.providerBindingId,
      serverId: input.serverId,
      toolName: input.toolName,
      argumentsHash,
      readinessArgumentsHash,
    });
    if (snapshot === undefined)
      fail(
        'GOVERNED_CONTROL_AUTHORITY_NOT_FOUND',
        'No complete durable control authority exists for this Task and Tool invocation.',
      );
    const capability = await this.#loadCurrentCapability(snapshot.binding);
    this.#assertRuntimeAuthority(input, snapshot, argumentsHash, readinessArgumentsHash);
    this.#assertCurrentCapability(snapshot, capability, input);
    this.#assertConfirmation(input, snapshot, argumentsHash);
    const consumedAt = new Date(
      timestamp(this.#clock.now(), 'GOVERNED_CONTROL_CLOCK_INVALID'),
    ).toISOString();
    const consumed = await this.#store.consumeConfirmation({
      confirmationId: snapshot.confirmation.confirmationId,
      taskId: input.taskId,
      capabilityBindingId: snapshot.binding.bindingId,
      capabilityAttemptId: input.capabilityAttemptId,
      providerBindingId: input.providerBindingId,
      serverId: input.serverId,
      toolName: input.toolName,
      argumentsHash,
      invocationId,
      dispatchHash: exactDispatchHash,
      consumedAt,
    });
    if (
      consumed?.consumedInvocationId !== invocationId ||
      consumed.consumedDispatchHash !== exactDispatchHash ||
      consumed.consumedAt === undefined
    )
      fail(
        'GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED',
        'The exact control confirmation is unavailable or was consumed by another dispatch.',
      );
    return Object.freeze({
      confirmationId: consumed.confirmationId,
      providerBindingId: consumed.providerBindingId,
      argumentsHash: consumed.argumentsHash,
      invocationId: consumed.consumedInvocationId,
      dispatchHash: consumed.consumedDispatchHash,
      consumedAt: consumed.consumedAt,
    });
  }

  async #loadCurrentCapability(
    binding: GovernedControlRuntimeAuthoritySnapshot['binding'],
  ): Promise<CurrentGovernedCapabilityAuthority> {
    try {
      return await this.#capabilities.load(binding.capabilityId, binding.capabilityVersion);
    } catch {
      fail(
        'GOVERNED_CONTROL_CAPABILITY_NOT_CURRENT',
        'The exact current Capability authority could not be loaded.',
      );
    }
  }

  #assertRuntimeAuthority(
    input: GovernedControlInvocation,
    snapshot: GovernedControlRuntimeAuthoritySnapshot,
    argumentsHash: string,
    readinessArgumentsHash: string,
  ): void {
    const { task, binding, attempt, plan, skill, readiness } = snapshot;
    const expectedSkillRef = `skill:${skill.skillId}:${String(skill.skillVersion)}`;
    const requiredTools = recordArray(skill.toolPolicy['required']);
    const requiredTool = requiredTools[0];
    const sideEffectPolicy = record(skill.outcomeSpecification?.['sideEffectPolicy']);
    const dispatchMaximum = frozenDispatchMaximum(binding.constraintSnapshot);
    if (
      task.taskId !== input.taskId ||
      TERMINAL_TASK_PHASES.has(task.phase) ||
      task.phase !== 'executing' ||
      task.planId !== plan.planId ||
      task.selectedSkillId !== skill.skillId ||
      task.selectedSkillVersion !== skill.skillVersion ||
      binding.initialImplementationRefs.length !== 1 ||
      binding.initialImplementationRefs[0] !== expectedSkillRef ||
      attempt.attemptId !== input.capabilityAttemptId ||
      !ACTIVE_CAPABILITY_ATTEMPT_STATUSES.has(attempt.status) ||
      (attempt.planId !== undefined && attempt.planId !== plan.planId) ||
      attempt.skillVersionRefs.length !== 1 ||
      attempt.skillVersionRefs[0] !== expectedSkillRef ||
      attempt.providerBindingRefs.length !== 1 ||
      attempt.providerBindingRefs[0] !== input.providerBindingId ||
      plan.confirmationStatus !== 'confirmed' ||
      skill.currentVersion !== skill.skillVersion ||
      skill.status !== 'enabled' ||
      !skill.validationPassed ||
      !skill.capabilities.includes(binding.capabilityId) ||
      requiredTools.length !== 1 ||
      requiredTool?.['serverId'] !== input.serverId ||
      requiredTool['toolName'] !== input.toolName ||
      recordArray(skill.toolPolicy['optional']).length !== 0 ||
      !recordArray(skill.toolPolicy['forbidden']).some(
        (tool) => tool['serverId'] === input.serverId && tool['toolName'] === 'vehicle_fire_weapon',
      ) ||
      skill.runtimePolicy['autoConfirmPlan'] !== false ||
      skill.runtimePolicy['maxMcpCalls'] !== dispatchMaximum ||
      sideEffectPolicy?.['sideEffecting'] !== true ||
      sideEffectPolicy['confirmation'] !== 'required_before_execution' ||
      sideEffectPolicy['autoConfirmPlan'] !== false ||
      sideEffectPolicy['exactResourceRequired'] !== true ||
      sideEffectPolicy['remoteTaskIdentityRequired'] !== true ||
      sideEffectPolicy['terminalObservationRequired'] !== true ||
      sideEffectPolicy['redispatchAfterUncertain'] !== false ||
      canonicalHash(binding.inputSnapshot) !== argumentsHash ||
      binding.evidenceRequirementSnapshot.length === 0 ||
      readiness.workflowPlanId !== plan.planId ||
      readiness.checkPhase !== 'pre_invocation' ||
      readiness.dslHash !== plan.definitionHash ||
      readiness.disposition !== 'ready' ||
      readiness.guardAction !== 'proceed' ||
      readiness.confirmationRequired ||
      readiness.serverId !== input.serverId ||
      readiness.operationName !== input.toolName ||
      readiness.argumentsHash !== readinessArgumentsHash ||
      readiness.availability !== 'available' ||
      !PHYSICAL_CONTROL_RISK_LEVELS.has(readiness.riskLevel)
    )
      fail(
        'GOVERNED_CONTROL_RUNTIME_AUTHORITY_INVALID',
        'Task, binding, Skill, plan, readiness, or Provider authority is not exact and current.',
      );
    const now = timestamp(this.#clock.now(), 'GOVERNED_CONTROL_CLOCK_INVALID');
    if (
      readiness.validUntil === undefined ||
      timestamp(readiness.checkedAt, 'GOVERNED_CONTROL_READINESS_TIME_INVALID') > now ||
      timestamp(readiness.validUntil, 'GOVERNED_CONTROL_READINESS_TIME_INVALID') <= now
    )
      fail(
        'GOVERNED_CONTROL_READINESS_STALE',
        'The exact pre-invocation readiness snapshot is absent, future-dated, or expired.',
      );
  }

  #assertCurrentCapability(
    snapshot: GovernedControlRuntimeAuthoritySnapshot,
    authority: CurrentGovernedCapabilityAuthority,
    input: GovernedControlInvocation,
  ): void {
    const { binding, skill } = snapshot;
    const definition = authority.definition;
    const implementations = authority.implementationBindings.filter(
      (candidate) =>
        candidate['capability_id'] === binding.capabilityId &&
        candidate['capability_version'] === binding.capabilityVersion &&
        candidate['implementation_type'] === 'skill' &&
        candidate['implementation_id'] === skill.skillId &&
        candidate['implementation_version'] === String(skill.skillVersion) &&
        candidate['role'] === 'primary' &&
        candidate['status'] === 'active',
    );
    if (
      definition['capability_id'] !== binding.capabilityId ||
      definition['version'] !== binding.capabilityVersion ||
      definition['status'] !== 'published' ||
      !PHYSICAL_CONTROL_RISK_LEVELS.has(String(definition['risk_level'])) ||
      !stringArray(definition['supported_modes']).includes('plan_confirmed') ||
      !stringArray(definition['supported_modes']).includes('remote_task') ||
      canonical(definition['constraints']) !== canonical(binding.constraintSnapshot) ||
      implementations.length !== 1
    )
      fail(
        'GOVERNED_CONTROL_CAPABILITY_NOT_CURRENT',
        'The frozen Task binding differs from current Capability and implementation authority.',
      );
    const implementation = implementations[0];
    const providerOverride = record(implementation?.['provider_policy_override']);
    const resourceId = record(binding.inputSnapshot)?.['resourceId'];
    if (
      providerOverride?.['selection'] !== 'required' ||
      providerOverride['mcpProviderBindingId'] !== input.providerBindingId ||
      providerOverride['localServerId'] !== input.serverId ||
      providerOverride['mcpToolName'] !== input.toolName ||
      typeof resourceId !== 'string' ||
      !stringArray(providerOverride['allowedResourceIds']).includes(resourceId) ||
      providerOverride['requireActive'] !== true ||
      providerOverride['requireAvailable'] !== true ||
      providerOverride['requireUnexpiredFreshness'] !== true ||
      providerOverride['denyFallback'] !== true
    )
      fail(
        'GOVERNED_CONTROL_CAPABILITY_NOT_CURRENT',
        'The current Capability implementation lacks the exact active Provider authority.',
      );
    assertControlConstraints(binding.constraintSnapshot, snapshot, input);
  }

  #assertConfirmation(
    input: GovernedControlInvocation,
    snapshot: GovernedControlRuntimeAuthoritySnapshot,
    argumentsHash: string,
  ): void {
    const { confirmation, binding, plan, skill, task } = snapshot;
    assertTrustedHumanActor(confirmation);
    const now = timestamp(this.#clock.now(), 'GOVERNED_CONTROL_CLOCK_INVALID');
    const confirmedAt = timestamp(
      confirmation.confirmedAt,
      'GOVERNED_CONTROL_CONFIRMATION_TIME_INVALID',
    );
    const expiresAt = timestamp(
      confirmation.expiresAt,
      'GOVERNED_CONTROL_CONFIRMATION_TIME_INVALID',
    );
    if (
      (confirmation.authorityKind ?? 'physical_control') !== authorityKindForTool(input.toolName) ||
      confirmation.taskId !== task.taskId ||
      confirmation.capabilityBindingId !== binding.bindingId ||
      confirmation.capabilityId !== binding.capabilityId ||
      confirmation.capabilityVersion !== binding.capabilityVersion ||
      confirmation.capabilityAttemptId !== snapshot.attempt.attemptId ||
      confirmation.planId !== plan.planId ||
      confirmation.planHash !== plan.definitionHash ||
      confirmation.skillId !== skill.skillId ||
      confirmation.skillVersion !== skill.skillVersion ||
      confirmation.providerBindingId !== input.providerBindingId ||
      confirmation.serverId !== input.serverId ||
      confirmation.toolName !== input.toolName ||
      confirmation.argumentsHash !== argumentsHash ||
      confirmation.revokedAt !== undefined ||
      confirmedAt > now ||
      expiresAt <= now ||
      expiresAt - confirmedAt > MAX_CONFIRMATION_TTL_MS
    )
      fail(
        'GOVERNED_CONTROL_CONFIRMATION_INVALID',
        'High-risk confirmation is stale, revoked, untrusted, or bound to different authority.',
      );
  }
}

function assertControlConstraints(
  constraints: readonly Readonly<Record<string, unknown>>[],
  snapshot: GovernedControlRuntimeAuthoritySnapshot,
  input: GovernedControlInvocation,
): void {
  const confirmation = exactlyOne(constraints, 'confirmation_policy');
  const sideEffect = exactlyOne(constraints, 'physical_side_effect_policy');
  const provider = exactlyOne(constraints, 'provider_binding_policy');
  const resource = exactlyOne(constraints, 'resource_policy');
  const exactSkill = exactlyOne(constraints, 'exact_skill_version');
  const resourceId = record(snapshot.binding.inputSnapshot)?.['resourceId'];
  const dispatchMaximum = frozenDispatchMaximum(constraints);
  if (
    confirmation['required'] !== true ||
    !confirmationStageAllowed(input.toolName, confirmation['stage']) ||
    (confirmation['authorityKind'] ?? 'physical_control') !==
      authorityKindForTool(input.toolName) ||
    confirmation['autoConfirmPlan'] !== false ||
    sideEffect['sideEffecting'] !== true ||
    sideEffect['uncertainDispatchPolicy'] !== 'reconcile_never_redispatch' ||
    sideEffect['remoteTaskTerminalEvidenceRequired'] !== true ||
    provider['mcpProviderBindingId'] !== input.providerBindingId ||
    provider['localServerId'] !== snapshot.readiness.serverId ||
    provider['mcpToolName'] !== snapshot.readiness.operationName ||
    canonical(provider['executionSemantics']) !== canonical(input.executionSemantics) ||
    provider['requiredStatus'] !== 'active' ||
    provider['requiredAvailabilityStatus'] !== 'available' ||
    provider['requiredFreshness'] !== 'unexpired' ||
    provider['fallback'] !== 'deny' ||
    typeof resourceId !== 'string' ||
    !stringArray(provider['allowedResourceIds']).includes(resourceId) ||
    exactSkill['skillId'] !== snapshot.skill.skillId ||
    exactSkill['skillVersion'] !== snapshot.skill.skillVersion ||
    exactSkill['taskType'] !== snapshot.readiness.operationName ||
    resource['identifierAuthority'] !== 'public_smpp_tool_schema' ||
    resource['selection'] !== 'exact_value' ||
    resource['downstreamResourceBinding'] !== 'forbidden' ||
    !stringArray(resource['allowedResourceIds']).includes(resourceId)
  )
    fail(
      'GOVERNED_CONTROL_CONSTRAINTS_INVALID',
      'The frozen Capability lacks exact confirmation, physical-side-effect, provider, Skill, or public resource policy.',
    );
  assertBoundedMovementConstraint(constraints, snapshot, input, dispatchMaximum);
}

function assertBoundedMovementConstraint(
  constraints: readonly Readonly<Record<string, unknown>>[],
  snapshot: GovernedControlRuntimeAuthoritySnapshot,
  input: GovernedControlInvocation,
  dispatchMaximum: number,
): void {
  const movementConstraints = constraints.filter(
    (constraint) => constraint['type'] === 'bounded_movement_policy',
  );
  if (movementConstraints.length === 0) {
    if (dispatchMaximum !== 1)
      fail(
        'GOVERNED_CONTROL_CONSTRAINTS_INVALID',
        'A multi-dispatch physical control requires one frozen bounded movement policy.',
      );
    return;
  }
  if (movementConstraints.length !== 1)
    fail(
      'GOVERNED_CONTROL_CONSTRAINTS_INVALID',
      'Governed control requires at most one frozen bounded movement policy.',
    );
  const movement = movementConstraints[0];
  if (movement === undefined)
    fail('GOVERNED_CONTROL_CONSTRAINTS_INVALID', 'Bounded movement policy is absent.');
  const constraintId = movement['constraintId'];
  const missionType = movement['missionType'];
  const missionTypeArgumentPath = argumentPath(movement['missionTypeArgumentPath']);
  const directionArgumentPath = argumentPath(movement['directionArgumentPath']);
  const distanceArgumentPath = argumentPath(movement['distanceArgumentPath']);
  const allowedDirections = nonEmptyStringArray(movement['allowedDirections']);
  const exclusiveMinimum = movement['exclusiveMinimum'];
  const maximumInclusive = movement['maximumInclusive'];
  const exactDirection = movement['exactDirection'];
  const exactDistancePerDispatch = movement['exactDistancePerDispatch'];
  const exactDispatchCount = movement['exactDispatchCount'];
  const exactTotalDistance = movement['exactTotalDistance'];
  const sideEffectPolicy = record(snapshot.skill.outcomeSpecification?.['sideEffectPolicy']);
  const requiredConstraintIds = stringArray(sideEffectPolicy?.['requiredArgumentConstraintIds']);
  if (
    typeof constraintId !== 'string' ||
    constraintId.trim() === '' ||
    movement['toolName'] !== input.toolName ||
    typeof missionType !== 'string' ||
    missionType.trim() === '' ||
    missionTypeArgumentPath === undefined ||
    directionArgumentPath === undefined ||
    distanceArgumentPath === undefined ||
    allowedDirections === undefined ||
    typeof exclusiveMinimum !== 'number' ||
    !Number.isFinite(exclusiveMinimum) ||
    typeof maximumInclusive !== 'number' ||
    !Number.isFinite(maximumInclusive) ||
    maximumInclusive <= exclusiveMinimum ||
    typeof exactDirection !== 'string' ||
    exactDirection.trim() === '' ||
    !allowedDirections.includes(exactDirection) ||
    typeof exactDistancePerDispatch !== 'number' ||
    !Number.isFinite(exactDistancePerDispatch) ||
    exactDistancePerDispatch <= exclusiveMinimum ||
    exactDistancePerDispatch > maximumInclusive ||
    typeof exactDispatchCount !== 'number' ||
    !Number.isSafeInteger(exactDispatchCount) ||
    exactDispatchCount < 1 ||
    exactDispatchCount !== dispatchMaximum ||
    typeof exactTotalDistance !== 'number' ||
    !Number.isFinite(exactTotalDistance) ||
    exactTotalDistance !== exactDistancePerDispatch * exactDispatchCount ||
    typeof movement['unit'] !== 'string' ||
    movement['unit'].trim() === '' ||
    movement['scope'] !== 'per_dispatch' ||
    movement['strictSequential'] !== true ||
    movement['terminalBeforeNext'] !== true ||
    sideEffectPolicy?.['dispatchMaximum'] !== dispatchMaximum ||
    requiredConstraintIds.length !== 1 ||
    requiredConstraintIds[0] !== constraintId
  )
    fail(
      'GOVERNED_CONTROL_CONSTRAINTS_INVALID',
      'The bounded movement policy is incomplete, internally inconsistent, or detached from the frozen Skill authority.',
    );
  const actualMissionType = valueAtArgumentPath(input.arguments, missionTypeArgumentPath);
  const actualDirection = valueAtArgumentPath(input.arguments, directionArgumentPath);
  const actualDistance = valueAtArgumentPath(input.arguments, distanceArgumentPath);
  if (
    actualMissionType !== missionType ||
    actualDirection !== exactDirection ||
    typeof actualDistance !== 'number' ||
    !Number.isFinite(actualDistance) ||
    actualDistance <= exclusiveMinimum ||
    actualDistance > maximumInclusive ||
    actualDistance !== exactDistancePerDispatch
  )
    fail(
      'GOVERNED_CONTROL_ARGUMENTS_OUT_OF_BOUNDS',
      'Control arguments differ from the exact frozen per-dispatch movement policy.',
    );
}

function frozenDispatchMaximum(constraints: readonly Readonly<Record<string, unknown>>[]): number {
  const sideEffect = exactlyOne(constraints, 'physical_side_effect_policy');
  const dispatchMaximum = sideEffect['dispatchMaximum'];
  if (
    typeof dispatchMaximum !== 'number' ||
    !Number.isSafeInteger(dispatchMaximum) ||
    dispatchMaximum < 1
  )
    fail(
      'GOVERNED_CONTROL_CONSTRAINTS_INVALID',
      'Physical control requires a positive frozen dispatch maximum.',
    );
  return dispatchMaximum;
}

function argumentPath(value: unknown): readonly string[] | undefined {
  const path = stringArray(value);
  return path.length > 0 && path.every((segment) => segment.trim() !== '') ? path : undefined;
}

function nonEmptyStringArray(value: unknown): readonly string[] | undefined {
  const values = stringArray(value);
  return values.length > 0 &&
    values.every((item) => item.trim() !== '') &&
    new Set(values).size === values.length
    ? values
    : undefined;
}

function valueAtArgumentPath(
  arguments_: Readonly<Record<string, unknown>>,
  path: readonly string[],
): unknown {
  let current: unknown = arguments_;
  for (const segment of path) {
    const object = record(current);
    if (object === undefined || !Object.prototype.hasOwnProperty.call(object, segment))
      return undefined;
    current = object[segment];
  }
  return current;
}

function assertTrustedHumanActor(
  input: Readonly<{
    actorId: string;
    actorKind: string;
    authenticationMethod: string;
    actorRoles: readonly string[];
    authorityKind?: GovernedControlAuthorityKind;
  }>,
): void {
  const actorId = required(input.actorId, 'actorId');
  const authorityKind = input.authorityKind ?? 'physical_control';
  const requiredRole =
    authorityKind === 'weapon_control'
      ? 'weapon_control_approver'
      : authorityKind === 'emergency_stop'
        ? 'physical_control_emergency_operator'
        : CONTROL_APPROVER_ROLE;
  if (
    input.actorKind !== 'human' ||
    required(input.authenticationMethod, 'authenticationMethod') === 'none' ||
    !input.actorRoles.includes(requiredRole) ||
    /^(?:agent|assistant|llm|model):/iu.test(actorId)
  )
    fail(
      'GOVERNED_CONTROL_CONFIRMATION_ACTOR_UNTRUSTED',
      'High-risk confirmation requires an authenticated human control approver.',
    );
}

function authorityKindForTool(toolName: string): GovernedControlAuthorityKind {
  return toolName === 'vehicle_fire_weapon'
    ? 'weapon_control'
    : toolName === 'vehicle_emergency_stop'
      ? 'emergency_stop'
      : 'physical_control';
}

function confirmationStageAllowed(toolName: string, value: unknown): boolean {
  if (toolName === 'vehicle_fire_weapon') return value === 'pre_dispatch';
  if (toolName === 'vehicle_emergency_stop')
    return value === 'before_execution' || value === 'before_execution_or_direct_emergency';
  return value === 'before_execution';
}

function exactlyOne(
  constraints: readonly Readonly<Record<string, unknown>>[],
  type: string,
): Readonly<Record<string, unknown>> {
  const matches = constraints.filter((constraint) => constraint['type'] === type);
  const match = matches[0];
  if (matches.length !== 1 || match === undefined)
    fail(
      'GOVERNED_CONTROL_CONSTRAINTS_INVALID',
      `Governed control requires exactly one ${type} constraint.`,
    );
  return match;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function recordArray(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const records = value.map(record);
  return records.every((item) => item !== undefined) ? Object.freeze(records) : Object.freeze([]);
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : Object.freeze([]);
}

function timestamp(value: string, code: GovernedControlAuthorityErrorCode): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code, 'Governed control timestamp is invalid.');
  return parsed;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '')
    fail('GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID', `${field} is required.`);
  return normalized;
}

function dispatchHash(value: string): string {
  const normalized = required(value, 'dispatchHash');
  if (!/^sha256:[a-f0-9]{64}$/u.test(normalized))
    fail(
      'GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID',
      'Control dispatch requires an exact canonical dispatch hash.',
    );
  return normalized;
}

function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`;
}

function fail(code: GovernedControlAuthorityErrorCode, message: string): never {
  throw new GovernedControlAuthorityError(code, message);
}
