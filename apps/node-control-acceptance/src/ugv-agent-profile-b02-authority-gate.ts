import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  deriveFrozenMcpCatalogAuthority,
  hashCanonicalEvidenceJson,
  type McpTool,
} from '../../../packages/domain/src/index.js';
import {
  nodeCapabilityEtag,
  smppSourceEtag,
  type NodeCapabilityDefinitionVersion,
  type SmppRegistrySource,
} from '../../../packages/node-control-domain/src/index.js';

export const UGV_B02_SOURCE_AUTHORITY_RUNWAY_MS = 240_000 as const;
export const UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS = 1_200_000 as const;
export const UGV_B02_READINESS_RUNWAY_MS = 30_000 as const;

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
const EXPECTED_CATALOG_REVISION = '2.0.0-rc.1:1';
const EXPECTED_CAPABILITY_ID = 'embodied.move';
const EXPECTED_IMPLEMENTATION_ID = 'capability-binding-embodied.move-v2';
const CHECKSUM = /^[a-f0-9]{64}$/u;
const PREFIXED_CHECKSUM = /^sha256:[a-f0-9]{64}$/u;
const STRONG_SNAPSHOT_ETAG = /^"(sha256:[a-f0-9]{64})"$/u;
const MAX_AUTHORITY_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const READINESS_POLL_INTERVAL_MS = 1_000;
const READINESS_POLL_WINDOW_MS = 30_000;
const READINESS_MAX_POLLS = 31;
const B02_SIMULATION_ID = /^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u;
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

const SourceSchema = z
  .object({
    smppSourceId: z.string().min(1),
    name: z.string().min(1).optional(),
    registryEndpoint: z.url(),
    credentialRef: z.string().min(1),
    tenantId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    environment: z.string().min(1),
    syncMode: z.enum(['manual', 'poll', 'watch']),
    snapshotTtlSeconds: z.number().int().positive(),
    lkgPolicy: z.enum(['allow_unexpired', 'deny_when_unavailable']),
    status: z.enum(['draft', 'active', 'suspended', 'retired']),
    activeSnapshotRevision: z.number().int().positive().optional(),
    activeSnapshotChecksum: z.string().regex(CHECKSUM).optional(),
    activeSnapshotValidUntil: z.iso.datetime({ offset: true }).optional(),
    lastSyncAt: z.iso.datetime({ offset: true }).optional(),
    lastErrorCode: z.string().min(1).optional(),
    revision: z.number().int().positive(),
  })
  .strict();

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
        operationCount: z.number().int().positive().max(1_024),
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
    discoveredAt: z.iso.datetime({ offset: true }),
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
    discoveredAt: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }),
    toolRevision: z.number().int().positive(),
  })
  .loose();
const RuntimeServerSchema = z
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
const RuntimeServerCollectionSchema = z.object({ items: z.array(RuntimeServerSchema) }).loose();
const RuntimeToolCollectionSchema = z.object({ items: z.array(ToolSchema) }).loose();
const ReadinessSchema = z
  .object({
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    snapshotVersion: z.number().int().positive(),
    status: z.enum(['available', 'degraded', 'unavailable', 'suspended']),
    evaluatedAt: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }),
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
    availableImplementations: z.array(z.string()),
    unavailableImplementations: z.array(z.string()),
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
    supportedModes: z.array(z.string()).optional(),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    status: z.enum(['draft', 'validating', 'published', 'suspended', 'deprecated', 'retired']),
    definitionHash: z.string().regex(CHECKSUM),
    constraints: z.array(z.record(z.string(), z.unknown())),
    previousVersion: z.number().int().positive().optional(),
    createdBy: z.string().min(1).optional(),
    createdAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export interface UgvB02AuthorityGateConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly runtimeManagementBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly runtimeControlBearerToken: string;
}

export interface UgvB02AuthorityGateDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
  readonly pause?: (milliseconds: number) => Promise<void>;
}

export interface UgvB02AuthorityGateResult {
  readonly status: 'ready';
  readonly observedAt: string;
  readonly minimumRemainingTtlMs: Readonly<{
    source: number;
    binding: number;
    runtimeDiscovery: number;
    readiness: number;
  }>;
  readonly budgetsMs: Readonly<{
    source: typeof UGV_B02_SOURCE_AUTHORITY_RUNWAY_MS;
    binding: typeof UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS;
    runtimeDiscovery: typeof UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS;
    readiness: typeof UGV_B02_READINESS_RUNWAY_MS;
  }>;
  readonly secretsIncluded: false;
  readonly endpointsIncluded: false;
}

export interface UgvB02AuthorityGatePrivateReport {
  readonly schemaVersion: 'sdar.ugv-agent-profile.b02-authority-gate/v1';
  readonly status: 'passed';
  readonly task: 'UAP-P3-B02';
  readonly simulationIdSha256: `sha256:${string}`;
  readonly admissionIdempotencyKeySha256: `sha256:${string}`;
  readonly observedAt: string;
  readonly budgetsMs: UgvB02AuthorityGateResult['budgetsMs'];
  readonly minimumRemainingTtlMs: UgvB02AuthorityGateResult['minimumRemainingTtlMs'];
  readonly etagChecks: readonly [
    'source_strong_etag_body_contract_valid',
    'capability_strong_etag_body_contract_valid',
    'readiness_strong_etag_canonical_body_hash_valid',
  ];
  readonly authorityChecks: readonly [
    'source_binding_candidate_lineage_exact',
    'runtime_discovery_catalog_exact',
    'capability_provider_policy_exact',
    'readiness_implementation_partition_exact',
    'same_round_observed_at',
  ];
  readonly redaction: Readonly<{
    secretsIncluded: false;
    endpointsIncluded: false;
    entityIdsIncluded: false;
  }>;
}

/** Builds the strict, secret-free envelope that the wrapper seals into the official run. */
export function createUgvB02AuthorityGatePrivateReport(
  simulationId: string,
  admissionIdempotencyKey: string,
  result: UgvB02AuthorityGateResult,
): UgvB02AuthorityGatePrivateReport {
  const simulationHash = createHash('sha256').update(simulationId).digest('hex');
  if (
    !B02_SIMULATION_ID.test(simulationId) ||
    admissionIdempotencyKey !== `uap-p3-b02-a2a-${simulationHash}`
  )
    fail('UGV_B02_AUTHORITY_GATE_REPORT_IDENTITY_INVALID', 'Gate report identity is invalid.');
  return Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.b02-authority-gate/v1',
    status: 'passed',
    task: 'UAP-P3-B02',
    simulationIdSha256: `sha256:${simulationHash}`,
    admissionIdempotencyKeySha256: `sha256:${createHash('sha256')
      .update(admissionIdempotencyKey)
      .digest('hex')}`,
    observedAt: result.observedAt,
    budgetsMs: Object.freeze({ ...result.budgetsMs }),
    minimumRemainingTtlMs: Object.freeze({ ...result.minimumRemainingTtlMs }),
    etagChecks: Object.freeze([
      'source_strong_etag_body_contract_valid',
      'capability_strong_etag_body_contract_valid',
      'readiness_strong_etag_canonical_body_hash_valid',
    ] as const),
    authorityChecks: Object.freeze([
      'source_binding_candidate_lineage_exact',
      'runtime_discovery_catalog_exact',
      'capability_provider_policy_exact',
      'readiness_implementation_partition_exact',
      'same_round_observed_at',
    ] as const),
    redaction: Object.freeze({
      secretsIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    }),
  });
}

/**
 * Read-only, fail-closed admission gate for the one B02 execution attempt. The deliberately layered
 * runway budgets are frozen independently: Source authority covers the execution-attempt admission
 * runway after Source/gate verification through the dispatch window, Binding/Runtime authority covers
 * the full external continuation window, and readiness is refreshed by the five-second Node Control
 * evaluator but must still expose a current exact implementation.
 */
export async function assertUgvB02AuthorityRunway(
  input: UgvB02AuthorityGateConfiguration,
  dependencies: UgvB02AuthorityGateDependencies = {},
): Promise<UgvB02AuthorityGateResult> {
  const configuration = validateConfiguration(input);
  const request = dependencies.fetch ?? fetch;
  const query = new URLSearchParams({
    bindingId: EXPECTED_BINDING_ID,
    localServerId: EXPECTED_LOCAL_SERVER_ID,
  });
  let values: readonly [
    AuthorityJsonResponse,
    AuthorityJsonResponse,
    AuthorityJsonResponse,
    AuthorityJsonResponse,
    AuthorityJsonResponse,
    AuthorityJsonResponse,
  ];
  try {
    values = await Promise.all([
      getJson(
        `${configuration.nodeControlBaseUrl}/api/v1/smpp-sources/${encodeURIComponent(EXPECTED_SOURCE_ID)}`,
        configuration.nodeControlBearerToken,
        request,
      ),
      getJson(
        `${configuration.nodeControlBaseUrl}/internal/v1/mcp-provider-bindings/current?${query.toString()}`,
        configuration.runtimeControlBearerToken,
        request,
      ),
      getJson(`${configuration.runtimeManagementBaseUrl}/api/v1/mcp/servers`, undefined, request),
      getJson(
        `${configuration.runtimeManagementBaseUrl}/api/v1/mcp/servers/${encodeURIComponent(EXPECTED_LOCAL_SERVER_ID)}/tools`,
        undefined,
        request,
      ),
      getJson(
        `${configuration.nodeControlBaseUrl}/api/v1/capability-readiness/${encodeURIComponent(EXPECTED_CAPABILITY_ID)}/2`,
        configuration.nodeControlBearerToken,
        request,
      ),
      getJson(
        `${configuration.nodeControlBaseUrl}/api/v1/node-capabilities/${encodeURIComponent(EXPECTED_CAPABILITY_ID)}/versions/2`,
        configuration.nodeControlBearerToken,
        request,
      ),
    ]);
  } catch (error: unknown) {
    if (error instanceof UgvB02AuthorityGateError) throw error;
    throw new UgvB02AuthorityGateError(
      'UGV_B02_AUTHORITY_HTTP_FAILED',
      'One or more formal read-only authority GETs failed.',
      { cause: error },
    );
  }
  const observedAt = timestamp(
    (dependencies.now ?? (() => new Date().toISOString()))(),
    'UGV_B02_AUTHORITY_CLOCK_INVALID',
  );
  let source: z.infer<typeof SourceSchema>;
  let authority: z.infer<typeof CurrentBindingAuthoritySchema>;
  let servers: z.infer<typeof RuntimeServerSchema>[];
  let tools: z.infer<typeof ToolSchema>[];
  let readiness: z.infer<typeof ReadinessSchema>;
  let capability: z.infer<typeof CapabilitySchema>;
  try {
    source = SourceSchema.parse(values[0].value);
    authority = CurrentBindingAuthoritySchema.parse(values[1].value);
    servers = RuntimeServerCollectionSchema.parse(values[2].value).items;
    tools = RuntimeToolCollectionSchema.parse(values[3].value).items;
    readiness = ReadinessSchema.parse(values[4].value);
    capability = CapabilitySchema.parse(values[5].value);
  } catch (error: unknown) {
    throw new UgvB02AuthorityGateError(
      'UGV_B02_AUTHORITY_RESPONSE_INVALID',
      'A formal authority response did not satisfy its bounded schema.',
      { cause: error },
    );
  }
  assertExactEtag(
    values[0].etag,
    smppSourceEtag(source as unknown as SmppRegistrySource),
    'UGV_B02_SOURCE_ETAG_MISMATCH',
    'Source body and its formal strong ETag differ.',
  );
  assertReadinessEtag(readiness, values[4].etag);
  assertExactEtag(
    values[5].etag,
    nodeCapabilityEtag(capability as unknown as NodeCapabilityDefinitionVersion),
    'UGV_B02_CAPABILITY_ETAG_MISMATCH',
    'Capability body and its formal strong ETag differ.',
  );
  const sourceRemaining = remaining(
    source.activeSnapshotValidUntil,
    observedAt,
    UGV_B02_SOURCE_AUTHORITY_RUNWAY_MS,
    'UGV_B02_SOURCE_TTL_INSUFFICIENT',
  );
  const bindingRemaining = remaining(
    authority.binding.availabilityValidUntil,
    observedAt,
    UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS,
    'UGV_B02_BINDING_TTL_INSUFFICIENT',
  );
  const server = servers[0];
  const runtimeRemaining = remaining(
    server?.currentDiscovery.validUntil,
    observedAt,
    UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS,
    'UGV_B02_RUNTIME_DISCOVERY_TTL_INSUFFICIENT',
  );
  assertSourceAndBindingIdentity(source, authority, observedAt);
  assertRuntimeIdentity(authority, servers, tools, observedAt);
  assertCapabilityIdentity(capability, authority);
  const readinessState = classifyReadiness(readiness, observedAt);
  if (readinessState === 'pending')
    throw new UgvB02AuthorityGateError(
      'UGV_B02_READINESS_PENDING',
      'Exact readiness is inside a bounded auto-reconciliation window.',
      { retryableReadiness: true },
    );
  const readinessRemaining = Date.parse(readiness.validUntil) - Date.parse(observedAt);
  if (readinessRemaining < UGV_B02_READINESS_RUNWAY_MS)
    throw new UgvB02AuthorityGateError(
      'UGV_B02_READINESS_TTL_INSUFFICIENT',
      'Readiness remaining TTL is below the frozen B02 admission budget.',
      { retryableReadiness: true },
    );
  return Object.freeze({
    status: 'ready',
    observedAt,
    minimumRemainingTtlMs: Object.freeze({
      source: sourceRemaining,
      binding: bindingRemaining,
      runtimeDiscovery: runtimeRemaining,
      readiness: readinessRemaining,
    }),
    budgetsMs: Object.freeze({
      source: UGV_B02_SOURCE_AUTHORITY_RUNWAY_MS,
      binding: UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS,
      runtimeDiscovery: UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS,
      readiness: UGV_B02_READINESS_RUNWAY_MS,
    }),
    secretsIncluded: false,
    endpointsIncluded: false,
  });
}

/** Waits only for an exact readiness auto-reconciliation; every poll re-proves all other authority. */
export async function waitForUgvB02AuthorityRunway(
  input: UgvB02AuthorityGateConfiguration,
  dependencies: UgvB02AuthorityGateDependencies = {},
): Promise<UgvB02AuthorityGateResult> {
  const pause =
    dependencies.pause ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = dependencies.now ?? (() => new Date().toISOString());
  const startedAt = Date.parse(now());
  if (!Number.isFinite(startedAt))
    fail('UGV_B02_AUTHORITY_CLOCK_INVALID', 'Authority clock is invalid.');
  for (let attempt = 1; attempt <= READINESS_MAX_POLLS; attempt += 1) {
    try {
      return await assertUgvB02AuthorityRunway(input, { ...dependencies, now });
    } catch (error: unknown) {
      if (!(error instanceof UgvB02AuthorityGateError) || !error.retryableReadiness) throw error;
      const current = Date.parse(now());
      if (
        !Number.isFinite(current) ||
        current - startedAt >= READINESS_POLL_WINDOW_MS ||
        attempt === READINESS_MAX_POLLS
      )
        fail(
          'UGV_B02_READINESS_RUNWAY_TIMEOUT',
          'Readiness did not expose its exact frozen runway inside 30 seconds.',
        );
      await pause(READINESS_POLL_INTERVAL_MS);
    }
  }
  return fail(
    'UGV_B02_READINESS_RUNWAY_TIMEOUT',
    'Readiness did not expose its exact frozen runway inside the bounded poll count.',
  );
}

function assertSourceAndBindingIdentity(
  source: z.infer<typeof SourceSchema>,
  authority: z.infer<typeof CurrentBindingAuthoritySchema>,
  observedAt: string,
): void {
  const { binding, sourceCandidateLineage: lineage } = authority;
  if (
    source.smppSourceId !== EXPECTED_SOURCE_ID ||
    source.registryEndpoint !== EXPECTED_SOURCE_ENDPOINT ||
    source.credentialRef !== 'unauthenticated://none' ||
    source.environment !== 'simulation' ||
    source.syncMode !== 'manual' ||
    source.snapshotTtlSeconds !== 300 ||
    source.lkgPolicy !== 'deny_when_unavailable' ||
    source.status !== 'active' ||
    source.activeSnapshotRevision === undefined ||
    source.activeSnapshotChecksum === undefined ||
    source.lastSyncAt === undefined ||
    Date.parse(source.lastSyncAt) > Date.parse(observedAt) ||
    source.lastErrorCode !== undefined ||
    source.revision !== 1 ||
    binding.bindingId !== EXPECTED_BINDING_ID ||
    binding.revision !== 1 ||
    binding.localServerId !== EXPECTED_LOCAL_SERVER_ID ||
    binding.providerId !== EXPECTED_PROVIDER_ID ||
    binding.externalProviderId !== EXPECTED_PROVIDER_ID ||
    binding.externalServerId !== EXPECTED_EXTERNAL_SERVER_ID ||
    binding.registryRevision !== source.activeSnapshotRevision ||
    binding.registryChecksum !== source.activeSnapshotChecksum ||
    binding.catalogRevision !== EXPECTED_CATALOG_REVISION ||
    binding.endpointRef !== EXPECTED_PROVIDER_ENDPOINT ||
    binding.operationCount !== EXPECTED_TOOL_NAMES.length ||
    Date.parse(binding.catalogObservedAt) > Date.parse(observedAt) ||
    Date.parse(authority.observedAt) > Date.parse(observedAt) ||
    lineage.smppSourceId !== EXPECTED_SOURCE_ID ||
    lineage.externalProviderId !== EXPECTED_PROVIDER_ID ||
    lineage.externalServerId !== EXPECTED_EXTERNAL_SERVER_ID ||
    lineage.registryRevision !== source.activeSnapshotRevision ||
    lineage.registryChecksum !== source.activeSnapshotChecksum ||
    lineage.nativeRevision !== 1 ||
    lineage.candidateEndpoint !== EXPECTED_PROVIDER_ENDPOINT
  )
    fail(
      'UGV_B02_SOURCE_BINDING_IDENTITY_DRIFT',
      'Source, Candidate lineage, or current Binding differs from the frozen B02 authority.',
    );
}

function assertCapabilityIdentity(
  capability: z.infer<typeof CapabilitySchema>,
  authority: z.infer<typeof CurrentBindingAuthoritySchema>,
): void {
  const providerPolicies = capability.constraints.filter(
    (constraint) => constraint['type'] === 'provider_binding_policy',
  );
  const targetPolicies = capability.constraints.filter(
    (constraint) => constraint['type'] === 'ugv_simulation_target_policy',
  );
  const provider = providerPolicies[0];
  const target = targetPolicies[0];
  if (
    capability.capabilityId !== EXPECTED_CAPABILITY_ID ||
    capability.version !== 2 ||
    capability.status !== 'published' ||
    providerPolicies.length !== 1 ||
    provider?.['mcpProviderBindingId'] !== EXPECTED_BINDING_ID ||
    provider['localServerId'] !== EXPECTED_LOCAL_SERVER_ID ||
    provider['mcpToolName'] !== 'vehicle_navigate' ||
    provider['bindingRevision'] !== authority.binding.revision ||
    provider['catalogRevision'] !== authority.binding.catalogRevision ||
    provider['catalogChecksum'] !== authority.binding.catalogChecksum ||
    provider['requiredStatus'] !== 'active' ||
    provider['requiredAvailabilityStatus'] !== 'available' ||
    provider['requiredFreshness'] !== 'unexpired' ||
    provider['fallback'] !== 'deny' ||
    targetPolicies.length !== 1 ||
    hashCanonicalEvidenceJson(target) !==
      hashCanonicalEvidenceJson({
        type: 'ugv_simulation_target_policy',
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
      })
  )
    fail(
      'UGV_B02_CAPABILITY_AUTHORITY_DRIFT',
      'Immutable embodied.move@2 no longer freezes the current exact Provider authority.',
    );
}

function assertRuntimeIdentity(
  authority: z.infer<typeof CurrentBindingAuthoritySchema>,
  servers: readonly z.infer<typeof RuntimeServerSchema>[],
  tools: readonly z.infer<typeof ToolSchema>[],
  observedAt: string,
): void {
  const server = servers[0];
  const discovery = server?.currentDiscovery;
  const navigate = tools.filter(({ toolName }) => toolName === 'vehicle_navigate');
  const expectedNames = [...EXPECTED_TOOL_NAMES].sort();
  const actualNames = tools.map(({ toolName }) => toolName).sort();
  if (
    servers.length !== 1 ||
    server === undefined ||
    discovery === undefined ||
    server.serverId !== EXPECTED_LOCAL_SERVER_ID ||
    server.endpoint !== EXPECTED_PROVIDER_ENDPOINT ||
    server.status !== 'enabled' ||
    server.toolRevision !== authority.binding.revision ||
    server.currentProtocolSnapshotId !== discovery.snapshotId ||
    discovery.serverId !== EXPECTED_LOCAL_SERVER_ID ||
    discovery.toolRevision !== server.toolRevision ||
    discovery.providerCatalog.providerId !== EXPECTED_PROVIDER_ID ||
    discovery.providerCatalog.providerType !== 'isr.vehicle.ugv' ||
    discovery.providerCatalog.providerVersion !== '1.0.0' ||
    Date.parse(discovery.discoveredAt) > Date.parse(observedAt) ||
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index]) ||
    tools.some(
      (tool) =>
        tool.serverId !== EXPECTED_LOCAL_SERVER_ID ||
        Date.parse(tool.discoveredAt) > Date.parse(observedAt),
    ) ||
    navigate.length !== 1
  )
    fail(
      'UGV_B02_RUNTIME_DISCOVERY_IDENTITY_DRIFT',
      'Runtime discovery or exact ten-Tool Catalog differs from the frozen B02 authority.',
    );
  const navigateTool = navigate[0];
  if (
    navigateTool?.executionSemantics.effect !== 'side_effecting' ||
    navigateTool.executionSemantics.execution !== 'task_required' ||
    navigateTool.executionSemantics.cancellation !== 'task_cancel' ||
    navigateTool.executionSemantics.idempotency !== 'server_managed' ||
    navigateTool.executionSemantics.replay !== 'simulation_only' ||
    navigateTool.executionSemantics.source !== 'admin_override' ||
    navigateTool.taskExecutionProfile.taskBehavior !== 'task_required' ||
    navigateTool.taskExecutionProfile.availability !== 'dynamic' ||
    !navigateTool.taskExecutionProfile.supportsScheduling ||
    !navigateTool.taskExecutionProfile.supportsMaxElapsed ||
    navigateTool.taskExecutionProfile.supportsCancellation !== true ||
    navigateTool.taskExecutionProfile.supportsPauseResume !== true ||
    !navigateTool.taskExecutionProfile.supportsObservations ||
    navigateTool.taskExecutionProfile.supportsInputRequired ||
    navigateTool.taskExecutionProfile.idempotency !== 'server_managed'
  )
    fail(
      'UGV_B02_RUNTIME_DISCOVERY_IDENTITY_DRIFT',
      'vehicle_navigate does not retain the frozen simulation-only Task authority.',
    );
  const catalog = deriveFrozenMcpCatalogAuthority(
    discovery,
    tools as unknown as readonly McpTool[],
    server.toolRevision,
  );
  if (
    catalog.catalogRevision !== authority.binding.catalogRevision ||
    catalog.catalogChecksum !== authority.binding.catalogChecksum ||
    catalog.operationCount !== authority.binding.operationCount
  )
    fail(
      'UGV_B02_RUNTIME_CATALOG_IDENTITY_DRIFT',
      'Runtime Catalog identity differs from the current Binding authority.',
    );
}

function classifyReadiness(
  readiness: z.infer<typeof ReadinessSchema>,
  observedAt: string,
): 'ready' | 'pending' {
  const exactIdentity =
    readiness.capabilityId !== EXPECTED_CAPABILITY_ID ||
    readiness.capabilityVersion !== 2 ||
    Date.parse(readiness.evaluatedAt) > Date.parse(observedAt) ||
    Date.parse(readiness.validUntil) <= Date.parse(readiness.evaluatedAt);
  if (exactIdentity)
    fail(
      'UGV_B02_READINESS_IDENTITY_DRIFT',
      'Capability readiness identity or timestamps differ from the frozen authority.',
    );
  const exactAvailable =
    readiness.status === 'available' &&
    readiness.availableImplementations.length === 1 &&
    readiness.availableImplementations[0] === EXPECTED_IMPLEMENTATION_ID &&
    readiness.unavailableImplementations.length === 0 &&
    readiness.reasons.every(({ severity }) => severity !== 'blocking');
  if (exactAvailable) return 'ready';
  const exactUnavailable =
    readiness.status === 'unavailable' &&
    readiness.availableImplementations.length === 0 &&
    readiness.unavailableImplementations.length === 1 &&
    readiness.unavailableImplementations[0] === EXPECTED_IMPLEMENTATION_ID &&
    readiness.reasons.some(({ severity }) => severity === 'blocking');
  const exactStabilityWindow =
    ['degraded', 'unavailable'].includes(readiness.status) &&
    readiness.availableImplementations.length === 1 &&
    readiness.availableImplementations[0] === EXPECTED_IMPLEMENTATION_ID &&
    readiness.unavailableImplementations.length === 0 &&
    readiness.reasons.some(({ code }) => code === 'READINESS_STABILITY_WINDOW') &&
    readiness.reasons.every(({ severity }) => severity !== 'blocking');
  if (exactUnavailable || exactStabilityWindow) return 'pending';
  fail(
    'UGV_B02_READINESS_IDENTITY_DRIFT',
    'Capability readiness partition or reason semantics are not safely reconcilable.',
  );
}

function remaining(
  validUntil: string | undefined,
  observedAt: string,
  budgetMs: number,
  code: string,
): number {
  const value =
    validUntil === undefined ? Number.NaN : Date.parse(validUntil) - Date.parse(observedAt);
  if (!Number.isFinite(value) || value < budgetMs)
    fail(code, 'Authority remaining TTL is below the frozen B02 admission budget.');
  return value;
}

async function getJson(
  url: string,
  bearerToken: string | undefined,
  request: typeof fetch,
): Promise<AuthorityJsonResponse> {
  let response: Response;
  try {
    response = await request(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(bearerToken === undefined ? {} : { authorization: `Bearer ${bearerToken}` }),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new UgvB02AuthorityGateError(
      'UGV_B02_AUTHORITY_HTTP_FAILED',
      'A formal read-only authority GET failed.',
      { cause: error },
    );
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (
    response.status !== 200 ||
    response.redirected ||
    (Number.isFinite(contentLength) && contentLength > MAX_AUTHORITY_RESPONSE_BYTES) ||
    !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')
  )
    fail('UGV_B02_AUTHORITY_HTTP_FAILED', 'A formal read-only authority GET was rejected.');
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_AUTHORITY_RESPONSE_BYTES)
    fail('UGV_B02_AUTHORITY_HTTP_FAILED', 'A formal authority response exceeded its bound.');
  try {
    const etag = response.headers.get('etag');
    return Object.freeze({
      value: JSON.parse(body) as unknown,
      ...(etag === null ? {} : { etag: etag.trim() }),
    });
  } catch {
    fail('UGV_B02_AUTHORITY_HTTP_FAILED', 'A formal authority response was not JSON.');
  }
}

interface AuthorityJsonResponse {
  readonly value: unknown;
  readonly etag?: string;
}

function assertExactEtag(
  actual: string | undefined,
  expected: string,
  code: string,
  message: string,
): void {
  if (actual === undefined || actual.length > 512 || actual.startsWith('W/') || actual !== expected)
    fail(code, message);
}

function assertReadinessEtag(
  readiness: z.infer<typeof ReadinessSchema>,
  etag: string | undefined,
): void {
  const declaredHash = etag === undefined ? undefined : STRONG_SNAPSHOT_ETAG.exec(etag)?.[1];
  const bodyHash = `sha256:${createHash('sha256').update(JSON.stringify(readiness)).digest('hex')}`;
  if (declaredHash === undefined || declaredHash !== bodyHash)
    fail(
      'UGV_B02_READINESS_ETAG_MISMATCH',
      'Readiness body and its formal strong snapshot ETag differ.',
    );
}

function validateConfiguration(
  input: UgvB02AuthorityGateConfiguration,
): UgvB02AuthorityGateConfiguration {
  if (
    input.nodeControlBaseUrl !== EXPECTED_NODE_CONTROL_BASE_URL ||
    input.runtimeManagementBaseUrl !== EXPECTED_RUNTIME_MANAGEMENT_BASE_URL
  )
    fail('UGV_B02_AUTHORITY_GATE_CONFIGURATION_INVALID', 'Authority origins are not exact.');
  for (const token of [input.nodeControlBearerToken, input.runtimeControlBearerToken])
    if (token.trim().length < 16 || token.length > 4_096)
      fail('UGV_B02_AUTHORITY_GATE_CONFIGURATION_INVALID', 'Bounded service tokens are required.');
  return Object.freeze({ ...input });
}

function timestamp(value: string, code: string): string {
  if (!Number.isFinite(Date.parse(value))) fail(code, 'Authority clock is invalid.');
  return value;
}

function fail(code: string, message: string): never {
  throw new UgvB02AuthorityGateError(code, message);
}

export class UgvB02AuthorityGateError extends Error {
  readonly retryableReadiness: boolean;

  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions & Readonly<{ retryableReadiness?: boolean }>,
  ) {
    super(message, options);
    this.name = 'UgvB02AuthorityGateError';
    this.retryableReadiness = options?.retryableReadiness ?? false;
  }
}
