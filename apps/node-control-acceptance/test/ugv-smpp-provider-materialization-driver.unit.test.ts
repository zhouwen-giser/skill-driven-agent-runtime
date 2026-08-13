import { describe, expect, it } from 'vitest';

import {
  hashConfigurationRequest,
  type JsonValue,
} from '../../../packages/node-control-domain/src/index.js';
import {
  UGV_REVIEWED_TOOL_POLICY,
  materializeUgvSmppProvider,
  ugvSmppProviderMaterializationConfigurationFromEnvironment,
  type UgvSmppProviderMaterializationConfiguration,
  type UgvToolName,
} from '../src/ugv-smpp-provider-materialization-driver.js';

const NOW = '2026-08-12T01:00:00.000Z';
const VALID_UNTIL = '2026-08-12T02:00:00.000Z';
const REGISTRY_CHECKSUM = 'a'.repeat(64);
const NATIVE_CHECKSUM = 'b'.repeat(64);
const CONTROL_TOKEN = 'node-control-secret-never-report-123456789';
const RUNTIME_ENDPOINT = 'http://192.168.1.7:19100/mcp';

const TOOL_NAMES = Object.freeze([
  'vehicle_area_recon',
  'vehicle_control_gimbal',
  'vehicle_emergency_stop',
  'vehicle_fire_weapon',
  'vehicle_get_capabilities',
  'vehicle_get_payload_status',
  'vehicle_get_state',
  'vehicle_get_targets',
  'vehicle_laser_range',
  'vehicle_navigate',
  'vehicle_track_target',
] as const satisfies readonly UgvToolName[]);

describe('UGV SMPP Provider materialization wrapper', () => {
  it('materializes the exact 11-tool Catalog without any Tool call and classifies fire as forbidden', async () => {
    const api = new FakeApis();

    const report = await materializeUgvSmppProvider(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(report).toMatchObject({
      status: 'passed',
      provider: {
        action: 'created',
        runtimeAction: 'registered',
        bindingRevision: 1,
        runtimeToolRevision: 1,
        credentialRotation: 'not_applicable',
      },
      catalog: {
        expectedToolCount: 11,
        materializedToolCount: 11,
        reviewedToolPolicy: true,
        allExecutionSemanticsExplicit: true,
        physicalToolInvocationCount: 0,
      },
      firePolicy: {
        discoveredAndClassified: true,
        executionAuthorized: false,
        capabilityCreationAuthority: 'none',
      },
      authentication: { runtimeMode: 'none', implicitFallback: false },
      redaction: {
        secretsIncluded: false,
        credentialReferencesIncluded: false,
        endpointsIncluded: false,
        entityIdsIncluded: true,
      },
    });
    expect(report.provider.tools.map(({ toolName }) => toolName)).toEqual([...TOOL_NAMES].sort());
    expect(
      report.provider.tools.find(({ toolName }) => toolName === 'vehicle_fire_weapon'),
    ).toMatchObject({
      effect: 'side_effecting',
      taskBehavior: 'task_required',
      executionSemanticsSource: 'admin_override',
    });
    expect(api.commands).toEqual([
      'runtime:register',
      ...TOOL_NAMES.map((toolName) => `runtime:semantics:${toolName}`),
      'control:import',
    ]);
    expect(api.toolCallCount).toBe(0);
    expect(api.registrationCredentialHeaders).toEqual({});
    expect(api.requests.every(({ redirect }) => redirect === 'manual')).toBe(true);
    const serialized = JSON.stringify(report);
    for (const forbidden of [
      CONTROL_TOKEN,
      RUNTIME_ENDPOINT,
      'unauthenticated://none',
      'http://127.0.0.1:10080',
      'http://127.0.0.1:9998',
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it('reuses an exact already-governed 11-tool Catalog without semantics writes', async () => {
    const api = new FakeApis({ existing: true, governed: true });

    const report = await materializeUgvSmppProvider(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(report.provider).toMatchObject({
      action: 'reconciled',
      runtimeAction: 'reused',
      bindingRevision: 1,
    });
    expect(api.commands).toEqual([]);
    expect(api.toolCallCount).toBe(0);
  });

  it('fails closed when the live Catalog omits fire or has an unreviewed extra Tool', async () => {
    for (const names of [
      TOOL_NAMES.filter((name) => name !== 'vehicle_fire_weapon'),
      [...TOOL_NAMES, 'vehicle_unreviewed_action'],
    ]) {
      const api = new FakeApis({ toolNames: names });
      await expect(
        materializeUgvSmppProvider(configuration(), { fetch: api.fetch, now: () => NOW }),
      ).rejects.toMatchObject({ code: 'CATALOG_TOOL_SET_MISMATCH' });
      expect(api.commands).toEqual(['runtime:register']);
      expect(api.toolCallCount).toBe(0);
    }
  });

  it('rejects any implicit or populated Runtime credential configuration', () => {
    const environment = deploymentEnvironment();
    expect(ugvSmppProviderMaterializationConfigurationFromEnvironment(environment)).toMatchObject({
      configuration: {
        runtimeCredentialRef: 'unauthenticated://none',
        localServerId: 'ugv-smpp-runtime',
        bindingId: 'mcp-binding-ugv-smpp',
      },
    });
    delete environment['SMPP_UGV_RUNTIME_CREDENTIAL_REF'];
    expect(() => ugvSmppProviderMaterializationConfigurationFromEnvironment(environment)).toThrow(
      expect.objectContaining({ code: 'DRIVER_CONFIGURATION_INVALID' }),
    );
    environment['SMPP_UGV_RUNTIME_CREDENTIAL_REF'] = 'secret://env/SMPP_UGV_RUNTIME_TOKEN';
    expect(() => ugvSmppProviderMaterializationConfigurationFromEnvironment(environment)).toThrow(
      expect.objectContaining({ code: 'UGV_RUNTIME_CREDENTIAL_MODE_UNSUPPORTED' }),
    );
    environment['SMPP_UGV_RUNTIME_CREDENTIAL_REF'] = 'unauthenticated://none';
    environment['SMPP_UGV_RUNTIME_TOKEN'] = 'dummy-must-be-rejected';
    expect(() => ugvSmppProviderMaterializationConfigurationFromEnvironment(environment)).toThrow(
      expect.objectContaining({ code: 'UGV_RUNTIME_CREDENTIAL_CONFIGURATION_CONFLICT' }),
    );
  });

  it('freezes a complete explicit reviewed policy for all 11 Tools', () => {
    expect(Object.keys(UGV_REVIEWED_TOOL_POLICY).sort()).toEqual([...TOOL_NAMES].sort());
    for (const name of TOOL_NAMES) {
      const policy = UGV_REVIEWED_TOOL_POLICY[name];
      expect(Object.values(policy.executionSemantics)).not.toContain('unknown');
      if (name.startsWith('vehicle_get_') || name === 'vehicle_laser_range')
        expect(policy).toMatchObject({
          taskBehavior: 'synchronous_only',
          executionSemantics: { effect: 'read_only', execution: 'synchronous' },
        });
      else
        expect(policy).toMatchObject({
          taskBehavior: 'task_required',
          executionSemantics: {
            effect: 'side_effecting',
            execution: 'task_required',
            replay: 'forbidden',
          },
        });
    }
  });
});

function configuration(): UgvSmppProviderMaterializationConfiguration {
  return {
    nodeControlBaseUrl: 'http://127.0.0.1:10080',
    nodeControlBearerToken: CONTROL_TOKEN,
    runtimeManagementBaseUrl: 'http://127.0.0.1:9998',
    smppSourceId: 'ugv-smpp',
    externalProviderId: 'isr.vehicle.ugv.ugv1',
    externalServerId: 'production-ugv-direct-1',
    localServerId: 'ugv-smpp-runtime',
    bindingId: 'mcp-binding-ugv-smpp',
    providerDisplayName: 'UGV SMPP Runtime',
    runtimeCredentialRef: 'unauthenticated://none',
    runId: 'ugv-provider-bootstrap-20260812',
  };
}

function deploymentEnvironment(): NodeJS.ProcessEnv {
  return {
    SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:10080',
    SDAR_CONTROL_API_TOKEN: CONTROL_TOKEN,
    SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL: 'http://127.0.0.1:9998',
    SMPP_SDAR_SOURCE_ID: 'ugv-smpp',
    SMPP_UGV_EXTERNAL_PROVIDER_ID: 'isr.vehicle.ugv.ugv1',
    SMPP_UGV_EXTERNAL_SERVER_ID: 'production-ugv-direct-1',
    SDAR_UGV_LOCAL_SERVER_ID: 'ugv-smpp-runtime',
    SDAR_UGV_BINDING_ID: 'mcp-binding-ugv-smpp',
    SDAR_UGV_PROVIDER_DISPLAY_NAME: 'UGV SMPP Runtime',
    SMPP_UGV_RUNTIME_CREDENTIAL_REF: 'unauthenticated://none',
    SDAR_UGV_BOOTSTRAP_RUN_ID: 'ugv-provider-bootstrap-20260812',
  };
}

class FakeApis {
  readonly requests: { url: string; redirect: RequestInit['redirect'] }[] = [];
  readonly commands: string[] = [];
  toolCallCount = 0;
  registrationCredentialHeaders: unknown;
  readonly #toolNames: readonly string[];
  #bindingRevision: number | undefined;
  #runtimeRevision: number | undefined;
  #governed: boolean;

  constructor(
    options: Readonly<{
      existing?: boolean;
      governed?: boolean;
      toolNames?: readonly string[];
    }> = {},
  ) {
    this.#toolNames = options.toolNames ?? TOOL_NAMES;
    this.#governed = options.governed ?? false;
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
      return json(200, { items: [candidate()] });
    if (url.pathname === '/api/v1/mcp/servers' && init?.method !== 'POST')
      return json(200, {
        items:
          this.#runtimeRevision === undefined
            ? []
            : [runtimeListedServer(this.#runtimeRevision, RUNTIME_ENDPOINT)],
      });
    if (url.pathname === '/api/v1/mcp/servers' && init?.method === 'POST') {
      this.#runtimeRevision = 1;
      const body = parsedBody(init);
      this.registrationCredentialHeaders = body['credentialHeaders'];
      this.commands.push('runtime:register');
      return json(201, this.runtimeResult(1));
    }
    if (url.pathname.endsWith('/execution-semantics') && init?.method === 'PUT') {
      const toolName = decodeURIComponent(url.pathname.split('/').at(-2) ?? '');
      this.commands.push(`runtime:semantics:${toolName}`);
      if (this.commands.filter((command) => command.startsWith('runtime:semantics:')).length === 11)
        this.#governed = true;
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/tools')) return json(200, { items: this.runtimeTools() });
    if (url.pathname.includes('/tools/call')) {
      this.toolCallCount += 1;
      return json(500, { code: 'PHYSICAL_TOOL_CALL_FORBIDDEN' });
    }
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
      this.commands.push('control:refresh');
      return json(202, { status: 'succeeded' });
    }
    if (url.pathname.includes('/mcp-provider-bindings/'))
      return this.#bindingRevision === undefined
        ? json(404, { code: 'MCP_PROVIDER_BINDING_NOT_FOUND' })
        : json(200, this.binding(this.#bindingRevision));
    return json(500, { code: 'UNEXPECTED_FAKE_ROUTE' });
  };

  private runtimeTools() {
    return this.#toolNames.map((toolName) => runtimeTool(toolName, this.#governed));
  }

  private runtimeResult(revision: number) {
    return runtimeResult(revision, this.runtimeTools());
  }

  private binding(revision: number) {
    return {
      bindingId: 'mcp-binding-ugv-smpp',
      localServerId: 'ugv-smpp-runtime',
      originType: 'smpp_registry',
      smppSourceId: 'ugv-smpp',
      externalProviderId: 'isr.vehicle.ugv.ugv1',
      externalServerId: 'production-ugv-direct-1',
      registryRevision: 7,
      registryChecksum: REGISTRY_CHECKSUM,
      catalogRevision: `1.0.0:${String(revision)}`,
      catalogChecksum: catalogChecksum(this.runtimeTools()),
      endpointRef: RUNTIME_ENDPOINT,
      status: 'active',
      availabilityStatus: 'available',
      revision,
      availabilityValidUntil: VALID_UNTIL,
      catalogObservedAt: NOW,
      operationCount: 11,
    };
  }
}

function candidate() {
  return {
    smppSourceId: 'ugv-smpp',
    externalProviderId: 'isr.vehicle.ugv.ugv1',
    externalServerId: 'production-ugv-direct-1',
    compositeIdentity: 'ugv-smpp::isr.vehicle.ugv.ugv1::production-ugv-direct-1',
    serverEndpoint: RUNTIME_ENDPOINT,
    catalogRevision: '1',
    labels: { environment: 'production', protocolMode: 'frozen_v1' },
    registryRevision: 7,
    registryChecksum: REGISTRY_CHECKSUM,
    registryEtag: `"${REGISTRY_CHECKSUM}"`,
    registryValidUntil: VALID_UNTIL,
    nativeRegistryRevision: 31,
    nativeRegistryChecksum: NATIVE_CHECKSUM,
    registryProjectionContract: 'sdar-registry-v1',
  };
}

function runtimeTool(toolName: string, governed: boolean) {
  const reviewed = Object.hasOwn(UGV_REVIEWED_TOOL_POLICY, toolName)
    ? UGV_REVIEWED_TOOL_POLICY[toolName as UgvToolName]
    : undefined;
  const readOnly = toolName.startsWith('vehicle_get_') || toolName === 'vehicle_laser_range';
  const taskBehavior = readOnly ? 'synchronous_only' : 'task_required';
  const executionSemantics =
    governed && reviewed !== undefined
      ? { ...reviewed.executionSemantics, source: 'admin_override' }
      : {
          effect: 'unknown',
          execution: 'unknown',
          cancellation: 'unknown',
          idempotency: 'unknown',
          replay: 'unknown',
          source: 'default_unknown',
        };
  return {
    serverId: 'ugv-smpp-runtime',
    toolName,
    description: `Reviewed ${toolName} contract.`,
    inputSchema: {
      type: 'object',
      properties: { resourceId: { const: 'vehicle:ugv1' } },
      required: ['resourceId'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    protocolMode: 'frozen_v1',
    executionSemantics,
    taskExecutionProfile: {
      profileVersion: '1.0',
      taskBehavior,
      availability: readOnly ? 'not_supported' : 'dynamic',
      supportsScheduling: !readOnly,
      supportsMaxElapsed: !readOnly,
      supportsObservations: !readOnly,
      supportsInputRequired: toolName === 'vehicle_fire_weapon',
      idempotency: 'server_managed',
    },
  };
}

function runtimeResult(revision: number, tools: readonly ReturnType<typeof runtimeTool>[]) {
  return {
    server: {
      serverId: 'ugv-smpp-runtime',
      name: 'UGV SMPP Runtime',
      endpoint: RUNTIME_ENDPOINT,
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
  const current = runtimeResult(revision, []);
  return { ...current.server, endpoint, currentDiscovery: current.snapshot };
}

function catalogChecksum(tools: readonly ReturnType<typeof runtimeTool>[]): string {
  const current = runtimeResult(1, tools);
  return hashConfigurationRequest(
    JSON.parse(
      JSON.stringify({
        protocolVersion: current.snapshot.protocolVersion,
        serverInfo: current.snapshot.serverInfo,
        tools: [...current.tools]
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
