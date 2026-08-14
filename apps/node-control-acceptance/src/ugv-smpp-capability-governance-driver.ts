import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  createNodeCapabilityDefinition,
  hashConfigurationRequest,
  nodeCapabilityEtag,
  type CapabilityImplementationBinding,
  type JsonObject,
  type JsonValue,
  type NodeCapabilityDefinitionVersion,
} from '../../../packages/node-control-domain/src/index.js';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const INITIAL_GOVERNANCE_VERSION = 1;
const CREATED_AT = '2026-08-12T00:00:00.000Z';
const UGV_BINDING_ID = 'mcp-binding-ugv-smpp';
const FIRE_TOOL_NAME = 'vehicle_fire_weapon';
const FIRE_CAPABILITY_ID = 'vehicle.ugv.fire-weapon';
const FIRE_SKILL_ID = 'ugv.fire-weapon';
const NAVIGATE_TOOL_NAME = 'vehicle_navigate';
const NAVIGATE_EXACT_DISPATCH_COUNT = 5;
const NAVIGATE_EXACT_DIRECTION = 'forward';
const NAVIGATE_EXACT_DISTANCE_PER_DISPATCH_METERS = 2;
const NAVIGATE_EXACT_TOTAL_DISTANCE_METERS = 10;
const NAVIGATE_ARGUMENT_CONSTRAINT_ID = 'vehicle-navigate-distance-per-dispatch';

type GovernanceKind = 'read_only' | 'long_running_control' | 'emergency_stop';

const GOVERNANCE_SPECS = Object.freeze([
  Object.freeze({
    toolName: 'vehicle_get_state',
    capabilityId: 'vehicle.ugv.read-state',
    skillId: 'ugv.get-state',
    name: 'Read UGV state',
    summary: 'Read the normalized public state of one exact UGV resource.',
    kind: 'read_only' as const,
    evidence: Object.freeze(['vehicle.state.observation']),
  }),
  Object.freeze({
    toolName: 'vehicle_get_capabilities',
    capabilityId: 'vehicle.ugv.read-capabilities',
    skillId: 'ugv.get-capabilities',
    name: 'Read UGV capabilities',
    summary: 'Read device-reported capability facts for one exact UGV resource.',
    kind: 'read_only' as const,
    evidence: Object.freeze(['vehicle.capabilities.observation']),
  }),
  Object.freeze({
    toolName: 'vehicle_get_payload_status',
    capabilityId: 'vehicle.ugv.read-payload',
    skillId: 'ugv.get-payload-status',
    name: 'Read UGV payload status',
    summary: 'Read normalized payload status for one exact UGV resource.',
    kind: 'read_only' as const,
    evidence: Object.freeze(['vehicle.payload.observation']),
  }),
  Object.freeze({
    toolName: 'vehicle_get_targets',
    capabilityId: 'vehicle.ugv.read-targets',
    skillId: 'ugv.get-targets',
    name: 'Read UGV targets',
    summary: 'Read normalized locally observed targets for one exact UGV resource.',
    kind: 'read_only' as const,
    evidence: Object.freeze(['vehicle.targets.observation']),
  }),
  Object.freeze({
    toolName: 'vehicle_laser_range',
    capabilityId: 'vehicle.ugv.laser-range',
    skillId: 'ugv.laser-range',
    name: 'Read UGV laser range',
    summary: 'Read one normalized laser range observation for one exact UGV resource.',
    kind: 'read_only' as const,
    evidence: Object.freeze(['vehicle.range.observation']),
  }),
  Object.freeze({
    toolName: 'vehicle_navigate',
    capabilityId: 'vehicle.ugv.navigate',
    skillId: 'ugv.navigate',
    name: 'Navigate UGV',
    summary: 'Run one plan-confirmed UGV navigation task and observe its remote terminal state.',
    kind: 'long_running_control' as const,
    evidence: Object.freeze([
      'vehicle.command.acceptance',
      'vehicle.remote-task.identity',
      'vehicle.task.progress',
      'vehicle.task.terminal',
    ]),
  }),
  Object.freeze({
    toolName: 'vehicle_area_recon',
    capabilityId: 'vehicle.ugv.recon',
    skillId: 'ugv.area-recon',
    name: 'Run UGV area reconnaissance',
    summary:
      'Run one plan-confirmed UGV reconnaissance task and observe its remote terminal state.',
    kind: 'long_running_control' as const,
    evidence: Object.freeze([
      'vehicle.command.acceptance',
      'vehicle.remote-task.identity',
      'vehicle.task.progress',
      'vehicle.task.terminal',
    ]),
  }),
  Object.freeze({
    toolName: 'vehicle_track_target',
    capabilityId: 'vehicle.ugv.track-target',
    skillId: 'ugv.track-target',
    name: 'Track a UGV target',
    summary: 'Run one plan-confirmed target tracking task and observe its remote terminal state.',
    kind: 'long_running_control' as const,
    evidence: Object.freeze([
      'vehicle.command.acceptance',
      'vehicle.remote-task.identity',
      'vehicle.task.progress',
      'vehicle.task.terminal',
    ]),
  }),
  Object.freeze({
    toolName: 'vehicle_control_gimbal',
    capabilityId: 'vehicle.ugv.control-gimbal',
    skillId: 'ugv.control-gimbal',
    name: 'Control UGV gimbal',
    summary: 'Run one plan-confirmed gimbal task and observe its remote terminal state.',
    kind: 'long_running_control' as const,
    evidence: Object.freeze([
      'vehicle.command.acceptance',
      'vehicle.remote-task.identity',
      'vehicle.task.progress',
      'vehicle.task.terminal',
    ]),
  }),
  Object.freeze({
    toolName: 'vehicle_emergency_stop',
    capabilityId: 'vehicle.ugv.emergency-stop',
    skillId: 'ugv.emergency-stop',
    name: 'Emergency-stop UGV',
    summary:
      'Preempt and stop one exact UGV resource only after explicit, unambiguous safety intent.',
    kind: 'emergency_stop' as const,
    evidence: Object.freeze([
      'vehicle.command.acceptance',
      'vehicle.remote-task.identity',
      'vehicle.task.progress',
      'vehicle.task.terminal',
      'vehicle.stop.observation',
    ]),
  }),
]);

type GovernanceSpec = (typeof GOVERNANCE_SPECS)[number];

export interface UgvSmppCapabilityGovernanceConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly runtimeManagementBaseUrl: string;
  readonly packageWorkspaceRoot: string;
  readonly runId: string;
  /** Required only when the live public Tool schemas admit more than one resource ID. */
  readonly resourceId?: string;
  /** Explicitly publishes only the bounded vehicle_navigate control authority. */
  readonly activateNavigateControl?: boolean;
}

export interface UgvSmppCapabilityGovernanceReport {
  readonly schemaVersion: 'sdar.ugv-smpp-capability-governance/v1';
  readonly status: 'passed';
  readonly observedAt: string;
  readonly binding: Readonly<{
    bindingId: typeof UGV_BINDING_ID;
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
    toolName: typeof FIRE_TOOL_NAME;
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

export class UgvSmppCapabilityGovernanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UgvSmppCapabilityGovernanceError';
    this.code = code;
  }
}

const BindingSchema = z
  .object({
    bindingId: z.literal(UGV_BINDING_ID),
    localServerId: z.string().min(1),
    originType: z.literal('smpp_registry'),
    smppSourceId: z.string().min(1),
    externalProviderId: z.string().min(1),
    externalServerId: z.string().min(1),
    registryRevision: z.number().int().positive(),
    registryChecksum: z.string().regex(CHECKSUM),
    catalogRevision: z.string().min(1),
    catalogChecksum: z.string().regex(CHECKSUM),
    endpointRef: z.string().min(1),
    status: z.literal('active'),
    availabilityStatus: z.literal('available'),
    revision: z.number().int().positive(),
    availabilityValidUntil: z.iso.datetime(),
    catalogObservedAt: z.iso.datetime(),
    operationCount: z.number().int().nonnegative(),
  })
  .loose();

const DiscoverySchema = z
  .object({
    protocolVersion: z.string().min(1),
    serverInfo: z.record(z.string(), z.unknown()),
    discoveredAt: z.iso.datetime(),
    validUntil: z.iso.datetime(),
    toolRevision: z.number().int().positive(),
  })
  .loose();

const RuntimeServerSchema = z
  .object({
    serverId: z.string().min(1),
    endpoint: z.string().min(1),
    protocolMode: z.literal('frozen_v1'),
    toolRevision: z.number().int().positive(),
    currentDiscovery: DiscoverySchema,
  })
  .loose();

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

const ToolSchema = z
  .object({
    serverId: z.string().min(1),
    toolName: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: JsonSchema,
    outputSchema: JsonSchema,
    protocolMode: z.literal('frozen_v1'),
    executionSemantics: ExecutionSemanticsSchema,
    taskExecutionProfile: z
      .object({
        profileVersion: z.literal('1.0'),
        taskBehavior: z.enum(['synchronous_only', 'server_directed', 'task_required']),
      })
      .loose(),
  })
  .loose();

const RuntimeSkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.number().int().positive(),
    status: z.string().min(1),
    usageSpecification: z.record(z.string(), z.unknown()),
  })
  .loose();

const GovernedSkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.union([z.string().min(1), z.number().int().positive()]),
    status: z.enum(['validated', 'published']),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    usageSpecification: z.record(z.string(), z.unknown()),
    outcomeSpecification: z.record(z.string(), z.unknown()),
    providerPolicy: z.record(z.string(), z.unknown()),
    evidencePolicy: z.record(z.string(), z.unknown()),
  })
  .loose();

const CapabilitySchema = z
  .object({
    capabilityId: z.string().min(1),
    version: z.number().int().positive(),
    domain: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    successCriteria: z.array(z.record(z.string(), z.unknown())),
    requiredEvidence: z.array(z.record(z.string(), z.unknown())),
    effects: z.array(z.string()).optional(),
    artifacts: z.array(z.string()).optional(),
    constraints: z.array(z.record(z.string(), z.unknown())).optional(),
    supportedModes: z.array(z.string()).optional(),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    status: z.enum(['draft', 'validating', 'published', 'suspended', 'deprecated', 'retired']),
    definitionHash: z.string().regex(CHECKSUM),
    previousVersion: z.number().int().positive().optional(),
    createdBy: z.string().optional(),
    createdAt: z.iso.datetime().optional(),
  })
  .strict();

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
    providerPolicyOverride: z.unknown().optional(),
    status: z.literal('active'),
    revision: z.number().int().positive(),
  })
  .strict();

const OperationSchema = z
  .object({
    status: z.literal('succeeded'),
    errorCode: z.string().optional(),
    result: z.unknown().optional(),
  })
  .loose();

const ReadinessSchema = z
  .object({
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    status: z.enum(['available', 'degraded', 'unavailable', 'suspended']),
    validUntil: z.iso.datetime(),
    availableImplementations: z.array(z.string()),
    unavailableImplementations: z.array(z.string()),
    reasons: z
      .array(
        z
          .object({
            code: z.string().min(1),
            severity: z.enum(['info', 'warning', 'blocking']),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

type Binding = z.infer<typeof BindingSchema>;
type RuntimeServer = z.infer<typeof RuntimeServerSchema>;
type Tool = z.infer<typeof ToolSchema>;

interface CatalogAuthority {
  readonly binding: Binding;
  readonly server: RuntimeServer;
  readonly tools: readonly Tool[];
  readonly fingerprint: string;
}

interface PreparedGovernance {
  readonly spec: GovernanceSpec;
  readonly tool: Tool;
  readonly resourceId: string;
  readonly resourceSelection: 'single_schema_value' | 'explicit_configured_value';
  readonly skill: Readonly<Record<string, unknown>>;
  readonly usage: Readonly<Record<string, unknown>>;
  readonly capability: NodeCapabilityDefinitionVersion;
  readonly implementation: CapabilityImplementationBinding;
  readonly skillVersion: number;
  readonly capabilityVersion: number;
  readonly existingRuntimeSkill?: z.infer<typeof RuntimeSkillSchema>;
  readonly existingCapability?: NodeCapabilityDefinitionVersion;
  readonly existingImplementation?: CapabilityImplementationBinding;
}

export async function governUgvSmppCapabilities(
  input: UgvSmppCapabilityGovernanceConfiguration,
  dependencies: Readonly<{
    fetch?: typeof fetch;
    now?: () => string;
    delay?: (milliseconds: number) => Promise<void>;
  }> = {},
): Promise<UgvSmppCapabilityGovernanceReport> {
  const configuration = validateConfiguration(input);
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const pause = dependencies.delay ?? delay;
  const observedAt = validTimestamp(now(), 'DRIVER_CLOCK_INVALID');
  const authority = await loadCatalogAuthority(configuration, observedAt, request);
  await assertFireGovernanceAbsent(configuration, request);
  const versions = await resolveGovernanceVersions(configuration, authority, request);
  const planned = planGovernance(configuration, authority, versions);
  const prepared: PreparedGovernance[] = [];

  // Read every existing authority before the first authoritative mutation. Drift never becomes a
  // partially accepted exact version merely because an earlier item happened to be absent.
  for (const item of planned) {
    const existingRuntimeSkill = await runtimeGetSkill(
      configuration,
      item.spec.skillId,
      item.skillVersion,
      request,
    );
    const publishAuthority = shouldPublishAuthority(item.spec, configuration);
    if (
      existingRuntimeSkill !== undefined &&
      !publishAuthority &&
      existingRuntimeSkill.status !== 'draft'
    )
      fail(
        'CONTROL_GOVERNANCE_EXECUTABLE',
        'A staged UGV control Skill is executable and must be suspended before governance can continue.',
      );
    if (existingRuntimeSkill !== undefined) {
      assertRuntimeSkillContentExact(existingRuntimeSkill, item.skill, item.usage);
      if (publishAuthority && !['draft', 'enabled'].includes(existingRuntimeSkill.status))
        fail('SKILL_LIFECYCLE_INVALID', 'A governed Skill version is not publishable.');
    }
    const existingCapability = await controlGetCapability(
      configuration,
      item.spec.capabilityId,
      item.capabilityVersion,
      request,
    );
    let existingImplementation: CapabilityImplementationBinding | undefined;
    if (existingCapability !== undefined) {
      assertCapabilityExact(existingCapability, item.capability);
      if (!publishAuthority && existingCapability.status !== 'draft')
        fail(
          'CONTROL_GOVERNANCE_EXECUTABLE',
          'A staged UGV control Capability is no longer draft and must be suspended before governance can continue.',
        );
      const implementations = await controlGetImplementations(
        configuration,
        item.spec.capabilityId,
        item.capabilityVersion,
        request,
      );
      if (implementations.length > 1)
        fail(
          'CAPABILITY_IMPLEMENTATION_AUTHORITY_AMBIGUOUS',
          'A governed Capability has more than one implementation binding.',
        );
      existingImplementation = implementations[0];
      if (!publishAuthority && existingImplementation !== undefined)
        fail(
          'CONTROL_IMPLEMENTATION_ALREADY_EXISTS',
          'A staged UGV control Capability has an active implementation and must be suspended before governance can continue.',
        );
      if (existingImplementation !== undefined)
        assertImplementationExact(existingImplementation, item.implementation);
      if (existingCapability.status === 'published' && existingImplementation === undefined)
        fail(
          'CAPABILITY_IMPLEMENTATION_MISSING',
          'A published Capability is missing its exact Skill implementation.',
        );
    }
    prepared.push(
      Object.freeze({
        ...item,
        ...(existingRuntimeSkill === undefined ? {} : { existingRuntimeSkill }),
        ...(existingCapability === undefined ? {} : { existingCapability }),
        ...(existingImplementation === undefined ? {} : { existingImplementation }),
      }),
    );
  }

  const skills: UgvSmppCapabilityGovernanceReport['skills'][number][] = [];
  const stagedSkillPackages = new Map<
    string,
    Readonly<{ packageChecksum: string; runtimeStatus: 'draft'; governanceStatus: 'validated' }>
  >();
  for (const item of prepared) {
    const publishAuthority = shouldPublishAuthority(item.spec, configuration);
    const packageResult = await materializeSkillPackage(
      configuration.packageWorkspaceRoot,
      item.spec,
      item.skill,
      item.usage,
      item.skillVersion,
    );
    const action = item.existingRuntimeSkill === undefined ? 'imported' : 'reconciled';
    if (item.existingRuntimeSkill === undefined) {
      OperationSchema.parse(
        await controlCommand(
          configuration,
          '/api/v1/skills/import',
          runKey(
            configuration.runId,
            'skill-import',
            `${item.spec.skillId}@${String(item.skillVersion)}`,
          ),
          {
            reason: `Import exact governed ${item.spec.skillId}@${String(item.skillVersion)} from the live SMPP contract.`,
            payload: { packageRoot: packageResult.packageRoot },
          },
          request,
        ),
      );
    }
    if (publishAuthority && item.existingRuntimeSkill?.status !== 'enabled')
      OperationSchema.parse(
        await controlCommand(
          configuration,
          `/api/v1/skills/${encodeURIComponent(item.spec.skillId)}/versions/${String(item.skillVersion)}/publish`,
          runKey(
            configuration.runId,
            'skill-publish',
            `${item.spec.skillId}@${String(item.skillVersion)}`,
          ),
          {
            reason: `Publish exact governed ${item.spec.skillId}@${String(item.skillVersion)}.`,
            expectedRevision: 0,
          },
          request,
        ),
      );
    const runtimeSkill = await runtimeGetSkill(
      configuration,
      item.spec.skillId,
      item.skillVersion,
      request,
    );
    if (runtimeSkill === undefined)
      fail('SKILL_MISSING_AFTER_GOVERNANCE', 'Runtime did not expose the exact Skill version.');
    const expectedRuntimeStatus = publishAuthority ? 'enabled' : 'draft';
    assertRuntimeSkillExact(runtimeSkill, item.skill, item.usage, expectedRuntimeStatus);
    const governed = GovernedSkillSchema.parse(
      await controlGet(
        configuration,
        `/api/v1/skills/${encodeURIComponent(item.spec.skillId)}/versions/${String(item.skillVersion)}`,
        request,
      ),
    );
    const expectedGovernedStatus = publishAuthority ? 'published' : 'validated';
    assertGovernedSkillExact(
      governed,
      item.skill,
      item.usage,
      item.skillVersion,
      expectedGovernedStatus,
    );
    if (publishAuthority)
      skills.push(
        Object.freeze({
          skillId: item.spec.skillId,
          skillVersion: item.skillVersion,
          capabilityId: item.spec.capabilityId,
          toolName: item.spec.toolName,
          packageChecksum: packageResult.packageChecksum,
          inputSchemaSha256: sha256(stableStringify(item.tool.inputSchema)),
          outputSchemaSha256: sha256(stableStringify(item.tool.outputSchema)),
          action,
          status: 'published',
        }),
      );
    else
      stagedSkillPackages.set(
        item.spec.skillId,
        Object.freeze({
          packageChecksum: packageResult.packageChecksum,
          runtimeStatus: 'draft',
          governanceStatus: 'validated',
        }),
      );
  }

  const readinessTargets: PreparedGovernance[] = [];
  for (const item of prepared) {
    const publishAuthority = shouldPublishAuthority(item.spec, configuration);
    let capability = item.existingCapability;
    capability ??= CapabilitySchema.parse(
      await controlCreate(
        configuration,
        '/api/v1/node-capabilities',
        runKey(
          configuration.runId,
          'capability-create',
          `${item.spec.capabilityId}@${String(item.capabilityVersion)}`,
        ),
        item.capability,
        request,
      ),
    ) as NodeCapabilityDefinitionVersion;
    if (publishAuthority && item.existingImplementation === undefined) {
      ImplementationSchema.parse(
        await controlCreate(
          configuration,
          `/api/v1/node-capabilities/${encodeURIComponent(item.spec.capabilityId)}/versions/${String(item.capabilityVersion)}/implementations`,
          runKey(
            configuration.runId,
            'capability-implementation',
            `${item.spec.capabilityId}@${String(item.capabilityVersion)}:skill-${String(item.skillVersion)}`,
          ),
          item.implementation,
          request,
        ),
      );
    }
    if (!publishAuthority) {
      if (capability.status !== 'draft')
        fail('CONTROL_GOVERNANCE_EXECUTABLE', 'A staged UGV control Capability must remain draft.');
      continue;
    }
    if (capability.status === 'draft') {
      capability = CapabilitySchema.parse(
        await controlMutation(
          configuration,
          `/api/v1/node-capabilities/${encodeURIComponent(item.spec.capabilityId)}/versions/${String(item.capabilityVersion)}/validate`,
          runKey(
            configuration.runId,
            'capability-validate',
            `${item.spec.capabilityId}@${String(item.capabilityVersion)}`,
          ),
          {
            reason: `Validate exact governed ${item.spec.capabilityId}@${String(item.capabilityVersion)}.`,
          },
          nodeCapabilityEtag(capability),
          200,
          request,
        ),
      ) as NodeCapabilityDefinitionVersion;
    }
    if (capability.status === 'validating') {
      OperationSchema.parse(
        await controlMutation(
          configuration,
          `/api/v1/node-capabilities/${encodeURIComponent(item.spec.capabilityId)}/versions/${String(item.capabilityVersion)}/publish`,
          runKey(
            configuration.runId,
            'capability-publish',
            `${item.spec.capabilityId}@${String(item.capabilityVersion)}`,
          ),
          {
            reason: `Publish exact governed ${item.spec.capabilityId}@${String(item.capabilityVersion)}.`,
          },
          nodeCapabilityEtag(capability),
          202,
          request,
        ),
      );
    } else if (capability.status !== 'published') {
      fail('CAPABILITY_LIFECYCLE_INVALID', 'Capability lifecycle is not publishable.');
    }
    const published = await controlGetCapability(
      configuration,
      item.spec.capabilityId,
      item.capabilityVersion,
      request,
    );
    if (published?.status !== 'published')
      fail('CAPABILITY_NOT_PUBLISHED', 'Capability publication was not observable.');
    assertCapabilityExact(published, item.capability);
    readinessTargets.push(item);
  }

  const readiness = await evaluateCapabilityReadiness(
    readinessTargets,
    configuration,
    request,
    pause,
  );
  const finalObservedAt = validTimestamp(now(), 'DRIVER_CLOCK_INVALID');
  const finalAuthority = await loadCatalogAuthority(configuration, finalObservedAt, request);
  if (finalAuthority.fingerprint !== authority.fingerprint)
    fail(
      'CATALOG_AUTHORITY_CHANGED_DURING_GOVERNANCE',
      'The exact Binding or Runtime Catalog changed during governance.',
    );

  const capabilities = readinessTargets.map((item) => {
    const snapshot = readiness.get(item.spec.capabilityId);
    if (snapshot === undefined)
      return fail('CAPABILITY_READINESS_MISSING', 'Capability readiness was not recorded.');
    requireFresh(snapshot.validUntil, finalObservedAt, 'CAPABILITY_READINESS_EXPIRED');
    return Object.freeze({
      capabilityId: item.spec.capabilityId,
      capabilityVersion: item.capabilityVersion,
      definitionHash: item.capability.definitionHash,
      implementationBindingId: item.implementation.bindingId,
      skillId: item.spec.skillId,
      skillVersion: item.skillVersion,
      toolName: item.spec.toolName,
      riskLevel: riskFor(item.spec.kind),
      confirmation:
        item.spec.kind === 'read_only' ? ('not_required' as const) : ('required' as const),
      remoteTerminalEvidenceRequired: item.spec.kind !== 'read_only',
      readiness: 'available' as const,
      readinessValidUntil: snapshot.validUntil,
    });
  });

  const knownToolNames = new Set<string>([
    ...GOVERNANCE_SPECS.map(({ toolName }) => toolName),
    FIRE_TOOL_NAME,
  ]);
  const stagedControlPrepared = prepared.filter(
    ({ spec }) => spec.kind !== 'read_only' && !shouldPublishAuthority(spec, configuration),
  );
  const sharedResource = planned[0]?.resourceId;
  const selection = planned[0]?.resourceSelection;
  if (sharedResource === undefined || selection === undefined)
    return fail(
      'NO_GOVERNABLE_UGV_TOOLS',
      'No governable UGV Tool was present in the live Catalog.',
    );
  const report: UgvSmppCapabilityGovernanceReport = Object.freeze({
    schemaVersion: 'sdar.ugv-smpp-capability-governance/v1',
    status: 'passed',
    observedAt: finalObservedAt,
    binding: Object.freeze({
      bindingId: UGV_BINDING_ID,
      localServerId: finalAuthority.binding.localServerId,
      revision: finalAuthority.binding.revision,
      registryRevision: finalAuthority.binding.registryRevision,
      registryChecksum: finalAuthority.binding.registryChecksum,
      catalogRevision: finalAuthority.binding.catalogRevision,
      catalogChecksum: finalAuthority.binding.catalogChecksum,
      operationCount: finalAuthority.binding.operationCount,
      availabilityValidUntil: finalAuthority.binding.availabilityValidUntil,
    }),
    resourcePolicy: Object.freeze({
      identifierAuthority: 'public_smpp_tool_schema',
      resourceId: sharedResource,
      selection,
    }),
    catalog: Object.freeze({
      discoveredToolCount: finalAuthority.tools.length,
      governedToolCount: readinessTargets.length,
      stagedControlToolCount: stagedControlPrepared.length,
      unmappedToolNames: Object.freeze(
        finalAuthority.tools
          .map(({ toolName }) => toolName)
          .filter((toolName) => !knownToolNames.has(toolName))
          .sort(compare),
      ),
    }),
    firePolicy: Object.freeze({
      toolName: FIRE_TOOL_NAME,
      discovered: finalAuthority.tools.some(({ toolName }) => toolName === FIRE_TOOL_NAME),
      forbidden: true,
      capabilityCreated: false,
      skillCreated: false,
    }),
    skills: Object.freeze(skills),
    capabilities: Object.freeze(capabilities),
    stagedControls: Object.freeze(
      stagedControlPrepared.map((item) => {
        const stagedSkill = stagedSkillPackages.get(item.spec.skillId);
        if (stagedSkill === undefined)
          return fail('CONTROL_SKILL_STAGE_MISSING', 'A staged control Skill package is missing.');
        return Object.freeze({
          capabilityId: item.spec.capabilityId,
          skillId: item.spec.skillId,
          toolName: item.spec.toolName,
          packageChecksum: stagedSkill.packageChecksum,
          definitionHash: item.capability.definitionHash,
          proposedImplementationBindingId: item.implementation.bindingId,
          implementationPersisted: false as const,
          riskLevel: riskFor(item.spec.kind) as 'medium' | 'high',
          confirmation: 'required' as const,
          runtimeSkillStatus: stagedSkill.runtimeStatus,
          governedSkillStatus: stagedSkill.governanceStatus,
          capabilityStatus: 'draft' as const,
          readiness: 'unavailable' as const,
          lifecycle: 'staged_non_executable' as const,
          persisted: true as const,
          selectable: false as const,
          executionAuthorized: false as const,
          blockingReasonCodes: [
            'CONTROL_TRANSPORT_GATE_NOT_IMPLEMENTED',
            'PHYSICAL_WRITE_ACCEPTANCE_NOT_RUN',
          ] as const,
        });
      }),
    ),
    redaction: Object.freeze({
      secretsIncluded: false,
      endpointsIncluded: false,
      downstreamDeviceIdsIncluded: false,
      mqttTopicsIncluded: false,
    }),
  });
  assertSafeReport(report);
  return report;
}

async function assertFireGovernanceAbsent(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  request: typeof fetch,
): Promise<void> {
  const [skill, capability] = await Promise.all([
    runtimeListSkillVersions(configuration, FIRE_SKILL_ID, request),
    controlListCapabilities(configuration, request),
  ]);
  if (
    skill.length !== 0 ||
    capability.some(({ capabilityId }) => capabilityId === FIRE_CAPABILITY_ID)
  )
    fail(
      'FIRE_GOVERNANCE_ALREADY_EXISTS',
      'An exact UGV fire Capability or Skill exists; this Goal cannot reconcile or enable it.',
    );
}

async function resolveGovernanceVersions(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  authority: CatalogAuthority,
  request: typeof fetch,
): Promise<ReadonlyMap<string, Readonly<{ skillVersion: number; capabilityVersion: number }>>> {
  const present = GOVERNANCE_SPECS.filter((spec) =>
    authority.tools.some(({ toolName }) => toolName === spec.toolName),
  );
  const capabilities = await controlListCapabilities(configuration, request);
  const capabilityVersions = new Map<string, readonly NodeCapabilityDefinitionVersion[]>();
  for (const spec of present)
    capabilityVersions.set(
      spec.capabilityId,
      capabilities.filter(({ capabilityId }) => capabilityId === spec.capabilityId),
    );
  const result = new Map<string, Readonly<{ skillVersion: number; capabilityVersion: number }>>();
  await Promise.all(
    present.map(async (spec) => {
      const publishAuthority = shouldPublishAuthority(spec, configuration);
      const tool = authority.tools.find(({ toolName }) => toolName === spec.toolName);
      if (tool === undefined)
        return fail('GOVERNANCE_VERSION_MISSING', 'Governance Tool authority is incomplete.');
      validateToolSemantics(spec, tool, authority.binding.localServerId);
      const resource = resolveResourceId(tool, configuration.resourceId);
      const skills = await runtimeListSkillVersions(configuration, spec.skillId, request);
      const nodes = capabilityVersions.get(spec.capabilityId) ?? [];
      if (
        !publishAuthority &&
        (skills.some(({ status }) => status !== 'draft') ||
          nodes.some(({ status }) => status !== 'draft'))
      )
        fail(
          'CONTROL_GOVERNANCE_EXECUTABLE',
          'Every historical UGV control authority must remain a non-executable draft.',
        );
      const latestSkill = maxByVersion(skills);
      const proposedSkillVersion = latestSkill?.version ?? INITIAL_GOVERNANCE_VERSION;
      const proposedSkill = buildSkillContract(
        spec,
        authority.binding,
        tool,
        resource.resourceId,
        proposedSkillVersion,
      );
      const skillVersion =
        latestSkill !== undefined &&
        runtimeSkillContentMatches(latestSkill, proposedSkill.skill, proposedSkill.usage)
          ? latestSkill.version
          : proposedSkillVersion + (latestSkill === undefined ? 0 : 1);
      if (
        publishAuthority &&
        latestSkill !== undefined &&
        !['draft', 'enabled'].includes(latestSkill.status)
      )
        fail('SKILL_LIFECYCLE_INVALID', 'The latest governed Skill version is not publishable.');
      const latestCapability = maxByVersion(nodes);
      const proposedCapabilityVersion = latestCapability?.version ?? INITIAL_GOVERNANCE_VERSION;
      const proposedCapability = buildCapability(
        spec,
        authority.binding,
        tool,
        resource.resourceId,
        proposedCapabilityVersion,
        skillVersion,
      );
      const capabilityVersion =
        latestCapability !== undefined && capabilityMatches(latestCapability, proposedCapability)
          ? latestCapability.version
          : proposedCapabilityVersion + (latestCapability === undefined ? 0 : 1);
      if (
        publishAuthority &&
        latestCapability !== undefined &&
        !['draft', 'validating', 'published'].includes(latestCapability.status)
      )
        fail(
          'CAPABILITY_LIFECYCLE_INVALID',
          'The latest governed Capability version is not publishable.',
        );
      result.set(spec.skillId, Object.freeze({ skillVersion, capabilityVersion }));
    }),
  );
  return result;
}

function planGovernance(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  authority: CatalogAuthority,
  versions: ReadonlyMap<string, Readonly<{ skillVersion: number; capabilityVersion: number }>>,
): readonly Omit<
  PreparedGovernance,
  'existingRuntimeSkill' | 'existingCapability' | 'existingImplementation'
>[] {
  const tools = new Map<string, Tool>();
  for (const tool of authority.tools) {
    if (tools.has(tool.toolName))
      fail('MCP_TOOL_IDENTITY_NOT_EXACT', 'The Runtime Catalog contains duplicate Tool names.');
    tools.set(tool.toolName, tool);
  }
  const planned = GOVERNANCE_SPECS.flatMap((spec) => {
    const tool = tools.get(spec.toolName);
    if (tool === undefined) return [];
    const version = versions.get(spec.skillId);
    if (version === undefined)
      return fail('GOVERNANCE_VERSION_MISSING', 'Governance version resolution is incomplete.');
    validateToolSemantics(spec, tool, authority.binding.localServerId);
    const resource = resolveResourceId(tool, configuration.resourceId);
    const skillContract = buildSkillContract(
      spec,
      authority.binding,
      tool,
      resource.resourceId,
      version.skillVersion,
    );
    const capability = buildCapability(
      spec,
      authority.binding,
      tool,
      resource.resourceId,
      version.capabilityVersion,
      version.skillVersion,
    );
    const implementation = buildImplementation(
      spec,
      authority.binding,
      tool,
      resource.resourceId,
      version.capabilityVersion,
      version.skillVersion,
    );
    return [
      Object.freeze({
        spec,
        tool,
        resourceId: resource.resourceId,
        resourceSelection: resource.selection,
        skill: skillContract.skill,
        usage: skillContract.usage,
        capability,
        implementation,
        skillVersion: version.skillVersion,
        capabilityVersion: version.capabilityVersion,
      }),
    ];
  });
  if (planned.length === 0)
    fail('NO_GOVERNABLE_UGV_TOOLS', 'No governable UGV Tool was present in the live Catalog.');
  const resourceIds = new Set(planned.map(({ resourceId }) => resourceId));
  if (resourceIds.size !== 1)
    fail(
      'UGV_RESOURCE_AUTHORITY_MISMATCH',
      'Governed public Tool schemas do not resolve to one exact UGV resource.',
    );
  return Object.freeze(planned);
}

async function loadCatalogAuthority(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  observedAt: string,
  request: typeof fetch,
): Promise<CatalogAuthority> {
  const binding = BindingSchema.parse(
    await controlGet(
      configuration,
      `/api/v1/mcp-provider-bindings/${encodeURIComponent(UGV_BINDING_ID)}`,
      request,
    ),
  );
  requireFresh(binding.availabilityValidUntil, observedAt, 'PROVIDER_BINDING_FRESHNESS_EXPIRED');
  const servers = z
    .object({ items: z.array(RuntimeServerSchema) })
    .loose()
    .parse(await runtimeGet(configuration, '/api/v1/mcp/servers', request)).items;
  const matches = servers.filter(({ serverId }) => serverId === binding.localServerId);
  if (matches.length !== 1)
    fail(
      'RUNTIME_SERVER_IDENTITY_NOT_EXACT',
      'Expected exactly one Runtime Server for the current Provider Binding.',
    );
  const server = matches[0];
  if (server === undefined)
    return fail('RUNTIME_SERVER_IDENTITY_NOT_EXACT', 'The bound Runtime Server is missing.');
  if (
    safeEndpoint(binding.endpointRef, 'PROVIDER_BINDING_ENDPOINT_INVALID') !==
    safeEndpoint(server.endpoint, 'RUNTIME_SERVER_ENDPOINT_INVALID')
  )
    fail(
      'PROVIDER_BINDING_ENDPOINT_MISMATCH',
      'The current Provider Binding and Runtime Server endpoints are not exact.',
    );
  requireFresh(server.currentDiscovery.validUntil, observedAt, 'RUNTIME_DISCOVERY_EXPIRED');
  if (
    server.toolRevision !== binding.revision ||
    server.currentDiscovery.toolRevision !== binding.revision
  )
    fail(
      'CATALOG_AUTHORITY_REVISION_MISMATCH',
      'Binding and Runtime Catalog revisions are not exact.',
    );
  const tools = z
    .object({ items: z.array(ToolSchema) })
    .loose()
    .parse(
      await runtimeGet(
        configuration,
        `/api/v1/mcp/servers/${encodeURIComponent(binding.localServerId)}/tools`,
        request,
      ),
    ).items;
  if (tools.some(({ serverId }) => serverId !== binding.localServerId))
    fail('MCP_TOOL_SERVER_MISMATCH', 'A Runtime Tool belongs to a different Server identity.');
  if (tools.length !== binding.operationCount)
    fail('CATALOG_OPERATION_COUNT_MISMATCH', 'Binding and Runtime operation counts differ.');
  const checksum = runtimeCatalogChecksum(server, tools);
  if (checksum !== binding.catalogChecksum)
    fail('CATALOG_CHECKSUM_MISMATCH', 'Binding and Runtime Catalog checksums differ.');
  const serverVersion = server.currentDiscovery.serverInfo['version'];
  if (
    typeof serverVersion !== 'string' ||
    binding.catalogRevision !== `${serverVersion}:${String(server.toolRevision)}`
  )
    fail('CATALOG_REVISION_MISMATCH', 'Binding Catalog revision does not match Runtime discovery.');
  const fingerprint = sha256(
    stableStringify({
      binding: {
        bindingId: binding.bindingId,
        localServerId: binding.localServerId,
        smppSourceId: binding.smppSourceId,
        externalProviderId: binding.externalProviderId,
        externalServerId: binding.externalServerId,
        registryRevision: binding.registryRevision,
        registryChecksum: binding.registryChecksum,
        catalogRevision: binding.catalogRevision,
        catalogChecksum: binding.catalogChecksum,
        endpointSha256: sha256(
          safeEndpoint(binding.endpointRef, 'PROVIDER_BINDING_ENDPOINT_INVALID'),
        ),
        revision: binding.revision,
        operationCount: binding.operationCount,
        availabilityValidUntil: binding.availabilityValidUntil,
      },
      server: {
        serverId: server.serverId,
        endpointSha256: sha256(safeEndpoint(server.endpoint, 'RUNTIME_SERVER_ENDPOINT_INVALID')),
        protocolMode: server.protocolMode,
        toolRevision: server.toolRevision,
        discovery: server.currentDiscovery,
      },
      tools,
    }),
  );
  return Object.freeze({ binding, server, tools: Object.freeze(tools), fingerprint });
}

function validateToolSemantics(spec: GovernanceSpec, tool: Tool, serverId: string): void {
  const expectedReadOnly = spec.kind === 'read_only';
  if (
    tool.serverId !== serverId ||
    !['mcp_declared', 'admin_override'].includes(tool.executionSemantics.source) ||
    Object.values(tool.executionSemantics).some((value) => value === 'unknown')
  )
    fail('MCP_TOOL_SEMANTICS_UNTRUSTED', 'Tool execution semantics are not current and explicit.');
  if (
    tool.executionSemantics.effect !== (expectedReadOnly ? 'read_only' : 'side_effecting') ||
    tool.executionSemantics.execution !== (expectedReadOnly ? 'synchronous' : 'task_required') ||
    tool.taskExecutionProfile.taskBehavior !==
      (expectedReadOnly ? 'synchronous_only' : 'task_required')
  )
    fail(
      'MCP_TOOL_SEMANTICS_CONFLICT',
      'Live Tool execution semantics conflict with the governed Capability class.',
    );
  requireObjectSchema(tool.inputSchema, 'MCP_TOOL_INPUT_SCHEMA_INVALID');
  requireObjectSchema(tool.outputSchema, 'MCP_TOOL_OUTPUT_SCHEMA_INVALID');
  if (spec.toolName === NAVIGATE_TOOL_NAME) assertNavigateDistanceSchema(tool.inputSchema);
}

function assertNavigateDistanceSchema(schema: unknown): void {
  const input = requireObjectSchema(schema, 'MCP_TOOL_INPUT_SCHEMA_INVALID');
  const properties = record(input['properties']);
  const mission = record(properties?.['mission']);
  const alternatives = mission?.['oneOf'];
  const distanceAlternative = Array.isArray(alternatives)
    ? alternatives.map(record).find((alternative) => {
        const fields = record(alternative?.['properties']);
        return record(fields?.['type'])?.['const'] === 'distance';
      })
    : undefined;
  const distanceFields = record(distanceAlternative?.['properties']);
  const distance = record(distanceFields?.['distanceM']);
  const direction = record(distanceFields?.['direction']);
  const requiredFields = distanceAlternative?.['required'];
  if (
    distanceAlternative === undefined ||
    distance?.['type'] !== 'number' ||
    distance['exclusiveMinimum'] !== 0 ||
    direction?.['type'] !== 'string' ||
    !sameStrings(direction['enum'], ['backward', 'forward', 'left', 'right']) ||
    !sameStrings(requiredFields, ['direction', 'distanceM', 'type'])
  )
    fail(
      'NAVIGATE_DISTANCE_SCHEMA_UNSUPPORTED',
      'vehicle_navigate must expose the exact mission.distanceM distance contract.',
    );
}

function resolveResourceId(
  tool: Tool,
  configured: string | undefined,
): Readonly<{
  resourceId: string;
  selection: 'single_schema_value' | 'explicit_configured_value';
}> {
  const input = requireObjectSchema(tool.inputSchema, 'MCP_TOOL_INPUT_SCHEMA_INVALID');
  const properties = input['properties'];
  if (!isRecord(properties))
    fail('MCP_TOOL_RESOURCE_SCHEMA_INVALID', 'Tool input schema must declare properties.');
  const resource = properties['resourceId'];
  if (!isRecord(resource))
    fail('MCP_TOOL_RESOURCE_SCHEMA_INVALID', 'Tool input schema must declare resourceId.');
  const required = input['required'];
  if (!Array.isArray(required) || !required.includes('resourceId'))
    fail('MCP_TOOL_RESOURCE_SCHEMA_INVALID', 'Tool resourceId must be required.');
  const declared = new Set<string>();
  if (typeof resource['const'] === 'string') declared.add(resource['const']);
  if (Array.isArray(resource['enum'])) {
    for (const value of resource['enum']) {
      if (typeof value !== 'string')
        fail('MCP_TOOL_RESOURCE_SCHEMA_INVALID', 'Tool resourceId enum must contain strings only.');
      declared.add(value);
    }
  }
  if (declared.size === 0)
    fail(
      'MCP_TOOL_RESOURCE_AUTHORITY_MISSING',
      'Tool resourceId must be bounded by a public const or enum.',
    );
  if (configured !== undefined) {
    if (!declared.has(configured))
      fail(
        'CONFIGURED_RESOURCE_NOT_IN_TOOL_SCHEMA',
        'Configured resourceId is not admitted by the live Tool schema.',
      );
    return Object.freeze({ resourceId: configured, selection: 'explicit_configured_value' });
  }
  if (declared.size !== 1)
    fail(
      'MCP_TOOL_RESOURCE_AUTHORITY_AMBIGUOUS',
      'A multi-resource Tool schema requires one explicit configured public resourceId.',
    );
  const resourceId = [...declared][0];
  if (resourceId === undefined)
    return fail('MCP_TOOL_RESOURCE_AUTHORITY_MISSING', 'Tool resource authority is empty.');
  return Object.freeze({ resourceId, selection: 'single_schema_value' });
}

function buildSkillContract(
  spec: GovernanceSpec,
  binding: Binding,
  tool: Tool,
  resourceId: string,
  version: number,
): Readonly<{
  skill: Readonly<Record<string, unknown>>;
  usage: Readonly<Record<string, unknown>>;
}> {
  const inputSchema = requireObjectSchema(tool.inputSchema, 'MCP_TOOL_INPUT_SCHEMA_INVALID');
  const outputSchema = requireObjectSchema(tool.outputSchema, 'MCP_TOOL_OUTPUT_SCHEMA_INVALID');
  const readOnly = spec.kind === 'read_only';
  const boundedNavigate = spec.toolName === NAVIGATE_TOOL_NAME;
  const confirmation = readOnly
    ? []
    : [
        `Require explicit Plan confirmation for exact resource ${resourceId} before ${spec.toolName}.`,
      ];
  const semantics = executionSemantics(tool);
  const outcomeBase = Object.freeze({
    schemaVersion: '1.0',
    skillId: spec.skillId,
    skillVersion: version,
    effects: Object.freeze([effectFor(spec)]),
    evidence: spec.evidence,
    artifacts: Object.freeze([]),
    taskGoalPolicy: Object.freeze({
      taskType: spec.toolName,
      requestedCapabilityId: spec.capabilityId,
      resourceId,
      mcpProviderBindingId: binding.bindingId,
      localServerId: binding.localServerId,
      mcpToolName: spec.toolName,
      bindingRevision: binding.revision,
      registryRevision: binding.registryRevision,
      registryChecksum: binding.registryChecksum,
      catalogRevision: binding.catalogRevision,
      catalogChecksum: binding.catalogChecksum,
      taskBehavior: tool.taskExecutionProfile.taskBehavior,
      executionSemantics: semantics,
    }),
    confidencePolicy: Object.freeze({
      rejectSuccessWithoutRequiredEvidence: true,
      requireSchemaValidation: true,
      mcpAcceptanceIsTerminalSuccess: false,
    }),
    sideEffectPolicy: Object.freeze(
      readOnly
        ? {
            sideEffecting: false,
            confirmation: 'not_required',
            normalizedObservationRequired: true,
          }
        : {
            sideEffecting: true,
            confirmation: 'required_before_execution',
            autoConfirmPlan: false,
            allowRealSideEffectsEnv: 'ALLOW_REAL_UGV_SIDE_EFFECTS',
            realTestRunIdEnv: 'REAL_UGV_TEST_RUN_ID',
            exactResourceRequired: true,
            remoteTaskIdentityRequired: true,
            terminalObservationRequired: true,
            redispatchAfterUncertain: false,
            ...(boundedNavigate
              ? {
                  dispatchMaximum: NAVIGATE_EXACT_DISPATCH_COUNT,
                  requiredArgumentConstraintIds: Object.freeze([NAVIGATE_ARGUMENT_CONSTRAINT_ID]),
                }
              : {}),
            ...(spec.kind === 'emergency_stop'
              ? {
                  safetyAction: 'emergency_stop',
                  explicitUnambiguousIntentRequired: true,
                  ambiguousModelOutput: 'forbidden',
                }
              : {}),
          },
    ),
  });
  const outcomeSpecification = Object.freeze({
    ...outcomeBase,
    specificationHash: `sha256:${sha256(stableStringify(outcomeBase))}`,
  });
  const skill = Object.freeze({
    skillId: spec.skillId,
    version,
    ...(version === INITIAL_GOVERNANCE_VERSION ? {} : { previousVersion: version - 1 }),
    name: spec.name,
    summary: spec.summary,
    description: `${spec.summary} This exact version uses current Binding ${binding.bindingId} and live Tool ${spec.toolName}.`,
    capabilities: Object.freeze([spec.capabilityId]),
    workflowGuidance: readOnly
      ? `Invoke exactly ${spec.toolName} once for ${resourceId}; require normalized observation evidence and never invoke a side-effecting Tool.`
      : boundedNavigate
        ? `After explicit Plan confirmation, invoke ${spec.toolName} exactly ${String(NAVIGATE_EXACT_DISPATCH_COUNT)} times for ${resourceId}; every invocation must move ${NAVIGATE_EXACT_DIRECTION} by exactly ${String(NAVIGATE_EXACT_DISTANCE_PER_DISPATCH_METERS)} metres, bind its remote Task, and reach a terminal observation before the next dispatch. Never redispatch an uncertain command.`
        : `After explicit Plan confirmation, invoke exactly ${spec.toolName} once for ${resourceId}; bind the remote Task, observe progress, and accept only its terminal observation. Never redispatch an uncertain command.`,
    outputInstruction:
      'Return only schema-valid public SMPP output with the declared normalized evidence references.',
    inputSchema,
    outputSchema,
    toolPolicy: Object.freeze({
      required: Object.freeze([
        Object.freeze({ serverId: binding.localServerId, toolName: spec.toolName }),
      ]),
      optional: Object.freeze([]),
      forbidden: Object.freeze([
        Object.freeze({ serverId: binding.localServerId, toolName: FIRE_TOOL_NAME }),
      ]),
    }),
    runtimePolicy: Object.freeze({
      autoConfirmPlan: false,
      maxReplans: 0,
      maxDurationSeconds: readOnly ? 60 : spec.kind === 'emergency_stop' ? 300 : 1800,
      maxLlmCalls: 0,
      maxMcpCalls: boundedNavigate ? NAVIGATE_EXACT_DISPATCH_COUNT : 1,
      cancelStrategy: readOnly ? 'wait_current' : 'try_interrupt',
      ...(readOnly ? {} : { pauseReplanThresholdSeconds: 0 }),
    }),
    outcomeSpecification,
    status: 'draft',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: CREATED_AT,
  });
  const usage = Object.freeze({
    visibility: Object.freeze({ userSelectable: true, composable: true, internalOnly: false }),
    normative: Object.freeze({
      constraints: Object.freeze([
        `Use only exact public SMPP resource ID ${resourceId}.`,
        `Require active, available, unexpired Provider Binding ${binding.bindingId} at revision ${String(binding.revision)}.`,
        `Use exact Skill ${spec.skillId}@${String(version)} and exact MCP Tool ${spec.toolName}.`,
        readOnly
          ? 'Require normalized observation evidence; MCP transport acceptance is not sufficient evidence.'
          : boundedNavigate
            ? `Dispatch exactly ${String(NAVIGATE_EXACT_DISPATCH_COUNT)} times in strict sequence; bind every remote Task and require progress plus terminal observation before its successor dispatch.`
            : 'Dispatch once only; bind the remote Task and require progress plus terminal observation before success.',
        ...(boundedNavigate
          ? [
              `Each ${NAVIGATE_TOOL_NAME} dispatch must use mission.type=distance, direction=${NAVIGATE_EXACT_DIRECTION}, and mission.distanceM=${String(NAVIGATE_EXACT_DISTANCE_PER_DISPATCH_METERS)} metres; the confirmed Task must contain exactly ${String(NAVIGATE_EXACT_DISPATCH_COUNT)} sequential dispatches totalling ${String(NAVIGATE_EXACT_TOTAL_DISTANCE_METERS)} metres.`,
            ]
          : []),
      ]),
      forbiddenActions: Object.freeze([
        `Invoke ${FIRE_TOOL_NAME} or create a fire/weapon Capability.`,
        'Use a Tool alias, a different Provider Binding, or a different public resource.',
        'Expose downstream Device MCP fields, MQTT topics, simulator-internal identifiers or credentials.',
        ...(readOnly
          ? ['Invoke any side-effecting Tool.']
          : [
              'Auto-confirm a Plan or dispatch before explicit Plan confirmation.',
              'Redispatch a physical command after an uncertain or unreachable response.',
              ...(boundedNavigate
                ? [
                    `Dispatch ${NAVIGATE_TOOL_NAME} with any direction or distance outside the frozen ${String(NAVIGATE_EXACT_DISPATCH_COUNT)} × ${String(NAVIGATE_EXACT_DISTANCE_PER_DISPATCH_METERS)} metre ${NAVIGATE_EXACT_DIRECTION} sequence, or dispatch a successor before its predecessor is terminal.`,
                  ]
                : []),
            ]),
        ...(spec.kind === 'emergency_stop'
          ? ['Trigger emergency stop from ambiguous, inferred or resource-less model output.']
          : []),
      ]),
      requiredConfirmations: Object.freeze(confirmation),
      noApplicableSkill: 'reject',
    }),
    contextRequirements: Object.freeze([
      Object.freeze({
        requirementId: 'public-resource-id',
        description: `Exact public SMPP resourceId ${resourceId}.`,
        required: true,
        sourceOrder: Object.freeze(['authoritative_context', 'user_input']),
      }),
      Object.freeze({
        requirementId: 'provider-binding-freshness',
        description: 'The exact Provider Binding must remain active, available and unexpired.',
        required: true,
        sourceOrder: Object.freeze(['authoritative_context']),
      }),
      ...(spec.kind === 'emergency_stop'
        ? [
            Object.freeze({
              requirementId: 'explicit-emergency-stop-intent',
              description:
                'Explicit unambiguous emergency-stop intent for the exact public resource.',
              required: true,
              sourceOrder: Object.freeze(['user_input']),
            }),
          ]
        : []),
    ]),
    taskBindings: Object.freeze(
      Array.from({ length: boundedNavigate ? NAVIGATE_EXACT_DISPATCH_COUNT : 1 }, (_, index) =>
        Object.freeze({
          bindingId: boundedNavigate
            ? `task-binding-${spec.skillId}-v${String(version)}-dispatch-${String(index + 1)}`
            : `task-binding-${spec.skillId}-v${String(version)}`,
          taskType: spec.toolName,
          providerPolicy: Object.freeze({
            selection: 'required',
            preferredProviderIds: Object.freeze([]),
            requiredProviderId: binding.localServerId,
            forbiddenProviderIds: Object.freeze([]),
            requiredAttributes: Object.freeze([
              `task_behavior:${tool.taskExecutionProfile.taskBehavior}`,
              `effect:${tool.executionSemantics.effect}`,
              `execution:${tool.executionSemantics.execution}`,
              `catalog_checksum:${binding.catalogChecksum}`,
            ]),
          }),
        }),
      ),
    ),
    adaptive: Object.freeze({
      instructions: Object.freeze([
        'Preserve the exact Provider Binding, Tool, Skill version, resource and terminal-evidence policy.',
      ]),
      optimizationHints: Object.freeze([]),
      allowPreferredProviderFallback: false,
    }),
    modes: Object.freeze({
      supported: Object.freeze(['procedure']),
      defaultMode: 'procedure',
      procedure: Object.freeze({
        summary: readOnly
          ? 'Deterministic exact-version UGV read-only execution.'
          : 'Plan-confirmed exact-version UGV remote Task execution.',
        instructions: Object.freeze([
          readOnly
            ? 'Validate the exact resource and current Binding, invoke once, and require normalized observation evidence.'
            : boundedNavigate
              ? `Validate explicit confirmation and current authority, then dispatch exactly ${String(NAVIGATE_EXACT_DISPATCH_COUNT)} ${NAVIGATE_EXACT_DIRECTION} distance missions of ${String(NAVIGATE_EXACT_DISTANCE_PER_DISPATCH_METERS)} metres in strict sequence; require terminal evidence before each successor dispatch.`
              : 'Validate explicit confirmation and current authority, dispatch once, bind the remote Task, observe progress, and require terminal evidence.',
        ]),
      }),
    }),
    evidence: Object.freeze({
      requirements: Object.freeze(
        spec.evidence.map((evidenceType, index) =>
          Object.freeze({
            requirementId: `evidence-${String(index + 1)}`,
            evidenceType,
            required: true,
            hardGate: true,
          }),
        ),
      ),
      rejectSuccessWithoutRequiredEvidence: true,
    }),
  });
  return Object.freeze({ skill, usage });
}

function buildCapability(
  spec: GovernanceSpec,
  binding: Binding,
  tool: Tool,
  resourceId: string,
  capabilityVersion: number,
  skillVersion: number,
): NodeCapabilityDefinitionVersion {
  const readOnly = spec.kind === 'read_only';
  return createNodeCapabilityDefinition({
    capabilityId: spec.capabilityId,
    version: capabilityVersion,
    ...(capabilityVersion === INITIAL_GOVERNANCE_VERSION
      ? {}
      : { previousVersion: capabilityVersion - 1 }),
    domain: 'vehicle.ugv',
    name: spec.name,
    description: spec.summary,
    inputSchema: requireObjectSchema(tool.inputSchema, 'MCP_TOOL_INPUT_SCHEMA_INVALID'),
    outputSchema: requireObjectSchema(tool.outputSchema, 'MCP_TOOL_OUTPUT_SCHEMA_INVALID'),
    successCriteria: [
      Object.freeze({ type: 'output_schema_valid', required: true }),
      Object.freeze({ type: 'resource_identity_matches_request', required: true }),
      Object.freeze({ type: 'required_evidence_complete', required: true }),
      Object.freeze({ type: 'mcp_acceptance_is_terminal_success', value: false }),
      ...(readOnly
        ? [Object.freeze({ type: 'normalized_observation_present', required: true })]
        : [
            Object.freeze({ type: 'remote_task_identity_present', required: true }),
            Object.freeze({ type: 'remote_terminal_observation_present', required: true }),
            Object.freeze({
              type: 'external_command_dispatch_count',
              ...(spec.toolName === NAVIGATE_TOOL_NAME
                ? { minimum: NAVIGATE_EXACT_DISPATCH_COUNT }
                : {}),
              maximum: boundedDispatchMaximum(spec),
            }),
          ]),
    ],
    requiredEvidence: spec.evidence.map((evidenceType) =>
      Object.freeze({ type: 'required_evidence', evidenceType, required: true, hardGate: true }),
    ),
    effects: [effectFor(spec)],
    artifacts: [],
    constraints: [
      Object.freeze({
        type: 'resource_policy',
        identifierAuthority: 'public_smpp_tool_schema',
        selection: 'exact_value',
        allowedResourceIds: Object.freeze([resourceId]),
        downstreamResourceBinding: 'forbidden',
      }),
      providerBindingConstraint(binding, tool, resourceId),
      Object.freeze({
        type: 'exact_skill_version',
        skillId: spec.skillId,
        skillVersion,
        taskType: spec.toolName,
      }),
      Object.freeze({
        type: 'confirmation_policy',
        required: !readOnly,
        stage: readOnly ? 'not_applicable' : 'before_execution',
        autoConfirmPlan: false,
      }),
      ...(readOnly
        ? [Object.freeze({ type: 'side_effect_policy', sideEffecting: false })]
        : [
            Object.freeze({
              type: 'physical_side_effect_policy',
              sideEffecting: true,
              allowEnvironment: 'ALLOW_REAL_UGV_SIDE_EFFECTS',
              runIdEnvironment: 'REAL_UGV_TEST_RUN_ID',
              dispatchMaximum: boundedDispatchMaximum(spec),
              uncertainDispatchPolicy: 'reconcile_never_redispatch',
              remoteTaskTerminalEvidenceRequired: true,
            }),
          ]),
      ...(spec.toolName === NAVIGATE_TOOL_NAME ? [boundedMovementConstraint()] : []),
      ...(spec.kind === 'emergency_stop'
        ? [
            Object.freeze({
              type: 'emergency_stop_policy',
              targetResourceId: resourceId,
              explicitUnambiguousIntentRequired: true,
              ambiguousModelOutput: 'forbidden',
              inferredResource: 'forbidden',
              currentBindingRequired: true,
              stoppedObservationRequired: true,
            }),
          ]
        : []),
    ],
    supportedModes: readOnly ? ['deterministic'] : ['plan_confirmed', 'remote_task'],
    riskLevel: riskFor(spec.kind),
    status: 'draft',
    createdBy: 'ugv-smpp-capability-governance-driver',
    createdAt: CREATED_AT,
  });
}

function boundedMovementConstraint(): JsonObject {
  return Object.freeze({
    type: 'bounded_movement_policy',
    constraintId: NAVIGATE_ARGUMENT_CONSTRAINT_ID,
    toolName: NAVIGATE_TOOL_NAME,
    missionType: 'distance',
    missionTypeArgumentPath: Object.freeze(['mission', 'type']),
    directionArgumentPath: Object.freeze(['mission', 'direction']),
    distanceArgumentPath: Object.freeze(['mission', 'distanceM']),
    allowedDirections: Object.freeze(['backward', 'forward', 'left', 'right']),
    exclusiveMinimum: 0,
    maximumInclusive: NAVIGATE_EXACT_DISTANCE_PER_DISPATCH_METERS,
    unit: 'm',
    scope: 'per_dispatch',
    exactDirection: NAVIGATE_EXACT_DIRECTION,
    exactDistancePerDispatch: NAVIGATE_EXACT_DISTANCE_PER_DISPATCH_METERS,
    exactDispatchCount: NAVIGATE_EXACT_DISPATCH_COUNT,
    exactTotalDistance: NAVIGATE_EXACT_TOTAL_DISTANCE_METERS,
    strictSequential: true,
    terminalBeforeNext: true,
  });
}

function boundedDispatchMaximum(spec: GovernanceSpec): number {
  return spec.toolName === NAVIGATE_TOOL_NAME ? NAVIGATE_EXACT_DISPATCH_COUNT : 1;
}

function buildImplementation(
  spec: GovernanceSpec,
  binding: Binding,
  tool: Tool,
  resourceId: string,
  capabilityVersion: number,
  skillVersion: number,
): CapabilityImplementationBinding {
  return Object.freeze({
    bindingId:
      capabilityVersion === skillVersion
        ? `capability-binding-${spec.capabilityId}-v${String(capabilityVersion)}`
        : `capability-binding-${spec.capabilityId}-cv${String(capabilityVersion)}-sv${String(skillVersion)}`,
    capabilityId: spec.capabilityId,
    capabilityVersion,
    implementationType: 'skill',
    implementationId: spec.skillId,
    implementationVersion: String(skillVersion),
    role: 'primary',
    priority: 0,
    providerPolicyOverride: Object.freeze({
      selection: 'required',
      mcpProviderBindingId: binding.bindingId,
      localServerId: binding.localServerId,
      mcpToolName: spec.toolName,
      allowedResourceIds: Object.freeze([resourceId]),
      requireActive: true,
      requireAvailable: true,
      requireUnexpiredFreshness: true,
      denyFallback: true,
    }),
    status: 'active',
    revision: 1,
  });
}

function providerBindingConstraint(binding: Binding, tool: Tool, resourceId: string) {
  return Object.freeze({
    type: 'provider_binding_policy',
    mcpProviderBindingId: binding.bindingId,
    localServerId: binding.localServerId,
    mcpToolName: tool.toolName,
    allowedResourceIds: Object.freeze([resourceId]),
    bindingRevision: binding.revision,
    registryRevision: binding.registryRevision,
    registryChecksum: binding.registryChecksum,
    catalogRevision: binding.catalogRevision,
    catalogChecksum: binding.catalogChecksum,
    taskBehavior: tool.taskExecutionProfile.taskBehavior,
    executionSemantics: executionSemantics(tool),
    requiredStatus: 'active',
    requiredAvailabilityStatus: 'available',
    requiredFreshness: 'unexpired',
    fallback: 'deny',
  });
}

function executionSemantics(tool: Tool) {
  return Object.freeze({
    effect: tool.executionSemantics.effect,
    execution: tool.executionSemantics.execution,
    cancellation: tool.executionSemantics.cancellation,
    idempotency: tool.executionSemantics.idempotency,
    replay: tool.executionSemantics.replay,
    source: tool.executionSemantics.source,
  });
}

function effectFor(spec: GovernanceSpec): string {
  if (spec.kind === 'read_only') return `effect.${spec.capabilityId}.observed`;
  if (spec.kind === 'emergency_stop') return 'effect.vehicle.ugv.stopped';
  return `effect.${spec.capabilityId}.commanded`;
}

function riskFor(kind: GovernanceKind): 'low' | 'medium' | 'high' {
  return kind === 'read_only' ? 'low' : kind === 'emergency_stop' ? 'high' : 'medium';
}

async function evaluateCapabilityReadiness(
  targets: readonly PreparedGovernance[],
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  request: typeof fetch,
  pause: (milliseconds: number) => Promise<void>,
): Promise<ReadonlyMap<string, z.infer<typeof ReadinessSchema>>> {
  const completed = new Map<string, z.infer<typeof ReadinessSchema>>();
  let pending = [...targets];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const next: PreparedGovernance[] = [];
    for (const item of pending) {
      const operation = OperationSchema.parse(
        await controlCommand(
          configuration,
          `/api/v1/capability-readiness/${encodeURIComponent(item.spec.capabilityId)}/${String(item.capabilityVersion)}/evaluate`,
          runKey(
            configuration.runId,
            `capability-readiness-${String(attempt)}`,
            `${item.spec.capabilityId}@${String(item.capabilityVersion)}`,
          ),
          {
            reason: `Evaluate exact current Runtime readiness for ${item.spec.capabilityId}@${String(item.capabilityVersion)}.`,
          },
          request,
        ),
      );
      const snapshot = ReadinessSchema.parse(operation.result);
      const exact =
        snapshot.capabilityId === item.spec.capabilityId &&
        snapshot.capabilityVersion === item.capabilityVersion &&
        snapshot.availableImplementations.length === 1 &&
        snapshot.availableImplementations[0] === item.implementation.bindingId &&
        snapshot.unavailableImplementations.length === 0;
      if (snapshot.status === 'available' && exact) {
        completed.set(item.spec.capabilityId, snapshot);
        continue;
      }
      const reasons = snapshot.reasons ?? [];
      if (
        snapshot.status === 'unavailable' &&
        exact &&
        reasons.some(({ code }) => code === 'READINESS_STABILITY_WINDOW') &&
        reasons.every(({ severity }) => severity !== 'blocking')
      ) {
        next.push(item);
        continue;
      }
      fail('CAPABILITY_READINESS_NOT_EXACT', 'Capability readiness is not exact and available.');
    }
    if (next.length === 0) return completed;
    if (attempt === 2)
      fail(
        'CAPABILITY_READINESS_STABILITY_TIMEOUT',
        'Capability readiness did not leave its bounded stability window.',
      );
    await pause(10_250);
    pending = next;
  }
  return fail('CAPABILITY_READINESS_MISSING', 'Capability readiness was not recorded.');
}

async function materializeSkillPackage(
  workspaceRoot: string,
  spec: Readonly<{ skillId: string; name: string; summary: string }>,
  skill: Readonly<Record<string, unknown>>,
  usage: Readonly<Record<string, unknown>>,
  version: number,
): Promise<Readonly<{ packageRoot: string; packageChecksum: string }>> {
  const packageRoot = join(workspaceRoot, spec.skillId, `v${String(version)}`);
  await mkdir(packageRoot, { recursive: true });
  const markdown = `# ${spec.name}\n\n${spec.summary}\n\nThis exact version is generated from the current governed SMPP Binding and public Tool contract. It never authorizes vehicle_fire_weapon.\n`;
  const files = Object.freeze({
    'SKILL.md': markdown,
    'normative.json': stablePretty({
      visibility: usage['visibility'],
      normative: usage['normative'],
      contextRequirements: usage['contextRequirements'],
      taskBindings: usage['taskBindings'],
    }),
    'adaptive.json': stablePretty({ adaptive: usage['adaptive'] }),
    'modes.json': stablePretty(usage['modes']),
    'evidence.json': stablePretty(usage['evidence']),
  });
  const declarations = Object.freeze({
    normative: Object.freeze({ path: 'normative.json', sha256: sha256(files['normative.json']) }),
    adaptive: Object.freeze({ path: 'adaptive.json', sha256: sha256(files['adaptive.json']) }),
    modes: Object.freeze({ path: 'modes.json', sha256: sha256(files['modes.json']) }),
    evidence: Object.freeze({ path: 'evidence.json', sha256: sha256(files['evidence.json']) }),
  });
  const manifest = stablePretty({
    apiVersion: 'sdar.io/v1alpha1',
    kind: 'SkillPackage',
    skill,
    skillMarkdownSha256: sha256(markdown),
    files: declarations,
  });
  const allFiles = Object.freeze({ ...files, 'manifest.json': manifest });
  for (const [name, contents] of Object.entries(allFiles))
    await writeFile(join(packageRoot, name), contents, { encoding: 'utf8', mode: 0o600 });
  const checksums = Object.entries(allFiles)
    .map(([name, contents]) => [name, sha256(contents)] as const)
    .sort(([left], [right]) => compare(left, right));
  return Object.freeze({
    packageRoot,
    packageChecksum: sha256(
      checksums.map(([name, checksum]) => `${name}\u0000${checksum}`).join('\n'),
    ),
  });
}

async function runtimeGetSkill(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  skillId: string,
  version: number,
  request: typeof fetch,
): Promise<z.infer<typeof RuntimeSkillSchema> | undefined> {
  const response = await request(
    `${configuration.runtimeManagementBaseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/versions/${String(version)}`,
    { redirect: 'manual' },
  );
  if (response.status === 404) return undefined;
  return RuntimeSkillSchema.parse(await responseJson(response, 200));
}

async function runtimeListSkillVersions(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  skillId: string,
  request: typeof fetch,
): Promise<readonly z.infer<typeof RuntimeSkillSchema>[]> {
  const response = await request(
    `${configuration.runtimeManagementBaseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/versions`,
    { redirect: 'manual' },
  );
  if (response.status === 404) return Object.freeze([]);
  return Object.freeze(
    z
      .object({ items: z.array(RuntimeSkillSchema) })
      .loose()
      .parse(await responseJson(response, 200)).items,
  );
}

async function controlGetCapability(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  capabilityId: string,
  version: number,
  request: typeof fetch,
): Promise<NodeCapabilityDefinitionVersion | undefined> {
  const response = await request(
    `${configuration.nodeControlBaseUrl}/api/v1/node-capabilities/${encodeURIComponent(capabilityId)}/versions/${String(version)}`,
    {
      headers: { authorization: `Bearer ${configuration.nodeControlBearerToken}` },
      redirect: 'manual',
    },
  );
  if (response.status === 404) return undefined;
  return CapabilitySchema.parse(
    await responseJson(response, 200),
  ) as NodeCapabilityDefinitionVersion;
}

async function controlListCapabilities(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  request: typeof fetch,
): Promise<readonly NodeCapabilityDefinitionVersion[]> {
  const value = await controlGet(configuration, '/api/v1/node-capabilities?pageSize=200', request);
  return Object.freeze(
    z
      .object({ items: z.array(CapabilitySchema) })
      .loose()
      .parse(value).items as NodeCapabilityDefinitionVersion[],
  );
}

async function controlGetImplementations(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  capabilityId: string,
  version: number,
  request: typeof fetch,
): Promise<readonly CapabilityImplementationBinding[]> {
  const body = z
    .object({ items: z.array(ImplementationSchema) })
    .loose()
    .parse(
      await controlGet(
        configuration,
        `/api/v1/node-capabilities/${encodeURIComponent(capabilityId)}/versions/${String(version)}/implementations?pageSize=100`,
        request,
      ),
    );
  return Object.freeze(body.items as CapabilityImplementationBinding[]);
}

function assertRuntimeSkillExact(
  actual: z.infer<typeof RuntimeSkillSchema>,
  skill: Readonly<Record<string, unknown>>,
  usage: Readonly<Record<string, unknown>>,
  expectedStatus: 'draft' | 'enabled',
): void {
  const exact = {
    ...skill,
    status: expectedStatus,
    usageSpecification: expectedRuntimeUsage(usage),
  };
  for (const [key, value] of Object.entries(exact))
    if (stableStringify(actual[key]) !== stableStringify(value))
      fail('SKILL_EXACT_VERSION_DRIFT', `Existing exact Skill version drifted at ${key}.`);
}

function assertRuntimeSkillContentExact(
  actual: z.infer<typeof RuntimeSkillSchema>,
  skill: Readonly<Record<string, unknown>>,
  usage: Readonly<Record<string, unknown>>,
): void {
  if (!runtimeSkillContentMatches(actual, skill, usage))
    fail('SKILL_EXACT_VERSION_DRIFT', 'Existing exact Skill version content drifted.');
}

function runtimeSkillContentMatches(
  actual: z.infer<typeof RuntimeSkillSchema>,
  skill: Readonly<Record<string, unknown>>,
  usage: Readonly<Record<string, unknown>>,
): boolean {
  const exact = {
    ...Object.fromEntries(Object.entries(skill).filter(([key]) => key !== 'status')),
    usageSpecification: expectedRuntimeUsage(usage),
  };
  return Object.entries(exact).every(
    ([key, value]) => stableStringify(actual[key]) === stableStringify(value),
  );
}

function assertGovernedSkillExact(
  actual: z.infer<typeof GovernedSkillSchema>,
  skill: Readonly<Record<string, unknown>>,
  usage: Readonly<Record<string, unknown>>,
  version: number,
  expectedStatus: 'validated' | 'published',
): void {
  const toolPolicy = skill['toolPolicy'];
  const outcome = skill['outcomeSpecification'];
  if (
    actual.skillId !== skill['skillId'] ||
    String(actual.version) !== String(version) ||
    actual.status !== expectedStatus ||
    !isRecord(toolPolicy) ||
    !isRecord(outcome) ||
    stableStringify(actual.inputSchema) !== stableStringify(skill['inputSchema']) ||
    stableStringify(actual.outputSchema) !== stableStringify(skill['outputSchema']) ||
    stableStringify(actual.providerPolicy['required']) !==
      stableStringify(toolPolicy['required']) ||
    stableStringify(actual.providerPolicy['optional']) !==
      stableStringify(toolPolicy['optional']) ||
    stableStringify(actual.providerPolicy['forbidden']) !==
      stableStringify(toolPolicy['forbidden']) ||
    stableStringify(actual.evidencePolicy['requiredEvidence']) !==
      stableStringify(outcome['evidence']) ||
    stableStringify(actual.outcomeSpecification) !== stableStringify(outcome) ||
    stableStringify(actual.usageSpecification) !== stableStringify(expectedRuntimeUsage(usage))
  )
    fail('SKILL_GOVERNANCE_PROJECTION_DRIFT', 'Governed Skill projection is not exact.');
}

function expectedRuntimeUsage(
  usage: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    apiVersion: 'sdar.io/v1alpha1',
    visibility: usage['visibility'],
    normative: usage['normative'],
    contextRequirements: usage['contextRequirements'],
    taskBindings: usage['taskBindings'],
    adaptive: usage['adaptive'],
    modes: usage['modes'],
    evidencePolicy: usage['evidence'],
  });
}

function assertCapabilityExact(
  actual: NodeCapabilityDefinitionVersion,
  expected: NodeCapabilityDefinitionVersion,
): void {
  if (
    actual.capabilityId !== expected.capabilityId ||
    actual.version !== expected.version ||
    actual.definitionHash !== expected.definitionHash
  )
    fail('CAPABILITY_DEFINITION_DRIFT', 'Existing Capability business promises are not exact.');
  if (['suspended', 'deprecated', 'retired'].includes(actual.status))
    fail('CAPABILITY_LIFECYCLE_INVALID', 'Existing Capability is suspended or terminal.');
}

function capabilityMatches(
  actual: NodeCapabilityDefinitionVersion,
  expected: NodeCapabilityDefinitionVersion,
): boolean {
  return (
    actual.capabilityId === expected.capabilityId &&
    actual.version === expected.version &&
    actual.definitionHash === expected.definitionHash
  );
}

function maxByVersion<T extends Readonly<{ version: number }>>(
  values: readonly T[],
): T | undefined {
  return values.reduce<T | undefined>(
    (latest, value) => (latest === undefined || value.version > latest.version ? value : latest),
    undefined,
  );
}

function assertImplementationExact(
  actual: CapabilityImplementationBinding,
  expected: CapabilityImplementationBinding,
): void {
  if (stableStringify(actual) !== stableStringify(expected))
    fail(
      'CAPABILITY_IMPLEMENTATION_DRIFT',
      'Capability implementation must retain the exact Skill, Tool and Catalog authority.',
    );
}

function runtimeCatalogChecksum(server: RuntimeServer, tools: readonly Tool[]): string {
  return hashConfigurationRequest(
    JSON.parse(
      JSON.stringify({
        protocolVersion: server.currentDiscovery.protocolVersion,
        serverInfo: server.currentDiscovery.serverInfo,
        tools: [...tools]
          .sort((left, right) => compare(left.toolName, right.toolName))
          .map((tool) => ({
            name: tool.toolName,
            title: tool.title ?? null,
            description: tool.description ?? null,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            protocolMode: tool.protocolMode,
            executionSemantics: tool.executionSemantics,
            taskExecutionProfile: tool.taskExecutionProfile,
          })),
      }),
    ) as JsonValue,
  );
}

async function controlGet(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
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
  configuration: UgvSmppCapabilityGovernanceConfiguration,
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

async function controlCommand(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.nodeControlBaseUrl}${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${configuration.nodeControlBearerToken}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    },
    202,
    request,
  );
}

async function controlCreate(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.nodeControlBaseUrl}${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${configuration.nodeControlBearerToken}`,
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

async function controlMutation(
  configuration: UgvSmppCapabilityGovernanceConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  ifMatch: string,
  expectedStatus: number,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.nodeControlBaseUrl}${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${configuration.nodeControlBearerToken}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        'if-match': ifMatch,
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    },
    expectedStatus,
    request,
  );
}

async function requestJson(
  url: string,
  init: RequestInit,
  expectedStatus: number,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(await request(url, init), expectedStatus);
}

async function responseJson(response: Response, expectedStatus: number): Promise<unknown> {
  if (response.status !== expectedStatus) {
    let code = `HTTP_${String(response.status)}`;
    try {
      const problem = z
        .object({ code: z.string().min(1) })
        .loose()
        .parse(await response.json());
      code = problem.code;
    } catch {
      // Provider and endpoint details in response bodies are deliberately not echoed.
    }
    return fail(
      code,
      `Governance HTTP request was rejected with status ${String(response.status)}.`,
    );
  }
  try {
    return await response.json();
  } catch {
    return fail('HTTP_RESPONSE_INVALID', 'Governance HTTP response was not JSON.');
  }
}

function validateConfiguration(
  input: UgvSmppCapabilityGovernanceConfiguration,
): UgvSmppCapabilityGovernanceConfiguration {
  const nodeControlBaseUrl = safeManagementBaseUrl(input.nodeControlBaseUrl);
  const runtimeManagementBaseUrl = safeManagementBaseUrl(input.runtimeManagementBaseUrl);
  if (input.nodeControlBearerToken.trim() === '')
    fail('DRIVER_CONFIGURATION_INVALID', 'Node Control bearer token is required.');
  if (input.runId.trim().length < 8 || input.runId.length > 128)
    fail('DRIVER_CONFIGURATION_INVALID', 'A bounded unique runId is required.');
  if (!isAbsolute(input.packageWorkspaceRoot))
    fail('DRIVER_CONFIGURATION_INVALID', 'Skill Package workspace root must be absolute.');
  if (
    input.activateNavigateControl !== undefined &&
    typeof input.activateNavigateControl !== 'boolean'
  )
    fail('DRIVER_CONFIGURATION_INVALID', 'Navigate activation must be an explicit boolean.');
  if (
    input.resourceId !== undefined &&
    (input.resourceId.trim() === '' || input.resourceId.length > 256)
  )
    fail(
      'DRIVER_CONFIGURATION_INVALID',
      'Configured resourceId must be a bounded non-empty value.',
    );
  return Object.freeze({
    ...input,
    nodeControlBaseUrl,
    runtimeManagementBaseUrl,
    packageWorkspaceRoot: resolve(input.packageWorkspaceRoot),
  });
}

function shouldPublishAuthority(
  spec: GovernanceSpec,
  configuration: UgvSmppCapabilityGovernanceConfiguration,
): boolean {
  return (
    spec.kind === 'read_only' ||
    (configuration.activateNavigateControl === true && spec.toolName === NAVIGATE_TOOL_NAME)
  );
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

function safeEndpoint(value: string, code: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(code, 'Provider endpoint must be absolute HTTP(S).');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '')
    fail(code, 'Provider endpoint must be credential-free HTTP(S).');
  url.hash = '';
  return url.toString();
}

function isLoopback(hostname: string): boolean {
  return ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(hostname.toLowerCase());
}

function requireFresh(validUntil: string, observedAt: string, code: string): void {
  if (Date.parse(validUntil) <= Date.parse(observedAt))
    fail(code, 'Persisted freshness has expired.');
}

function validTimestamp(value: string, code: string): string {
  if (!Number.isFinite(Date.parse(value))) return fail(code, 'Expected an RFC 3339 timestamp.');
  return value;
}

function requireObjectSchema(value: unknown, code: string): JsonObject {
  if (!isRecord(value)) return fail(code, 'Expected an object JSON Schema.');
  return Object.freeze(structuredClone(value)) as JsonObject;
}

function assertSafeReport(report: UgvSmppCapabilityGovernanceReport): void {
  const serialized = JSON.stringify(report);
  if (
    /https?:\/\//iu.test(serialized) ||
    /(?:"authorization"|"access[_-]?token"|"refresh[_-]?token"|"password"|"mqtt\/(?:topic|command)")/iu.test(
      serialized,
    )
  )
    fail('REPORT_REDACTION_FAILED', 'Governance report contains forbidden sensitive material.');
  if (serialized.includes(FIRE_CAPABILITY_ID) || serialized.includes(FIRE_SKILL_ID))
    fail('FIRE_GOVERNANCE_FORBIDDEN', 'The report implies a governed fire Capability or Skill.');
}

function stablePretty(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? value : undefined;
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string') &&
    [...value].sort(compare).join('\u0000') === [...expected].sort(compare).join('\u0000')
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runKey(runId: string, scope: string, identity: string): string {
  return `${runId}-${scope}-${sha256(identity).slice(0, 16)}`.slice(0, 256);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function fail(code: string, message: string): never {
  throw new UgvSmppCapabilityGovernanceError(code, message);
}

async function secretFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): Promise<string> {
  const inline = environment[name];
  const file = environment[`${name}_FILE`];
  if ((inline === undefined) === (file === undefined))
    fail('DRIVER_CONFIGURATION_INVALID', `Set exactly one of ${name} or ${name}_FILE.`);
  const value = (inline ?? (file === undefined ? '' : await readFile(file, 'utf8'))).trim();
  if (value === '') fail('DRIVER_CONFIGURATION_INVALID', `${name} is empty.`);
  return value;
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === '')
    return fail('DRIVER_CONFIGURATION_INVALID', `${name} is required.`);
  return value;
}

export async function ugvSmppGovernanceConfigurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<
  Readonly<{
    configuration: UgvSmppCapabilityGovernanceConfiguration;
    reportFile: string;
  }>
> {
  const configuredResource = environment['UGV_TEST_RESOURCE_ID']?.trim();
  const activateNavigateControl = explicitYes(environment, 'SDAR_UGV_ACTIVATE_NAVIGATE_CONTROL');
  return Object.freeze({
    configuration: Object.freeze({
      nodeControlBaseUrl: requiredEnvironment(environment, 'SDAR_NODE_CONTROL_BASE_URL'),
      nodeControlBearerToken: await secretFromEnvironment(environment, 'SDAR_CONTROL_API_TOKEN'),
      runtimeManagementBaseUrl: requiredEnvironment(
        environment,
        'SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL',
      ),
      packageWorkspaceRoot: requiredEnvironment(environment, 'SDAR_UGV_GOVERNANCE_PACKAGE_ROOT'),
      runId: requiredEnvironment(environment, 'SDAR_UGV_BOOTSTRAP_RUN_ID'),
      activateNavigateControl,
      ...(configuredResource === undefined || configuredResource === ''
        ? {}
        : { resourceId: configuredResource }),
    }),
    reportFile:
      environment['SDAR_UGV_GOVERNANCE_REPORT_FILE'] ??
      'reports/sdar-ugv-smpp-integration/capability-skill-governance.redacted.json',
  });
}

function explicitYes(environment: NodeJS.ProcessEnv, name: string): boolean {
  const value = environment[name]?.trim();
  if (value === undefined || value === '') return false;
  if (value !== 'YES')
    fail('DRIVER_CONFIGURATION_INVALID', `${name} must be exactly YES when configured.`);
  return true;
}

export async function writeRedactedUgvSmppGovernanceReport(
  reportFile: string,
  report: UgvSmppCapabilityGovernanceReport,
): Promise<void> {
  assertSafeReport(report);
  const target = resolve(reportFile);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, target);
}

async function main(): Promise<void> {
  try {
    const { configuration, reportFile } = await ugvSmppGovernanceConfigurationFromEnvironment();
    const report = await governUgvSmppCapabilities(configuration);
    await writeRedactedUgvSmppGovernanceReport(reportFile, report);
    process.stdout.write(
      `${JSON.stringify({ status: report.status, reportFile: resolve(reportFile) })}\n`,
    );
  } catch (error: unknown) {
    const code =
      error instanceof UgvSmppCapabilityGovernanceError
        ? error.code
        : 'UGV_SMPP_CAPABILITY_GOVERNANCE_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
