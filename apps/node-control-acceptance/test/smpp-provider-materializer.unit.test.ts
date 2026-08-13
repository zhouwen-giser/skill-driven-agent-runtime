import { describe, expect, it } from 'vitest';

import {
  hashConfigurationRequest,
  type JsonValue,
} from '../../../packages/node-control-domain/src/index.js';
import {
  materializeSmppProviders,
  type SmppProviderMaterializationConfiguration,
} from '../src/smpp-provider-materializer.js';

const NOW = '2026-08-12T01:00:00.000Z';
const VALID_UNTIL = '2026-08-12T02:00:00.000Z';
const REGISTRY_CHECKSUM = 'a'.repeat(64);
const NATIVE_CHECKSUM = 'b'.repeat(64);
const CONTROL_TOKEN = 'node-control-secret-never-report';
const PROVIDER_TOKEN = 'ugv-runtime-secret-never-report';

describe('generic SMPP Provider materializer', () => {
  it('materializes an exact tuple with explicit governed semantics and redacted evidence', async () => {
    const api = new FakeApis();
    api.runtimeSemanticsUnknown = true;

    const report = await materializeSmppProviders(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(report.providers).toEqual([
      expect.objectContaining({
        providerKey: 'ugv',
        bindingId: 'mcp-binding-ugv-smpp',
        action: 'created',
        runtimeAction: 'registered',
        bindingRevision: 1,
        runtimeToolRevision: 1,
      }),
    ]);
    expect(report.providers[0]?.tools).toEqual([
      expect.objectContaining({
        toolName: 'vehicle_get_state',
        taskBehavior: 'synchronous_only',
        effect: 'read_only',
        executionSemanticsSource: 'admin_override',
      }),
    ]);
    expect(api.commands).toEqual(['runtime:register', 'runtime:semantics', 'control:import']);
    expect(api.requests.every(({ redirect }) => redirect === 'manual')).toBe(true);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(CONTROL_TOKEN);
    expect(serialized).not.toContain(PROVIDER_TOKEN);
    expect(serialized).not.toContain('http://127.0.0.1:19100/mcp');
    expect(report.redaction).toEqual({
      secretsIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    });
  });

  it('rejects zero or multiple matches for the exact Source tuple before mutation', async () => {
    for (const candidates of [[], [candidate(), candidate()]]) {
      const api = new FakeApis();
      api.candidates = candidates;

      await expect(
        materializeSmppProviders(configuration(), { fetch: api.fetch, now: () => NOW }),
      ).rejects.toMatchObject({ code: 'SOURCE_CANDIDATE_NOT_EXACT' });
      expect(api.commands).toEqual([]);
    }
  });

  it('requires one complete native Registry lineage for every Candidate in the Source', async () => {
    const api = new FakeApis();
    api.candidates = [
      candidate(),
      {
        ...candidate(),
        externalProviderId: 'ugv-observer',
        externalServerId: 'ugv-runtime-observer',
        compositeIdentity: 'ugv-smpp::ugv-observer::ugv-runtime-observer',
        nativeRegistryChecksum: 'c'.repeat(64),
      },
    ];

    await expect(
      materializeSmppProviders(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'SOURCE_CANDIDATE_NATIVE_LINEAGE_MISMATCH' });
    expect(api.commands).toEqual([]);
  });

  it('uses persisted freshness and rejects an expired Source observation before mutation', async () => {
    const api = new FakeApis();
    api.candidates = [{ ...candidate(), registryValidUntil: NOW }];

    await expect(
      materializeSmppProviders(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'SOURCE_CANDIDATE_EXPIRED' });
    expect(api.commands).toEqual([]);
  });

  it('fails closed on Runtime endpoint drift rather than silently rebinding', async () => {
    const api = new FakeApis({ existing: true });
    api.runtimeEndpoint = 'http://127.0.0.1:19101/mcp';

    await expect(
      materializeSmppProviders(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'RUNTIME_ENDPOINT_DRIFT_REQUIRES_GOVERNED_REBIND' });
    expect(api.commands).toEqual([]);
  });

  it('approves exact Catalog checksum drift and converges both authorities by one refresh', async () => {
    const api = new FakeApis({ existing: true });
    api.bindingCatalogDrift = true;

    const report = await materializeSmppProviders(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(api.commands).toEqual(['control:approve', 'runtime:refresh']);
    expect(report.providers[0]).toEqual(
      expect.objectContaining({
        action: 'reconciled',
        runtimeAction: 'refreshed',
        bindingRevision: 2,
        runtimeToolRevision: 2,
      }),
    );
  });

  it('reuses an exact fresh Binding without revision churn', async () => {
    const api = new FakeApis({ existing: true });

    const report = await materializeSmppProviders(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(api.commands).toEqual([]);
    expect(report.providers[0]).toEqual(
      expect.objectContaining({
        action: 'reconciled',
        runtimeAction: 'reused',
        bindingRevision: 1,
        runtimeToolRevision: 1,
      }),
    );
  });

  it('rejects unknown configured semantics without guessing from Tool names', async () => {
    const input = configuration() as unknown as {
      providers: { tools: Record<string, { executionSemantics: { effect: string } }> }[];
    };
    const provider = input.providers[0];
    if (provider === undefined) throw new Error('TEST_CONFIGURATION_INVALID');
    const tool = provider.tools['vehicle_get_state'];
    if (tool === undefined) throw new Error('TEST_CONFIGURATION_INVALID');
    tool.executionSemantics.effect = 'unknown';
    const api = new FakeApis();

    await expect(
      materializeSmppProviders(input as unknown as SmppProviderMaterializationConfiguration, {
        fetch: api.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_CONFIGURATION_INVALID' });
    expect(api.requests).toEqual([]);
  });
});

function configuration(): SmppProviderMaterializationConfiguration {
  return {
    nodeControlBaseUrl: 'http://127.0.0.1:10080',
    nodeControlBearerToken: CONTROL_TOKEN,
    runtimeManagementBaseUrl: 'http://127.0.0.1:9998',
    smppSourceId: 'ugv-smpp',
    runId: 'ugv-materialization-test',
    providers: [
      {
        providerKey: 'ugv',
        name: 'UGV SMPP Runtime',
        externalProviderId: 'ugv-provider',
        externalServerId: 'ugv-runtime',
        bindingId: 'mcp-binding-ugv-smpp',
        localServerId: 'sdar-ugv-smpp',
        credentialRef: 'secret://env/SDAR_UGV_MCP_TOKEN',
        credential: { mode: 'bearer', token: PROVIDER_TOKEN },
        tools: {
          vehicle_get_state: {
            taskBehavior: 'synchronous_only',
            executionSemantics: {
              effect: 'read_only',
              execution: 'synchronous',
              cancellation: 'unsupported',
              idempotency: 'server_managed',
              replay: 'allowed',
            },
          },
        },
      },
    ],
  };
}

class FakeApis {
  readonly requests: { url: string; redirect: RequestInit['redirect'] }[] = [];
  readonly commands: string[] = [];
  candidates: unknown[] = [candidate()];
  runtimeEndpoint = candidate().serverEndpoint;
  runtimeSemanticsUnknown = false;
  bindingCatalogDrift = false;
  #bindingRevision: number | undefined;
  #runtimeRevision: number | undefined;
  #semanticsOverridden = false;

  constructor(options: Readonly<{ existing?: boolean }> = {}) {
    if (options.existing === true) {
      this.#bindingRevision = 1;
      this.#runtimeRevision = 1;
    }
  }

  readonly fetch: typeof fetch = async (input, init) => {
    await Promise.resolve();
    const url = new URL(input instanceof Request ? input.url : input.toString());
    this.requests.push({ url: url.toString(), redirect: init?.redirect });

    if (url.pathname === '/api/v1/mcp-provider-candidates')
      return json(200, { items: this.candidates });
    if (url.pathname === '/api/v1/mcp/servers' && init?.method !== 'POST')
      return json(200, {
        items:
          this.#runtimeRevision === undefined
            ? []
            : [runtimeListedServer(this.#runtimeRevision, this.runtimeEndpoint)],
      });
    if (url.pathname === '/api/v1/mcp/servers' && init?.method === 'POST') {
      this.#runtimeRevision = 1;
      this.commands.push('runtime:register');
      return json(201, this.runtimeResult(1));
    }
    if (url.pathname.endsWith('/execution-semantics') && init?.method === 'PUT') {
      this.#semanticsOverridden = true;
      this.commands.push('runtime:semantics');
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/tools')) return json(200, { items: this.runtimeTools() });
    if (url.pathname.endsWith('/refresh') && url.pathname.includes('/mcp/servers/')) {
      this.#runtimeRevision = (this.#runtimeRevision ?? 0) + 1;
      this.commands.push('runtime:refresh');
      return json(200, this.runtimeResult(this.#runtimeRevision));
    }
    if (url.pathname === '/api/v1/mcp-provider-bindings' && init?.method === 'POST') {
      this.#bindingRevision = 1;
      this.commands.push('control:import');
      return json(202, { status: 'succeeded' });
    }
    if (url.pathname.endsWith('/refresh') && url.pathname.includes('/mcp-provider-bindings/')) {
      const body = parsedBody(init);
      const payload = body['payload'];
      const approved =
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>)['approval'] === 'catalog_checksum';
      this.#bindingRevision = (this.#bindingRevision ?? 0) + 1;
      this.bindingCatalogDrift = false;
      this.commands.push(approved ? 'control:approve' : 'control:refresh');
      return json(202, { status: 'succeeded' });
    }
    if (url.pathname.includes('/mcp-provider-bindings/'))
      return this.#bindingRevision === undefined
        ? json(404, { code: 'MCP_PROVIDER_BINDING_NOT_FOUND' })
        : json(200, this.binding(this.#bindingRevision));
    return json(500, { code: 'UNEXPECTED_FAKE_ROUTE' });
  };

  private runtimeTools() {
    const tool = runtimeTool();
    if (!this.runtimeSemanticsUnknown || this.#semanticsOverridden)
      return [
        this.#semanticsOverridden
          ? {
              ...tool,
              executionSemantics: { ...tool.executionSemantics, source: 'admin_override' },
            }
          : tool,
      ];
    return [
      {
        ...tool,
        executionSemantics: {
          effect: 'unknown',
          execution: 'unknown',
          cancellation: 'unknown',
          idempotency: 'unknown',
          replay: 'unknown',
          source: 'default_unknown',
        },
      },
    ];
  }

  private runtimeResult(revision: number) {
    return runtimeResult(revision, this.runtimeEndpoint, this.runtimeTools());
  }

  private binding(revision: number) {
    return {
      bindingId: 'mcp-binding-ugv-smpp',
      localServerId: 'sdar-ugv-smpp',
      originType: 'smpp_registry',
      smppSourceId: 'ugv-smpp',
      externalProviderId: 'ugv-provider',
      externalServerId: 'ugv-runtime',
      registryRevision: 7,
      registryChecksum: REGISTRY_CHECKSUM,
      catalogRevision: `1.0.0:${String(revision)}`,
      catalogChecksum: this.bindingCatalogDrift
        ? 'd'.repeat(64)
        : catalogChecksum(this.runtimeTools()),
      endpointRef: candidate().serverEndpoint,
      status: this.bindingCatalogDrift ? 'degraded' : 'active',
      availabilityStatus: 'available',
      revision,
      availabilityValidUntil: VALID_UNTIL,
      catalogObservedAt: NOW,
      operationCount: 1,
    };
  }
}

function candidate() {
  return {
    smppSourceId: 'ugv-smpp',
    externalProviderId: 'ugv-provider',
    externalServerId: 'ugv-runtime',
    compositeIdentity: 'ugv-smpp::ugv-provider::ugv-runtime',
    serverEndpoint: 'http://127.0.0.1:19100/mcp',
    catalogRevision: '1',
    labels: { environment: 'ugv-lab', protocolMode: 'frozen_v1' },
    registryRevision: 7,
    registryChecksum: REGISTRY_CHECKSUM,
    registryEtag: `"${REGISTRY_CHECKSUM}"`,
    registryValidUntil: VALID_UNTIL,
    nativeRegistryRevision: 31,
    nativeRegistryChecksum: NATIVE_CHECKSUM,
    registryProjectionContract: 'sdar-registry-v1',
  };
}

function runtimeTool() {
  return {
    serverId: 'sdar-ugv-smpp',
    toolName: 'vehicle_get_state',
    description: 'Read the current vehicle state.',
    inputSchema: { type: 'object', properties: { resourceId: { const: 'vehicle:ugv1' } } },
    outputSchema: { type: 'object' },
    protocolMode: 'frozen_v1',
    executionSemantics: {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'server_managed',
      replay: 'allowed',
      source: 'mcp_declared',
    },
    taskExecutionProfile: {
      profileVersion: '1.0',
      taskBehavior: 'synchronous_only',
      availability: 'not_supported',
      supportsScheduling: false,
      supportsMaxElapsed: false,
      supportsObservations: false,
      supportsInputRequired: false,
      idempotency: 'server_managed',
    },
  };
}

function runtimeResult(
  revision: number,
  endpoint: string,
  tools: readonly ReturnType<typeof runtimeTool>[] = [runtimeTool()],
) {
  return {
    server: {
      serverId: 'sdar-ugv-smpp',
      name: 'UGV SMPP Runtime',
      endpoint,
      protocolMode: 'frozen_v1',
      toolRevision: revision,
    },
    snapshot: {
      protocolVersion: '2026-07-28',
      serverInfo: { name: 'ugv-runtime', version: '1.0.0' },
      discoveredAt: NOW,
      validUntil: VALID_UNTIL,
      toolRevision: revision,
    },
    tools,
  };
}

function runtimeListedServer(revision: number, endpoint: string) {
  const current = runtimeResult(revision, endpoint);
  return { ...current.server, currentDiscovery: current.snapshot };
}

function catalogChecksum(tools: readonly ReturnType<typeof runtimeTool>[]): string {
  const current = runtimeResult(1, candidate().serverEndpoint, tools);
  return hashConfigurationRequest(
    JSON.parse(
      JSON.stringify({
        protocolVersion: current.snapshot.protocolVersion,
        serverInfo: current.snapshot.serverInfo,
        tools: current.tools.map((tool) => ({
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
