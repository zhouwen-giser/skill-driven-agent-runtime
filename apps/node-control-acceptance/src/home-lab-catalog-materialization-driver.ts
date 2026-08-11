import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  hashConfigurationRequest,
  type JsonValue,
} from '../../../packages/node-control-domain/src/index.js';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const REGISTRY_PROJECTION_CONTRACT = 'sdar-registry-v1' as const;
const TASK_BEHAVIORS = ['synchronous_only', 'server_directed', 'task_required'] as const;

const EXPECTED_PROVIDERS = Object.freeze({
  climate: Object.freeze({
    bindingId: 'mcp-binding-ha-climate-lab',
    tools: Object.freeze({
      climate_get_state: 'synchronous_only',
      climate_set_hvac_mode: 'task_required',
      climate_set_power: 'task_required',
      climate_set_temperature: 'task_required',
    }),
  }),
  light: Object.freeze({
    bindingId: 'mcp-binding-ha-light-lab',
    tools: Object.freeze({
      light_get_state: 'synchronous_only',
      light_set_brightness: 'task_required',
      light_set_power: 'task_required',
    }),
  }),
});

type ProviderKind = keyof typeof EXPECTED_PROVIDERS;
type TaskBehavior = (typeof TASK_BEHAVIORS)[number];

export interface HomeLabProviderConfiguration {
  readonly kind: ProviderKind;
  readonly externalProviderId: string;
  readonly externalServerId: string;
  readonly localServerId: string;
  readonly credentialRef: string;
  readonly credential: Readonly<{ mode: 'bearer'; token: string }> | Readonly<{ mode: 'none' }>;
}

export interface HomeLabCatalogMaterializationConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly runtimeManagementBaseUrl: string;
  readonly smppSourceId: string;
  readonly runId: string;
  readonly providers: readonly HomeLabProviderConfiguration[];
}

export interface HomeLabCatalogMaterializationReport {
  readonly schemaVersion: 'sdar.home-lab-catalog-materialization/v1';
  readonly status: 'passed';
  readonly observedAt: string;
  readonly smppSourceId: string;
  readonly providers: readonly Readonly<{
    kind: ProviderKind;
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
      taskBehavior: TaskBehavior;
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

export class HomeLabCatalogMaterializationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HomeLabCatalogMaterializationError';
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
    name: z.string().min(1),
    endpoint: z.string().min(1),
    protocolMode: z.literal('frozen_v1'),
    toolRevision: z.number().int().positive(),
    currentDiscovery: DiscoverySchema.optional(),
  })
  .loose();

const JsonSchema = z.union([z.boolean(), z.record(z.string(), z.unknown())]);
const RuntimeToolSchema = z
  .object({
    serverId: z.string().min(1),
    toolName: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: JsonSchema,
    outputSchema: JsonSchema.optional(),
    protocolMode: z.literal('frozen_v1'),
    executionSemantics: z.record(z.string(), z.unknown()),
    taskExecutionProfile: z
      .object({
        profileVersion: z.literal('1.0'),
        taskBehavior: z.enum(TASK_BEHAVIORS),
      })
      .loose(),
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

export async function materializeHomeLabCatalog(
  input: HomeLabCatalogMaterializationConfiguration,
  dependencies: Readonly<{
    fetch?: typeof fetch;
    now?: () => string;
  }> = {},
): Promise<HomeLabCatalogMaterializationReport> {
  const configuration = validateConfiguration(input);
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const observedAt = validTimestamp(now(), 'DRIVER_CLOCK_INVALID');
  const candidates = await controlGetCandidates(configuration, request);
  assertExactCandidateDirectoryNativeLineage(candidates, configuration.smppSourceId);
  const runtimeServers = await runtimeListServers(configuration, request);
  const reports: HomeLabCatalogMaterializationReport['providers'][number][] = [];

  for (const provider of configuration.providers) {
    const expected = EXPECTED_PROVIDERS[provider.kind];
    const matches = candidates.filter(
      (candidate) =>
        candidate.smppSourceId === configuration.smppSourceId &&
        candidate.externalProviderId === provider.externalProviderId &&
        candidate.externalServerId === provider.externalServerId,
    );
    if (matches.length !== 1)
      fail(
        'SOURCE_CANDIDATE_NOT_EXACT',
        `Expected one exact ${provider.kind} Source Candidate; observed ${String(matches.length)}.`,
      );
    const candidate = matches[0];
    if (candidate === undefined)
      fail('SOURCE_CANDIDATE_NOT_EXACT', `The ${provider.kind} Source Candidate is missing.`);
    const endpoint = safeEndpoint(candidate.serverEndpoint, 'SOURCE_CANDIDATE_ENDPOINT_INVALID');
    requireFresh(candidate.registryValidUntil, observedAt, 'SOURCE_CANDIDATE_EXPIRED');

    const currentBinding = await controlGetBinding(configuration, expected.bindingId, request);
    const action = currentBinding === undefined ? 'created' : 'reconciled';
    if (currentBinding === undefined) {
      await controlCommand(
        configuration,
        '/api/v1/mcp-provider-bindings',
        `${configuration.runId}-${provider.kind}-import`,
        {
          reason: `Materialize the exact ${provider.kind} home-lab Source Candidate.`,
          payload: {
            bindingId: expected.bindingId,
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
      await controlCommand(
        configuration,
        `/api/v1/mcp-provider-bindings/${encodeURIComponent(expected.bindingId)}/refresh`,
        `${configuration.runId}-${provider.kind}-refresh`,
        { reason: `Reconcile the unchanged ${provider.kind} home-lab Source Candidate.` },
        request,
      );
    }

    const binding = await controlGetBinding(configuration, expected.bindingId, request);
    if (binding === undefined)
      fail('BINDING_MISSING_AFTER_COMMAND', 'Binding command did not persist.');
    assertSameLineage(binding, candidate, provider.localServerId, endpoint);

    const existingRuntime = runtimeServers.find(
      (server) => server.serverId === provider.localServerId,
    );
    let runtimeAction: HomeLabCatalogMaterializationReport['providers'][number]['runtimeAction'];
    let runtime: RuntimeRefresh;
    if (existingRuntime === undefined) {
      runtimeAction = 'registered';
      runtime = await runtimeCommand(
        configuration,
        '/api/v1/mcp/servers',
        {
          serverId: provider.localServerId,
          name: `Home Lab ${provider.kind}`,
          endpoint,
          credentialHeaders:
            provider.credential.mode === 'bearer'
              ? { authorization: `Bearer ${provider.credential.token}` }
              : {},
        },
        201,
        request,
      );
    } else if (existingRuntime.toolRevision === binding.revision - 1) {
      if (safeEndpoint(existingRuntime.endpoint, 'RUNTIME_ENDPOINT_INVALID') !== endpoint)
        fail(
          'RUNTIME_ENDPOINT_DRIFT_REQUIRES_GOVERNED_REBIND',
          `Runtime endpoint drift was detected for ${provider.kind}.`,
        );
      runtimeAction = 'refreshed';
      runtime = await runtimeCommand(
        configuration,
        `/api/v1/mcp/servers/${encodeURIComponent(provider.localServerId)}/refresh`,
        undefined,
        200,
        request,
      );
    } else if (existingRuntime.toolRevision === binding.revision) {
      if (safeEndpoint(existingRuntime.endpoint, 'RUNTIME_ENDPOINT_INVALID') !== endpoint)
        fail(
          'RUNTIME_ENDPOINT_DRIFT_REQUIRES_GOVERNED_REBIND',
          `Runtime endpoint drift was detected for ${provider.kind}.`,
        );
      runtimeAction = 'reused';
      runtime = await runtimeReadCurrent(configuration, existingRuntime, request);
    } else {
      fail(
        'CATALOG_AUTHORITY_REVISION_GAP',
        `Binding revision ${String(binding.revision)} cannot be reconciled with Runtime Tool revision ${String(existingRuntime.toolRevision)} by one bounded refresh.`,
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
      fail('BINDING_NOT_SELECTABLE', `The ${provider.kind} Binding is not active and available.`);
    requireFresh(binding.availabilityValidUntil, observedAt, 'BINDING_OBSERVATION_EXPIRED');
    if (binding.operationCount !== runtime.tools.length)
      fail('CATALOG_OPERATION_COUNT_MISMATCH', 'Control and Runtime operation counts differ.');

    validateRuntimeCatalog(provider.kind, provider.localServerId, expected.tools, runtime);
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
        kind: provider.kind,
        bindingId: expected.bindingId,
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
                inputSchemaSha256: sha256(stableStringify(tool.inputSchema)),
                outputSchemaSha256: sha256(stableStringify(tool.outputSchema)),
              }),
            ),
        ),
      }),
    );
  }

  return Object.freeze({
    schemaVersion: 'sdar.home-lab-catalog-materialization/v1',
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

export async function configurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<
  Readonly<{
    configuration: HomeLabCatalogMaterializationConfiguration;
    reportFile: string;
  }>
> {
  const sourceId = requiredEnvironment(environment, 'SDAR_HOME_LAB_SMPP_SOURCE_ID');
  const nodeControlBearerToken = await secretFromEnvironment(
    environment,
    'SDAR_HOME_LAB_NODE_CONTROL_TOKEN',
  );
  const providers = await Promise.all(
    (['climate', 'light'] as const).map(async (kind) => {
      const prefix = `SDAR_HOME_LAB_${kind.toUpperCase()}`;
      const credentialMode = environment[`${prefix}_CREDENTIAL_MODE`] ?? 'bearer';
      if (!['bearer', 'none'].includes(credentialMode))
        fail('DRIVER_CONFIGURATION_INVALID', `${prefix}_CREDENTIAL_MODE is invalid.`);
      const credential =
        credentialMode === 'none'
          ? ({ mode: 'none' } as const)
          : ({
              mode: 'bearer',
              token: await secretFromEnvironment(environment, `${prefix}_MCP_TOKEN`),
            } as const);
      return Object.freeze({
        kind,
        externalProviderId: requiredEnvironment(environment, `${prefix}_EXTERNAL_PROVIDER_ID`),
        externalServerId: requiredEnvironment(environment, `${prefix}_EXTERNAL_SERVER_ID`),
        localServerId: requiredEnvironment(environment, `${prefix}_LOCAL_SERVER_ID`),
        credentialRef: requiredEnvironment(environment, `${prefix}_CREDENTIAL_REF`),
        credential,
      });
    }),
  );
  return Object.freeze({
    configuration: Object.freeze({
      nodeControlBaseUrl: requiredEnvironment(environment, 'SDAR_HOME_LAB_NODE_CONTROL_URL'),
      nodeControlBearerToken,
      runtimeManagementBaseUrl: requiredEnvironment(environment, 'SDAR_HOME_LAB_RUNTIME_URL'),
      smppSourceId: sourceId,
      runId: requiredEnvironment(environment, 'SDAR_HOME_LAB_RUN_ID'),
      providers: Object.freeze(providers),
    }),
    reportFile:
      environment['SDAR_HOME_LAB_REPORT_FILE'] ??
      'reports/sdar-smpp-integration/home-lab-catalog-materialization.redacted.json',
  });
}

export async function writeRedactedReport(
  reportFile: string,
  report: HomeLabCatalogMaterializationReport,
): Promise<void> {
  const target = resolve(reportFile);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, target);
}

function validateConfiguration(
  input: HomeLabCatalogMaterializationConfiguration,
): HomeLabCatalogMaterializationConfiguration {
  const nodeControlBaseUrl = safeManagementBaseUrl(input.nodeControlBaseUrl);
  const runtimeManagementBaseUrl = safeManagementBaseUrl(input.runtimeManagementBaseUrl);
  if (input.nodeControlBearerToken.trim() === '')
    fail('DRIVER_CONFIGURATION_INVALID', 'Node Control bearer token is required.');
  if (input.runId.trim().length < 8)
    fail('DRIVER_CONFIGURATION_INVALID', 'A bounded unique runId is required.');
  if (input.smppSourceId.trim() === '')
    fail('DRIVER_CONFIGURATION_INVALID', 'SMPP Source ID is required.');
  if (input.providers.length !== 2 || new Set(input.providers.map(({ kind }) => kind)).size !== 2)
    fail(
      'DRIVER_CONFIGURATION_INVALID',
      'Exactly one climate and one light provider are required.',
    );
  for (const provider of input.providers) {
    for (const value of [
      provider.externalProviderId,
      provider.externalServerId,
      provider.localServerId,
      provider.credentialRef,
    ])
      if (value.trim() === '') fail('DRIVER_CONFIGURATION_INVALID', 'Provider IDs are required.');
    if (provider.credential.mode === 'bearer' && provider.credential.token.trim() === '')
      fail('DRIVER_CONFIGURATION_INVALID', 'Provider bearer token is empty.');
  }
  return Object.freeze({ ...input, nodeControlBaseUrl, runtimeManagementBaseUrl });
}

async function controlGetCandidates(
  configuration: HomeLabCatalogMaterializationConfiguration,
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
  configuration: HomeLabCatalogMaterializationConfiguration,
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
  configuration: HomeLabCatalogMaterializationConfiguration,
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
  configuration: HomeLabCatalogMaterializationConfiguration,
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
  configuration: HomeLabCatalogMaterializationConfiguration,
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
  configuration: HomeLabCatalogMaterializationConfiguration,
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
  kind: ProviderKind,
  serverId: string,
  expected: Readonly<Record<string, TaskBehavior>>,
  runtime: RuntimeRefresh,
): void {
  if (runtime.server.serverId !== serverId)
    fail('RUNTIME_SERVER_IDENTITY_MISMATCH', `Runtime identity mismatch for ${kind}.`);
  const actual = new Map(runtime.tools.map((tool) => [tool.toolName, tool] as const));
  if (
    actual.size !== Object.keys(expected).length ||
    Object.keys(expected).some((toolName) => !actual.has(toolName))
  )
    fail('CATALOG_TOOL_SET_MISMATCH', `Runtime Tool set mismatch for ${kind}.`);
  for (const [toolName, behavior] of Object.entries(expected)) {
    const tool = actual.get(toolName);
    if (tool?.outputSchema === undefined || tool.taskExecutionProfile.taskBehavior !== behavior)
      fail('CATALOG_TOOL_CONTRACT_MISMATCH', `Runtime Tool contract mismatch for ${toolName}.`);
  }
}

function runtimeCatalogChecksum(runtime: RuntimeRefresh): string {
  return hashConfigurationRequest(
    JSON.parse(
      JSON.stringify({
        protocolVersion: runtime.snapshot.protocolVersion,
        serverInfo: runtime.snapshot.serverInfo,
        tools: [...runtime.tools]
          .sort((left, right) => compare(left.toolName, right.toolName))
          .map((tool) => ({
            name: tool.toolName,
            title: tool.title ?? null,
            description: tool.description ?? null,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema ?? null,
            protocolMode: tool.protocolMode,
            executionSemantics: tool.executionSemantics,
            taskExecutionProfile: tool.taskExecutionProfile,
          })),
      }),
    ) as JsonValue,
  );
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

async function secretFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): Promise<string> {
  const inline = environment[name];
  const file = environment[`${name}_FILE`];
  if ((inline === undefined) === (file === undefined))
    fail('DRIVER_CONFIGURATION_INVALID', `Set exactly one of ${name} or ${name}_FILE.`);
  let raw: string;
  if (inline !== undefined) raw = inline;
  else {
    if (file === undefined)
      return fail('DRIVER_CONFIGURATION_INVALID', `${name}_FILE is required.`);
    raw = await readFile(file, 'utf8');
  }
  const value = raw.trim();
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
  throw new HomeLabCatalogMaterializationError(code, message);
}

async function main(): Promise<void> {
  try {
    const { configuration, reportFile } = await configurationFromEnvironment();
    const report = await materializeHomeLabCatalog(configuration);
    await writeRedactedReport(reportFile, report);
    process.stdout.write(
      `${JSON.stringify({ status: report.status, reportFile: resolve(reportFile) })}\n`,
    );
  } catch (error: unknown) {
    const code =
      error instanceof HomeLabCatalogMaterializationError
        ? error.code
        : 'HOME_LAB_CATALOG_MATERIALIZATION_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
