import { describe, expect, it } from 'vitest';

import {
  hashConfigurationRequest,
  type JsonValue,
} from '../../../packages/node-control-domain/src/index.js';
import {
  configurationFromEnvironment,
  materializeHomeLabCatalog,
  type HomeLabCatalogMaterializationConfiguration,
} from '../src/home-lab-catalog-materialization-driver.js';

const NOW = '2026-08-10T12:00:00.000Z';
const VALID_UNTIL = '2026-08-10T13:00:00.000Z';
const REGISTRY_CHECKSUM = 'a'.repeat(64);
const NATIVE_REGISTRY_CHECKSUM = 'b'.repeat(64);
const CONTROL_TOKEN = 'control-secret-never-report';
const PROVIDER_TOKEN = 'provider-secret-never-report';

describe('home-lab Catalog materialization driver', () => {
  it('accepts isolated Binding IDs from the environment without changing legacy defaults', async () => {
    const { configuration: configured } = await configurationFromEnvironment({
      SDAR_HOME_LAB_SMPP_SOURCE_ID: 'home-lab-smpp-fresh',
      SDAR_HOME_LAB_NODE_CONTROL_URL: 'http://127.0.0.1:10080',
      SDAR_HOME_LAB_NODE_CONTROL_TOKEN: CONTROL_TOKEN,
      SDAR_HOME_LAB_RUNTIME_URL: 'http://127.0.0.1:9998',
      SDAR_HOME_LAB_RUN_ID: 'home-lab-freshness-run',
      SDAR_HOME_LAB_CLIMATE_BINDING_ID: 'mcp-binding-ha-climate-fresh',
      SDAR_HOME_LAB_CLIMATE_EXTERNAL_PROVIDER_ID: 'ha-climate-lab',
      SDAR_HOME_LAB_CLIMATE_EXTERNAL_SERVER_ID: 'runtime-climate-1',
      SDAR_HOME_LAB_CLIMATE_LOCAL_SERVER_ID: 'home-lab-climate-mcp-fresh',
      SDAR_HOME_LAB_CLIMATE_CREDENTIAL_REF: 'secret://env/MCP_HA_CLIMATE_TOKEN',
      SDAR_HOME_LAB_CLIMATE_MCP_TOKEN: PROVIDER_TOKEN,
      SDAR_HOME_LAB_LIGHT_BINDING_ID: 'mcp-binding-ha-light-fresh',
      SDAR_HOME_LAB_LIGHT_EXTERNAL_PROVIDER_ID: 'ha-light-lab',
      SDAR_HOME_LAB_LIGHT_EXTERNAL_SERVER_ID: 'runtime-light-1',
      SDAR_HOME_LAB_LIGHT_LOCAL_SERVER_ID: 'home-lab-light-mcp-fresh',
      SDAR_HOME_LAB_LIGHT_CREDENTIAL_REF: 'secret://env/MCP_HA_LIGHT_TOKEN',
      SDAR_HOME_LAB_LIGHT_MCP_TOKEN: PROVIDER_TOKEN,
    });

    expect(
      configured.providers.map(({ bindingId, localServerId }) => ({ bindingId, localServerId })),
    ).toEqual([
      {
        bindingId: 'mcp-binding-ha-climate-fresh',
        localServerId: 'home-lab-climate-mcp-fresh',
      },
      {
        bindingId: 'mcp-binding-ha-light-fresh',
        localServerId: 'home-lab-light-mcp-fresh',
      },
    ]);
  });

  it('allows a light-only refresh when the climate candidate is intentionally out of scope', async () => {
    const { configuration: configured } = await configurationFromEnvironment({
      SDAR_HOME_LAB_PROVIDER_KINDS: 'light',
      SDAR_HOME_LAB_SMPP_SOURCE_ID: 'home-lab-smpp-g09',
      SDAR_HOME_LAB_NODE_CONTROL_URL: 'http://127.0.0.1:10080',
      SDAR_HOME_LAB_NODE_CONTROL_TOKEN: CONTROL_TOKEN,
      SDAR_HOME_LAB_RUNTIME_URL: 'http://127.0.0.1:9998',
      SDAR_HOME_LAB_RUN_ID: 'home-lab-g09-light-only',
      SDAR_HOME_LAB_LIGHT_BINDING_ID: 'mcp-binding-ha-light-g09',
      SDAR_HOME_LAB_LIGHT_EXTERNAL_PROVIDER_ID: 'ha-light-lab',
      SDAR_HOME_LAB_LIGHT_EXTERNAL_SERVER_ID: 'runtime-light-g09',
      SDAR_HOME_LAB_LIGHT_LOCAL_SERVER_ID: 'home-lab-light-mcp-g09',
      SDAR_HOME_LAB_LIGHT_CREDENTIAL_REF: 'secret://env/MCP_HA_LIGHT_TOKEN',
      SDAR_HOME_LAB_LIGHT_MCP_TOKEN: PROVIDER_TOKEN,
    });

    expect(configured.providers).toHaveLength(1);
    expect(configured.providers[0]).toMatchObject({
      kind: 'light',
      bindingId: 'mcp-binding-ha-light-g09',
      localServerId: 'home-lab-light-mcp-g09',
    });
  });

  it('creates both exact Bindings, registers Runtime Catalogs and emits only redacted proof', async () => {
    const api = new FakeHomeLabApis(false);
    api.runtimeSemanticsUnknown = true;
    const report = await materializeHomeLabCatalog(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(
      report.providers.map(({ bindingId, action, runtimeAction }) => ({
        bindingId,
        action,
        runtimeAction,
      })),
    ).toEqual([
      {
        bindingId: 'mcp-binding-ha-climate-lab',
        action: 'created',
        runtimeAction: 'registered',
      },
      {
        bindingId: 'mcp-binding-ha-light-lab',
        action: 'created',
        runtimeAction: 'registered',
      },
    ]);
    expect(report.providers.map(({ tools }) => tools.length)).toEqual([4, 3]);
    expect(
      report.providers.map(
        ({ nativeRegistryRevision, nativeRegistryChecksum, registryProjectionContract }) => ({
          nativeRegistryRevision,
          nativeRegistryChecksum,
          registryProjectionContract,
        }),
      ),
    ).toEqual([
      {
        nativeRegistryRevision: 17,
        nativeRegistryChecksum: NATIVE_REGISTRY_CHECKSUM,
        registryProjectionContract: 'sdar-registry-v1',
      },
      {
        nativeRegistryRevision: 17,
        nativeRegistryChecksum: NATIVE_REGISTRY_CHECKSUM,
        registryProjectionContract: 'sdar-registry-v1',
      },
    ]);
    expect(report.providers[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'climate_get_state',
          taskBehavior: 'synchronous_only',
        }),
        expect.objectContaining({
          toolName: 'climate_set_temperature',
          taskBehavior: 'task_required',
        }),
      ]),
    );
    expect(api.controlCommands).toEqual(['import:climate', 'import:light']);
    expect(api.runtimeCommands).toEqual(['register:climate', 'register:light']);
    expect(api.runtimeSemanticsCommands).toEqual([
      'climate:climate_get_state:read_only',
      'climate:climate_set_power:side_effecting',
      'climate:climate_set_hvac_mode:side_effecting',
      'climate:climate_set_temperature:side_effecting',
      'light:light_get_state:read_only',
      'light:light_set_power:side_effecting',
      'light:light_set_brightness:side_effecting',
    ]);
    expect(
      report.providers.flatMap(({ tools }) =>
        tools.map(({ toolName, effect, executionSemanticsSource }) => ({
          toolName,
          effect,
          executionSemanticsSource,
        })),
      ),
    ).toEqual(
      expect.arrayContaining([
        {
          toolName: 'light_get_state',
          effect: 'read_only',
          executionSemanticsSource: 'admin_override',
        },
        {
          toolName: 'climate_get_state',
          effect: 'read_only',
          executionSemanticsSource: 'admin_override',
        },
        {
          toolName: 'light_set_power',
          effect: 'side_effecting',
          executionSemanticsSource: 'admin_override',
        },
      ]),
    );
    expect(api.requests.every(({ redirect }) => redirect === 'manual')).toBe(true);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(CONTROL_TOKEN);
    expect(serialized).not.toContain(PROVIDER_TOKEN);
    expect(serialized).not.toContain('http://127.0.0.1:1808');
    expect(serialized).not.toContain('climate.living_room');
    expect(report.redaction).toEqual({
      secretsIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    });
  });

  it('refreshes both authorities only when the complete Source lineage is unchanged', async () => {
    const api = new FakeHomeLabApis(true);
    const report = await materializeHomeLabCatalog(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(
      report.providers.map(({ action, runtimeAction, bindingRevision, runtimeToolRevision }) => ({
        action,
        runtimeAction,
        bindingRevision,
        runtimeToolRevision,
      })),
    ).toEqual([
      {
        action: 'reconciled',
        runtimeAction: 'refreshed',
        bindingRevision: 2,
        runtimeToolRevision: 2,
      },
      {
        action: 'reconciled',
        runtimeAction: 'refreshed',
        bindingRevision: 2,
        runtimeToolRevision: 2,
      },
    ]);
    expect(api.controlCommands).toEqual(['refresh:climate', 'refresh:light']);
    expect(api.runtimeCommands).toEqual(['refresh:climate', 'refresh:light']);
  });

  it('explicitly approves the exact governed checksum when retained admin semantics change Catalog identity', async () => {
    const api = new FakeHomeLabApis(true);
    api.runtimeSemanticsUnknown = true;

    const report = await materializeHomeLabCatalog(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(
      report.providers.map(({ bindingRevision, runtimeToolRevision }) => ({
        bindingRevision,
        runtimeToolRevision,
      })),
    ).toEqual([
      { bindingRevision: 2, runtimeToolRevision: 2 },
      { bindingRevision: 2, runtimeToolRevision: 2 },
    ]);
    expect(api.controlCommands).toEqual(['approve:climate', 'approve:light']);
    expect(api.runtimeCommands).toEqual(['refresh:climate', 'refresh:light']);
  });

  it('reuses the exact Runtime authority when the same-run Control command replays', async () => {
    const api = new FakeHomeLabApis(true);
    await materializeHomeLabCatalog(configuration(), { fetch: api.fetch, now: () => NOW });

    const replay = await materializeHomeLabCatalog(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(
      replay.providers.map(({ runtimeAction, bindingRevision, runtimeToolRevision }) => ({
        runtimeAction,
        bindingRevision,
        runtimeToolRevision,
      })),
    ).toEqual([
      { runtimeAction: 'reused', bindingRevision: 2, runtimeToolRevision: 2 },
      { runtimeAction: 'reused', bindingRevision: 2, runtimeToolRevision: 2 },
    ]);
    expect(api.controlCommands).toEqual(['refresh:climate', 'refresh:light']);
    expect(api.runtimeCommands).toEqual(['refresh:climate', 'refresh:light']);
  });

  it('lets a new Control revision catch up to a Runtime authority that is one revision ahead', async () => {
    const api = new FakeHomeLabApis(true, { bindingRevision: 1, runtimeRevision: 2 });

    const report = await materializeHomeLabCatalog(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(
      report.providers.map(({ runtimeAction, bindingRevision, runtimeToolRevision }) => ({
        runtimeAction,
        bindingRevision,
        runtimeToolRevision,
      })),
    ).toEqual([
      { runtimeAction: 'reused', bindingRevision: 2, runtimeToolRevision: 2 },
      { runtimeAction: 'reused', bindingRevision: 2, runtimeToolRevision: 2 },
    ]);
    expect(api.controlCommands).toEqual(['refresh:climate', 'refresh:light']);
    expect(api.runtimeCommands).toEqual([]);
  });

  it('fails closed when the Binding and Runtime revisions require more than one refresh', async () => {
    const api = new FakeHomeLabApis(true, { bindingRevision: 1, runtimeRevision: 4 });

    await expect(
      materializeHomeLabCatalog(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'CATALOG_AUTHORITY_REVISION_GAP' });
    expect(api.runtimeCommands).toEqual([]);
  });

  it('fails closed when Runtime Server and current Snapshot revisions diverge', async () => {
    const api = new FakeHomeLabApis(true);
    api.runtimeSnapshotRevisionOffset = 1;

    await expect(
      materializeHomeLabCatalog(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'CATALOG_AUTHORITY_REVISION_MISMATCH' });
  });

  it('fails closed before mutation when any exact Binding lineage field drifts', async () => {
    const api = new FakeHomeLabApis(true);
    api.bindingLineageChecksum = 'b'.repeat(64);

    await expect(
      materializeHomeLabCatalog(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({
      code: 'BINDING_LINEAGE_DRIFT_REQUIRES_CAS_REBIND',
    });
    expect(api.controlCommands).toEqual([]);
    expect(api.runtimeCommands).toEqual([]);
  });

  it('rejects expired persisted observations instead of deriving freshness locally', async () => {
    const api = new FakeHomeLabApis(false);
    api.bindingValidUntil = '2026-08-10T11:59:59.000Z';

    await expect(
      materializeHomeLabCatalog(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({
      code: 'BINDING_OBSERVATION_EXPIRED',
    });
  });

  it('rejects mixed complete native lineages from the same SMPP Source before mutation', async () => {
    const api = new FakeHomeLabApis(false);
    api.candidateItems = [
      candidate('climate'),
      { ...candidate('light'), nativeRegistryChecksum: 'c'.repeat(64) },
    ];

    await expect(
      materializeHomeLabCatalog(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({
      code: 'SOURCE_CANDIDATE_NATIVE_LINEAGE_MISMATCH',
    });
    expect(api.controlCommands).toEqual([]);
    expect(api.runtimeCommands).toEqual([]);
  });

  it.each([
    'nativeRegistryRevision',
    'nativeRegistryChecksum',
    'registryProjectionContract',
  ] as const)('rejects a partial SMPP native lineage missing %s before mutation', async (field) => {
    const api = new FakeHomeLabApis(false);
    const incomplete = { ...candidate('light') } as Record<string, unknown>;
    Reflect.deleteProperty(incomplete, field);
    api.candidateItems = [candidate('climate'), incomplete];

    await expect(
      materializeHomeLabCatalog(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect(api.controlCommands).toEqual([]);
    expect(api.runtimeCommands).toEqual([]);
  });

  it.each([
    ['zero native revision', { nativeRegistryRevision: 0 }],
    ['fractional native revision', { nativeRegistryRevision: 1.5 }],
    ['uppercase native checksum', { nativeRegistryChecksum: 'B'.repeat(64) }],
    ['short native checksum', { nativeRegistryChecksum: 'b'.repeat(63) }],
    ['unknown projection contract', { registryProjectionContract: 'sdar-registry-v2' }],
  ])('rejects invalid SMPP native lineage: %s', async (_name, override) => {
    const api = new FakeHomeLabApis(false);
    api.candidateItems = [candidate('climate'), { ...candidate('light'), ...override }];

    await expect(
      materializeHomeLabCatalog(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect(api.controlCommands).toEqual([]);
    expect(api.runtimeCommands).toEqual([]);
  });

  it.each([false, true])(
    'rejects a direct-shaped Candidate before mutation when native lineage is present=%s',
    async (includeNativeLineage) => {
      const api = new FakeHomeLabApis(false);
      api.candidateItems = [
        candidate('climate'),
        candidate('light'),
        directCandidate(includeNativeLineage),
      ];

      await expect(
        materializeHomeLabCatalog(configuration(), { fetch: api.fetch, now: () => NOW }),
      ).rejects.toMatchObject({ name: 'ZodError' });
      expect(api.controlCommands).toEqual([]);
      expect(api.runtimeCommands).toEqual([]);
    },
  );
});

function configuration(): HomeLabCatalogMaterializationConfiguration {
  return Object.freeze({
    nodeControlBaseUrl: 'http://127.0.0.1:10080',
    nodeControlBearerToken: CONTROL_TOKEN,
    runtimeManagementBaseUrl: 'http://127.0.0.1:9998',
    smppSourceId: 'home-lab-smpp',
    runId: 'home-lab-test-run',
    providers: Object.freeze([
      Object.freeze({
        kind: 'climate' as const,
        externalProviderId: 'ha-climate-lab',
        externalServerId: 'runtime-climate-1',
        localServerId: 'sdar-ha-climate-lab',
        credentialRef: 'secret://env/MCP_HA_CLIMATE_TOKEN',
        credential: Object.freeze({ mode: 'bearer' as const, token: PROVIDER_TOKEN }),
      }),
      Object.freeze({
        kind: 'light' as const,
        externalProviderId: 'ha-light-lab',
        externalServerId: 'runtime-light-1',
        localServerId: 'sdar-ha-light-lab',
        credentialRef: 'secret://env/MCP_HA_LIGHT_TOKEN',
        credential: Object.freeze({ mode: 'none' as const }),
      }),
    ]),
  });
}

class FakeHomeLabApis {
  readonly requests: { readonly url: string; readonly redirect: RequestInit['redirect'] }[] = [];
  readonly controlCommands: string[] = [];
  readonly runtimeCommands: string[] = [];
  readonly runtimeSemanticsCommands: string[] = [];
  readonly #bindings = new Map<string, number>();
  readonly #runtimeServers = new Map<string, number>();
  readonly #controlCommandKeys = new Set<string>();
  readonly #runtimeSemanticsOverrides = new Set<string>();
  bindingLineageChecksum = REGISTRY_CHECKSUM;
  bindingValidUntil = VALID_UNTIL;
  runtimeSnapshotRevisionOffset = 0;
  runtimeSemanticsUnknown = false;
  candidateItems: unknown[] | undefined;

  constructor(
    existing: boolean,
    revisions: Readonly<{ bindingRevision?: number; runtimeRevision?: number }> = {},
  ) {
    if (existing) {
      this.#bindings.set('climate', revisions.bindingRevision ?? 1);
      this.#bindings.set('light', revisions.bindingRevision ?? 1);
      this.#runtimeServers.set('climate', revisions.runtimeRevision ?? 1);
      this.#runtimeServers.set('light', revisions.runtimeRevision ?? 1);
    }
  }

  readonly fetch: typeof fetch = async (input, init) => {
    await Promise.resolve();
    const url = new URL(input instanceof Request ? input.url : input.toString());
    this.requests.push({ url: url.toString(), redirect: init?.redirect });
    if (url.pathname === '/api/v1/mcp-provider-candidates')
      return json(200, {
        items: this.candidateItems ?? [candidate('climate'), candidate('light')],
      });
    if (url.pathname === '/api/v1/mcp/servers' && init?.method !== 'POST')
      return json(200, {
        items: [...this.#runtimeServers].map(([kind, revision]) =>
          runtimeListedServer(
            kind as ProviderKind,
            revision,
            revision + this.runtimeSnapshotRevisionOffset,
          ),
        ),
      });
    if (url.pathname === '/api/v1/mcp-provider-bindings' && init?.method === 'POST') {
      const body = parsedBody(init);
      const kind = String((body['payload'] as Record<string, unknown>)['bindingId']).includes(
        'climate',
      )
        ? 'climate'
        : 'light';
      const key = idempotencyKey(init);
      if (!this.#controlCommandKeys.has(key)) {
        this.#controlCommandKeys.add(key);
        this.#bindings.set(kind, 1);
        this.controlCommands.push(`import:${kind}`);
      }
      return json(202, { status: 'succeeded' });
    }
    const bindingKind = pathKind(url.pathname);
    if (
      bindingKind !== undefined &&
      url.pathname.includes('/mcp-provider-bindings/') &&
      url.pathname.endsWith('/refresh')
    ) {
      const key = idempotencyKey(init);
      if (!this.#controlCommandKeys.has(key)) {
        this.#controlCommandKeys.add(key);
        this.#bindings.set(bindingKind, (this.#bindings.get(bindingKind) ?? 0) + 1);
        const body = parsedBody(init);
        const payload = body['payload'];
        const approved =
          typeof payload === 'object' &&
          payload !== null &&
          (payload as Record<string, unknown>)['approval'] === 'catalog_checksum';
        this.controlCommands.push(`${approved ? 'approve' : 'refresh'}:${bindingKind}`);
      }
      return json(202, { status: 'succeeded' });
    }
    if (bindingKind !== undefined && url.pathname.includes('/mcp-provider-bindings/')) {
      const revision = this.#bindings.get(bindingKind);
      return revision === undefined
        ? json(404, { code: 'MCP_PROVIDER_BINDING_NOT_FOUND' })
        : json(200, this.binding(bindingKind, revision));
    }
    if (url.pathname === '/api/v1/mcp/servers' && init?.method === 'POST') {
      const body = parsedBody(init);
      const kind = String(body['serverId']).includes('climate') ? 'climate' : 'light';
      this.#runtimeServers.set(kind, 1);
      this.runtimeCommands.push(`register:${kind}`);
      return json(201, this.runtimeResult(kind, 1, 1 + this.runtimeSnapshotRevisionOffset));
    }
    const runtimeKind = pathKind(url.pathname);
    if (
      runtimeKind !== undefined &&
      init?.method === 'PUT' &&
      url.pathname.endsWith('/execution-semantics')
    ) {
      const segments = url.pathname.split('/');
      const toolName = decodeURIComponent(segments.at(-2) ?? '');
      const body = parsedBody(init);
      this.#runtimeSemanticsOverrides.add(`${runtimeKind}:${toolName}`);
      this.runtimeSemanticsCommands.push(`${runtimeKind}:${toolName}:${String(body['effect'])}`);
      return new Response(null, { status: 204 });
    }
    if (runtimeKind !== undefined && url.pathname.endsWith('/tools'))
      return json(200, { items: this.runtimeTools(runtimeKind) });
    if (runtimeKind !== undefined && url.pathname.endsWith('/refresh')) {
      const revision = (this.#runtimeServers.get(runtimeKind) ?? 0) + 1;
      this.#runtimeServers.set(runtimeKind, revision);
      this.runtimeCommands.push(`refresh:${runtimeKind}`);
      return json(
        200,
        this.runtimeResult(runtimeKind, revision, revision + this.runtimeSnapshotRevisionOffset),
      );
    }
    return json(500, { code: 'UNEXPECTED_FAKE_ROUTE' });
  };

  private binding(kind: ProviderKind, revision: number) {
    const item = candidate(kind);
    return {
      bindingId: `mcp-binding-ha-${kind}-lab`,
      localServerId: `sdar-ha-${kind}-lab`,
      originType: 'smpp_registry',
      smppSourceId: item.smppSourceId,
      externalProviderId: item.externalProviderId,
      externalServerId: item.externalServerId,
      registryRevision: item.registryRevision,
      registryChecksum: this.bindingLineageChecksum,
      catalogRevision: `1.0.0:${String(revision)}`,
      catalogChecksum: catalogChecksum(kind, this.runtimeTools(kind)),
      endpointRef: item.serverEndpoint,
      status: 'active',
      availabilityStatus: 'available',
      revision,
      availabilityValidUntil: this.bindingValidUntil,
      catalogObservedAt: NOW,
      operationCount: tools(kind).length,
    };
  }

  private runtimeResult(
    kind: ProviderKind,
    toolRevision: number,
    snapshotToolRevision = toolRevision,
  ) {
    return {
      ...runtimeResult(kind, toolRevision, snapshotToolRevision),
      tools: this.runtimeTools(kind),
    };
  }

  private runtimeTools(kind: ProviderKind) {
    return tools(kind).map((tool) => {
      if (this.#runtimeSemanticsOverrides.has(`${kind}:${tool.toolName}`))
        return {
          ...tool,
          executionSemantics: { ...tool.executionSemantics, source: 'admin_override' },
        };
      return !this.runtimeSemanticsUnknown
        ? tool
        : {
            ...tool,
            executionSemantics: {
              effect: 'unknown',
              execution: 'unknown',
              cancellation: 'unknown',
              idempotency: 'unknown',
              replay: 'unknown',
              source: 'default_unknown',
            },
          };
    });
  }
}

type ProviderKind = 'climate' | 'light';

function candidate(kind: ProviderKind) {
  return {
    smppSourceId: 'home-lab-smpp',
    externalProviderId: `ha-${kind}-lab`,
    externalServerId: `runtime-${kind}-1`,
    compositeIdentity: `home-lab-smpp::ha-${kind}-lab::runtime-${kind}-1`,
    serverEndpoint: `http://127.0.0.1:${kind === 'climate' ? '18081' : '18080'}/mcp`,
    catalogRevision: '1',
    labels: { environment: 'home-lab', protocolMode: 'frozen_v1' },
    registryRevision: 3,
    registryChecksum: REGISTRY_CHECKSUM,
    registryEtag: `"${REGISTRY_CHECKSUM}"`,
    registryValidUntil: VALID_UNTIL,
    nativeRegistryRevision: 17,
    nativeRegistryChecksum: NATIVE_REGISTRY_CHECKSUM,
    registryProjectionContract: 'sdar-registry-v1',
  };
}

function directCandidate(includeNativeLineage: boolean): Record<string, unknown> {
  return {
    originType: 'direct',
    externalProviderId: 'direct-provider',
    externalServerId: 'direct-server',
    compositeIdentity: 'direct-provider::direct-server',
    serverEndpoint: 'http://127.0.0.1:18082/mcp',
    catalogRevision: '1',
    labels: { environment: 'home-lab', protocolMode: 'frozen_v1' },
    ...(includeNativeLineage
      ? {
          nativeRegistryRevision: 17,
          nativeRegistryChecksum: NATIVE_REGISTRY_CHECKSUM,
          registryProjectionContract: 'sdar-registry-v1',
        }
      : {}),
  };
}

function runtimeResult(
  kind: ProviderKind,
  toolRevision: number,
  snapshotToolRevision = toolRevision,
) {
  return {
    server: {
      serverId: `sdar-ha-${kind}-lab`,
      name: `Home Lab ${kind}`,
      endpoint: candidate(kind).serverEndpoint,
      protocolMode: 'frozen_v1',
      toolRevision: snapshotToolRevision,
    },
    snapshot: {
      protocolVersion: '2026-07-28',
      serverInfo: { name: `ha-${kind}-lab`, version: '1.0.0' },
      discoveredAt: NOW,
      validUntil: VALID_UNTIL,
      toolRevision,
    },
    tools: tools(kind),
  };
}

function runtimeListedServer(
  kind: ProviderKind,
  toolRevision: number,
  snapshotToolRevision = toolRevision,
) {
  const current = runtimeResult(kind, toolRevision, snapshotToolRevision);
  return { ...current.server, currentDiscovery: current.snapshot };
}

function tools(kind: ProviderKind) {
  const names =
    kind === 'climate'
      ? [
          'climate_get_state',
          'climate_set_power',
          'climate_set_hvac_mode',
          'climate_set_temperature',
        ]
      : ['light_get_state', 'light_set_power', 'light_set_brightness'];
  return names.map((toolName) => ({
    serverId: `sdar-ha-${kind}-lab`,
    toolName,
    description: `${toolName} description`,
    inputSchema: {
      type: 'object',
      properties: { resourceId: { type: 'string', const: 'climate.living_room' } },
    },
    outputSchema: { type: 'object' },
    protocolMode: 'frozen_v1',
    executionSemantics: {
      effect: toolName.endsWith('get_state') ? 'read_only' : 'side_effecting',
      execution: toolName.endsWith('get_state') ? 'synchronous' : 'task_required',
      cancellation: 'unsupported',
      idempotency: 'server_managed',
      replay: toolName.endsWith('get_state') ? 'allowed' : 'forbidden',
      source: 'mcp_declared',
    },
    taskExecutionProfile: {
      profileVersion: '1.0',
      taskBehavior: toolName.endsWith('get_state') ? 'synchronous_only' : 'task_required',
      availability: toolName.endsWith('get_state') ? 'not_supported' : 'dynamic',
      supportsScheduling: !toolName.endsWith('get_state'),
      supportsMaxElapsed: false,
      supportsObservations: !toolName.endsWith('get_state'),
      supportsInputRequired: false,
      idempotency: 'client_request_key',
    },
  }));
}

function catalogChecksum(kind: ProviderKind, currentTools = tools(kind)): string {
  const result = { ...runtimeResult(kind, 1), tools: currentTools };
  return hashConfigurationRequest(
    JSON.parse(
      JSON.stringify({
        protocolVersion: result.snapshot.protocolVersion,
        serverInfo: result.snapshot.serverInfo,
        tools: result.tools
          .sort((left, right) => left.toolName.localeCompare(right.toolName))
          .map((tool) => ({
            name: tool.toolName,
            title: null,
            description: tool.description,
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

function idempotencyKey(init: RequestInit | undefined): string {
  const value = new Headers(init?.headers).get('idempotency-key');
  if (value === null) throw new Error('IDEMPOTENCY_KEY_MISSING');
  return value;
}

function pathKind(path: string): ProviderKind | undefined {
  return path.includes('climate') ? 'climate' : path.includes('light') ? 'light' : undefined;
}

function parsedBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('FAKE_REQUEST_BODY_INVALID');
  return JSON.parse(init.body) as Record<string, unknown>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
