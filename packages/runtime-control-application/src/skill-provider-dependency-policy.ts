import { createHash } from 'node:crypto';

import {
  parseMcpProviderBindingPolicyOverride,
  type CapabilityImplementationBinding,
  type ExactMcpProviderBindingPolicy,
  type NodeCapabilityDefinitionVersion,
} from '../../node-control-domain/src/index.js';

export interface RuntimeSkillProviderDependencyFacts {
  readonly packageChecksum?: string;
  readonly toolPolicy: unknown;
  readonly runtimePolicy: unknown;
  readonly usageSpecification: unknown;
}

export interface RuntimeSkillProviderDependencyPolicyInput {
  readonly definition: NodeCapabilityDefinitionVersion;
  readonly implementations: readonly CapabilityImplementationBinding[];
  readonly implementation: CapabilityImplementationBinding;
  readonly skill: RuntimeSkillProviderDependencyFacts;
}

export interface RuntimeSkillProviderExpectedBindingAuthority {
  readonly mcpProviderBindingId: string;
  readonly localServerId: string;
  readonly bindingRevision: number;
  readonly catalogRevision: string;
  readonly catalogChecksum: string;
}

export interface RuntimeSkillProviderDependencyAuthorization {
  readonly requirements: readonly ExactMcpProviderBindingPolicy[];
  readonly expectedBindings: readonly RuntimeSkillProviderExpectedBindingAuthority[];
  readonly policyParts: readonly string[];
}

export type RuntimeSkillProviderDependencyAssessment =
  | Readonly<{ decision: 'not_applicable' }>
  | Readonly<{ decision: 'denied' }>
  | Readonly<{
      decision: 'authorized';
      authorization: RuntimeSkillProviderDependencyAuthorization;
    }>;

/**
 * Classifies a narrowly defined dynamic Skill Task binding for readiness. `not_applicable` preserves
 * generic static Tool-policy semantics; an applicable identity that drifts is explicitly denied.
 */
export interface RuntimeSkillProviderDependencyPolicy {
  assess(
    input: RuntimeSkillProviderDependencyPolicyInput,
  ): RuntimeSkillProviderDependencyAssessment;
}

const UGV_PACKAGE_CHECKSUM = '6d5fc9c8e093de18a8b11c8377b96788336606b25d0df0f27efef7b4d9f6a48c';
const UGV_USAGE_CHECKSUM = '9801dd4ea424a1b925e51a273a5712f082e41daacbf76f7df9d8595c48b01b87';
const UGV_BASE_CONSTRAINT_TYPES = Object.freeze([
  'resource_policy',
  'provider_binding_policy',
  'exact_skill_version',
  'confirmation_policy',
  'physical_side_effect_policy',
  'runtime_execution_mode_policy',
]);
const UGV_SIMULATION_TARGET_POLICY_TYPE = 'ugv_simulation_target_policy';
const NOT_APPLICABLE: RuntimeSkillProviderDependencyAssessment = Object.freeze({
  decision: 'not_applicable',
});
const DENIED: RuntimeSkillProviderDependencyAssessment = Object.freeze({ decision: 'denied' });

/**
 * Production policy for the immutable embodied.move_to@1 UGV Agent Profile package. Capability
 * versions are append-only lineage rather than an authorization constant: a successor is accepted
 * only when its complete immutable definition, sole implementation, Provider binding, execution
 * mode, resource, and safety promises match one reviewed profile contract.
 */
export class UgvAgentProfileSkillProviderDependencyPolicy implements RuntimeSkillProviderDependencyPolicy {
  assess(
    input: RuntimeSkillProviderDependencyPolicyInput,
  ): RuntimeSkillProviderDependencyAssessment {
    const implementation = input.implementation;
    const applies =
      input.definition.capabilityId === 'embodied.move' ||
      (implementation.implementationId === 'embodied.move_to' &&
        implementation.implementationVersion === '1');
    if (!applies) return NOT_APPLICABLE;
    if (
      input.definition.capabilityId !== 'embodied.move' ||
      !isAppendOnlyUgvCapabilityVersion(input.definition) ||
      input.definition.status !== 'published' ||
      !exactUgvDefinitionPromises(input.definition) ||
      input.implementations.length !== 1 ||
      !sameCanonical(input.implementations[0], implementation) ||
      implementation.capabilityId !== input.definition.capabilityId ||
      implementation.capabilityVersion !== input.definition.version ||
      implementation.implementationType !== 'skill' ||
      implementation.implementationId !== 'embodied.move_to' ||
      implementation.implementationVersion !== '1' ||
      implementation.role !== 'primary' ||
      implementation.priority !== 0 ||
      implementation.activationCondition !== undefined ||
      implementation.status !== 'active' ||
      !positiveInteger(implementation.revision) ||
      input.skill.packageChecksum !== UGV_PACKAGE_CHECKSUM ||
      hashCanonical(input.skill.usageSpecification) !== UGV_USAGE_CHECKSUM ||
      !sameCanonical(input.skill.toolPolicy, {
        required: [],
        optional: [],
        forbidden: [],
      }) ||
      !sameCanonical(input.skill.runtimePolicy, {
        maxDurationSeconds: 600,
        maxMcpCalls: 8,
        maxReplans: 1,
        autoConfirmPlan: false,
        cancelStrategy: 'try_interrupt',
      })
    )
      return DENIED;

    const requirement = exactUgvProviderOverride(implementation.providerPolicyOverride);
    const expected = exactUgvCapabilityConstraints(input.definition.constraints, requirement);
    if (requirement === undefined || expected === undefined) return DENIED;

    return Object.freeze({
      decision: 'authorized',
      authorization: Object.freeze({
        requirements: Object.freeze([requirement]),
        expectedBindings: Object.freeze([expected]),
        policyParts: Object.freeze([
          `skill-package:${UGV_PACKAGE_CHECKSUM}`,
          `skill-usage:${UGV_USAGE_CHECKSUM}`,
          `skill-provider-profile:${hashCanonical({
            implementation,
            constraints: input.definition.constraints,
          })}`,
        ]),
      }),
    });
  }
}

function exactUgvDefinitionPromises(definition: NodeCapabilityDefinitionVersion): boolean {
  return (
    definition.riskLevel === 'high' &&
    sameCanonical(definition.supportedModes, ['plan_confirmed', 'remote_task']) &&
    sameCanonical(definition.successCriteria, [
      { type: 'output_schema_valid', required: true },
      { type: 'resource_identity_matches_request', required: true },
      { type: 'required_evidence_complete', required: true },
      { type: 'remote_task_identity_present', required: true },
      { type: 'remote_terminal_observation_present', required: true },
      { type: 'external_command_dispatch_count', maximum: 1 },
    ]) &&
    sameCanonical(definition.requiredEvidence, [
      {
        type: 'required_evidence',
        evidenceType: 'position.observation',
        required: true,
        hardGate: true,
      },
    ]) &&
    sameCanonical(definition.inputSchema, {
      type: 'object',
      additionalProperties: false,
      required: ['resourceId', 'target'],
      properties: {
        resourceId: { const: 'vehicle:ugv1' },
        target: {
          type: 'object',
          additionalProperties: false,
          required: ['x', 'y', 'frame'],
          properties: {
            x: { type: 'number', minimum: -180, maximum: 180 },
            y: { type: 'number', minimum: -90, maximum: 90 },
            frame: { const: 'WGS84' },
          },
        },
      },
    }) &&
    sameCanonical(definition.outputSchema, {
      type: 'object',
      additionalProperties: false,
      required: ['resourceId', 'status', 'finalPosition'],
      properties: {
        resourceId: { const: 'vehicle:ugv1' },
        status: { const: 'completed' },
        finalPosition: {
          type: 'object',
          additionalProperties: false,
          required: ['x', 'y', 'frame'],
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            frame: { const: 'EPSG:4326' },
          },
        },
      },
    })
  );
}

function exactUgvProviderOverride(value: unknown): ExactMcpProviderBindingPolicy | undefined {
  const raw = record(value);
  if (
    raw === undefined ||
    !hasExactKeys(raw, [
      'selection',
      'mcpProviderBindingId',
      'localServerId',
      'mcpToolName',
      'allowedResourceIds',
      'requireActive',
      'requireAvailable',
      'requireUnexpiredFreshness',
      'denyFallback',
    ]) ||
    !sameCanonical(raw['allowedResourceIds'], ['vehicle:ugv1'])
  )
    return undefined;
  const parsed = parseMcpProviderBindingPolicyOverride(raw);
  const requirement = parsed.requirements[0];
  if (parsed.mode !== 'single' || requirement?.mcpToolName !== 'vehicle_navigate') return undefined;
  return requirement;
}

function exactUgvCapabilityConstraints(
  constraints: NodeCapabilityDefinitionVersion['constraints'],
  requirement: ExactMcpProviderBindingPolicy | undefined,
): RuntimeSkillProviderExpectedBindingAuthority | undefined {
  if (constraints === undefined || requirement === undefined) return undefined;
  const allowedTypes = new Set([...UGV_BASE_CONSTRAINT_TYPES, UGV_SIMULATION_TARGET_POLICY_TYPE]);
  if (constraints.length < 6 || constraints.length > 7) return undefined;
  const byType = new Map<string, Readonly<Record<string, unknown>>>();
  for (const value of constraints) {
    const constraint = record(value);
    const type = constraint?.['type'];
    if (
      constraint === undefined ||
      typeof type !== 'string' ||
      !allowedTypes.has(type) ||
      byType.has(type)
    )
      return undefined;
    byType.set(type, constraint);
  }
  if (
    UGV_BASE_CONSTRAINT_TYPES.some((type) => !byType.has(type)) ||
    byType.size !== constraints.length
  )
    return undefined;

  const resource = byType.get('resource_policy');
  const provider = byType.get('provider_binding_policy');
  const exactSkill = byType.get('exact_skill_version');
  const confirmation = byType.get('confirmation_policy');
  const physical = byType.get('physical_side_effect_policy');
  const runtimeMode = byType.get('runtime_execution_mode_policy');
  const target = byType.get(UGV_SIMULATION_TARGET_POLICY_TYPE);
  const executionMode = exactRuntimeMode(runtimeMode);
  if (
    !sameCanonical(resource, {
      type: 'resource_policy',
      identifierAuthority: 'public_smpp_tool_schema',
      selection: 'exact_value',
      allowedResourceIds: ['vehicle:ugv1'],
      downstreamResourceBinding: 'forbidden',
    }) ||
    !sameCanonical(exactSkill, {
      type: 'exact_skill_version',
      skillId: 'embodied.move_to',
      skillVersion: 1,
      taskType: 'embodied.move',
    }) ||
    !sameCanonical(confirmation, {
      type: 'confirmation_policy',
      required: true,
      stage: 'before_execution',
      autoConfirmPlan: false,
    }) ||
    !sameCanonical(physical, {
      type: 'physical_side_effect_policy',
      sideEffecting: true,
      dispatchMaximum: 1,
      uncertainDispatchPolicy: 'reconcile_never_redispatch',
      remoteTaskTerminalEvidenceRequired: true,
    }) ||
    executionMode === undefined ||
    !exactModeSpecificTargetPolicy(executionMode, target) ||
    provider === undefined ||
    !exactProviderConstraint(provider, requirement, executionMode)
  )
    return undefined;
  return Object.freeze({
    mcpProviderBindingId: requirement.mcpProviderBindingId,
    localServerId: requirement.localServerId,
    bindingRevision: provider['bindingRevision'] as number,
    catalogRevision: provider['catalogRevision'] as string,
    catalogChecksum: provider['catalogChecksum'] as string,
  });
}

function exactRuntimeMode(
  value: Readonly<Record<string, unknown>> | undefined,
): 'simulation' | 'live' | undefined {
  const simulationId = value?.['simulationId'];
  if (
    value !== undefined &&
    hasExactKeys(value, ['type', 'mode', 'simulationId']) &&
    value['type'] === 'runtime_execution_mode_policy' &&
    value['mode'] === 'simulation' &&
    typeof simulationId === 'string' &&
    /^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u.test(simulationId)
  )
    return 'simulation';
  if (
    value !== undefined &&
    hasExactKeys(value, ['type', 'mode']) &&
    value['type'] === 'runtime_execution_mode_policy' &&
    value['mode'] === 'live'
  )
    return 'live';
  return undefined;
}

function exactModeSpecificTargetPolicy(
  executionMode: 'simulation' | 'live',
  target: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (executionMode === 'live') return target === undefined;
  return sameCanonical(target, {
    type: UGV_SIMULATION_TARGET_POLICY_TYPE,
    policyId: 'ugv-agent-profile/explicit-wgs84-target',
    revision: 2,
    executionMode: 'simulation',
    resourceId: 'vehicle:ugv1',
    frame: 'WGS84',
    targetAuthority: 'task_capability_input_snapshot',
    targetDerivation: 'forbidden',
    distanceLimit: 'none',
    altitudePolicy: 'not_commanded_not_terminally_evaluated',
    forbiddenRegions: [],
  });
}

function exactProviderConstraint(
  value: Readonly<Record<string, unknown>>,
  requirement: ExactMcpProviderBindingPolicy,
  executionMode: 'simulation' | 'live',
): boolean {
  const semantics = record(value['executionSemantics']);
  return (
    hasExactKeys(value, [
      'type',
      'mcpProviderBindingId',
      'localServerId',
      'mcpToolName',
      'allowedResourceIds',
      'bindingRevision',
      'catalogRevision',
      'catalogChecksum',
      'taskBehavior',
      'executionSemantics',
      'requiredStatus',
      'requiredAvailabilityStatus',
      'requiredFreshness',
      'fallback',
    ]) &&
    value['type'] === 'provider_binding_policy' &&
    value['mcpProviderBindingId'] === requirement.mcpProviderBindingId &&
    value['localServerId'] === requirement.localServerId &&
    value['mcpToolName'] === requirement.mcpToolName &&
    sameCanonical(value['allowedResourceIds'], ['vehicle:ugv1']) &&
    positiveInteger(value['bindingRevision']) &&
    nonEmpty(value['catalogRevision']) &&
    typeof value['catalogChecksum'] === 'string' &&
    /^[0-9a-f]{64}$/u.test(value['catalogChecksum']) &&
    value['taskBehavior'] === 'task_required' &&
    sameCanonical(semantics, {
      effect: 'side_effecting',
      execution: 'task_required',
      cancellation: 'task_cancel',
      idempotency: 'server_managed',
      replay: executionMode === 'simulation' ? 'simulation_only' : 'forbidden',
      source: 'admin_override',
    }) &&
    value['requiredStatus'] === 'active' &&
    value['requiredAvailabilityStatus'] === 'available' &&
    value['requiredFreshness'] === 'unexpired' &&
    value['fallback'] === 'deny'
  );
}

function isAppendOnlyUgvCapabilityVersion(definition: NodeCapabilityDefinitionVersion): boolean {
  if (!positiveInteger(definition.version) || definition.version < 2) return false;
  return definition.version === 2 || definition.previousVersion === definition.version - 1;
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = record(value);
  if (object === undefined) return JSON.stringify(typeof value);
  return `{${Object.entries(object)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]) {
  return sameCanonical(Object.keys(value).sort(), [...expected].sort());
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
