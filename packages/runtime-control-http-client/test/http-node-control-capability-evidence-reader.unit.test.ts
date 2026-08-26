import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpNodeControlCapabilityEvidenceReader } from '../src/index.js';

describe('HttpNodeControlCapabilityEvidenceReader', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('authenticates, validates and maps full Control authority state', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      Response.json({
        observedAt: '2026-08-04T07:00:00.000Z',
        definition: {
          capabilityId: 'cap.inspect',
          version: 1,
          domain: 'embodied',
          name: 'Inspect',
          description: 'Inspect an area.',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          successCriteria: [],
          requiredEvidence: [],
          effects: [],
          artifacts: [],
          constraints: [],
          supportedModes: [],
          riskLevel: 'low',
          status: 'published',
          definitionHash: 'a'.repeat(64),
          createdAt: '2026-08-04T07:00:00.000Z',
          updatedAt: '2026-08-04T07:00:00.000Z',
        },
        implementationBindings: [
          {
            bindingId: 'binding-a',
            revision: 1,
            capabilityId: 'cap.inspect',
            capabilityVersion: 1,
            implementationType: 'skill',
            implementationId: 'skill.inspect',
            implementationVersion: '1',
            role: 'primary',
            priority: 0,
            status: 'active',
            createdAt: '2026-08-04T07:00:00.000Z',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const reader = new HttpNodeControlCapabilityEvidenceReader({
      baseUrl: 'https://control.example.test/',
      serviceToken: 's'.repeat(32),
    });

    await expect(reader.load('cap.inspect', 1)).resolves.toMatchObject({
      definition: { capability_id: 'cap.inspect', version: 1 },
      implementationBindings: [{ binding_id: 'binding-a', implementation_id: 'skill.inspect' }],
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://control.example.test/internal/v1/node-capabilities/cap.inspect/versions/1/authority',
      {
        headers: { authorization: `Bearer ${'s'.repeat(32)}` },
        redirect: 'manual',
      },
    );
  });

  it('maps current Node Control payloads that omit non-contract update and binding timestamps', async () => {
    const observedAt = '2026-08-12T06:20:17.275Z';
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      Response.json({
        observedAt,
        definition: {
          capabilityId: 'vehicle.ugv.read-state',
          version: 1,
          domain: 'vehicle.ugv',
          name: 'Read UGV state',
          description: 'Read one UGV state.',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          successCriteria: [],
          requiredEvidence: [],
          effects: [],
          artifacts: [],
          constraints: [],
          supportedModes: ['deterministic'],
          riskLevel: 'low',
          status: 'published',
          definitionHash: 'a'.repeat(64),
          createdAt: '2026-08-12T00:00:00.000Z',
        },
        implementationBindings: [
          {
            bindingId: 'capability-binding-vehicle.ugv.read-state-v1',
            revision: 1,
            capabilityId: 'vehicle.ugv.read-state',
            capabilityVersion: 1,
            implementationType: 'skill',
            implementationId: 'ugv.get-state',
            implementationVersion: '1',
            role: 'primary',
            priority: 0,
            status: 'active',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const reader = new HttpNodeControlCapabilityEvidenceReader({
      baseUrl: 'http://127.0.0.1:10081',
      serviceToken: 's'.repeat(32),
    });

    await expect(reader.load('vehicle.ugv.read-state', 1)).resolves.toMatchObject({
      definition: { updated_at: '2026-08-12T00:00:00.000Z' },
      implementationBindings: [{ created_at: observedAt }],
    });
  });

  it('loads exact current secret-free MCP Binding and source/candidate lineage', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(currentBindingAuthority()));
    vi.stubGlobal('fetch', fetch);
    const token = 'r'.repeat(32);
    const reader = new HttpNodeControlCapabilityEvidenceReader({
      baseUrl: 'https://control.example.test/',
      serviceToken: token,
    });

    await expect(
      reader.loadCurrentMcpProviderBinding({
        bindingId: 'binding-light',
        localServerId: 'home-lab-light-mcp',
      }),
    ).resolves.toMatchObject({
      binding: {
        bindingId: 'binding-light',
        providerId: 'ha-light-lab',
        localServerId: 'home-lab-light-mcp',
      },
      sourceCandidateLineage: { externalProviderId: 'ha-light-lab' },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://control.example.test/internal/v1/mcp-provider-bindings/current?localServerId=home-lab-light-mcp&bindingId=binding-light',
      { headers: { authorization: `Bearer ${token}` }, redirect: 'manual' },
    );
  });

  it('returns registered authority after its health observation expires', async () => {
    const authority = currentBindingAuthority();
    authority.binding.availabilityStatus = 'unavailable';
    authority.binding.availabilityValidUntil = '2026-08-10T00:00:00.000Z';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(authority)));
    const reader = new HttpNodeControlCapabilityEvidenceReader({
      baseUrl: 'https://control.example.test/',
      serviceToken: 'r'.repeat(32),
    });
    await expect(
      reader.loadCurrentMcpProviderBinding({ localServerId: 'home-lab-light-mcp' }),
    ).resolves.toMatchObject({
      binding: {
        bindingId: 'binding-light',
        revision: 7,
        availabilityStatus: 'unavailable',
        availabilityValidUntil: '2026-08-10T00:00:00.000Z',
      },
    });
  });

  it('uses a dedicated least-privilege token for internal Capability and current-Binding authority', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(capabilityAuthority()))
      .mockResolvedValueOnce(Response.json(currentBindingAuthority()));
    vi.stubGlobal('fetch', fetch);
    const capabilityToken = 'c'.repeat(32);
    const bindingToken = 'b'.repeat(32);
    const reader = new HttpNodeControlCapabilityEvidenceReader({
      baseUrl: 'https://control.example.test/',
      serviceToken: capabilityToken,
      bindingServiceToken: bindingToken,
    });

    await reader.load('cap.inspect', 1);
    await reader.loadCurrentMcpProviderBinding({
      bindingId: 'binding-light',
      localServerId: 'home-lab-light-mcp',
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://control.example.test/internal/v1/node-capabilities/cap.inspect/versions/1/authority',
      { headers: { authorization: `Bearer ${bindingToken}` }, redirect: 'manual' },
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://control.example.test/internal/v1/mcp-provider-bindings/current?localServerId=home-lab-light-mcp&bindingId=binding-light',
      { headers: { authorization: `Bearer ${bindingToken}` }, redirect: 'manual' },
    );
  });

  it('requires the unsafe test switch for plaintext non-loopback Control and still rejects URL credentials', () => {
    expect(
      () =>
        new HttpNodeControlCapabilityEvidenceReader({
          baseUrl: 'http://192.168.1.7:10080',
          serviceToken: 'r'.repeat(32),
        }),
    ).toThrow('NODE_CONTROL_ENDPOINT_NOT_ALLOWED');
    expect(
      () =>
        new HttpNodeControlCapabilityEvidenceReader({
          baseUrl: 'http://192.168.1.7:10080',
          serviceToken: 'r'.repeat(32),
          unsafeTestOpen: true,
        }),
    ).not.toThrow();
    expect(
      () =>
        new HttpNodeControlCapabilityEvidenceReader({
          baseUrl: 'http://user:secret@192.168.1.7:10080',
          serviceToken: 'r'.repeat(32),
          unsafeTestOpen: true,
        }),
    ).toThrow('NODE_CONTROL_ENDPOINT_NOT_ALLOWED');
  });

  it('rejects drift between the current Binding and source Candidate lineage', async () => {
    const authority = currentBindingAuthority();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
        Response.json({
          ...authority,
          sourceCandidateLineage: {
            ...authority.sourceCandidateLineage,
            externalServerId: 'stale-server',
          },
        }),
      ),
    );
    const reader = new HttpNodeControlCapabilityEvidenceReader({
      baseUrl: 'https://control.example.test/',
      serviceToken: 'r'.repeat(32),
    });

    await expect(
      reader.loadCurrentMcpProviderBinding({ localServerId: 'home-lab-light-mcp' }),
    ).rejects.toThrow(/source\/candidate lineage identities differ/u);
  });

  it('rejects credential-bearing endpoint authority returned by Node Control', async () => {
    const authority = currentBindingAuthority();
    const credentialEndpoint = 'https://operator:secret@provider.example.test/mcp';
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
        Response.json({
          ...authority,
          binding: { ...authority.binding, endpointRef: credentialEndpoint },
          sourceCandidateLineage: {
            ...authority.sourceCandidateLineage,
            candidateEndpoint: credentialEndpoint,
          },
        }),
      ),
    );
    const reader = new HttpNodeControlCapabilityEvidenceReader({
      baseUrl: 'https://control.example.test/',
      serviceToken: 'r'.repeat(32),
    });

    await expect(
      reader.loadCurrentMcpProviderBinding({ localServerId: 'home-lab-light-mcp' }),
    ).rejects.toThrow(/HTTP\(S\) URL without userinfo/u);
  });

  it('rejects partial SMPP lineage fields on a direct Binding', async () => {
    const authority = currentBindingAuthority();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
        Response.json({
          observedAt: authority.observedAt,
          binding: {
            ...authority.binding,
            originType: 'direct',
            externalServerId: undefined,
            registryRevision: undefined,
            registryChecksum: undefined,
          },
          sourceCandidateLineage: undefined,
        }),
      ),
    );
    const reader = new HttpNodeControlCapabilityEvidenceReader({
      baseUrl: 'https://control.example.test/',
      serviceToken: 'r'.repeat(32),
    });

    await expect(
      reader.loadCurrentMcpProviderBinding({ localServerId: 'home-lab-light-mcp' }),
    ).rejects.toThrow(/requires exact source\/candidate lineage/u);
  });
});

function currentBindingAuthority() {
  return {
    observedAt: '2026-08-11T02:00:00.000Z',
    binding: {
      bindingId: 'binding-light',
      revision: 7,
      localServerId: 'home-lab-light-mcp',
      originType: 'smpp_registry' as const,
      providerId: 'ha-light-lab',
      externalProviderId: 'ha-light-lab',
      externalServerId: 'runtime-light',
      registryRevision: 2,
      registryChecksum: 'a'.repeat(64),
      catalogRevision: '2.0.0:7',
      catalogChecksum: 'b'.repeat(64),
      endpointRef: 'http://127.0.0.1:18081/mcp',
      availabilityStatus: 'available',
      availabilityValidUntil: '2026-08-11T03:00:00.000Z',
      catalogObservedAt: '2026-08-11T02:00:00.000Z',
      operationCount: 3,
    },
    sourceCandidateLineage: {
      smppSourceId: 'home-lab-smpp',
      externalProviderId: 'ha-light-lab',
      externalServerId: 'runtime-light',
      registryRevision: 2,
      registryChecksum: 'a'.repeat(64),
      nativeRevision: 2,
      nativeChecksum: 'c'.repeat(64),
      projectionContract: 'sdar-registry-v1' as const,
      candidateEndpoint: 'http://127.0.0.1:18081/mcp',
    },
  };
}

function capabilityAuthority() {
  return {
    observedAt: '2026-08-04T07:00:00.000Z',
    definition: {
      capabilityId: 'cap.inspect',
      version: 1,
      domain: 'embodied',
      name: 'Inspect',
      description: 'Inspect an area.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      successCriteria: [],
      requiredEvidence: [],
      effects: [],
      artifacts: [],
      constraints: [],
      supportedModes: [],
      riskLevel: 'low' as const,
      status: 'published' as const,
      definitionHash: 'a'.repeat(64),
      createdAt: '2026-08-04T07:00:00.000Z',
      updatedAt: '2026-08-04T07:00:00.000Z',
    },
    implementationBindings: [
      {
        bindingId: 'binding-a',
        revision: 1,
        capabilityId: 'cap.inspect',
        capabilityVersion: 1,
        implementationType: 'skill' as const,
        implementationId: 'skill.inspect',
        implementationVersion: '1',
        role: 'primary' as const,
        priority: 0,
        status: 'active' as const,
        createdAt: '2026-08-04T07:00:00.000Z',
      },
    ],
  };
}
