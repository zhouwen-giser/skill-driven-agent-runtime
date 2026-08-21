import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  deriveFrozenMcpCatalogAuthority,
  type McpTaskExecutionProfile,
  type McpTool,
} from '../../../packages/domain/src/index.js';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const REGISTRY_PROJECTION_CONTRACT = 'sdar-registry-v1' as const;
const TASK_BEHAVIORS = ['synchronous_only', 'server_directed', 'task_required'] as const;
const BINDING_RECONCILIATION_POLICIES = ['reuse_current', 'refresh_once_per_run'] as const;
const EXECUTION_SEMANTICS_SOURCES = ['mcp_declared', 'admin_override', 'default_unknown'] as const;

export interface SmppExecutionSemanticsValues {
  readonly effect: 'read_only' | 'side_effecting';
  readonly execution: 'synchronous' | 'task_capable' | 'task_required';
  readonly cancellation: 'unsupported' | 'cooperative' | 'task_cancel';
  readonly idempotency: 'none' | 'client_request_key' | 'server_managed';
  readonly replay: 'allowed' | 'simulation_only' | 'forbidden';
}

export interface SmppExpectedTool {
  readonly taskBehavior: SmppTaskBehavior;
  readonly executionSemantics: SmppExecutionSemanticsValues;
}

export type SmppTaskBehavior = (typeof TASK_BEHAVIORS)[number];

export interface SmppProviderConfiguration {
  /** Stable local key used only for bounded idempotency keys and redacted reporting. */
  readonly providerKey: string;
  readonly name: string;
  readonly externalProviderId: string;
  readonly externalServerId: string;
  readonly bindingId: string;
  readonly localServerId: string;
  readonly credentialRef: string;
  readonly credential: Readonly<{ mode: 'bearer'; token: string }> | Readonly<{ mode: 'none' }>;
  /** Defaults to reuse_current. refresh_once_per_run relies on the bounded run idempotency key. */
  readonly bindingReconciliationPolicy?: (typeof BINDING_RECONCILIATION_POLICIES)[number];
  /** Explicit governed contract. Tool names are never interpreted to infer effects. */
  readonly tools: Readonly<Record<string, SmppExpectedTool>>;
}

export interface SmppProviderMaterializationConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly runtimeManagementBaseUrl: string;
  readonly smppSourceId: string;
  readonly runId: string;
  readonly providers: readonly SmppProviderConfiguration[];
}

export interface SmppProviderMaterializationReport {
  readonly schemaVersion: 'sdar.smpp-provider-materialization/v1';
  readonly status: 'passed';
  readonly observedAt: string;
  readonly smppSourceId: string;
  readonly providers: readonly Readonly<{
    providerKey: string;
    bindingId: string;
    action: 'created' | 'reconciled';
    runtimeAction: 'registered' | 'refreshed' | 'reused';
    externalProviderId: string;
    externalServerId: string;
    registryRevision: number;
    registryChecksum: string;
    nativeRegistryRevision: number;
    nativeRegistryChecksum: string;
    registryProjectionContract: typeof REGISTRY_PROJECTION_CONTRACT;
    registryCatalogRevision: string;
    bindingRevision: number;
    catalogRevision: string;
    catalogChecksum: string;
    endpointSha256: string;
    catalogObservedAt: string;
    availabilityValidUntil: string;
    runtimeToolRevision: number;
    runtimeDiscoveredAt: string;
    runtimeValidUntil: string;
    credentialRotation: 'not_performed' | 'not_applicable';
    tools: readonly Readonly<{
      toolName: string;
      taskBehavior: SmppTaskBehavior;
      effect: SmppExecutionSemanticsValues['effect'];
      executionSemanticsSource: 'mcp_declared' | 'admin_override';
      inputSchemaSha256: string;
      outputSchemaSha256: string;
    }>[];
  }>[];
  readonly redaction: Readonly<{
    secretsIncluded: false;
    endpointsIncluded: false;
    entityIdsIncluded: false;
  }>;
}

export class SmppProviderMaterializationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SmppProviderMaterializationError';
    this.code = code;
  }
}

const CandidateSchema = z
  .object({
    smppSourceId: z.string().min(1),
    externalProviderId: z.string().min(1),
    externalServerId: z.string().min(1),
    compositeIdentity: z.string().min(1),
    serverEndpoint: z.string().min(1),
    catalogRevision: z.string().min(1),
    labels: z
      .object({
        environment: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/u),
        protocolMode: z.literal('frozen_v1'),
      })
      .strict(),
    registryRevision: z.number().int().positive(),
    registryChecksum: z.string().regex(CHECKSUM),
    registryEtag: z.string().min(1),
    registryValidUntil: z.iso.datetime(),
    nativeRegistryRevision: z.number().int().positive(),
    nativeRegistryChecksum: z.string().regex(CHECKSUM),
    registryProjectionContract: z.literal(REGISTRY_PROJECTION_CONTRACT),
  })
  .strict();

const BindingSchema = z
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
    availabilityValidUntil: z.iso.datetime(),
    catalogObservedAt: z.iso.datetime(),
    operationCount: z.number().int().nonnegative(),
  })
  .strict();

const ProviderCatalogSchema = z
  .object({
    providerId: z.string().min(1),
    providerType: z.string().min(1),
    providerVersion: z.string().min(1),
    manifestHash: z.string().regex(CHECKSUM),
  })
  .strict();

const DiscoverySchema = z
  .object({
    protocolVersion: z.string().min(1),
    serverInfo: z.record(z.string(), z.unknown()),
    providerCatalog: ProviderCatalogSchema.optional(),
    discoveredAt: z.iso.datetime(),
    validUntil: z.iso.datetime(),
    toolRevision: z.number().int().positive(),
  })
  .loose();

const RuntimeServerSchema = z
  .object({
    serverId: z.string().min(1),
    name: z.string().min(1),
    endpoint: z.string().min(1),
    protocolMode: z.literal('frozen_v1'),
    toolRevision: z.number().int().positive(),
    currentDiscovery: DiscoverySchema.optional(),
  })
  .loose();

const JsonSchema = z.union([z.boolean(), z.record(z.string(), z.unknown())]);
const RuntimeExecutionSemanticsSchema = z
  .object({
    effect: z.enum(['read_only', 'side_effecting', 'unknown']),
    execution: z.enum(['synchronous', 'task_capable', 'task_required', 'unknown']),
    cancellation: z.enum(['unsupported', 'cooperative', 'task_cancel', 'unknown']),
    idempotency: z.enum(['none', 'client_request_key', 'server_managed', 'unknown']),
    replay: z.enum(['allowed', 'simulation_only', 'forbidden', 'unknown']),
    source: z.enum(EXECUTION_SEMANTICS_SOURCES),
  })
  .strict();
const RuntimeTaskExecutionProfileSchema = z
  .object({
    profileVersion: z.literal('1.0'),
    taskBehavior: z.enum(TASK_BEHAVIORS),
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
const RuntimeToolSchema = z
  .object({
    serverId: z.string().min(1),
    toolName: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: JsonSchema,
    outputSchema: JsonSchema.optional(),
    protocolMode: z.literal('frozen_v1'),
    executionSemantics: RuntimeExecutionSemanticsSchema,
    taskExecutionProfile: RuntimeTaskExecutionProfileSchema,
  })
  .loose();

const RuntimeRefreshSchema = z
  .object({
    server: RuntimeServerSchema,
    snapshot: DiscoverySchema,
    tools: z.array(RuntimeToolSchema),
  })
  .loose();

const OperationSchema = z
  .object({
    status: z.enum(['accepted', 'running', 'succeeded', 'failed', 'canceled']),
    errorCode: z.string().optional(),
  })
  .loose();

type Candidate = z.infer<typeof CandidateSchema>;
type Binding = z.infer<typeof BindingSchema>;
type RuntimeRefresh = z.infer<typeof RuntimeRefreshSchema>;
type NativeRegistryLineage = Readonly<{
  nativeRegistryRevision: number;
  nativeRegistryChecksum: string;
  registryProjectionContract: typeof REGISTRY_PROJECTION_CONTRACT;
}>;

export async function materializeSmppProviders(
  input: SmppProviderMaterializationConfiguration,
  dependencies: Readonly<{
    fetch?: typeof fetch;
    now?: () => string;
  }> = {},
): Promise<SmppProviderMaterializationReport> {
  const configuration = validateConfiguration(input);
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const observedAt = validTimestamp(now(), 'DRIVER_CLOCK_INVALID');
  const candidates = await controlGetCandidates(configuration, request);
  assertExactCandidateDirectoryNativeLineage(candidates, configuration.smppSourceId);
  const sourceSelections = configuration.providers.map((provider) => {
    const matches = candidates.filter(
      (candidate) =>
        candidate.smppSourceId === configuration.smppSourceId &&
        candidate.externalProviderId === provider.externalProviderId &&
        candidate.externalServerId === provider.externalServerId,
    );
    if (matches.length !== 1)
      fail(
        'SOURCE_CANDIDATE_NOT_EXACT',
        `Expected one exact Source Candidate for ${provider.providerKey}; observed ${String(matches.length)}.`,
      );
    const candidate = matches[0];
    if (candidate === undefined)
      fail(
        'SOURCE_CANDIDATE_NOT_EXACT',
        `The ${provider.providerKey} Source Candidate is missing.`,
      );
    const endpoint = safeEndpoint(candidate.serverEndpoint, 'SOURCE_CANDIDATE_ENDPOINT_INVALID');
    requireFresh(candidate.registryValidUntil, observedAt, 'SOURCE_CANDIDATE_EXPIRED');
    return Object.freeze({ provider, candidate, endpoint });
  });

  const runtimeServers = await runtimeListServers(configuration, request);
  const plans = await Promise.all(
    sourceSelections.map(async ({ provider, candidate, endpoint }) => {
      const currentBinding = await controlGetBinding(configuration, provider.bindingId, request);
      if (currentBinding !== undefined)
        assertSameLineage(currentBinding, candidate, provider.localServerId, endpoint);
      const runtimeMatches = runtimeServers.filter(
        (server) => server.serverId === provider.localServerId,
      );
      if (runtimeMatches.length > 1)
        fail(
          'RUNTIME_SERVER_NOT_EXACT',
          `Expected at most one Runtime Server for ${provider.providerKey}.`,
        );
      const existingRuntime = runtimeMatches[0];
      if (
        existingRuntime !== undefined &&
        safeEndpoint(existingRuntime.endpoint, 'RUNTIME_ENDPOINT_INVALID') !== endpoint
      )
        fail(
          'RUNTIME_ENDPOINT_DRIFT_REQUIRES_GOVERNED_REBIND',
          `Runtime endpoint drift was detected for ${provider.providerKey}.`,
        );
      return Object.freeze({ provider, candidate, endpoint, currentBinding, existingRuntime });
    }),
  );
  const reports: SmppProviderMaterializationReport['providers'][number][] = [];

  for (const { provider, candidate, endpoint, currentBinding, existingRuntime } of plans) {
    const action = currentBinding === undefined ? 'created' : 'reconciled';
    let runtimeAction: SmppProviderMaterializationReport['providers'][number]['runtimeAction'];
    let runtime: RuntimeRefresh;
    if (existingRuntime === undefined) {
      runtimeAction = 'registered';
      runtime = await runtimeCommand(
        configuration,
        '/api/v1/mcp/servers',
        {
          serverId: provider.localServerId,
          name: provider.name,
          endpoint,
          credentialHeaders:
            provider.credential.mode === 'bearer'
              ? { authorization: `Bearer ${provider.credential.token}` }
              : {},
        },
        201,
        request,
      );
    } else {
      runtimeAction = 'reused';
      runtime = await runtimeReadCurrent(configuration, existingRuntime, request);
    }
    if (safeEndpoint(runtime.server.endpoint, 'RUNTIME_ENDPOINT_INVALID') !== endpoint)
      fail(
        'RUNTIME_ENDPOINT_DRIFT_REQUIRES_GOVERNED_REBIND',
        `Runtime endpoint drift was detected for ${provider.providerKey}.`,
      );
    runtime = await reconcileRuntimeToolExecutionSemantics(
      configuration,
      provider.providerKey,
      provider.localServerId,
      provider.tools,
      runtime,
      request,
    );
    if (currentBinding !== undefined) {
      const revisionDelta = runtime.server.toolRevision - currentBinding.revision;
      if (revisionDelta === -1) {
        runtimeAction = 'refreshed';
        runtime = await runtimeCommand(
          configuration,
          `/api/v1/mcp/servers/${encodeURIComponent(provider.localServerId)}/refresh`,
          undefined,
          200,
          request,
        );
      } else if (revisionDelta !== 0 && revisionDelta !== 1) {
        fail(
          'CATALOG_AUTHORITY_REVISION_GAP',
          `Binding revision ${String(currentBinding.revision)} cannot be reconciled with Runtime Tool revision ${String(runtime.server.toolRevision)} by one bounded refresh.`,
        );
      }
      if (runtime.snapshot.toolRevision !== runtime.server.toolRevision)
        fail(
          'CATALOG_AUTHORITY_REVISION_MISMATCH',
          'Runtime Server and current Snapshot Tool revisions do not match.',
        );
    }
    const governedCatalogChecksum = runtimeCatalogChecksum(runtime);

    // A Binding snapshots the already-materialized Runtime authority. Explicit governed semantics
    // are applied before this command so the checksum cannot authorize default_unknown effects.
    if (currentBinding === undefined) {
      await controlCommand(
        configuration,
        '/api/v1/mcp-provider-bindings',
        `${configuration.runId}-${provider.providerKey}-import`,
        {
          reason: `Materialize the exact ${provider.providerKey} SMPP Source Candidate.`,
          payload: {
            bindingId: provider.bindingId,
            localServerId: provider.localServerId,
            originType: 'smpp_registry',
            credentialRef: provider.credentialRef,
            smppSourceId: candidate.smppSourceId,
            externalProviderId: candidate.externalProviderId,
            externalServerId: candidate.externalServerId,
            registryRevision: candidate.registryRevision,
            registryChecksum: candidate.registryChecksum,
          },
        },
        request,
      );
    } else {
      assertSameLineage(currentBinding, candidate, provider.localServerId, endpoint);
      const approveCatalogDrift =
        currentBinding.status === 'degraded' ||
        currentBinding.catalogChecksum !== governedCatalogChecksum;
      const bindingAlreadyCurrent =
        provider.bindingReconciliationPolicy !== 'refresh_once_per_run' &&
        !approveCatalogDrift &&
        currentBinding.status === 'active' &&
        currentBinding.availabilityStatus === 'available' &&
        Date.parse(currentBinding.availabilityValidUntil) > Date.parse(observedAt) &&
        currentBinding.revision === runtime.server.toolRevision;
      if (!bindingAlreadyCurrent)
        await controlCommand(
          configuration,
          `/api/v1/mcp-provider-bindings/${encodeURIComponent(provider.bindingId)}/refresh`,
          `${configuration.runId}-${provider.providerKey}-${approveCatalogDrift ? 'approve-catalog' : 'refresh'}`,
          approveCatalogDrift
            ? {
                reason: `Approve the exact governed ${provider.providerKey} Catalog checksum.`,
                expectedRevision: currentBinding.revision,
                payload: {
                  approval: 'catalog_checksum',
                  catalogChecksum: governedCatalogChecksum,
                },
              }
            : { reason: `Refresh the exact ${provider.providerKey} Binding authority.` },
          request,
        );
    }

    const binding = await controlGetBinding(configuration, provider.bindingId, request);
    if (binding === undefined)
      fail('BINDING_MISSING_AFTER_COMMAND', 'Binding command did not persist.');
    assertSameLineage(binding, candidate, provider.localServerId, endpoint);

    if (runtime.server.toolRevision === binding.revision - 1) {
      if (existingRuntime !== undefined) runtimeAction = 'refreshed';
      runtime = await runtimeCommand(
        configuration,
        `/api/v1/mcp/servers/${encodeURIComponent(provider.localServerId)}/refresh`,
        undefined,
        200,
        request,
      );
    } else if (runtime.server.toolRevision !== binding.revision) {
      fail(
        'CATALOG_AUTHORITY_REVISION_GAP',
        `Binding revision ${String(binding.revision)} cannot be reconciled with Runtime Tool revision ${String(runtime.server.toolRevision)} by one bounded refresh.`,
      );
    }

    if (
      runtime.server.toolRevision !== binding.revision ||
      runtime.snapshot.toolRevision !== binding.revision
    )
      fail(
        'CATALOG_AUTHORITY_REVISION_MISMATCH',
        'Binding revision and Runtime Server/Snapshot Tool revisions did not converge exactly.',
      );
    if (binding.status !== 'active' || binding.availabilityStatus !== 'available')
      fail(
        'BINDING_NOT_SELECTABLE',
        `The ${provider.providerKey} Binding is not active and available.`,
      );
    requireFresh(binding.availabilityValidUntil, observedAt, 'BINDING_OBSERVATION_EXPIRED');
    if (binding.operationCount !== runtime.tools.length)
      fail('CATALOG_OPERATION_COUNT_MISMATCH', 'Control and Runtime operation counts differ.');

    validateRuntimeCatalog(provider.providerKey, provider.localServerId, provider.tools, runtime);
    requireFresh(runtime.snapshot.validUntil, observedAt, 'RUNTIME_DISCOVERY_EXPIRED');
    const catalogChecksum = runtimeCatalogChecksum(runtime);
    if (catalogChecksum !== binding.catalogChecksum)
      fail('CATALOG_CHECKSUM_MISMATCH', 'Control and Runtime Catalog checksums differ.');
    const serverVersion = runtime.snapshot.serverInfo['version'];
    if (
      typeof serverVersion !== 'string' ||
      binding.catalogRevision !== `${serverVersion}:${String(runtime.server.toolRevision)}`
    )
      fail('CATALOG_REVISION_MISMATCH', 'Binding Catalog revision does not match discovery.');

    reports.push(
      Object.freeze({
        providerKey: provider.providerKey,
        bindingId: provider.bindingId,
        action,
        runtimeAction,
        externalProviderId: candidate.externalProviderId,
        externalServerId: candidate.externalServerId,
        registryRevision: candidate.registryRevision,
        registryChecksum: candidate.registryChecksum,
        nativeRegistryRevision: candidate.nativeRegistryRevision,
        nativeRegistryChecksum: candidate.nativeRegistryChecksum,
        registryProjectionContract: candidate.registryProjectionContract,
        registryCatalogRevision: candidate.catalogRevision,
        bindingRevision: binding.revision,
        catalogRevision: binding.catalogRevision,
        catalogChecksum: binding.catalogChecksum,
        endpointSha256: sha256(endpoint),
        catalogObservedAt: binding.catalogObservedAt,
        availabilityValidUntil: binding.availabilityValidUntil,
        runtimeToolRevision: runtime.server.toolRevision,
        runtimeDiscoveredAt: runtime.snapshot.discoveredAt,
        runtimeValidUntil: runtime.snapshot.validUntil,
        credentialRotation:
          provider.credential.mode === 'none' ? 'not_applicable' : 'not_performed',
        tools: Object.freeze(
          [...runtime.tools]
            .sort((left, right) => compare(left.toolName, right.toolName))
            .map((tool) =>
              Object.freeze({
                toolName: tool.toolName,
                taskBehavior: tool.taskExecutionProfile.taskBehavior,
                effect: tool.executionSemantics.effect as SmppExecutionSemanticsValues['effect'],
                executionSemanticsSource: tool.executionSemantics.source as
                  'mcp_declared' | 'admin_override',
                inputSchemaSha256: sha256(stableStringify(tool.inputSchema)),
                outputSchemaSha256: sha256(stableStringify(tool.outputSchema)),
              }),
            ),
        ),
      }),
    );
  }

  return Object.freeze({
    schemaVersion: 'sdar.smpp-provider-materialization/v1',
    status: 'passed',
    observedAt,
    smppSourceId: configuration.smppSourceId,
    providers: Object.freeze(reports),
    redaction: Object.freeze({
      secretsIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    }),
  });
}

function validateConfiguration(
  input: SmppProviderMaterializationConfiguration,
): SmppProviderMaterializationConfiguration {
  const nodeControlBaseUrl = safeManagementBaseUrl(input.nodeControlBaseUrl);
  const runtimeManagementBaseUrl = safeManagementBaseUrl(input.runtimeManagementBaseUrl);
  if (input.nodeControlBearerToken.trim() === '')
    fail('DRIVER_CONFIGURATION_INVALID', 'Node Control bearer token is required.');
  if (input.runId.trim().length < 8)
    fail('DRIVER_CONFIGURATION_INVALID', 'A bounded unique runId is required.');
  if (input.smppSourceId.trim() === '')
    fail('DRIVER_CONFIGURATION_INVALID', 'SMPP Source ID is required.');
  if (input.providers.length === 0)
    fail('DRIVER_CONFIGURATION_INVALID', 'At least one SMPP provider is required.');
  const uniqueFields = [
    ['providerKey', input.providers.map(({ providerKey }) => providerKey)],
    ['bindingId', input.providers.map(({ bindingId }) => bindingId)],
    ['localServerId', input.providers.map(({ localServerId }) => localServerId)],
    [
      'Source tuple',
      input.providers.map(
        ({ externalProviderId, externalServerId }) =>
          `${input.smppSourceId}\u0000${externalProviderId}\u0000${externalServerId}`,
      ),
    ],
  ] as const;
  for (const [field, values] of uniqueFields)
    if (new Set(values).size !== values.length)
      fail('DRIVER_CONFIGURATION_INVALID', `Every provider ${field} must be unique.`);
  for (const provider of input.providers) {
    for (const value of [
      provider.providerKey,
      provider.name,
      provider.externalProviderId,
      provider.externalServerId,
      provider.bindingId,
      provider.localServerId,
      provider.credentialRef,
    ])
      if (value.trim() === '') fail('DRIVER_CONFIGURATION_INVALID', 'Provider IDs are required.');
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(provider.providerKey))
      fail('DRIVER_CONFIGURATION_INVALID', 'Provider keys must be bounded safe identifiers.');
    const toolEntries = Object.entries(provider.tools);
    if (toolEntries.length === 0)
      fail('DRIVER_CONFIGURATION_INVALID', 'Every provider requires an explicit Tool contract.');
    for (const [toolName, contract] of toolEntries) {
      if (toolName.trim() === '')
        fail('DRIVER_CONFIGURATION_INVALID', 'Tool contract names cannot be empty.');
      if (!TASK_BEHAVIORS.includes(contract.taskBehavior))
        fail('DRIVER_CONFIGURATION_INVALID', 'Tool task behavior is invalid.');
      if (
        !['read_only', 'side_effecting'].includes(contract.executionSemantics.effect) ||
        !['synchronous', 'task_capable', 'task_required'].includes(
          contract.executionSemantics.execution,
        ) ||
        !['unsupported', 'cooperative', 'task_cancel'].includes(
          contract.executionSemantics.cancellation,
        ) ||
        !['none', 'client_request_key', 'server_managed'].includes(
          contract.executionSemantics.idempotency,
        ) ||
        !['allowed', 'simulation_only', 'forbidden'].includes(contract.executionSemantics.replay)
      )
        fail(
          'DRIVER_CONFIGURATION_INVALID',
          'Tool execution semantics must be explicit; unknown values fail closed.',
        );
    }
    if (provider.credential.mode === 'bearer' && provider.credential.token.trim() === '')
      fail('DRIVER_CONFIGURATION_INVALID', 'Provider bearer token is empty.');
    if (
      provider.bindingReconciliationPolicy !== undefined &&
      !BINDING_RECONCILIATION_POLICIES.includes(provider.bindingReconciliationPolicy)
    )
      fail('DRIVER_CONFIGURATION_INVALID', 'Binding reconciliation policy is invalid.');
  }
  return Object.freeze({ ...input, nodeControlBaseUrl, runtimeManagementBaseUrl });
}

async function controlGetCandidates(
  configuration: SmppProviderMaterializationConfiguration,
  request: typeof fetch,
): Promise<readonly Candidate[]> {
  const value = await requestJson(
    `${configuration.nodeControlBaseUrl}/api/v1/mcp-provider-candidates?smppSourceId=${encodeURIComponent(configuration.smppSourceId)}`,
    {
      headers: { authorization: `Bearer ${configuration.nodeControlBearerToken}` },
      redirect: 'manual',
    },
    200,
    request,
  );
  return z
    .object({ items: z.array(CandidateSchema) })
    .loose()
    .parse(value).items;
}

async function controlGetBinding(
  configuration: SmppProviderMaterializationConfiguration,
  bindingId: string,
  request: typeof fetch,
): Promise<Binding | undefined> {
  const response = await request(
    `${configuration.nodeControlBaseUrl}/api/v1/mcp-provider-bindings/${encodeURIComponent(bindingId)}`,
    {
      headers: { authorization: `Bearer ${configuration.nodeControlBearerToken}` },
      redirect: 'manual',
    },
  );
  if (response.status === 404) return undefined;
  return BindingSchema.parse(await responseJson(response, 200));
}

async function controlCommand(
  configuration: SmppProviderMaterializationConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  request: typeof fetch,
): Promise<void> {
  const value = await requestJson(
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
  const operation = OperationSchema.parse(value);
  if (operation.status !== 'succeeded')
    fail(
      operation.errorCode ?? 'NODE_CONTROL_COMMAND_FAILED',
      'Node Control rejected the Catalog materialization command.',
    );
}

async function runtimeListServers(
  configuration: SmppProviderMaterializationConfiguration,
  request: typeof fetch,
) {
  const value = await requestJson(
    `${configuration.runtimeManagementBaseUrl}/api/v1/mcp/servers`,
    { redirect: 'manual' },
    200,
    request,
  );
  return z
    .object({ items: z.array(RuntimeServerSchema) })
    .loose()
    .parse(value).items;
}

async function runtimeCommand(
  configuration: SmppProviderMaterializationConfiguration,
  path: string,
  body: unknown,
  expectedStatus: number,
  request: typeof fetch,
): Promise<RuntimeRefresh> {
  const value = await requestJson(
    `${configuration.runtimeManagementBaseUrl}${path}`,
    {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      redirect: 'manual',
    },
    expectedStatus,
    request,
  );
  return RuntimeRefreshSchema.parse(value);
}

async function runtimeReadCurrent(
  configuration: SmppProviderMaterializationConfiguration,
  server: z.infer<typeof RuntimeServerSchema>,
  request: typeof fetch,
): Promise<RuntimeRefresh> {
  if (server.currentDiscovery === undefined)
    fail('RUNTIME_DISCOVERY_MISSING', 'The current Runtime discovery snapshot is unavailable.');
  const value = await requestJson(
    `${configuration.runtimeManagementBaseUrl}/api/v1/mcp/servers/${encodeURIComponent(server.serverId)}/tools`,
    { redirect: 'manual' },
    200,
    request,
  );
  const tools = z
    .object({ items: z.array(RuntimeToolSchema) })
    .loose()
    .parse(value).items;
  return RuntimeRefreshSchema.parse({ server, snapshot: server.currentDiscovery, tools });
}

async function reconcileRuntimeToolExecutionSemantics(
  configuration: SmppProviderMaterializationConfiguration,
  providerKey: string,
  serverId: string,
  expected: Readonly<Record<string, SmppExpectedTool>>,
  runtime: RuntimeRefresh,
  request: typeof fetch,
): Promise<RuntimeRefresh> {
  validateRuntimeCatalogStructure(providerKey, serverId, expected, runtime);
  const updates = runtime.tools.filter((tool) => {
    const contract = expected[tool.toolName];
    return contract === undefined || !trustedSemanticsEqual(tool.executionSemantics, contract);
  });
  for (const tool of updates) {
    const contract = expected[tool.toolName];
    if (contract === undefined)
      fail('CATALOG_TOOL_SET_MISMATCH', `Runtime Tool set mismatch for ${providerKey}.`);
    const response = await request(
      `${configuration.runtimeManagementBaseUrl}/api/v1/mcp/servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(tool.toolName)}/execution-semantics`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(contract.executionSemantics),
        redirect: 'manual',
      },
    );
    if (response.status !== 204)
      fail(
        'RUNTIME_TOOL_SEMANTICS_OVERRIDE_REJECTED',
        `Runtime rejected the governed Tool semantics override for ${tool.toolName}.`,
      );
  }
  if (updates.length === 0) return runtime;
  return runtimeReadCurrent(
    configuration,
    RuntimeServerSchema.parse({ ...runtime.server, currentDiscovery: runtime.snapshot }),
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
    let code = 'HTTP_REQUEST_REJECTED';
    try {
      const problem = z
        .object({ code: z.string().regex(/^[A-Z0-9_]+$/u) })
        .loose()
        .parse(await response.json());
      code = problem.code;
    } catch {
      // Response bodies can contain endpoint or Provider details; do not echo them.
    }
    fail(code, `HTTP request was rejected with status ${String(response.status)}.`);
  }
  try {
    return await response.json();
  } catch {
    return fail('HTTP_RESPONSE_INVALID', 'HTTP response was not JSON.');
  }
}

function assertSameLineage(
  binding: Binding,
  candidate: Candidate,
  localServerId: string,
  endpoint: string,
): void {
  if (
    binding.bindingId === '' ||
    binding.localServerId !== localServerId ||
    binding.smppSourceId !== candidate.smppSourceId ||
    binding.externalProviderId !== candidate.externalProviderId ||
    binding.externalServerId !== candidate.externalServerId ||
    binding.registryRevision !== candidate.registryRevision ||
    binding.registryChecksum !== candidate.registryChecksum ||
    safeEndpoint(binding.endpointRef, 'BINDING_ENDPOINT_INVALID') !== endpoint
  )
    fail(
      'BINDING_LINEAGE_DRIFT_REQUIRES_CAS_REBIND',
      'Existing Binding lineage differs from the exact current Source Candidate.',
    );
}

function assertExactNativeLineage(
  candidate: Candidate,
  expected: NativeRegistryLineage | undefined,
): NativeRegistryLineage {
  const observed = Object.freeze({
    nativeRegistryRevision: candidate.nativeRegistryRevision,
    nativeRegistryChecksum: candidate.nativeRegistryChecksum,
    registryProjectionContract: candidate.registryProjectionContract,
  });
  if (
    expected !== undefined &&
    (observed.nativeRegistryRevision !== expected.nativeRegistryRevision ||
      observed.nativeRegistryChecksum !== expected.nativeRegistryChecksum)
  )
    fail(
      'SOURCE_CANDIDATE_NATIVE_LINEAGE_MISMATCH',
      'Source Candidates do not share one exact native Registry lineage.',
    );
  return observed;
}

function assertExactCandidateDirectoryNativeLineage(
  candidates: readonly Candidate[],
  smppSourceId: string,
): void {
  let expected: NativeRegistryLineage | undefined;
  for (const candidate of candidates)
    if (candidate.smppSourceId === smppSourceId)
      expected = assertExactNativeLineage(candidate, expected);
}

function validateRuntimeCatalog(
  providerKey: string,
  serverId: string,
  expected: Readonly<Record<string, SmppExpectedTool>>,
  runtime: RuntimeRefresh,
): void {
  validateRuntimeCatalogStructure(providerKey, serverId, expected, runtime);
  const actual = new Map(runtime.tools.map((tool) => [tool.toolName, tool] as const));
  for (const [toolName, contract] of Object.entries(expected)) {
    const tool = actual.get(toolName);
    if (tool === undefined || !trustedSemanticsEqual(tool.executionSemantics, contract))
      fail(
        'CATALOG_TOOL_EXECUTION_SEMANTICS_MISMATCH',
        `Runtime Tool execution semantics mismatch for ${toolName}.`,
      );
  }
}

function validateRuntimeCatalogStructure(
  providerKey: string,
  serverId: string,
  expected: Readonly<Record<string, SmppExpectedTool>>,
  runtime: RuntimeRefresh,
): void {
  if (runtime.server.serverId !== serverId)
    fail('RUNTIME_SERVER_IDENTITY_MISMATCH', `Runtime identity mismatch for ${providerKey}.`);
  const actual = new Map(runtime.tools.map((tool) => [tool.toolName, tool] as const));
  if (
    actual.size !== Object.keys(expected).length ||
    Object.keys(expected).some((toolName) => !actual.has(toolName))
  )
    fail('CATALOG_TOOL_SET_MISMATCH', `Runtime Tool set mismatch for ${providerKey}.`);
  for (const [toolName, contract] of Object.entries(expected)) {
    const tool = actual.get(toolName);
    if (
      tool?.outputSchema === undefined ||
      tool.taskExecutionProfile.taskBehavior !== contract.taskBehavior
    )
      fail('CATALOG_TOOL_CONTRACT_MISMATCH', `Runtime Tool contract mismatch for ${toolName}.`);
  }
}

function trustedSemanticsEqual(
  actual: z.infer<typeof RuntimeExecutionSemanticsSchema>,
  expected: SmppExpectedTool,
): boolean {
  return (
    (actual.source === 'mcp_declared' || actual.source === 'admin_override') &&
    actual.effect === expected.executionSemantics.effect &&
    actual.execution === expected.executionSemantics.execution &&
    actual.cancellation === expected.executionSemantics.cancellation &&
    actual.idempotency === expected.executionSemantics.idempotency &&
    actual.replay === expected.executionSemantics.replay
  );
}

function runtimeCatalogChecksum(runtime: RuntimeRefresh): string {
  const snapshot = Object.freeze({
    protocolVersion: runtime.snapshot.protocolVersion,
    serverInfo: runtime.snapshot.serverInfo,
    ...(runtime.snapshot.providerCatalog === undefined
      ? {}
      : { providerCatalog: runtime.snapshot.providerCatalog }),
  });
  return deriveFrozenMcpCatalogAuthority(
    snapshot,
    runtime.tools.map((tool): McpTool => {
      const taskExecutionProfile: McpTaskExecutionProfile = Object.freeze({
        profileVersion: tool.taskExecutionProfile.profileVersion,
        taskBehavior: tool.taskExecutionProfile.taskBehavior,
        availability: tool.taskExecutionProfile.availability,
        supportsScheduling: tool.taskExecutionProfile.supportsScheduling,
        supportsMaxElapsed: tool.taskExecutionProfile.supportsMaxElapsed,
        ...(tool.taskExecutionProfile.supportsCancellation === undefined
          ? {}
          : { supportsCancellation: tool.taskExecutionProfile.supportsCancellation }),
        ...(tool.taskExecutionProfile.supportsPauseResume === undefined
          ? {}
          : { supportsPauseResume: tool.taskExecutionProfile.supportsPauseResume }),
        supportsObservations: tool.taskExecutionProfile.supportsObservations,
        supportsInputRequired: tool.taskExecutionProfile.supportsInputRequired,
        idempotency: tool.taskExecutionProfile.idempotency,
      });
      return Object.freeze({
        serverId: tool.serverId,
        toolName: tool.toolName,
        ...(tool.title === undefined ? {} : { title: tool.title }),
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
        protocolMode: tool.protocolMode,
        executionSemantics: tool.executionSemantics,
        taskExecutionProfile,
        discoveredAt: runtime.snapshot.discoveredAt,
      });
    }),
    runtime.server.toolRevision,
  ).catalogChecksum;
}

function safeManagementBaseUrl(value: string): string {
  const url = safeUrl(value, 'DRIVER_CONFIGURATION_INVALID');
  if (url.pathname !== '/' || url.search !== '')
    fail('DRIVER_CONFIGURATION_INVALID', 'Management base URLs cannot include a path or query.');
  if (url.protocol === 'http:' && !isLoopback(url.hostname))
    fail('DRIVER_CONFIGURATION_INVALID', 'Non-loopback management URLs require HTTPS.');
  return url.origin;
}

function safeEndpoint(value: string, code: string): string {
  const url = safeUrl(value, code);
  return url.toString();
}

function safeUrl(value: string, code: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(code, 'Expected an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '')
    fail(code, 'Expected an absolute credential-free HTTP(S) URL.');
  url.hash = '';
  return url;
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort(compare)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: string, message: string): never {
  throw new SmppProviderMaterializationError(code, message);
}
