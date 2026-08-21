import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  resolveUgvProfileProviderSuccessOutputSchema,
  SkillPackageImporter,
  SkillPackageValidator,
} from '../../../packages/application/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import {
  MCP_UNAUTHENTICATED_CREDENTIAL_REF,
  SMPP_UNAUTHENTICATED_CREDENTIAL_REF,
  a2aExposureEtag,
  createA2aExposureVersion,
  createCapabilityImplementationBinding,
  createNodeCapabilityDefinition,
  nodeCapabilityEtag,
  type A2aExposureVersion,
  type CapabilityImplementationBinding,
  type JsonObject,
  type NodeCapabilityDefinitionVersion,
} from '../../../packages/node-control-domain/src/index.js';
import { NodeSkillPackageReader } from '../../../packages/skill-package-adapter/src/index.js';
import {
  materializeSmppProviders,
  SmppProviderMaterializationError,
  type SmppExpectedTool,
  type SmppProviderMaterializationReport,
} from './smpp-provider-materializer.js';
import {
  bootstrapUgvSmppSource,
  UgvSmppSourceBootstrapError,
  type UgvSmppSourceBootstrapConfiguration,
  type UgvSmppSourceBootstrapReport,
} from './ugv-smpp-source-bootstrap-driver.js';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const PREFIXED_CHECKSUM = /^sha256:[a-f0-9]{64}$/u;
const RUN_ID = /^[a-z0-9][a-z0-9._-]{7,95}$/u;
const SIMULATION_ID = /^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u;
const EXPECTED_PACKAGE_CHECKSUM =
  '6d5fc9c8e093de18a8b11c8377b96788336606b25d0df0f27efef7b4d9f6a48c';
const EXPECTED_SOURCE_ENDPOINT =
  'http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/smpp-source-ugv1-uap-p3-b01/latest';
const EXPECTED_NATIVE_REGISTRY_ENDPOINT =
  'http://127.0.0.1:18092/api/v1/registry/simulation/latest';
const EXPECTED_PROVIDER_ENDPOINT = 'http://127.0.0.1:19131/mcp';
const EXPECTED_NODE_CONTROL_BASE_URL = 'http://127.0.0.1:10091';
const EXPECTED_RUNTIME_MANAGEMENT_BASE_URL = 'http://127.0.0.1:10998';
const EXPECTED_PROFILE_A2A_BASE_URL = 'http://127.0.0.1:10999';
const EXPECTED_SOURCE_ID = 'smpp-source-ugv1-uap-p3-b01';
const EXPECTED_LOCAL_SERVER_ID = 'ugv-smpp-uap-p3-b01';
const EXPECTED_BINDING_ID = 'ugv-smpp-uap-p3-b01-binding';
const EXPECTED_PROVIDER_DISPLAY_NAME = 'UGV Agent Profile external simulation';
const EXPECTED_PROVIDER_ID = 'isr.vehicle.ugv.ugv1';
const EXPECTED_EXTERNAL_SERVER_ID = 'uap-p3-b01-runtime-1';
const EXPECTED_RESOURCE_ID = 'vehicle:ugv1';
const SKILL_ID = 'embodied.move_to';
const CAPABILITY_ID = 'embodied.move';
const EXPOSURE_ID = 'a2a.embodied.move';
const IMPLEMENTATION_BINDING_ID = 'capability-binding-embodied.move-v1';
const NAVIGATE_TOOL = 'vehicle_navigate';
const TOOL_NAMES = Object.freeze([
  'vehicle_area_recon',
  'vehicle_control_gimbal',
  'vehicle_emergency_stop',
  'vehicle_fire_weapon',
  'vehicle_get_capabilities',
  'vehicle_get_payload_status',
  'vehicle_get_state',
  'vehicle_get_targets',
  NAVIGATE_TOOL,
  'vehicle_track_target',
] as const);

export type UgvAgentProfileAuthorityMode = 'bootstrap' | 'verify' | 'readiness';

export interface UgvAgentProfileAuthorityBootstrapConfiguration {
  readonly mode: UgvAgentProfileAuthorityMode;
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly runtimeManagementBaseUrl: string;
  readonly profileA2aBaseUrl: string;
  readonly skillPackageRoot: string;
  readonly runId: string;
  readonly simulationRunId: string;
  readonly source: Omit<
    UgvSmppSourceBootstrapConfiguration,
    'nodeControlBaseUrl' | 'nodeControlAdminToken' | 'runId'
  >;
  readonly localServerId: string;
  readonly providerBindingId: string;
  readonly providerDisplayName: string;
  readonly runtimeCredentialRef: string;
}

export interface UgvAgentProfileAuthorityBootstrapReport {
  readonly schemaVersion: 'sdar.ugv-agent-profile-authority-bootstrap/v1';
  readonly status: 'passed';
  readonly mode: 'bootstrap' | 'verify';
  readonly evidenceClass: 'external_simulation';
  readonly productionEligible: false;
  readonly physicalVehicleQualified: false;
  readonly observedAt: string;
  readonly source: Readonly<{
    action: 'created' | 'reused' | 'verified';
    sourceIdentitySha256: string;
    registryRevision: number;
    registryChecksum: string;
  }>;
  readonly provider: Readonly<{
    action: 'created' | 'reconciled' | 'verified';
    bindingIdentitySha256: string;
    bindingRevision: number;
    catalogRevision: string;
    catalogChecksum: string;
    toolCount: 10;
    navigateReplay: 'simulation_only';
  }>;
  readonly skill: Readonly<{
    skillId: typeof SKILL_ID;
    version: 1;
    runtimeStatus: 'enabled';
    governedStatus: 'published';
    packageChecksum: typeof EXPECTED_PACKAGE_CHECKSUM;
    exactVersionCount: 1;
  }>;
  readonly capability: Readonly<{
    capabilityId: typeof CAPABILITY_ID;
    version: 1;
    status: 'published';
    definitionHash: string;
    implementationBindingId: typeof IMPLEMENTATION_BINDING_ID;
    implementationCount: 1;
    constraintCount: 7;
  }>;
  readonly readiness: Readonly<{
    status: 'available';
    snapshotVersion: number;
    snapshotHash: string;
    validUntil: string;
  }>;
  readonly exposure: Readonly<{
    exposureId: typeof EXPOSURE_ID;
    version: 1;
    agentSkillId: typeof SKILL_ID;
    status: 'published';
    exposureHash: string;
    exactExposureCount: 1;
  }>;
  readonly managedCard: Readonly<{
    authority: 'node_control_exposure';
    distinctFromProfilePublicCard: true;
    status: 'active';
    revision: number;
    exposureRefs: readonly [`${typeof EXPOSURE_ID}:1`];
    contentHash: string;
    capabilityCatalogHash: string;
  }>;
  /** Declarative ownership metadata; public endpoint observation is proven only in readiness. */
  readonly profilePublicCard: Readonly<{
    authority: 'enabled_skill_version';
    managedCardUsed: false;
    sourceSkillRef: `${typeof SKILL_ID}:1`;
  }>;
  readonly driverActivity: Readonly<{
    navigationDispatchCount: 0;
    forbiddenOperationCallCount: 0;
    fireInvocationCount: 0;
    modelInvocationCount: 0;
    providerToolCallCount: 0;
  }>;
  readonly redaction: Readonly<{
    secretsIncluded: false;
    credentialReferencesIncluded: false;
    endpointsIncluded: false;
  }>;
}

export interface UgvAgentProfileAuthorityReadinessReport {
  readonly schemaVersion: 'sdar.ugv-agent-profile-authority-readiness/v1';
  readonly status: 'passed';
  readonly mode: 'readiness';
  readonly evidenceClass: 'external_simulation';
  readonly productionEligible: false;
  readonly physicalVehicleQualified: false;
  readonly observedAt: string;
  readonly skillLifecycle: Readonly<{
    skillId: typeof SKILL_ID;
    version: 1;
    beforeRevision: number;
    suspendedRevision: number;
    restoredRevision: number;
    finalGovernedStatus: 'published';
    exactVersionCount: 1;
  }>;
  readonly profilePublicCardLifecycle: Readonly<{
    authority: 'CapabilityCardPublisher';
    managedCardUsed: false;
    sourceSkillRef: 'embodied.move_to:1';
    before: Readonly<{
      exactSkillCount: 1;
      totalSkillCount: 1;
      capabilityCount: 2;
      managementContentHash: string;
      a2aContentHash: string;
    }>;
    suspended: Readonly<{
      exactSkillCount: 0;
      totalSkillCount: 0;
      capabilityCount: 0;
      managementContentHash: string;
      a2aContentHash: string;
    }>;
    restored: Readonly<{
      exactSkillCount: 1;
      totalSkillCount: 1;
      capabilityCount: 2;
      managementContentHash: string;
      a2aContentHash: string;
    }>;
    semanticRestored: true;
  }>;
  readonly managedCardSeparation: Readonly<{
    authority: 'node_control_exposure';
    exposureRef: `${typeof EXPOSURE_ID}:1`;
    revision: number;
    contentHash: string;
    unchangedAcrossSkillLifecycle: true;
  }>;
  readonly driverActivity: UgvAgentProfileAuthorityBootstrapReport['driverActivity'];
  readonly redaction: UgvAgentProfileAuthorityBootstrapReport['redaction'];
}

export interface UgvAgentProfileAuthorityBootstrapDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly bootstrapSource?: typeof bootstrapUgvSmppSource;
  readonly materializeProviders?: typeof materializeSmppProviders;
  readonly loadSkillPackage?: SkillPackageImporter['import'];
  readonly lifecycleSignals?: Readonly<{
    subscribe(listener: (signal: 'SIGINT' | 'SIGTERM') => void): () => void;
  }>;
}

export class UgvAgentProfileAuthorityBootstrapError extends Error {
  readonly code: string;
  readonly exitCode: number | undefined;

  constructor(code: string, message: string, exitCode?: number) {
    super(message);
    this.name = 'UgvAgentProfileAuthorityBootstrapError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

const BindingInventorySchema = z
  .object({
    bindingId: z.string().min(1),
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
  })
  .strict();
const BindingSchema = BindingInventorySchema.extend({
  availabilityValidUntil: z.iso.datetime(),
  catalogObservedAt: z.iso.datetime(),
  operationCount: z.number().int().nonnegative().max(1_024),
}).strict();
const RuntimeServerSchema = z
  .object({
    serverId: z.string().min(1),
    endpoint: z.string().min(1),
    protocolMode: z.literal('frozen_v1'),
    toolRevision: z.number().int().positive(),
    currentDiscovery: z
      .object({
        validUntil: z.iso.datetime(),
        toolRevision: z.number().int().positive(),
        serverInfo: z.record(z.string(), z.unknown()),
      })
      .loose(),
  })
  .loose();
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
    inputSchema: z.union([z.boolean(), z.record(z.string(), z.unknown())]),
    outputSchema: z.union([z.boolean(), z.record(z.string(), z.unknown())]),
    protocolMode: z.literal('frozen_v1'),
    executionSemantics: ExecutionSemanticsSchema,
    taskExecutionProfile: z
      .object({
        profileVersion: z.literal('1.0'),
        taskBehavior: z.enum(['synchronous_only', 'server_directed', 'task_required']),
        availability: z.enum(['not_supported', 'dynamic']),
        supportsScheduling: z.boolean(),
        supportsMaxElapsed: z.boolean(),
        supportsCancellation: z.boolean(),
        supportsPauseResume: z.boolean(),
        supportsObservations: z.boolean(),
        supportsInputRequired: z.boolean(),
        idempotency: z.enum(['none', 'client_request_key', 'server_managed', 'unknown']),
      })
      .loose(),
  })
  .loose();
const NativeTaskExecutionSchema = z
  .object({
    profileVersion: z.literal('1.0'),
    taskBehavior: z.enum(['synchronous_only', 'server_directed', 'task_required']),
    availability: z.enum(['not_supported', 'dynamic']),
    supportsScheduling: z.boolean(),
    supportsMaxElapsed: z.boolean(),
    supportsCancellation: z.boolean(),
    supportsPauseResume: z.boolean(),
    supportsObservations: z.boolean(),
    supportsInputRequired: z.boolean(),
    idempotency: z.enum(['server_managed', 'none']),
  })
  .strict();
const NativeToolSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    taskExecution: NativeTaskExecutionSchema,
    resourceBinding: z.unknown().optional(),
  })
  .strict();
const NativeRegistrySnapshotSchema = z
  .object({
    environment: z.literal('simulation'),
    revision: z.number().int().positive(),
    checksum: z.string().regex(CHECKSUM),
    document: z
      .object({
        environment: z.literal('simulation'),
        providers: z.array(
          z
            .object({
              providerId: z.string().min(1),
              serverId: z.string().min(1),
              protocolMode: z.literal('frozen_v1'),
              effectiveEndpoint: z.string().min(1),
              catalogRevision: z.number().int().positive(),
              tools: z.array(NativeToolSchema),
            })
            .strict(),
        ),
      })
      .strict(),
    publishedAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .strict();
const RuntimeSkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.number().int().positive(),
    status: z.enum(['draft', 'enabled', 'disabled', 'deprecated']),
    capabilities: z.array(z.string()),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    toolPolicy: z
      .object({
        required: z.array(z.unknown()),
        optional: z.array(z.unknown()),
        forbidden: z.array(z.unknown()),
      })
      .strict(),
    runtimePolicy: z.record(z.string(), z.unknown()),
    usageSpecification: z.record(z.string(), z.unknown()),
  })
  .loose();
const ControlSkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.union([z.string().min(1), z.number().int().positive()]),
    status: z.enum(['draft', 'validated', 'published', 'suspended', 'deprecated', 'retired']),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    usageSpecification: z.record(z.string(), z.unknown()).optional(),
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
const ReadinessSchema = z
  .object({
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    snapshotVersion: z.number().int().positive(),
    status: z.enum(['available', 'degraded', 'unavailable', 'suspended']),
    evaluatedAt: z.iso.datetime(),
    validUntil: z.iso.datetime(),
    catalogHash: z.string().regex(PREFIXED_CHECKSUM),
    policyHash: z.string().regex(PREFIXED_CHECKSUM),
    reasons: z.array(
      z
        .object({
          code: z.string().min(1),
          severity: z.enum(['info', 'warning', 'blocking']).optional(),
        })
        .loose(),
    ),
    availableImplementations: z.array(z.string()).optional(),
    unavailableImplementations: z.array(z.string()).optional(),
  })
  .loose();
const ExposureSchema = z
  .object({
    exposureId: z.string().min(1),
    version: z.number().int().positive(),
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    agentSkillId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    tags: z.array(z.string()).optional(),
    examples: z.array(z.string()).optional(),
    inputModes: z.array(z.string()).optional(),
    outputModes: z.array(z.string()).optional(),
    requestSchema: z.record(z.string(), z.unknown()),
    resultSchema: z.record(z.string(), z.unknown()),
    visibility: z.literal('public'),
    requesterPolicy: z.record(z.string(), z.unknown()).optional(),
    readinessPublicationPolicy: z
      .enum(['publish_when_available', 'publish_degraded', 'always_publish_with_status'])
      .optional(),
    status: z.enum(['draft', 'published', 'suspended', 'retired']),
    exposureHash: z.string().regex(CHECKSUM),
  })
  .strict();
const AgentCardRevisionSchema = z
  .object({
    revision: z.number().int().positive(),
    exposureRefs: z.array(z.string()).optional(),
    contentHash: z.string().regex(CHECKSUM),
    capabilityCatalogHash: z.string().regex(CHECKSUM),
    status: z.enum(['candidate', 'staged', 'active', 'rejected', 'superseded']),
    generatedAt: z.iso.datetime(),
  })
  .loose();
const OperationSchema = z
  .object({
    operationId: z.string().min(1),
    operationType: z.string().min(1),
    target: z.object({ type: z.string().min(1), id: z.string().min(1) }).loose(),
    status: z.literal('succeeded'),
    result: z.unknown().optional(),
    completedAt: z.iso.datetime().optional(),
  })
  .loose();
const SourceInventorySchema = z
  .object({
    smppSourceId: z.string().min(1),
    name: z.string().min(1).optional(),
    registryEndpoint: z.string().min(1),
    credentialRef: z.string().min(1),
    environment: z.string().min(1),
    syncMode: z.enum(['manual', 'poll', 'watch']),
    snapshotTtlSeconds: z.number().int().positive(),
    lkgPolicy: z.enum(['allow_unexpired', 'deny_when_unavailable']),
    status: z.enum(['draft', 'active', 'suspended', 'retired']),
    activeSnapshotRevision: z.number().int().positive().optional(),
    activeSnapshotChecksum: z.string().regex(CHECKSUM).optional(),
    activeSnapshotValidUntil: z.iso.datetime().optional(),
    revision: z.number().int().positive(),
  })
  .loose();
const CandidateInventorySchema = z
  .object({
    smppSourceId: z.string().min(1),
    externalProviderId: z.string().min(1),
    externalServerId: z.string().min(1),
    serverEndpoint: z.string().min(1),
    labels: z.object({ environment: z.string().min(1) }).loose(),
    registryRevision: z.number().int().positive(),
    registryChecksum: z.string().regex(CHECKSUM),
    catalogRevision: z.string().regex(/^[1-9][0-9]*$/u),
    registryValidUntil: z.iso.datetime(),
    nativeRegistryRevision: z.number().int().positive(),
    nativeRegistryChecksum: z.string().regex(CHECKSUM),
    registryProjectionContract: z.literal('sdar-registry-v1'),
  })
  .loose();

type Binding = z.infer<typeof BindingSchema>;
type RuntimeServer = z.infer<typeof RuntimeServerSchema>;
type Tool = z.infer<typeof ToolSchema>;
type NativeTool = z.infer<typeof NativeToolSchema>;
type RuntimeSkill = z.infer<typeof RuntimeSkillSchema>;
type Capability = z.infer<typeof CapabilitySchema>;
type Implementation = z.infer<typeof ImplementationSchema>;
type Readiness = z.infer<typeof ReadinessSchema>;
type Exposure = z.infer<typeof ExposureSchema>;
type AgentCardRevision = z.infer<typeof AgentCardRevisionSchema>;

interface PackageAuthority {
  readonly packageChecksum: typeof EXPECTED_PACKAGE_CHECKSUM;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly usageSpecification: Readonly<Record<string, unknown>>;
}

interface ProviderAuthority {
  readonly binding: Binding;
  readonly server: RuntimeServer;
  readonly tools: readonly Tool[];
  readonly navigate: Tool;
  readonly fingerprint: string;
}

interface NativeProviderAuthority {
  readonly revision: number;
  readonly checksum: string;
  readonly catalogRevision: number;
  readonly tools: readonly NativeTool[];
}

interface GovernanceAuthority {
  readonly skill: RuntimeSkill;
  readonly capability: Capability;
  readonly implementation: Implementation;
  readonly readiness: Readiness;
  readonly readinessHash: string;
  readonly exposure: Exposure;
  readonly managedCard: AgentCardRevision;
}

const READ_ONLY: SmppExpectedTool = Object.freeze({
  taskBehavior: 'synchronous_only',
  executionSemantics: Object.freeze({
    effect: 'read_only',
    execution: 'synchronous',
    cancellation: 'unsupported',
    idempotency: 'server_managed',
    replay: 'allowed',
  }),
});
const SIDE_EFFECT_FORBIDDEN_REPLAY: SmppExpectedTool = Object.freeze({
  taskBehavior: 'task_required',
  executionSemantics: Object.freeze({
    effect: 'side_effecting',
    execution: 'task_required',
    cancellation: 'task_cancel',
    idempotency: 'server_managed',
    replay: 'forbidden',
  }),
});
const PROFILE_NAVIGATE: SmppExpectedTool = Object.freeze({
  taskBehavior: 'task_required',
  executionSemantics: Object.freeze({
    effect: 'side_effecting',
    execution: 'task_required',
    cancellation: 'task_cancel',
    idempotency: 'server_managed',
    replay: 'simulation_only',
  }),
});
const PROFILE_TOOL_POLICY: Readonly<Record<(typeof TOOL_NAMES)[number], SmppExpectedTool>> =
  Object.freeze({
    vehicle_area_recon: SIDE_EFFECT_FORBIDDEN_REPLAY,
    vehicle_control_gimbal: SIDE_EFFECT_FORBIDDEN_REPLAY,
    vehicle_emergency_stop: SIDE_EFFECT_FORBIDDEN_REPLAY,
    vehicle_fire_weapon: SIDE_EFFECT_FORBIDDEN_REPLAY,
    vehicle_get_capabilities: READ_ONLY,
    vehicle_get_payload_status: READ_ONLY,
    vehicle_get_state: READ_ONLY,
    vehicle_get_targets: READ_ONLY,
    vehicle_navigate: PROFILE_NAVIGATE,
    vehicle_track_target: SIDE_EFFECT_FORBIDDEN_REPLAY,
  });

type ProfileTaskExecution = Readonly<{
  profileVersion: '1.0';
  taskBehavior: SmppExpectedTool['taskBehavior'];
  availability: 'dynamic';
  supportsScheduling: boolean;
  supportsMaxElapsed: boolean;
  supportsCancellation: boolean;
  supportsPauseResume: boolean;
  supportsObservations: boolean;
  supportsInputRequired: boolean;
  idempotency: 'server_managed';
}>;

function profileTaskExecution(
  taskBehavior: SmppExpectedTool['taskBehavior'],
  flags: Readonly<{
    scheduling: boolean;
    maxElapsed: boolean;
    cancellation: boolean;
    pauseResume: boolean;
    observations: boolean;
    inputRequired: boolean;
  }>,
): ProfileTaskExecution {
  return Object.freeze({
    profileVersion: '1.0',
    taskBehavior,
    availability: 'dynamic',
    supportsScheduling: flags.scheduling,
    supportsMaxElapsed: flags.maxElapsed,
    supportsCancellation: flags.cancellation,
    supportsPauseResume: flags.pauseResume,
    supportsObservations: flags.observations,
    supportsInputRequired: flags.inputRequired,
    idempotency: 'server_managed',
  });
}

const PROFILE_TASK_EXECUTION_POLICY: Readonly<
  Record<(typeof TOOL_NAMES)[number], ProfileTaskExecution>
> = Object.freeze({
  vehicle_area_recon: profileTaskExecution('task_required', {
    scheduling: true,
    maxElapsed: true,
    cancellation: true,
    pauseResume: true,
    observations: true,
    inputRequired: false,
  }),
  vehicle_control_gimbal: profileTaskExecution('task_required', {
    scheduling: false,
    maxElapsed: true,
    cancellation: true,
    pauseResume: false,
    observations: true,
    inputRequired: false,
  }),
  vehicle_emergency_stop: profileTaskExecution('task_required', {
    scheduling: false,
    maxElapsed: true,
    cancellation: false,
    pauseResume: false,
    observations: true,
    inputRequired: false,
  }),
  vehicle_fire_weapon: profileTaskExecution('task_required', {
    scheduling: false,
    maxElapsed: true,
    cancellation: true,
    pauseResume: false,
    observations: true,
    inputRequired: true,
  }),
  vehicle_get_capabilities: profileTaskExecution('synchronous_only', {
    scheduling: false,
    maxElapsed: false,
    cancellation: false,
    pauseResume: false,
    observations: false,
    inputRequired: false,
  }),
  vehicle_get_payload_status: profileTaskExecution('synchronous_only', {
    scheduling: false,
    maxElapsed: false,
    cancellation: false,
    pauseResume: false,
    observations: false,
    inputRequired: false,
  }),
  vehicle_get_state: profileTaskExecution('synchronous_only', {
    scheduling: false,
    maxElapsed: false,
    cancellation: false,
    pauseResume: false,
    observations: false,
    inputRequired: false,
  }),
  vehicle_get_targets: profileTaskExecution('synchronous_only', {
    scheduling: false,
    maxElapsed: false,
    cancellation: false,
    pauseResume: false,
    observations: false,
    inputRequired: false,
  }),
  vehicle_navigate: profileTaskExecution('task_required', {
    scheduling: true,
    maxElapsed: true,
    cancellation: true,
    pauseResume: true,
    observations: true,
    inputRequired: false,
  }),
  vehicle_track_target: profileTaskExecution('task_required', {
    scheduling: false,
    maxElapsed: true,
    cancellation: true,
    pauseResume: false,
    observations: true,
    inputRequired: false,
  }),
});

async function loadNativeProviderAuthority(
  observedAt: string,
  request: typeof fetch,
): Promise<NativeProviderAuthority> {
  const response = await request(EXPECTED_NATIVE_REGISTRY_ENDPOINT, {
    headers: { accept: 'application/json' },
    redirect: 'manual',
  });
  const snapshot = NativeRegistrySnapshotSchema.parse(await responseJson(response, 200));
  if (
    response.headers.get('etag') !== `"${snapshot.checksum}"` ||
    response.headers.get('cache-control') !== 'private, no-cache' ||
    snapshot.checksum !== sha256(canonical(snapshot.document)) ||
    Date.parse(snapshot.publishedAt) > Date.parse(snapshot.createdAt) ||
    Date.parse(snapshot.createdAt) > Date.parse(observedAt)
  )
    fail(
      'UAP_NATIVE_REGISTRY_AUTHORITY_INVALID',
      'The PMS native Registry body, checksum, timestamps, or headers are not exact.',
    );
  const provider = snapshot.document.providers[0];
  if (snapshot.document.providers.length !== 1 || provider === undefined)
    fail(
      'UAP_NATIVE_REGISTRY_PROVIDER_INVALID',
      'The PMS native Registry is not the exact sole UGV Provider Catalog.',
    );
  if (
    provider.providerId !== EXPECTED_PROVIDER_ID ||
    provider.serverId !== EXPECTED_EXTERNAL_SERVER_ID ||
    normalizedEndpoint(provider.effectiveEndpoint) !== EXPECTED_PROVIDER_ENDPOINT ||
    provider.tools.length !== TOOL_NAMES.length ||
    !sameStrings(
      provider.tools.map(({ name }) => name),
      TOOL_NAMES,
    )
  )
    fail(
      'UAP_NATIVE_REGISTRY_PROVIDER_INVALID',
      'The PMS native Registry is not the exact sole UGV Provider Catalog.',
    );
  for (const tool of provider.tools) assertNativeToolAuthority(tool);
  return Object.freeze({
    revision: snapshot.revision,
    checksum: snapshot.checksum,
    catalogRevision: provider.catalogRevision,
    tools: Object.freeze(provider.tools),
  });
}

function assertNativeToolAuthority(tool: NativeTool): void {
  const expected = Object.entries(PROFILE_TOOL_POLICY).find(
    ([toolName]) => toolName === tool.name,
  )?.[1];
  const expectedTaskExecution = Object.entries(PROFILE_TASK_EXECUTION_POLICY).find(
    ([toolName]) => toolName === tool.name,
  )?.[1];
  if (expected === undefined || expectedTaskExecution === undefined)
    fail(
      'UAP_NATIVE_REGISTRY_TOOL_PROFILE_INVALID',
      'A PMS native Tool task-execution profile differs from the exact Profile policy.',
    );
  const task = normalizedTaskExecution(tool.taskExecution);
  if (
    expected.taskBehavior !== expectedTaskExecution.taskBehavior ||
    canonical(task) !== canonical(expectedTaskExecution)
  )
    fail(
      'UAP_NATIVE_REGISTRY_TOOL_PROFILE_INVALID',
      'A PMS native Tool task-execution profile differs from the exact Profile policy.',
    );
  if (tool.name === NAVIGATE_TOOL) {
    assertNavigatePointSchema(tool.inputSchema);
    assertNavigateOutputSchema(tool.outputSchema);
  }
  if (tool.name === 'vehicle_get_state') {
    assertGetStateInputSchema(tool.inputSchema);
    assertGetStateOutputSchema(tool.outputSchema);
  }
}

function normalizedTaskExecution(
  value: Readonly<{
    profileVersion: string;
    taskBehavior: string;
    availability: string;
    supportsScheduling: boolean;
    supportsMaxElapsed: boolean;
    supportsCancellation: boolean;
    supportsPauseResume: boolean;
    supportsObservations: boolean;
    supportsInputRequired: boolean;
    idempotency: string;
  }>,
) {
  return Object.freeze({
    profileVersion: value.profileVersion,
    taskBehavior: value.taskBehavior,
    availability: value.availability,
    supportsScheduling: value.supportsScheduling,
    supportsMaxElapsed: value.supportsMaxElapsed,
    supportsCancellation: value.supportsCancellation,
    supportsPauseResume: value.supportsPauseResume,
    supportsObservations: value.supportsObservations,
    supportsInputRequired: value.supportsInputRequired,
    idempotency: value.idempotency,
  });
}

async function assertNativeSourceLineage(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  native: NativeProviderAuthority,
  request: typeof fetch,
): Promise<void> {
  const candidates = await controlCollection(
    configuration,
    `/api/v1/mcp-provider-candidates?smppSourceId=${encodeURIComponent(configuration.source.smppSourceId)}&pageSize=200`,
    CandidateInventorySchema,
    request,
  );
  const candidate = candidates[0];
  if (candidates.length !== 1 || candidate === undefined)
    fail(
      'UAP_NATIVE_REGISTRY_LINEAGE_INVALID',
      'The Source candidate does not retain exact PMS native Registry lineage.',
    );
  if (
    candidate.nativeRegistryRevision !== native.revision ||
    candidate.nativeRegistryChecksum !== native.checksum ||
    candidate.registryRevision !== native.revision ||
    Number(candidate.catalogRevision) !== native.catalogRevision
  )
    fail(
      'UAP_NATIVE_REGISTRY_LINEAGE_INVALID',
      'The Source candidate does not retain exact PMS native Registry lineage.',
    );
}

function assertRuntimeMatchesNative(
  runtimeTools: readonly Tool[],
  native: NativeProviderAuthority,
): void {
  if (
    runtimeTools.length !== native.tools.length ||
    !sameStrings(
      runtimeTools.map(({ toolName }) => toolName),
      native.tools.map(({ name }) => name),
    )
  )
    fail(
      'UAP_NATIVE_RUNTIME_CATALOG_DRIFT',
      'The materialized Runtime Tool set differs from PMS native authority.',
    );
  for (const nativeTool of native.tools) {
    const runtimeTool = runtimeTools.find(({ toolName }) => toolName === nativeTool.name);
    if (
      runtimeTool === undefined ||
      canonical(runtimeTool.inputSchema) !== canonical(nativeTool.inputSchema) ||
      canonical(runtimeTool.outputSchema) !== canonical(nativeTool.outputSchema) ||
      canonical(runtimeTool.taskExecutionProfile) !==
        canonical(normalizedTaskExecution(nativeTool.taskExecution))
    )
      fail(
        'UAP_NATIVE_RUNTIME_CATALOG_DRIFT',
        'The materialized Runtime schemas or Task profile differ from PMS native authority.',
      );
  }
}

export async function bootstrapUgvAgentProfileAuthority(
  input: UgvAgentProfileAuthorityBootstrapConfiguration,
  dependencies: UgvAgentProfileAuthorityBootstrapDependencies = {},
): Promise<UgvAgentProfileAuthorityBootstrapReport> {
  const configuration = validateConfiguration({ ...input, mode: 'bootstrap' });
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const pause = dependencies.delay ?? delay;
  const packageAuthority = await loadPackageAuthority(configuration, dependencies);
  const observedAt = validTimestamp(now());
  const nativeBefore = await loadNativeProviderAuthority(observedAt, request);
  // Reject unrelated governance before Source synchronization or Provider materialization can
  // mutate either control plane.
  await Promise.all([
    assertControlPlaneInventoryPreflight(configuration, observedAt, request, false, nativeBefore),
    assertGovernanceInventoryExact(configuration, packageAuthority, observedAt, request, true),
  ]);

  let source: UgvSmppSourceBootstrapReport;
  try {
    source = await (dependencies.bootstrapSource ?? bootstrapUgvSmppSource)(
      {
        ...configuration.source,
        nodeControlBaseUrl: configuration.nodeControlBaseUrl,
        nodeControlAdminToken: configuration.nodeControlBearerToken,
        runId: stableKey(configuration.runId, 'source-bootstrap-session', observedAt),
      },
      { fetch: request, now },
    );
  } catch (error) {
    if (error instanceof UgvSmppSourceBootstrapError)
      fail(error.code, 'The exact SMPP Source bootstrap failed.');
    throw error;
  }
  await assertNativeSourceLineage(configuration, nativeBefore, request);

  let materialized: SmppProviderMaterializationReport;
  try {
    materialized = await (dependencies.materializeProviders ?? materializeSmppProviders)(
      providerMaterializationConfiguration(configuration),
      { fetch: request, now },
    );
  } catch (error) {
    if (error instanceof SmppProviderMaterializationError)
      fail(error.code, 'The exact Profile Provider materialization failed.');
    throw error;
  }
  assertMaterializationReport(configuration, materialized);
  await assertControlPlaneInventoryPreflight(
    configuration,
    observedAt,
    request,
    true,
    nativeBefore,
  );

  const providerBefore = await loadProviderAuthority(configuration, observedAt, request);
  assertRuntimeMatchesNative(providerBefore.tools, nativeBefore);
  assertProviderMatchesMaterialization(providerBefore, materialized);
  await assertGovernanceInventoryExact(configuration, packageAuthority, observedAt, request, true);
  await ensureSkill(configuration, packageAuthority, request);
  const planned = plannedGovernance(configuration, packageAuthority, providerBefore);
  const capability = await ensureCapability(configuration, planned, request);
  const readiness = await ensureReadiness(
    configuration,
    providerBefore,
    planned,
    capability,
    now,
    pause,
    request,
  );
  const exposure = await ensureExposure(configuration, planned.exposure, request);
  const managedCard = await ensureManagedCard(configuration, exposure, readiness, request);

  const finalObservedAt = validTimestamp(now());
  const nativeAfter = await loadNativeProviderAuthority(finalObservedAt, request);
  if (
    nativeAfter.revision !== nativeBefore.revision ||
    nativeAfter.checksum !== nativeBefore.checksum
  )
    fail(
      'UAP_NATIVE_REGISTRY_CHANGED_DURING_BOOTSTRAP',
      'The fixed PMS native authority changed during bootstrap.',
    );
  await assertControlPlaneInventoryPreflight(
    configuration,
    finalObservedAt,
    request,
    true,
    nativeAfter,
  );
  await assertNativeSourceLineage(configuration, nativeAfter, request);
  const providerAfter = await loadProviderAuthority(configuration, finalObservedAt, request);
  assertRuntimeMatchesNative(providerAfter.tools, nativeAfter);
  if (providerAfter.fingerprint !== providerBefore.fingerprint)
    fail(
      'UAP_PROVIDER_AUTHORITY_CHANGED_DURING_BOOTSTRAP',
      'Provider Binding or Runtime Catalog authority changed during bootstrap.',
    );
  const governance = await loadExactGovernanceAuthority(
    configuration,
    packageAuthority,
    providerAfter,
    planned,
    finalObservedAt,
    request,
  );
  await assertGovernanceInventoryExact(
    configuration,
    packageAuthority,
    finalObservedAt,
    request,
    false,
  );
  if (
    governance.readiness.snapshotVersion !== readiness.snapshot.snapshotVersion ||
    governance.readinessHash !== readiness.snapshotHash ||
    governance.exposure.exposureHash !== exposure.exposureHash ||
    governance.managedCard.revision !== managedCard.revision
  )
    fail(
      'UAP_AUTHORITY_CHANGED_AFTER_BOOTSTRAP',
      'The final authority does not match the bootstrap result.',
    );
  return report(
    configuration,
    packageAuthority,
    providerAfter,
    governance,
    finalObservedAt,
    source,
    materialized,
  );
}

async function assertControlPlaneInventoryPreflight(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  observedAt: string,
  request: typeof fetch,
  requireComplete: boolean,
  nativeAuthority: NativeProviderAuthority,
): Promise<void> {
  const [sources, candidates, bindings, servers] = await Promise.all([
    controlCollection(
      configuration,
      '/api/v1/smpp-sources?pageSize=200',
      SourceInventorySchema,
      request,
    ),
    controlCollection(
      configuration,
      `/api/v1/mcp-provider-candidates?smppSourceId=${encodeURIComponent(configuration.source.smppSourceId)}&pageSize=200`,
      CandidateInventorySchema,
      request,
    ),
    controlCollection(
      configuration,
      '/api/v1/mcp-provider-bindings?pageSize=200',
      BindingInventorySchema,
      request,
    ),
    runtimeCollection(configuration, '/api/v1/mcp/servers', RuntimeServerSchema, request),
  ]);
  if (
    sources.some(({ smppSourceId }) => smppSourceId !== configuration.source.smppSourceId) ||
    candidates.some(
      ({ smppSourceId, externalProviderId, externalServerId }) =>
        smppSourceId !== configuration.source.smppSourceId ||
        externalProviderId !== EXPECTED_PROVIDER_ID ||
        externalServerId !== EXPECTED_EXTERNAL_SERVER_ID,
    ) ||
    bindings.some(({ bindingId }) => bindingId !== configuration.providerBindingId) ||
    servers.some(({ serverId }) => serverId !== configuration.localServerId)
  )
    fail(
      'UAP_EXTRA_CONTROL_PLANE_AUTHORITY_FORBIDDEN',
      'The clean Profile database contains an extra Source, candidate, Binding, or Runtime Server.',
    );
  if (sources.length > 1 || candidates.length > 1 || bindings.length > 1 || servers.length > 1)
    fail('UAP_CONTROL_PLANE_CARDINALITY_INVALID', 'Profile control-plane authority is not unique.');
  if (
    requireComplete &&
    (sources.length !== 1 ||
      candidates.length !== 1 ||
      bindings.length !== 1 ||
      servers.length !== 1)
  )
    fail(
      'UAP_CONTROL_PLANE_AUTHORITY_INCOMPLETE',
      'Exact active Source-to-Catalog authority is incomplete.',
    );
  const source = sources[0];
  if (
    source !== undefined &&
    (normalizedEndpoint(source.registryEndpoint) !== EXPECTED_SOURCE_ENDPOINT ||
      source.credentialRef !== SMPP_UNAUTHENTICATED_CREDENTIAL_REF ||
      source.environment !== 'simulation' ||
      source.syncMode !== 'manual' ||
      source.snapshotTtlSeconds !== configuration.source.snapshotTtlSeconds ||
      source.lkgPolicy !== 'deny_when_unavailable' ||
      (requireComplete
        ? source.status !== 'active'
        : !['draft', 'active'].includes(source.status)) ||
      (requireComplete &&
        (source.activeSnapshotRevision === undefined ||
          source.activeSnapshotChecksum === undefined ||
          source.activeSnapshotValidUntil === undefined ||
          Date.parse(source.activeSnapshotValidUntil) <= Date.parse(observedAt))))
  )
    fail('UAP_SOURCE_AUTHORITY_DRIFT', 'The existing SMPP Source is not exactly reconcilable.');
  const candidate = candidates[0];
  if (
    candidate !== undefined &&
    (normalizedEndpoint(candidate.serverEndpoint) !== EXPECTED_PROVIDER_ENDPOINT ||
      candidate.labels.environment !== 'simulation' ||
      Date.parse(candidate.registryValidUntil) <= Date.parse(observedAt) ||
      (source !== undefined &&
        (candidate.registryRevision !== source.activeSnapshotRevision ||
          candidate.registryChecksum !== source.activeSnapshotChecksum)))
  )
    fail('UAP_CANDIDATE_AUTHORITY_DRIFT', 'The existing SMPP candidate has drifted.');
  const binding = bindings[0];
  if (
    binding !== undefined &&
    (binding.bindingId !== configuration.providerBindingId ||
      binding.localServerId !== configuration.localServerId ||
      binding.smppSourceId !== configuration.source.smppSourceId ||
      binding.externalProviderId !== EXPECTED_PROVIDER_ID ||
      binding.externalServerId !== EXPECTED_EXTERNAL_SERVER_ID ||
      normalizedEndpoint(binding.endpointRef) !== EXPECTED_PROVIDER_ENDPOINT ||
      (candidate !== undefined &&
        (binding.registryRevision !== candidate.registryRevision ||
          binding.registryChecksum !== candidate.registryChecksum)))
  )
    fail('UAP_PROVIDER_BINDING_AUTHORITY_INVALID', 'The existing Provider Binding has drifted.');
  const server = servers[0];
  if (
    server !== undefined &&
    (normalizedEndpoint(server.endpoint) !== EXPECTED_PROVIDER_ENDPOINT ||
      (binding !== undefined && server.toolRevision !== binding.revision))
  )
    fail('UAP_RUNTIME_CATALOG_AUTHORITY_INVALID', 'The existing Runtime Server has drifted.');
  if (server !== undefined) {
    const tools = await runtimeCollection(
      configuration,
      `/api/v1/mcp/servers/${encodeURIComponent(configuration.localServerId)}/tools`,
      ToolSchema,
      request,
    );
    if (
      tools.length !== TOOL_NAMES.length ||
      !sameStrings(
        tools.map(({ toolName }) => toolName),
        TOOL_NAMES,
      )
    )
      fail(
        'UAP_RUNTIME_TOOL_SET_INVALID',
        'The existing Runtime Catalog is not the exact Tool set.',
      );
    for (const tool of tools) assertProfileToolAuthority(tool);
    assertRuntimeMatchesNative(tools, nativeAuthority);
  }
}

export async function verifyUgvAgentProfileAuthority(
  input: UgvAgentProfileAuthorityBootstrapConfiguration,
  dependencies: UgvAgentProfileAuthorityBootstrapDependencies = {},
): Promise<UgvAgentProfileAuthorityBootstrapReport> {
  const configuration = validateConfiguration({ ...input, mode: 'verify' });
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const packageAuthority = await loadPackageAuthority(configuration, dependencies);
  const observedAt = validTimestamp(now());
  const native = await loadNativeProviderAuthority(observedAt, request);
  await assertControlPlaneInventoryPreflight(configuration, observedAt, request, true, native);
  await assertNativeSourceLineage(configuration, native, request);
  const provider = await loadProviderAuthority(configuration, observedAt, request);
  assertRuntimeMatchesNative(provider.tools, native);
  const planned = plannedGovernance(configuration, packageAuthority, provider);
  const governance = await loadExactGovernanceAuthority(
    configuration,
    packageAuthority,
    provider,
    planned,
    observedAt,
    request,
  );
  await assertGovernanceInventoryExact(configuration, packageAuthority, observedAt, request, false);
  return report(configuration, packageAuthority, provider, governance, observedAt);
}

interface ProfilePublicCardState {
  readonly exactSkillCount: number;
  readonly totalSkillCount: number;
  readonly capabilityIds: readonly string[];
  readonly managementContentHash: string;
  readonly a2aContentHash: string;
  readonly semanticHash: string;
}

export async function verifyUgvAgentProfileAuthorityReadiness(
  input: UgvAgentProfileAuthorityBootstrapConfiguration,
  dependencies: UgvAgentProfileAuthorityBootstrapDependencies = {},
): Promise<UgvAgentProfileAuthorityReadinessReport> {
  const configuration = validateConfiguration({ ...input, mode: 'readiness' });
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const packageAuthority = await loadPackageAuthority(configuration, dependencies);
  const observedAt = validTimestamp(now());
  const native = await loadNativeProviderAuthority(observedAt, request);
  await Promise.all([
    assertControlPlaneInventoryPreflight(configuration, observedAt, request, true, native),
    assertGovernanceInventoryExact(configuration, packageAuthority, observedAt, request, false),
  ]);
  await assertNativeSourceLineage(configuration, native, request);
  const provider = await loadProviderAuthority(configuration, observedAt, request);
  assertRuntimeMatchesNative(provider.tools, native);
  const planned = plannedGovernance(configuration, packageAuthority, provider);
  let beforeGovernance = await latestSkillGovernanceState(configuration, request);
  if (beforeGovernance.status === 'suspended') {
    beforeGovernance = await transitionExactSkill(
      configuration,
      'publish',
      beforeGovernance.revision,
      request,
    );
  }
  if (beforeGovernance.status !== 'published')
    fail(
      'UAP_READINESS_SKILL_NOT_PUBLISHED',
      'Readiness requires an exact published or safely recoverable suspended Skill.',
    );
  const governance = await loadExactGovernanceAuthority(
    configuration,
    packageAuthority,
    provider,
    planned,
    observedAt,
    request,
  );
  const beforeCard = await eventuallyLoadProfilePublicCard(configuration, true, request);
  const managedBefore = governance.managedCard;
  let activeTransition: Promise<SkillGovernanceState> | undefined;
  let interruptionSignal: 'SIGINT' | 'SIGTERM' | undefined;
  let interruptionRecovery: Promise<void> | undefined;
  const transition = async (action: 'suspend' | 'publish', expectedRevision: number) => {
    const pending = transitionExactSkill(configuration, action, expectedRevision, request);
    activeTransition = pending;
    try {
      return await pending;
    } finally {
      if (activeTransition === pending) activeTransition = undefined;
    }
  };
  const recoverAfterSignal = async (): Promise<void> => {
    await activeTransition?.catch(() => undefined);
    let current = await latestSkillGovernanceState(configuration, request);
    if (current.status === 'suspended')
      current = await transitionExactSkill(configuration, 'publish', current.revision, request);
    if (current.status !== 'published')
      fail(
        'UAP_READINESS_SIGNAL_RESTORE_FAILED',
        'Signal recovery could not restore exact Skill@1 published authority.',
      );
    const versions = await controlCollection(
      configuration,
      `/api/v1/skills/${encodeURIComponent(SKILL_ID)}/versions?pageSize=200`,
      ControlSkillSchema,
      request,
    );
    if (versions.length !== 1 || Number(versions[0]?.version) !== 1)
      fail(
        'UAP_SKILL_VERSION_CARDINALITY_INVALID',
        'Signal recovery must retain only exact Skill@1.',
      );
  };
  const signalSource = dependencies.lifecycleSignals ?? processLifecycleSignals();
  const unsubscribeSignals = signalSource.subscribe((signal) => {
    if (interruptionSignal !== undefined) return;
    interruptionSignal = signal;
    interruptionRecovery = recoverAfterSignal();
    void interruptionRecovery.catch(() => undefined);
  });
  const rejectIfInterrupted = async (): Promise<void> => {
    if (interruptionSignal === undefined) return;
    await interruptionRecovery;
    throw readinessInterrupted(interruptionSignal);
  };

  let suspendedGovernance: SkillGovernanceState | undefined;
  let restoredGovernance: SkillGovernanceState | undefined;
  let suspendedCard: ProfilePublicCardState | undefined;
  let restoredCard: ProfilePublicCardState | undefined;
  let lifecycleFailure: unknown;
  let recoveryFailure = false;
  try {
    await rejectIfInterrupted();
    suspendedGovernance = await transition('suspend', beforeGovernance.revision);
    await rejectIfInterrupted();
    if (suspendedGovernance.revision !== beforeGovernance.revision + 1)
      fail('UAP_SKILL_GOVERNANCE_REVISION_INVALID', 'Skill suspend revision did not advance once.');
    suspendedCard = await eventuallyLoadProfilePublicCard(configuration, false, request);
    await rejectIfInterrupted();
    await assertManagedCardUnchanged(configuration, managedBefore, request);
    await rejectIfInterrupted();
    restoredGovernance = await transition('publish', suspendedGovernance.revision);
    await rejectIfInterrupted();
    if (restoredGovernance.revision !== suspendedGovernance.revision + 1)
      fail('UAP_SKILL_GOVERNANCE_REVISION_INVALID', 'Skill restore revision did not advance once.');
    restoredCard = await eventuallyLoadProfilePublicCard(configuration, true, request);
    await assertManagedCardUnchanged(configuration, managedBefore, request);
    if (restoredCard.semanticHash !== beforeCard.semanticHash)
      fail('UAP_PROFILE_CARD_NOT_RESTORED', 'The public Profile Card was not exactly restored.');
    await rejectIfInterrupted();
  } catch (error) {
    lifecycleFailure = error;
  } finally {
    if (restoredGovernance === undefined) {
      try {
        const current = await latestSkillGovernanceState(configuration, request);
        if (current.status === 'suspended')
          restoredGovernance = await transitionExactSkill(
            configuration,
            'publish',
            current.revision,
            request,
          );
        else if (current.status === 'published') restoredGovernance = current;
        else recoveryFailure = true;
        if (
          suspendedGovernance !== undefined &&
          restoredGovernance !== undefined &&
          restoredGovernance.revision < suspendedGovernance.revision + 1
        )
          recoveryFailure = true;
      } catch {
        recoveryFailure = true;
      }
    }
    if (interruptionSignal !== undefined) {
      try {
        await interruptionRecovery;
        lifecycleFailure = readinessInterrupted(interruptionSignal);
      } catch {
        recoveryFailure = true;
      }
    }
    unsubscribeSignals();
  }
  if (recoveryFailure || restoredGovernance?.status !== 'published')
    fail(
      'UAP_READINESS_SKILL_RESTORE_FAILED',
      'Readiness could not restore the exact Skill@1 published authority.',
    );
  if (lifecycleFailure instanceof Error) throw lifecycleFailure;
  if (lifecycleFailure !== undefined)
    fail('UAP_READINESS_LIFECYCLE_FAILED', 'Readiness failed with a non-Error value.');
  if (
    suspendedGovernance === undefined ||
    suspendedCard === undefined ||
    restoredCard === undefined
  )
    fail('UAP_READINESS_LIFECYCLE_INCOMPLETE', 'The exact public Card lifecycle is incomplete.');
  const versions = await controlCollection(
    configuration,
    `/api/v1/skills/${encodeURIComponent(SKILL_ID)}/versions?pageSize=200`,
    ControlSkillSchema,
    request,
  );
  if (versions.length !== 1 || Number(versions[0]?.version) !== 1)
    fail('UAP_SKILL_VERSION_CARDINALITY_INVALID', 'Readiness must retain only exact Skill@1.');
  const finalObservedAt = validTimestamp(now());
  const finalGovernance = await loadExactGovernanceAuthority(
    configuration,
    packageAuthority,
    provider,
    planned,
    finalObservedAt,
    request,
  );
  if (finalGovernance.managedCard.contentHash !== managedBefore.contentHash)
    fail(
      'UAP_MANAGED_CARD_AUTHORITY_DRIFT',
      'Managed Exposure Card changed across Skill lifecycle.',
    );
  const value: UgvAgentProfileAuthorityReadinessReport = Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile-authority-readiness/v1',
    status: 'passed',
    mode: 'readiness',
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    observedAt: finalObservedAt,
    skillLifecycle: Object.freeze({
      skillId: SKILL_ID,
      version: 1,
      beforeRevision: beforeGovernance.revision,
      suspendedRevision: suspendedGovernance.revision,
      restoredRevision: restoredGovernance.revision,
      finalGovernedStatus: 'published',
      exactVersionCount: 1,
    }),
    profilePublicCardLifecycle: Object.freeze({
      authority: 'CapabilityCardPublisher',
      managedCardUsed: false,
      sourceSkillRef: 'embodied.move_to:1',
      before: profileCardReportState(beforeCard, true),
      suspended: profileCardReportState(suspendedCard, false),
      restored: profileCardReportState(restoredCard, true),
      semanticRestored: true,
    }),
    managedCardSeparation: Object.freeze({
      authority: 'node_control_exposure',
      exposureRef: 'a2a.embodied.move:1',
      revision: managedBefore.revision,
      contentHash: managedBefore.contentHash,
      unchangedAcrossSkillLifecycle: true,
    }),
    driverActivity: zeroDriverActivity(),
    redaction: redactionDeclaration(),
  });
  assertSafeReport(value, configuration);
  return value;
}

async function transitionExactSkill(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  action: 'suspend' | 'publish',
  expectedRevision: number,
  request: typeof fetch,
): Promise<SkillGovernanceState> {
  const operation = OperationSchema.parse(
    await controlPost(
      configuration,
      `/api/v1/skills/${encodeURIComponent(SKILL_ID)}/versions/1/${action}`,
      stableKey(
        configuration.runId,
        `skill-${action}`,
        `${SKILL_ID}:1:${String(expectedRevision)}`,
      ),
      {
        reason: `${action === 'suspend' ? 'Suspend' : 'Restore'} exact embodied.move_to@1 for public Profile Card lifecycle readiness.`,
        expectedRevision,
      },
      202,
      request,
    ),
  );
  assertSkillOperation(operation, `skill.${action}`);
  const state = requiredSkillGovernanceState(
    operation,
    action === 'suspend' ? 'suspended' : 'published',
  );
  const current = await latestSkillGovernanceState(configuration, request, [operation]);
  if (current.status !== state.status || current.revision !== state.revision)
    fail('UAP_SKILL_GOVERNANCE_JOURNAL_DRIFT', 'Skill lifecycle result and journal differ.');
  return state;
}

async function loadProfilePublicCard(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  request: typeof fetch,
): Promise<ProfilePublicCardState> {
  const [managementValue, a2aValue] = await Promise.all([
    runtimeGet(configuration, '/api/v1/capabilities/card', request),
    responseJson(
      await request(`${configuration.profileA2aBaseUrl}/.well-known/agent-card.json`, {
        redirect: 'manual',
      }),
      200,
    ),
  ]);
  const management = record(managementValue);
  const a2a = record(a2aValue);
  const publicSkills = Array.isArray(management?.['publicSkills'])
    ? management['publicSkills'].map(record)
    : [];
  const a2aSkills = Array.isArray(a2a?.['skills']) ? a2a['skills'].map(record) : [];
  if (
    management === undefined ||
    a2a === undefined ||
    publicSkills.some((skill) => skill === undefined) ||
    a2aSkills.some((skill) => skill === undefined)
  )
    fail('UAP_PROFILE_CARD_INVALID', 'Public Profile Card is not a valid Agent Card.');
  const managementProfile = record(management['profile']);
  const managementCapabilities = Array.isArray(managementProfile?.['capabilities'])
    ? managementProfile['capabilities'].map(record)
    : [];
  const a2aCapabilities = record(a2a['capabilities']);
  const extensions = Array.isArray(a2aCapabilities?.['extensions'])
    ? a2aCapabilities['extensions'].map(record)
    : [];
  const profileExtensions = extensions.filter(
    (extension) => extension?.['uri'] === 'io.sdar/capabilityProfile',
  );
  const a2aProfile = record(profileExtensions[0]?.['params']);
  const sourceSkillRefs = Array.isArray(management['sourceSkillRefs'])
    ? management['sourceSkillRefs'].filter((value): value is string => typeof value === 'string')
    : [];
  const interfaces = Array.isArray(a2a['supportedInterfaces'])
    ? a2a['supportedInterfaces'].map(record)
    : [];
  const profileInterface = interfaces[0];
  if (
    profileExtensions.length !== 1 ||
    managementProfile === undefined ||
    a2aProfile === undefined ||
    managementCapabilities.some((capability) => capability === undefined) ||
    management['generationPolicyVersion'] !== 'capability-policy-v1:ugv-agent-profile-v1' ||
    management['status'] !== 'active' ||
    typeof management['catalogHash'] !== 'string' ||
    !PREFIXED_CHECKSUM.test(management['catalogHash']) ||
    managementProfile['catalogHash'] !== management['catalogHash'] ||
    typeof management['cardContentHash'] !== 'string' ||
    !PREFIXED_CHECKSUM.test(management['cardContentHash']) ||
    canonical(managementProfile) !== canonical(a2aProfile) ||
    management['agentName'] !== a2a['name'] ||
    management['description'] !== a2a['description'] ||
    interfaces.length !== 1 ||
    profileInterface?.['url'] !== `${configuration.profileA2aBaseUrl}/a2a` ||
    profileInterface['protocolBinding'] !== 'HTTP+JSON' ||
    profileInterface['protocolVersion'] !== '1.0'
  )
    fail(
      'UAP_PROFILE_CARD_AUTHORITY_INVALID',
      'Public Card is not the CapabilityCardPublisher Profile projection.',
    );
  const skillIds = publicSkills.map((skill) => String(skill?.['id']));
  const a2aSkillIds = a2aSkills.map((skill) => String(skill?.['id']));
  const capabilityIds = managementCapabilities.map((capability) =>
    String(capability?.['capabilityId']),
  );
  if (
    !sameStrings(skillIds, a2aSkillIds) ||
    !sameStrings(
      sourceSkillRefs,
      skillIds.map((skillId) => `${skillId}:1`),
    ) ||
    publicSkills.some((skill) => {
      const projection = a2aSkills.find((candidate) => candidate?.['id'] === skill?.['id']);
      if (projection === undefined || skill === undefined) return true;
      return (
        projection['name'] !== skill['name'] ||
        projection['description'] !== skill['description'] ||
        !sameStrings(
          projection['tags'],
          Array.isArray(skill['tags']) ? skill['tags'].map(String) : [],
        ) ||
        !sameStrings(projection['inputModes'], ['text/plain']) ||
        !sameStrings(projection['outputModes'], ['text/plain', 'application/json'])
      );
    })
  )
    fail(
      'UAP_PROFILE_CARD_PROJECTION_DRIFT',
      'Management Capability Card and A2A public projection differ.',
    );
  return Object.freeze({
    exactSkillCount: skillIds.filter((skillId) => skillId === SKILL_ID).length,
    totalSkillCount: skillIds.length,
    capabilityIds: Object.freeze(capabilityIds),
    managementContentHash: management['cardContentHash'],
    a2aContentHash: sha256(canonical(a2a)),
    semanticHash: sha256(
      canonical({
        management: {
          generationPolicyVersion: management['generationPolicyVersion'],
          catalogHash: management['catalogHash'],
          agentName: management['agentName'],
          description: management['description'],
          profile: { ...managementProfile, generatedAt: undefined },
          publicSkills,
          sourceSkillRefs,
        },
        a2a: {
          name: a2a['name'],
          description: a2a['description'],
          supportedInterfaces: a2a['supportedInterfaces'],
          skills: a2aSkills,
          profile: { ...a2aProfile, generatedAt: undefined },
        },
      }),
    ),
  });
}

async function eventuallyLoadProfilePublicCard(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  enabled: boolean,
  request: typeof fetch,
): Promise<ProfilePublicCardState> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const state = await loadProfilePublicCard(configuration, request);
      assertProfilePublicCard(state, enabled);
      return state;
    } catch (error) {
      lastError = error;
    }
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  if (lastError instanceof UgvAgentProfileAuthorityBootstrapError) throw lastError;
  return fail('UAP_PROFILE_CARD_LIFECYCLE_TIMEOUT', 'Public Profile Card did not converge.');
}

function assertProfilePublicCard(state: ProfilePublicCardState, enabled: boolean): void {
  if (
    enabled
      ? state.exactSkillCount !== 1 ||
        state.totalSkillCount !== 1 ||
        !sameStrings(state.capabilityIds, ['embodied.move', 'embodied.navigation'])
      : state.exactSkillCount !== 0 ||
        state.totalSkillCount !== 0 ||
        state.capabilityIds.length !== 0
  )
    fail(
      'UAP_PROFILE_CARD_LIFECYCLE_INVALID',
      'Public Profile Card does not reflect the exact enabled Skill lifecycle.',
    );
}

function profileCardReportState(
  state: ProfilePublicCardState,
  enabled: true,
): UgvAgentProfileAuthorityReadinessReport['profilePublicCardLifecycle']['before'];
function profileCardReportState(
  state: ProfilePublicCardState,
  enabled: false,
): UgvAgentProfileAuthorityReadinessReport['profilePublicCardLifecycle']['suspended'];
function profileCardReportState(state: ProfilePublicCardState, enabled: boolean) {
  return Object.freeze({
    exactSkillCount: enabled ? 1 : 0,
    totalSkillCount: enabled ? 1 : 0,
    capabilityCount: enabled ? 2 : 0,
    managementContentHash: publicSha256(state.managementContentHash),
    a2aContentHash: state.a2aContentHash,
  });
}

async function assertManagedCardUnchanged(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  expected: AgentCardRevision,
  request: typeof fetch,
): Promise<void> {
  const actual = await loadActiveManagedCard(configuration, request);
  if (actual === undefined)
    fail('UAP_MANAGED_CARD_AUTHORITY_DRIFT', 'The active managed Card disappeared.');
  if (
    actual.revision !== expected.revision ||
    actual.contentHash !== expected.contentHash ||
    actual.capabilityCatalogHash !== expected.capabilityCatalogHash ||
    !sameStrings(actual.exposureRefs ?? [], [`${EXPOSURE_ID}:1`])
  )
    fail(
      'UAP_MANAGED_CARD_AUTHORITY_DRIFT',
      'Node Control managed Exposure Card changed across the Skill lifecycle.',
    );
}

async function loadPackageAuthority(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  dependencies: UgvAgentProfileAuthorityBootstrapDependencies,
): Promise<PackageAuthority> {
  const packageSchema = JSON.parse(
    await readFile(new URL('../../../schemas/skill-package.schema.json', import.meta.url), 'utf8'),
  ) as unknown;
  const importer = new SkillPackageImporter({
    reader: new NodeSkillPackageReader(),
    validator: new SkillPackageValidator({
      schemas: new AjvJsonSchemaValidator(),
      packageSchema,
    }),
    clock: { now: () => '2026-08-21T00:00:00.000Z' },
  });
  const imported = await (dependencies.loadSkillPackage ?? importer.import.bind(importer))(
    configuration.skillPackageRoot,
  );
  const skill = imported.skillVersion;
  if (
    imported.packageChecksum !== EXPECTED_PACKAGE_CHECKSUM ||
    imported.packageRoot !== resolve(configuration.skillPackageRoot) ||
    skill.skillId !== SKILL_ID ||
    skill.version !== 1 ||
    skill.status !== 'enabled' ||
    !skill.validationPassed ||
    canonical(skill.toolPolicy) !== canonical({ required: [], optional: [], forbidden: [] }) ||
    canonical(skill.runtimePolicy) !==
      canonical({
        maxDurationSeconds: 600,
        maxMcpCalls: 8,
        maxReplans: 1,
        autoConfirmPlan: false,
        cancelStrategy: 'try_interrupt',
      })
  )
    fail('UAP_SKILL_PACKAGE_DRIFT', 'The immutable embodied.move_to@1 package has drifted.');
  const inputSchema = jsonObject(skill.inputSchema, 'UAP_SKILL_INPUT_SCHEMA_INVALID');
  const outputSchema = jsonObject(skill.outputSchema, 'UAP_SKILL_OUTPUT_SCHEMA_INVALID');
  const usageSpecification = record(skill.usageSpecification);
  if (
    usageSpecification === undefined ||
    sha256(canonical(usageSpecification)) !==
      '9801dd4ea424a1b925e51a273a5712f082e41daacbf76f7df9d8595c48b01b87'
  )
    fail('UAP_SKILL_USAGE_DRIFT', 'The formal embodied.move_to@1 Usage authority has drifted.');
  return Object.freeze({
    packageChecksum: EXPECTED_PACKAGE_CHECKSUM,
    inputSchema,
    outputSchema,
    usageSpecification,
  });
}

function providerMaterializationConfiguration(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
) {
  return Object.freeze({
    nodeControlBaseUrl: configuration.nodeControlBaseUrl,
    nodeControlBearerToken: configuration.nodeControlBearerToken,
    runtimeManagementBaseUrl: configuration.runtimeManagementBaseUrl,
    smppSourceId: configuration.source.smppSourceId,
    runId: configuration.runId,
    providers: Object.freeze([
      Object.freeze({
        providerKey: 'ugv-agent-profile',
        name: configuration.providerDisplayName,
        externalProviderId: configuration.source.externalProviderId,
        externalServerId: configuration.source.externalServerId,
        bindingId: configuration.providerBindingId,
        localServerId: configuration.localServerId,
        credentialRef: configuration.runtimeCredentialRef,
        credential: Object.freeze({ mode: 'none' as const }),
        tools: PROFILE_TOOL_POLICY,
      }),
    ]),
  });
}

function assertMaterializationReport(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  reportValue: SmppProviderMaterializationReport,
): void {
  const provider = reportValue.providers[0];
  if (reportValue.providers.length !== 1 || provider === undefined)
    fail(
      'UAP_PROVIDER_MATERIALIZATION_RESULT_INVALID',
      'Provider materialization did not return the exact UGV Profile authority.',
    );
  if (
    provider.bindingId !== configuration.providerBindingId ||
    provider.externalProviderId !== EXPECTED_PROVIDER_ID ||
    provider.externalServerId !== EXPECTED_EXTERNAL_SERVER_ID ||
    provider.tools.length !== TOOL_NAMES.length ||
    !sameStrings(
      provider.tools.map(({ toolName }) => toolName),
      TOOL_NAMES,
    )
  )
    fail(
      'UAP_PROVIDER_MATERIALIZATION_RESULT_INVALID',
      'Provider materialization did not return the exact UGV Profile authority.',
    );
}

async function loadProviderAuthority(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  observedAt: string,
  request: typeof fetch,
): Promise<ProviderAuthority> {
  const binding = BindingSchema.parse(
    await controlGet(
      configuration,
      `/api/v1/mcp-provider-bindings/${encodeURIComponent(configuration.providerBindingId)}`,
      request,
    ),
  );
  if (
    binding.bindingId !== configuration.providerBindingId ||
    binding.localServerId !== configuration.localServerId ||
    binding.smppSourceId !== configuration.source.smppSourceId ||
    binding.externalProviderId !== EXPECTED_PROVIDER_ID ||
    binding.externalServerId !== EXPECTED_EXTERNAL_SERVER_ID ||
    normalizedEndpoint(binding.endpointRef) !== EXPECTED_PROVIDER_ENDPOINT ||
    binding.operationCount !== TOOL_NAMES.length ||
    Date.parse(binding.availabilityValidUntil) <= Date.parse(observedAt)
  )
    fail(
      'UAP_PROVIDER_BINDING_AUTHORITY_INVALID',
      'The current Provider Binding is not the exact fresh UGV Profile authority.',
    );
  const servers = z
    .object({ items: z.array(RuntimeServerSchema) })
    .loose()
    .parse(await runtimeGet(configuration, '/api/v1/mcp/servers', request)).items;
  const matches = servers.filter(({ serverId }) => serverId === configuration.localServerId);
  const server = matches[0];
  if (
    matches.length !== 1 ||
    server === undefined ||
    normalizedEndpoint(server.endpoint) !== EXPECTED_PROVIDER_ENDPOINT ||
    server.toolRevision !== binding.revision ||
    server.currentDiscovery.toolRevision !== binding.revision ||
    Date.parse(server.currentDiscovery.validUntil) <= Date.parse(observedAt)
  )
    fail(
      'UAP_RUNTIME_CATALOG_AUTHORITY_INVALID',
      'The Runtime Server and Provider Binding authority are not exact and current.',
    );
  const tools = z
    .object({ items: z.array(ToolSchema) })
    .loose()
    .parse(
      await runtimeGet(
        configuration,
        `/api/v1/mcp/servers/${encodeURIComponent(configuration.localServerId)}/tools`,
        request,
      ),
    ).items;
  if (
    tools.length !== TOOL_NAMES.length ||
    !sameStrings(
      tools.map(({ toolName }) => toolName),
      TOOL_NAMES,
    ) ||
    tools.some(({ serverId }) => serverId !== configuration.localServerId)
  )
    fail('UAP_RUNTIME_TOOL_SET_INVALID', 'The Runtime Catalog is not the exact reviewed 10 tools.');
  for (const tool of tools) assertProfileToolAuthority(tool);
  const navigateMatches = tools.filter(({ toolName }) => toolName === NAVIGATE_TOOL);
  const navigate = navigateMatches[0];
  if (navigateMatches.length !== 1 || navigate === undefined)
    fail('UAP_NAVIGATE_TOOL_NOT_EXACT', 'The Runtime Catalog requires one vehicle_navigate Tool.');
  assertNavigateAuthority(navigate);
  const fingerprint = sha256(
    canonical({
      binding: {
        bindingId: binding.bindingId,
        localServerId: binding.localServerId,
        externalProviderId: binding.externalProviderId,
        externalServerId: binding.externalServerId,
        registryRevision: binding.registryRevision,
        registryChecksum: binding.registryChecksum,
        revision: binding.revision,
        catalogRevision: binding.catalogRevision,
        catalogChecksum: binding.catalogChecksum,
        operationCount: binding.operationCount,
      },
      server: {
        serverId: server.serverId,
        toolRevision: server.toolRevision,
        protocolMode: server.protocolMode,
      },
      tools,
    }),
  );
  return Object.freeze({ binding, server, tools: Object.freeze(tools), navigate, fingerprint });
}

function assertNavigateAuthority(tool: Tool): void {
  const semantics = tool.executionSemantics;
  const profile = tool.taskExecutionProfile;
  if (
    semantics.effect !== 'side_effecting' ||
    semantics.execution !== 'task_required' ||
    semantics.cancellation !== 'task_cancel' ||
    semantics.idempotency !== 'server_managed' ||
    semantics.replay !== 'simulation_only' ||
    semantics.source !== 'admin_override' ||
    profile.taskBehavior !== 'task_required' ||
    profile.availability !== 'dynamic' ||
    !profile.supportsScheduling ||
    !profile.supportsMaxElapsed ||
    !profile.supportsCancellation ||
    !profile.supportsPauseResume ||
    !profile.supportsObservations ||
    profile.supportsInputRequired ||
    profile.idempotency !== 'server_managed'
  )
    fail(
      'UAP_NAVIGATE_SEMANTICS_INVALID',
      'vehicle_navigate must retain the exact Profile simulation-only Task semantics.',
    );
  assertNavigatePointSchema(tool.inputSchema);
  assertNavigateOutputSchema(tool.outputSchema);
}

function assertProfileToolAuthority(tool: Tool): void {
  const expected = Object.entries(PROFILE_TOOL_POLICY).find(
    ([toolName]) => toolName === tool.toolName,
  )?.[1];
  const expectedTaskExecution = Object.entries(PROFILE_TASK_EXECUTION_POLICY).find(
    ([toolName]) => toolName === tool.toolName,
  )?.[1];
  const semantics = tool.executionSemantics;
  const profile = tool.taskExecutionProfile;
  if (
    expected === undefined ||
    expectedTaskExecution === undefined ||
    !['mcp_declared', 'admin_override'].includes(semantics.source) ||
    semantics.effect !== expected.executionSemantics.effect ||
    semantics.execution !== expected.executionSemantics.execution ||
    semantics.cancellation !== expected.executionSemantics.cancellation ||
    semantics.idempotency !== expected.executionSemantics.idempotency ||
    semantics.replay !== expected.executionSemantics.replay ||
    expected.taskBehavior !== expectedTaskExecution.taskBehavior ||
    canonical(normalizedTaskExecution(profile)) !== canonical(expectedTaskExecution) ||
    (tool.toolName === NAVIGATE_TOOL && semantics.source !== 'admin_override')
  )
    fail(
      'UAP_RUNTIME_TOOL_SEMANTICS_DRIFT',
      'Runtime Tool semantics or task lifecycle profile differ from the exact Profile policy.',
    );
}

function assertNavigatePointSchema(value: unknown): void {
  const input = record(value);
  const properties = record(input?.['properties']);
  const resource = record(properties?.['resourceId']);
  const mission = record(properties?.['mission']);
  const stopOnObstacle = record(properties?.['stopOnObstacle']);
  const alternatives = Array.isArray(mission?.['oneOf']) ? mission['oneOf'].map(record) : [];
  const point = alternatives.find(
    (alternative) => record(record(alternative?.['properties'])?.['type'])?.['const'] === 'point',
  );
  const target = record(record(point?.['properties'])?.['target']);
  const targetProperties = record(target?.['properties']);
  const latitude = record(targetProperties?.['latitude']);
  const longitude = record(targetProperties?.['longitude']);
  if (
    input?.['type'] !== 'object' ||
    input['additionalProperties'] !== false ||
    !requiredContains(input['required'], ['resourceId', 'mission']) ||
    !schemaAllowsExactResource(resource, EXPECTED_RESOURCE_ID) ||
    stopOnObstacle?.['type'] !== 'boolean' ||
    point?.['additionalProperties'] !== false ||
    !sameStrings(point['required'], ['type', 'target']) ||
    target?.['type'] !== 'object' ||
    target['additionalProperties'] !== false ||
    !sameStrings(target['required'], ['latitude', 'longitude']) ||
    latitude?.['type'] !== 'number' ||
    latitude['minimum'] !== -90 ||
    latitude['maximum'] !== 90 ||
    longitude?.['type'] !== 'number' ||
    longitude['minimum'] !== -180 ||
    longitude['maximum'] !== 180
  )
    fail(
      'UAP_NAVIGATE_SCHEMA_INVALID',
      'vehicle_navigate does not expose the exact bounded WGS84 point mission contract.',
    );
}

function exactOutputSuccessBranch(
  value: unknown,
  successPredicate: (branch: unknown) => boolean,
  code: string,
  message: string,
): Readonly<Record<string, unknown>> {
  const success = resolveUgvProfileProviderSuccessOutputSchema(value);
  if (success === undefined || !successPredicate(success)) fail(code, message);
  return success;
}

function assertNavigateOutputSchema(value: unknown): void {
  exactOutputSuccessBranch(
    value,
    navigateSuccessOutputSchema,
    'UAP_NAVIGATE_OUTPUT_SCHEMA_INVALID',
    'vehicle_navigate output does not retain one exact success and business-result branch.',
  );
}

function navigateSuccessOutputSchema(value: unknown): boolean {
  const output = record(value);
  const properties = record(output?.['properties']);
  const status = record(properties?.['status']);
  const observedAt = record(properties?.['observedAt']);
  const snapshotRevision = record(properties?.['snapshotRevision']);
  const correlationStrength = record(properties?.['correlationStrength']);
  const observationAuthority = record(properties?.['observationAuthority']);
  const positionAuthority = record(properties?.['positionAuthority']);
  const positionProperties = record(positionAuthority?.['properties']);
  const timeAuthority = record(positionProperties?.['timeAuthority']);
  return (
    output?.['type'] === 'object' &&
    output['additionalProperties'] === false &&
    requiredContains(output['required'], ['resourceId', 'status', 'observedAt']) &&
    schemaAllowsExactResource(record(properties?.['resourceId']), EXPECTED_RESOURCE_ID) &&
    arrayIncludes(status?.['enum'], 'completed') &&
    observedAt?.['format'] === 'date-time' &&
    snapshotRevision?.['type'] === 'string' &&
    arrayIncludes(correlationStrength?.['enum'], 'STRICT_CORRELATED') &&
    arrayIncludes(correlationStrength?.['enum'], 'MISMATCH') &&
    observationAuthority?.['type'] === 'string' &&
    positionAuthority?.['type'] === 'object' &&
    positionAuthority['additionalProperties'] === false &&
    requiredContains(positionAuthority['required'], [
      'field',
      'topic',
      'observedAt',
      'timeAuthority',
      'cursor',
    ]) &&
    schemaAllowsString(positionProperties?.['field']) &&
    record(positionProperties?.['topic'])?.['type'] === 'string' &&
    canonical(positionProperties?.['observedAt']) === canonical({ type: 'string' }) &&
    arrayIncludes(timeAuthority?.['enum'], 'source') &&
    arrayIncludes(timeAuthority?.['enum'], 'ingest') &&
    record(positionProperties?.['cursor'])?.['type'] === 'string'
  );
}

function assertGetStateInputSchema(value: unknown): void {
  const input = record(value);
  const properties = record(input?.['properties']);
  const include = record(properties?.['include']);
  const includeItems = record(include?.['items']);
  if (
    input?.['type'] !== 'object' ||
    input['additionalProperties'] !== false ||
    !requiredContains(input['required'], ['resourceId']) ||
    !schemaAllowsExactResource(record(properties?.['resourceId']), EXPECTED_RESOURCE_ID) ||
    include?.['type'] !== 'array' ||
    include['uniqueItems'] !== true ||
    !arrayIncludes(includeItems?.['enum'], 'chassis')
  )
    fail(
      'UAP_GET_STATE_INPUT_SCHEMA_INVALID',
      'vehicle_get_state input does not admit the exact authoritative chassis read.',
    );
}

function assertGetStateOutputSchema(value: unknown): void {
  exactOutputSuccessBranch(
    value,
    getStateSuccessOutputSchema,
    'UAP_GET_STATE_OUTPUT_SCHEMA_INVALID',
    'vehicle_get_state output does not retain one exact success and business-result branch.',
  );
}

function getStateSuccessOutputSchema(value: unknown): boolean {
  const output = record(value);
  const properties = record(output?.['properties']);
  const identity = record(properties?.['identity']);
  const identityProperties = record(identity?.['properties']);
  const connectivity = record(properties?.['connectivity']);
  const freshness = record(properties?.['freshness']);
  const freshnessProperties = record(freshness?.['properties']);
  const revision = record(properties?.['revision']);
  const observedAt = record(properties?.['observedAt']);
  const cursor = record(properties?.['mqttIngressSequence']);
  return (
    output?.['type'] === 'object' &&
    output['additionalProperties'] === false &&
    requiredContains(output['required'], [
      'identity',
      'connectivity',
      'freshness',
      'revision',
      'observedAt',
      'mqttIngressSequence',
    ]) &&
    identity?.['type'] === 'object' &&
    identity['additionalProperties'] === false &&
    requiredContains(identity['required'], [
      'providerId',
      'resourceId',
      'vehicleType',
      'executionMode',
    ]) &&
    record(identityProperties?.['providerId'])?.['type'] === 'string' &&
    schemaAllowsExactResource(record(identityProperties?.['resourceId']), EXPECTED_RESOURCE_ID) &&
    record(identityProperties?.['vehicleType'])?.['type'] === 'string' &&
    arrayIncludes(record(identityProperties?.['executionMode'])?.['enum'], 'simulation') &&
    connectivity?.['type'] === 'object' &&
    freshness?.['type'] === 'object' &&
    record(freshnessProperties?.['chassisObservedAt'])?.['format'] === 'date-time' &&
    record(properties?.['chassis'])?.['type'] === 'object' &&
    revision?.['type'] === 'string' &&
    revision['minLength'] === 1 &&
    observedAt?.['format'] === 'date-time' &&
    cursor?.['type'] === 'integer' &&
    cursor['minimum'] === 0
  );
}

function assertProviderMatchesMaterialization(
  provider: ProviderAuthority,
  reportValue: SmppProviderMaterializationReport,
): void {
  const materialized = reportValue.providers[0];
  if (materialized === undefined)
    fail(
      'UAP_PROVIDER_MATERIALIZATION_DRIFT',
      'The materialization result and current Provider/Catalog authority differ.',
    );
  if (
    provider.binding.revision !== materialized.bindingRevision ||
    provider.binding.catalogRevision !== materialized.catalogRevision ||
    provider.binding.catalogChecksum !== materialized.catalogChecksum ||
    provider.server.toolRevision !== materialized.runtimeToolRevision
  )
    fail(
      'UAP_PROVIDER_MATERIALIZATION_DRIFT',
      'The materialization result and current Provider/Catalog authority differ.',
    );
}

async function assertGovernanceInventoryExact(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  packageAuthority: PackageAuthority,
  observedAt: string,
  request: typeof fetch,
  allowMissing: boolean,
): Promise<void> {
  const [controlSkills, runtimeSkills, capabilities, exposures, managedCards] = await Promise.all([
    controlCollection(configuration, '/api/v1/skills?pageSize=200', ControlSkillSchema, request),
    runtimeCollection(configuration, '/api/v1/skills?pageSize=200', RuntimeSkillSchema, request),
    controlCollection(
      configuration,
      '/api/v1/node-capabilities?pageSize=200',
      CapabilitySchema,
      request,
    ),
    controlCollection(configuration, '/api/v1/a2a-exposures?pageSize=200', ExposureSchema, request),
    controlCollection(
      configuration,
      '/api/v1/a2a-agent-card-revisions?pageSize=200',
      AgentCardRevisionSchema,
      request,
    ),
  ]);
  const activeManagedCards = managedCards.filter(({ status }) => status === 'active');
  if (activeManagedCards.length > 1)
    fail('UAP_MANAGED_CARD_CARDINALITY_INVALID', 'Node Control has multiple active Agent Cards.');
  if (
    controlSkills.some((skill) => skill.skillId !== SKILL_ID || Number(skill.version) !== 1) ||
    runtimeSkills.some((skill) => skill.skillId !== SKILL_ID || skill.version !== 1) ||
    capabilities.some(
      (capability) => capability.capabilityId !== CAPABILITY_ID || capability.version !== 1,
    ) ||
    exposures.some((exposure) => exposure.exposureId !== EXPOSURE_ID || exposure.version !== 1)
  )
    fail(
      'UAP_EXTRA_GOVERNANCE_AUTHORITY_FORBIDDEN',
      'The clean Profile database contains an extra Skill, Capability, or Exposure.',
    );
  for (const [label, values] of [
    ['Control Skill', controlSkills],
    ['Runtime Skill', runtimeSkills],
    ['Capability', capabilities],
    ['Exposure', exposures],
  ] as const)
    if (values.length > 1 || (!allowMissing && values.length !== 1))
      fail('UAP_AUTHORITY_CARDINALITY_INVALID', `${label} authority is not exactly one.`);
  const existingRuntimeSkill = runtimeSkills[0];
  if (existingRuntimeSkill !== undefined)
    assertRuntimeSkillExact(existingRuntimeSkill, packageAuthority, false);
  const existingControlSkill = controlSkills[0];
  if (existingControlSkill !== undefined)
    assertControlSkillExact(existingControlSkill, packageAuthority);
  const existingCapability = capabilities[0];
  const existingExposure = exposures[0];
  if (existingCapability === undefined) {
    if (existingExposure !== undefined || activeManagedCards.length !== 0)
      fail(
        'UAP_EXPOSURE_DRIFT',
        'Exposure or managed Card cannot exist without exact Capability authority.',
      );
    return;
  }
  const provider = await loadProviderAuthority(configuration, observedAt, request);
  const planned = plannedGovernance(configuration, packageAuthority, provider);
  assertCapabilityExact(existingCapability, planned.definition);
  const [implementations, readiness] = await Promise.all([
    loadImplementations(configuration, request),
    controlGetOptionalWithEtag(
      configuration,
      `/api/v1/capability-readiness/${encodeURIComponent(CAPABILITY_ID)}/1`,
      ReadinessSchema,
      request,
    ),
  ]);
  if (
    implementations.length > 1 ||
    (!allowMissing && implementations.length !== 1) ||
    (implementations[0] !== undefined &&
      canonical(implementations[0]) !== canonical(planned.implementation))
  )
    fail(
      'UAP_CAPABILITY_IMPLEMENTATION_INVALID',
      'Pre-existing Capability implementation authority is not sole and exact.',
    );
  if (readiness !== undefined) {
    assertReadinessSnapshotHash(readiness.value, etagHash(readiness.etag));
    if (allowMissing) assertReadinessReconciliable(readiness.value, observedAt);
    else assertReadinessExact(readiness.value, observedAt);
  } else if (!allowMissing) {
    fail('UAP_CAPABILITY_READINESS_INVALID', 'Exact Capability readiness authority is missing.');
  }
  if (existingExposure !== undefined) assertExposureExact(existingExposure, planned.exposure);
  const activeManagedCard = activeManagedCards[0];
  if (readiness === undefined || existingExposure === undefined) {
    if (activeManagedCard !== undefined)
      fail(
        'UAP_MANAGED_CARD_AUTHORITY_INVALID',
        'An active managed Card cannot outlive incomplete readiness or Exposure authority.',
      );
    return;
  }
  if (activeManagedCard === undefined) {
    if (!allowMissing)
      fail('UAP_MANAGED_CARD_AUTHORITY_INVALID', 'The exact active managed Card is missing.');
    return;
  }
  const directManagedCard = AgentCardRevisionSchema.parse(
    await controlGet(
      configuration,
      `/api/v1/a2a-agent-card-revisions/${String(activeManagedCard.revision)}`,
      request,
    ),
  );
  const expectedCatalogHash = sha256(
    canonical([
      {
        capabilityId: CAPABILITY_ID,
        capabilityVersion: 1,
        exposureHash: existingExposure.exposureHash,
        readinessHash: etagHash(readiness.etag),
      },
    ]),
  );
  if (
    canonical(activeManagedCard) !== canonical(directManagedCard) ||
    !sameStrings(activeManagedCard.exposureRefs ?? [], [`${EXPOSURE_ID}:1`]) ||
    Date.parse(activeManagedCard.generatedAt) > Date.parse(observedAt) ||
    (!allowMissing && activeManagedCard.capabilityCatalogHash !== expectedCatalogHash)
  )
    fail(
      'UAP_MANAGED_CARD_AUTHORITY_INVALID',
      'The active managed Card does not exactly project Exposure and readiness authority.',
    );
}

async function ensureSkill(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  packageAuthority: PackageAuthority,
  request: typeof fetch,
): Promise<RuntimeSkill> {
  const importOperation = OperationSchema.parse(
    await controlPost(
      configuration,
      '/api/v1/skills/import',
      stableKey(configuration.runId, 'skill-import', EXPECTED_PACKAGE_CHECKSUM),
      {
        reason: 'Import the immutable embodied.move_to@1 UGV Agent Profile package.',
        payload: { packageRoot: configuration.skillPackageRoot },
      },
      202,
      request,
    ),
  );
  assertSkillOperation(importOperation, 'skill.import');
  const controlSkill = ControlSkillSchema.parse(
    await controlGet(
      configuration,
      `/api/v1/skills/${encodeURIComponent(SKILL_ID)}/versions/1`,
      request,
    ),
  );
  assertControlSkillExact(controlSkill, packageAuthority);
  let governance = await latestSkillGovernanceState(configuration, request, [importOperation]);
  if (governance.status !== 'published') {
    if (!['validated', 'suspended'].includes(governance.status))
      fail('UAP_SKILL_LIFECYCLE_INVALID', 'The exact Skill is not publishable.');
    const expectedRevision = governance.revision;
    const publish = OperationSchema.parse(
      await controlPost(
        configuration,
        `/api/v1/skills/${encodeURIComponent(SKILL_ID)}/versions/1/publish`,
        stableKey(
          configuration.runId,
          'skill-publish',
          `${SKILL_ID}:1:${String(expectedRevision)}`,
        ),
        {
          reason: 'Publish exact embodied.move_to@1 without creating a successor version.',
          expectedRevision,
        },
        202,
        request,
      ),
    );
    assertSkillOperation(publish, 'skill.publish');
    governance = requiredSkillGovernanceState(publish, 'published');
    if (governance.revision !== expectedRevision + 1)
      fail('UAP_SKILL_GOVERNANCE_REVISION_INVALID', 'Skill publish revision did not advance once.');
  }
  if (governance.status !== 'published')
    fail('UAP_SKILL_NOT_PUBLISHED', 'The exact embodied.move_to@1 Skill was not published.');
  const versions = await controlCollection(
    configuration,
    `/api/v1/skills/${encodeURIComponent(SKILL_ID)}/versions?pageSize=200`,
    ControlSkillSchema,
    request,
  );
  if (versions.length !== 1 || Number(versions[0]?.version) !== 1)
    fail(
      'UAP_SKILL_VERSION_CARDINALITY_INVALID',
      'Bootstrap must retain exactly embodied.move_to@1 without a successor version.',
    );
  const runtimeSkill = RuntimeSkillSchema.parse(
    await runtimeGet(
      configuration,
      `/api/v1/skills/${encodeURIComponent(SKILL_ID)}/versions/1`,
      request,
    ),
  );
  assertRuntimeSkillExact(runtimeSkill, packageAuthority, true);
  return runtimeSkill;
}

function assertSkillOperation(
  operation: z.infer<typeof OperationSchema>,
  expectedType: 'skill.import' | 'skill.publish' | 'skill.suspend',
): void {
  if (operation.operationType !== expectedType)
    fail('UAP_SKILL_OPERATION_INVALID', 'The exact Skill governance operation did not succeed.');
  const runtime = record(record(operation.result)?.['runtimeOperation']);
  if (
    runtime?.['operationType'] !== expectedType ||
    runtime['status'] !== 'succeeded' ||
    record(runtime['target'])?.['id'] !== SKILL_ID ||
    String(record(runtime['target'])?.['version']) !== '1'
  )
    fail(
      'UAP_SKILL_RUNTIME_OPERATION_INVALID',
      'Node Control did not preserve the exact Runtime Skill operation authority.',
    );
}

interface SkillGovernanceState {
  readonly status: 'draft' | 'validated' | 'published' | 'suspended' | 'deprecated' | 'retired';
  readonly revision: number;
}

async function latestSkillGovernanceState(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  request: typeof fetch,
  supplemental: readonly z.infer<typeof OperationSchema>[] = [],
): Promise<SkillGovernanceState> {
  const operations = await controlCollection(
    configuration,
    '/api/v1/management-operations?pageSize=200',
    OperationSchema,
    request,
  );
  const candidates = [...supplemental, ...operations]
    .map((operation) => ({ operation, state: skillGovernanceState(operation) }))
    .filter(
      (
        item,
      ): item is Readonly<{
        operation: z.infer<typeof OperationSchema>;
        state: SkillGovernanceState;
      }> => item.state !== undefined,
    )
    .sort((left, right) => {
      const leftAt = Date.parse(left.operation.completedAt ?? '1970-01-01T00:00:00.000Z');
      const rightAt = Date.parse(right.operation.completedAt ?? '1970-01-01T00:00:00.000Z');
      return right.state.revision - left.state.revision || rightAt - leftAt;
    });
  const latest = candidates[0];
  if (latest !== undefined) return latest.state;
  return fail(
    'UAP_SKILL_GOVERNANCE_REVISION_UNAVAILABLE',
    'The current exact Skill lifecycle status and revision are not recoverable from governance evidence.',
  );
}

function skillGovernanceState(
  operation: z.infer<typeof OperationSchema>,
): SkillGovernanceState | undefined {
  if (!['skill.import', 'skill.publish', 'skill.suspend'].includes(operation.operationType))
    return undefined;
  const runtime = record(record(operation.result)?.['runtimeOperation']);
  const target = record(runtime?.['target']);
  const result = record(runtime?.['result']);
  const revision = result?.['governanceRevision'];
  const status = result?.['status'];
  if (
    runtime?.['status'] !== 'succeeded' ||
    target?.['id'] !== SKILL_ID ||
    String(target['version']) !== '1' ||
    !['draft', 'validated', 'published', 'suspended', 'deprecated', 'retired'].includes(
      String(status),
    ) ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    return undefined;
  return Object.freeze({ status: status as SkillGovernanceState['status'], revision });
}

function requiredSkillGovernanceState(
  operation: z.infer<typeof OperationSchema>,
  expectedStatus: SkillGovernanceState['status'],
): SkillGovernanceState {
  const state = skillGovernanceState(operation);
  if (state?.status !== expectedStatus)
    return fail(
      'UAP_SKILL_GOVERNANCE_RESULT_INVALID',
      'Skill lifecycle result does not contain the exact expected governance authority.',
    );
  return state;
}

function assertControlSkillExact(
  skill: z.infer<typeof ControlSkillSchema>,
  expected: PackageAuthority,
): void {
  if (
    skill.skillId !== SKILL_ID ||
    Number(skill.version) !== 1 ||
    canonical(skill.inputSchema) !== canonical(expected.inputSchema) ||
    canonical(skill.outputSchema) !== canonical(expected.outputSchema) ||
    canonical(skill.usageSpecification) !== canonical(expected.usageSpecification)
  )
    fail('UAP_CONTROL_SKILL_DRIFT', 'The governed Skill view differs from the formal package.');
}

function assertRuntimeSkillExact(
  skill: RuntimeSkill,
  expected: PackageAuthority,
  requireEnabled: boolean,
): void {
  if (
    skill.skillId !== SKILL_ID ||
    skill.version !== 1 ||
    (requireEnabled && skill.status !== 'enabled') ||
    !sameStrings(skill.capabilities, ['embodied.move', 'embodied.navigation']) ||
    canonical(skill.inputSchema) !== canonical(expected.inputSchema) ||
    canonical(skill.outputSchema) !== canonical(expected.outputSchema) ||
    canonical(skill.toolPolicy) !== canonical({ required: [], optional: [], forbidden: [] }) ||
    canonical(skill.runtimePolicy) !==
      canonical({
        maxDurationSeconds: 600,
        maxMcpCalls: 8,
        maxReplans: 1,
        autoConfirmPlan: false,
        cancelStrategy: 'try_interrupt',
      }) ||
    canonical(skill.usageSpecification) !== canonical(expected.usageSpecification)
  )
    fail('UAP_RUNTIME_SKILL_DRIFT', 'The Runtime Skill differs from the formal package authority.');
}

interface PlannedGovernance {
  readonly definition: NodeCapabilityDefinitionVersion;
  readonly implementation: CapabilityImplementationBinding;
  readonly exposure: A2aExposureVersion;
}

function plannedGovernance(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  packageAuthority: PackageAuthority,
  provider: ProviderAuthority,
): PlannedGovernance {
  const inputSchema: JsonObject = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: Object.freeze(['resourceId', 'target']),
    properties: Object.freeze({
      resourceId: Object.freeze({ const: EXPECTED_RESOURCE_ID }),
      target: Object.freeze({
        type: 'object',
        additionalProperties: false,
        required: Object.freeze(['x', 'y', 'frame']),
        properties: Object.freeze({
          x: Object.freeze({ type: 'number', minimum: -180, maximum: 180 }),
          y: Object.freeze({ type: 'number', minimum: -90, maximum: 90 }),
          frame: Object.freeze({ const: 'WGS84' }),
        }),
      }),
    }),
  });
  const outputSchema: JsonObject = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: Object.freeze(['resourceId', 'status', 'finalPosition']),
    properties: Object.freeze({
      resourceId: Object.freeze({ const: EXPECTED_RESOURCE_ID }),
      status: Object.freeze({ const: 'completed' }),
      finalPosition: Object.freeze({
        type: 'object',
        additionalProperties: false,
        required: Object.freeze(['x', 'y', 'frame']),
        properties: Object.freeze({
          x: Object.freeze({ type: 'number' }),
          y: Object.freeze({ type: 'number' }),
          frame: Object.freeze({ const: 'EPSG:4326' }),
        }),
      }),
    }),
  });
  const constraints = Object.freeze([
    Object.freeze({
      type: 'resource_policy',
      identifierAuthority: 'public_smpp_tool_schema',
      selection: 'exact_value',
      allowedResourceIds: Object.freeze([EXPECTED_RESOURCE_ID]),
      downstreamResourceBinding: 'forbidden',
    }),
    Object.freeze({
      type: 'provider_binding_policy',
      mcpProviderBindingId: provider.binding.bindingId,
      localServerId: provider.binding.localServerId,
      mcpToolName: NAVIGATE_TOOL,
      allowedResourceIds: Object.freeze([EXPECTED_RESOURCE_ID]),
      bindingRevision: provider.binding.revision,
      catalogRevision: provider.binding.catalogRevision,
      catalogChecksum: provider.binding.catalogChecksum,
      taskBehavior: 'task_required',
      executionSemantics: Object.freeze({ ...provider.navigate.executionSemantics }),
      requiredStatus: 'active',
      requiredAvailabilityStatus: 'available',
      requiredFreshness: 'unexpired',
      fallback: 'deny',
    }),
    Object.freeze({
      type: 'exact_skill_version',
      skillId: SKILL_ID,
      skillVersion: 1,
      taskType: CAPABILITY_ID,
    }),
    Object.freeze({
      type: 'confirmation_policy',
      required: true,
      stage: 'before_execution',
      autoConfirmPlan: false,
    }),
    Object.freeze({
      type: 'physical_side_effect_policy',
      sideEffecting: true,
      dispatchMaximum: 1,
      uncertainDispatchPolicy: 'reconcile_never_redispatch',
      remoteTaskTerminalEvidenceRequired: true,
    }),
    Object.freeze({
      type: 'runtime_execution_mode_policy',
      mode: 'simulation',
      simulationId: configuration.simulationRunId,
    }),
    Object.freeze({
      type: 'ugv_simulation_target_policy',
      policyId: 'ugv-agent-profile/simulation-short-move',
      revision: 1,
      executionMode: 'simulation',
      resourceId: EXPECTED_RESOURCE_ID,
      frame: 'WGS84',
      targetDerivation: 'deterministic_short_distance',
      bearingDegrees: 90,
      distanceM: 1,
      maximumDistanceM: 2,
      forbiddenRegions: Object.freeze([]),
    }),
  ]);
  const definition = createNodeCapabilityDefinition({
    capabilityId: CAPABILITY_ID,
    version: 1,
    domain: 'embodied',
    name: 'Move UGV',
    description: 'Move the exact simulated UGV with terminal position evidence.',
    inputSchema,
    outputSchema,
    successCriteria: Object.freeze([
      Object.freeze({ type: 'output_schema_valid', required: true }),
      Object.freeze({ type: 'resource_identity_matches_request', required: true }),
      Object.freeze({ type: 'required_evidence_complete', required: true }),
      Object.freeze({ type: 'remote_task_identity_present', required: true }),
      Object.freeze({ type: 'remote_terminal_observation_present', required: true }),
      Object.freeze({ type: 'external_command_dispatch_count', maximum: 1 }),
    ]),
    requiredEvidence: Object.freeze([
      Object.freeze({
        type: 'required_evidence',
        evidenceType: 'position.observation',
        required: true,
        hardGate: true,
      }),
    ]),
    effects: Object.freeze(['effect.final_position']),
    artifacts: Object.freeze([]),
    constraints,
    supportedModes: Object.freeze(['plan_confirmed', 'remote_task']),
    riskLevel: 'high',
    status: 'draft',
  });
  const implementation = createCapabilityImplementationBinding({
    bindingId: IMPLEMENTATION_BINDING_ID,
    capabilityId: CAPABILITY_ID,
    capabilityVersion: 1,
    implementationType: 'skill',
    implementationId: SKILL_ID,
    implementationVersion: '1',
    role: 'primary',
    priority: 0,
    providerPolicyOverride: Object.freeze({
      selection: 'required',
      mcpProviderBindingId: provider.binding.bindingId,
      localServerId: provider.binding.localServerId,
      mcpToolName: NAVIGATE_TOOL,
      allowedResourceIds: Object.freeze([EXPECTED_RESOURCE_ID]),
      requireActive: true,
      requireAvailable: true,
      requireUnexpiredFreshness: true,
      denyFallback: true,
    }),
    status: 'active',
    revision: 1,
  });
  const exposure = createA2aExposureVersion({
    exposureId: EXPOSURE_ID,
    version: 1,
    capabilityId: CAPABILITY_ID,
    capabilityVersion: 1,
    agentSkillId: SKILL_ID,
    name: definition.name,
    description: definition.description,
    tags: Object.freeze(['ugv-agent-profile', 'external-simulation', 'embodied-move']),
    examples: Object.freeze([
      'Move vehicle:ugv1 to the exact authorized short-distance simulation target.',
    ]),
    inputModes: Object.freeze(['text/plain', 'application/json']),
    outputModes: Object.freeze(['application/json']),
    requestSchema: definition.inputSchema,
    resultSchema: definition.outputSchema,
    visibility: 'public',
    requesterPolicy: Object.freeze({
      allowAnonymous: false,
      allowedRequesterIds: Object.freeze(['ugv-agent-profile']),
    }),
    readinessPublicationPolicy: 'publish_when_available',
    status: 'draft',
  });
  if (
    sha256(canonical(packageAuthority.usageSpecification)) !==
    '9801dd4ea424a1b925e51a273a5712f082e41daacbf76f7df9d8595c48b01b87'
  )
    fail('UAP_SKILL_USAGE_DRIFT', 'Capability planning requires the exact formal Skill Usage.');
  return Object.freeze({ definition, implementation, exposure });
}

async function ensureCapability(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  planned: PlannedGovernance,
  request: typeof fetch,
): Promise<Capability> {
  const path = `/api/v1/node-capabilities/${encodeURIComponent(CAPABILITY_ID)}/versions/1`;
  let current = await controlGetOptional(configuration, path, CapabilitySchema, request);
  current ??= CapabilitySchema.parse(
    await controlPost(
      configuration,
      '/api/v1/node-capabilities',
      stableKey(configuration.runId, 'capability-create', planned.definition.definitionHash),
      planned.definition,
      201,
      request,
    ),
  );
  assertCapabilityExact(current, planned.definition);
  let implementations = await loadImplementations(configuration, request);
  if (implementations.length === 0) {
    ImplementationSchema.parse(
      await controlPost(
        configuration,
        `${path}/implementations`,
        stableKey(
          configuration.runId,
          'capability-implementation',
          canonical(planned.implementation),
        ),
        planned.implementation,
        201,
        request,
      ),
    );
    implementations = await loadImplementations(configuration, request);
  }
  if (
    implementations.length !== 1 ||
    canonical(implementations[0]) !== canonical(planned.implementation)
  )
    fail(
      'UAP_CAPABILITY_IMPLEMENTATION_INVALID',
      'embodied.move@1 must have one exact active primary Skill implementation.',
    );
  if (current.status === 'draft') {
    current = CapabilitySchema.parse(
      await controlPost(
        configuration,
        `${path}/validate`,
        stableKey(configuration.runId, 'capability-validate', planned.definition.definitionHash),
        { reason: 'Validate exact embodied.move@1 UGV Profile authority.' },
        200,
        request,
        nodeCapabilityEtag(current as NodeCapabilityDefinitionVersion),
      ),
    );
  }
  if (current.status === 'validating') {
    OperationSchema.parse(
      await controlPost(
        configuration,
        `${path}/publish`,
        stableKey(configuration.runId, 'capability-publish', planned.definition.definitionHash),
        { reason: 'Publish exact embodied.move@1 UGV Profile authority.' },
        202,
        request,
        nodeCapabilityEtag(current as NodeCapabilityDefinitionVersion),
      ),
    );
    current = CapabilitySchema.parse(await controlGet(configuration, path, request));
  }
  if (current.status !== 'published')
    fail('UAP_CAPABILITY_NOT_PUBLISHED', 'The exact embodied.move@1 Capability is not published.');
  assertCapabilityExact(current, planned.definition);
  return current;
}

async function loadImplementations(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  request: typeof fetch,
): Promise<readonly Implementation[]> {
  return controlCollection(
    configuration,
    `/api/v1/node-capabilities/${encodeURIComponent(CAPABILITY_ID)}/versions/1/implementations?pageSize=200`,
    ImplementationSchema,
    request,
  );
}

function assertCapabilityExact(
  actual: Capability,
  expected: NodeCapabilityDefinitionVersion,
): void {
  if (
    actual.capabilityId !== CAPABILITY_ID ||
    actual.version !== 1 ||
    actual.definitionHash !== expected.definitionHash ||
    canonical({ ...actual, status: 'draft' }) !== canonical({ ...expected, status: 'draft' }) ||
    actual.constraints?.length !== 7
  )
    fail(
      'UAP_CAPABILITY_DEFINITION_DRIFT',
      'The existing embodied.move@1 business promises differ from the exact Profile definition.',
    );
}

async function ensureReadiness(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  provider: ProviderAuthority,
  planned: PlannedGovernance,
  capability: Capability,
  now: () => string,
  pause: (milliseconds: number) => Promise<void>,
  request: typeof fetch,
): Promise<Readonly<{ snapshot: Readiness; snapshotHash: string }>> {
  const path = `/api/v1/capability-readiness/${encodeURIComponent(CAPABILITY_ID)}/1`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prior = await controlGetOptionalWithEtag(configuration, path, ReadinessSchema, request);
    const fingerprint = sha256(
      canonical({
        attempt,
        definitionHash: capability.definitionHash,
        implementation: planned.implementation,
        provider: provider.fingerprint,
        priorSnapshot: prior?.etag ?? 'absent',
      }),
    );
    const operation = OperationSchema.parse(
      await controlPost(
        configuration,
        `${path}/evaluate`,
        stableKey(configuration.runId, `capability-readiness-${String(attempt)}`, fingerprint),
        { reason: `Evaluate exact embodied.move@1 Profile readiness (${fingerprint}).` },
        202,
        request,
      ),
    );
    const operationSnapshot = ReadinessSchema.parse(operation.result);
    const current = await controlGetWithEtag(configuration, path, ReadinessSchema, request);
    if (canonical(operationSnapshot) !== canonical(current.value))
      fail(
        'UAP_READINESS_OPERATION_DRIFT',
        'The readiness operation result differs from the current persisted snapshot.',
      );
    const snapshotHash = etagHash(current.etag);
    assertReadinessSnapshotHash(current.value, snapshotHash);
    // Evaluation is a mutation and may complete after the bootstrap's initial observation.
    // Sample the driver clock only after the persisted snapshot has been re-read so a valid
    // newly evaluated snapshot is not compared with a stale pre-operation timestamp.
    const readinessObservedAt = validTimestamp(now());
    if (exactFreshReadiness(current.value, readinessObservedAt))
      return Object.freeze({ snapshot: current.value, snapshotHash });
    if (!readinessStabilityWindow(current.value, readinessObservedAt))
      assertReadinessExact(current.value, readinessObservedAt);
    if (attempt === 2)
      fail(
        'UAP_CAPABILITY_READINESS_STABILITY_TIMEOUT',
        'embodied.move@1 readiness did not leave its bounded stability window.',
      );
    await pause(10_250);
  }
  return fail('UAP_CAPABILITY_READINESS_INVALID', 'Capability readiness was not recorded.');
}

function exactFreshReadiness(value: Readiness, observedAt: string): boolean {
  return (
    value.capabilityId === CAPABILITY_ID &&
    value.capabilityVersion === 1 &&
    value.status === 'available' &&
    Date.parse(value.evaluatedAt) <= Date.parse(observedAt) &&
    Date.parse(value.validUntil) > Date.parse(observedAt) &&
    PREFIXED_CHECKSUM.test(value.catalogHash) &&
    PREFIXED_CHECKSUM.test(value.policyHash) &&
    value.reasons.every(({ severity }) => severity !== 'blocking') &&
    sameStrings(value.availableImplementations ?? [], [IMPLEMENTATION_BINDING_ID]) &&
    (value.unavailableImplementations ?? []).length === 0
  );
}

function assertReadinessExact(value: Readiness, observedAt: string): void {
  if (!exactFreshReadiness(value, observedAt))
    fail(
      'UAP_CAPABILITY_READINESS_INVALID',
      'embodied.move@1 readiness is not fresh, available, and exact to the sole implementation.',
    );
}

function assertReadinessReconciliable(value: Readiness, observedAt: string): void {
  const evaluatedAt = Date.parse(value.evaluatedAt);
  const validUntil = Date.parse(value.validUntil);
  const observation = Date.parse(observedAt);
  const exactAvailablePartition =
    sameStrings(value.availableImplementations ?? [], [IMPLEMENTATION_BINDING_ID]) &&
    (value.unavailableImplementations ?? []).length === 0;
  const exactUnavailablePartition =
    (value.availableImplementations ?? []).length === 0 &&
    sameStrings(value.unavailableImplementations ?? [], [IMPLEMENTATION_BINDING_ID]);
  const hasBlockingReason = value.reasons.some(({ severity }) => severity === 'blocking');
  const coherentAuthority =
    (value.status === 'available' && exactAvailablePartition && !hasBlockingReason) ||
    (value.status === 'unavailable' && exactUnavailablePartition && hasBlockingReason) ||
    readinessStabilityWindow(value);
  if (
    value.capabilityId !== CAPABILITY_ID ||
    value.capabilityVersion !== 1 ||
    evaluatedAt > observation ||
    validUntil <= evaluatedAt ||
    !coherentAuthority
  )
    fail(
      'UAP_CAPABILITY_READINESS_INVALID',
      'Pre-existing embodied.move@1 readiness is not an exact, safely reconcilable snapshot.',
    );
}

function readinessStabilityWindow(value: Readiness, observedAt?: string): boolean {
  return (
    value.capabilityId === CAPABILITY_ID &&
    value.capabilityVersion === 1 &&
    ['degraded', 'unavailable'].includes(value.status) &&
    sameStrings(value.availableImplementations ?? [], [IMPLEMENTATION_BINDING_ID]) &&
    (value.unavailableImplementations ?? []).length === 0 &&
    value.reasons.some(({ code }) => code === 'READINESS_STABILITY_WINDOW') &&
    value.reasons.every(({ severity }) => severity !== 'blocking') &&
    (observedAt === undefined ||
      (Date.parse(value.evaluatedAt) <= Date.parse(observedAt) &&
        Date.parse(value.validUntil) > Date.parse(observedAt)))
  );
}

function assertReadinessSnapshotHash(value: Readiness, snapshotHash: string): void {
  if (`sha256:${sha256(JSON.stringify(value))}` !== snapshotHash)
    fail(
      'UAP_CAPABILITY_READINESS_HASH_INVALID',
      'Capability readiness body and formal snapshot hash differ.',
    );
}

async function ensureExposure(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  expected: A2aExposureVersion,
  request: typeof fetch,
): Promise<Exposure> {
  const path = `/api/v1/a2a-exposures/${encodeURIComponent(EXPOSURE_ID)}/versions/1`;
  let current = await controlGetOptional(configuration, path, ExposureSchema, request);
  current ??= ExposureSchema.parse(
    await controlPost(
      configuration,
      '/api/v1/a2a-exposures',
      stableKey(configuration.runId, 'exposure-create', expected.exposureHash),
      expected,
      201,
      request,
    ),
  );
  assertExposureExact(current, expected);
  if (current.status === 'retired')
    fail('UAP_EXPOSURE_RETIRED', 'A retired exact Exposure cannot be restored in place.');
  if (current.status !== 'published') {
    const operation = OperationSchema.parse(
      await controlPost(
        configuration,
        `${path}/publish`,
        stableKey(
          configuration.runId,
          'exposure-publish',
          `${expected.exposureHash}:${current.status}`,
        ),
        { reason: 'Publish exact a2a.embodied.move@1 Exposure.' },
        202,
        request,
        a2aExposureEtag(current as A2aExposureVersion),
      ),
    );
    const result = ExposureSchema.parse(operation.result);
    if (result.status !== 'published')
      fail('UAP_EXPOSURE_NOT_PUBLISHED', 'The exact A2A Exposure was not published.');
    current = ExposureSchema.parse(await controlGet(configuration, path, request));
  }
  assertExposureExact(current, expected);
  if (current.status !== 'published')
    fail('UAP_EXPOSURE_NOT_PUBLISHED', 'The exact A2A Exposure is not published.');
  return current;
}

function assertExposureExact(actual: Exposure, expected: A2aExposureVersion): void {
  if (
    actual.exposureId !== EXPOSURE_ID ||
    actual.version !== 1 ||
    actual.capabilityId !== CAPABILITY_ID ||
    actual.capabilityVersion !== 1 ||
    actual.agentSkillId !== SKILL_ID ||
    actual.exposureHash !== expected.exposureHash ||
    canonical({ ...actual, status: 'draft' }) !== canonical({ ...expected, status: 'draft' })
  )
    fail('UAP_EXPOSURE_DRIFT', 'The A2A Exposure differs from the exact Profile contract.');
}

async function ensureManagedCard(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  exposure: Exposure,
  readiness: Readonly<{ snapshot: Readiness; snapshotHash: string }>,
  request: typeof fetch,
): Promise<AgentCardRevision> {
  const desiredCatalogHash = sha256(
    canonical([
      {
        capabilityId: CAPABILITY_ID,
        capabilityVersion: 1,
        exposureHash: exposure.exposureHash,
        readinessHash: readiness.snapshotHash,
      },
    ]),
  );
  let active = await loadActiveManagedCard(configuration, request);
  if (
    active === undefined ||
    !sameStrings(active.exposureRefs ?? [], [`${EXPOSURE_ID}:1`]) ||
    active.capabilityCatalogHash !== desiredCatalogHash
  ) {
    const prior =
      active === undefined
        ? 'absent'
        : `${String(active.revision)}:${active.contentHash}:${active.capabilityCatalogHash}`;
    const operation = OperationSchema.parse(
      await controlPost(
        configuration,
        '/api/v1/a2a-agent-card-revisions/rebuild',
        stableKey(configuration.runId, 'managed-card-rebuild', `${prior}:${desiredCatalogHash}`),
        { reason: 'Rebuild the sole Node Control managed embodied.move Exposure Card.' },
        202,
        request,
      ),
    );
    const result = AgentCardRevisionSchema.parse(operation.result);
    if (result.status !== 'active')
      fail('UAP_MANAGED_CARD_NOT_ACTIVE', 'The rebuilt managed Agent Card is not active.');
    active = await loadActiveManagedCard(configuration, request);
  }
  if (
    active?.status !== 'active' ||
    !sameStrings(active.exposureRefs ?? [], [`${EXPOSURE_ID}:1`]) ||
    active.capabilityCatalogHash !== desiredCatalogHash
  )
    fail(
      'UAP_MANAGED_CARD_AUTHORITY_INVALID',
      'The active managed Agent Card does not contain the sole exact Exposure authority.',
    );
  return active;
}

async function loadActiveManagedCard(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  request: typeof fetch,
): Promise<AgentCardRevision | undefined> {
  const cards = await controlCollection(
    configuration,
    '/api/v1/a2a-agent-card-revisions?pageSize=200',
    AgentCardRevisionSchema,
    request,
  );
  const active = cards.filter(({ status }) => status === 'active');
  if (active.length > 1)
    fail('UAP_MANAGED_CARD_CARDINALITY_INVALID', 'Node Control has multiple active Agent Cards.');
  const summary = active[0];
  if (summary === undefined) return undefined;
  const direct = AgentCardRevisionSchema.parse(
    await controlGet(
      configuration,
      `/api/v1/a2a-agent-card-revisions/${String(summary.revision)}`,
      request,
    ),
  );
  if (canonical(summary) !== canonical(direct))
    fail('UAP_MANAGED_CARD_AUTHORITY_DRIFT', 'Managed Agent Card list and direct reads differ.');
  return direct;
}

async function loadExactGovernanceAuthority(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  packageAuthority: PackageAuthority,
  provider: ProviderAuthority,
  planned: PlannedGovernance,
  observedAt: string,
  request: typeof fetch,
): Promise<GovernanceAuthority> {
  const [
    runtimeSkillValue,
    controlSkillValue,
    capabilityValue,
    implementations,
    readiness,
    exposure,
  ] = await Promise.all([
    runtimeGet(configuration, `/api/v1/skills/${encodeURIComponent(SKILL_ID)}/versions/1`, request),
    controlGet(configuration, `/api/v1/skills/${encodeURIComponent(SKILL_ID)}/versions/1`, request),
    controlGet(
      configuration,
      `/api/v1/node-capabilities/${encodeURIComponent(CAPABILITY_ID)}/versions/1`,
      request,
    ),
    loadImplementations(configuration, request),
    controlGetWithEtag(
      configuration,
      `/api/v1/capability-readiness/${encodeURIComponent(CAPABILITY_ID)}/1`,
      ReadinessSchema,
      request,
    ),
    controlGet(
      configuration,
      `/api/v1/a2a-exposures/${encodeURIComponent(EXPOSURE_ID)}/versions/1`,
      request,
    ),
  ]);
  const skill = RuntimeSkillSchema.parse(runtimeSkillValue);
  const controlSkill = ControlSkillSchema.parse(controlSkillValue);
  const capability = CapabilitySchema.parse(capabilityValue);
  const implementation = implementations[0];
  const exposureValue = ExposureSchema.parse(exposure);
  assertRuntimeSkillExact(skill, packageAuthority, true);
  assertControlSkillExact(controlSkill, packageAuthority);
  const skillGovernance = await latestSkillGovernanceState(configuration, request);
  if (skillGovernance.status !== 'published')
    fail('UAP_CONTROL_SKILL_NOT_PUBLISHED', 'Formal Skill governance is not published.');
  assertCapabilityExact(capability, planned.definition);
  if (capability.status !== 'published')
    fail('UAP_CAPABILITY_NOT_PUBLISHED', 'The exact Capability is not published.');
  if (
    implementations.length !== 1 ||
    implementation === undefined ||
    canonical(implementation) !== canonical(planned.implementation)
  )
    fail(
      'UAP_CAPABILITY_IMPLEMENTATION_INVALID',
      'The exact Capability implementation authority is not sole and current.',
    );
  assertReadinessExact(readiness.value, observedAt);
  assertExposureExact(exposureValue, planned.exposure);
  if (exposureValue.status !== 'published')
    fail('UAP_EXPOSURE_NOT_PUBLISHED', 'The exact Exposure is not published.');
  const managedCard = await loadActiveManagedCard(configuration, request);
  const readinessHash = etagHash(readiness.etag);
  assertReadinessSnapshotHash(readiness.value, readinessHash);
  const expectedCatalogHash = sha256(
    canonical([
      {
        capabilityId: CAPABILITY_ID,
        capabilityVersion: 1,
        exposureHash: exposureValue.exposureHash,
        readinessHash,
      },
    ]),
  );
  if (
    managedCard === undefined ||
    !sameStrings(managedCard.exposureRefs ?? [], [`${EXPOSURE_ID}:1`]) ||
    managedCard.capabilityCatalogHash !== expectedCatalogHash
  )
    fail(
      'UAP_MANAGED_CARD_AUTHORITY_INVALID',
      'The active managed Card does not match exact Capability/Readiness/Exposure authority.',
    );
  // This comparison binds the Capability definition to the exact final Provider revision rather
  // than accepting a stale, otherwise well-formed Profile definition.
  const providerPolicy = (capability.constraints ?? []).find(
    (constraint) => constraint['type'] === 'provider_binding_policy',
  );
  if (
    providerPolicy?.['bindingRevision'] !== provider.binding.revision ||
    providerPolicy['catalogRevision'] !== provider.binding.catalogRevision ||
    providerPolicy['catalogChecksum'] !== provider.binding.catalogChecksum
  )
    fail(
      'UAP_CAPABILITY_PROVIDER_AUTHORITY_DRIFT',
      'Capability constraints do not freeze the current Provider Binding and Catalog.',
    );
  return Object.freeze({
    skill,
    capability,
    implementation,
    readiness: readiness.value,
    readinessHash,
    exposure: exposureValue,
    managedCard,
  });
}

function report(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  packageAuthority: PackageAuthority,
  provider: ProviderAuthority,
  governance: GovernanceAuthority,
  observedAt: string,
  source?: UgvSmppSourceBootstrapReport,
  materialized?: SmppProviderMaterializationReport,
): UgvAgentProfileAuthorityBootstrapReport {
  if (configuration.mode === 'readiness')
    fail('UAP_REPORT_MODE_INVALID', 'Bootstrap report cannot be emitted for readiness mode.');
  const materializedProvider = materialized?.providers[0];
  const value: UgvAgentProfileAuthorityBootstrapReport = Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile-authority-bootstrap/v1',
    status: 'passed',
    mode: configuration.mode,
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    observedAt,
    source: Object.freeze({
      action: source?.sourceAction ?? 'verified',
      sourceIdentitySha256: sha256(EXPECTED_SOURCE_ID),
      registryRevision: provider.binding.registryRevision,
      registryChecksum: provider.binding.registryChecksum,
    }),
    provider: Object.freeze({
      action: materializedProvider?.action ?? 'verified',
      bindingIdentitySha256: sha256(EXPECTED_BINDING_ID),
      bindingRevision: provider.binding.revision,
      catalogRevision: provider.binding.catalogRevision,
      catalogChecksum: provider.binding.catalogChecksum,
      toolCount: 10,
      navigateReplay: 'simulation_only',
    }),
    skill: Object.freeze({
      skillId: SKILL_ID,
      version: 1,
      runtimeStatus: 'enabled',
      governedStatus: 'published',
      packageChecksum: packageAuthority.packageChecksum,
      exactVersionCount: 1,
    }),
    capability: Object.freeze({
      capabilityId: CAPABILITY_ID,
      version: 1,
      status: 'published',
      definitionHash: governance.capability.definitionHash,
      implementationBindingId: IMPLEMENTATION_BINDING_ID,
      implementationCount: 1,
      constraintCount: 7,
    }),
    readiness: Object.freeze({
      status: 'available',
      snapshotVersion: governance.readiness.snapshotVersion,
      snapshotHash: publicSha256(governance.readinessHash),
      validUntil: governance.readiness.validUntil,
    }),
    exposure: Object.freeze({
      exposureId: EXPOSURE_ID,
      version: 1,
      agentSkillId: SKILL_ID,
      status: 'published',
      exposureHash: governance.exposure.exposureHash,
      exactExposureCount: 1,
    }),
    managedCard: Object.freeze({
      authority: 'node_control_exposure',
      distinctFromProfilePublicCard: true,
      status: 'active',
      revision: governance.managedCard.revision,
      exposureRefs: Object.freeze([`${EXPOSURE_ID}:1`] as const),
      contentHash: governance.managedCard.contentHash,
      capabilityCatalogHash: governance.managedCard.capabilityCatalogHash,
    }),
    profilePublicCard: Object.freeze({
      authority: 'enabled_skill_version',
      managedCardUsed: false,
      sourceSkillRef: `${SKILL_ID}:1`,
    }),
    driverActivity: zeroDriverActivity(),
    redaction: redactionDeclaration(),
  });
  assertSafeReport(value, configuration);
  return value;
}

function assertSafeReport(
  value: UgvAgentProfileAuthorityBootstrapReport | UgvAgentProfileAuthorityReadinessReport,
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
): void {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    configuration.nodeControlBearerToken,
    configuration.nodeControlBaseUrl,
    configuration.runtimeManagementBaseUrl,
    configuration.profileA2aBaseUrl,
    configuration.source.registryEndpoint,
    configuration.source.registryCredentialRef,
    configuration.runtimeCredentialRef,
  ])
    if (serialized.includes(forbidden))
      fail('UAP_REPORT_REDACTION_FAILED', 'The authority report contains private configuration.');
  if (
    /https?:\/\//iu.test(serialized) ||
    /"(?:authorization|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|credentialRef)"\s*:/iu.test(
      serialized,
    ) ||
    /(?:bearer\s+|postgres(?:ql)?:\/\/|redis:\/\/)/iu.test(serialized)
  )
    fail('UAP_REPORT_REDACTION_FAILED', 'The authority report contains a secret-like field.');
}

function zeroDriverActivity(): UgvAgentProfileAuthorityBootstrapReport['driverActivity'] {
  return Object.freeze({
    navigationDispatchCount: 0,
    forbiddenOperationCallCount: 0,
    fireInvocationCount: 0,
    modelInvocationCount: 0,
    providerToolCallCount: 0,
  });
}

function redactionDeclaration(): UgvAgentProfileAuthorityBootstrapReport['redaction'] {
  return Object.freeze({
    secretsIncluded: false,
    credentialReferencesIncluded: false,
    endpointsIncluded: false,
  });
}

function publicSha256(value: string): string {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(value)?.[1];
  if (match === undefined) fail('UAP_HASH_INVALID', 'Expected a formal sha256-prefixed hash.');
  return match;
}

async function controlGet(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.nodeControlBaseUrl}${path}`, {
      headers: controlHeaders(configuration),
      redirect: 'manual',
    }),
    200,
  );
}

async function runtimeGet(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.runtimeManagementBaseUrl}${path}`, { redirect: 'manual' }),
    200,
  );
}

async function controlPost(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  expectedStatus: number,
  request: typeof fetch,
  ifMatch?: string,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.nodeControlBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...controlHeaders(configuration),
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    }),
    expectedStatus,
  );
}

async function controlGetOptional<T>(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  path: string,
  schema: z.ZodType<T>,
  request: typeof fetch,
): Promise<T | undefined> {
  const response = await request(`${configuration.nodeControlBaseUrl}${path}`, {
    headers: controlHeaders(configuration),
    redirect: 'manual',
  });
  if (response.status === 404) return undefined;
  return schema.parse(await responseJson(response, 200));
}

async function controlGetWithEtag<T>(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  path: string,
  schema: z.ZodType<T>,
  request: typeof fetch,
): Promise<Readonly<{ value: T; etag: string }>> {
  const response = await request(`${configuration.nodeControlBaseUrl}${path}`, {
    headers: controlHeaders(configuration),
    redirect: 'manual',
  });
  const value = schema.parse(await responseJson(response, 200));
  return Object.freeze({ value, etag: requiredEtag(response) });
}

async function controlGetOptionalWithEtag<T>(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  path: string,
  schema: z.ZodType<T>,
  request: typeof fetch,
): Promise<Readonly<{ value: T; etag: string }> | undefined> {
  const response = await request(`${configuration.nodeControlBaseUrl}${path}`, {
    headers: controlHeaders(configuration),
    redirect: 'manual',
  });
  if (response.status === 404) return undefined;
  const value = schema.parse(await responseJson(response, 200));
  return Object.freeze({ value, etag: requiredEtag(response) });
}

async function controlCollection<T>(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  path: string,
  schema: z.ZodType<T>,
  request: typeof fetch,
): Promise<readonly T[]> {
  return z
    .object({ items: z.array(schema) })
    .loose()
    .parse(await controlGet(configuration, path, request)).items;
}

async function runtimeCollection<T>(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
  path: string,
  schema: z.ZodType<T>,
  request: typeof fetch,
): Promise<readonly T[]> {
  return z
    .object({ items: z.array(schema) })
    .loose()
    .parse(await runtimeGet(configuration, path, request)).items;
}

function controlHeaders(
  configuration: UgvAgentProfileAuthorityBootstrapConfiguration,
): Readonly<Record<string, string>> {
  return Object.freeze({
    accept: 'application/json',
    authorization: `Bearer ${configuration.nodeControlBearerToken}`,
  });
}

async function responseJson(response: Response, expectedStatus: number): Promise<unknown> {
  if (response.status !== expectedStatus) {
    let code = `UAP_HTTP_${String(response.status)}`;
    try {
      code = z
        .object({ code: z.string().min(1) })
        .loose()
        .parse(await response.json()).code;
    } catch {
      // Response bodies can contain credentials or endpoints and are deliberately not echoed.
    }
    return fail(
      code,
      `Authority HTTP request was rejected with status ${String(response.status)}.`,
    );
  }
  try {
    return await response.json();
  } catch {
    return fail('UAP_HTTP_RESPONSE_INVALID', 'Authority HTTP response was not valid JSON.');
  }
}

function requiredEtag(response: Response): string {
  const etag = response.headers.get('etag')?.trim();
  if (etag === undefined || etag.length < 3 || etag.length > 512)
    return fail('UAP_ETAG_MISSING', 'Exact authority reads require a bounded ETag.');
  return etag;
}

function etagHash(etag: string): string {
  const value = /^(?:W\/)?"(sha256:[a-f0-9]{64})"$/u.exec(etag)?.[1];
  if (value === undefined)
    return fail('UAP_ETAG_INVALID', 'Authority ETag does not contain the exact content hash.');
  return value;
}

function validateConfiguration(
  input: UgvAgentProfileAuthorityBootstrapConfiguration,
): UgvAgentProfileAuthorityBootstrapConfiguration {
  const nodeControlBaseUrl = managementBaseUrl(input.nodeControlBaseUrl);
  const runtimeManagementBaseUrl = managementBaseUrl(input.runtimeManagementBaseUrl);
  const profileA2aBaseUrl = managementBaseUrl(input.profileA2aBaseUrl);
  if (
    nodeControlBaseUrl !== EXPECTED_NODE_CONTROL_BASE_URL ||
    runtimeManagementBaseUrl !== EXPECTED_RUNTIME_MANAGEMENT_BASE_URL ||
    profileA2aBaseUrl !== EXPECTED_PROFILE_A2A_BASE_URL
  )
    fail(
      'UAP_CONFIGURATION_INVALID',
      'Profile authority origins must match the fixed local B01 trust boundary.',
    );
  if (!['bootstrap', 'verify', 'readiness'].includes(input.mode))
    fail('UAP_CONFIGURATION_INVALID', 'Authority mode must be bootstrap, verify, or readiness.');
  if (input.nodeControlBearerToken.trim().length < 1 || input.nodeControlBearerToken.length > 4096)
    fail('UAP_CONFIGURATION_INVALID', 'A bounded Node Control token is required.');
  if (!RUN_ID.test(input.runId) || !SIMULATION_ID.test(input.simulationRunId))
    fail('UAP_CONFIGURATION_INVALID', 'Run identifiers are not exact bounded Profile IDs.');
  if (!isAbsolute(input.skillPackageRoot))
    fail('UAP_CONFIGURATION_INVALID', 'Skill Package root must be absolute.');
  for (const value of [
    input.source.smppSourceId,
    input.localServerId,
    input.providerBindingId,
    input.providerDisplayName,
  ])
    if (value.trim().length < 1 || value.length > 256)
      fail('UAP_CONFIGURATION_INVALID', 'Profile authority identifiers must be bounded.');
  if (
    input.source.smppEnvironment !== 'simulation' ||
    input.source.smppSourceId !== EXPECTED_SOURCE_ID ||
    normalizedEndpoint(input.source.registryEndpoint) !== EXPECTED_SOURCE_ENDPOINT ||
    input.source.registryCredentialRef !== SMPP_UNAUTHENTICATED_CREDENTIAL_REF ||
    input.source.syncMode !== 'manual' ||
    input.source.lkgPolicy !== 'deny_when_unavailable' ||
    !Number.isSafeInteger(input.source.snapshotTtlSeconds) ||
    input.source.snapshotTtlSeconds <= 0 ||
    input.source.externalProviderId !== EXPECTED_PROVIDER_ID ||
    input.source.externalServerId !== EXPECTED_EXTERNAL_SERVER_ID ||
    input.localServerId !== EXPECTED_LOCAL_SERVER_ID ||
    input.providerBindingId !== EXPECTED_BINDING_ID ||
    input.providerDisplayName !== EXPECTED_PROVIDER_DISPLAY_NAME ||
    input.runtimeCredentialRef !== MCP_UNAUTHENTICATED_CREDENTIAL_REF
  )
    fail(
      'UAP_CONFIGURATION_INVALID',
      'Source and Provider identity must match the fixed Profile baseline.',
    );
  return Object.freeze({
    ...input,
    nodeControlBaseUrl,
    runtimeManagementBaseUrl,
    profileA2aBaseUrl,
    nodeControlBearerToken: input.nodeControlBearerToken.trim(),
    skillPackageRoot: resolve(input.skillPackageRoot),
  });
}

function managementBaseUrl(value: string): string {
  const url = safeUrl(value);
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '')
    fail('UAP_CONFIGURATION_INVALID', 'Management base URLs cannot contain path or query data.');
  return url.origin;
}

function normalizedEndpoint(value: string): string {
  const url = safeUrl(value);
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
}

function safeUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('UAP_CONFIGURATION_INVALID', 'Expected an absolute HTTP(S) URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    (url.protocol === 'http:' && !['127.0.0.1', '::1', 'localhost'].includes(url.hostname))
  )
    fail(
      'UAP_CONFIGURATION_INVALID',
      'Plain HTTP is permitted only for credential-free loopback URLs.',
    );
  return url;
}

function validTimestamp(value: string): string {
  if (!z.iso.datetime().safeParse(value).success)
    fail('UAP_CLOCK_INVALID', 'The authority clock returned an invalid timestamp.');
  return value;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function jsonObject(value: unknown, code: string): JsonObject {
  const found = record(value);
  if (found === undefined) return fail(code, 'Expected a JSON object authority.');
  return found as JsonObject;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const item = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(item)
    .filter((key) => item[key] !== undefined)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableKey(runId: string, scope: string, identity: string): string {
  return `uap-p3-b01-${scope}-${sha256(`${runId}\u0000${scope}\u0000${identity}`).slice(0, 32)}`;
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === 'string') &&
    value.length === expected.length &&
    [...value].sort().every((item, index) => item === [...expected].sort()[index])
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function requiredContains(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && expected.every((item) => value.includes(item));
}

function arrayIncludes(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.includes(expected);
}

function schemaAllowsString(value: unknown): boolean {
  const schema = record(value);
  return (
    schema?.['type'] === 'string' ||
    (Array.isArray(schema?.['anyOf']) &&
      schema['anyOf'].some((branch) => record(branch)?.['type'] === 'string'))
  );
}

function schemaAllowsExactResource(
  schema: Readonly<Record<string, unknown>> | undefined,
  resourceId: string,
): boolean {
  if (schema === undefined) return false;
  if (schema['const'] === resourceId) return true;
  return sameStrings(schema['enum'], [resourceId]);
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string, maximum = 4096): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === '' || value.length > maximum)
    return fail('UAP_ENVIRONMENT_INVALID', `${name} is required and must be bounded.`);
  return value;
}

async function controlToken(environment: NodeJS.ProcessEnv): Promise<string> {
  const inline = environment['SDAR_CONTROL_API_TOKEN']?.trim();
  const file = environment['SDAR_CONTROL_API_TOKEN_FILE']?.trim();
  if ((inline === undefined || inline === '') === (file === undefined || file === ''))
    return fail('UAP_ENVIRONMENT_INVALID', 'Provide exactly one Node Control token source.');
  if (inline !== undefined && inline !== '') return inline;
  if (file === undefined || file === '')
    return fail('UAP_ENVIRONMENT_INVALID', 'Node Control token file is required.');
  const target = resolve(file);
  const metadata = await lstat(target);
  const getuid = process.getuid?.();
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (getuid !== undefined && metadata.uid !== getuid) ||
    (metadata.mode & 0o077) !== 0 ||
    metadata.size < 1 ||
    metadata.size > 4096
  )
    return fail('UAP_TOKEN_FILE_UNSAFE', 'Node Control token file must be owner-only and regular.');
  const token = (await readFile(target, 'utf8')).trim();
  if (token === '') return fail('UAP_TOKEN_FILE_INVALID', 'Node Control token file is empty.');
  return token;
}

export async function ugvAgentProfileAuthorityConfigurationFromEnvironment(
  mode: UgvAgentProfileAuthorityMode,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<
  Readonly<{
    configuration: UgvAgentProfileAuthorityBootstrapConfiguration;
    reportFile: string;
  }>
> {
  const configuration: UgvAgentProfileAuthorityBootstrapConfiguration = {
    mode,
    nodeControlBaseUrl: requiredEnvironment(environment, 'SDAR_NODE_CONTROL_BASE_URL'),
    nodeControlBearerToken: await controlToken(environment),
    runtimeManagementBaseUrl: requiredEnvironment(
      environment,
      'SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL',
    ),
    profileA2aBaseUrl: requiredEnvironment(environment, 'SDAR_UAP_PROFILE_A2A_BASE_URL'),
    skillPackageRoot: requiredEnvironment(environment, 'SDAR_UAP_SKILL_PACKAGE_ROOT'),
    runId: requiredEnvironment(environment, 'SDAR_UGV_BOOTSTRAP_RUN_ID', 128),
    simulationRunId: requiredEnvironment(environment, 'UGV_SIMULATION_RUN_ID', 160),
    source: {
      smppSourceId: requiredEnvironment(environment, 'SMPP_SDAR_SOURCE_ID', 256),
      ...(environment['SMPP_SDAR_SOURCE_NAME']?.trim()
        ? { sourceName: environment['SMPP_SDAR_SOURCE_NAME'].trim() }
        : {}),
      smppEnvironment: requiredEnvironment(environment, 'SMPP_ENVIRONMENT', 63),
      registryEndpoint: requiredEnvironment(environment, 'SMPP_SDAR_REGISTRY_ENDPOINT'),
      registryCredentialRef: requiredEnvironment(environment, 'SMPP_REGISTRY_CREDENTIAL_REF', 512),
      syncMode: 'manual',
      snapshotTtlSeconds: Number(environment['SMPP_SNAPSHOT_TTL_SECONDS'] ?? '300'),
      lkgPolicy: 'deny_when_unavailable',
      externalProviderId: requiredEnvironment(environment, 'SMPP_UGV_EXTERNAL_PROVIDER_ID', 256),
      externalServerId: requiredEnvironment(environment, 'SMPP_UGV_EXTERNAL_SERVER_ID', 256),
    },
    localServerId: requiredEnvironment(environment, 'SDAR_UGV_LOCAL_SERVER_ID', 256),
    providerBindingId: requiredEnvironment(environment, 'SDAR_UGV_BINDING_ID', 256),
    providerDisplayName: requiredEnvironment(environment, 'SDAR_UGV_PROVIDER_DISPLAY_NAME', 256),
    runtimeCredentialRef: requiredEnvironment(environment, 'SMPP_UGV_RUNTIME_CREDENTIAL_REF', 512),
  };
  const configuredReportFile = environment['SDAR_UAP_AUTHORITY_REPORT_FILE']?.trim();
  return Object.freeze({
    configuration: validateConfiguration(configuration),
    reportFile:
      configuredReportFile === undefined || configuredReportFile === ''
        ? 'reports/ugv-agent-profile/p3-b01-authority-bootstrap.redacted.json'
        : configuredReportFile,
  });
}

export async function writeRedactedUgvAgentProfileAuthorityReport(
  reportFile: string,
  value: UgvAgentProfileAuthorityBootstrapReport | UgvAgentProfileAuthorityReadinessReport,
): Promise<void> {
  const target = resolve(reportFile);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  await chmod(target, 0o600);
}

function fail(code: string, message: string): never {
  throw new UgvAgentProfileAuthorityBootstrapError(code, message);
}

function readinessInterrupted(
  signal: 'SIGINT' | 'SIGTERM',
): UgvAgentProfileAuthorityBootstrapError {
  return new UgvAgentProfileAuthorityBootstrapError(
    'UAP_READINESS_INTERRUPTED',
    'Readiness was interrupted after exact Skill@1 restoration.',
    signal === 'SIGINT' ? 130 : 143,
  );
}

function processLifecycleSignals(): NonNullable<
  UgvAgentProfileAuthorityBootstrapDependencies['lifecycleSignals']
> {
  return Object.freeze({
    subscribe(listener: (signal: 'SIGINT' | 'SIGTERM') => void): () => void {
      const onInterrupt = () => {
        listener('SIGINT');
      };
      const onTerminate = () => {
        listener('SIGTERM');
      };
      process.on('SIGINT', onInterrupt);
      process.on('SIGTERM', onTerminate);
      return () => {
        process.off('SIGINT', onInterrupt);
        process.off('SIGTERM', onTerminate);
      };
    },
  });
}

async function main(): Promise<void> {
  const argument = process.argv.slice(2);
  if (
    argument.length > 1 ||
    (argument[0] !== undefined && !['bootstrap', 'verify', 'readiness'].includes(argument[0]))
  )
    fail('UAP_CLI_USAGE_INVALID', 'Usage: driver [bootstrap|verify|readiness].');
  const mode = (argument[0] ?? 'bootstrap') as UgvAgentProfileAuthorityMode;
  const { configuration, reportFile } =
    await ugvAgentProfileAuthorityConfigurationFromEnvironment(mode);
  const value =
    mode === 'bootstrap'
      ? await bootstrapUgvAgentProfileAuthority(configuration)
      : mode === 'verify'
        ? await verifyUgvAgentProfileAuthority(configuration)
        : await verifyUgvAgentProfileAuthorityReadiness(configuration);
  await writeRedactedUgvAgentProfileAuthorityReport(reportFile, value);
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const code =
      error instanceof UgvAgentProfileAuthorityBootstrapError
        ? error.code
        : 'UAP_AUTHORITY_BOOTSTRAP_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode =
      error instanceof UgvAgentProfileAuthorityBootstrapError && error.exitCode !== undefined
        ? error.exitCode
        : 1;
  });
}
