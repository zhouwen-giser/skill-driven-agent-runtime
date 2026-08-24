import type {
  Clock,
  McpRegistryRepository,
  SkillTaskReadinessPort,
  TaskCapabilitySkillUsageAuthority,
} from '../../../packages/application/src/index.js';
import {
  createTaskCapabilityBinding,
  frozenTaskReadinessAttributes,
  hashCanonicalEvidenceJson,
  type McpInvocation,
  type SkillContextResolutionSummary,
  type SkillTaskReadinessSummary,
  type SkillUsageSelectionContext,
  type TaskCapabilityBinding,
} from '../../../packages/domain/src/index.js';

import type { UgvMoveTaskBindingResolver } from './ugv-move-binding.js';

/**
 * Formal Skill Usage readiness adapter for the profile-only embodied.move -> vehicle_navigate
 * projection. It delegates every authority check to the exact B02 resolver and never changes the
 * generic Task catalog's exact-match behavior.
 */
export class UgvMoveSkillTaskReadinessAdapter implements SkillTaskReadinessPort {
  readonly #resolver: Pick<UgvMoveTaskBindingResolver, 'resolve'>;

  constructor(resolver: Pick<UgvMoveTaskBindingResolver, 'resolve'>) {
    this.#resolver = resolver;
  }

  async inspect(input: Parameters<SkillTaskReadinessPort['inspect']>[0]) {
    const binding = input.taskBindings[0];
    const arguments_ = input.arguments;
    const executionContext = input.executionContext;
    if (
      input.skillId !== 'embodied.move_to' ||
      input.skillVersion !== 1 ||
      input.taskBindings.length !== 1 ||
      binding?.bindingId !== 'move-resource' ||
      binding.taskType !== 'embodied.move' ||
      input.allowPreferredProviderFallback ||
      arguments_?.unresolved !== false ||
      executionContext?.mode !== 'simulation' ||
      executionContext.simulationId === undefined
    )
      throw new UgvMoveSkillUsageError(
        'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED',
        'UGV Skill Usage requires exact input, simulation, and profile binding authority.',
      );
    const resolved = await this.#resolver.resolve({
      skillInput: arguments_.value,
      executionContext,
    });
    const selected = resolved.selected;
    const provider = Object.freeze({
      providerId: selected.server.serverId,
      operationName: selected.operation.operationName,
      protocolMode: 'frozen_v1' as const,
      attributes: Object.freeze(
        frozenTaskReadinessAttributes(
          selected.operation.taskExecutionProfile,
          selected.operation.taskNotifications,
        ),
      ),
      disposition: 'ready' as const,
      riskLevel: selected.availability.riskLevel,
      validUntil: selected.availability.validUntil,
      nextAvailableWindows: Object.freeze([]),
      reservationMode: selected.availability.reservationMode,
      ...(selected.availability.reservationRef === undefined
        ? {}
        : { reservationRef: selected.availability.reservationRef }),
      possibleEffects: Object.freeze([...selected.availability.possibleEffects]),
      selected: true,
      reasonCodes: Object.freeze([]),
    });
    return Object.freeze({
      overall: 'ready' as const,
      bindings: Object.freeze([
        Object.freeze({
          bindingId: binding.bindingId,
          taskType: binding.taskType,
          disposition: 'ready' as const,
          confirmationRequired: true,
          reasonCodes: Object.freeze([]),
          selectedProviderId: selected.server.serverId,
          selectedOperationName: selected.operation.operationName,
          selectedProtocolMode: 'frozen_v1' as const,
          candidates: Object.freeze([provider]),
        }),
      ]),
    }) satisfies SkillTaskReadinessSummary;
  }
}

const UGV_RESOURCE_ID = 'vehicle:ugv1';
const UGV_PROVIDER_ID = 'isr.vehicle.ugv.ugv1';
const STATE_OPERATION = 'vehicle_get_state';
const NAVIGATE_OPERATION = 'vehicle_navigate';
export const UGV_SIMULATION_QUALIFICATION_MAX_ADMISSION_AGE_MS = 3_000;
const HEALTH_FRESHNESS_MS = 5_000;
const MAXIMUM_FUTURE_SKEW_MS = 1_000;
const PLAIN_SHA256 = /^[0-9a-f]{64}$/u;
const BOUNDED_REFERENCE_ID = /^[A-Za-z0-9._-]{1,128}$/u;
const BOUNDED_POLICY_ID = /^[A-Za-z0-9._/-]{1,128}$/u;

export const UGV_SIMULATION_TARGET_POLICY_TYPE = 'ugv_simulation_target_policy' as const;

export interface UgvSimulationTarget {
  readonly x: number;
  readonly y: number;
  readonly frame: 'WGS84';
}

export interface UgvSimulationTargetPolicyInput {
  readonly policyId: string;
  readonly revision: number;
}

/**
 * Creates the only target permission accepted by this external-simulation profile. The explicit
 * WGS84 target is admitted from the formal A2A request and then frozen in the PostgreSQL Task
 * Capability binding. Qualification state is deliberately not a target authority.
 */
export function createUgvSimulationTargetPolicy(
  input: UgvSimulationTargetPolicyInput,
): Readonly<Record<string, unknown>> {
  if (
    !BOUNDED_POLICY_ID.test(input.policyId) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1
  )
    invalid('The UGV simulation target permission input is invalid.');
  return Object.freeze({
    type: UGV_SIMULATION_TARGET_POLICY_TYPE,
    policyId: input.policyId,
    revision: input.revision,
    executionMode: 'simulation',
    resourceId: UGV_RESOURCE_ID,
    frame: 'WGS84',
    targetAuthority: 'task_capability_input_snapshot',
    targetDerivation: 'forbidden',
    distanceLimit: 'none',
    altitudePolicy: 'not_commanded_not_terminally_evaluated',
    forbiddenRegions: Object.freeze([]),
  });
}

/**
 * Resolves three exact Skill context requirements from durable server-owned facts only. This method
 * reads an already-recorded taskless qualification invocation and therefore performs no MCP call.
 */
export async function resolveUgvMoveSkillUsageContext(
  input: Readonly<{
    authority: TaskCapabilitySkillUsageAuthority;
    binding: TaskCapabilityBinding;
    invocations: Pick<McpRegistryRepository, 'listInvocations'>;
    clock: Pick<Clock, 'now'>;
  }>,
): Promise<SkillUsageSelectionContext> {
  assertBinding(input.binding);
  const context = input.authority.context;
  const execution = context.runtimeExecutionContext;
  const arguments_ = context.taskAvailabilityArguments;
  const resourcePolicy = exactlyOneConstraint(input.binding, 'resource_policy');
  const providerPolicy = exactlyOneConstraint(input.binding, 'provider_binding_policy');
  const exactSkill = exactlyOneConstraint(input.binding, 'exact_skill_version');
  const confirmation = exactlyOneConstraint(input.binding, 'confirmation_policy');
  const sideEffect = exactlyOneConstraint(input.binding, 'physical_side_effect_policy');
  const executionPolicy = exactlyOneConstraint(input.binding, 'runtime_execution_mode_policy');
  const targetPolicy = exactlyOneConstraint(input.binding, UGV_SIMULATION_TARGET_POLICY_TYPE);
  const bindingInput = record(input.binding.inputSnapshot);
  const target = record(bindingInput?.['target']);
  const serverId = providerPolicy['localServerId'];
  const providerBindingId = providerPolicy['mcpProviderBindingId'];
  const simulationId = execution?.simulationId;
  if (
    input.authority.skillId !== 'embodied.move_to' ||
    input.authority.skillVersion !== 1 ||
    !BOUNDED_REFERENCE_ID.test(input.binding.bindingId) ||
    input.binding.requestedCapabilityId !== 'embodied.move' ||
    input.binding.capabilityVersion !== 2 ||
    !sameStrings(input.binding.initialImplementationRefs, ['skill:embodied.move_to:1']) ||
    exactSkill['skillId'] !== 'embodied.move_to' ||
    exactSkill['skillVersion'] !== 1 ||
    exactSkill['taskType'] !== 'embodied.move' ||
    bindingInput?.['resourceId'] !== UGV_RESOURCE_ID ||
    !exactInputKeys(bindingInput, target) ||
    !validTarget(target) ||
    arguments_?.unresolved !== false ||
    !sameJson(arguments_.value, input.binding.inputSnapshot) ||
    context.risk !== 'high' ||
    context.humanConfirmation !== 'pending' ||
    execution?.mode !== 'simulation' ||
    !present(simulationId) ||
    !exactSystemPolicy(context) ||
    resourcePolicy['selection'] !== 'exact_value' ||
    !sameJson(resourcePolicy['allowedResourceIds'], [UGV_RESOURCE_ID]) ||
    resourcePolicy['downstreamResourceBinding'] !== 'forbidden' ||
    !BOUNDED_REFERENCE_ID.test(typeof serverId === 'string' ? serverId : '') ||
    !BOUNDED_REFERENCE_ID.test(typeof providerBindingId === 'string' ? providerBindingId : '') ||
    providerPolicy['mcpToolName'] !== NAVIGATE_OPERATION ||
    providerPolicy['requiredStatus'] !== 'active' ||
    providerPolicy['requiredAvailabilityStatus'] !== 'available' ||
    providerPolicy['requiredFreshness'] !== 'unexpired' ||
    providerPolicy['fallback'] !== 'deny' ||
    confirmation['required'] !== true ||
    confirmation['stage'] !== 'before_execution' ||
    sideEffect['sideEffecting'] !== true ||
    executionPolicy['mode'] !== 'simulation' ||
    executionPolicy['simulationId'] !== simulationId ||
    !exactCapabilityObservations(context, input.binding, providerBindingId as string)
  )
    invalid('The formal UGV Task Capability context is not exact.');

  const policy = exactTargetPolicy(targetPolicy);
  const allInvocations = await input.invocations.listInvocations(serverId as string);
  const candidates = allInvocations.filter(
    (invocation) =>
      invocation.serverId === serverId &&
      invocation.toolName === STATE_OPERATION &&
      invocation.executionMode === 'simulation' &&
      invocation.simulationId === simulationId,
  );
  const receipt = candidates[0];
  if (candidates.length !== 1 || receipt === undefined) {
    invalid('The UGV simulation run requires exactly one taskless qualification state receipt.');
  }
  validateUgvSimulationQualificationReceipt(
    receipt,
    serverId as string,
    simulationId,
    input.clock.now(),
    input.binding.boundAt,
  );
  const resultHash = hashCanonicalEvidenceJson(receipt.result);
  const invocationPrefix = `mcp-invocation:${receipt.invocationId}:result-hash:${resultHash}:context:`;
  const policyHash = hashCanonicalEvidenceJson(targetPolicy);
  const permissionRef = `task-capability-binding:${input.binding.bindingId}:hash:${input.binding.bindingHash}:policy-id:${policy.policyId}:revision:${String(policy.revision)}:policy-hash:${policyHash}:context:permission-context`;
  if (
    `${invocationPrefix}current-position`.length > 512 ||
    `${invocationPrefix}resource-state`.length > 512 ||
    permissionRef.length > 512
  )
    invalid('The UGV context evidence reference exceeds the bounded Skill contract.');
  return Object.freeze({
    observations: Object.freeze([
      Object.freeze({
        requirementId: 'current-position',
        source: 'read_only_query' as const,
        status: 'available' as const,
        evidenceRef: `${invocationPrefix}current-position`,
      }),
      Object.freeze({
        requirementId: 'resource-state',
        source: 'read_only_query' as const,
        status: 'available' as const,
        evidenceRef: `${invocationPrefix}resource-state`,
      }),
      Object.freeze({
        requirementId: 'permission-context',
        source: 'authoritative_context' as const,
        status: 'available' as const,
        evidenceRef: permissionRef,
      }),
    ]),
    risk: 'high' as const,
    humanConfirmation: 'pending' as const,
    taskAvailabilityArguments: arguments_,
    runtimeExecutionContext: execution,
    systemPolicy: Object.freeze({
      allowedModes: Object.freeze(['template', 'procedure'] as const),
      preferredMode: 'procedure' as const,
      requireProcedureForHighRisk: true,
      allowGuidanceWithIncompleteContext: false,
    }),
  });
}

/** Legacy projection intentionally fails closed until runtime composition supplies durable facts. */
export function projectUgvMoveSkillUsageContext(context: SkillUsageSelectionContext): never {
  void context;
  invalid('UGV Skill Usage requires the durable profile qualification authority.');
}

/** Exact evidence-reference contract consumed by the profile Workflow candidate guard. */
export function hasExactUgvMoveSkillUsageContextEvidence(
  context: SkillContextResolutionSummary,
): boolean {
  const current = context.requirements[0];
  const resource = context.requirements[1];
  const permission = context.requirements[2];
  const currentEvidence = parseInvocationEvidence(current?.evidenceRef, 'current-position');
  const resourceEvidence = parseInvocationEvidence(resource?.evidenceRef, 'resource-state');
  return (
    context.requirements.length === 3 &&
    context.satisfied === 3 &&
    context.total === 3 &&
    context.complete &&
    context.inputRequiredIds.length === 0 &&
    context.unsatisfiedIds.length === 0 &&
    context.unknownIds.length === 0 &&
    exactResolution(current, 'current-position', 'read_only_query', [
      'authoritative_context',
      'read_only_query',
    ]) &&
    exactResolution(resource, 'resource-state', 'read_only_query', [
      'authoritative_context',
      'read_only_query',
    ]) &&
    exactResolution(permission, 'permission-context', 'authoritative_context', [
      'authoritative_context',
    ]) &&
    currentEvidence !== undefined &&
    resourceEvidence?.invocationId === currentEvidence.invocationId &&
    resourceEvidence.resultHash === currentEvidence.resultHash &&
    parsePermissionEvidence(permission?.evidenceRef)
  );
}

function assertBinding(binding: TaskCapabilityBinding): void {
  try {
    createTaskCapabilityBinding(binding);
  } catch {
    invalid('The UGV Task Capability binding hash is invalid.');
  }
}

function exactlyOneConstraint(binding: TaskCapabilityBinding, type: string) {
  const matches = binding.constraintSnapshot.filter((constraint) => constraint['type'] === type);
  const match = matches[0];
  if (matches.length !== 1 || match === undefined)
    invalid(`The UGV Task Capability requires exactly one ${type} constraint.`);
  return match;
}

function exactTargetPolicy(value: Readonly<Record<string, unknown>>) {
  const policyId = value['policyId'];
  const revision = value['revision'];
  if (
    typeof policyId !== 'string' ||
    !BOUNDED_POLICY_ID.test(policyId) ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  )
    invalid('The frozen UGV simulation target policy identity is invalid.');
  const expected = createUgvSimulationTargetPolicy({ policyId, revision });
  if (!sameJson(value, expected)) invalid('The frozen UGV simulation target policy is not exact.');
  return Object.freeze({ policyId, revision });
}

/**
 * Shared fail-closed validator for the one durable taskless state receipt used by qualification
 * and later formal Skill Usage admission. Supplying the same instant for `nowText` and
 * `boundAtText` validates a just-recorded receipt before a Task Capability binding exists.
 */
export function validateUgvSimulationQualificationReceipt(
  receipt: McpInvocation,
  serverId: string,
  simulationId: string,
  nowText: string,
  boundAtText: string,
) {
  const startedAt = timestamp(receipt.startedAt);
  const completedAt = timestamp(receipt.completedAt);
  const now = timestamp(nowText);
  const boundAt = timestamp(boundAtText);
  if (
    receipt.invocationId.trim() !== receipt.invocationId ||
    !BOUNDED_REFERENCE_ID.test(receipt.invocationId) ||
    receipt.taskId !== undefined ||
    receipt.capabilityAttemptId !== undefined ||
    receipt.controlConfirmationId !== undefined ||
    receipt.controlProviderBindingId !== undefined ||
    receipt.controlArgumentsHash !== undefined ||
    receipt.controlDispatchHash !== undefined ||
    receipt.executionMode !== 'simulation' ||
    receipt.simulationId !== simulationId ||
    receipt.serverId !== serverId ||
    receipt.toolName !== STATE_OPERATION ||
    ![
      {
        effect: 'read_only',
        execution: 'synchronous',
        cancellation: 'unsupported',
        idempotency: 'server_managed',
        replay: 'allowed',
        source: 'mcp_declared',
      },
      {
        effect: 'read_only',
        execution: 'synchronous',
        cancellation: 'unsupported',
        idempotency: 'server_managed',
        replay: 'allowed',
        source: 'admin_override',
      },
    ].some((expected) => sameJson(receipt.executionSemantics, expected)) ||
    !sameJson(receipt.arguments, ugvSimulationQualificationStateReadArguments()) ||
    receipt.status !== 'succeeded' ||
    receipt.errorCode !== undefined ||
    receipt.errorMessage !== undefined ||
    completedAt < startedAt ||
    receipt.durationMs !== completedAt - startedAt ||
    completedAt > boundAt ||
    boundAt > now ||
    now < completedAt
  )
    invalid('The UGV qualification invocation identity or lifecycle is invalid.');
  // Admission and planning independently require the same narrow qualification window. Current
  // Provider availability is also re-read by readiness; neither check substitutes for the other.
  if (boundAt - completedAt > UGV_SIMULATION_QUALIFICATION_MAX_ADMISSION_AGE_MS)
    stale('The UGV qualification receipt expired before Task Capability admission.');
  if (now - completedAt > UGV_SIMULATION_QUALIFICATION_MAX_ADMISSION_AGE_MS)
    stale('The UGV qualification receipt expired before Skill Usage planning.');

  const result = record(receipt.result);
  const state = record(result?.['structuredContent']);
  const identity = record(state?.['identity']);
  const connectivity = record(state?.['connectivity']);
  const freshness = record(state?.['freshness']);
  const chassis = record(state?.['chassis']);
  const position = record(chassis?.['position']);
  const mission = record(chassis?.['mission']);
  const health = record(state?.['health']);
  const components = record(health?.['components']);
  const observedAtText = state?.['observedAt'];
  const observedAt = timestamp(observedAtText);
  const chassisObservedAt = timestamp(freshness?.['chassisObservedAt']);
  const healthObservedAt = timestamp(freshness?.['healthObservedAt']);
  const normalizedPosition = {
    longitude: position?.['longitude'],
    latitude: position?.['latitude'],
  };
  if (
    !Array.isArray(result?.['content']) ||
    result['isError'] !== false ||
    state === undefined ||
    identity?.['providerId'] !== UGV_PROVIDER_ID ||
    identity['resourceId'] !== UGV_RESOURCE_ID ||
    identity['vehicleType'] !== 'ugv' ||
    identity['executionMode'] !== 'simulation' ||
    connectivity?.['mqttConnected'] !== true ||
    connectivity['deviceMcpConnected'] !== true ||
    connectivity['deviceAvailable'] !== true ||
    !validPosition(normalizedPosition) ||
    typeof chassis?.['speedKmh'] !== 'number' ||
    !Number.isFinite(chassis['speedKmh']) ||
    chassis['speedKmh'] < 0 ||
    chassis['speedKmh'] > 0.1 ||
    mission === undefined ||
    ![-1, 0, 3, 4, 5].includes(mission['state'] as number) ||
    health === undefined ||
    !Array.isArray(health['chassisErrorCodes']) ||
    !Array.isArray(health['payloadErrorCodes']) ||
    components === undefined ||
    components['communications'] === 'fault' ||
    components['gnss'] === 'fault' ||
    components['navigation'] === 'fault' ||
    typeof state['revision'] !== 'string' ||
    !PLAIN_SHA256.test(state['revision']) ||
    typeof state['mqttIngressSequence'] !== 'number' ||
    !Number.isSafeInteger(state['mqttIngressSequence']) ||
    state['mqttIngressSequence'] < 1 ||
    typeof observedAtText !== 'string' ||
    observedAt > completedAt + MAXIMUM_FUTURE_SKEW_MS ||
    chassisObservedAt > completedAt + MAXIMUM_FUTURE_SKEW_MS ||
    healthObservedAt > completedAt + MAXIMUM_FUTURE_SKEW_MS ||
    boundAt - observedAt < -MAXIMUM_FUTURE_SKEW_MS ||
    boundAt - chassisObservedAt < -MAXIMUM_FUTURE_SKEW_MS ||
    boundAt - healthObservedAt < -MAXIMUM_FUTURE_SKEW_MS
  )
    invalid('The UGV qualification result is not a fresh authoritative resource state.');
  if (
    boundAt - observedAt > UGV_SIMULATION_QUALIFICATION_MAX_ADMISSION_AGE_MS ||
    boundAt - chassisObservedAt > UGV_SIMULATION_QUALIFICATION_MAX_ADMISSION_AGE_MS ||
    boundAt - healthObservedAt > HEALTH_FRESHNESS_MS
  )
    stale('The UGV Provider state was stale at Task Capability admission.');
  return Object.freeze({
    position: Object.freeze({
      longitude: normalizedPosition.longitude,
      latitude: normalizedPosition.latitude,
    }),
    observedAt: observedAtText,
    revision: state['revision'],
    mqttIngressSequence: state['mqttIngressSequence'],
  });
}

function exactCapabilityObservations(
  context: SkillUsageSelectionContext,
  binding: TaskCapabilityBinding,
  providerBindingId: string,
): boolean {
  const resource = context.observations[0];
  const provider = context.observations[1];
  const providerPrefix = `node-control-provider-binding:${providerBindingId}:revision:`;
  if (
    context.observations.length !== 2 ||
    resource?.requirementId !== 'public-resource-id' ||
    resource.source !== 'authoritative_context' ||
    resource.status !== 'available' ||
    resource.evidenceRef !==
      `task-capability-binding:${binding.bindingId}:hash:${binding.bindingHash}` ||
    provider?.requirementId !== 'provider-binding-freshness' ||
    provider.source !== 'authoritative_context' ||
    provider.status !== 'available' ||
    !provider.evidenceRef?.startsWith(providerPrefix)
  )
    return false;
  const remainder = provider.evidenceRef.slice(providerPrefix.length);
  const marker = ':observed-at:';
  const markerIndex = remainder.indexOf(marker);
  if (markerIndex < 1) return false;
  const revision = remainder.slice(0, markerIndex);
  const observedAt = remainder.slice(markerIndex + marker.length);
  return /^[1-9][0-9]*$/u.test(revision) && Number.isFinite(Date.parse(observedAt));
}

function exactSystemPolicy(context: SkillUsageSelectionContext): boolean {
  return (
    sameStrings(context.systemPolicy.allowedModes, ['guidance', 'template', 'procedure']) &&
    context.systemPolicy.preferredMode === undefined &&
    context.systemPolicy.requireProcedureForHighRisk &&
    !context.systemPolicy.allowGuidanceWithIncompleteContext
  );
}

function exactInputKeys(
  input: Readonly<Record<string, unknown>> | undefined,
  target: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return (
    input !== undefined &&
    target !== undefined &&
    sameStrings(Object.keys(input).sort(), ['resourceId', 'target']) &&
    sameStrings(Object.keys(target).sort(), ['frame', 'x', 'y'])
  );
}

function validTarget(
  value: Readonly<Record<string, unknown>> | UgvSimulationTarget | undefined,
): value is UgvSimulationTarget {
  return (
    value?.frame === 'WGS84' &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    value.x >= -180 &&
    value.x <= 180 &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y) &&
    value.y >= -90 &&
    value.y <= 90
  );
}

function validPosition(
  value: Readonly<{ longitude: unknown; latitude: unknown }>,
): value is Readonly<{
  longitude: number;
  latitude: number;
}> {
  return (
    typeof value.longitude === 'number' &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180 &&
    typeof value.latitude === 'number' &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90
  );
}

function exactResolution(
  resolution: SkillContextResolutionSummary['requirements'][number] | undefined,
  requirementId: string,
  source: 'read_only_query' | 'authoritative_context',
  attemptedSources: readonly ('read_only_query' | 'authoritative_context')[],
): boolean {
  return (
    resolution?.requirementId === requirementId &&
    resolution.required &&
    resolution.status === 'satisfied' &&
    resolution.source === source &&
    sameStrings(resolution.attemptedSources, attemptedSources)
  );
}

function parseInvocationEvidence(
  evidenceRef: string | undefined,
  requirementId: 'current-position' | 'resource-state',
): Readonly<{ invocationId: string; resultHash: string }> | undefined {
  if (evidenceRef === undefined || evidenceRef.length > 512) return undefined;
  const match = new RegExp(
    `^mcp-invocation:([A-Za-z0-9._-]{1,128}):result-hash:(sha256:[0-9a-f]{64}):context:${requirementId}$`,
    'u',
  ).exec(evidenceRef);
  const invocationId = match?.[1];
  const resultHash = match?.[2];
  return invocationId === undefined || resultHash === undefined
    ? undefined
    : Object.freeze({ invocationId, resultHash });
}

function parsePermissionEvidence(evidenceRef: string | undefined): boolean {
  if (evidenceRef === undefined || evidenceRef.length > 512) return false;
  return /^task-capability-binding:[A-Za-z0-9._-]{1,128}:hash:[0-9a-f]{64}:policy-id:[A-Za-z0-9._/-]{1,128}:revision:[1-9][0-9]*:policy-hash:sha256:[0-9a-f]{64}:context:permission-context$/u.test(
    evidenceRef,
  );
}

/** The qualification entry point cannot accept caller-selected Tool arguments. */
export function ugvSimulationQualificationStateReadArguments(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    resourceId: UGV_RESOURCE_ID,
    include: Object.freeze(['chassis', 'health']),
  });
}

function timestamp(value: unknown): number {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) invalid('The UGV qualification timestamp is invalid.');
  return parsed;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return hashCanonicalEvidenceJson(left) === hashCanonicalEvidenceJson(right);
  } catch {
    return false;
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function present(value: string | undefined): value is string {
  if (value === undefined) return false;
  return value.trim() === value && value.length > 0 && value.length <= 128;
}

function invalid(message: string): never {
  throw new UgvMoveSkillUsageError('UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED', message);
}

function stale(message: string): never {
  throw new UgvMoveSkillUsageError('UGV_MOVE_SKILL_USAGE_QUALIFICATION_STALE', message);
}

export type UgvMoveSkillUsageErrorCode =
  'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' | 'UGV_MOVE_SKILL_USAGE_QUALIFICATION_STALE';

export class UgvMoveSkillUsageError extends Error {
  constructor(
    readonly code: UgvMoveSkillUsageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UgvMoveSkillUsageError';
  }
}
