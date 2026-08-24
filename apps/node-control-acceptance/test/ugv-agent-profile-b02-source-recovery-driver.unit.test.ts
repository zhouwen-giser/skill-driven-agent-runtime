import { describe, expect, it, vi } from 'vitest';

import { deriveFrozenMcpCatalogAuthority } from '../../../packages/domain/src/index.js';
import {
  recoverUgvB02SourceAuthority,
  ugvB02SourceRecoveryConfigurationFromEnvironment,
  verifyUgvB02SourceRecoveryReplayAuthority,
  type UgvB02SourceRecoveryConfiguration,
  type UgvB02SourceRecoveryDependencies,
} from '../src/ugv-agent-profile-b02-source-recovery-driver.js';
import type { UgvSmppSourceBootstrapReport } from '../src/ugv-smpp-source-bootstrap-driver.js';

const NOW = '2026-08-22T12:00:00.000Z';
const SOURCE_CHECKSUM = '8f306467c14842c1ee612da9b831f4b48ec28f844a9c53a7111a0315e74ca429';
const NATIVE_CHECKSUM = 'd'.repeat(64);
const ATTEMPT_HASH = `sha256:${'a'.repeat(64)}`;
const ATTEMPT_ID = 'uap-p3-b02-recoveryunit0001';
const PREDECESSOR_ID = 'uap-p3-b02-predecessorunit01';
const SERVER_ID = 'ugv-smpp-uap-p3-b01';

describe('UAP-P3-B02 Source recovery driver', () => {
  it('returns not_required with formal identity and NO capture but zero Source POST', async () => {
    const authority = fixture(270_000);
    const dependencies = recoveryDependencies(authority);

    await expect(
      recoverUgvB02SourceAuthority(configuration(), dependencies),
    ).resolves.toMatchObject({
      status: 'passed',
      action: 'not_required',
      source: { remainingTtlMsBefore: 270_000 },
    });

    expect(dependencies.validateIssuedAttemptIdentity).toHaveBeenCalledWith(ATTEMPT_ID);
    expect(dependencies.captureSupervisorNo).toHaveBeenCalledOnce();
    expect(dependencies.bootstrapSource).not.toHaveBeenCalled();
    expect(authority.requests).toHaveLength(11);
    expect(authority.requests.every(({ init }) => init.method === 'GET')).toBe(true);
  });

  it.each([269_999, 260_561, 0])(
    'uses the formal bootstrap once and preserves every frozen authority at Source runway %i',
    async (runway) => {
      const authority = fixture(runway);
      const dependencies = recoveryDependencies(authority, true);

      const report = await recoverUgvB02SourceAuthority(configuration(), dependencies);

      expect(report).toMatchObject({
        status: 'passed',
        action: 'refreshed',
        source: {
          remainingTtlMsBefore: Math.max(0, runway),
          syncOutcome: 'not_modified',
          validUntilAfter: instant(300_000),
        },
      });
      expect(dependencies.captureSupervisorNo).toHaveBeenCalledOnce();
      expect(dependencies.bootstrapSource).toHaveBeenCalledOnce();
      expect(dependencies.bootstrapSource).toHaveBeenCalledWith(
        expect.objectContaining({
          snapshotTtlSeconds: 300,
          runId: `uap-b02-source-recovery-${'a'.repeat(32)}`,
        }),
        expect.objectContaining({ fetch: authority.fetch }),
      );
      expect(authority.requests).toHaveLength(22);
      expect(authority.requests.every(({ init }) => init.method === 'GET')).toBe(true);
      expect(authority.candidateEmptyReads).toBe(runway === 0 ? 1 : 0);
    },
  );

  it('re-enters the same issued identity after refresh with total bootstrap count one', async () => {
    const authority = fixture(1);
    const dependencies = recoveryDependencies(authority, true);

    await expect(
      recoverUgvB02SourceAuthority(configuration(), dependencies),
    ).resolves.toMatchObject({ action: 'refreshed' });
    await expect(
      recoverUgvB02SourceAuthority(configuration(), dependencies),
    ).resolves.toMatchObject({ action: 'not_required' });

    expect(dependencies.bootstrapSource).toHaveBeenCalledOnce();
    expect(dependencies.validateIssuedAttemptIdentity).toHaveBeenCalledTimes(2);
    expect(dependencies.captureSupervisorNo).toHaveBeenCalledTimes(2);
    expect(authority.requests).toHaveLength(33);
  });

  it('re-proves a persisted report with GETs only and blocks a shortened current Source authority', async () => {
    const authority = fixture(1);
    const dependencies = recoveryDependencies(authority, true);
    const report = await recoverUgvB02SourceAuthority(configuration(), dependencies);
    const requestsAfterRecovery = authority.requests.length;

    await expect(
      verifyUgvB02SourceRecoveryReplayAuthority(configuration(), report, {
        fetch: authority.fetch,
        now: () => NOW,
      }),
    ).resolves.toMatchObject({ status: 'current', action: 'refreshed' });
    expect(authority.requests.slice(requestsAfterRecovery)).toHaveLength(11);
    expect(
      authority.requests.slice(requestsAfterRecovery).every(({ init }) => init.method === 'GET'),
    ).toBe(true);
    expect(dependencies.bootstrapSource).toHaveBeenCalledOnce();

    authority.source.activeSnapshotValidUntil = instant(299_000);
    authority.candidate.registryValidUntil = instant(299_000);
    await expect(
      verifyUgvB02SourceRecoveryReplayAuthority(configuration(), report, {
        fetch: authority.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'UGV_B02_SOURCE_RECOVERY_REPLAY_AUTHORITY_DRIFT' });
    expect(dependencies.bootstrapSource).toHaveBeenCalledOnce();
  });

  it('allows readiness snapshot, status, and Catalog hash to reconcile after Source sync', async () => {
    const authority = fixture(1);
    authority.readinessSequence = [
      authority.readiness,
      {
        ...authority.readiness,
        snapshotVersion: 8,
        status: 'available',
        evaluatedAt: NOW,
        catalogHash: `sha256:${'9'.repeat(64)}`,
        reasons: [],
        availableImplementations: ['capability-binding-embodied.move-v2'],
        unavailableImplementations: [],
      },
    ];

    await expect(
      recoverUgvB02SourceAuthority(configuration(), recoveryDependencies(authority, true)),
    ).resolves.toMatchObject({
      action: 'refreshed',
      capability: { policyHash: `sha256:${'f'.repeat(64)}` },
    });
  });

  it('blocks a same-projection PMS native checksum drift before delegation and zero POST', async () => {
    const authority = fixture(1);
    authority.registryNativeChecksum = 'e'.repeat(64);
    const dependencies = recoveryDependencies(authority, true);

    await expect(recoverUgvB02SourceAuthority(configuration(), dependencies)).rejects.toMatchObject(
      { code: 'UGV_B02_SOURCE_RECOVERY_REGISTRY_DRIFT' },
    );
    expect(dependencies.captureSupervisorNo).toHaveBeenCalledOnce();
    expect(dependencies.bootstrapSource).not.toHaveBeenCalled();
    expect(authority.requests.every(({ init }) => init.method === 'GET')).toBe(true);
  });

  it.each([
    [
      'native revision',
      (value: AuthorityFixture) => {
        value.registryNativeRevision = 2;
      },
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_INVALID',
    ],
    [
      'native checksum contract',
      (value: AuthorityFixture) => {
        value.registryNativeChecksum = 'not-a-checksum';
      },
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_INVALID',
    ],
    [
      'Provider identity',
      (value: AuthorityFixture) => {
        requiredRegistryProvider(value)['externalProviderId'] = 'isr.vehicle.ugv.rogue';
      },
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_DRIFT',
    ],
    [
      'Provider endpoint',
      (value: AuthorityFixture) => {
        requiredRegistryProvider(value)['serverEndpoint'] = 'http://127.0.0.1:19132/mcp';
      },
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_DRIFT',
    ],
  ] as const)(
    'blocks expired-Source pre-sync %s drift with zero POST',
    async (_name, mutate, code) => {
      const authority = fixture(0);
      mutate(authority);
      const dependencies = recoveryDependencies(authority, true);

      await expect(
        recoverUgvB02SourceAuthority(configuration(), dependencies),
      ).rejects.toMatchObject({ code });
      expect(authority.candidateEmptyReads).toBe(1);
      expect(dependencies.bootstrapSource).not.toHaveBeenCalled();
      expect(authority.requests.every(({ init }) => init.method === 'GET')).toBe(true);
    },
  );

  it.each([
    [
      'Source lastSyncAt',
      (value: AuthorityFixture) => {
        value.source.lastSyncAt = instant(1);
        value.source.activeSnapshotValidUntil = instant(239_999);
        value.candidate.registryValidUntil = instant(239_999);
      },
      'UGV_B02_SOURCE_RECOVERY_SOURCE_DRIFT',
    ],
    [
      'Source validity interval',
      (value: AuthorityFixture) => {
        value.source.lastSyncAt = NOW;
        value.source.activeSnapshotValidUntil = NOW;
        value.candidate.registryValidUntil = NOW;
      },
      'UGV_B02_SOURCE_RECOVERY_SOURCE_DRIFT',
    ],
    [
      'Registry projection generatedAt',
      (value: AuthorityFixture) => {
        value.registry['generatedAt'] = instant(1);
      },
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_DRIFT',
    ],
    [
      'Registry projection validity interval',
      (value: AuthorityFixture) => {
        value.registry['generatedAt'] = instant(-1_000);
        value.registry['expiresAt'] = instant(-1_000);
      },
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_DRIFT',
    ],
    [
      'Runtime discovery discoveredAt',
      (value: AuthorityFixture) => {
        requiredServer(value).currentDiscovery['discoveredAt'] = instant(1);
      },
      'UGV_B02_SOURCE_RECOVERY_RUNTIME_DRIFT',
    ],
    [
      'Runtime discovery validity interval',
      (value: AuthorityFixture) => {
        requiredServer(value).currentDiscovery['discoveredAt'] = instant(-1_000);
        requiredServer(value).currentDiscovery.validUntil = instant(-1_000);
      },
      'UGV_B02_SOURCE_RECOVERY_RUNTIME_DRIFT',
    ],
    [
      'Capability readiness evaluatedAt',
      (value: AuthorityFixture) => {
        value.readiness['evaluatedAt'] = instant(1);
      },
      'UGV_B02_SOURCE_RECOVERY_CAPABILITY_DRIFT',
    ],
    [
      'Capability readiness validity interval',
      (value: AuthorityFixture) => {
        value.readiness['evaluatedAt'] = instant(-1_000);
        value.readiness['validUntil'] = instant(-1_000);
      },
      'UGV_B02_SOURCE_RECOVERY_CAPABILITY_DRIFT',
    ],
  ] as const)(
    'blocks future or inverted %s authority before Source POST',
    async (_name, mutate, code) => {
      const authority = fixture(1);
      mutate(authority);
      const dependencies = recoveryDependencies(authority, true);

      await expect(
        recoverUgvB02SourceAuthority(configuration(), dependencies),
      ).rejects.toMatchObject({ code });
      expect(dependencies.bootstrapSource).not.toHaveBeenCalled();
      expect(authority.requests.every(({ init }) => init.method === 'GET')).toBe(true);
    },
  );

  it.each(['binding', 'runtime'] as const)(
    'blocks insufficient 20-minute %s runway after NO capture and before Source POST',
    async (authorityName) => {
      const authority = fixture(1);
      if (authorityName === 'binding')
        authority.binding.availabilityValidUntil = instant(1_199_999);
      else requiredServer(authority).currentDiscovery.validUntil = instant(1_199_999);
      const dependencies = recoveryDependencies(authority, true);

      await expect(
        recoverUgvB02SourceAuthority(configuration(), dependencies),
      ).rejects.toMatchObject({
        code: 'UGV_B02_SOURCE_RECOVERY_RUNTIME_RUNWAY_INSUFFICIENT',
      });
      expect(dependencies.captureSupervisorNo).toHaveBeenCalledOnce();
      expect(dependencies.bootstrapSource).not.toHaveBeenCalled();
    },
  );

  it('rejects a Registry 304 without attempting bootstrap', async () => {
    const authority = fixture(0);
    authority.registryStatus = 304;
    const dependencies = recoveryDependencies(authority, true);

    await expect(recoverUgvB02SourceAuthority(configuration(), dependencies)).rejects.toMatchObject(
      {
        code: 'UGV_B02_SOURCE_RECOVERY_REGISTRY_FULL_SNAPSHOT_REQUIRED',
      },
    );
    expect(dependencies.bootstrapSource).not.toHaveBeenCalled();
  });

  it('requires an exact issued identity before any authority read', async () => {
    const authority = fixture(1);
    const dependencies = recoveryDependencies(authority, true);
    vi.mocked(dependencies.validateIssuedAttemptIdentity).mockResolvedValue({
      kind: 'initial_reserved',
      simulationId: ATTEMPT_ID,
    });

    await expect(recoverUgvB02SourceAuthority(configuration(), dependencies)).rejects.toMatchObject(
      { code: 'UGV_B02_SOURCE_RECOVERY_ATTEMPT_NOT_AUTHORIZED' },
    );
    expect(authority.requests).toHaveLength(0);
    expect(dependencies.captureSupervisorNo).not.toHaveBeenCalled();
    expect(dependencies.bootstrapSource).not.toHaveBeenCalled();
  });

  it('requires an exact supervisor NO capture before bootstrap', async () => {
    const authority = fixture(1);
    const dependencies = recoveryDependencies(authority, true);
    vi.mocked(dependencies.captureSupervisorNo).mockResolvedValue({
      ...supervisorNo(),
      sideEffects: 'YES',
      activeSimulationRunId: ATTEMPT_ID,
    });

    await expect(recoverUgvB02SourceAuthority(configuration(), dependencies)).rejects.toMatchObject(
      { code: 'UGV_B02_SOURCE_RECOVERY_SUPERVISOR_NOT_NO' },
    );
    expect(dependencies.bootstrapSource).not.toHaveBeenCalled();
    expect(authority.requests.every(({ init }) => init.method === 'GET')).toBe(true);
  });

  it('rejects a cross-generation supervisor NO capture before any authority GET or bootstrap', async () => {
    const authority = fixture(1);
    const dependencies = recoveryDependencies(authority, true);
    vi.mocked(dependencies.captureSupervisorNo).mockResolvedValue({
      ...supervisorNo(),
      bootstrapRunId: 'uap-p3-b01-different-bootstrap-generation',
    });

    await expect(recoverUgvB02SourceAuthority(configuration(), dependencies)).rejects.toMatchObject(
      { code: 'UGV_B02_SOURCE_RECOVERY_SUPERVISOR_NOT_NO' },
    );
    expect(authority.requests).toHaveLength(0);
    expect(dependencies.bootstrapSource).not.toHaveBeenCalled();
  });

  it('blocks an exact Capability Provider policy drift before Source POST', async () => {
    const authority = fixture(1);
    const policy = requiredProviderPolicy(authority);
    policy['fallback'] = 'allow';
    const dependencies = recoveryDependencies(authority, true);

    await expect(recoverUgvB02SourceAuthority(configuration(), dependencies)).rejects.toMatchObject(
      { code: 'UGV_B02_SOURCE_RECOVERY_CAPABILITY_DRIFT' },
    );
    expect(dependencies.captureSupervisorNo).toHaveBeenCalledOnce();
    expect(dependencies.bootstrapSource).not.toHaveBeenCalled();
  });

  it('does not retry an ambiguous formal bootstrap failure', async () => {
    const authority = fixture(1);
    const dependencies = recoveryDependencies(authority);
    const bootstrapSource = dependencies.bootstrapSource;
    if (bootstrapSource === undefined) throw new Error('fixture bootstrap dependency missing');
    vi.mocked(bootstrapSource).mockRejectedValue(new Error('ambiguous response'));

    await expect(recoverUgvB02SourceAuthority(configuration(), dependencies)).rejects.toMatchObject(
      { code: 'UGV_B02_SOURCE_RECOVERY_SYNC_FAILED' },
    );
    expect(dependencies.bootstrapSource).toHaveBeenCalledOnce();
  });

  it('accepts a refreshed Source with the 270-second pre-gate safety runway', async () => {
    const authority = fixture(1);
    const dependencies = recoveryDependencies(authority, true, 270_000);

    await expect(
      recoverUgvB02SourceAuthority(configuration(), dependencies),
    ).resolves.toMatchObject({
      action: 'refreshed',
      source: { validUntilAfter: instant(270_000) },
    });
    expect(dependencies.bootstrapSource).toHaveBeenCalledOnce();
  });

  it('rejects a refreshed Source one millisecond below the pre-gate safety runway', async () => {
    const authority = fixture(1);
    const dependencies = recoveryDependencies(authority, true, 269_999);

    await expect(recoverUgvB02SourceAuthority(configuration(), dependencies)).rejects.toMatchObject(
      { code: 'UGV_B02_SOURCE_RECOVERY_TTL_NOT_REFRESHED' },
    );
    expect(dependencies.bootstrapSource).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'Binding',
      (value: AuthorityFixture) => (value.postMutation = () => (value.binding.revision = 2)),
      'UGV_B02_SOURCE_RECOVERY_BINDING_DRIFT',
    ],
    [
      'Runtime',
      (value: AuthorityFixture) =>
        (value.postMutation = () =>
          (requiredServer(value).currentDiscovery.validUntil = instant(1_300_000))),
      'UGV_B02_SOURCE_RECOVERY_RUNTIME_MUTATED',
    ],
    [
      'Capability policy',
      (value: AuthorityFixture) =>
        (value.postMutation = () => (value.readiness.policyHash = `sha256:${'1'.repeat(64)}`)),
      'UGV_B02_SOURCE_RECOVERY_CAPABILITY_MUTATED',
    ],
    [
      'Candidate native lineage',
      (value: AuthorityFixture) =>
        (value.postMutation = () => (value.candidate.nativeRegistryChecksum = 'e'.repeat(64))),
      'UGV_B02_SOURCE_RECOVERY_REGISTRY_DRIFT',
    ],
  ] as const)('rejects post-sync %s mutation', async (_name, arrange, code) => {
    const authority = fixture(1);
    arrange(authority);
    const dependencies = recoveryDependencies(authority, true);
    await expect(recoverUgvB02SourceAuthority(configuration(), dependencies)).rejects.toMatchObject(
      { code },
    );
  });

  it('requires exact Source TTL 300 and rejects inherited side-effect authorization', async () => {
    const authority = fixture(1);
    const bad = configuration();
    bad.source.snapshotTtlSeconds = 299;
    const dependencies = recoveryDependencies(authority, true);
    await expect(recoverUgvB02SourceAuthority(bad, dependencies)).rejects.toMatchObject({
      code: 'UGV_B02_SOURCE_RECOVERY_CONFIGURATION_INVALID',
    });
    expect(dependencies.validateIssuedAttemptIdentity).not.toHaveBeenCalled();

    await expect(
      ugvB02SourceRecoveryConfigurationFromEnvironment({
        ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'YES',
      }),
    ).rejects.toMatchObject({
      code: 'UGV_B02_SOURCE_RECOVERY_SIDE_EFFECT_AUTHORITY_NOT_ISOLATED',
    });
  });
});

function configuration(): MutableConfiguration {
  return {
    nodeControlBaseUrl: 'http://127.0.0.1:10091',
    nodeControlAdminToken: 'node-control-api-token',
    runtimeManagementBaseUrl: 'http://127.0.0.1:10998',
    attemptId: ATTEMPT_ID,
    source: {
      smppSourceId: 'smpp-source-ugv1-uap-p3-b01',
      sourceName: 'UGV Profile Source',
      smppEnvironment: 'simulation',
      registryEndpoint:
        'http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/smpp-source-ugv1-uap-p3-b01/latest',
      registryCredentialRef: 'unauthenticated://none',
      syncMode: 'manual',
      snapshotTtlSeconds: 300,
      lkgPolicy: 'deny_when_unavailable',
      externalProviderId: 'isr.vehicle.ugv.ugv1',
      externalServerId: 'uap-p3-b01-runtime-1',
    },
    localServerId: SERVER_ID,
    providerBindingId: 'ugv-smpp-uap-p3-b01-binding',
  };
}

interface MutableConfiguration extends UgvB02SourceRecoveryConfiguration {
  source: UgvB02SourceRecoveryConfiguration['source'] & { snapshotTtlSeconds: number };
}

type JsonRecord = Record<string, unknown>;
interface MutableSource extends JsonRecord {
  activeSnapshotValidUntil: string;
  lastSyncAt: string;
}
interface MutableBinding extends JsonRecord {
  availabilityValidUntil: string;
  revision: number;
}
interface MutableDiscovery extends JsonRecord {
  validUntil: string;
}
interface MutableServer extends JsonRecord {
  currentDiscovery: MutableDiscovery;
}
interface MutableReadiness extends JsonRecord {
  policyHash: string;
}
interface MutableCandidate extends JsonRecord {
  registryValidUntil: string;
  nativeRegistryChecksum: string;
}
interface AuthorityFixture {
  source: MutableSource;
  binding: MutableBinding;
  servers: { items: MutableServer[] };
  tools: { items: ReturnType<typeof tool>[] };
  capability: JsonRecord;
  readiness: MutableReadiness;
  candidate: MutableCandidate;
  registry: JsonRecord;
  registryNativeChecksum: string;
  registryNativeRevision: number;
  registryStatus: number;
  requests: { url: string; init: RequestInit }[];
  fetch: typeof fetch;
  postMutation?: () => void;
  postPhase: boolean;
  candidateEmptyReads: number;
  readinessSequence?: MutableReadiness[];
}

function fixture(sourceRunway: number): AuthorityFixture {
  const tools = toolNames().map(tool);
  const discovery = {
    snapshotId: 'snapshot-1',
    serverId: SERVER_ID,
    protocolMode: 'frozen_v1' as const,
    protocolVersion: '2026-07-28',
    baselineSha256: 'b'.repeat(64),
    supportedVersions: ['2026-07-28'],
    capabilities: {
      extensions: {
        'io.sdar/tasks': {},
        'io.sdar/businessEvents': { authorizationModel: 'governed-runtime' },
      },
    },
    serverInfo: { name: 'UGV Runtime', version: '2.0.0-rc.1' },
    providerCatalog: {
      providerId: 'isr.vehicle.ugv.ugv1',
      providerType: 'isr.vehicle.ugv',
      providerVersion: '1.0.0',
      manifestHash: 'c'.repeat(64),
    },
    taskNotifications: true,
    discoveredAt: instant(-1_000),
    validUntil: instant(1_200_000),
    toolRevision: 1,
  };
  const catalog = deriveFrozenMcpCatalogAuthority(discovery, tools, 1);
  const providerPolicy = {
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
  };
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
      activeSnapshotChecksum: SOURCE_CHECKSUM,
      activeSnapshotValidUntil: instant(sourceRunway),
      lastSyncAt: instant(-1_000),
      revision: 1,
    },
    binding: {
      bindingId: 'ugv-smpp-uap-p3-b01-binding',
      localServerId: SERVER_ID,
      originType: 'smpp_registry',
      smppSourceId: 'smpp-source-ugv1-uap-p3-b01',
      externalProviderId: 'isr.vehicle.ugv.ugv1',
      externalServerId: 'uap-p3-b01-runtime-1',
      registryRevision: 1,
      registryChecksum: SOURCE_CHECKSUM,
      catalogRevision: catalog.catalogRevision,
      catalogChecksum: catalog.catalogChecksum,
      endpointRef: 'http://127.0.0.1:19131/mcp',
      status: 'active',
      availabilityStatus: 'available',
      availabilityValidUntil: instant(1_200_000),
      catalogObservedAt: instant(-1_000),
      operationCount: 10,
      revision: 1,
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
          currentDiscovery: discovery,
        },
      ],
    },
    tools: { items: tools },
    capability: {
      capabilityId: 'embodied.move',
      version: 2,
      domain: 'embodied',
      name: 'Move',
      description: 'Governed UGV movement.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      successCriteria: [{ type: 'position_reached' }],
      requiredEvidence: [{ type: 'final_position' }],
      constraints: [providerPolicy],
      riskLevel: 'high',
      status: 'published',
      definitionHash: 'fa61f8173e148a6c3cdbb67bb97e00854490447dea225a6b4168988e4cce5c84',
    },
    readiness: {
      capabilityId: 'embodied.move',
      capabilityVersion: 2,
      snapshotVersion: 7,
      status: 'unavailable',
      evaluatedAt: instant(-1_000),
      validUntil: instant(30_000),
      catalogHash: `sha256:${'e'.repeat(64)}`,
      policyHash: `sha256:${'f'.repeat(64)}`,
      reasons: [{ code: 'MCP_PROVIDER_BINDING_NOT_CURRENT' }],
      availableImplementations: [],
      unavailableImplementations: ['capability-binding-embodied.move-v2'],
    },
    candidate: {
      smppSourceId: 'smpp-source-ugv1-uap-p3-b01',
      externalProviderId: 'isr.vehicle.ugv.ugv1',
      externalServerId: 'uap-p3-b01-runtime-1',
      compositeIdentity:
        'smpp-source-ugv1-uap-p3-b01\u0000isr.vehicle.ugv.ugv1\u0000uap-p3-b01-runtime-1',
      serverEndpoint: 'http://127.0.0.1:19131/mcp',
      catalogRevision: '1',
      labels: { environment: 'simulation', protocolMode: 'frozen_v1' },
      registryRevision: 1,
      registryChecksum: SOURCE_CHECKSUM,
      registryEtag: `"${SOURCE_CHECKSUM}"`,
      registryValidUntil: instant(sourceRunway),
      nativeRegistryRevision: 1,
      nativeRegistryChecksum: NATIVE_CHECKSUM,
      registryProjectionContract: 'sdar-registry-v1',
    },
    registry: {
      revision: 1,
      checksum: SOURCE_CHECKSUM,
      generatedAt: instant(-1_000),
      expiresAt: instant(300_000),
      providers: [
        {
          externalProviderId: 'isr.vehicle.ugv.ugv1',
          externalServerId: 'uap-p3-b01-runtime-1',
          serverEndpoint: 'http://127.0.0.1:19131/mcp',
          catalogRevision: '1',
          labels: { environment: 'simulation', protocolMode: 'frozen_v1' },
        },
      ],
    },
    registryNativeChecksum: NATIVE_CHECKSUM,
    registryNativeRevision: 1,
    registryStatus: 200,
    requests: [],
    fetch: undefined as unknown as typeof fetch,
    postPhase: false,
    candidateEmptyReads: 0,
  };
  value.fetch = vi.fn<typeof fetch>((input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    value.requests.push({ url, init });
    if (value.postPhase && value.postMutation !== undefined) {
      const mutate = value.postMutation;
      delete value.postMutation;
      mutate();
    }
    if (url.includes('/api/v1/registry/simulation/consumers/'))
      return Promise.resolve(registryResponse(value));
    if (url.includes('/api/v1/smpp-sources?'))
      return Promise.resolve(json({ items: [value.source], totalEstimate: 1, asOf: NOW }));
    if (url.includes('/api/v1/smpp-sources/')) return Promise.resolve(json(value.source));
    if (url.includes('/api/v1/mcp-provider-bindings?'))
      return Promise.resolve(json({ items: [bindingInventory(value.binding)] }));
    if (url.includes('/api/v1/mcp-provider-bindings/')) return Promise.resolve(json(value.binding));
    if (url.includes(`/api/v1/mcp/servers/${SERVER_ID}/tools`))
      return Promise.resolve(json(value.tools));
    if (url.includes('/api/v1/mcp/servers?')) return Promise.resolve(json(value.servers));
    if (url.includes('/api/v1/node-capabilities?'))
      return Promise.resolve(json({ items: [value.capability] }));
    if (url.includes('/api/v1/node-capabilities/')) return Promise.resolve(json(value.capability));
    if (url.includes('/api/v1/capability-readiness/'))
      return Promise.resolve(json(value.readinessSequence?.shift() ?? value.readiness));
    if (url.includes('/api/v1/mcp-provider-candidates?'))
      if (
        !value.postPhase &&
        Date.parse(value.source.activeSnapshotValidUntil) <= Date.parse(NOW)
      ) {
        value.candidateEmptyReads += 1;
        return Promise.resolve(json({ items: [] }));
      } else return Promise.resolve(json({ items: [value.candidate] }));
    return Promise.reject(new Error(`unexpected recovery URL: ${url}`));
  });
  return value;
}

function recoveryDependencies(
  authority: AuthorityFixture,
  refresh = false,
  refreshedRunway = 300_000,
): UgvB02SourceRecoveryDependencies {
  return {
    fetch: authority.fetch,
    now: () => NOW,
    validateIssuedAttemptIdentity: vi.fn(() => Promise.resolve(attemptAuthorization())),
    captureSupervisorNo: vi.fn(() => Promise.resolve(supervisorNo())),
    bootstrapSource: vi.fn(() => {
      if (refresh) {
        authority.source.activeSnapshotValidUntil = instant(refreshedRunway);
        authority.source.lastSyncAt = NOW;
        authority.candidate.registryValidUntil = instant(refreshedRunway);
        authority.postPhase = true;
      }
      return Promise.resolve(bootstrapReport(refreshedRunway));
    }),
  };
}

function supervisorNo() {
  return {
    schemaVersion: 'sdar.ugv-agent-profile.host-process-status/v2',
    status: 'running',
    processCount: 3,
    sideEffects: 'NO',
    bootstrapRunId: 'uap-p3-b01-bootstrap-unit',
    manifestRevision: 1,
    activeSimulationRunId: null,
    processIdentitySha256: {
      server: `sha256:${'6'.repeat(64)}`,
      nodeControlApi: `sha256:${'7'.repeat(64)}`,
      nodeControlWorker: `sha256:${'8'.repeat(64)}`,
    },
  } as const;
}

function attemptAuthorization() {
  const record = {
    schemaVersion: 'sdar.ugv-agent-profile.b02-attempt-identity/v1',
    status: 'issued',
    task: 'UAP-P3-B02',
    bootstrapRunId: 'uap-p3-b01-bootstrap-unit',
    simulationId: ATTEMPT_ID,
    predecessorSimulationId: PREDECESSOR_ID,
    a2aIdempotencyKey: `uap-p3-b02-a2a-${'2'.repeat(64)}`,
    recordSha256: ATTEMPT_HASH,
  };
  return {
    schemaVersion: 'sdar.ugv-agent-profile.b02-attempt-authorization/v1',
    status: 'authorized',
    task: 'UAP-P3-B02',
    kind: 'recovery_issued',
    bootstrapRunId: record.bootstrapRunId,
    simulationId: record.simulationId,
    predecessorSimulationId: record.predecessorSimulationId,
    a2aIdempotencyKey: record.a2aIdempotencyKey,
    identityRecordPath: '/private/b02/attempt-identities/predecessor.json',
    identityRecordSha256: ATTEMPT_HASH,
    record,
  };
}

function bootstrapReport(refreshedRunway = 300_000): UgvSmppSourceBootstrapReport {
  return {
    schemaVersion: 'sdar.ugv-smpp-source-bootstrap/v1',
    status: 'passed',
    evidenceClass: 'real_public_api',
    observedAt: NOW,
    sourceAction: 'reused',
    sourceIdentitySha256: '3'.repeat(64),
    intendedTupleSha256: '4'.repeat(64),
    authenticationMode: 'none',
    sourceSyncMode: 'manual',
    sourceRevision: 1,
    snapshotRevision: 1,
    snapshotChecksum: SOURCE_CHECKSUM,
    snapshotValidUntil: instant(refreshedRunway),
    nativeRegistryRevision: 1,
    nativeRegistryChecksum: NATIVE_CHECKSUM,
    registryProjectionContract: 'sdar-registry-v1',
    candidateCount: 1,
    initialSyncOutcome: 'not_modified',
    conditionalSyncOutcome: 'not_modified',
    conditionalValidity: 'extended',
    checks: [],
    redaction: {
      secretsIncluded: false,
      credentialReferencesIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    },
  };
}

function bindingInventory(binding: MutableBinding): JsonRecord {
  const { availabilityValidUntil, catalogObservedAt, operationCount, ...inventory } = binding;
  void availabilityValidUntil;
  void catalogObservedAt;
  void operationCount;
  return inventory;
}

function registryResponse(value: AuthorityFixture): Response {
  if (value.registryStatus === 304) return new Response(null, { status: 304 });
  return new Response(JSON.stringify(value.registry), {
    status: value.registryStatus,
    headers: {
      'content-type': 'application/json',
      etag: `"${SOURCE_CHECKSUM}"`,
      'x-smpp-native-revision': String(value.registryNativeRevision),
      'x-smpp-native-checksum': value.registryNativeChecksum,
      'x-smpp-projection-contract': 'sdar-registry-v1',
    },
  });
}

function requiredServer(value: AuthorityFixture): MutableServer {
  const server = value.servers.items[0];
  if (server === undefined) throw new Error('fixture server missing');
  return server;
}

function requiredRegistryProvider(value: AuthorityFixture): JsonRecord {
  const providers = value.registry['providers'];
  if (!Array.isArray(providers) || providers.length !== 1)
    throw new Error('fixture Registry Provider missing');
  const provider = providers[0];
  if (typeof provider !== 'object' || provider === null || Array.isArray(provider))
    throw new Error('fixture Registry Provider invalid');
  return provider as JsonRecord;
}

function requiredProviderPolicy(value: AuthorityFixture): JsonRecord {
  const constraints = value.capability['constraints'];
  if (!Array.isArray(constraints) || constraints.length !== 1)
    throw new Error('fixture Provider policy missing');
  const policy = constraints[0];
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy))
    throw new Error('fixture Provider policy invalid');
  return policy as JsonRecord;
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

function instant(offsetMs: number): string {
  return new Date(Date.parse(NOW) + offsetMs).toISOString();
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
