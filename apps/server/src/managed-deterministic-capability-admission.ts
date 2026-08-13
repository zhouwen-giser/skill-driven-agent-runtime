import type { DeterministicCapabilityExecutionInput } from '../../../packages/management-api/src/index.js';
import {
  deriveFrozenMcpCatalogAuthority,
  frozenTaskReadinessAttributes,
  type McpProtocolDiscoverySnapshot,
  type McpServer,
  type McpTool,
  type SkillVersion,
} from '../../../packages/domain/src/index.js';
import type {
  CapabilityAuthoritySnapshot,
  CurrentMcpProviderBindingAuthoritySnapshot,
} from '../../../packages/runtime-control-application/src/index.js';

export interface ManagedDeterministicReadOnlyAdmission {
  readonly evidenceTypes: readonly string[];
  readonly readinessAttributes: readonly string[];
  readonly goalConstraints: readonly string[];
  readonly goalSuccessCriteria: readonly string[];
}

export function admitManagedDeterministicReadOnlyCapability(
  input: Readonly<{
    request: DeterministicCapabilityExecutionInput;
    capability: CapabilityAuthoritySnapshot;
    providerBinding: CurrentMcpProviderBindingAuthoritySnapshot;
    skill: SkillVersion;
    runtimeServer: McpServer;
    runtimeTools: readonly McpTool[];
    runtimeSnapshot: McpProtocolDiscoverySnapshot;
    now: string;
  }>,
): ManagedDeterministicReadOnlyAdmission {
  const request = input.request;
  const definition = input.capability.definition;
  const now = timestamp(input.now, 'DETERMINISTIC_ADMISSION_CLOCK_INVALID');
  const provider = input.providerBinding.binding;

  if (
    definition['capability_id'] !== request.capabilityId ||
    definition['version'] !== request.capabilityVersion ||
    definition['status'] !== 'published' ||
    definition['risk_level'] !== 'low' ||
    !stringArray(definition['supported_modes'])?.includes('deterministic')
  )
    fail(
      'DETERMINISTIC_CAPABILITY_NOT_ADMITTED',
      'The exact published low-risk deterministic Capability version is not current.',
    );

  const implementations = input.capability.implementationBindings.filter(
    (candidate) => candidate['binding_id'] === request.capabilityBindingId,
  );
  const implementation = implementations[0];
  if (
    implementations.length !== 1 ||
    implementation?.['revision'] !== request.capabilityBindingVersion ||
    implementation['capability_id'] !== request.capabilityId ||
    implementation['capability_version'] !== request.capabilityVersion ||
    implementation['implementation_type'] !== 'skill' ||
    implementation['implementation_id'] !== request.skillId ||
    implementation['implementation_version'] !== String(request.skillVersion) ||
    implementation['role'] !== 'primary' ||
    implementation['status'] !== 'active'
  )
    fail(
      'DETERMINISTIC_CAPABILITY_IMPLEMENTATION_NOT_EXACT',
      'The requested Capability implementation is not one exact active primary Skill binding.',
    );

  assertCurrentProviderBinding(input.providerBinding, request, now);
  assertSmppLineage(input.providerBinding);

  const matchingTools = input.runtimeTools.filter(
    (candidate) =>
      candidate.serverId === request.serverId && candidate.toolName === request.toolName,
  );
  const tool = matchingTools[0];
  if (
    input.runtimeServer.serverId !== request.serverId ||
    input.runtimeServer.status !== 'enabled' ||
    input.runtimeServer.endpoint !== provider.endpointRef ||
    input.runtimeServer.protocolMode !== 'frozen_v1' ||
    input.runtimeServer.currentProtocolSnapshotId !== input.runtimeSnapshot.snapshotId ||
    input.runtimeSnapshot.serverId !== request.serverId ||
    input.runtimeSnapshot.toolRevision !== input.runtimeServer.toolRevision ||
    input.runtimeSnapshot.validUntil === undefined ||
    timestamp(input.runtimeSnapshot.validUntil, 'DETERMINISTIC_RUNTIME_CATALOG_TIME_INVALID') <=
      now ||
    matchingTools.length !== 1 ||
    tool?.protocolMode !== 'frozen_v1' ||
    tool.taskExecutionProfile?.taskBehavior !== 'synchronous_only' ||
    tool.outputSchema === undefined
  )
    fail(
      'DETERMINISTIC_READ_ONLY_TOOL_NOT_READY',
      'The exact current frozen synchronous Tool is not registered.',
    );

  const runtimeCatalog = deriveFrozenMcpCatalogAuthority(
    input.runtimeSnapshot,
    input.runtimeTools,
    input.runtimeServer.toolRevision,
  );
  if (
    runtimeCatalog.catalogRevision !== provider.catalogRevision ||
    runtimeCatalog.catalogChecksum !== provider.catalogChecksum ||
    runtimeCatalog.operationCount !== provider.operationCount
  )
    fail(
      'DETERMINISTIC_PROVIDER_CATALOG_NOT_CURRENT',
      'The Runtime frozen MCP Catalog differs from current Binding authority.',
    );

  assertExplicitReadOnlySemantics(tool);
  const semantics = tool.executionSemantics;
  const inputSchema = definition['input_schema'];
  const outputSchema = definition['output_schema'];
  if (
    !sameJson(inputSchema, input.skill.inputSchema) ||
    !sameJson(inputSchema, tool.inputSchema) ||
    !sameJson(outputSchema, input.skill.outputSchema) ||
    !sameJson(outputSchema, tool.outputSchema)
  )
    fail(
      'DETERMINISTIC_SCHEMA_AUTHORITY_NOT_EXACT',
      'Capability, Skill, and live Tool schemas must be identical.',
    );

  const schemaResourceIds = resourceIds(inputSchema);
  if (!schemaResourceIds.includes(request.resourceId))
    fail(
      'DETERMINISTIC_RESOURCE_NOT_ADMITTED',
      'The exact public resource is not admitted by the current Tool schema.',
    );

  const constraints = recordArray(definition['constraints']);
  const resourcePolicy = exactlyOneConstraint(constraints, 'resource_policy');
  const providerPolicy = exactlyOneConstraint(constraints, 'provider_binding_policy');
  const skillPolicy = exactlyOneConstraint(constraints, 'exact_skill_version');
  const confirmationPolicy = exactlyOneConstraint(constraints, 'confirmation_policy');
  const sideEffectPolicy = exactlyOneConstraint(constraints, 'side_effect_policy');
  const admittedResourceIds = stringArray(resourcePolicy['allowedResourceIds']);
  if (
    resourcePolicy['selection'] !== 'exact_value' ||
    admittedResourceIds === undefined ||
    admittedResourceIds.length === 0 ||
    new Set(admittedResourceIds).size !== admittedResourceIds.length ||
    admittedResourceIds.some((resourceId) => !schemaResourceIds.includes(resourceId)) ||
    !admittedResourceIds.includes(request.resourceId) ||
    (resourcePolicy['downstreamResourceBinding'] !== undefined &&
      resourcePolicy['downstreamResourceBinding'] !== 'forbidden') ||
    skillPolicy['skillId'] !== request.skillId ||
    skillPolicy['skillVersion'] !== request.skillVersion ||
    skillPolicy['taskType'] !== request.toolName ||
    confirmationPolicy['required'] !== false ||
    confirmationPolicy['stage'] !== 'not_applicable' ||
    confirmationPolicy['autoConfirmPlan'] !== false ||
    sideEffectPolicy['sideEffecting'] !== false
  )
    fail(
      'DETERMINISTIC_CAPABILITY_POLICY_NOT_READ_ONLY',
      'Capability constraints do not prove an exact unconfirmed read-only execution.',
    );
  assertCapabilityProviderPolicy(
    providerPolicy,
    request,
    input.providerBinding,
    semantics,
    admittedResourceIds,
  );

  const implementationProviderPolicy = record(implementation['provider_policy_override']);
  if (implementationProviderPolicy === undefined)
    fail(
      'DETERMINISTIC_CAPABILITY_IMPLEMENTATION_POLICY_REQUIRED',
      'The exact Capability implementation has no Provider policy override.',
    );
  assertImplementationProviderPolicy(
    implementationProviderPolicy,
    request,
    input.providerBinding,
    admittedResourceIds,
  );

  const evidenceTypes = requiredCapabilityEvidence(definition['required_evidence']);
  assertCapabilitySuccessCriteria(definition['success_criteria']);
  assertSkillContract(
    input.skill,
    request,
    input.providerBinding,
    tool,
    admittedResourceIds,
    evidenceTypes,
    definition,
  );

  const readinessAttributes = Object.freeze([
    ...new Set([
      ...frozenTaskReadinessAttributes(
        tool.taskExecutionProfile,
        input.runtimeSnapshot.taskNotifications,
      ),
      'effect:read_only',
      'execution:synchronous',
      `catalog_checksum:${provider.catalogChecksum}`,
    ]),
  ]);
  const taskBinding = input.skill.usageSpecification?.taskBindings[0];
  if (
    taskBinding === undefined ||
    !taskBinding.providerPolicy.requiredAttributes.every((attribute) =>
      readinessAttributes.includes(attribute),
    ) ||
    ![
      'task_behavior:synchronous_only',
      'effect:read_only',
      'execution:synchronous',
      `catalog_checksum:${provider.catalogChecksum}`,
    ].every((attribute) => taskBinding.providerPolicy.requiredAttributes.includes(attribute))
  )
    fail(
      'DETERMINISTIC_SKILL_READINESS_POLICY_NOT_PROVABLE',
      'Skill readiness attributes are not fully derivable from current Tool and Catalog authority.',
    );

  return Object.freeze({
    evidenceTypes,
    readinessAttributes,
    goalConstraints: Object.freeze(
      constraints.map((constraint) => `Capability constraint: ${canonicalJson(constraint)}`),
    ),
    goalSuccessCriteria: Object.freeze([
      ...recordArray(definition['success_criteria']).map(
        (criterion) => `Capability success criterion: ${canonicalJson(criterion)}`,
      ),
      ...recordArray(definition['required_evidence']).map(
        (evidence) => `Capability required evidence: ${canonicalJson(evidence)}`,
      ),
    ]),
  });
}

function assertCurrentProviderBinding(
  authority: CurrentMcpProviderBindingAuthoritySnapshot,
  request: DeterministicCapabilityExecutionInput,
  now: number,
): void {
  const binding = authority.binding;
  if (
    binding.bindingId !== request.mcpProviderBindingId ||
    binding.localServerId !== request.serverId ||
    binding.providerId !== request.providerId ||
    timestamp(authority.observedAt, 'DETERMINISTIC_PROVIDER_BINDING_TIME_INVALID') > now ||
    timestamp(binding.catalogObservedAt, 'DETERMINISTIC_PROVIDER_BINDING_TIME_INVALID') > now ||
    timestamp(binding.availabilityValidUntil, 'DETERMINISTIC_PROVIDER_BINDING_TIME_INVALID') <= now
  )
    fail(
      'DETERMINISTIC_PROVIDER_BINDING_NOT_CURRENT',
      'Current MCP Provider Binding authority does not match the exact request.',
    );
}

function assertSmppLineage(authority: CurrentMcpProviderBindingAuthoritySnapshot): void {
  const binding = authority.binding;
  const lineage = authority.sourceCandidateLineage;
  if (binding.originType === 'direct') {
    if (
      binding.externalProviderId !== undefined ||
      binding.externalServerId !== undefined ||
      binding.registryRevision !== undefined ||
      binding.registryChecksum !== undefined ||
      lineage !== undefined
    )
      fail(
        'DETERMINISTIC_PROVIDER_BINDING_LINEAGE_INVALID',
        'A direct Binding cannot claim SMPP source lineage.',
      );
    return;
  }
  if (
    binding.externalProviderId === undefined ||
    binding.externalServerId === undefined ||
    binding.registryRevision === undefined ||
    binding.registryChecksum === undefined ||
    lineage === undefined ||
    binding.providerId !== binding.externalProviderId ||
    lineage.externalProviderId !== binding.externalProviderId ||
    lineage.externalServerId !== binding.externalServerId ||
    lineage.registryRevision !== binding.registryRevision ||
    lineage.registryChecksum !== binding.registryChecksum ||
    lineage.candidateEndpoint !== binding.endpointRef
  )
    fail(
      'DETERMINISTIC_PROVIDER_BINDING_LINEAGE_INVALID',
      'The current SMPP Binding has no exact native source/candidate lineage.',
    );
}

function assertExplicitReadOnlySemantics(tool: McpTool): void {
  const semantics = tool.executionSemantics;
  const source =
    semantics.source === 'mcp_declared'
      ? tool.declaredExecutionSemantics
      : semantics.source === 'admin_override'
        ? tool.adminExecutionSemanticsOverride
        : undefined;
  if (
    semantics.effect !== 'read_only' ||
    semantics.execution !== 'synchronous' ||
    Object.values(semantics).some((value) => value === 'unknown') ||
    source === undefined ||
    !sameJson(source, semantics)
  )
    fail(
      'DETERMINISTIC_TOOL_SEMANTICS_NOT_READ_ONLY',
      'Unknown, inferred, or side-effecting Tool semantics cannot enter deterministic execution.',
    );
}

function assertCapabilityProviderPolicy(
  policy: Readonly<Record<string, unknown>>,
  request: DeterministicCapabilityExecutionInput,
  authority: CurrentMcpProviderBindingAuthoritySnapshot,
  semantics: McpTool['executionSemantics'],
  resourceIds_: readonly string[],
): void {
  assertProviderIdentity(policy, request, authority, semantics, resourceIds_);
  if (
    policy['requiredStatus'] !== 'active' ||
    policy['requiredAvailabilityStatus'] !== 'available' ||
    policy['requiredFreshness'] !== 'unexpired' ||
    policy['fallback'] !== 'deny'
  )
    fail(
      'DETERMINISTIC_CAPABILITY_PROVIDER_POLICY_NOT_EXACT',
      'Capability Provider constraint does not fail closed on status, freshness, and fallback.',
    );
}

function assertImplementationProviderPolicy(
  policy: Readonly<Record<string, unknown>>,
  request: DeterministicCapabilityExecutionInput,
  authority: CurrentMcpProviderBindingAuthoritySnapshot,
  resourceIds_: readonly string[],
): void {
  const binding = authority.binding;
  if (
    policy['mcpProviderBindingId'] !== request.mcpProviderBindingId ||
    policy['localServerId'] !== request.serverId ||
    policy['mcpToolName'] !== request.toolName ||
    !sameStringSet(stringArray(policy['allowedResourceIds']), resourceIds_) ||
    binding.bindingId !== request.mcpProviderBindingId ||
    policy['selection'] !== 'required' ||
    policy['requireActive'] !== true ||
    policy['requireAvailable'] !== true ||
    policy['requireUnexpiredFreshness'] !== true ||
    policy['denyFallback'] !== true
  )
    fail(
      'DETERMINISTIC_CAPABILITY_IMPLEMENTATION_POLICY_NOT_EXACT',
      'Capability implementation does not require one current Provider without fallback.',
    );
}

function assertProviderIdentity(
  policy: Readonly<Record<string, unknown>>,
  request: DeterministicCapabilityExecutionInput,
  authority: CurrentMcpProviderBindingAuthoritySnapshot,
  semantics: McpTool['executionSemantics'],
  resourceIds_: readonly string[],
): void {
  const binding = authority.binding;
  if (
    policy['mcpProviderBindingId'] !== request.mcpProviderBindingId ||
    policy['localServerId'] !== request.serverId ||
    policy['mcpToolName'] !== request.toolName ||
    !sameStringSet(stringArray(policy['allowedResourceIds']), resourceIds_) ||
    policy['bindingRevision'] !== binding.revision ||
    policy['catalogRevision'] !== binding.catalogRevision ||
    policy['catalogChecksum'] !== binding.catalogChecksum ||
    policy['taskBehavior'] !== 'synchronous_only' ||
    !sameJson(policy['executionSemantics'], semantics) ||
    !registryPolicyIdentityMatches(policy, authority)
  )
    fail(
      'DETERMINISTIC_PROVIDER_POLICY_IDENTITY_MISMATCH',
      'Capability Provider policy differs from current Binding, Tool, or resource authority.',
    );
}

function assertSkillContract(
  skill: SkillVersion,
  request: DeterministicCapabilityExecutionInput,
  authority: CurrentMcpProviderBindingAuthoritySnapshot,
  tool: McpTool,
  resourceIds_: readonly string[],
  evidenceTypes: readonly string[],
  definition: Readonly<Record<string, unknown>>,
): void {
  const usage = skill.usageSpecification;
  const outcome = skill.outcomeSpecification;
  const requiredTool = skill.toolPolicy.required[0];
  const taskBinding = usage?.taskBindings[0];
  const sideEffects = record(outcome?.sideEffectPolicy);
  const taskGoal = record(outcome?.taskGoalPolicy);
  const confidence = record(outcome?.confidencePolicy);
  const contexts = usage?.contextRequirements ?? [];
  const contextIds = contexts.map((item) => item.requirementId).sort();
  const evidenceRequirements = usage?.evidencePolicy.requirements ?? [];
  const capabilityEffects = stringArray(definition['effects']);
  const capabilityArtifacts = stringArray(definition['artifacts']);
  if (
    skill.skillId !== request.skillId ||
    skill.version !== request.skillVersion ||
    skill.status !== 'enabled' ||
    !skill.validationPassed ||
    skill.capabilities.length !== 1 ||
    skill.capabilities[0] !== request.capabilityId ||
    skill.toolPolicy.required.length !== 1 ||
    requiredTool?.serverId !== request.serverId ||
    requiredTool.toolName !== request.toolName ||
    skill.toolPolicy.optional.length !== 0 ||
    skill.runtimePolicy.autoConfirmPlan ||
    skill.runtimePolicy.maxReplans !== 0 ||
    skill.runtimePolicy.maxLlmCalls !== 0 ||
    skill.runtimePolicy.maxMcpCalls !== 1 ||
    outcome === undefined ||
    !sameStringSet(outcome.effects, capabilityEffects) ||
    !sameStringSet(outcome.artifacts, capabilityArtifacts) ||
    !sameStringSet(outcome.evidence, evidenceTypes) ||
    sideEffects?.['sideEffecting'] !== false ||
    sideEffects['confirmation'] !== 'not_required' ||
    taskGoal?.['taskType'] !== request.toolName ||
    taskGoal['requestedCapabilityId'] !== request.capabilityId ||
    taskGoal['resourceId'] !== request.resourceId ||
    confidence?.['rejectSuccessWithoutRequiredEvidence'] !== true ||
    confidence['requireSchemaValidation'] !== true ||
    confidence['mcpAcceptanceIsTerminalSuccess'] !== false ||
    usage?.modes.supported.length !== 1 ||
    usage.modes.supported[0] !== 'procedure' ||
    usage.modes.defaultMode !== 'procedure' ||
    usage.normative.requiredConfirmations.length !== 0 ||
    usage.normative.noApplicableSkill !== 'reject' ||
    usage.adaptive.allowPreferredProviderFallback ||
    usage.taskBindings.length !== 1 ||
    taskBinding?.taskType !== request.toolName ||
    taskBinding.providerPolicy.selection !== 'required' ||
    taskBinding.providerPolicy.requiredProviderId !== request.serverId ||
    taskBinding.providerPolicy.preferredProviderIds.length !== 0 ||
    taskBinding.providerPolicy.forbiddenProviderIds.length !== 0 ||
    !sameStringSet(contextIds, ['provider-binding-freshness', 'public-resource-id']) ||
    contexts.some((item) => !item.required) ||
    (usage.composition !== undefined &&
      (usage.composition.fixedDependencies.length !== 0 ||
        usage.composition.capabilitySlots.length !== 0)) ||
    !usage.evidencePolicy.rejectSuccessWithoutRequiredEvidence ||
    evidenceRequirements.length !== evidenceTypes.length ||
    !sameStringSet(
      evidenceRequirements.map((item) => item.evidenceType),
      evidenceTypes,
    ) ||
    new Set(evidenceRequirements.map((item) => item.requirementId)).size !==
      evidenceRequirements.length ||
    evidenceRequirements.some(
      (item) => !item.required || !item.hardGate || !evidenceTypes.includes(item.evidenceType),
    )
  )
    fail(
      'DETERMINISTIC_READ_ONLY_SKILL_POLICY_INVALID',
      'The exact Skill does not preserve the current closed read-only procedure contract.',
    );
  assertSkillTaskGoalPolicy(taskGoal, request, authority, tool.executionSemantics, resourceIds_);
}

function assertSkillTaskGoalPolicy(
  policy: Readonly<Record<string, unknown>>,
  request: DeterministicCapabilityExecutionInput,
  authority: CurrentMcpProviderBindingAuthoritySnapshot,
  semantics: McpTool['executionSemantics'],
  resourceIds_: readonly string[],
): void {
  const binding = authority.binding;
  if (
    policy['mcpProviderBindingId'] !== request.mcpProviderBindingId ||
    policy['localServerId'] !== request.serverId ||
    policy['mcpToolName'] !== request.toolName ||
    policy['bindingRevision'] !== binding.revision ||
    policy['catalogRevision'] !== binding.catalogRevision ||
    policy['catalogChecksum'] !== binding.catalogChecksum ||
    policy['taskBehavior'] !== 'synchronous_only' ||
    !sameJson(policy['executionSemantics'], semantics) ||
    !resourceIds_.includes(String(policy['resourceId'])) ||
    !registryPolicyIdentityMatches(policy, authority)
  )
    fail(
      'DETERMINISTIC_SKILL_AUTHORITY_IDENTITY_MISMATCH',
      'Skill outcome authority differs from current Capability, Binding, or Tool authority.',
    );
}

function registryPolicyIdentityMatches(
  policy: Readonly<Record<string, unknown>>,
  authority: CurrentMcpProviderBindingAuthoritySnapshot,
): boolean {
  const binding = authority.binding;
  return binding.originType === 'smpp_registry'
    ? policy['registryRevision'] === binding.registryRevision &&
        policy['registryChecksum'] === binding.registryChecksum
    : policy['registryRevision'] === undefined && policy['registryChecksum'] === undefined;
}

function requiredCapabilityEvidence(value: unknown): readonly string[] {
  const entries = recordArray(value);
  const evidence = entries.map((entry) => {
    const evidenceType = entry['evidenceType'];
    if (
      entry['type'] !== 'required_evidence' ||
      typeof evidenceType !== 'string' ||
      evidenceType.trim() === '' ||
      entry['required'] !== true ||
      entry['hardGate'] !== true
    )
      fail(
        'DETERMINISTIC_EVIDENCE_CONTRACT_INVALID',
        'Capability evidence must be explicit, required, and hard-gated.',
      );
    return evidenceType;
  });
  if (evidence.length === 0 || new Set(evidence).size !== evidence.length)
    fail(
      'DETERMINISTIC_EVIDENCE_CONTRACT_INVALID',
      'Capability evidence must be non-empty and unique.',
    );
  return Object.freeze(evidence);
}

function assertCapabilitySuccessCriteria(value: unknown): void {
  const criteria = recordArray(value);
  const byType = new Map(criteria.map((criterion) => [criterion['type'], criterion]));
  if (
    byType.get('output_schema_valid')?.['required'] !== true ||
    byType.get('resource_identity_matches_request')?.['required'] !== true ||
    byType.get('required_evidence_complete')?.['required'] !== true ||
    byType.get('mcp_acceptance_is_terminal_success')?.['value'] !== false ||
    byType.get('normalized_observation_present')?.['required'] !== true
  )
    fail(
      'DETERMINISTIC_SUCCESS_CONTRACT_INVALID',
      'Capability success criteria do not require schema, resource, and observation evidence.',
    );
}

function resourceIds(schema: unknown): readonly string[] {
  const root = record(schema);
  const properties = record(root?.['properties']);
  const resource = record(properties?.['resourceId']);
  const required = stringArray(root?.['required']);
  const values: string[] = [];
  if (typeof resource?.['const'] === 'string') values.push(resource['const']);
  const enumValues = stringArray(resource?.['enum']);
  if (enumValues !== undefined) values.push(...enumValues);
  const unique = [...new Set(values)];
  if (required === undefined || !required.includes('resourceId') || unique.length === 0)
    fail(
      'DETERMINISTIC_RESOURCE_AUTHORITY_MISSING',
      'The current input schema must require a public resourceId bounded by const or enum.',
    );
  return Object.freeze(unique);
}

function exactlyOneConstraint(
  constraints: readonly Readonly<Record<string, unknown>>[],
  type: string,
): Readonly<Record<string, unknown>> {
  const matching = constraints.filter((constraint) => constraint['type'] === type);
  const constraint = matching[0];
  if (matching.length !== 1 || constraint === undefined)
    fail(
      'DETERMINISTIC_CAPABILITY_CONSTRAINT_NOT_EXACT',
      `Capability requires exactly one ${type} constraint.`,
    );
  return constraint;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function recordArray(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value) || value.some((item) => record(item) === undefined))
    fail('DETERMINISTIC_CAPABILITY_AUTHORITY_INVALID', 'Capability authority is malformed.');
  return value as readonly Readonly<Record<string, unknown>>[];
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && item.trim() !== '')
    ? value
    : undefined;
}

function sameStringSet(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return false;
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function timestamp(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code, 'Deterministic authority timestamp is invalid.');
  return parsed;
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}
