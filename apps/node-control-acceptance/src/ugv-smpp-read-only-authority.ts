import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import {
  deriveFrozenMcpCatalogAuthority,
  frozenTaskReadinessAttributes,
  type McpProtocolDiscoverySnapshot,
  type McpServer,
  type McpTool,
  type SkillVersion,
} from '../../../packages/domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const READ_ONLY_OPERATION_NAMES = Object.freeze([
  'vehicle_get_state',
  'vehicle_get_capabilities',
  'vehicle_get_payload_status',
  'vehicle_get_targets',
  'vehicle_laser_range',
] as const);

export type UgvReadOnlyOperationName = (typeof READ_ONLY_OPERATION_NAMES)[number];

interface UgvReadOnlyOperationContract {
  readonly toolName: UgvReadOnlyOperationName;
  readonly capabilityId: string;
  readonly skillId: string;
  readonly taskTypeId: string;
  readonly evidenceType: string;
  readonly requestText: string;
}

const UGV_READ_ONLY_OPERATION_CONTRACTS: Readonly<
  Record<UgvReadOnlyOperationName, UgvReadOnlyOperationContract>
> = Object.freeze({
  vehicle_get_state: Object.freeze({
    toolName: 'vehicle_get_state',
    capabilityId: 'vehicle.ugv.read-state',
    skillId: 'ugv.get-state',
    taskTypeId: 'task-type.vehicle.read-state',
    evidenceType: 'vehicle.state.observation',
    requestText: '查询无人车当前状态',
  }),
  vehicle_get_capabilities: Object.freeze({
    toolName: 'vehicle_get_capabilities',
    capabilityId: 'vehicle.ugv.read-capabilities',
    skillId: 'ugv.get-capabilities',
    taskTypeId: 'task-type.vehicle.read-capabilities',
    evidenceType: 'vehicle.capabilities.observation',
    requestText: '查询无人车当前能力',
  }),
  vehicle_get_payload_status: Object.freeze({
    toolName: 'vehicle_get_payload_status',
    capabilityId: 'vehicle.ugv.read-payload',
    skillId: 'ugv.get-payload-status',
    taskTypeId: 'task-type.vehicle.read-payload',
    evidenceType: 'vehicle.payload.observation',
    requestText: '查询无人车当前载荷状态',
  }),
  vehicle_get_targets: Object.freeze({
    toolName: 'vehicle_get_targets',
    capabilityId: 'vehicle.ugv.read-targets',
    skillId: 'ugv.get-targets',
    taskTypeId: 'task-type.vehicle.read-targets',
    evidenceType: 'vehicle.targets.observation',
    requestText: '查询无人车当前侦察目标',
  }),
  vehicle_laser_range: Object.freeze({
    toolName: 'vehicle_laser_range',
    capabilityId: 'vehicle.ugv.laser-range',
    skillId: 'ugv.laser-range',
    taskTypeId: 'task-type.vehicle.laser-range',
    evidenceType: 'vehicle.range.observation',
    requestText: '查询无人车当前激光测距',
  }),
});

export interface UgvReadOnlyTarget extends UgvReadOnlyOperationContract {
  readonly capabilityVersion: number;
  readonly capabilityBindingId: string;
  readonly capabilityBindingVersion: number;
  readonly capabilityDefinitionHash: string;
  readonly skillVersion: number;
  readonly mcpProviderBindingId: string;
  readonly localServerId: string;
  readonly resourceId: string;
}

export interface UgvReadOnlyAuthorityConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly nodeControlRuntimeServiceToken: string;
  readonly runtimeManagementBaseUrl: string;
}

export interface UgvReadOnlyAuthoritySnapshot {
  readonly target: UgvReadOnlyTarget;
  readonly observedAt: string;
  readonly binding: CurrentBindingAuthority;
  readonly capability: Capability;
  readonly implementation: Implementation;
  readonly skill: SkillVersion;
  readonly tool: McpTool;
  readonly evidenceTypes: readonly string[];
  readonly readinessAttributes: readonly string[];
}

export interface UgvReadOnlyGovernanceAuthority {
  readonly schemaVersion: 'sdar.ugv-smpp-capability-governance/v1';
  readonly status: 'passed';
  readonly observedAt: string;
  readonly binding: Readonly<{
    bindingId: string;
    localServerId: string;
    revision: number;
    registryRevision: number;
    registryChecksum: string;
    catalogRevision: string;
    catalogChecksum: string;
    operationCount: number;
    availabilityValidUntil: string;
  }>;
  readonly resourcePolicy: Readonly<{
    identifierAuthority: 'public_smpp_tool_schema';
    resourceId: string;
    selection: 'single_schema_value' | 'explicit_configured_value';
  }>;
  readonly catalog: Readonly<{
    discoveredToolCount: number;
    governedToolCount: number;
    stagedControlToolCount: number;
    unmappedToolNames: readonly string[];
  }>;
  readonly firePolicy: Readonly<{
    toolName: 'vehicle_fire_weapon';
    discovered: boolean;
    forbidden: true;
    capabilityCreated: false;
    skillCreated: false;
  }>;
  readonly skills: readonly Readonly<{
    skillId: string;
    skillVersion: number;
    capabilityId: string;
    toolName: string;
    packageChecksum: string;
    inputSchemaSha256: string;
    outputSchemaSha256: string;
    action: 'imported' | 'reconciled';
    status: 'published';
  }>[];
  readonly capabilities: readonly Readonly<{
    capabilityId: string;
    capabilityVersion: number;
    definitionHash: string;
    implementationBindingId: string;
    skillId: string;
    skillVersion: number;
    toolName: string;
    riskLevel: 'low' | 'medium' | 'high';
    confirmation: 'not_required' | 'required';
    remoteTerminalEvidenceRequired: boolean;
    readiness: 'available';
    readinessValidUntil: string;
  }>[];
  readonly stagedControls: readonly Readonly<{
    capabilityId: string;
    skillId: string;
    toolName: string;
    packageChecksum: string;
    definitionHash: string;
    proposedImplementationBindingId: string;
    implementationPersisted: false;
    riskLevel: 'medium' | 'high';
    confirmation: 'required';
    runtimeSkillStatus: 'draft';
    governedSkillStatus: 'validated';
    capabilityStatus: 'draft';
    readiness: 'unavailable';
    lifecycle: 'staged_non_executable';
    persisted: true;
    selectable: false;
    executionAuthorized: false;
    blockingReasonCodes: readonly [
      'CONTROL_TRANSPORT_GATE_NOT_IMPLEMENTED',
      'PHYSICAL_WRITE_ACCEPTANCE_NOT_RUN',
    ];
  }>[];
  readonly redaction: Readonly<{
    secretsIncluded: false;
    endpointsIncluded: false;
    downstreamDeviceIdsIncluded: false;
    mqttTopicsIncluded: false;
  }>;
}

export class UgvReadOnlyAuthorityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UgvReadOnlyAuthorityError';
    this.code = code;
  }
}

const JsonSchema = z.union([z.boolean(), z.record(z.string(), z.unknown())]);
const ExecutionSemanticsSchema = z
  .object({
    effect: z.enum(['read_only', 'side_effecting', 'unknown']),
    execution: z.enum(['synchronous', 'task_capable', 'task_required', 'unknown']),
    cancellation: z.enum(['unsupported', 'cooperative', 'task_cancel', 'unknown']),
    idempotency: z.enum(['none', 'client_request_key', 'server_managed', 'unknown']),
    replay: z.enum(['allowed', 'simulation_only', 'forbidden', 'unknown']),
    source: z.enum(['mcp_declared', 'admin_override', 'default_unknown']),
  })
  .strict();
const TaskProfileSchema = z
  .object({
    profileVersion: z.literal('1.0'),
    taskBehavior: z.enum(['synchronous_only', 'server_directed', 'task_required']),
    availability: z.enum(['not_supported', 'dynamic']),
    supportsScheduling: z.boolean(),
    supportsMaxElapsed: z.boolean(),
    supportsObservations: z.boolean(),
    supportsInputRequired: z.boolean(),
    idempotency: z.enum(['none', 'client_request_key', 'server_managed', 'unknown']),
  })
  .strict();
const ToolSchema = z
  .object({
    serverId: z.string().min(1),
    toolName: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: z.unknown(),
    outputSchema: z.unknown().optional(),
    protocolMode: z.literal('frozen_v1'),
    executionSemantics: ExecutionSemanticsSchema,
    declaredExecutionSemantics: ExecutionSemanticsSchema.optional(),
    adminExecutionSemanticsOverride: ExecutionSemanticsSchema.optional(),
    taskExecutionProfile: TaskProfileSchema,
    discoveredAt: z.iso.datetime({ offset: true }),
  })
  .loose();
const DiscoverySchema: z.ZodType<McpProtocolDiscoverySnapshot> = z
  .object({
    snapshotId: z.string().min(1),
    serverId: z.string().min(1),
    protocolMode: z.literal('frozen_v1'),
    protocolVersion: z.string().min(1),
    baselineSha256: z.string().regex(CHECKSUM),
    supportedVersions: z.array(z.string()),
    capabilities: z.record(z.string(), z.unknown()),
    serverInfo: z.record(z.string(), z.unknown()),
    taskNotifications: z.boolean(),
    discoveredAt: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }).optional(),
    toolRevision: z.number().int().positive(),
  })
  .loose();
const ServerSchema: z.ZodType<
  McpServer & { readonly currentDiscovery: McpProtocolDiscoverySnapshot }
> = z
  .object({
    serverId: z.string().min(1),
    name: z.string().min(1),
    endpoint: z.url(),
    transport: z.literal('streamable_http'),
    status: z.enum(['enabled', 'disabled', 'unreachable']),
    toolRevision: z.number().int().positive(),
    protocolMode: z.literal('frozen_v1'),
    currentProtocolSnapshotId: z.string().min(1),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    currentDiscovery: DiscoverySchema,
  })
  .loose();

const CurrentBindingAuthoritySchema = z
  .object({
    observedAt: z.iso.datetime({ offset: true }),
    binding: z
      .object({
        bindingId: z.string().min(1),
        revision: z.number().int().positive(),
        localServerId: z.string().min(1),
        originType: z.literal('smpp_registry'),
        providerId: z.string().min(1),
        externalProviderId: z.string().min(1),
        externalServerId: z.string().min(1),
        registryRevision: z.number().int().positive(),
        registryChecksum: z.string().regex(CHECKSUM),
        catalogRevision: z.string().min(1),
        catalogChecksum: z.string().regex(CHECKSUM),
        endpointRef: z.url(),
        availabilityValidUntil: z.iso.datetime({ offset: true }),
        catalogObservedAt: z.iso.datetime({ offset: true }),
        operationCount: z.number().int().positive().max(1024),
      })
      .strict(),
    sourceCandidateLineage: z
      .object({
        smppSourceId: z.string().min(1),
        externalProviderId: z.string().min(1),
        externalServerId: z.string().min(1),
        registryRevision: z.number().int().positive(),
        registryChecksum: z.string().regex(CHECKSUM),
        nativeRevision: z.number().int().positive(),
        nativeChecksum: z.string().regex(CHECKSUM),
        projectionContract: z.literal('sdar-registry-v1'),
        candidateEndpoint: z.url(),
      })
      .strict(),
  })
  .strict();
type CurrentBindingAuthority = z.infer<typeof CurrentBindingAuthoritySchema>;

const CapabilitySchema = z
  .object({
    capabilityId: z.string().min(1),
    version: z.number().int().positive(),
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: JsonSchema,
    outputSchema: JsonSchema,
    successCriteria: z.array(z.record(z.string(), z.unknown())),
    requiredEvidence: z.array(z.record(z.string(), z.unknown())),
    effects: z.array(z.unknown()),
    artifacts: z.array(z.unknown()),
    constraints: z.array(z.record(z.string(), z.unknown())),
    supportedModes: z.array(z.string()),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    status: z.literal('published'),
    definitionHash: z.string().regex(CHECKSUM),
  })
  .loose();
type Capability = z.infer<typeof CapabilitySchema>;

const ImplementationSchema = z
  .object({
    bindingId: z.string().min(1),
    revision: z.number().int().positive(),
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    implementationType: z.literal('skill'),
    implementationId: z.string().min(1),
    implementationVersion: z.string().min(1),
    role: z.literal('primary'),
    priority: z.number().int().nonnegative(),
    providerPolicyOverride: z.record(z.string(), z.unknown()),
    status: z.literal('active'),
  })
  .loose();
type Implementation = z.infer<typeof ImplementationSchema>;

const RuntimeSkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.number().int().positive(),
    name: z.string().min(1),
    description: z.string(),
    capabilities: z.array(z.string()),
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    toolPolicy: z.object({
      required: z.array(z.object({ serverId: z.string(), toolName: z.string() })),
      optional: z.array(z.object({ serverId: z.string(), toolName: z.string() })),
      forbidden: z.array(z.object({ serverId: z.string(), toolName: z.string() })),
    }),
    runtimePolicy: z
      .object({
        maxDurationSeconds: z.number().positive(),
        maxLlmCalls: z.number().int().nonnegative(),
        maxMcpCalls: z.number().int().nonnegative(),
        maxReplans: z.number().int().nonnegative(),
        maxCost: z.number().nonnegative().optional(),
        pauseReplanThresholdSeconds: z.number().nonnegative().optional(),
        cancelStrategy: z.enum(['wait_current', 'try_interrupt', 'cleanup_workflow']).optional(),
        compensationGuidance: z.string().optional(),
        autoConfirmPlan: z.boolean(),
      })
      .strict(),
    usageSpecification: z.unknown().optional(),
    outcomeSpecification: z.unknown().optional(),
    status: z.literal('enabled'),
    validationPassed: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .loose();
const ReadinessSchema = z
  .object({
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    status: z.literal('available'),
    validUntil: z.iso.datetime({ offset: true }),
    availableImplementations: z.array(z.string()),
    unavailableImplementations: z.array(z.string()),
    reasons: z.array(z.unknown()).optional(),
  })
  .loose();

const GovernanceSchema: z.ZodType<UgvReadOnlyGovernanceAuthority> = z
  .object({
    schemaVersion: z.literal('sdar.ugv-smpp-capability-governance/v1'),
    status: z.literal('passed'),
    observedAt: z.iso.datetime({ offset: true }),
    binding: z.object({
      bindingId: z.string().min(1),
      localServerId: z.string().min(1),
      revision: z.number().int().positive(),
      registryRevision: z.number().int().positive(),
      registryChecksum: z.string().regex(CHECKSUM),
      catalogRevision: z.string().min(1),
      catalogChecksum: z.string().regex(CHECKSUM),
      operationCount: z.number().int().positive(),
      availabilityValidUntil: z.iso.datetime({ offset: true }),
    }),
    resourcePolicy: z.object({
      identifierAuthority: z.literal('public_smpp_tool_schema'),
      resourceId: z.string().min(1),
      selection: z.enum(['single_schema_value', 'explicit_configured_value']),
    }),
    catalog: z.object({
      discoveredToolCount: z.number().int().positive(),
      governedToolCount: z.number().int().positive(),
      stagedControlToolCount: z.number().int().nonnegative(),
      unmappedToolNames: z.array(z.string()),
    }),
    firePolicy: z.object({
      toolName: z.literal('vehicle_fire_weapon'),
      discovered: z.boolean(),
      forbidden: z.literal(true),
      capabilityCreated: z.literal(false),
      skillCreated: z.literal(false),
    }),
    skills: z.array(
      z.object({
        skillId: z.string().min(1),
        skillVersion: z.number().int().positive(),
        capabilityId: z.string().min(1),
        toolName: z.string().min(1),
        packageChecksum: z.string().regex(CHECKSUM),
        inputSchemaSha256: z.string().regex(CHECKSUM),
        outputSchemaSha256: z.string().regex(CHECKSUM),
        action: z.enum(['imported', 'reconciled']),
        status: z.literal('published'),
      }),
    ),
    capabilities: z.array(
      z.object({
        capabilityId: z.string().min(1),
        capabilityVersion: z.number().int().positive(),
        definitionHash: z.string().regex(CHECKSUM),
        implementationBindingId: z.string().min(1),
        skillId: z.string().min(1),
        skillVersion: z.number().int().positive(),
        toolName: z.string().min(1),
        riskLevel: z.enum(['low', 'medium', 'high']),
        confirmation: z.enum(['not_required', 'required']),
        remoteTerminalEvidenceRequired: z.boolean(),
        readiness: z.literal('available'),
        readinessValidUntil: z.iso.datetime({ offset: true }),
      }),
    ),
    stagedControls: z.array(
      z.object({
        capabilityId: z.string().min(1),
        skillId: z.string().min(1),
        toolName: z.string().min(1),
        packageChecksum: z.string().regex(CHECKSUM),
        definitionHash: z.string().regex(CHECKSUM),
        proposedImplementationBindingId: z.string().min(1),
        implementationPersisted: z.literal(false),
        riskLevel: z.enum(['medium', 'high']),
        confirmation: z.literal('required'),
        runtimeSkillStatus: z.literal('draft'),
        governedSkillStatus: z.literal('validated'),
        capabilityStatus: z.literal('draft'),
        readiness: z.literal('unavailable'),
        lifecycle: z.literal('staged_non_executable'),
        persisted: z.literal(true),
        selectable: z.literal(false),
        executionAuthorized: z.literal(false),
        blockingReasonCodes: z.tuple([
          z.literal('CONTROL_TRANSPORT_GATE_NOT_IMPLEMENTED'),
          z.literal('PHYSICAL_WRITE_ACCEPTANCE_NOT_RUN'),
        ]),
      }),
    ),
    redaction: z.object({
      secretsIncluded: z.literal(false),
      endpointsIncluded: z.literal(false),
      downstreamDeviceIdsIncluded: z.literal(false),
      mqttTopicsIncluded: z.literal(false),
    }),
  })
  .strict();

export async function loadUgvReadOnlyGovernanceAuthority(
  file: string,
): Promise<UgvReadOnlyGovernanceAuthority> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(file), 'utf8')) as unknown;
  } catch {
    return fail(
      'UGV_GOVERNANCE_REPORT_UNAVAILABLE',
      'The exact S5 governance authority report is unavailable or invalid JSON.',
    );
  }
  const parsed = parse(GovernanceSchema, value, 'UGV_GOVERNANCE_REPORT_INVALID');
  assertSafeRedactedJson(parsed);
  return Object.freeze(parsed);
}

export function deriveUgvReadOnlyTargets(
  governance: UgvReadOnlyGovernanceAuthority,
): readonly UgvReadOnlyTarget[] {
  const targets: UgvReadOnlyTarget[] = [];
  for (const toolName of READ_ONLY_OPERATION_NAMES) {
    const capabilityMatches = governance.capabilities.filter((item) => item.toolName === toolName);
    const skillMatches = governance.skills.filter((item) => item.toolName === toolName);
    if (capabilityMatches.length === 0 && skillMatches.length === 0) continue;
    const capability = capabilityMatches[0];
    const skill = skillMatches[0];
    const contract = UGV_READ_ONLY_OPERATION_CONTRACTS[toolName];
    if (
      capabilityMatches.length !== 1 ||
      skillMatches.length !== 1 ||
      capability === undefined ||
      skill === undefined ||
      capability.capabilityId !== contract.capabilityId ||
      capability.skillId !== contract.skillId ||
      skill.capabilityId !== contract.capabilityId ||
      skill.skillId !== contract.skillId ||
      skill.skillVersion !== capability.skillVersion ||
      capability.riskLevel !== 'low' ||
      capability.confirmation !== 'not_required' ||
      capability.remoteTerminalEvidenceRequired
    )
      fail(
        'UGV_READ_ONLY_GOVERNANCE_NOT_EXACT',
        'S5 governance does not contain one exact closed read-only Capability and Skill.',
      );
    const exactCapability: UgvReadOnlyGovernanceAuthority['capabilities'][number] = capability;
    targets.push(
      Object.freeze({
        ...contract,
        capabilityVersion: exactCapability.capabilityVersion,
        capabilityBindingId: exactCapability.implementationBindingId,
        capabilityBindingVersion: 1,
        capabilityDefinitionHash: exactCapability.definitionHash,
        skillVersion: exactCapability.skillVersion,
        mcpProviderBindingId: governance.binding.bindingId,
        localServerId: governance.binding.localServerId,
        resourceId: governance.resourcePolicy.resourceId,
      }),
    );
  }
  if (!targets.some((target) => target.toolName === 'vehicle_get_state'))
    fail(
      'UGV_READ_STATE_GOVERNANCE_REQUIRED',
      'The mandatory vehicle_get_state Capability is not governed.',
    );
  if (
    governance.skills.some(
      (skill) =>
        skill.toolName.startsWith('vehicle_get_') || skill.toolName === 'vehicle_laser_range',
    ) &&
    targets.length !==
      governance.skills.filter(
        (skill) =>
          skill.toolName.startsWith('vehicle_get_') || skill.toolName === 'vehicle_laser_range',
      ).length
  )
    fail(
      'UGV_READ_ONLY_EXECUTION_SET_INCOMPLETE',
      'Every governed operation in the required live read set must be qualified.',
    );
  return Object.freeze(targets);
}

export async function loadUgvReadOnlyAuthority(
  configuration: UgvReadOnlyAuthorityConfiguration,
  governance: UgvReadOnlyGovernanceAuthority,
  target: UgvReadOnlyTarget,
  observedAt: string,
  request: typeof fetch = fetch,
): Promise<UgvReadOnlyAuthoritySnapshot> {
  const config = validateAuthorityConfiguration(configuration);
  const capabilityPath = `/api/v1/node-capabilities/${encodeURIComponent(target.capabilityId)}/versions/${String(target.capabilityVersion)}`;
  const query = new URLSearchParams({
    bindingId: target.mcpProviderBindingId,
    localServerId: target.localServerId,
  });
  const [
    currentValue,
    capabilityValue,
    implementationsValue,
    readinessValue,
    skillValue,
    serversValue,
    toolsValue,
  ] = await Promise.all([
    requestJson(
      `${config.nodeControlBaseUrl}/internal/v1/mcp-provider-bindings/current?${query.toString()}`,
      bearer(config.nodeControlRuntimeServiceToken),
      request,
    ),
    requestJson(
      `${config.nodeControlBaseUrl}${capabilityPath}`,
      bearer(config.nodeControlBearerToken),
      request,
    ),
    requestJson(
      `${config.nodeControlBaseUrl}${capabilityPath}/implementations?pageSize=100`,
      bearer(config.nodeControlBearerToken),
      request,
    ),
    requestJson(
      `${config.nodeControlBaseUrl}/api/v1/capability-readiness/${encodeURIComponent(target.capabilityId)}/${String(target.capabilityVersion)}`,
      bearer(config.nodeControlBearerToken),
      request,
    ),
    requestJson(
      `${config.runtimeManagementBaseUrl}/api/v1/skills/${encodeURIComponent(target.skillId)}/versions/${String(target.skillVersion)}`,
      { redirect: 'manual' },
      request,
    ),
    requestJson(
      `${config.runtimeManagementBaseUrl}/api/v1/mcp/servers`,
      { redirect: 'manual' },
      request,
    ),
    requestJson(
      `${config.runtimeManagementBaseUrl}/api/v1/mcp/servers/${encodeURIComponent(target.localServerId)}/tools`,
      { redirect: 'manual' },
      request,
    ),
  ]);
  const binding = parse(CurrentBindingAuthoritySchema, currentValue, 'UGV_CURRENT_BINDING_INVALID');
  const effectiveObservedAt =
    Date.parse(binding.observedAt) > Date.parse(observedAt) ? binding.observedAt : observedAt;
  const capability = parse(CapabilitySchema, capabilityValue, 'UGV_CAPABILITY_AUTHORITY_INVALID');
  const implementations = parse(
    z.object({ items: z.array(ImplementationSchema) }).loose(),
    implementationsValue,
    'UGV_CAPABILITY_IMPLEMENTATION_INVALID',
  ).items;
  const readiness = parse(ReadinessSchema, readinessValue, 'UGV_CAPABILITY_READINESS_INVALID');
  // The boundary schema validates every field consumed below. The domain type is applied only
  // after parsing so Zod's exact-optional output representation cannot leak into the runtime API.
  const skill = parse(
    RuntimeSkillSchema,
    skillValue,
    'UGV_RUNTIME_SKILL_INVALID',
  ) as unknown as SkillVersion;
  const servers = parse(
    z.object({ items: z.array(ServerSchema) }).loose(),
    serversValue,
    'UGV_RUNTIME_SERVER_CATALOG_INVALID',
  ).items;
  const tools = parse(
    z.object({ items: z.array(ToolSchema) }).loose(),
    toolsValue,
    'UGV_RUNTIME_TOOL_CATALOG_INVALID',
  ).items as readonly McpTool[];
  const serverMatches = servers.filter((server) => server.serverId === target.localServerId);
  const server = serverMatches[0];
  const implementationMatches = implementations.filter(
    (item) => item.bindingId === target.capabilityBindingId,
  );
  const implementation = implementationMatches[0];
  const toolMatches = tools.filter((tool) => tool.toolName === target.toolName);
  const tool = toolMatches[0];
  if (serverMatches.length !== 1 || server === undefined)
    fail('UGV_RUNTIME_SERVER_IDENTITY_NOT_EXACT', 'The exact Runtime MCP Server is unavailable.');
  if (implementationMatches.length !== 1 || implementation === undefined)
    fail(
      'UGV_CAPABILITY_IMPLEMENTATION_NOT_EXACT',
      'The exact Capability implementation is unavailable or ambiguous.',
    );
  if (toolMatches.length !== 1 || tool === undefined)
    fail('UGV_READ_ONLY_TOOL_NOT_EXACT', 'The exact read-only Tool is unavailable or ambiguous.');

  assertBinding(binding, governance, target, effectiveObservedAt);
  assertRuntimeCatalog(binding, server, tools, tool, target, effectiveObservedAt);
  const evidenceTypes = assertCapability(capability, implementation, target, binding, tool);
  const readinessAttributes = assertSkill(skill, target, binding, tool, evidenceTypes);
  if (
    readiness.capabilityId !== target.capabilityId ||
    readiness.capabilityVersion !== target.capabilityVersion ||
    readiness.availableImplementations.length !== 1 ||
    readiness.availableImplementations[0] !== target.capabilityBindingId ||
    readiness.unavailableImplementations.length !== 0 ||
    Date.parse(readiness.validUntil) <= Date.parse(effectiveObservedAt)
  )
    fail(
      'UGV_CAPABILITY_READINESS_NOT_CURRENT',
      'Capability readiness is stale, partial, or does not select the exact implementation.',
    );
  return Object.freeze({
    target,
    observedAt: effectiveObservedAt,
    binding,
    capability,
    implementation,
    skill,
    tool,
    evidenceTypes,
    readinessAttributes,
  });
}

function assertBinding(
  authority: CurrentBindingAuthority,
  governance: UgvReadOnlyGovernanceAuthority,
  target: UgvReadOnlyTarget,
  observedAt: string,
): void {
  const { binding, sourceCandidateLineage: lineage } = authority;
  if (
    binding.bindingId !== target.mcpProviderBindingId ||
    binding.bindingId !== governance.binding.bindingId ||
    binding.localServerId !== target.localServerId ||
    binding.localServerId !== governance.binding.localServerId ||
    binding.revision !== governance.binding.revision ||
    binding.registryRevision !== governance.binding.registryRevision ||
    binding.registryChecksum !== governance.binding.registryChecksum ||
    binding.catalogRevision !== governance.binding.catalogRevision ||
    binding.catalogChecksum !== governance.binding.catalogChecksum ||
    binding.operationCount !== governance.binding.operationCount ||
    binding.providerId !== binding.externalProviderId ||
    lineage.externalProviderId !== binding.externalProviderId ||
    lineage.externalServerId !== binding.externalServerId ||
    lineage.registryRevision !== binding.registryRevision ||
    lineage.registryChecksum !== binding.registryChecksum ||
    lineage.candidateEndpoint !== binding.endpointRef ||
    Date.parse(binding.catalogObservedAt) > Date.parse(observedAt) ||
    Date.parse(binding.availabilityValidUntil) <= Date.parse(observedAt)
  )
    fail(
      'UGV_PROVIDER_BINDING_AUTHORITY_NOT_CURRENT',
      'The current Binding, SMPP/native lineage, or governed Catalog identity differs.',
    );
}

function assertRuntimeCatalog(
  authority: CurrentBindingAuthority,
  server: McpServer & { readonly currentDiscovery: McpProtocolDiscoverySnapshot },
  tools: readonly McpTool[],
  tool: McpTool,
  target: UgvReadOnlyTarget,
  observedAt: string,
): void {
  const { binding } = authority;
  if (
    server.status !== 'enabled' ||
    server.endpoint !== binding.endpointRef ||
    server.protocolMode !== 'frozen_v1' ||
    server.currentProtocolSnapshotId !== server.currentDiscovery.snapshotId ||
    server.currentDiscovery.serverId !== server.serverId ||
    server.currentDiscovery.toolRevision !== server.toolRevision ||
    server.currentDiscovery.validUntil === undefined ||
    Date.parse(server.currentDiscovery.validUntil) <= Date.parse(observedAt) ||
    tool.serverId !== target.localServerId ||
    tool.protocolMode !== 'frozen_v1' ||
    tool.taskExecutionProfile?.taskBehavior !== 'synchronous_only' ||
    tool.outputSchema === undefined
  )
    fail(
      'UGV_RUNTIME_READ_ONLY_TOOL_NOT_READY',
      'Runtime Server, frozen protocol snapshot, or synchronous Tool is not current.',
    );
  const catalog = deriveFrozenMcpCatalogAuthority(
    server.currentDiscovery,
    tools,
    server.toolRevision,
  );
  if (
    catalog.catalogRevision !== binding.catalogRevision ||
    catalog.catalogChecksum !== binding.catalogChecksum ||
    catalog.operationCount !== binding.operationCount
  )
    fail(
      'UGV_RUNTIME_CATALOG_AUTHORITY_MISMATCH',
      'Runtime frozen Catalog differs from the current Provider Binding authority.',
    );
  const source =
    tool.executionSemantics.source === 'mcp_declared'
      ? tool.declaredExecutionSemantics
      : tool.executionSemantics.source === 'admin_override'
        ? tool.adminExecutionSemanticsOverride
        : undefined;
  if (
    tool.executionSemantics.effect !== 'read_only' ||
    tool.executionSemantics.execution !== 'synchronous' ||
    Object.values(tool.executionSemantics).includes('unknown') ||
    source === undefined ||
    canonical(source) !== canonical(tool.executionSemantics)
  )
    fail(
      'UGV_TOOL_SEMANTICS_NOT_EXPLICIT_READ_ONLY',
      'Side-effecting, unknown, or inferred Tool semantics are fail-closed.',
    );
}

function assertCapability(
  capability: Capability,
  implementation: Implementation,
  target: UgvReadOnlyTarget,
  authority: CurrentBindingAuthority,
  tool: McpTool,
): readonly string[] {
  if (
    capability.capabilityId !== target.capabilityId ||
    capability.version !== target.capabilityVersion ||
    capability.definitionHash !== target.capabilityDefinitionHash ||
    capability.riskLevel !== 'low' ||
    !capability.supportedModes.includes('deterministic') ||
    canonical(capability.inputSchema) !== canonical(tool.inputSchema) ||
    canonical(capability.outputSchema) !== canonical(tool.outputSchema) ||
    implementation.bindingId !== target.capabilityBindingId ||
    implementation.revision !== target.capabilityBindingVersion ||
    implementation.capabilityId !== target.capabilityId ||
    implementation.capabilityVersion !== target.capabilityVersion ||
    implementation.implementationId !== target.skillId ||
    implementation.implementationVersion !== String(target.skillVersion)
  )
    fail(
      'UGV_CAPABILITY_AUTHORITY_NOT_EXACT',
      'Capability, implementation, Skill, and live schema authority differ.',
    );
  const resource = exactlyOne(capability.constraints, 'resource_policy');
  const provider = exactlyOne(capability.constraints, 'provider_binding_policy');
  const exactSkill = exactlyOne(capability.constraints, 'exact_skill_version');
  const confirmation = exactlyOne(capability.constraints, 'confirmation_policy');
  const sideEffect = exactlyOne(capability.constraints, 'side_effect_policy');
  if (
    resource['selection'] !== 'exact_value' ||
    !strings(resource['allowedResourceIds']).includes(target.resourceId) ||
    provider['mcpProviderBindingId'] !== target.mcpProviderBindingId ||
    provider['localServerId'] !== target.localServerId ||
    provider['mcpToolName'] !== target.toolName ||
    provider['bindingRevision'] !== authority.binding.revision ||
    provider['catalogRevision'] !== authority.binding.catalogRevision ||
    provider['catalogChecksum'] !== authority.binding.catalogChecksum ||
    provider['taskBehavior'] !== 'synchronous_only' ||
    canonical(provider['executionSemantics']) !== canonical(tool.executionSemantics) ||
    provider['requiredStatus'] !== 'active' ||
    provider['requiredAvailabilityStatus'] !== 'available' ||
    provider['requiredFreshness'] !== 'unexpired' ||
    provider['fallback'] !== 'deny' ||
    exactSkill['skillId'] !== target.skillId ||
    exactSkill['skillVersion'] !== target.skillVersion ||
    exactSkill['taskType'] !== target.toolName ||
    confirmation['required'] !== false ||
    confirmation['autoConfirmPlan'] !== false ||
    sideEffect['sideEffecting'] !== false
  )
    fail(
      'UGV_CAPABILITY_READ_ONLY_POLICY_INVALID',
      'Capability constraints do not preserve exact resource/Binding/read-only guards.',
    );
  validateSchema(capability.inputSchema, { resourceId: target.resourceId }, 'UGV_CAPABILITY_INPUT');
  const evidenceTypes = capability.requiredEvidence.map((item) => {
    const evidenceType = item['evidenceType'];
    if (
      item['type'] !== 'required_evidence' ||
      typeof evidenceType !== 'string' ||
      evidenceType.trim() === '' ||
      item['required'] !== true ||
      item['hardGate'] !== true
    )
      fail(
        'UGV_CAPABILITY_EVIDENCE_POLICY_INVALID',
        'Every Capability evidence item must be a required hard gate.',
      );
    return evidenceType;
  });
  if (
    evidenceTypes.length === 0 ||
    !evidenceTypes.includes(target.evidenceType) ||
    new Set(evidenceTypes).size !== evidenceTypes.length
  )
    fail(
      'UGV_CAPABILITY_EVIDENCE_POLICY_INVALID',
      'The exact normalized observation evidence is not required.',
    );
  return Object.freeze(evidenceTypes);
}

function assertSkill(
  skill: SkillVersion,
  target: UgvReadOnlyTarget,
  authority: CurrentBindingAuthority,
  tool: McpTool,
  evidenceTypes: readonly string[],
): readonly string[] {
  const requiredTool = skill.toolPolicy.required[0];
  const usage = skill.usageSpecification;
  const outcome = skill.outcomeSpecification;
  const taskBinding = usage?.taskBindings[0];
  const sideEffects = object(outcome?.sideEffectPolicy);
  if (
    skill.skillId !== target.skillId ||
    skill.version !== target.skillVersion ||
    !skill.validationPassed ||
    skill.capabilities.length !== 1 ||
    skill.capabilities[0] !== target.capabilityId ||
    canonical(skill.inputSchema) !== canonical(tool.inputSchema) ||
    canonical(skill.outputSchema) !== canonical(tool.outputSchema) ||
    skill.toolPolicy.required.length !== 1 ||
    requiredTool?.serverId !== target.localServerId ||
    requiredTool.toolName !== target.toolName ||
    skill.toolPolicy.optional.length !== 0 ||
    skill.runtimePolicy.autoConfirmPlan ||
    skill.runtimePolicy.maxLlmCalls !== 0 ||
    skill.runtimePolicy.maxMcpCalls !== 1 ||
    skill.runtimePolicy.maxReplans !== 0 ||
    usage?.modes.supported.length !== 1 ||
    usage.modes.supported[0] !== 'procedure' ||
    usage.modes.defaultMode !== 'procedure' ||
    usage.taskBindings.length !== 1 ||
    taskBinding?.taskType !== target.toolName ||
    taskBinding.providerPolicy.selection !== 'required' ||
    taskBinding.providerPolicy.requiredProviderId !== target.localServerId ||
    outcome === undefined ||
    sideEffects?.['sideEffecting'] !== false ||
    sideEffects['confirmation'] !== 'not_required' ||
    !sameStringSet(outcome.evidence, evidenceTypes) ||
    !usage.evidencePolicy.rejectSuccessWithoutRequiredEvidence ||
    !sameStringSet(
      usage.evidencePolicy.requirements.map((item) => item.evidenceType),
      evidenceTypes,
    )
  )
    fail(
      'UGV_SKILL_READ_ONLY_POLICY_INVALID',
      'The exact enabled Skill does not preserve the closed read-only procedure contract.',
    );
  const readinessAttributes = Object.freeze([
    ...new Set([
      ...frozenTaskReadinessAttributes(requiredTaskExecutionProfile(tool), false),
      'effect:read_only',
      'execution:synchronous',
      `catalog_checksum:${authority.binding.catalogChecksum}`,
    ]),
  ]);
  if (
    !taskBinding.providerPolicy.requiredAttributes.every((attribute) =>
      readinessAttributes.includes(attribute),
    ) ||
    ![
      'task_behavior:synchronous_only',
      'effect:read_only',
      'execution:synchronous',
      `catalog_checksum:${authority.binding.catalogChecksum}`,
    ].every((attribute) => taskBinding.providerPolicy.requiredAttributes.includes(attribute))
  )
    fail(
      'UGV_SKILL_READINESS_POLICY_INVALID',
      'Skill readiness attributes are not fully proved by current Runtime authority.',
    );
  validateSchema(skill.inputSchema, { resourceId: target.resourceId }, 'UGV_SKILL_INPUT');
  return readinessAttributes;
}

function requiredTaskExecutionProfile(tool: McpTool): NonNullable<McpTool['taskExecutionProfile']> {
  const profile = tool.taskExecutionProfile;
  if (profile === undefined)
    return fail(
      'UGV_RUNTIME_READ_ONLY_TOOL_NOT_READY',
      'Read-only Tool lacks its current frozen Task execution profile.',
    );
  return profile;
}

export function validateUgvReadOnlyAuthorityConfiguration(
  input: UgvReadOnlyAuthorityConfiguration,
): UgvReadOnlyAuthorityConfiguration {
  return validateAuthorityConfiguration(input);
}

function validateAuthorityConfiguration(
  input: UgvReadOnlyAuthorityConfiguration,
): UgvReadOnlyAuthorityConfiguration {
  const nodeControlBaseUrl = safeManagementBaseUrl(input.nodeControlBaseUrl);
  const runtimeManagementBaseUrl = safeManagementBaseUrl(input.runtimeManagementBaseUrl);
  if (
    input.nodeControlBearerToken.trim() === '' ||
    input.nodeControlRuntimeServiceToken.trim() === ''
  )
    fail('UGV_READ_ONLY_CONFIGURATION_INVALID', 'Both Node Control bearer roles are required.');
  return Object.freeze({ ...input, nodeControlBaseUrl, runtimeManagementBaseUrl });
}

export function safeManagementBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('UGV_READ_ONLY_CONFIGURATION_INVALID', 'Management URL must be absolute.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    (url.protocol === 'http:' && !isLoopback(url.hostname))
  )
    fail(
      'UGV_READ_ONLY_CONFIGURATION_INVALID',
      'Management URL must be credential-free HTTP(S); plaintext is loopback-only.',
    );
  return url.origin;
}

export async function requestJson(
  url: string,
  init: RequestInit,
  request: typeof fetch = fetch,
  expectedStatus = 200,
): Promise<unknown> {
  const response = await request(url, init);
  if (response.status !== expectedStatus) {
    let code = 'UGV_READ_ONLY_HTTP_REJECTED';
    try {
      code = z
        .object({ code: z.string().min(1) })
        .loose()
        .parse(await response.json()).code;
    } catch {
      // External bodies can contain endpoints or secrets and are deliberately not echoed.
    }
    return fail(code, `Authority request was rejected with status ${String(response.status)}.`);
  }
  try {
    return await response.json();
  } catch {
    return fail('UGV_READ_ONLY_HTTP_RESPONSE_INVALID', 'Authority response was not JSON.');
  }
}

export function bearer(token: string): RequestInit {
  return Object.freeze({ headers: { authorization: `Bearer ${token}` }, redirect: 'manual' });
}

export async function writeRedactedUgvReport(file: string, report: unknown): Promise<void> {
  assertSafeRedactedJson(report);
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, target);
}

export function assertSafeRedactedJson(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (
    /https?:\/\//iu.test(serialized) ||
    /(?:(?:authorization|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|credential)["']?\s*:)/iu.test(
      serialized,
    ) ||
    /(?:bearer\s+|postgres(?:ql)?:\/\/|redis:\/\/)/iu.test(serialized)
  )
    fail('UGV_REPORT_REDACTION_FAILED', 'Redacted evidence contains forbidden sensitive material.');
}

export function stableIdentifier(scope: string, runId: string, identity: string): string {
  return `${scope}-${createHash('sha256').update(`${runId}\u0000${identity}`).digest('hex').slice(0, 32)}`;
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const item = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(item)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(',')}}`;
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function object(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

export function objects(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value) || value.some((item) => object(item) === undefined)) return [];
  return value as readonly Readonly<Record<string, unknown>>[];
}

export function strings(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

export function validTimestamp(value: string, code = 'UGV_READ_ONLY_CLOCK_INVALID'): string {
  if (!Number.isFinite(Date.parse(value))) return fail(code, 'Expected an RFC 3339 timestamp.');
  return value;
}

function exactlyOne(
  values: readonly Readonly<Record<string, unknown>>[],
  type: string,
): Readonly<Record<string, unknown>> {
  const matches = values.filter((item) => item['type'] === type);
  const match = matches[0];
  if (matches.length !== 1 || match === undefined)
    return fail(
      'UGV_CAPABILITY_CONSTRAINT_NOT_EXACT',
      `Capability requires exactly one ${type} constraint.`,
    );
  return match;
}

function validateSchema(schema: unknown, value: unknown, scope: string): void {
  const result = new AjvJsonSchemaValidator({ strict: false }).validate(schema, value);
  if (!result.valid)
    fail(`${scope}_SCHEMA_VALIDATION_FAILED`, 'Value failed the authoritative JSON Schema.');
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return fail(code, 'Authority response failed its boundary schema.');
  return parsed.data;
}

function isLoopback(hostname: string): boolean {
  return ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(hostname.toLowerCase());
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: string, message: string): never {
  throw new UgvReadOnlyAuthorityError(code, message);
}
