import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { deriveFrozenMcpCatalogAuthority } from '../../../packages/domain/src/index.js';
import {
  nodeCapabilityEtag,
  smppSourceEtag,
  type NodeCapabilityDefinitionVersion,
  type SmppRegistrySource,
} from '../../../packages/node-control-domain/src/index.js';

import {
  UGV_B02_READINESS_RUNWAY_MS,
  UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS,
  UGV_B02_SOURCE_AUTHORITY_RUNWAY_MS,
  assertUgvB02AuthorityRunway,
  createUgvB02AuthorityGatePrivateReport,
  waitForUgvB02AuthorityRunway,
} from '../src/ugv-agent-profile-b02-authority-gate.js';

const NOW = '2026-08-21T12:00:00.000Z';
const CHECKSUM_A = '8f306467c14842c1ee612da9b831f4b48ec28f844a9c53a7111a0315e74ca429';
const CHECKSUM_B = 'b'.repeat(64);
const SERVER_ID = 'ugv-smpp-uap-p3-b01';

describe('UAP-P3-B02 authority runway gate', () => {
  it('freezes the layered budgets and accepts every exact inclusive TTL boundary', async () => {
    expect(UGV_B02_SOURCE_AUTHORITY_RUNWAY_MS).toBe(240_000);
    expect(UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS).toBe(1_200_000);
    expect(UGV_B02_READINESS_RUNWAY_MS).toBe(30_000);
    const authority = fixture();
    const now = vi.fn(() => NOW);
    const result = await assertUgvB02AuthorityRunway(configuration(), {
      fetch: authority.fetch,
      now,
    });
    expect(result).toEqual({
      status: 'ready',
      observedAt: NOW,
      minimumRemainingTtlMs: {
        source: 240_000,
        binding: 1_200_000,
        runtimeDiscovery: 1_200_000,
        readiness: 30_000,
      },
      budgetsMs: {
        source: 240_000,
        binding: 1_200_000,
        runtimeDiscovery: 1_200_000,
        readiness: 30_000,
      },
      secretsIncluded: false,
      endpointsIncluded: false,
    });
    expect(now).toHaveBeenCalledTimes(1);
    expect(authority.requests).toHaveLength(6);
    expect(authority.requests.every(({ init }) => init.method === 'GET')).toBe(true);
    expect(authority.requests.every(({ init }) => init.redirect === 'manual')).toBe(true);
    expect(authority.requests.filter(({ url }) => url.includes('/api/v1/mcp/servers'))).toSatisfy(
      (requests: typeof authority.requests) =>
        requests.every(({ init }) => new Headers(init.headers).get('authorization') === null),
    );
    expect(
      new Headers(
        authority.requests.find(({ url }) => url.includes('/internal/v1/'))?.init.headers,
      ).get('authorization'),
    ).toBe('Bearer runtime-control-service-token');
    expect(
      authority.requests
        .filter(
          ({ url }) =>
            url.includes('/smpp-sources/') ||
            url.includes('/capability-readiness/') ||
            url.includes('/node-capabilities/'),
        )
        .every(
          ({ init }) =>
            new Headers(init.headers).get('authorization') === 'Bearer node-control-api-token',
        ),
    ).toBe(true);

    const simulationId = 'uap-p3-b02-authority-gate-test-0001';
    const simulationHash = createHash('sha256').update(simulationId).digest('hex');
    const admissionKey = `uap-p3-b02-a2a-${simulationHash}`;
    const report = createUgvB02AuthorityGatePrivateReport(simulationId, admissionKey, result);
    expect(report).toEqual({
      schemaVersion: 'sdar.ugv-agent-profile.b02-authority-gate/v1',
      status: 'passed',
      task: 'UAP-P3-B02',
      simulationIdSha256: `sha256:${simulationHash}`,
      admissionIdempotencyKeySha256: `sha256:${createHash('sha256')
        .update(admissionKey)
        .digest('hex')}`,
      observedAt: NOW,
      budgetsMs: result.budgetsMs,
      minimumRemainingTtlMs: result.minimumRemainingTtlMs,
      etagChecks: [
        'source_strong_etag_body_contract_valid',
        'capability_strong_etag_body_contract_valid',
        'readiness_strong_etag_canonical_body_hash_valid',
      ],
      authorityChecks: [
        'source_binding_candidate_lineage_exact',
        'runtime_discovery_catalog_exact',
        'capability_provider_policy_exact',
        'readiness_implementation_partition_exact',
        'same_round_observed_at',
      ],
      redaction: { secretsIncluded: false, endpointsIncluded: false, entityIdsIncluded: false },
    });
    expect(JSON.stringify(report)).not.toContain('token');
    expect(JSON.stringify(report)).not.toContain('http://');
  });

  it.each([
    [
      'Source',
      (value: AuthorityFixture) => {
        value.source.activeSnapshotValidUntil = instant(UGV_B02_SOURCE_AUTHORITY_RUNWAY_MS - 1);
      },
      'UGV_B02_SOURCE_TTL_INSUFFICIENT',
    ],
    [
      'Binding',
      (value: AuthorityFixture) => {
        value.binding.binding.availabilityValidUntil = instant(
          UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS - 1,
        );
      },
      'UGV_B02_BINDING_TTL_INSUFFICIENT',
    ],
    [
      'Runtime discovery',
      (value: AuthorityFixture) => {
        requiredServer(value).currentDiscovery.validUntil = instant(
          UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS - 1,
        );
      },
      'UGV_B02_RUNTIME_DISCOVERY_TTL_INSUFFICIENT',
    ],
  ] as const)('rejects %s at frozen budget minus one', async (_name, mutate, code) => {
    const authority = fixture();
    mutate(authority);
    await expect(
      assertUgvB02AuthorityRunway(configuration(), { fetch: authority.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code });
  });

  it('classifies readiness budget minus one as bounded auto-reconciliation only', async () => {
    const authority = fixture();
    authority.readiness.validUntil = instant(UGV_B02_READINESS_RUNWAY_MS - 1);
    await expect(
      assertUgvB02AuthorityRunway(configuration(), { fetch: authority.fetch, now: () => NOW }),
    ).rejects.toMatchObject({
      code: 'UGV_B02_READINESS_TTL_INSUFFICIENT',
      retryableReadiness: true,
    });
  });

  it.each([
    [
      'Source',
      (value: AuthorityFixture) => {
        value.source.registryEndpoint = 'http://127.0.0.1:18092/rogue';
      },
      'UGV_B02_SOURCE_BINDING_IDENTITY_DRIFT',
    ],
    [
      'Source configured TTL',
      (value: AuthorityFixture) => {
        value.source.snapshotTtlSeconds = 299;
      },
      'UGV_B02_SOURCE_BINDING_IDENTITY_DRIFT',
    ],
    [
      'Source-to-Binding dynamic registry checksum',
      (value: AuthorityFixture) => {
        value.source.activeSnapshotChecksum = 'c'.repeat(64);
      },
      'UGV_B02_SOURCE_BINDING_IDENTITY_DRIFT',
    ],
    [
      'Binding',
      (value: AuthorityFixture) => {
        value.binding.binding.providerId = 'isr.vehicle.ugv.rogue';
      },
      'UGV_B02_SOURCE_BINDING_IDENTITY_DRIFT',
    ],
    [
      'Runtime',
      (value: AuthorityFixture) => {
        requiredServer(value).endpoint = 'http://127.0.0.1:19132/mcp';
      },
      'UGV_B02_RUNTIME_DISCOVERY_IDENTITY_DRIFT',
    ],
    [
      'Capability',
      (value: AuthorityFixture) => {
        requiredConstraint(value)['catalogChecksum'] = 'c'.repeat(64);
      },
      'UGV_B02_CAPABILITY_AUTHORITY_DRIFT',
    ],
    [
      'readiness',
      (value: AuthorityFixture) => {
        value.readiness.availableImplementations = ['rogue-implementation'];
      },
      'UGV_B02_READINESS_IDENTITY_DRIFT',
    ],
  ] as const)('rejects exact %s identity drift', async (_name, mutate, code) => {
    const authority = fixture();
    mutate(authority);
    await expect(
      assertUgvB02AuthorityRunway(configuration(), { fetch: authority.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    ['Source', 'source', 'status'],
    ['Binding', 'binding', 'transport'],
    ['Runtime discovery', 'runtime', 'status'],
    ['Runtime tools', 'tools', 'transport'],
    ['readiness', 'readiness', 'status'],
    ['Capability', 'capability', 'transport'],
  ] as const)('fails closed on %s authority HTTP failure', async (_name, target, kind) => {
    const authority = fixture();
    authority.failure = kind;
    authority.failureTarget = target;
    await expect(
      assertUgvB02AuthorityRunway(configuration(), { fetch: authority.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'UGV_B02_AUTHORITY_HTTP_FAILED' });
  });

  it.each([
    [
      'Source',
      (value: AuthorityFixture) => {
        value.sourceEtagOverride = `"smpp-source:${'0'.repeat(64)}"`;
      },
      'UGV_B02_SOURCE_ETAG_MISMATCH',
    ],
    [
      'Capability',
      (value: AuthorityFixture) => {
        value.capabilityEtagOverride =
          '"node-capability:embodied.move:1:published:0000000000000000000000000000000000000000000000000000000000000000"';
      },
      'UGV_B02_CAPABILITY_ETAG_MISMATCH',
    ],
    [
      'readiness body',
      (value: AuthorityFixture) => {
        value.readinessEtagOverride = `"sha256:${'0'.repeat(64)}"`;
      },
      'UGV_B02_READINESS_ETAG_MISMATCH',
    ],
    [
      'readiness weak ETag',
      (value: AuthorityFixture) => {
        value.readinessEtagOverride = `W/"sha256:${'0'.repeat(64)}"`;
      },
      'UGV_B02_READINESS_ETAG_MISMATCH',
    ],
    [
      'missing Source',
      (value: AuthorityFixture) => {
        value.sourceEtagOverride = null;
      },
      'UGV_B02_SOURCE_ETAG_MISMATCH',
    ],
    [
      'missing Capability',
      (value: AuthorityFixture) => {
        value.capabilityEtagOverride = null;
      },
      'UGV_B02_CAPABILITY_ETAG_MISMATCH',
    ],
  ] as const)(
    'rejects a mismatched or non-strong %s authority ETag',
    async (_name, mutate, code) => {
      const authority = fixture();
      mutate(authority);
      await expect(
        assertUgvB02AuthorityRunway(configuration(), { fetch: authority.fetch, now: () => NOW }),
      ).rejects.toMatchObject({ code });
    },
  );

  it('polls only safely reconcilable readiness and re-proves all six GETs before success', async () => {
    const authority = fixture();
    authority.readinessSequence = [
      {
        ...authority.readiness,
        status: 'unavailable',
        reasons: [{ code: 'PROVIDER_NOT_READY', severity: 'blocking' }],
        availableImplementations: [],
        unavailableImplementations: ['capability-binding-embodied.move-v2'],
      },
      authority.readiness,
    ];
    const pause = vi.fn(() => Promise.resolve());
    await expect(
      waitForUgvB02AuthorityRunway(configuration(), {
        fetch: authority.fetch,
        now: () => NOW,
        pause,
      }),
    ).resolves.toMatchObject({ status: 'ready' });
    expect(pause).toHaveBeenCalledOnce();
    expect(authority.requests).toHaveLength(12);
  });

  it('revalidates readiness body against the strong ETag on every poll', async () => {
    const authority = fixture();
    authority.readinessSequence = [
      {
        ...authority.readiness,
        status: 'unavailable',
        reasons: [{ code: 'PROVIDER_NOT_READY', severity: 'blocking' }],
        availableImplementations: [],
        unavailableImplementations: ['capability-binding-embodied.move-v2'],
      },
      authority.readiness,
    ];
    const pause = vi.fn(() => {
      authority.readinessEtagOverride = `"sha256:${'0'.repeat(64)}"`;
      return Promise.resolve();
    });
    await expect(
      waitForUgvB02AuthorityRunway(configuration(), {
        fetch: authority.fetch,
        now: () => NOW,
        pause,
      }),
    ).rejects.toMatchObject({ code: 'UGV_B02_READINESS_ETAG_MISMATCH' });
    expect(pause).toHaveBeenCalledOnce();
    expect(authority.requests).toHaveLength(12);
  });

  it('never polls a malformed readiness partition', async () => {
    const authority = fixture();
    authority.readiness.status = 'unavailable';
    authority.readiness.reasons = [];
    const pause = vi.fn(() => Promise.resolve());
    await expect(
      waitForUgvB02AuthorityRunway(configuration(), {
        fetch: authority.fetch,
        now: () => NOW,
        pause,
      }),
    ).rejects.toMatchObject({ code: 'UGV_B02_READINESS_IDENTITY_DRIFT' });
    expect(pause).not.toHaveBeenCalled();
    expect(authority.requests).toHaveLength(6);
  });

  it('fails after the frozen 30-second readiness window without another authority round', async () => {
    const authority = fixture();
    authority.readiness.validUntil = instant(UGV_B02_READINESS_RUNWAY_MS - 1);
    const clock = [NOW, NOW, instant(30_000)];
    const now = vi.fn(() => clock.shift() ?? instant(30_000));
    const pause = vi.fn(() => Promise.resolve());
    await expect(
      waitForUgvB02AuthorityRunway(configuration(), { fetch: authority.fetch, now, pause }),
    ).rejects.toMatchObject({ code: 'UGV_B02_READINESS_RUNWAY_TIMEOUT' });
    expect(authority.requests).toHaveLength(6);
    expect(pause).not.toHaveBeenCalled();
  });
});

function configuration() {
  return {
    nodeControlBaseUrl: 'http://127.0.0.1:10091',
    runtimeManagementBaseUrl: 'http://127.0.0.1:10998',
    nodeControlBearerToken: 'node-control-api-token',
    runtimeControlBearerToken: 'runtime-control-service-token',
  };
}

type JsonRecord = Record<string, unknown>;
interface MutableSource extends JsonRecord {
  activeSnapshotChecksum: string;
  activeSnapshotValidUntil: string;
  registryEndpoint: string;
  snapshotTtlSeconds: number;
}
interface MutableBindingBody extends JsonRecord {
  availabilityValidUntil: string;
  providerId: string;
}
interface MutableBinding extends JsonRecord {
  binding: MutableBindingBody;
}
interface MutableDiscovery extends JsonRecord {
  validUntil: string;
}
interface MutableServer extends JsonRecord {
  endpoint: string;
  currentDiscovery: MutableDiscovery;
}
interface MutableReadiness extends JsonRecord {
  status: string;
  validUntil: string;
  reasons: JsonRecord[];
  availableImplementations: string[];
  unavailableImplementations: string[];
}
interface MutableCapability extends JsonRecord {
  constraints: JsonRecord[];
}
interface AuthorityFixture {
  source: MutableSource;
  binding: MutableBinding;
  servers: { items: MutableServer[] };
  tools: { items: ReturnType<typeof tool>[] };
  readiness: MutableReadiness;
  capability: MutableCapability;
  requests: { url: string; init: RequestInit }[];
  fetch: typeof fetch;
  failure?: 'status' | 'transport';
  failureTarget?: AuthorityTarget;
  readinessSequence?: MutableReadiness[];
  sourceEtagOverride?: string | null;
  capabilityEtagOverride?: string | null;
  readinessEtagOverride?: string | null;
}

function fixture(): AuthorityFixture {
  const tools = toolNames().map((toolName) => tool(toolName));
  const discovery = {
    snapshotId: 'snapshot-1',
    serverId: SERVER_ID,
    protocolMode: 'frozen_v1' as const,
    protocolVersion: '2026-07-28',
    baselineSha256: CHECKSUM_B,
    supportedVersions: ['2026-07-28'],
    capabilities: { extensions: { 'io.sdar/tasks': {} } },
    serverInfo: { name: 'UGV Runtime', version: '2.0.0-rc.1' },
    providerCatalog: {
      providerId: 'isr.vehicle.ugv.ugv1',
      providerType: 'isr.vehicle.ugv',
      providerVersion: '1.0.0',
      manifestHash: 'c'.repeat(64),
    },
    taskNotifications: true,
    discoveredAt: instant(-1_000),
    validUntil: instant(UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS),
    toolRevision: 1,
  };
  const catalog = deriveFrozenMcpCatalogAuthority(discovery, tools, 1);
  const value: AuthorityFixture = {
    source: {
      smppSourceId: 'smpp-source-ugv1-uap-p3-b01',
      name: 'UGV Profile Source',
      registryEndpoint:
        'http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/smpp-source-ugv1-uap-p3-b01/latest',
      credentialRef: 'unauthenticated://none',
      environment: 'simulation',
      syncMode: 'manual',
      snapshotTtlSeconds: 300,
      lkgPolicy: 'deny_when_unavailable',
      status: 'active',
      activeSnapshotRevision: 1,
      activeSnapshotChecksum: CHECKSUM_A,
      activeSnapshotValidUntil: instant(UGV_B02_SOURCE_AUTHORITY_RUNWAY_MS),
      lastSyncAt: instant(-1_000),
      revision: 1,
    },
    binding: {
      observedAt: NOW,
      binding: {
        bindingId: 'ugv-smpp-uap-p3-b01-binding',
        revision: 1,
        localServerId: SERVER_ID,
        originType: 'smpp_registry',
        providerId: 'isr.vehicle.ugv.ugv1',
        externalProviderId: 'isr.vehicle.ugv.ugv1',
        externalServerId: 'uap-p3-b01-runtime-1',
        registryRevision: 1,
        registryChecksum: CHECKSUM_A,
        catalogRevision: catalog.catalogRevision,
        catalogChecksum: catalog.catalogChecksum,
        endpointRef: 'http://127.0.0.1:19131/mcp',
        availabilityValidUntil: instant(UGV_B02_RUNTIME_AUTHORITY_RUNWAY_MS),
        catalogObservedAt: instant(-1_000),
        operationCount: tools.length,
      },
      sourceCandidateLineage: {
        smppSourceId: 'smpp-source-ugv1-uap-p3-b01',
        externalProviderId: 'isr.vehicle.ugv.ugv1',
        externalServerId: 'uap-p3-b01-runtime-1',
        registryRevision: 1,
        registryChecksum: CHECKSUM_A,
        nativeRevision: 1,
        nativeChecksum: 'd'.repeat(64),
        projectionContract: 'sdar-registry-v1',
        candidateEndpoint: 'http://127.0.0.1:19131/mcp',
      },
    },
    servers: {
      items: [
        {
          serverId: SERVER_ID,
          name: 'UGV Profile Runtime',
          endpoint: 'http://127.0.0.1:19131/mcp',
          transport: 'streamable_http',
          status: 'enabled',
          toolRevision: 1,
          protocolMode: 'frozen_v1',
          currentProtocolSnapshotId: 'snapshot-1',
          createdAt: instant(-2_000),
          updatedAt: instant(-1_000),
          currentDiscovery: discovery,
        },
      ],
    },
    tools: { items: tools },
    readiness: {
      capabilityId: 'embodied.move',
      capabilityVersion: 2,
      snapshotVersion: 4,
      status: 'available',
      evaluatedAt: instant(-1_000),
      validUntil: instant(UGV_B02_READINESS_RUNWAY_MS),
      catalogHash: `sha256:${'e'.repeat(64)}`,
      policyHash: `sha256:${'f'.repeat(64)}`,
      reasons: [],
      availableImplementations: ['capability-binding-embodied.move-v2'],
      unavailableImplementations: [],
    },
    capability: {
      capabilityId: 'embodied.move',
      version: 2,
      domain: 'embodied',
      name: 'Move UGV',
      description: 'Move the exact simulated UGV with terminal position evidence.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      successCriteria: [{ type: 'output_schema_valid', required: true }],
      requiredEvidence: [{ type: 'required_evidence', required: true }],
      effects: ['effect.final_position'],
      artifacts: [],
      supportedModes: ['plan_confirmed', 'remote_task'],
      riskLevel: 'high',
      status: 'published',
      definitionHash: 'fa61f8173e148a6c3cdbb67bb97e00854490447dea225a6b4168988e4cce5c84',
      constraints: [
        {
          type: 'provider_binding_policy',
          mcpProviderBindingId: 'ugv-smpp-uap-p3-b01-binding',
          localServerId: SERVER_ID,
          mcpToolName: 'vehicle_navigate',
          bindingRevision: 1,
          catalogRevision: catalog.catalogRevision,
          catalogChecksum: catalog.catalogChecksum,
          requiredStatus: 'active',
          requiredAvailabilityStatus: 'available',
          requiredFreshness: 'unexpired',
          fallback: 'deny',
        },
        {
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
        },
      ],
    },
    requests: [],
    fetch: undefined as unknown as typeof fetch,
  };
  value.fetch = vi.fn<typeof fetch>((input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    value.requests.push({ url, init });
    const target = authorityTarget(url);
    if (value.failureTarget === target && value.failure === 'transport')
      return Promise.reject(new Error('injected transport failure'));
    if (value.failureTarget === target && value.failure === 'status')
      return Promise.resolve(json({ code: 'INJECTED' }, 503));
    if (url.includes('/smpp-sources/'))
      return Promise.resolve(
        json(
          value.source,
          200,
          selectedEtag(
            value.sourceEtagOverride,
            smppSourceEtag(value.source as unknown as SmppRegistrySource),
          ),
        ),
      );
    if (url.includes('/internal/v1/mcp-provider-bindings/current'))
      return Promise.resolve(json(value.binding));
    if (url.endsWith('/api/v1/mcp/servers')) return Promise.resolve(json(value.servers));
    if (url.includes(`/api/v1/mcp/servers/${SERVER_ID}/tools`))
      return Promise.resolve(json(value.tools));
    if (url.includes('/capability-readiness/')) {
      const readiness = value.readinessSequence?.shift() ?? value.readiness;
      return Promise.resolve(
        json(readiness, 200, selectedEtag(value.readinessEtagOverride, readinessEtag(readiness))),
      );
    }
    if (url.includes('/node-capabilities/'))
      return Promise.resolve(
        json(
          value.capability,
          200,
          selectedEtag(
            value.capabilityEtagOverride,
            nodeCapabilityEtag(value.capability as unknown as NodeCapabilityDefinitionVersion),
          ),
        ),
      );
    return Promise.reject(new Error(`unexpected authority URL: ${url}`));
  });
  return value;
}

function toolNames() {
  return [
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
  ];
}

function tool(toolName: string) {
  const navigate = toolName === 'vehicle_navigate';
  return {
    serverId: SERVER_ID,
    toolName,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    protocolMode: 'frozen_v1' as const,
    executionSemantics: navigate
      ? {
          effect: 'side_effecting' as const,
          execution: 'task_required' as const,
          cancellation: 'task_cancel' as const,
          idempotency: 'server_managed' as const,
          replay: 'simulation_only' as const,
          source: 'admin_override' as const,
        }
      : {
          effect: 'read_only' as const,
          execution: 'synchronous' as const,
          cancellation: 'unsupported' as const,
          idempotency: 'server_managed' as const,
          replay: 'allowed' as const,
          source: 'mcp_declared' as const,
        },
    taskExecutionProfile: {
      profileVersion: '1.0' as const,
      taskBehavior: navigate ? ('task_required' as const) : ('synchronous_only' as const),
      availability: 'dynamic' as const,
      supportsScheduling: navigate,
      supportsMaxElapsed: navigate,
      supportsCancellation: navigate,
      supportsPauseResume: navigate,
      supportsObservations: navigate,
      supportsInputRequired: false,
      idempotency: 'server_managed' as const,
    },
    discoveredAt: instant(-1_000),
  };
}

function instant(offsetMs: number) {
  return new Date(Date.parse(NOW) + offsetMs).toISOString();
}

function json(value: unknown, status = 200, etag?: string) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': status === 200 ? 'application/json' : 'application/problem+json',
      ...(etag === undefined ? {} : { etag }),
    },
  });
}

function readinessEtag(value: unknown): string {
  return `"sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}"`;
}

type AuthorityTarget = 'source' | 'binding' | 'runtime' | 'tools' | 'readiness' | 'capability';

function authorityTarget(url: string): AuthorityTarget {
  if (url.includes('/smpp-sources/')) return 'source';
  if (url.includes('/internal/v1/mcp-provider-bindings/current')) return 'binding';
  if (url.endsWith('/api/v1/mcp/servers')) return 'runtime';
  if (url.includes(`/api/v1/mcp/servers/${SERVER_ID}/tools`)) return 'tools';
  if (url.includes('/capability-readiness/')) return 'readiness';
  if (url.includes('/node-capabilities/')) return 'capability';
  throw new Error(`unexpected authority URL: ${url}`);
}

function selectedEtag(override: string | null | undefined, fallback: string): string | undefined {
  return override === null ? undefined : (override ?? fallback);
}

function requiredServer(value: AuthorityFixture): MutableServer {
  const server = value.servers.items[0];
  if (server === undefined) throw new Error('missing fixture server');
  return server;
}

function requiredConstraint(value: AuthorityFixture): JsonRecord {
  const constraint = value.capability.constraints[0];
  if (constraint === undefined) throw new Error('missing fixture constraint');
  return constraint;
}
