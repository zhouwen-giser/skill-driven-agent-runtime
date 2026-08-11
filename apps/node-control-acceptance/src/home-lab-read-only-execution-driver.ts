import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const JSON_SCHEMA = z.union([z.boolean(), z.record(z.string(), z.unknown())]);
const PROVIDER_TIMESTAMP = z.iso.datetime({ offset: true });

export type HomeLabReadOnlyExecutionKind = 'main_light' | 'climate';

export interface HomeLabReadOnlyExecutionContract {
  readonly kind: HomeLabReadOnlyExecutionKind;
  readonly capabilityId: string;
  readonly capabilityVersion: 1;
  readonly capabilityBindingId: string;
  readonly skillId: string;
  readonly skillVersion: 1;
  readonly mcpProviderBindingId: string;
  readonly localServerId: string;
  readonly toolName: string;
  readonly resourceId: string;
  readonly evidenceType: string;
}

export const HOME_LAB_READ_ONLY_EXECUTION_CONTRACTS: readonly HomeLabReadOnlyExecutionContract[] =
  Object.freeze([
    Object.freeze({
      kind: 'main_light' as const,
      capabilityId: 'home.light.read-state',
      capabilityVersion: 1 as const,
      capabilityBindingId: 'capability-binding-home.light.read-state-v1',
      skillId: 'home.light.get-state',
      skillVersion: 1 as const,
      mcpProviderBindingId: 'mcp-binding-ha-light-lab',
      localServerId: 'home-lab-light-mcp',
      toolName: 'light_get_state',
      resourceId: 'living-room-main-light',
      evidenceType: 'light.state.observation',
    }),
    Object.freeze({
      kind: 'climate' as const,
      capabilityId: 'home.climate.read-state',
      capabilityVersion: 1 as const,
      capabilityBindingId: 'capability-binding-home.climate.read-state-v1',
      skillId: 'home.climate.get-state',
      skillVersion: 1 as const,
      mcpProviderBindingId: 'mcp-binding-ha-climate-lab',
      localServerId: 'home-lab-climate-mcp',
      toolName: 'climate_get_state',
      resourceId: 'living-room-air-conditioner',
      evidenceType: 'climate.state.observation',
    }),
  ]);

export interface HomeLabReadOnlyExecutionConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly runtimeManagementBaseUrl: string;
  readonly runtimeCognitiveBearerToken: string;
  readonly runId: string;
  readonly contracts?: readonly HomeLabReadOnlyExecutionContract[];
}

export interface HomeLabReadOnlyExecutionReport {
  readonly schemaVersion: 'sdar.home-lab-read-only-execution/v1';
  readonly status: 'passed';
  readonly observedAt: string;
  readonly readOnlyExecutionPlaneReady: true;
  readonly executions: readonly HomeLabReadOnlyExecutionItem[];
  readonly safety: Readonly<{
    physicalWrites: 0;
    modelCalls: 0;
    mcpCalls: 2;
    onlyReadTools: true;
  }>;
  readonly redaction: Readonly<{
    secretsIncluded: false;
    endpointsIncluded: false;
    entityIdsIncluded: false;
  }>;
}

export interface HomeLabReadOnlyExecutionItem {
  readonly kind: HomeLabReadOnlyExecutionKind;
  readonly taskId: string;
  readonly contextId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly capabilityBindingId: string;
  readonly capabilityBindingVersion: number;
  readonly capabilityBindingHash: string;
  readonly capabilityId: string;
  readonly capabilityVersion: 1;
  readonly skillId: string;
  readonly skillVersion: 1;
  readonly workflowPlanId: string;
  readonly workflowInstanceId: string;
  readonly skillExecutionId: string;
  readonly mcpProviderBindingId: string;
  readonly mcpProviderBindingRevision: number;
  readonly mcpInvocationId: string;
  readonly providerId: string;
  readonly localServerId: string;
  readonly toolName: string;
  readonly resourceId: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly evidence: readonly Readonly<{
    evidenceId: string;
    evidenceType: string;
    observedAt: string;
    subjectRef: string;
    producer: readonly string[];
    payloadRef: Readonly<{ kind: 'structured_content'; jsonPointer: string }>;
  }>[];
  readonly lineage: Readonly<{
    smppSourceId: string;
    externalServerId: string;
    registryRevision: number;
    registryChecksum: string;
    catalogRevision: string;
    catalogChecksum: string;
  }>;
}

export class HomeLabReadOnlyExecutionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HomeLabReadOnlyExecutionError';
    this.code = code;
  }
}

const BindingSchema = z
  .object({
    bindingId: z.string().min(1),
    localServerId: z.string().min(1),
    originType: z.literal('smpp_registry'),
    smppSourceId: z.string().min(1),
    externalProviderId: z.string().min(1),
    externalServerId: z.string().min(1),
    registryRevision: z.number().int().nonnegative(),
    registryChecksum: z.string().regex(CHECKSUM),
    catalogRevision: z.string().min(1),
    catalogChecksum: z.string().regex(CHECKSUM),
    status: z.literal('active'),
    availabilityStatus: z.literal('available'),
    availabilityValidUntil: z.iso.datetime(),
    catalogObservedAt: z.iso.datetime(),
    operationCount: z.number().int().positive(),
    revision: z.number().int().positive(),
  })
  .loose();

const CapabilitySchema = z
  .object({
    capabilityId: z.string().min(1),
    version: z.number().int().positive(),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    requiredEvidence: z.array(z.record(z.string(), z.unknown())),
    constraints: z.array(z.record(z.string(), z.unknown())),
    supportedModes: z.array(z.string()),
    riskLevel: z.literal('low'),
    status: z.literal('published'),
    definitionHash: z.string().regex(CHECKSUM),
  })
  .loose();

const ImplementationSchema = z
  .object({
    bindingId: z.string().min(1),
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    implementationType: z.literal('skill'),
    implementationId: z.string().min(1),
    implementationVersion: z.string().min(1),
    role: z.literal('primary'),
    priority: z.number().int().nonnegative(),
    providerPolicyOverride: z.record(z.string(), z.unknown()),
    status: z.literal('active'),
    revision: z.number().int().positive(),
  })
  .strict();

const GovernedSkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.union([z.string().min(1), z.number().int().positive()]),
    status: z.literal('published'),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    usageSpecification: z.record(z.string(), z.unknown()),
    outcomeSpecification: z.record(z.string(), z.unknown()),
    providerPolicy: z.record(z.string(), z.unknown()),
    evidencePolicy: z.record(z.string(), z.unknown()),
  })
  .loose();

const RuntimeSkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.number().int().positive(),
    capabilities: z.array(z.string()),
    inputSchema: JSON_SCHEMA,
    outputSchema: JSON_SCHEMA,
    toolPolicy: z.record(z.string(), z.unknown()),
    runtimePolicy: z.record(z.string(), z.unknown()),
    usageSpecification: z.record(z.string(), z.unknown()),
    outcomeSpecification: z.record(z.string(), z.unknown()),
    status: z.literal('enabled'),
  })
  .loose();

const ToolSchema = z
  .object({
    serverId: z.string().min(1),
    toolName: z.string().min(1),
    inputSchema: JSON_SCHEMA,
    outputSchema: JSON_SCHEMA,
    protocolMode: z.literal('frozen_v1'),
    taskExecutionProfile: z
      .object({
        taskBehavior: z.enum(['synchronous_only', 'server_directed', 'task_required']),
      })
      .loose(),
  })
  .loose();

const PayloadRefSchema = z
  .object({ kind: z.literal('structured_content'), jsonPointer: z.string() })
  .strict();
const ProviderEvidenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    evidenceType: z.string().min(1),
    observedAt: PROVIDER_TIMESTAMP,
    subjectRef: z.string().min(1),
    producer: z.array(z.string().min(1)).min(1),
    payloadRef: PayloadRefSchema,
  })
  .strict();

const ExecutionResponseSchema = z
  .object({
    schemaVersion: z.literal('sdar.deterministic-read-only-capability-execution/v1'),
    status: z.literal('succeeded'),
    execution: z
      .object({
        taskId: z.string().min(1),
        capabilityBindingId: z.string().min(1),
        capabilityBindingVersion: z.number().int().positive(),
        capabilityId: z.string().min(1),
        capabilityVersion: z.number().int().positive(),
        skillId: z.string().min(1),
        skillVersion: z.number().int().positive(),
        workflowPlanId: z.string().min(1),
        workflowInstanceId: z.string().min(1),
        mcpProviderBindingId: z.string().min(1),
        mcpInvocationId: z.string().min(1),
        providerId: z.string().min(1),
        serverId: z.string().min(1),
        toolName: z.string().min(1),
        resourceId: z.string().min(1),
      })
      .strict(),
    result: z.record(z.string(), z.unknown()),
    evidence: z.array(
      z
        .object({
          requirementId: z.string().min(1),
          evidenceType: z.string().min(1),
          required: z.boolean(),
          hardGate: z.boolean(),
          satisfied: z.boolean(),
          evidenceId: z.string().min(1).optional(),
          observedAt: PROVIDER_TIMESTAMP.optional(),
          payloadRef: PayloadRefSchema.optional(),
        })
        .strict(),
    ),
    safety: z
      .object({
        executionMode: z.literal('live'),
        physicalWrites: z.literal(0),
        modelCalls: z.literal(0),
        mcpCalls: z.literal(1),
        identifierAuthority: z.literal('public_resource_id'),
      })
      .strict(),
  })
  .strict();

const TaskSchema = z
  .object({
    taskId: z.string().min(1),
    contextId: z.string().min(1),
    requestMetadata: z.record(z.string(), z.unknown()),
    phase: z.literal('completed'),
    goalId: z.string().min(1),
    goalVersion: z.number().int().positive(),
    planId: z.string().min(1),
    selectedSkillId: z.string().min(1),
    selectedSkillVersion: z.number().int().positive(),
    skillSelectionId: z.string().min(1),
    skillInputResolutionId: z.string().min(1),
    output: z.object({ text: z.string().min(1), structured: z.unknown() }).strict(),
  })
  .loose();

const ReferenceSchema = z
  .object({
    kind: z.string().min(1),
    referenceId: z.string().min(1),
    referenceType: z.string().min(1),
    sourceSystem: z.string().min(1),
    producedAt: PROVIDER_TIMESTAMP.optional(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .loose();
const SkillExecutionSchema = z
  .object({
    executionId: z.string().min(1),
    taskId: z.string().min(1),
    goalId: z.string().min(1),
    goalVersion: z.number().int().positive(),
    skillId: z.string().min(1),
    skillVersion: z.number().int().positive(),
    workflowPlanId: z.string().min(1),
    status: z.literal('completed'),
    events: z.array(z.record(z.string(), z.unknown())),
    references: z.array(ReferenceSchema),
  })
  .loose();

const WorkflowTraceSchema = z
  .object({
    instance: z
      .object({
        instanceId: z.string().min(1),
        planId: z.string().min(1),
        goalId: z.string().min(1),
        goalVersion: z.number().int().positive(),
        skillVersions: z.array(
          z.object({ skillId: z.string().min(1), version: z.number().int().positive() }).strict(),
        ),
        budgetUsage: z.object({ llmCalls: z.number().int(), mcpCalls: z.number().int() }).loose(),
        status: z.literal('succeeded'),
        input: z.unknown(),
        result: z.unknown(),
      })
      .loose(),
    events: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();

const InvocationSchema = z
  .object({
    invocationId: z.string().min(1),
    taskId: z.string().min(1),
    contextId: z.string().min(1),
    executionMode: z.literal('live'),
    serverId: z.string().min(1),
    toolName: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
    result: z
      .object({
        content: z.array(z.unknown()),
        structuredContent: z.record(z.string(), z.unknown()),
        isError: z.literal(false),
        evidence: z.array(ProviderEvidenceSchema),
      })
      .loose(),
    status: z.literal('succeeded'),
  })
  .loose();

type Binding = z.infer<typeof BindingSchema>;
type Capability = z.infer<typeof CapabilitySchema>;
type Implementation = z.infer<typeof ImplementationSchema>;
type GovernedSkill = z.infer<typeof GovernedSkillSchema>;
type RuntimeSkill = z.infer<typeof RuntimeSkillSchema>;
type Tool = z.infer<typeof ToolSchema>;
type ExecutionResponse = z.infer<typeof ExecutionResponseSchema>;

interface PreparedAuthority {
  readonly contract: HomeLabReadOnlyExecutionContract;
  readonly binding: Binding;
  readonly capability: Capability;
  readonly implementation: Implementation;
  readonly governedSkill: GovernedSkill;
  readonly runtimeSkill: RuntimeSkill;
  readonly tool: Tool;
  readonly taskId: string;
  readonly contextId: string;
}

export async function executeHomeLabReadOnlyCapabilities(
  input: HomeLabReadOnlyExecutionConfiguration,
  dependencies: Readonly<{ fetch?: typeof fetch; now?: () => string }> = {},
): Promise<HomeLabReadOnlyExecutionReport> {
  const configuration = validateConfiguration(input);
  const request = dependencies.fetch ?? fetch;
  const observedAt = validTimestamp(
    dependencies.now?.() ?? new Date().toISOString(),
    'DRIVER_CLOCK_INVALID',
  );
  const contracts = configuration.contracts ?? HOME_LAB_READ_ONLY_EXECUTION_CONTRACTS;

  // Both authorities are fully resolved before the first live MCP invocation is admitted.
  const prepared = await Promise.all(
    contracts.map((contract) => prepareAuthority(configuration, contract, observedAt, request)),
  );
  const executions: HomeLabReadOnlyExecutionItem[] = [];
  for (const authority of prepared)
    executions.push(await executeAndVerify(configuration, authority, request));

  if (
    executions.length !== 2 ||
    !executions.some((item) => item.kind === 'main_light') ||
    !executions.some((item) => item.kind === 'climate')
  )
    fail('READ_ONLY_EXECUTION_SET_INCOMPLETE', 'Exactly the light and climate reads are required.');

  const report: HomeLabReadOnlyExecutionReport = Object.freeze({
    schemaVersion: 'sdar.home-lab-read-only-execution/v1',
    status: 'passed',
    observedAt,
    readOnlyExecutionPlaneReady: true,
    executions: Object.freeze(executions),
    safety: Object.freeze({
      physicalWrites: 0,
      modelCalls: 0,
      mcpCalls: 2,
      onlyReadTools: true,
    }),
    redaction: Object.freeze({
      secretsIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    }),
  });
  assertSafeSdarJson(report);
  return report;
}

async function prepareAuthority(
  configuration: HomeLabReadOnlyExecutionConfiguration,
  contract: HomeLabReadOnlyExecutionContract,
  observedAt: string,
  request: typeof fetch,
): Promise<PreparedAuthority> {
  assertContractReadOnly(contract);
  const capabilityPath = `/api/v1/node-capabilities/${encodeURIComponent(contract.capabilityId)}/versions/${String(contract.capabilityVersion)}`;
  const skillPath = `/api/v1/skills/${encodeURIComponent(contract.skillId)}/versions/${String(contract.skillVersion)}`;
  const [
    bindingValue,
    capabilityValue,
    implementationValue,
    governedSkillValue,
    runtimeSkillValue,
    toolsValue,
  ] = await Promise.all([
    controlGet(
      configuration,
      `/api/v1/mcp-provider-bindings/${encodeURIComponent(contract.mcpProviderBindingId)}`,
      request,
    ),
    controlGet(configuration, capabilityPath, request),
    controlGet(configuration, `${capabilityPath}/implementations?pageSize=100`, request),
    controlGet(configuration, skillPath, request),
    runtimeGet(configuration, skillPath, request),
    runtimeGet(
      configuration,
      `/api/v1/mcp/servers/${encodeURIComponent(contract.localServerId)}/tools`,
      request,
    ),
  ]);
  const binding = parse(BindingSchema, bindingValue, 'MCP_PROVIDER_BINDING_INVALID');
  const capability = parse(CapabilitySchema, capabilityValue, 'CAPABILITY_AUTHORITY_INVALID');
  const implementations = parse(
    z.object({ items: z.array(ImplementationSchema) }).loose(),
    implementationValue,
    'CAPABILITY_IMPLEMENTATION_INVALID',
  ).items;
  const governedSkill = parse(GovernedSkillSchema, governedSkillValue, 'GOVERNED_SKILL_INVALID');
  const runtimeSkill = parse(RuntimeSkillSchema, runtimeSkillValue, 'RUNTIME_SKILL_INVALID');
  const tools = parse(
    z.object({ items: z.array(ToolSchema) }).loose(),
    toolsValue,
    'MCP_TOOL_CATALOG_INVALID',
  ).items;
  const matchingTools = tools.filter((item) => item.toolName === contract.toolName);
  if (matchingTools.length !== 1)
    fail('MCP_TOOL_IDENTITY_NOT_EXACT', 'Expected exactly one case-sensitive read Tool.');
  const tool = matchingTools[0];
  if (tool === undefined)
    return fail('MCP_TOOL_IDENTITY_NOT_EXACT', 'The exact read Tool is unavailable.');
  if (implementations.length !== 1)
    fail(
      'CAPABILITY_IMPLEMENTATION_AUTHORITY_AMBIGUOUS',
      'The published Capability must have exactly one implementation.',
    );
  const implementation = implementations[0];
  if (implementation === undefined)
    return fail('CAPABILITY_IMPLEMENTATION_MISSING', 'Capability implementation is missing.');

  assertBinding(binding, contract, observedAt);
  assertCapability(capability, implementation, binding, contract);
  assertSkills(governedSkill, runtimeSkill, binding, contract);
  assertTool(tool, runtimeSkill, contract);
  assertSafeSdarJson({
    capability,
    implementation,
    governedSkill,
    runtimeSkill,
    tool: {
      serverId: tool.serverId,
      toolName: tool.toolName,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    },
  });
  return Object.freeze({
    contract,
    binding,
    capability,
    implementation,
    governedSkill,
    runtimeSkill,
    tool,
    taskId: stableIdentifier('task', configuration.runId, contract.kind),
    contextId: stableIdentifier('context', configuration.runId, contract.kind),
  });
}

function assertContractReadOnly(contract: HomeLabReadOnlyExecutionContract): void {
  const expected = HOME_LAB_READ_ONLY_EXECUTION_CONTRACTS.find(
    (candidate) => candidate.kind === contract.kind,
  );
  if (expected === undefined || stableStringify(contract) !== stableStringify(expected))
    fail(
      'READ_ONLY_CONTRACT_NOT_EXACT',
      'Only the frozen main-light and climate get-state contracts are admitted.',
    );
  if (!contract.toolName.endsWith('_get_state'))
    fail('WRITE_TOOL_FORBIDDEN', 'The execution set contains a non-read Tool.');
}

function assertBinding(
  binding: Binding,
  contract: HomeLabReadOnlyExecutionContract,
  observedAt: string,
): void {
  if (
    binding.bindingId !== contract.mcpProviderBindingId ||
    binding.localServerId !== contract.localServerId
  )
    fail('MCP_PROVIDER_BINDING_IDENTITY_MISMATCH', 'Provider Binding identity is not exact.');
  if (Date.parse(binding.availabilityValidUntil) <= Date.parse(observedAt))
    fail('MCP_PROVIDER_BINDING_STALE', 'Provider Binding availability has expired.');
  if (Date.parse(binding.catalogObservedAt) > Date.parse(observedAt))
    fail('MCP_PROVIDER_BINDING_CLOCK_INVALID', 'Provider Binding observation is in the future.');
}

function assertCapability(
  capability: Capability,
  implementation: Implementation,
  binding: Binding,
  contract: HomeLabReadOnlyExecutionContract,
): void {
  if (
    capability.capabilityId !== contract.capabilityId ||
    capability.version !== contract.capabilityVersion ||
    capability.supportedModes.length !== 1 ||
    capability.supportedModes[0] !== 'deterministic'
  )
    fail('CAPABILITY_AUTHORITY_MISMATCH', 'Published Capability identity or mode is not exact.');
  const evidence = capability.requiredEvidence.filter(
    (item) => item['evidenceType'] === contract.evidenceType,
  );
  if (
    evidence.length !== 1 ||
    evidence[0]?.['required'] !== true ||
    evidence[0]['hardGate'] !== true
  )
    fail('CAPABILITY_EVIDENCE_POLICY_INVALID', 'Capability required evidence is not exact.');

  const resourcePolicy = findPolicy(capability.constraints, 'resource_policy');
  const providerPolicy = findPolicy(capability.constraints, 'provider_binding_policy');
  const skillPolicy = findPolicy(capability.constraints, 'exact_skill_version');
  const confirmationPolicy = findPolicy(capability.constraints, 'confirmation_policy');
  if (
    resourcePolicy['identifierAuthority'] !== 'public_resource_id' ||
    resourcePolicy['physicalResourceBinding'] !== 'forbidden' ||
    !stringArray(resourcePolicy['allowedResourceIds']).includes(contract.resourceId) ||
    providerPolicy['mcpProviderBindingId'] !== binding.bindingId ||
    providerPolicy['localServerId'] !== binding.localServerId ||
    providerPolicy['mcpToolName'] !== contract.toolName ||
    providerPolicy['requiredStatus'] !== 'active' ||
    providerPolicy['requiredAvailabilityStatus'] !== 'available' ||
    providerPolicy['requiredFreshness'] !== 'unexpired' ||
    providerPolicy['fallback'] !== 'deny' ||
    skillPolicy['skillId'] !== contract.skillId ||
    skillPolicy['skillVersion'] !== contract.skillVersion ||
    skillPolicy['taskType'] !== contract.toolName ||
    confirmationPolicy['required'] !== false
  )
    fail('CAPABILITY_CONSTRAINTS_INVALID', 'Capability closed execution constraints drifted.');

  const override = implementation.providerPolicyOverride;
  if (
    implementation.bindingId !== contract.capabilityBindingId ||
    implementation.capabilityId !== contract.capabilityId ||
    implementation.capabilityVersion !== contract.capabilityVersion ||
    implementation.implementationId !== contract.skillId ||
    implementation.implementationVersion !== String(contract.skillVersion) ||
    implementation.priority !== 0 ||
    implementation.revision !== 1 ||
    override['selection'] !== 'required' ||
    override['mcpProviderBindingId'] !== binding.bindingId ||
    override['localServerId'] !== binding.localServerId ||
    override['mcpToolName'] !== contract.toolName ||
    !stringArray(override['allowedResourceIds']).includes(contract.resourceId) ||
    override['requireActive'] !== true ||
    override['requireAvailable'] !== true ||
    override['requireUnexpiredFreshness'] !== true ||
    override['denyFallback'] !== true
  )
    fail(
      'CAPABILITY_IMPLEMENTATION_DRIFT',
      'Capability implementation is not the exact Skill and Provider Binding.',
    );
  assertSchema(capability.inputSchema, { resourceId: contract.resourceId }, 'CAPABILITY_INPUT');
}

function assertSkills(
  governed: GovernedSkill,
  runtime: RuntimeSkill,
  binding: Binding,
  contract: HomeLabReadOnlyExecutionContract,
): void {
  if (
    governed.skillId !== contract.skillId ||
    String(governed.version) !== String(contract.skillVersion) ||
    runtime.skillId !== contract.skillId ||
    runtime.version !== contract.skillVersion ||
    runtime.capabilities.length !== 1 ||
    runtime.capabilities[0] !== contract.capabilityId
  )
    fail('SKILL_EXACT_VERSION_DRIFT', 'Governed and Runtime Skill identities are not exact.');
  if (
    stableStringify(governed.inputSchema) !== stableStringify(runtime.inputSchema) ||
    stableStringify(governed.outputSchema) !== stableStringify(runtime.outputSchema) ||
    stableStringify(governed.usageSpecification) !== stableStringify(runtime.usageSpecification) ||
    stableStringify(governed.outcomeSpecification) !== stableStringify(runtime.outcomeSpecification)
  )
    fail('SKILL_GOVERNANCE_PROJECTION_DRIFT', 'Skill governance projections are inconsistent.');

  const requiredTools = recordArray(runtime.toolPolicy['required']);
  const taskBindings = recordArray(runtime.usageSpecification['taskBindings']);
  const evidenceRequirements = recordArray(
    record(runtime.usageSpecification['evidencePolicy'], 'SKILL_EVIDENCE_POLICY_INVALID')[
      'requirements'
    ],
  );
  const modes = record(runtime.usageSpecification['modes'], 'SKILL_MODE_POLICY_INVALID');
  const outcomeSideEffects = record(
    runtime.outcomeSpecification['sideEffectPolicy'],
    'SKILL_SIDE_EFFECT_POLICY_INVALID',
  );
  const taskBinding = taskBindings[0];
  const taskProviderPolicy = record(
    taskBinding?.['providerPolicy'],
    'SKILL_PROVIDER_POLICY_INVALID',
  );
  const governedRequired = recordArray(governed.providerPolicy['required']);
  if (
    requiredTools.length !== 1 ||
    requiredTools[0]?.['serverId'] !== binding.localServerId ||
    requiredTools[0]['toolName'] !== contract.toolName ||
    recordArray(runtime.toolPolicy['optional']).length !== 0 ||
    recordArray(runtime.toolPolicy['forbidden']).length !== 0 ||
    stableStringify(governedRequired) !== stableStringify(requiredTools) ||
    runtime.runtimePolicy['maxLlmCalls'] !== 0 ||
    runtime.runtimePolicy['maxMcpCalls'] !== 1 ||
    taskBindings.length !== 1 ||
    taskBinding?.['taskType'] !== contract.toolName ||
    taskProviderPolicy['selection'] !== 'required' ||
    taskProviderPolicy['requiredProviderId'] !== binding.localServerId ||
    !stringArray(taskProviderPolicy['requiredAttributes']).includes(
      'task_behavior:synchronous_only',
    ) ||
    stringArray(modes['supported']).length !== 1 ||
    stringArray(modes['supported'])[0] !== 'procedure' ||
    modes['defaultMode'] !== 'procedure' ||
    outcomeSideEffects['sideEffecting'] !== false ||
    outcomeSideEffects['confirmation'] !== 'not_required' ||
    evidenceRequirements.length !== 1 ||
    evidenceRequirements[0]?.['evidenceType'] !== contract.evidenceType ||
    evidenceRequirements[0]['required'] !== true ||
    evidenceRequirements[0]['hardGate'] !== true ||
    record(runtime.usageSpecification['evidencePolicy'], 'SKILL_EVIDENCE_POLICY_INVALID')[
      'rejectSuccessWithoutRequiredEvidence'
    ] !== true ||
    !stringArray(governed.evidencePolicy['requiredEvidence']).includes(contract.evidenceType)
  )
    fail('SKILL_READ_ONLY_POLICY_INVALID', 'Skill read-only procedure policy drifted.');
  assertSchema(runtime.inputSchema, { resourceId: contract.resourceId }, 'SKILL_INPUT');
}

function assertTool(
  tool: Tool,
  runtimeSkill: RuntimeSkill,
  contract: HomeLabReadOnlyExecutionContract,
): void {
  if (
    tool.serverId !== contract.localServerId ||
    tool.toolName !== contract.toolName ||
    tool.taskExecutionProfile.taskBehavior !== 'synchronous_only'
  )
    fail('MCP_TOOL_IDENTITY_NOT_EXACT', 'MCP Tool identity is not exact.');
  if (stableStringify(tool.outputSchema) !== stableStringify(runtimeSkill.outputSchema))
    fail('MCP_TOOL_OUTPUT_SCHEMA_DRIFT', 'Tool and Skill output schemas differ.');
  assertSchema(tool.inputSchema, { resourceId: contract.resourceId }, 'MCP_TOOL_INPUT');
}

async function executeAndVerify(
  configuration: HomeLabReadOnlyExecutionConfiguration,
  authority: PreparedAuthority,
  request: typeof fetch,
): Promise<HomeLabReadOnlyExecutionItem> {
  const { contract, binding, implementation } = authority;
  const response = parse(
    ExecutionResponseSchema,
    await runtimePost(
      configuration,
      '/api/v1/capability-executions/deterministic',
      authority.taskId,
      {
        taskId: authority.taskId,
        contextId: authority.contextId,
        capabilityBindingId: implementation.bindingId,
        capabilityBindingVersion: implementation.revision,
        capabilityId: contract.capabilityId,
        capabilityVersion: contract.capabilityVersion,
        skillId: contract.skillId,
        skillVersion: contract.skillVersion,
        mcpProviderBindingId: binding.bindingId,
        providerId: binding.externalProviderId,
        serverId: binding.localServerId,
        toolName: contract.toolName,
        resourceId: contract.resourceId,
      },
      request,
    ),
    'DETERMINISTIC_EXECUTION_RESPONSE_INVALID',
  );
  assertExecutionResponse(response, authority);

  const [taskValue, skillExecutionsValue, traceValue, invocationsValue] = await Promise.all([
    runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(authority.taskId)}`, request),
    runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(authority.taskId)}/skill-executions`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/workflows/plans/${encodeURIComponent(response.execution.workflowPlanId)}/trace`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/mcp/invocations?taskId=${encodeURIComponent(authority.taskId)}`,
      request,
    ),
  ]);
  const task = parse(TaskSchema, taskValue, 'TASK_PROJECTION_INVALID');
  const skillExecutions = parse(
    z.object({ items: z.array(SkillExecutionSchema) }).loose(),
    skillExecutionsValue,
    'SKILL_EXECUTION_PROJECTION_INVALID',
  ).items;
  const trace = parse(WorkflowTraceSchema, traceValue, 'WORKFLOW_TRACE_INVALID');
  const invocations = parse(
    z.object({ items: z.array(InvocationSchema) }).loose(),
    invocationsValue,
    'MCP_INVOCATION_PROJECTION_INVALID',
  ).items;
  if (skillExecutions.length !== 1)
    fail('SKILL_EXECUTION_LINEAGE_NOT_EXACT', 'Exactly one Skill execution is required.');
  if (invocations.length !== 1)
    fail('MCP_INVOCATION_LINEAGE_NOT_EXACT', 'Exactly one MCP invocation is required.');
  const skillExecution = skillExecutions[0];
  const invocation = invocations[0];
  if (skillExecution === undefined || invocation === undefined)
    return fail('EXECUTION_LINEAGE_INCOMPLETE', 'Execution projections are incomplete.');

  assertTask(task, response, authority);
  assertSkillExecution(skillExecution, response, authority);
  assertWorkflowTrace(trace, response, authority);
  const providerEvidence = assertInvocation(invocation, response, authority);
  assertSchema(authority.capability.outputSchema, response.result, 'CAPABILITY_OUTPUT');
  assertSchema(authority.runtimeSkill.outputSchema, response.result, 'SKILL_OUTPUT');
  assertSchema(authority.tool.outputSchema, response.result, 'MCP_TOOL_OUTPUT');

  const item: HomeLabReadOnlyExecutionItem = Object.freeze({
    kind: contract.kind,
    taskId: task.taskId,
    contextId: task.contextId,
    goalId: task.goalId,
    goalVersion: task.goalVersion,
    capabilityBindingId: implementation.bindingId,
    capabilityBindingVersion: implementation.revision,
    capabilityBindingHash: sha256(stableStringify(implementation)),
    capabilityId: contract.capabilityId,
    capabilityVersion: contract.capabilityVersion,
    skillId: skillExecution.skillId,
    skillVersion: contract.skillVersion,
    workflowPlanId: response.execution.workflowPlanId,
    workflowInstanceId: response.execution.workflowInstanceId,
    skillExecutionId: skillExecution.executionId,
    mcpProviderBindingId: binding.bindingId,
    mcpProviderBindingRevision: binding.revision,
    mcpInvocationId: invocation.invocationId,
    providerId: binding.externalProviderId,
    localServerId: binding.localServerId,
    toolName: contract.toolName,
    resourceId: contract.resourceId,
    result: Object.freeze(structuredClone(response.result)),
    evidence: Object.freeze(
      providerEvidence.map((item) =>
        Object.freeze({
          evidenceId: item.evidenceId,
          evidenceType: item.evidenceType,
          observedAt: item.observedAt,
          subjectRef: item.subjectRef,
          producer: Object.freeze([...item.producer]),
          payloadRef: Object.freeze({ ...item.payloadRef }),
        }),
      ),
    ),
    lineage: Object.freeze({
      smppSourceId: binding.smppSourceId,
      externalServerId: binding.externalServerId,
      registryRevision: binding.registryRevision,
      registryChecksum: binding.registryChecksum,
      catalogRevision: binding.catalogRevision,
      catalogChecksum: binding.catalogChecksum,
    }),
  });
  assertSafeSdarJson(item);
  return item;
}

function assertExecutionResponse(response: ExecutionResponse, authority: PreparedAuthority): void {
  const { contract, binding, implementation } = authority;
  const identity = response.execution;
  if (
    identity.taskId !== authority.taskId ||
    identity.capabilityBindingId !== implementation.bindingId ||
    identity.capabilityBindingVersion !== implementation.revision ||
    identity.capabilityId !== contract.capabilityId ||
    identity.capabilityVersion !== contract.capabilityVersion ||
    identity.skillId !== contract.skillId ||
    identity.skillVersion !== contract.skillVersion ||
    identity.mcpProviderBindingId !== binding.bindingId ||
    identity.providerId !== binding.externalProviderId ||
    identity.serverId !== binding.localServerId ||
    identity.toolName !== contract.toolName ||
    identity.resourceId !== contract.resourceId ||
    response.result['resourceId'] !== contract.resourceId
  )
    fail('DETERMINISTIC_EXECUTION_LINEAGE_MISMATCH', 'Execution response lineage is not exact.');
  const evidence = response.evidence.filter((item) => item.evidenceType === contract.evidenceType);
  if (
    evidence.length !== 1 ||
    evidence[0]?.required !== true ||
    !evidence[0].hardGate ||
    !evidence[0].satisfied ||
    evidence[0].evidenceId === undefined ||
    evidence[0].observedAt === undefined ||
    evidence[0].payloadRef === undefined
  )
    fail('DETERMINISTIC_EVIDENCE_INVALID', 'Execution response evidence is incomplete.');
  assertSafeSdarJson(response);
}

function assertTask(
  task: z.infer<typeof TaskSchema>,
  response: ExecutionResponse,
  authority: PreparedAuthority,
): void {
  const metadata = record(
    task.requestMetadata['io.sdar/deterministicCapabilityExecution'],
    'TASK_AUTHORITY_METADATA_INVALID',
  );
  if (
    task.taskId !== authority.taskId ||
    task.contextId !== authority.contextId ||
    task.planId !== response.execution.workflowPlanId ||
    task.selectedSkillId !== authority.contract.skillId ||
    task.selectedSkillVersion !== authority.contract.skillVersion ||
    canonicalJson(task.output.structured) !== canonicalJson(response.result) ||
    metadata['capabilityBindingId'] !== authority.implementation.bindingId ||
    metadata['capabilityBindingVersion'] !== authority.implementation.revision ||
    metadata['capabilityId'] !== authority.contract.capabilityId ||
    metadata['capabilityVersion'] !== authority.contract.capabilityVersion ||
    metadata['skillId'] !== authority.contract.skillId ||
    metadata['skillVersion'] !== authority.contract.skillVersion ||
    metadata['mcpProviderBindingId'] !== authority.binding.bindingId ||
    metadata['providerId'] !== authority.binding.externalProviderId ||
    metadata['serverId'] !== authority.binding.localServerId ||
    metadata['toolName'] !== authority.contract.toolName ||
    metadata['resourceId'] !== authority.contract.resourceId
  )
    fail('TASK_EXECUTION_LINEAGE_INVALID', 'Task projection differs from execution authority.');
}

function assertSkillExecution(
  execution: z.infer<typeof SkillExecutionSchema>,
  response: ExecutionResponse,
  authority: PreparedAuthority,
): void {
  if (
    execution.taskId !== authority.taskId ||
    execution.goalId === '' ||
    execution.goalVersion < 1 ||
    execution.skillId !== authority.contract.skillId ||
    execution.skillVersion !== authority.contract.skillVersion ||
    execution.workflowPlanId !== response.execution.workflowPlanId
  )
    fail('SKILL_EXECUTION_LINEAGE_INVALID', 'Skill execution identity is not exact.');
  const references = execution.references;
  requireReference(references, 'provider', authority.binding.bindingId, 'mcp.provider_binding');
  requireReference(
    references,
    'evidence',
    authority.implementation.bindingId,
    'node.capability_binding',
  );
  requireReference(references, 'resource', authority.contract.resourceId, 'public.resource');
  requireReference(references, 'outcome', response.execution.mcpInvocationId, 'mcp.invocation');
  const evidenceMatch =
    response.evidence.find((item) => item.evidenceType === authority.contract.evidenceType) ??
    fail('SKILL_PROVIDER_EVIDENCE_REFERENCE_MISSING', 'Provider evidence match is missing.');
  const evidenceId =
    evidenceMatch.evidenceId ??
    fail('SKILL_PROVIDER_EVIDENCE_REFERENCE_MISSING', 'Provider evidence ID is missing.');
  const observedAt =
    evidenceMatch.observedAt ??
    fail('SKILL_PROVIDER_EVIDENCE_REFERENCE_MISSING', 'Provider observedAt is missing.');
  const payloadRef =
    evidenceMatch.payloadRef ??
    fail('SKILL_PROVIDER_EVIDENCE_REFERENCE_MISSING', 'Provider payloadRef is missing.');
  const providerReferences = references.filter(
    (reference) =>
      reference.kind === 'evidence' && reference.referenceType === authority.contract.evidenceType,
  );
  if (providerReferences.length !== 1)
    fail(
      'SKILL_PROVIDER_EVIDENCE_REFERENCE_MISSING',
      'Provider evidence reference is missing, ambiguous or non-canonical.',
    );
  const providerReference =
    providerReferences[0] ??
    fail(
      'SKILL_PROVIDER_EVIDENCE_REFERENCE_MISSING',
      'Provider evidence reference is missing, ambiguous or non-canonical.',
    );
  if (
    providerReference.referenceId !== `${evidenceId}/${evidenceMatch.requirementId}` ||
    providerReference.sourceSystem !== authority.binding.externalProviderId ||
    providerReference.producedAt === undefined ||
    Date.parse(providerReference.producedAt) !== Date.parse(observedAt) ||
    stableStringify(providerReference.metadata) !==
      stableStringify({
        providerEvidenceId: evidenceId,
        requirementId: evidenceMatch.requirementId,
        matched: true,
        hardGate: true,
        jsonPointer: payloadRef.jsonPointer,
      })
  )
    fail(
      'SKILL_PROVIDER_EVIDENCE_REFERENCE_MISSING',
      'Provider evidence reference is missing, ambiguous or non-canonical.',
    );
}

function assertWorkflowTrace(
  trace: z.infer<typeof WorkflowTraceSchema>,
  response: ExecutionResponse,
  authority: PreparedAuthority,
): void {
  const instance = trace.instance;
  if (
    instance.instanceId !== response.execution.workflowInstanceId ||
    instance.planId !== response.execution.workflowPlanId ||
    instance.budgetUsage.llmCalls !== 0 ||
    instance.budgetUsage.mcpCalls !== 1 ||
    canonicalJson(instance.input) !==
      canonicalJson({
        context: {
          'public-resource-id': true,
          'provider-binding-freshness': true,
        },
        evidence: {},
        skillInput: { resourceId: authority.contract.resourceId },
      }) ||
    canonicalJson(instance.result) !== canonicalJson(response.result) ||
    instance.skillVersions.length !== 1 ||
    instance.skillVersions[0]?.skillId !== authority.contract.skillId ||
    instance.skillVersions[0].version !== authority.contract.skillVersion
  )
    fail('WORKFLOW_EXECUTION_LINEAGE_INVALID', 'Workflow trace differs from exact execution.');
}

function assertInvocation(
  invocation: z.infer<typeof InvocationSchema>,
  response: ExecutionResponse,
  authority: PreparedAuthority,
): readonly z.infer<typeof ProviderEvidenceSchema>[] {
  if (
    invocation.invocationId !== response.execution.mcpInvocationId ||
    invocation.taskId !== authority.taskId ||
    invocation.contextId !== authority.contextId ||
    invocation.serverId !== authority.binding.localServerId ||
    invocation.toolName !== authority.contract.toolName ||
    canonicalJson(invocation.arguments) !==
      canonicalJson({ resourceId: authority.contract.resourceId }) ||
    canonicalJson(invocation.result.structuredContent) !== canonicalJson(response.result)
  )
    fail('MCP_INVOCATION_LINEAGE_INVALID', 'MCP invocation differs from exact execution.');
  const evidence = invocation.result.evidence.filter(
    (item) => item.evidenceType === authority.contract.evidenceType,
  );
  if (evidence.length !== 1)
    fail('PROVIDER_EVIDENCE_NOT_EXACT', 'Exactly one required Provider evidence item is required.');
  const item =
    evidence[0] ??
    fail('PROVIDER_EVIDENCE_NOT_EXACT', 'The required Provider evidence item is missing.');
  if (
    item.subjectRef !== `resource:${authority.contract.resourceId}` ||
    !item.producer.includes('home-assistant') ||
    !item.producer.includes(authority.binding.externalProviderId) ||
    resolveJsonPointer(invocation.result.structuredContent, item.payloadRef.jsonPointer) ===
      undefined
  )
    fail(
      'PROVIDER_EVIDENCE_LINEAGE_INVALID',
      'Provider evidence does not prove the exact public resource and HA producer lineage.',
    );
  const match = response.evidence.find((candidate) => candidate.evidenceId === item.evidenceId);
  if (
    match?.observedAt !== item.observedAt ||
    stableStringify(match.payloadRef) !== stableStringify(item.payloadRef)
  )
    fail('PROVIDER_EVIDENCE_MATCH_INVALID', 'SDAR evidence match differs from Provider evidence.');
  return Object.freeze(evidence);
}

function requireReference(
  references: readonly z.infer<typeof ReferenceSchema>[],
  kind: string,
  referenceId: string,
  referenceType: string,
): void {
  if (
    !references.some(
      (reference) =>
        reference.kind === kind &&
        reference.referenceId === referenceId &&
        reference.referenceType === referenceType,
    )
  )
    fail('SKILL_EXECUTION_REFERENCE_MISSING', 'A required Skill execution reference is missing.');
}

function findPolicy(
  policies: readonly Readonly<Record<string, unknown>>[],
  type: string,
): Readonly<Record<string, unknown>> {
  const matches = policies.filter((policy) => policy['type'] === type);
  if (matches.length !== 1)
    return fail('CAPABILITY_CONSTRAINTS_INVALID', `Expected one ${type} constraint.`);
  const match = matches[0];
  return match ?? fail('CAPABILITY_CONSTRAINTS_INVALID', `Missing ${type} constraint.`);
}

function assertSchema(schema: unknown, value: unknown, scope: string): void {
  const validation = new AjvJsonSchemaValidator({ strict: false }).validate(schema, value);
  if (!validation.valid)
    fail(`${scope}_SCHEMA_VALIDATION_FAILED`, 'Structured data failed its authoritative schema.');
}

function resolveJsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) return undefined;
  let current = value;
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) return undefined;
      current = current[Number(segment)];
    } else if (isRecord(current)) current = current[segment];
    else return undefined;
  }
  return current;
}

async function controlGet(
  configuration: HomeLabReadOnlyExecutionConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.nodeControlBaseUrl}${path}`,
    {
      headers: { authorization: `Bearer ${configuration.nodeControlBearerToken}` },
      redirect: 'manual',
    },
    200,
    request,
  );
}

async function runtimeGet(
  configuration: HomeLabReadOnlyExecutionConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.runtimeManagementBaseUrl}${path}`,
    { redirect: 'manual' },
    200,
    request,
  );
}

async function runtimePost(
  configuration: HomeLabReadOnlyExecutionConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.runtimeManagementBaseUrl}${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${configuration.runtimeCognitiveBearerToken}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    },
    201,
    request,
  );
}

async function requestJson(
  url: string,
  init: RequestInit,
  expectedStatus: number,
  request: typeof fetch,
): Promise<unknown> {
  const response = await request(url, init);
  if (response.status !== expectedStatus) {
    let remoteCode = `HTTP_${String(response.status)}`;
    try {
      const problem = z
        .object({
          code: z.string().min(1).optional(),
          error: z
            .object({ code: z.string().min(1) })
            .loose()
            .optional(),
        })
        .loose()
        .parse(await response.json());
      remoteCode = problem.code ?? problem.error?.code ?? remoteCode;
    } catch {
      // Keep only the bounded status code; remote bodies may contain secrets or entity IDs.
    }
    return fail(remoteCode, `Public API request failed with status ${String(response.status)}.`);
  }
  try {
    return await response.json();
  } catch {
    return fail('HTTP_RESPONSE_INVALID', 'Public API response was not JSON.');
  }
}

function validateConfiguration(
  input: HomeLabReadOnlyExecutionConfiguration,
): HomeLabReadOnlyExecutionConfiguration {
  const token = input.nodeControlBearerToken.trim();
  const runtimeCognitiveToken = input.runtimeCognitiveBearerToken.trim();
  const runId = input.runId.trim();
  if (token === '' || token.length > 4096 || /[\r\n]/u.test(token))
    fail('DRIVER_CONFIGURATION_INVALID', 'Node Control bearer token is invalid.');
  if (
    runtimeCognitiveToken.length < 32 ||
    runtimeCognitiveToken.length > 4096 ||
    /\s/u.test(runtimeCognitiveToken)
  )
    fail('DRIVER_CONFIGURATION_INVALID', 'Runtime cognitive bearer token is invalid.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(runId))
    fail('DRIVER_CONFIGURATION_INVALID', 'Run ID is not a bounded stable identifier.');
  const contracts = input.contracts ?? HOME_LAB_READ_ONLY_EXECUTION_CONTRACTS;
  if (contracts.length !== 2)
    fail('DRIVER_CONFIGURATION_INVALID', 'Exactly two read-only contracts are required.');
  return Object.freeze({
    nodeControlBaseUrl: safeManagementBaseUrl(input.nodeControlBaseUrl),
    nodeControlBearerToken: token,
    runtimeManagementBaseUrl: safeManagementBaseUrl(input.runtimeManagementBaseUrl),
    runtimeCognitiveBearerToken: runtimeCognitiveToken,
    runId,
    contracts: Object.freeze([...contracts]),
  });
}

export async function homeLabReadOnlyConfigurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<HomeLabReadOnlyExecutionConfiguration> {
  return Object.freeze({
    nodeControlBaseUrl: requiredEnvironment(environment, 'SDAR_HOME_LAB_NODE_CONTROL_URL'),
    nodeControlBearerToken: await secretFromEnvironment(
      environment,
      'SDAR_HOME_LAB_NODE_CONTROL_TOKEN',
    ),
    runtimeManagementBaseUrl: requiredEnvironment(environment, 'SDAR_HOME_LAB_RUNTIME_URL'),
    runtimeCognitiveBearerToken: await secretFromEnvironment(
      environment,
      'SDAR_HOME_LAB_RUNTIME_COGNITIVE_TOKEN',
    ),
    runId: requiredEnvironment(environment, 'SDAR_HOME_LAB_RUN_ID'),
  });
}

function safeManagementBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('DRIVER_CONFIGURATION_INVALID', 'Management URL must be absolute HTTP(S).');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  )
    fail('DRIVER_CONFIGURATION_INVALID', 'Management URL contains unsupported components.');
  if (url.protocol === 'http:' && !isLoopback(url.hostname))
    fail('DRIVER_CONFIGURATION_INVALID', 'Non-loopback management URLs require HTTPS.');
  return url.origin;
}

function isLoopback(hostname: string): boolean {
  return ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(hostname.toLowerCase());
}

function assertSafeSdarJson(value: unknown): void {
  const pending: unknown[] = [value];
  let inspected = 0;
  const entityValue =
    /^(?:automation|binary_sensor|button|climate|cover|fan|input_boolean|input_number|light|lock|media_player|number|scene|script|select|sensor|switch)\.[a-z0-9_]+$/u;
  while (pending.length > 0) {
    const current = pending.pop();
    inspected += 1;
    if (inspected > 30_000)
      fail('SDAR_OUTPUT_TOO_COMPLEX', 'SDAR data exceeds the bounded inspection budget.');
    if (typeof current === 'string') {
      if (entityValue.test(current))
        fail('HOME_ASSISTANT_ENTITY_ID_FORBIDDEN', 'SDAR output contains an HA entity ID.');
      if (/https?:\/\//iu.test(current))
        fail('ENDPOINT_FORBIDDEN', 'SDAR evidence output contains an endpoint.');
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current as readonly unknown[]) pending.push(item);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, item] of Object.entries(current)) {
      const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
      if (['entityid', 'haentityid'].includes(normalized))
        fail('HOME_ASSISTANT_ENTITY_ID_FORBIDDEN', 'SDAR output contains an HA entity ID.');
      if (
        [
          'authorization',
          'accesstoken',
          'refreshtoken',
          'credentialref',
          'endpointref',
          'password',
          'secret',
        ].includes(normalized)
      )
        fail('SENSITIVE_SDAR_FIELD_FORBIDDEN', 'SDAR data contains a sensitive field.');
      pending.push(item);
    }
  }
}

function record(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return fail(code, 'Expected an object.');
  return value;
}

function recordArray(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) && value.every(isRecord) ? value : [];
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return fail(code, 'Public API response schema is invalid.');
  return parsed.data;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compare)
      .map((key) => [key, sortJson(value[key])]),
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function canonicalJson(value: unknown): string {
  return stableStringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableIdentifier(scope: string, runId: string, kind: string): string {
  return `${scope}-g07-${kind}-${sha256(`${runId}\u0000${scope}\u0000${kind}`).slice(0, 24)}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validTimestamp(value: string, code: string): string {
  if (!Number.isFinite(Date.parse(value))) return fail(code, 'Expected an RFC 3339 timestamp.');
  return value;
}

async function secretFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): Promise<string> {
  const inline = environment[name];
  const file = environment[`${name}_FILE`];
  if ((inline === undefined) === (file === undefined))
    fail('DRIVER_CONFIGURATION_INVALID', `Set exactly one of ${name} or ${name}_FILE.`);
  const source = inline ?? (file === undefined ? '' : await readFile(file, 'utf8'));
  const value = source.trim();
  if (value === '') fail('DRIVER_CONFIGURATION_INVALID', `${name} is empty.`);
  return value;
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === '')
    return fail('DRIVER_CONFIGURATION_INVALID', `${name} is required.`);
  return value;
}

function fail(code: string, message: string): never {
  throw new HomeLabReadOnlyExecutionError(code, message);
}

async function main(): Promise<void> {
  try {
    const report = await executeHomeLabReadOnlyCapabilities(
      await homeLabReadOnlyConfigurationFromEnvironment(),
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error: unknown) {
    const code =
      error instanceof HomeLabReadOnlyExecutionError
        ? error.code
        : 'HOME_LAB_READ_ONLY_EXECUTION_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
