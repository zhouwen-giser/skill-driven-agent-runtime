import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { z } from 'zod';

import {
  deriveFrozenMcpCatalogAuthority,
  type McpTool,
} from '../../../packages/domain/src/index.js';
import { SMPP_UNAUTHENTICATED_CREDENTIAL_REF } from '../../../packages/node-control-domain/src/index.js';
import {
  bootstrapUgvSmppSource,
  type UgvSmppSourceBootstrapConfiguration,
  type UgvSmppSourceBootstrapReport,
} from './ugv-smpp-source-bootstrap-driver.js';

const EXPECTED_NODE_CONTROL_BASE_URL = 'http://127.0.0.1:10091';
const EXPECTED_RUNTIME_MANAGEMENT_BASE_URL = 'http://127.0.0.1:10998';
const EXPECTED_SOURCE_ID = 'smpp-source-ugv1-uap-p3-b01';
const EXPECTED_SOURCE_ENDPOINT =
  'http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/smpp-source-ugv1-uap-p3-b01/latest';
const EXPECTED_BINDING_ID = 'ugv-smpp-uap-p3-b01-binding';
const EXPECTED_LOCAL_SERVER_ID = 'ugv-smpp-uap-p3-b01';
const EXPECTED_PROVIDER_ID = 'isr.vehicle.ugv.ugv1';
const EXPECTED_EXTERNAL_SERVER_ID = 'uap-p3-b01-runtime-1';
const EXPECTED_PROVIDER_ENDPOINT = 'http://127.0.0.1:19131/mcp';
const EXPECTED_CAPABILITY_ID = 'embodied.move';
const EXPECTED_IMPLEMENTATION_ID = 'capability-binding-embodied.move-v2';
const EXPECTED_TOOL_NAMES = Object.freeze([
  'vehicle_area_recon',
  'vehicle_control_gimbal',
  'vehicle_emergency_stop',
  'vehicle_fire_weapon',
  'vehicle_get_capabilities',
  'vehicle_get_payload_status',
  'vehicle_get_state',
  'vehicle_get_targets',
  'vehicle_navigate',
  'vehicle_track_target',
] as const);
const CHECKSUM = /^[a-f0-9]{64}$/u;
const PREFIXED_CHECKSUM = /^sha256:[a-f0-9]{64}$/u;
const ATTEMPT_ID = /^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const PROJECTION_CONTRACT = 'sdar-registry-v1' as const;
const EXPECTED_SOURCE_SNAPSHOT_TTL_SECONDS = 300;
const SOURCE_GATE_RUNWAY_MS = 240_000;
const SOURCE_RECOVERY_REFRESH_RUNWAY_MS = 270_000;
const DURABLE_AUTHORITY_RUNWAY_MS = 1_200_000;

const SourceSchema = z
  .object({
    smppSourceId: z.string().min(1),
    name: z.string().min(1).optional(),
    registryEndpoint: z.string().min(1),
    credentialRef: z.string().min(1),
    tenantId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    environment: z.string().min(1),
    syncMode: z.enum(['manual', 'poll', 'watch']),
    snapshotTtlSeconds: z.literal(EXPECTED_SOURCE_SNAPSHOT_TTL_SECONDS),
    lkgPolicy: z.enum(['allow_unexpired', 'deny_when_unavailable']),
    status: z.enum(['draft', 'active', 'suspended', 'retired']),
    activeSnapshotRevision: z.number().int().positive().optional(),
    activeSnapshotChecksum: z.string().regex(CHECKSUM).optional(),
    activeSnapshotValidUntil: z.iso.datetime().optional(),
    lastSyncAt: z.iso.datetime().optional(),
    lastErrorCode: z.string().min(1).optional(),
    revision: z.number().int().positive(),
  })
  .strict();
const SourcePageSchema = pageSchema(SourceSchema);

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
    status: z.enum(['candidate', 'imported', 'active', 'degraded', 'suspended', 'removed']),
    availabilityStatus: z.enum(['unknown', 'available', 'degraded', 'unavailable']),
    revision: z.number().int().positive(),
  })
  .strict();
const BindingSchema = BindingInventorySchema.extend({
  availabilityValidUntil: z.iso.datetime(),
  catalogObservedAt: z.iso.datetime(),
  operationCount: z.number().int().nonnegative().max(1_024),
}).strict();
const BindingPageSchema = pageSchema(BindingInventorySchema);

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
const TaskExecutionProfileSchema = z
  .object({
    profileVersion: z.literal('1.0'),
    taskBehavior: z.enum(['synchronous_only', 'server_directed', 'task_required']),
    availability: z.enum(['not_supported', 'dynamic']),
    supportsScheduling: z.boolean(),
    supportsMaxElapsed: z.boolean(),
    supportsCancellation: z.boolean().optional(),
    supportsPauseResume: z.boolean().optional(),
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
    taskExecutionProfile: TaskExecutionProfileSchema,
    discoveredAt: z.iso.datetime(),
  })
  .loose();
const DiscoverySchema = z
  .object({
    snapshotId: z.string().min(1),
    serverId: z.string().min(1),
    protocolMode: z.literal('frozen_v1'),
    protocolVersion: z.string().min(1),
    baselineSha256: z.string().regex(CHECKSUM),
    supportedVersions: z.array(z.string().min(1)),
    capabilities: z.record(z.string(), z.unknown()),
    serverInfo: z.record(z.string(), z.unknown()),
    providerCatalog: z
      .object({
        providerId: z.string().min(1),
        providerType: z.string().min(1),
        providerVersion: z.string().min(1),
        manifestHash: z.string().regex(CHECKSUM),
      })
      .strict(),
    taskNotifications: z.boolean(),
    discoveredAt: z.iso.datetime(),
    validUntil: z.iso.datetime(),
    toolRevision: z.number().int().positive(),
  })
  .loose();
const RuntimeServerSchema = z
  .object({
    serverId: z.string().min(1),
    name: z.string().min(1).optional(),
    endpoint: z.string().min(1),
    transport: z.literal('streamable_http').optional(),
    status: z.enum(['enabled', 'disabled', 'unreachable']),
    toolRevision: z.number().int().positive(),
    protocolMode: z.literal('frozen_v1'),
    currentProtocolSnapshotId: z.string().min(1),
    createdAt: z.iso.datetime().optional(),
    updatedAt: z.iso.datetime().optional(),
    currentDiscovery: DiscoverySchema,
  })
  .loose();
const RuntimeServerPageSchema = pageSchema(RuntimeServerSchema);
const RuntimeToolPageSchema = pageSchema(ToolSchema);

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
const CapabilityPageSchema = pageSchema(CapabilitySchema);
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
    reasons: z.array(z.record(z.string(), z.unknown())),
    availableImplementations: z.array(z.string()).optional(),
    unavailableImplementations: z.array(z.string()).optional(),
  })
  .loose();

const CandidateSchema = z
  .object({
    smppSourceId: z.string().min(1),
    externalProviderId: z.string().min(1),
    externalServerId: z.string().min(1),
    compositeIdentity: z.string().min(1),
    serverEndpoint: z.string().min(1),
    displayName: z.string().min(1).optional(),
    catalogRevision: z.string().min(1),
    labels: z.record(z.string(), z.unknown()),
    registryRevision: z.number().int().positive(),
    registryChecksum: z.string().regex(CHECKSUM),
    registryEtag: z.string().min(1),
    registryValidUntil: z.iso.datetime(),
    nativeRegistryRevision: z.number().int().positive(),
    nativeRegistryChecksum: z.string().regex(CHECKSUM),
    registryProjectionContract: z.literal(PROJECTION_CONTRACT),
  })
  .strict();
const CandidatePageSchema = pageSchema(CandidateSchema);

const RegistryProviderSchema = z
  .object({
    externalProviderId: z.string().min(1),
    externalServerId: z.string().min(1),
    serverEndpoint: z.string().min(1),
    catalogRevision: z.string().regex(/^[1-9][0-9]*$/u),
    labels: z
      .object({
        environment: z.literal('simulation'),
        protocolMode: z.literal('frozen_v1'),
      })
      .strict(),
  })
  .strict();
const RegistryProjectionSchema = z
  .object({
    revision: z.number().int().positive(),
    checksum: z.string().regex(CHECKSUM),
    generatedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    providers: z.array(RegistryProviderSchema),
  })
  .strict();

const AttemptAuthorizationSchema = z
  .object({
    schemaVersion: z.literal('sdar.ugv-agent-profile.b02-attempt-authorization/v1'),
    status: z.literal('authorized'),
    task: z.literal('UAP-P3-B02'),
    kind: z.literal('recovery_issued'),
    bootstrapRunId: z.string().min(1).max(256),
    simulationId: z.string().regex(ATTEMPT_ID),
    predecessorSimulationId: z.string().regex(ATTEMPT_ID),
    a2aIdempotencyKey: z.string().min(1).max(256),
    identityRecordPath: z.string().min(1).max(4_096),
    identityRecordSha256: z.string().regex(PREFIXED_CHECKSUM),
    record: z
      .object({
        schemaVersion: z.literal('sdar.ugv-agent-profile.b02-attempt-identity/v1'),
        status: z.literal('issued'),
        task: z.literal('UAP-P3-B02'),
        bootstrapRunId: z.string().min(1).max(256),
        simulationId: z.string().regex(ATTEMPT_ID),
        predecessorSimulationId: z.string().regex(ATTEMPT_ID),
        a2aIdempotencyKey: z.string().min(1).max(256),
        recordSha256: z.string().regex(PREFIXED_CHECKSUM),
      })
      .loose(),
  })
  .strict();

const SupervisorNoCaptureSchema = z
  .object({
    schemaVersion: z.literal('sdar.ugv-agent-profile.host-process-status/v2'),
    status: z.literal('running'),
    processCount: z.literal(3),
    sideEffects: z.literal('NO'),
    bootstrapRunId: z.string().min(1).max(256),
    manifestRevision: z.number().int().positive(),
    activeSimulationRunId: z.null(),
    processIdentitySha256: z
      .object({
        server: z.string().regex(PREFIXED_CHECKSUM),
        nodeControlApi: z.string().regex(PREFIXED_CHECKSUM),
        nodeControlWorker: z.string().regex(PREFIXED_CHECKSUM),
      })
      .strict(),
  })
  .strict();

type Source = z.infer<typeof SourceSchema>;
type Binding = z.infer<typeof BindingSchema>;
type RuntimeServer = z.infer<typeof RuntimeServerSchema>;
type RuntimeTool = z.infer<typeof ToolSchema>;
type Capability = z.infer<typeof CapabilitySchema>;
type Readiness = z.infer<typeof ReadinessSchema>;
type Candidate = z.infer<typeof CandidateSchema>;
type AttemptAuthorization = z.infer<typeof AttemptAuthorizationSchema>;

interface RegistryProjectionAuthority {
  readonly projection: z.infer<typeof RegistryProjectionSchema>;
  readonly nativeRevision: number;
  readonly nativeChecksum: string;
  readonly projectionContract: typeof PROJECTION_CONTRACT;
}

interface FrozenAuthority {
  readonly observedAt: string;
  readonly source: Source;
  readonly binding: Binding;
  readonly server: RuntimeServer;
  readonly tools: readonly RuntimeTool[];
  readonly capability: Capability;
  readonly readiness: Readiness;
  readonly candidate?: Candidate;
  readonly registry: RegistryProjectionAuthority;
  readonly bindingHash: string;
  readonly runtimeHash: string;
  readonly capabilityHash: string;
  readonly candidateIdentityHash?: string;
  readonly registryLineageHash: string;
  readonly runtimeCatalog: Readonly<{
    catalogRevision: string;
    catalogChecksum: string;
    operationCount: number;
  }>;
}

export interface UgvB02SourceRecoveryConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly nodeControlAdminToken: string;
  readonly runtimeManagementBaseUrl: string;
  readonly attemptId: string;
  readonly source: Omit<
    UgvSmppSourceBootstrapConfiguration,
    'nodeControlBaseUrl' | 'nodeControlAdminToken' | 'runId'
  >;
  readonly localServerId: string;
  readonly providerBindingId: string;
}

export interface UgvB02SourceRecoveryDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
  readonly bootstrapSource?: typeof bootstrapUgvSmppSource;
  readonly validateIssuedAttemptIdentity: (attemptId: string) => Promise<unknown>;
  readonly captureSupervisorNo: () => Promise<unknown>;
}

export interface UgvB02SourceRecoveryReport {
  readonly schemaVersion: 'sdar.ugv-agent-profile.b02-source-recovery/v1';
  readonly status: 'passed';
  readonly evidenceClass: 'real_public_api';
  readonly observedAt: string;
  readonly action: 'not_required' | 'refreshed';
  readonly identityRecordSha256: string;
  readonly simulationIdSha256: string;
  readonly source: Readonly<{
    revision: number;
    snapshotRevision: number;
    snapshotChecksum: string;
    validUntilBefore: string;
    validUntilAfter: string;
    nativeRevision: number;
    nativeChecksum: string;
    projectionContract: typeof PROJECTION_CONTRACT;
    remainingTtlMsBefore: number;
    syncOutcome?: 'not_modified';
  }>;
  readonly binding: Readonly<{
    revision: number;
    catalogRevision: string;
    catalogChecksum: string;
    availabilityValidUntil: string;
    remainingTtlMs: number;
    operationCount: number;
  }>;
  readonly runtime: Readonly<{
    toolRevision: number;
    catalogRevision: string;
    catalogChecksum: string;
    discoveryValidUntil: string;
    remainingTtlMs: number;
    operationCount: number;
  }>;
  readonly capability: Readonly<{
    version: 2;
    definitionHash: string;
    policyHash: string;
  }>;
  readonly checks: readonly string[];
  readonly redaction: Readonly<{
    secretsIncluded: false;
    credentialReferencesIncluded: false;
    endpointsIncluded: false;
    entityIdsIncluded: false;
  }>;
}

const RecoveryReportSchema = z
  .object({
    schemaVersion: z.literal('sdar.ugv-agent-profile.b02-source-recovery/v1'),
    status: z.literal('passed'),
    evidenceClass: z.literal('real_public_api'),
    observedAt: z.iso.datetime(),
    action: z.enum(['not_required', 'refreshed']),
    identityRecordSha256: z.string().regex(PREFIXED_CHECKSUM),
    simulationIdSha256: z.string().regex(CHECKSUM),
    source: z
      .object({
        revision: z.number().int().positive(),
        snapshotRevision: z.number().int().positive(),
        snapshotChecksum: z.string().regex(CHECKSUM),
        validUntilBefore: z.iso.datetime(),
        validUntilAfter: z.iso.datetime(),
        nativeRevision: z.number().int().positive(),
        nativeChecksum: z.string().regex(CHECKSUM),
        projectionContract: z.literal(PROJECTION_CONTRACT),
        remainingTtlMsBefore: z.number().int().nonnegative(),
        syncOutcome: z.literal('not_modified').optional(),
      })
      .strict(),
    binding: z
      .object({
        revision: z.number().int().positive(),
        catalogRevision: z.string().min(1),
        catalogChecksum: z.string().regex(CHECKSUM),
        availabilityValidUntil: z.iso.datetime(),
        remainingTtlMs: z.number().int().nonnegative(),
        operationCount: z.number().int().positive(),
      })
      .strict(),
    runtime: z
      .object({
        toolRevision: z.number().int().positive(),
        catalogRevision: z.string().min(1),
        catalogChecksum: z.string().regex(CHECKSUM),
        discoveryValidUntil: z.iso.datetime(),
        remainingTtlMs: z.number().int().nonnegative(),
        operationCount: z.number().int().positive(),
      })
      .strict(),
    capability: z
      .object({
        version: z.literal(2),
        definitionHash: z.string().regex(CHECKSUM),
        policyHash: z.string().regex(PREFIXED_CHECKSUM),
      })
      .strict(),
    checks: z.array(z.string().min(1)),
    redaction: z
      .object({
        secretsIncluded: z.literal(false),
        credentialReferencesIncluded: z.literal(false),
        endpointsIncluded: z.literal(false),
        entityIdsIncluded: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((report, context) => {
    const before = Date.parse(report.source.validUntilBefore);
    const after = Date.parse(report.source.validUntilAfter);
    const observedAt = Date.parse(report.observedAt);
    if (
      (report.action === 'not_required' && Object.hasOwn(report.source, 'syncOutcome')) ||
      (report.action === 'refreshed' && report.source.syncOutcome !== 'not_modified')
    )
      context.addIssue({
        code: 'custom',
        message: 'Source recovery action and synchronization outcome differ.',
        path: ['source', 'syncOutcome'],
      });
    if (
      (report.action === 'not_required' &&
        (before !== after ||
          report.source.remainingTtlMsBefore < SOURCE_RECOVERY_REFRESH_RUNWAY_MS)) ||
      (report.action === 'refreshed' &&
        (after <= before ||
          after - observedAt < SOURCE_RECOVERY_REFRESH_RUNWAY_MS ||
          report.source.remainingTtlMsBefore >= SOURCE_RECOVERY_REFRESH_RUNWAY_MS))
    )
      context.addIssue({
        code: 'custom',
        message: 'Source recovery action and validity transition differ.',
        path: ['source', 'validUntilAfter'],
      });
  });

export function validateUgvB02SourceRecoveryReport(value: unknown): UgvB02SourceRecoveryReport {
  try {
    return RecoveryReportSchema.parse(value) as UgvB02SourceRecoveryReport;
  } catch (error: unknown) {
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_REPORT_INVALID',
      'The private Source recovery report does not match its exact schema.',
      { cause: error },
    );
  }
}

export class UgvB02SourceRecoveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'UgvB02SourceRecoveryError';
  }
}

/**
 * Refreshes only the expired Source pointer while the B02 Runtime remains in its NO state. Binding,
 * Runtime and Capability are read-only frozen authorities; this driver has no materialize or rebind
 * port. The formal Source bootstrap owns both audited synchronization commands.
 */
export async function recoverUgvB02SourceAuthority(
  input: UgvB02SourceRecoveryConfiguration,
  dependencies: UgvB02SourceRecoveryDependencies,
): Promise<UgvB02SourceRecoveryReport> {
  const configuration = validateConfiguration(input);
  const authorization = await validateAttemptAuthorization(configuration, dependencies);
  await requireSupervisorNoCapture(dependencies, authorization.bootstrapRunId);
  const request = dependencies.fetch ?? fetch;
  const clock = dependencies.now ?? (() => new Date().toISOString());
  const preReads = await readAuthority(configuration, request);
  const pre = freezeAuthority(configuration, preReads, timestamp(clock()), 'pre');
  assertDurableAuthorityRunway(pre);
  const remainingTtlMs = Math.max(
    0,
    Date.parse(requiredSourceValidUntil(pre.source)) - Date.parse(pre.observedAt),
  );
  if (remainingTtlMs >= SOURCE_RECOVERY_REFRESH_RUNWAY_MS)
    return buildRecoveryReport('not_required', authorization, pre, pre, remainingTtlMs);

  const runId = recoveryRunId(authorization);
  let bootstrap: UgvSmppSourceBootstrapReport;
  try {
    bootstrap = await (dependencies.bootstrapSource ?? bootstrapUgvSmppSource)(
      {
        nodeControlBaseUrl: configuration.nodeControlBaseUrl,
        nodeControlAdminToken: configuration.nodeControlAdminToken,
        ...configuration.source,
        runId,
      },
      { fetch: request, now: clock },
    );
  } catch (error: unknown) {
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_SYNC_FAILED',
      'The one formal Source recovery synchronization failed or became ambiguous.',
      { cause: error },
    );
  }
  assertBootstrapExact(bootstrap, pre);

  const postReads = await readAuthority(configuration, request);
  const post = freezeAuthority(configuration, postReads, timestamp(clock()), 'post');
  assertAuthorityUnchanged(pre, post, bootstrap);
  return buildRecoveryReport('refreshed', authorization, pre, post, remainingTtlMs);
}

export interface UgvB02SourceRecoveryReplayVerification {
  readonly status: 'current';
  readonly observedAt: string;
  readonly action: UgvB02SourceRecoveryReport['action'];
  readonly sourceRemainingTtlMs: number;
  readonly secretsIncluded: false;
  readonly endpointsIncluded: false;
}

/** Re-proves a persisted recovery report against current authority using GETs only. */
export async function verifyUgvB02SourceRecoveryReplayAuthority(
  input: UgvB02SourceRecoveryConfiguration,
  reportInput: unknown,
  dependencies: Readonly<{ fetch?: typeof fetch; now?: () => string }> = {},
): Promise<UgvB02SourceRecoveryReplayVerification> {
  const configuration = validateConfiguration(input);
  const report = validateUgvB02SourceRecoveryReport(reportInput);
  if (report.simulationIdSha256 !== sha256(configuration.attemptId))
    fail(
      'UGV_B02_SOURCE_RECOVERY_REPLAY_AUTHORITY_DRIFT',
      'The persisted Source recovery report belongs to a different attempt identity.',
    );
  const observedAt = timestamp(dependencies.now?.() ?? new Date().toISOString());
  const reads = await readAuthority(configuration, dependencies.fetch ?? fetch);
  const current = freezeAuthority(configuration, reads, observedAt, 'post');
  assertDurableAuthorityRunway(current);
  const sourceRemainingTtlMs =
    Date.parse(requiredSourceValidUntil(current.source)) - Date.parse(observedAt);
  if (sourceRemainingTtlMs < SOURCE_GATE_RUNWAY_MS)
    fail(
      'UGV_B02_SOURCE_RECOVERY_REPLAY_AUTHORITY_DRIFT',
      'The replayed Source no longer has the required four-minute pre-delegation runway.',
    );
  assertReplayAuthorityMatches(report, current);
  return Object.freeze({
    status: 'current',
    observedAt,
    action: report.action,
    sourceRemainingTtlMs,
    secretsIncluded: false,
    endpointsIncluded: false,
  });
}

async function validateAttemptAuthorization(
  configuration: UgvB02SourceRecoveryConfiguration,
  dependencies: UgvB02SourceRecoveryDependencies,
): Promise<AttemptAuthorization> {
  let authorization: AttemptAuthorization;
  try {
    authorization = AttemptAuthorizationSchema.parse(
      await dependencies.validateIssuedAttemptIdentity(configuration.attemptId),
    );
  } catch (error: unknown) {
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_ATTEMPT_NOT_AUTHORIZED',
      'The Source recovery attempt is not an append-only issued B02 identity.',
      { cause: error },
    );
  }
  if (
    authorization.simulationId !== configuration.attemptId ||
    authorization.record.simulationId !== authorization.simulationId ||
    authorization.record.predecessorSimulationId !== authorization.predecessorSimulationId ||
    authorization.record.bootstrapRunId !== authorization.bootstrapRunId ||
    authorization.record.a2aIdempotencyKey !== authorization.a2aIdempotencyKey ||
    authorization.record.recordSha256 !== authorization.identityRecordSha256
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_ATTEMPT_NOT_AUTHORIZED',
      'The issued B02 identity authorization is internally inconsistent.',
    );
  return authorization;
}

async function requireSupervisorNoCapture(
  dependencies: UgvB02SourceRecoveryDependencies,
  expectedBootstrapRunId: string,
): Promise<void> {
  try {
    const capture = SupervisorNoCaptureSchema.parse(await dependencies.captureSupervisorNo());
    if (capture.bootstrapRunId !== expectedBootstrapRunId)
      fail(
        'UGV_B02_SOURCE_RECOVERY_SUPERVISOR_NOT_NO',
        'The formal supervisor capture belongs to a different bootstrap generation.',
      );
  } catch (error: unknown) {
    if (error instanceof UgvB02SourceRecoveryError) throw error;
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_SUPERVISOR_NOT_NO',
      'The formal supervisor capture did not prove three running processes in NO mode.',
      { cause: error },
    );
  }
}

function buildRecoveryReport(
  action: UgvB02SourceRecoveryReport['action'],
  authorization: AttemptAuthorization,
  pre: FrozenAuthority,
  post: FrozenAuthority,
  remainingTtlMs: number,
): UgvB02SourceRecoveryReport {
  const source = Object.freeze({
    revision: post.source.revision,
    snapshotRevision: requiredSourceRevision(post.source),
    snapshotChecksum: requiredSourceChecksum(post.source),
    validUntilBefore: requiredSourceValidUntil(pre.source),
    validUntilAfter: requiredSourceValidUntil(post.source),
    nativeRevision: requiredCandidate(post).nativeRegistryRevision,
    nativeChecksum: requiredCandidate(post).nativeRegistryChecksum,
    projectionContract: requiredCandidate(post).registryProjectionContract,
    remainingTtlMsBefore: remainingTtlMs,
    ...(action === 'refreshed' ? { syncOutcome: 'not_modified' as const } : {}),
  });
  return Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.b02-source-recovery/v1',
    status: 'passed',
    evidenceClass: 'real_public_api',
    observedAt: post.observedAt,
    action,
    identityRecordSha256: authorization.identityRecordSha256,
    simulationIdSha256: sha256(authorization.simulationId),
    source,
    binding: Object.freeze({
      revision: post.binding.revision,
      catalogRevision: post.binding.catalogRevision,
      catalogChecksum: post.binding.catalogChecksum,
      availabilityValidUntil: post.binding.availabilityValidUntil,
      remainingTtlMs: Math.max(
        0,
        Date.parse(post.binding.availabilityValidUntil) - Date.parse(post.observedAt),
      ),
      operationCount: post.binding.operationCount,
    }),
    runtime: Object.freeze({
      toolRevision: post.server.toolRevision,
      catalogRevision: post.runtimeCatalog.catalogRevision,
      catalogChecksum: post.runtimeCatalog.catalogChecksum,
      discoveryValidUntil: post.server.currentDiscovery.validUntil,
      remainingTtlMs: Math.max(
        0,
        Date.parse(post.server.currentDiscovery.validUntil) - Date.parse(post.observedAt),
      ),
      operationCount: post.runtimeCatalog.operationCount,
    }),
    capability: Object.freeze({
      version: 2,
      definitionHash: post.capability.definitionHash,
      policyHash: post.readiness.policyHash,
    }),
    checks: Object.freeze([
      'issued_attempt_identity_authorized',
      'pre_command_authority_frozen',
      'registry_full_200_matches_binding',
      'binding_and_runtime_runway_not_less_than_20_minutes',
      'formal_supervisor_no_capture',
      ...(action === 'not_required'
        ? ['source_refresh_runway_not_less_than_270_seconds']
        : [
            'formal_source_bootstrap_reused',
            'source_sync_not_modified',
            'source_pointer_validity_extended',
            'projected_and_native_lineage_unchanged',
            'binding_authority_byte_stable',
            'runtime_catalog_byte_stable',
            'capability_definition_and_policy_stable',
          ]),
      'no_materialize_or_rebind_port',
    ]),
    redaction: Object.freeze({
      secretsIncluded: false,
      credentialReferencesIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    }),
  });
}

interface AuthorityReads {
  readonly sourcePage: unknown;
  readonly source: unknown;
  readonly bindingPage: unknown;
  readonly binding: unknown;
  readonly serverPage: unknown;
  readonly toolPage: unknown;
  readonly capabilityPage: unknown;
  readonly capability: unknown;
  readonly readiness: unknown;
  readonly registry: RegistryProjectionAuthority;
  readonly candidates: unknown;
}

async function readAuthority(
  configuration: UgvB02SourceRecoveryConfiguration,
  request: typeof fetch,
): Promise<AuthorityReads> {
  const sourcePath = `/api/v1/smpp-sources/${encodeURIComponent(EXPECTED_SOURCE_ID)}`;
  const bindingPath = `/api/v1/mcp-provider-bindings/${encodeURIComponent(EXPECTED_BINDING_ID)}`;
  const capabilityPath = `/api/v1/node-capabilities/${encodeURIComponent(EXPECTED_CAPABILITY_ID)}/versions/2`;
  const values = await Promise.all([
    controlGet(configuration, '/api/v1/smpp-sources?pageSize=200', request),
    controlGet(configuration, sourcePath, request),
    controlGet(configuration, '/api/v1/mcp-provider-bindings?pageSize=200', request),
    controlGet(configuration, bindingPath, request),
    runtimeGet(configuration, '/api/v1/mcp/servers?pageSize=200', request),
    runtimeGet(
      configuration,
      `/api/v1/mcp/servers/${encodeURIComponent(EXPECTED_LOCAL_SERVER_ID)}/tools?pageSize=200`,
      request,
    ),
    controlGet(configuration, '/api/v1/node-capabilities?pageSize=200', request),
    controlGet(configuration, capabilityPath, request),
    controlGet(
      configuration,
      `/api/v1/capability-readiness/${encodeURIComponent(EXPECTED_CAPABILITY_ID)}/2`,
      request,
    ),
    readRegistryProjection(configuration, request),
    controlGet(
      configuration,
      `/api/v1/mcp-provider-candidates?smppSourceId=${encodeURIComponent(EXPECTED_SOURCE_ID)}&pageSize=200`,
      request,
    ),
  ]);
  return Object.freeze({
    sourcePage: values[0],
    source: values[1],
    bindingPage: values[2],
    binding: values[3],
    serverPage: values[4],
    toolPage: values[5],
    capabilityPage: values[6],
    capability: values[7],
    readiness: values[8],
    registry: values[9],
    candidates: values[10],
  });
}

function freezeAuthority(
  configuration: UgvB02SourceRecoveryConfiguration,
  reads: AuthorityReads,
  observedAt: string,
  phase: 'pre' | 'post',
): FrozenAuthority {
  let sourcePage: z.infer<typeof SourcePageSchema>;
  let source: Source;
  let bindingPage: z.infer<typeof BindingPageSchema>;
  let binding: Binding;
  let serverPage: z.infer<typeof RuntimeServerPageSchema>;
  let toolPage: z.infer<typeof RuntimeToolPageSchema>;
  let capabilityPage: z.infer<typeof CapabilityPageSchema>;
  let capability: Capability;
  let readiness: Readiness;
  try {
    sourcePage = SourcePageSchema.parse(reads.sourcePage);
    source = SourceSchema.parse(reads.source);
    bindingPage = BindingPageSchema.parse(reads.bindingPage);
    binding = BindingSchema.parse(reads.binding);
    serverPage = RuntimeServerPageSchema.parse(reads.serverPage);
    toolPage = RuntimeToolPageSchema.parse(reads.toolPage);
    capabilityPage = CapabilityPageSchema.parse(reads.capabilityPage);
    capability = CapabilitySchema.parse(reads.capability);
    readiness = ReadinessSchema.parse(reads.readiness);
  } catch (error: unknown) {
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_AUTHORITY_RESPONSE_INVALID',
      `The ${phase} recovery authority response is invalid.`,
      { cause: error },
    );
  }
  assertSourceExact(configuration, sourcePage.items, source, observedAt);
  assertBindingExact(configuration, bindingPage.items, binding, observedAt);
  const runtime = assertRuntimeExact(serverPage.items, toolPage.items, binding, observedAt);
  assertCapabilityExact(capabilityPage.items, capability, readiness, binding, observedAt);
  const sourceCurrent = Date.parse(requiredSourceValidUntil(source)) > Date.parse(observedAt);
  const candidate = readCandidate(
    reads.candidates,
    source,
    binding,
    phase === 'post' || sourceCurrent,
  );
  assertRegistryExact(reads.registry, source, binding, candidate, observedAt);
  return Object.freeze({
    observedAt,
    source,
    binding,
    server: runtime.server,
    tools: runtime.tools,
    capability,
    readiness,
    ...(candidate === undefined ? {} : { candidate }),
    registry: reads.registry,
    bindingHash: hashCanonicalAuthorityJson(binding),
    runtimeHash: hashCanonicalAuthorityJson({
      server: runtime.server,
      tools: runtime.tools,
      catalog: runtime.catalog,
    }),
    capabilityHash: hashCanonicalAuthorityJson(capability),
    ...(candidate === undefined
      ? {}
      : { candidateIdentityHash: hashCanonicalAuthorityJson(candidateIdentity(candidate)) }),
    registryLineageHash: hashCanonicalAuthorityJson(registryLineage(reads.registry)),
    runtimeCatalog: runtime.catalog,
  });
}

function assertDurableAuthorityRunway(authority: FrozenAuthority): void {
  const observedAt = Date.parse(authority.observedAt);
  const bindingRemaining = Date.parse(authority.binding.availabilityValidUntil) - observedAt;
  const runtimeRemaining = Date.parse(authority.server.currentDiscovery.validUntil) - observedAt;
  if (
    bindingRemaining < DURABLE_AUTHORITY_RUNWAY_MS ||
    runtimeRemaining < DURABLE_AUTHORITY_RUNWAY_MS
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_RUNTIME_RUNWAY_INSUFFICIENT',
      'Binding or Runtime discovery has less than the required 20-minute pre-delegation runway.',
    );
}

function assertSourceExact(
  configuration: UgvB02SourceRecoveryConfiguration,
  items: readonly Source[],
  source: Source,
  observedAt: string,
): void {
  if (
    items.length !== 1 ||
    hashCanonicalAuthorityJson(items[0]) !== hashCanonicalAuthorityJson(source) ||
    source.smppSourceId !== EXPECTED_SOURCE_ID ||
    normalizedEndpoint(source.registryEndpoint) !== EXPECTED_SOURCE_ENDPOINT ||
    source.credentialRef !== SMPP_UNAUTHENTICATED_CREDENTIAL_REF ||
    source.environment !== 'simulation' ||
    source.syncMode !== 'manual' ||
    source.snapshotTtlSeconds !== configuration.source.snapshotTtlSeconds ||
    source.lkgPolicy !== 'deny_when_unavailable' ||
    source.status !== 'active' ||
    source.activeSnapshotRevision === undefined ||
    source.activeSnapshotChecksum === undefined ||
    source.activeSnapshotValidUntil === undefined ||
    source.lastSyncAt === undefined ||
    Date.parse(source.lastSyncAt) > Date.parse(observedAt) ||
    Date.parse(source.activeSnapshotValidUntil) <= Date.parse(source.lastSyncAt) ||
    source.lastErrorCode !== undefined ||
    source.revision !== 1
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_SOURCE_DRIFT',
      'The existing Source is not the sole exact active B02 Source authority.',
    );
}

function assertBindingExact(
  configuration: UgvB02SourceRecoveryConfiguration,
  items: readonly z.infer<typeof BindingInventorySchema>[],
  binding: Binding,
  observedAt: string,
): void {
  if (
    items.length !== 1 ||
    hashCanonicalAuthorityJson(items[0]) !==
      hashCanonicalAuthorityJson(bindingInventory(binding)) ||
    binding.bindingId !== EXPECTED_BINDING_ID ||
    binding.localServerId !== configuration.localServerId ||
    binding.smppSourceId !== EXPECTED_SOURCE_ID ||
    binding.externalProviderId !== EXPECTED_PROVIDER_ID ||
    binding.externalServerId !== EXPECTED_EXTERNAL_SERVER_ID ||
    normalizedEndpoint(binding.endpointRef) !== EXPECTED_PROVIDER_ENDPOINT ||
    binding.status !== 'active' ||
    binding.availabilityStatus !== 'available' ||
    binding.revision !== 1 ||
    binding.operationCount !== EXPECTED_TOOL_NAMES.length ||
    Date.parse(binding.availabilityValidUntil) <= Date.parse(observedAt) ||
    Date.parse(binding.catalogObservedAt) > Date.parse(observedAt)
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_BINDING_DRIFT',
      'The existing Binding is stale, extra, or not the exact immutable B02 authority.',
    );
}

function assertRuntimeExact(
  servers: readonly RuntimeServer[],
  tools: readonly RuntimeTool[],
  binding: Binding,
  observedAt: string,
): Readonly<{
  server: RuntimeServer;
  tools: readonly RuntimeTool[];
  catalog: Readonly<{ catalogRevision: string; catalogChecksum: string; operationCount: number }>;
}> {
  const server = servers[0];
  const actualNames = tools.map(({ toolName }) => toolName).sort();
  const expectedNames = [...EXPECTED_TOOL_NAMES].sort();
  if (servers.length !== 1 || server === undefined)
    return fail(
      'UGV_B02_SOURCE_RECOVERY_RUNTIME_DRIFT',
      'The Runtime authority is stale, extra, or not the exact ten-Tool B02 Catalog.',
    );
  if (
    server.serverId !== EXPECTED_LOCAL_SERVER_ID ||
    normalizedEndpoint(server.endpoint) !== EXPECTED_PROVIDER_ENDPOINT ||
    server.status !== 'enabled' ||
    server.toolRevision !== binding.revision ||
    server.currentProtocolSnapshotId !== server.currentDiscovery.snapshotId ||
    server.currentDiscovery.serverId !== server.serverId ||
    server.currentDiscovery.toolRevision !== server.toolRevision ||
    server.currentDiscovery.providerCatalog.providerId !== EXPECTED_PROVIDER_ID ||
    Date.parse(server.currentDiscovery.discoveredAt) > Date.parse(observedAt) ||
    Date.parse(server.currentDiscovery.validUntil) <= Date.parse(observedAt) ||
    Date.parse(server.currentDiscovery.validUntil) <=
      Date.parse(server.currentDiscovery.discoveredAt) ||
    tools.length !== EXPECTED_TOOL_NAMES.length ||
    actualNames.some((name, index) => name !== expectedNames[index]) ||
    tools.some(
      (tool) =>
        tool.serverId !== server.serverId || Date.parse(tool.discoveredAt) > Date.parse(observedAt),
    )
  )
    return fail(
      'UGV_B02_SOURCE_RECOVERY_RUNTIME_DRIFT',
      'The Runtime authority is stale, extra, or not the exact ten-Tool B02 Catalog.',
    );
  let catalog: ReturnType<typeof deriveFrozenMcpCatalogAuthority>;
  try {
    catalog = deriveFrozenMcpCatalogAuthority(
      server.currentDiscovery,
      tools as unknown as readonly McpTool[],
      server.toolRevision,
    );
  } catch (error: unknown) {
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_RUNTIME_DRIFT',
      'The Runtime Catalog authority is invalid.',
      { cause: error },
    );
  }
  if (
    catalog.catalogRevision !== binding.catalogRevision ||
    catalog.catalogChecksum !== binding.catalogChecksum ||
    catalog.operationCount !== binding.operationCount
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_RUNTIME_DRIFT',
      'The Runtime Catalog identity differs from the frozen Binding.',
    );
  return Object.freeze({ server, tools: Object.freeze([...tools]), catalog });
}

function assertCapabilityExact(
  items: readonly Capability[],
  capability: Capability,
  readiness: Readiness,
  binding: Binding,
  observedAt: string,
): void {
  const providerPolicies = (capability.constraints ?? []).filter(
    (constraint) => constraint['type'] === 'provider_binding_policy',
  );
  const providerPolicy = providerPolicies[0];
  if (
    items.length !== 1 ||
    hashCanonicalAuthorityJson(items[0]) !== hashCanonicalAuthorityJson(capability) ||
    capability.capabilityId !== EXPECTED_CAPABILITY_ID ||
    capability.version !== 2 ||
    capability.status !== 'published' ||
    providerPolicies.length !== 1 ||
    providerPolicy?.['mcpProviderBindingId'] !== binding.bindingId ||
    providerPolicy['localServerId'] !== binding.localServerId ||
    providerPolicy['mcpToolName'] !== 'vehicle_navigate' ||
    providerPolicy['bindingRevision'] !== binding.revision ||
    providerPolicy['catalogRevision'] !== binding.catalogRevision ||
    providerPolicy['catalogChecksum'] !== binding.catalogChecksum ||
    providerPolicy['requiredStatus'] !== 'active' ||
    providerPolicy['requiredAvailabilityStatus'] !== 'available' ||
    providerPolicy['requiredFreshness'] !== 'unexpired' ||
    providerPolicy['fallback'] !== 'deny' ||
    readiness.capabilityId !== capability.capabilityId ||
    readiness.capabilityVersion !== capability.version ||
    !PREFIXED_CHECKSUM.test(readiness.policyHash) ||
    !PREFIXED_CHECKSUM.test(readiness.catalogHash) ||
    Date.parse(readiness.evaluatedAt) > Date.parse(observedAt) ||
    Date.parse(readiness.validUntil) <= Date.parse(readiness.evaluatedAt) ||
    (readiness.availableImplementations ?? []).some(
      (identity) => identity !== EXPECTED_IMPLEMENTATION_ID,
    ) ||
    (readiness.unavailableImplementations ?? []).some(
      (identity) => identity !== EXPECTED_IMPLEMENTATION_ID,
    )
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_CAPABILITY_DRIFT',
      'Capability v2 or its exact frozen Provider policy differs from B02 authority.',
    );
}

function assertRegistryExact(
  registry: RegistryProjectionAuthority,
  source: Source,
  binding: Binding,
  candidate: Candidate | undefined,
  observedAt: string,
): void {
  const provider = registry.projection.providers[0];
  if (
    registry.projection.providers.length !== 1 ||
    provider === undefined ||
    registry.projection.revision !== requiredSourceRevision(source) ||
    registry.projection.checksum !== requiredSourceChecksum(source) ||
    registry.projection.revision !== binding.registryRevision ||
    registry.projection.checksum !== binding.registryChecksum ||
    Date.parse(registry.projection.generatedAt) > Date.parse(observedAt) ||
    Date.parse(registry.projection.expiresAt) <= Date.parse(observedAt) ||
    Date.parse(registry.projection.expiresAt) <= Date.parse(registry.projection.generatedAt) ||
    registry.nativeRevision !== registry.projection.revision ||
    (candidate !== undefined && registry.nativeRevision !== candidate.nativeRegistryRevision) ||
    (candidate !== undefined && registry.nativeChecksum !== candidate.nativeRegistryChecksum) ||
    provider.externalProviderId !== EXPECTED_PROVIDER_ID ||
    provider.externalServerId !== EXPECTED_EXTERNAL_SERVER_ID ||
    normalizedEndpoint(provider.serverEndpoint) !== normalizedEndpoint(binding.endpointRef)
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_DRIFT',
      'The full Registry projection or native lineage differs from the frozen Binding.',
    );
}

function assertBootstrapExact(bootstrap: UgvSmppSourceBootstrapReport, pre: FrozenAuthority): void {
  if (
    bootstrap.sourceAction !== 'reused' ||
    bootstrap.sourceRevision !== pre.source.revision ||
    bootstrap.snapshotRevision !== pre.binding.registryRevision ||
    bootstrap.snapshotChecksum !== pre.binding.registryChecksum ||
    bootstrap.nativeRegistryRevision !== pre.registry.nativeRevision ||
    bootstrap.nativeRegistryChecksum !== pre.registry.nativeChecksum ||
    bootstrap.initialSyncOutcome !== 'not_modified' ||
    Date.parse(bootstrap.snapshotValidUntil) <= Date.parse(requiredSourceValidUntil(pre.source))
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_SYNC_DRIFT',
      'Formal Source synchronization did not reuse the exact frozen Snapshot lineage.',
    );
}

function readCandidate(
  value: unknown,
  source: Source,
  binding: Binding,
  required: boolean,
): Candidate | undefined {
  let page: z.infer<typeof CandidatePageSchema>;
  try {
    page = CandidatePageSchema.parse(value);
  } catch (error: unknown) {
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_CANDIDATE_INVALID',
      'The existing Candidate authority response is invalid.',
      { cause: error },
    );
  }
  const candidate = page.items[0];
  if (!required && page.items.length === 0) return undefined;
  if (page.items.length !== 1 || candidate === undefined)
    return fail(
      'UGV_B02_SOURCE_RECOVERY_CANDIDATE_DRIFT',
      'The sole existing Source Candidate does not retain the exact frozen lineage and endpoint.',
    );
  if (
    candidate.smppSourceId !== EXPECTED_SOURCE_ID ||
    candidate.externalProviderId !== EXPECTED_PROVIDER_ID ||
    candidate.externalServerId !== EXPECTED_EXTERNAL_SERVER_ID ||
    candidate.registryRevision !== requiredSourceRevision(source) ||
    candidate.registryChecksum !== requiredSourceChecksum(source) ||
    candidate.registryEtag !== `"${candidate.registryChecksum}"` ||
    candidate.registryValidUntil !== requiredSourceValidUntil(source) ||
    normalizedEndpoint(candidate.serverEndpoint) !== normalizedEndpoint(binding.endpointRef)
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_CANDIDATE_DRIFT',
      'The sole existing Source Candidate does not retain the exact frozen lineage and endpoint.',
    );
  return candidate;
}

function requiredCandidate(authority: FrozenAuthority): Candidate {
  if (authority.candidate === undefined)
    return fail(
      'UGV_B02_SOURCE_RECOVERY_CANDIDATE_DRIFT',
      'Current Source authority does not expose its sole exact Candidate.',
    );
  return authority.candidate;
}

function assertAuthorityUnchanged(
  pre: FrozenAuthority,
  post: FrozenAuthority,
  bootstrap: UgvSmppSourceBootstrapReport,
): void {
  const postCandidate = requiredCandidate(post);
  const beforeValidUntil = requiredSourceValidUntil(pre.source);
  const afterValidUntil = requiredSourceValidUntil(post.source);
  if (
    post.source.revision !== pre.source.revision ||
    requiredSourceRevision(post.source) !== requiredSourceRevision(pre.source) ||
    requiredSourceChecksum(post.source) !== requiredSourceChecksum(pre.source) ||
    Date.parse(afterValidUntil) <= Date.parse(beforeValidUntil) ||
    Date.parse(afterValidUntil) - Date.parse(post.observedAt) < SOURCE_RECOVERY_REFRESH_RUNWAY_MS ||
    post.source.lastSyncAt === undefined ||
    pre.source.lastSyncAt === undefined ||
    Date.parse(post.source.lastSyncAt) <= Date.parse(pre.source.lastSyncAt) ||
    bootstrap.snapshotValidUntil !== afterValidUntil
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_TTL_NOT_REFRESHED',
      'The same Source pointer did not receive a strictly newer current validity window.',
    );
  if (pre.bindingHash !== post.bindingHash)
    fail(
      'UGV_B02_SOURCE_RECOVERY_BINDING_MUTATED',
      'Source recovery changed Binding revision, Catalog, status, availability, or operation count.',
    );
  if (pre.runtimeHash !== post.runtimeHash)
    fail(
      'UGV_B02_SOURCE_RECOVERY_RUNTIME_MUTATED',
      'Source recovery changed Runtime discovery, Tool revision, or Catalog.',
    );
  if (
    pre.capabilityHash !== post.capabilityHash ||
    pre.capability.definitionHash !== post.capability.definitionHash ||
    pre.readiness.capabilityId !== post.readiness.capabilityId ||
    pre.readiness.capabilityVersion !== post.readiness.capabilityVersion ||
    pre.readiness.policyHash !== post.readiness.policyHash
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_CAPABILITY_MUTATED',
      'Source recovery changed Capability v2 definition or Provider policy identity.',
    );
  if (
    pre.registryLineageHash !== post.registryLineageHash ||
    postCandidate.registryRevision !== pre.binding.registryRevision ||
    postCandidate.registryChecksum !== pre.binding.registryChecksum ||
    postCandidate.nativeRegistryRevision !== pre.registry.nativeRevision ||
    postCandidate.nativeRegistryChecksum !== pre.registry.nativeChecksum ||
    normalizedEndpoint(postCandidate.serverEndpoint) !==
      normalizedEndpoint(pre.binding.endpointRef) ||
    (pre.candidateIdentityHash !== undefined &&
      pre.candidateIdentityHash !== post.candidateIdentityHash)
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_LINEAGE_MUTATED',
      'Source recovery changed projected or native Registry lineage.',
    );
}

function assertReplayAuthorityMatches(
  report: UgvB02SourceRecoveryReport,
  current: FrozenAuthority,
): void {
  const candidate = requiredCandidate(current);
  if (
    current.source.revision !== report.source.revision ||
    requiredSourceRevision(current.source) !== report.source.snapshotRevision ||
    requiredSourceChecksum(current.source) !== report.source.snapshotChecksum ||
    Date.parse(requiredSourceValidUntil(current.source)) <
      Date.parse(report.source.validUntilAfter) ||
    candidate.nativeRegistryRevision !== report.source.nativeRevision ||
    candidate.nativeRegistryChecksum !== report.source.nativeChecksum ||
    current.binding.revision !== report.binding.revision ||
    current.binding.catalogRevision !== report.binding.catalogRevision ||
    current.binding.catalogChecksum !== report.binding.catalogChecksum ||
    current.binding.availabilityValidUntil !== report.binding.availabilityValidUntil ||
    current.binding.operationCount !== report.binding.operationCount ||
    current.server.toolRevision !== report.runtime.toolRevision ||
    current.runtimeCatalog.catalogRevision !== report.runtime.catalogRevision ||
    current.runtimeCatalog.catalogChecksum !== report.runtime.catalogChecksum ||
    current.server.currentDiscovery.validUntil !== report.runtime.discoveryValidUntil ||
    current.runtimeCatalog.operationCount !== report.runtime.operationCount ||
    current.capability.version !== report.capability.version ||
    current.capability.definitionHash !== report.capability.definitionHash ||
    current.readiness.policyHash !== report.capability.policyHash
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_REPLAY_AUTHORITY_DRIFT',
      'Current Source, Binding, Runtime, or Capability authority differs from the persisted recovery report.',
    );
}

function candidateIdentity(candidate: Candidate): Omit<Candidate, 'registryValidUntil'> {
  const { registryValidUntil, ...identity } = candidate;
  void registryValidUntil;
  return identity;
}

function registryLineage(registry: RegistryProjectionAuthority): Readonly<{
  revision: number;
  checksum: string;
  providers: readonly z.infer<typeof RegistryProviderSchema>[];
  nativeRevision: number;
  nativeChecksum: string;
  projectionContract: typeof PROJECTION_CONTRACT;
}> {
  return Object.freeze({
    revision: registry.projection.revision,
    checksum: registry.projection.checksum,
    providers: registry.projection.providers,
    nativeRevision: registry.nativeRevision,
    nativeChecksum: registry.nativeChecksum,
    projectionContract: registry.projectionContract,
  });
}

async function controlGet(
  configuration: UgvB02SourceRecoveryConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return getJson(
    `${configuration.nodeControlBaseUrl}${path}`,
    configuration.nodeControlAdminToken,
    request,
  );
}

async function runtimeGet(
  configuration: UgvB02SourceRecoveryConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return getJson(`${configuration.runtimeManagementBaseUrl}${path}`, undefined, request);
}

async function getJson(
  url: string,
  token: string | undefined,
  request: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await request(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_HTTP_FAILED',
      'A recovery authority GET failed.',
      { cause: error },
    );
  }
  if (response.status !== 200 || response.redirected)
    fail('UGV_B02_SOURCE_RECOVERY_HTTP_FAILED', 'A recovery authority GET was rejected.');
  return boundedJson(response);
}

async function readRegistryProjection(
  configuration: UgvB02SourceRecoveryConfiguration,
  request: typeof fetch,
): Promise<RegistryProjectionAuthority> {
  let response: Response;
  try {
    response = await request(configuration.source.registryEndpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_UNAVAILABLE',
      'The mandatory full Registry projection GET failed.',
      { cause: error },
    );
  }
  if (response.status === 304)
    fail(
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_FULL_SNAPSHOT_REQUIRED',
      'An expired Source pointer cannot be recovered from a 304 response.',
    );
  if (response.status !== 200 || response.redirected)
    fail(
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_UNAVAILABLE',
      'The mandatory full Registry projection GET was rejected.',
    );
  let projection: z.infer<typeof RegistryProjectionSchema>;
  try {
    projection = RegistryProjectionSchema.parse(await boundedJson(response));
  } catch (error: unknown) {
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_INVALID',
      'The full Registry projection response is invalid.',
      { cause: error },
    );
  }
  const nativeRevisionHeader = response.headers.get('x-smpp-native-revision');
  const nativeChecksum = response.headers.get('x-smpp-native-checksum');
  const projectionContract = response.headers.get('x-smpp-projection-contract');
  const nativeRevision = Number(nativeRevisionHeader);
  if (
    nativeRevisionHeader !== String(nativeRevision) ||
    !Number.isSafeInteger(nativeRevision) ||
    nativeRevision < 1 ||
    nativeRevision !== projection.revision ||
    nativeChecksum === null ||
    !CHECKSUM.test(nativeChecksum) ||
    projectionContract !== PROJECTION_CONTRACT ||
    response.headers.get('etag') !== `"${projection.checksum}"`
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_INVALID',
      'The Registry projection headers do not carry exact native lineage.',
    );
  return Object.freeze({
    projection,
    nativeRevision,
    nativeChecksum,
    projectionContract: PROJECTION_CONTRACT,
  });
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES)
    fail('UGV_B02_SOURCE_RECOVERY_HTTP_FAILED', 'A recovery response exceeded its size bound.');
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES)
    fail('UGV_B02_SOURCE_RECOVERY_HTTP_FAILED', 'A recovery response exceeded its size bound.');
  try {
    return JSON.parse(body) as unknown;
  } catch {
    fail('UGV_B02_SOURCE_RECOVERY_HTTP_FAILED', 'A recovery response was not JSON.');
  }
}

function validateConfiguration(
  input: UgvB02SourceRecoveryConfiguration,
): UgvB02SourceRecoveryConfiguration {
  if (
    input.nodeControlBaseUrl !== EXPECTED_NODE_CONTROL_BASE_URL ||
    input.runtimeManagementBaseUrl !== EXPECTED_RUNTIME_MANAGEMENT_BASE_URL ||
    input.source.smppSourceId !== EXPECTED_SOURCE_ID ||
    normalizedEndpoint(input.source.registryEndpoint) !== EXPECTED_SOURCE_ENDPOINT ||
    input.source.registryCredentialRef !== SMPP_UNAUTHENTICATED_CREDENTIAL_REF ||
    input.source.smppEnvironment !== 'simulation' ||
    input.source.syncMode !== 'manual' ||
    input.source.lkgPolicy !== 'deny_when_unavailable' ||
    input.source.externalProviderId !== EXPECTED_PROVIDER_ID ||
    input.source.externalServerId !== EXPECTED_EXTERNAL_SERVER_ID ||
    input.localServerId !== EXPECTED_LOCAL_SERVER_ID ||
    input.providerBindingId !== EXPECTED_BINDING_ID ||
    input.source.snapshotTtlSeconds !== EXPECTED_SOURCE_SNAPSHOT_TTL_SECONDS ||
    !ATTEMPT_ID.test(input.attemptId) ||
    input.nodeControlAdminToken.trim().length < 16 ||
    input.nodeControlAdminToken.length > 4_096
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_CONFIGURATION_INVALID',
      'The recovery configuration is not the exact NO-stage B02 authority.',
    );
  return Object.freeze({ ...input, source: Object.freeze({ ...input.source }) });
}

export async function ugvB02SourceRecoveryConfigurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<UgvB02SourceRecoveryConfiguration> {
  if (environment['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'] !== undefined)
    fail(
      'UGV_B02_SOURCE_RECOVERY_SIDE_EFFECT_AUTHORITY_NOT_ISOLATED',
      'Source recovery requires the outer side-effect authorization variable to be absent.',
    );
  return validateConfiguration({
    nodeControlBaseUrl: requiredEnvironment(environment, 'SDAR_NODE_CONTROL_BASE_URL', 2_048),
    nodeControlAdminToken: await controlToken(environment),
    runtimeManagementBaseUrl: requiredEnvironment(
      environment,
      'SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL',
      2_048,
    ),
    attemptId: requiredEnvironment(environment, 'UGV_B02_SOURCE_RECOVERY_ATTEMPT_ID', 160),
    source: {
      smppSourceId: requiredEnvironment(environment, 'SMPP_SDAR_SOURCE_ID', 256),
      ...(environment['SMPP_SDAR_SOURCE_NAME']?.trim()
        ? { sourceName: environment['SMPP_SDAR_SOURCE_NAME'].trim() }
        : {}),
      smppEnvironment: requiredEnvironment(environment, 'SMPP_ENVIRONMENT', 63),
      registryEndpoint: requiredEnvironment(environment, 'SMPP_SDAR_REGISTRY_ENDPOINT', 2_048),
      registryCredentialRef: requiredEnvironment(environment, 'SMPP_REGISTRY_CREDENTIAL_REF', 512),
      syncMode: 'manual',
      snapshotTtlSeconds: positiveIntegerEnvironment(
        environment,
        'SMPP_SNAPSHOT_TTL_SECONDS',
        EXPECTED_SOURCE_SNAPSHOT_TTL_SECONDS,
      ),
      lkgPolicy: 'deny_when_unavailable',
      externalProviderId: requiredEnvironment(environment, 'SMPP_UGV_EXTERNAL_PROVIDER_ID', 256),
      externalServerId: requiredEnvironment(environment, 'SMPP_UGV_EXTERNAL_SERVER_ID', 256),
    },
    localServerId: requiredEnvironment(environment, 'SDAR_UGV_LOCAL_SERVER_ID', 256),
    providerBindingId: requiredEnvironment(environment, 'SDAR_UGV_BINDING_ID', 256),
  });
}

async function controlToken(environment: NodeJS.ProcessEnv): Promise<string> {
  const inline = environment['SDAR_CONTROL_API_TOKEN']?.trim();
  const file = environment['SDAR_CONTROL_API_TOKEN_FILE']?.trim();
  if ((inline === undefined || inline === '') === (file === undefined || file === ''))
    fail(
      'UGV_B02_SOURCE_RECOVERY_CONFIGURATION_INVALID',
      'Exactly one bounded Node Control token source is required.',
    );
  if (inline !== undefined && inline !== '') return inline;
  const target = resolve(file ?? '');
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error: unknown) {
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_TOKEN_FILE_UNSAFE',
      'The Node Control token file is unavailable.',
      { cause: error },
    );
  }
  const getuid = process.getuid?.();
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (getuid !== undefined && metadata.uid !== getuid) ||
    (metadata.mode & 0o077) !== 0 ||
    metadata.size < 1 ||
    metadata.size > 4_096
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_TOKEN_FILE_UNSAFE',
      'The Node Control token file must be a bounded owner-only regular file.',
    );
  const token = (await readFile(target, 'utf8')).trim();
  if (token.length < 16 || token.length > 4_096)
    fail(
      'UGV_B02_SOURCE_RECOVERY_TOKEN_FILE_UNSAFE',
      'The Node Control token file is empty or unbounded.',
    );
  return token;
}

function bindingInventory(binding: Binding): z.infer<typeof BindingInventorySchema> {
  const { availabilityValidUntil, catalogObservedAt, operationCount, ...inventory } = binding;
  void availabilityValidUntil;
  void catalogObservedAt;
  void operationCount;
  return inventory;
}

function requiredSourceRevision(source: Source): number {
  if (source.activeSnapshotRevision === undefined)
    return fail('UGV_B02_SOURCE_RECOVERY_SOURCE_DRIFT', 'Source Snapshot revision is missing.');
  return source.activeSnapshotRevision;
}

function requiredSourceChecksum(source: Source): string {
  if (source.activeSnapshotChecksum === undefined)
    return fail('UGV_B02_SOURCE_RECOVERY_SOURCE_DRIFT', 'Source Snapshot checksum is missing.');
  return source.activeSnapshotChecksum;
}

function requiredSourceValidUntil(source: Source): string {
  if (source.activeSnapshotValidUntil === undefined)
    return fail('UGV_B02_SOURCE_RECOVERY_SOURCE_DRIFT', 'Source Snapshot validity is missing.');
  return source.activeSnapshotValidUntil;
}

function normalizedEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    return fail(
      'UGV_B02_SOURCE_RECOVERY_CONFIGURATION_INVALID',
      'Expected an absolute HTTP(S) endpoint.',
    );
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username !== '' ||
    endpoint.password !== ''
  )
    fail(
      'UGV_B02_SOURCE_RECOVERY_CONFIGURATION_INVALID',
      'Expected a credential-free HTTP(S) endpoint.',
    );
  endpoint.hash = '';
  return endpoint.toString().replace(/\/$/u, '');
}

function pageSchema<T extends z.ZodType>(item: T) {
  return z
    .object({
      items: z.array(item),
      totalEstimate: z.number().int().nonnegative().optional(),
      asOf: z.iso.datetime().optional(),
    })
    .loose();
}

function timestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value)))
    fail('UGV_B02_SOURCE_RECOVERY_CLOCK_INVALID', 'The recovery clock is invalid.');
  return value;
}

function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  maximum: number,
): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === '' || value.length > maximum)
    fail(
      'UGV_B02_SOURCE_RECOVERY_CONFIGURATION_INVALID',
      'Required bounded recovery configuration is missing.',
    );
  return value;
}

function positiveIntegerEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  maximum: number,
): number {
  const raw = requiredEnvironment(environment, name, 16);
  if (!/^[1-9][0-9]*$/u.test(raw))
    return fail(
      'UGV_B02_SOURCE_RECOVERY_CONFIGURATION_INVALID',
      'Recovery TTL configuration is invalid.',
    );
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > maximum)
    fail('UGV_B02_SOURCE_RECOVERY_CONFIGURATION_INVALID', 'Recovery TTL configuration is invalid.');
  return value;
}

function recoveryRunId(authorization: AttemptAuthorization): string {
  return `uap-b02-source-recovery-${authorization.identityRecordSha256.slice('sha256:'.length, 39)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Hashes an already schema-validated private authority snapshot. This deliberately does not use
 * the public evidence canonicalizer: formal MCP discovery contains the legitimate protocol field
 * `authorizationModel`, which the public evidence boundary correctly rejects by name. The result
 * never leaves the private pre/post comparison and therefore must preserve that field rather than
 * weaken the public redaction policy.
 */
function hashCanonicalAuthorityJson(value: unknown): string {
  return sha256(canonicalAuthorityJson(value));
}

function canonicalAuthorityJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      return fail(
        'UGV_B02_SOURCE_RECOVERY_AUTHORITY_RESPONSE_INVALID',
        'Private authority JSON contains a non-finite number.',
      );
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalAuthorityJson).join(',')}]`;
  if (typeof value !== 'object')
    return fail(
      'UGV_B02_SOURCE_RECOVERY_AUTHORITY_RESPONSE_INVALID',
      'Private authority JSON contains a non-JSON value.',
    );
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalAuthorityJson(record[key])}`)
    .join(',')}}`;
}

function fail(code: string, message: string): never {
  throw new UgvB02SourceRecoveryError(code, message);
}
