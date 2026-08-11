import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpNodeControlCapabilityEvidenceReader } from '../src/index.js';

describe('HttpNodeControlCapabilityEvidenceReader', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('authenticates, validates and maps full Control authority state', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
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
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [
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
          totalEstimate: 1,
          asOf: '2026-08-04T07:00:00.000Z',
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
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of fetch.mock.calls)
      expect(call[1]?.headers).toMatchObject({ authorization: `Bearer ${'s'.repeat(32)}` });
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
      { headers: { authorization: `Bearer ${token}` } },
    );
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
