import { createHash } from 'node:crypto';
import { ZMQ_PATROL_SKILL, ZMQ_PATROL_CAPABILITY } from '../../domain/src/zmq-area-patrol.js';
import {
  buildZmqPatrolSkill,
  parseZmqPatrolChildren,
  zmqPatrolConstraints,
  ZMQ_PATROL_SUCCESS_CRITERIA,
  ZMQ_PATROL_REQUIRED_EVIDENCE,
} from '../../domain/src/zmq-patrol-contract.js';

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
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly outcomeSpecification?: unknown;
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
  readonly childDependencies?: readonly Readonly<{
    skillId: string;
    skillVersion: number;
    capabilityId: string;
    capabilityVersion: number;
  }>[];
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
    if (
      input.definition.capabilityId === ZMQ_PATROL_CAPABILITY ||
      implementation.implementationId === ZMQ_PATROL_SKILL
    )
      return assessZmqPatrol(input);
    if (
      input.definition.capabilityId === 'embodied.area_patrol' ||
      implementation.implementationId === 'embodied.area_patrol'
    )
      return assessPatrol(input);
    const resourceId = record(
      record(record(input.definition.inputSchema)?.['properties'])?.['resourceId'],
    )?.['const'];
    const applies =
      input.definition.capabilityId === 'embodied.move' ||
      (implementation.implementationId === 'embodied.move_to' &&
        implementation.implementationVersion === '1');
    if (!applies) return NOT_APPLICABLE;
    if (
      !nonEmpty(resourceId) ||
      resourceId.length > 256 ||
      input.definition.capabilityId !== 'embodied.move' ||
      !isAppendOnlyUgvCapabilityVersion(input.definition) ||
      input.definition.status !== 'published' ||
      !exactUgvDefinitionPromises(input.definition, resourceId) ||
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

    const requirement = exactUgvProviderOverride(implementation.providerPolicyOverride, resourceId);
    const expected = exactUgvCapabilityConstraints(
      input.definition.constraints,
      requirement,
      resourceId,
    );
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

/** Independent reviewed native contract; legacy patrol pins remain unchanged. */
function assessZmqPatrol(
  input: RuntimeSkillProviderDependencyPolicyInput,
): RuntimeSkillProviderDependencyAssessment {
  try {
    const { definition: d, implementation: i, skill } = input;
    const resourceId = record(record(record(d.inputSchema)?.['properties'])?.['resourceId'])?.[
      'const'
    ];
    const version = Number(i.implementationVersion);
    const constraints = d.constraints ?? [];
    const provider = constraints.find((c) => c['type'] === 'provider_binding_policy');
    const composition = constraints.find((c) => c['type'] === 'composition_authority_policy');
    const parsed = parseMcpProviderBindingPolicyOverride(i.providerPolicyOverride);
    const requirement = parsed.requirements[0];
    if (
      !nonEmpty(resourceId) ||
      resourceId.length > 256 ||
      !positiveInteger(version) ||
      i.implementationVersion !== String(version) ||
      !provider ||
      !requirement ||
      parsed.mode !== 'single' ||
      requirement.mcpToolName !== 'vehicle_zmq_inspect_area' ||
      !exactProviderConstraint(provider, requirement, resourceId) ||
      provider['requiredStatus'] !== 'active' ||
      provider['requiredAvailabilityStatus'] !== 'available' ||
      provider['requiredFreshness'] !== 'unexpired' ||
      provider['fallback'] !== 'deny'
    )
      return DENIED;
    const catalogRevision = provider['catalogRevision'],
      catalogChecksum = provider['catalogChecksum'];
    if (typeof catalogRevision !== 'string' || typeof catalogChecksum !== 'string') return DENIED;
    const children = parseZmqPatrolChildren(composition?.['children']);
    const expected = buildZmqPatrolSkill(resourceId, version, provider, children);
    if (
      d.capabilityId !== ZMQ_PATROL_CAPABILITY ||
      d.status !== 'published' ||
      !positiveInteger(d.version) ||
      (d.version === 1 ? d.previousVersion !== undefined : d.previousVersion !== d.version - 1) ||
      input.implementations.length !== 1 ||
      !sameCanonical(input.implementations[0], i) ||
      i.capabilityId !== d.capabilityId ||
      i.capabilityVersion !== d.version ||
      i.implementationType !== 'skill' ||
      i.implementationId !== ZMQ_PATROL_SKILL ||
      i.status !== 'active' ||
      i.role !== 'primary' ||
      i.priority !== 0 ||
      i.activationCondition !== undefined ||
      !positiveInteger(i.revision) ||
      !/^[a-f0-9]{64}$/u.test(skill.packageChecksum ?? '') ||
      !sameCanonical(skill.inputSchema, expected.inputSchema) ||
      !sameCanonical(d.inputSchema, expected.inputSchema) ||
      !sameCanonical(skill.outputSchema, expected.outputSchema) ||
      !sameCanonical(d.outputSchema, expected.outputSchema) ||
      !sameCanonical(skill.toolPolicy, expected.toolPolicy) ||
      !sameCanonical(skill.runtimePolicy, expected.runtimePolicy) ||
      !sameCanonical(skill.usageSpecification, expected.usageSpecification) ||
      !sameCanonical(skill.outcomeSpecification, expected.outcomeSpecification) ||
      !sameCanonical(constraints, zmqPatrolConstraints(resourceId, version, provider, children)) ||
      !sameCanonical(d.supportedModes, ['plan_confirmed', 'composition']) ||
      d.riskLevel !== 'high' ||
      !sameCanonical(d.effects, ['effect.patrol_reported']) ||
      !sameCanonical(d.artifacts, []) ||
      !sameCanonical(d.successCriteria, ZMQ_PATROL_SUCCESS_CRITERIA) ||
      !sameCanonical(d.requiredEvidence, ZMQ_PATROL_REQUIRED_EVIDENCE)
    )
      return DENIED;
    return {
      decision: 'authorized',
      authorization: {
        requirements: [requirement],
        expectedBindings: [
          {
            mcpProviderBindingId: requirement.mcpProviderBindingId,
            localServerId: requirement.localServerId,
            bindingRevision: Number(provider['bindingRevision']),
            catalogRevision,
            catalogChecksum,
          },
        ],
        policyParts: [
          `zmq-patrol-package:${skill.packageChecksum ?? ''}`,
          `zmq-patrol-composition:${hashCanonical({ constraints, usage: skill.usageSpecification })}`,
        ],
        childDependencies: children.map(
          ({ skillId, skillVersion, capabilityId, capabilityVersion }) => ({
            skillId,
            skillVersion,
            capabilityId,
            capabilityVersion,
          }),
        ),
      },
    };
  } catch {
    return DENIED;
  }
}

/** Reviewed, model-free composition. Tool calls belong to its independently confirmed child Tasks. */
function assessPatrol(
  input: RuntimeSkillProviderDependencyPolicyInput,
): RuntimeSkillProviderDependencyAssessment {
  const definition = input.definition,
    implementation = input.implementation;
  const resourceId = record(
    record(record(definition.inputSchema)?.['properties'])?.['resourceId'],
  )?.['const'];
  const skillVersion = Number(implementation.implementationVersion);
  const constraints = definition.constraints ?? [];
  const byType = new Map(constraints.map((value) => [value['type'], value]));
  const types = [
    'resource_policy',
    'provider_binding_policy',
    'exact_skill_version',
    'confirmation_policy',
    'composed_side_effect_policy',
    'composition_authority_policy',
    'runtime_execution_mode_policy',
  ];
  const provider = byType.get('provider_binding_policy');
  const composition = byType.get('composition_authority_policy');
  const parsed = parseMcpProviderBindingPolicyOverride(implementation.providerPolicyOverride);
  const requirement = parsed.requirements[0];
  const children = Array.isArray(composition?.['children'])
    ? composition['children'].map(record)
    : [];
  const outcome = record(input.skill.outcomeSpecification);
  if (
    !nonEmpty(resourceId) ||
    resourceId.length > 256 ||
    definition.capabilityId !== 'embodied.area_patrol' ||
    definition.status !== 'published' ||
    !positiveInteger(definition.version) ||
    (definition.version === 1
      ? definition.previousVersion !== undefined
      : definition.previousVersion !== definition.version - 1) ||
    input.implementations.length !== 1 ||
    !sameCanonical(input.implementations[0], implementation) ||
    implementation.implementationType !== 'skill' ||
    implementation.implementationId !== 'embodied.area_patrol' ||
    !Number.isSafeInteger(skillVersion) ||
    skillVersion < 2 ||
    implementation.implementationVersion !== String(skillVersion) ||
    implementation.capabilityId !== definition.capabilityId ||
    implementation.capabilityVersion !== definition.version ||
    implementation.status !== 'active' ||
    implementation.role !== 'primary' ||
    implementation.priority !== 0 ||
    implementation.activationCondition !== undefined ||
    !positiveInteger(implementation.revision) ||
    !/^[a-f0-9]{64}$/u.test(input.skill.packageChecksum ?? '') ||
    hashCanonical(input.skill.usageSpecification) !==
      '93ca896c32320eab1a9e6871de8ac33274d418f7651358185577dc96dbf019c8' ||
    hashCanonical(input.skill.runtimePolicy) !==
      '386b83b2bdc6519130289f28ca50ccc12369c994b2aaa51a9be19c91de02213b' ||
    !sameCanonical(input.skill.toolPolicy, { required: [], optional: [], forbidden: [] }) ||
    resourceSchemaHash(input.skill.inputSchema) !==
      '728ea3ae099be57c367b28508dd0629b9345846fc5fe7f9606a3597e835f4dc7' ||
    resourceSchemaHash(input.skill.outputSchema) !==
      'f4651ed5bbf1786de28b7faaf461942bbe030e3a2ed80edc10ee4267d8c2634b' ||
    !sameCanonical(input.skill.inputSchema, definition.inputSchema) ||
    !sameCanonical(input.skill.outputSchema, definition.outputSchema) ||
    constraints.length !== types.length ||
    byType.size !== types.length ||
    types.some((type) => !byType.has(type)) ||
    parsed.mode !== 'single' ||
    requirement?.mcpToolName !== 'vehicle_inspect_area' ||
    !provider ||
    !exactProviderConstraint(provider, requirement, resourceId) ||
    !sameCanonical(byType.get('resource_policy'), {
      type: 'resource_policy',
      identifierAuthority: 'public_smpp_tool_schema',
      selection: 'exact_value',
      allowedResourceIds: [resourceId],
      downstreamResourceBinding: 'forbidden',
    }) ||
    !sameCanonical(byType.get('exact_skill_version'), {
      type: 'exact_skill_version',
      skillId: 'embodied.area_patrol',
      skillVersion,
      taskType: 'embodied.area_patrol',
    }) ||
    !sameCanonical(byType.get('confirmation_policy'), {
      type: 'confirmation_policy',
      required: true,
      stage: 'before_execution',
      autoConfirmPlan: false,
    }) ||
    !sameCanonical(byType.get('composed_side_effect_policy'), {
      type: 'composed_side_effect_policy',
      sideEffecting: true,
      exactChildConfirmationRequired: true,
      replay: 'forbidden',
    }) ||
    exactRuntimeMode(byType.get('runtime_execution_mode_policy')) === undefined ||
    !sameCanonical(definition.supportedModes, ['plan_confirmed', 'composition']) ||
    definition.riskLevel !== 'medium' ||
    !sameCanonical(definition.effects, ['effect.patrol_reported']) ||
    !sameCanonical(definition.artifacts, []) ||
    !sameCanonical(definition.successCriteria, [
      { type: 'output_schema_valid', required: true },
      {
        type: 'patrol_report_outcome',
        required: true,
        incompleteOutcome: 'degraded',
        fullSuccessRequires: [
          'native_child_tasks',
          'scoped_inspection_report',
          'actual_trajectory',
        ],
      },
    ]) ||
    !sameCanonical(definition.requiredEvidence, [
      { type: 'native_patrol_child_reports', evidenceType: 'patrol.report', required: true },
    ]) ||
    composition?.['version'] !== 1 ||
    composition['maximumSubregions'] !== 1 ||
    composition['requiredTrajectory'] !== 'retained_actual_navigation' ||
    children.length !== 2 ||
    !exactPatrolChild(children[0], 'embodied.move_to', 'embodied.move', 'a2a.embodied.move') ||
    !exactPatrolChild(
      children[1],
      'embodied.inspect_area',
      'embodied.inspect_area',
      'a2a.embodied.inspect_area',
    ) ||
    !outcome ||
    !sameCanonical(outcome['effects'], ['effect.patrol_reported']) ||
    !sameCanonical(outcome['evidence'], ['patrol.report']) ||
    !sameCanonical(outcome['taskGoalPolicy'], {
      requestedCapabilityId: 'embodied.area_patrol',
      resourceId,
      providerBinding: provider,
      children: composition['children'],
      subregions: 'one_legal_requested_region',
      maximumInspectionElapsedMs: 300000,
    })
  )
    return DENIED;
  return {
    decision: 'authorized',
    authorization: {
      requirements: [requirement],
      expectedBindings: [
        {
          mcpProviderBindingId: requirement.mcpProviderBindingId,
          localServerId: requirement.localServerId,
          bindingRevision: provider['bindingRevision'] as number,
          catalogRevision: provider['catalogRevision'] as string,
          catalogChecksum: provider['catalogChecksum'] as string,
        },
      ],
      policyParts: [
        `patrol-package:${input.skill.packageChecksum ?? ''}`,
        `patrol-composition:${hashCanonical({ constraints, usage: input.skill.usageSpecification })}`,
      ],
      childDependencies: children.map((child) => ({
        skillId: String(child?.['skillId']),
        skillVersion: Number(child?.['skillVersion']),
        capabilityId: String(child?.['capabilityId']),
        capabilityVersion: Number(child?.['capabilityVersion']),
      })),
    },
  };
}

function exactPatrolChild(
  value: Readonly<Record<string, unknown>> | undefined,
  skillId: string,
  capabilityId: string,
  exposureId: string,
): boolean {
  return (
    value !== undefined &&
    hasExactKeys(value, [
      'skillId',
      'skillVersion',
      'capabilityId',
      'capabilityVersion',
      'exposureId',
      'exposureVersion',
    ]) &&
    value['skillId'] === skillId &&
    value['capabilityId'] === capabilityId &&
    value['exposureId'] === exposureId &&
    positiveInteger(value['skillVersion']) &&
    (skillId !== 'embodied.move_to' || value['skillVersion'] === 1) &&
    positiveInteger(value['capabilityVersion']) &&
    positiveInteger(value['exposureVersion'])
  );
}

function resourceSchemaHash(value: unknown): string | undefined {
  const schema = record(value);
  const properties = record(schema?.['properties']);
  if (!schema || !properties) return undefined;
  return hashCanonical({
    ...schema,
    properties: {
      ...properties,
      resourceId: { type: 'string', const: '__RESOURCE_ID__' },
    },
  });
}

function exactUgvDefinitionPromises(
  definition: NodeCapabilityDefinitionVersion,
  resourceId: string,
): boolean {
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
        resourceId: { const: resourceId },
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
        resourceId: { const: resourceId },
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

function exactUgvProviderOverride(
  value: unknown,
  resourceId: string,
): ExactMcpProviderBindingPolicy | undefined {
  const raw = record(value);
  if (raw === undefined || !sameCanonical(raw['allowedResourceIds'], [resourceId]))
    return undefined;
  const parsed = parseMcpProviderBindingPolicyOverride(raw);
  const requirement = parsed.requirements[0];
  if (parsed.mode !== 'single' || requirement?.mcpToolName !== 'vehicle_navigate') return undefined;
  return requirement;
}

function exactUgvCapabilityConstraints(
  constraints: NodeCapabilityDefinitionVersion['constraints'],
  requirement: ExactMcpProviderBindingPolicy | undefined,
  resourceId: string,
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
      allowedResourceIds: [resourceId],
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
    !exactModeSpecificTargetPolicy(executionMode, target, resourceId) ||
    provider === undefined ||
    !exactProviderConstraint(provider, requirement, resourceId)
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
  resourceId: string,
): boolean {
  if (executionMode === 'live') return target === undefined;
  return sameCanonical(target, {
    type: UGV_SIMULATION_TARGET_POLICY_TYPE,
    policyId: 'ugv-agent-profile/explicit-wgs84-target',
    revision: 2,
    executionMode: 'simulation',
    resourceId: resourceId,
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
  resourceId: string,
): boolean {
  return (
    value['type'] === 'provider_binding_policy' &&
    value['mcpProviderBindingId'] === requirement.mcpProviderBindingId &&
    value['localServerId'] === requirement.localServerId &&
    value['mcpToolName'] === requirement.mcpToolName &&
    sameCanonical(value['allowedResourceIds'], [resourceId]) &&
    positiveInteger(value['bindingRevision']) &&
    nonEmpty(value['catalogRevision']) &&
    typeof value['catalogChecksum'] === 'string' &&
    /^[0-9a-f]{64}$/u.test(value['catalogChecksum'])
  );
}

function isAppendOnlyUgvCapabilityVersion(definition: NodeCapabilityDefinitionVersion): boolean {
  if (!positiveInteger(definition.version)) return false;
  if (definition.version === 1) return definition.previousVersion === undefined;
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
