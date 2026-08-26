import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deriveFrozenMcpCatalogAuthority,
  frozenMcpCatalogCanonicalJson,
  frozenMcpCatalogDocument,
  withMcpToolAdminExecutionSemanticsOverride,
  type McpProtocolDiscoverySnapshot,
  type McpTool,
} from '../../domain/src/index.js';
import {
  MCP_UNAUTHENTICATED_CREDENTIAL_REF,
  hashConfigurationRequest,
  type JsonValue,
} from '../../node-control-domain/src/index.js';
import { NodeControlFrozenMcpCatalogClient } from '../src/index.js';
import type { FrozenV1RegistryAdapter } from '../src/index.js';

const timestamp = '2026-08-11T01:00:00.000Z';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Frozen MCP Catalog canonical authority', () => {
  it('preserves the existing ASCII Catalog checksum and old Node Control canonical vector', () => {
    const snapshot = protocolSnapshot();
    const tools = [tool({ alpha: { type: 'string' }, zulu: { type: 'number' } })];
    const document = frozenMcpCatalogDocument(snapshot, tools);
    const legacyChecksum = hashConfigurationRequest(document as JsonValue);
    const authority = deriveFrozenMcpCatalogAuthority(snapshot, tools, 1);

    expect(authority.catalogChecksum).toBe(legacyChecksum);
    expect(authority.catalogChecksum).toBe(
      createHash('sha256').update(frozenMcpCatalogCanonicalJson(snapshot, tools)).digest('hex'),
    );
  });

  it('orders Unicode object keys by locale-independent UTF-16 code units', () => {
    const canonical = frozenMcpCatalogCanonicalJson(protocolSnapshot(), [
      tool({
        '\uE000': { type: 'integer' },
        '\u{10000}': { type: 'boolean' },
        '\u00E4': { type: 'number' },
        a: { type: 'string' },
      }),
    ]);

    const orderedKeys = ['"a":', '"\u00E4":', '"\u{10000}":', '"\uE000":'];
    const positions = orderedKeys.map((key) => canonical.indexOf(key));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('binds validated Provider manifest identity into the Catalog checksum while preserving legacy omission', () => {
    const snapshot = protocolSnapshot();
    const tools = [defaultTool()];
    const legacy = deriveFrozenMcpCatalogAuthority(snapshot, tools, 1);
    const providerCatalog = {
      providerId: 'isr.vehicle.ugv.ugv1',
      providerType: 'isr.vehicle.ugv',
      providerVersion: '1.0.0',
      manifestHash: 'b'.repeat(64),
    } as const;
    const frozen = deriveFrozenMcpCatalogAuthority({ ...snapshot, providerCatalog }, tools, 1);
    const drifted = deriveFrozenMcpCatalogAuthority(
      { ...snapshot, providerCatalog: { ...providerCatalog, manifestHash: 'c'.repeat(64) } },
      tools,
      1,
    );
    const lifecycleTool = defaultTool();
    if (lifecycleTool.taskExecutionProfile === undefined)
      throw new Error('TEST_TASK_EXECUTION_PROFILE_REQUIRED');
    const lifecycleDeclared = deriveFrozenMcpCatalogAuthority(
      { ...snapshot, providerCatalog },
      [
        {
          ...lifecycleTool,
          taskExecutionProfile: {
            ...lifecycleTool.taskExecutionProfile,
            supportsCancellation: false,
            supportsPauseResume: false,
          },
        },
      ],
      1,
    );

    expect(frozen.catalogChecksum).not.toBe(legacy.catalogChecksum);
    expect(drifted.catalogChecksum).not.toBe(frozen.catalogChecksum);
    expect(lifecycleDeclared.catalogChecksum).not.toBe(frozen.catalogChecksum);
    expect(frozenMcpCatalogDocument({ ...snapshot, providerCatalog }, tools)).toMatchObject({
      providerCatalog,
    });
    expect(frozenMcpCatalogDocument(snapshot, tools)).not.toHaveProperty('providerCatalog');
  });
});

describe('NodeControlFrozenMcpCatalogClient governed Runtime authority', () => {
  it('omits Authorization for the one explicit unauthenticated Runtime authority', async () => {
    const snapshot = protocolSnapshot();
    const discover = vi.fn(() =>
      Promise.resolve({ snapshot, tools: Object.freeze([defaultTool()]) }),
    );
    const client = new NodeControlFrozenMcpCatalogClient(['provider.example.test'], {
      discover,
    } as unknown as FrozenV1RegistryAdapter);

    await expect(
      client.discover({
        localServerId: 'provider-1',
        endpointRef: 'https://provider.example.test/mcp',
        credentialRef: MCP_UNAUTHENTICATED_CREDENTIAL_REF,
        bindingRevision: 1,
        observedAt: timestamp,
        snapshotId: 'binding-snapshot-unauthenticated',
      }),
    ).resolves.toMatchObject({ operationCount: 1 });
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({ headers: {} }));
  });

  it('opens plaintext non-loopback discovery only for the explicit unsafe test policy', async () => {
    vi.stubEnv('MCP_HOME_LAB_TOKEN', 'home-lab-provider-secret');
    const snapshot = protocolSnapshot();
    const registry = {
      discover: vi.fn(() => Promise.resolve({ snapshot, tools: Object.freeze([defaultTool()]) })),
    } as unknown as FrozenV1RegistryAdapter;
    const input = {
      localServerId: 'provider-1',
      endpointRef: 'http://192.168.1.7:19100/mcp',
      credentialRef: 'secret://env/MCP_HOME_LAB_TOKEN',
      bindingRevision: 1,
      observedAt: timestamp,
      snapshotId: 'binding-snapshot-1',
    };
    await expect(
      new NodeControlFrozenMcpCatalogClient([], registry).discover(input),
    ).rejects.toThrow('SSRF allowlist');
    await expect(
      new NodeControlFrozenMcpCatalogClient([], registry, undefined, [], true).discover(input),
    ).resolves.toMatchObject({ operationCount: 1 });
  });

  it('keeps real remote discovery while returning the exact governed Runtime checksum', async () => {
    vi.stubEnv('MCP_HOME_LAB_TOKEN', 'home-lab-provider-secret');
    const snapshot = {
      ...protocolSnapshot(),
      validUntil: '2026-08-11T01:05:00.000Z',
    };
    const discoveredTools = [defaultTool()];
    const governedTools = [governedTool()];
    const discoveredCatalog = deriveFrozenMcpCatalogAuthority(snapshot, discoveredTools, 1);
    const governedCatalog = deriveFrozenMcpCatalogAuthority(snapshot, governedTools, 1);
    const discover = vi.fn(() =>
      Promise.resolve({ snapshot, tools: Object.freeze(discoveredTools) }),
    );
    const loadCurrentAuthority = vi.fn(() =>
      Promise.resolve({
        endpoint: 'https://provider.example.test/mcp',
        status: 'enabled',
        serverUpdatedAt: timestamp,
        toolRevision: 17,
        protocolMode: 'frozen_v1',
        snapshotToolRevision: 17,
        catalogChecksum: governedCatalog.catalogChecksum,
        discoveredCatalogChecksum: discoveredCatalog.catalogChecksum,
        operationCount: 1,
        toolNames: ['light_get_state'],
      }),
    );
    const client = new NodeControlFrozenMcpCatalogClient(
      ['provider.example.test'],
      { discover } as unknown as FrozenV1RegistryAdapter,
      { loadCurrentAuthority },
    );

    await expect(
      client.discover({
        localServerId: 'provider-1',
        endpointRef: 'https://provider.example.test/mcp',
        credentialRef: 'secret://env/MCP_HOME_LAB_TOKEN',
        bindingRevision: 2,
        observedAt: timestamp,
        snapshotId: 'binding-snapshot-2',
      }),
    ).resolves.toMatchObject({
      catalogRevision: '1.0.0:2',
      catalogChecksum: governedCatalog.catalogChecksum,
      operationCount: 1,
    });
    expect(governedCatalog.catalogChecksum).not.toBe(discoveredCatalog.catalogChecksum);
    expect(discover).toHaveBeenCalledOnce();
    expect(loadCurrentAuthority).toHaveBeenCalledWith('provider-1');
  });

  it('reports actual semantic discovery drift instead of substituting stale Runtime authority', async () => {
    vi.stubEnv('MCP_HOME_LAB_TOKEN', 'home-lab-provider-secret');
    const snapshot = {
      ...protocolSnapshot(),
      validUntil: '2026-08-11T01:05:00.000Z',
    };
    const discoveredTools = [defaultTool()];
    const governedCatalog = deriveFrozenMcpCatalogAuthority(snapshot, [governedTool()], 1);
    const client = new NodeControlFrozenMcpCatalogClient(
      ['provider.example.test'],
      {
        discover: () => Promise.resolve({ snapshot, tools: Object.freeze(discoveredTools) }),
      } as unknown as FrozenV1RegistryAdapter,
      {
        loadCurrentAuthority: () =>
          Promise.resolve({
            endpoint: 'https://provider.example.test/mcp',
            status: 'enabled',
            serverUpdatedAt: timestamp,
            toolRevision: 1,
            protocolMode: 'frozen_v1',
            snapshotToolRevision: 1,
            catalogChecksum: governedCatalog.catalogChecksum,
            discoveredCatalogChecksum: '0'.repeat(64),
            operationCount: 1,
            toolNames: ['light_get_state'],
          }),
      },
    );

    await expect(
      client.discover({
        localServerId: 'provider-1',
        endpointRef: 'https://provider.example.test/mcp',
        credentialRef: 'secret://env/MCP_HOME_LAB_TOKEN',
        bindingRevision: 2,
        observedAt: timestamp,
        snapshotId: 'binding-snapshot-2',
      }),
    ).resolves.toMatchObject({
      catalogRevision: '1.0.0:2',
      catalogChecksum: deriveFrozenMcpCatalogAuthority(snapshot, discoveredTools, 2)
        .catalogChecksum,
    });
  });

  it('derives one new effective Catalog on schema drift while retaining the exact Runtime admin override', async () => {
    const snapshot = protocolSnapshot();
    const previous = defaultTool();
    const changed = {
      ...defaultTool(),
      inputSchema: { type: 'object', properties: { changedResourceId: { type: 'string' } } },
    };
    const override = governedTool().executionSemantics;
    const expected = deriveFrozenMcpCatalogAuthority(
      snapshot,
      [withMcpToolAdminExecutionSemanticsOverride(changed, override)],
      2,
    );
    const reader = {
      loadCurrentAuthority: () =>
        Promise.resolve({
          endpoint: 'https://provider.example.test/mcp',
          status: 'enabled',
          serverUpdatedAt: timestamp,
          toolRevision: 1,
          protocolMode: 'frozen_v1',
          snapshotToolRevision: 1,
          catalogChecksum: deriveFrozenMcpCatalogAuthority(snapshot, [governedTool()], 1)
            .catalogChecksum,
          discoveredCatalogChecksum: deriveFrozenMcpCatalogAuthority(snapshot, [previous], 1)
            .catalogChecksum,
          operationCount: 1,
          toolNames: ['light_get_state'],
          executionSemanticsOverrides: { light_get_state: override },
        }),
    };
    const client = new NodeControlFrozenMcpCatalogClient(
      ['provider.example.test'],
      {
        discover: () => Promise.resolve({ snapshot, tools: [changed] }),
      } as unknown as FrozenV1RegistryAdapter,
      reader,
    );
    const result = await client.discover({
      localServerId: 'provider-1',
      endpointRef: 'https://provider.example.test/mcp',
      credentialRef: MCP_UNAUTHENTICATED_CREDENTIAL_REF,
      bindingRevision: 2,
      observedAt: timestamp,
      snapshotId: 'binding-effective-drift',
    });
    expect(result).toMatchObject(expected);
    expect(result.catalogChecksum).not.toBe(
      deriveFrozenMcpCatalogAuthority(snapshot, [changed], 2).catalogChecksum,
    );
    expect(result.catalogChecksum).not.toBe((await reader.loadCurrentAuthority()).catalogChecksum);
  });

  it('keeps the Provider-declared semantics precedence when retaining an administrative override', async () => {
    const snapshot = protocolSnapshot();
    const declared = tool({ currentResource: { type: 'string' } });
    const fresh = { ...declared, declaredExecutionSemantics: declared.executionSemantics };
    const reader = {
      loadCurrentAuthority: () =>
        Promise.resolve({
          endpoint: 'https://provider.example.test/mcp',
          status: 'enabled',
          serverUpdatedAt: timestamp,
          toolRevision: 1,
          protocolMode: 'frozen_v1',
          snapshotToolRevision: 1,
          catalogChecksum: deriveFrozenMcpCatalogAuthority(snapshot, [governedTool()], 1)
            .catalogChecksum,
          discoveredCatalogChecksum: deriveFrozenMcpCatalogAuthority(snapshot, [defaultTool()], 1)
            .catalogChecksum,
          operationCount: 1,
          toolNames: ['light_get_state'],
          executionSemanticsOverrides: { light_get_state: governedTool().executionSemantics },
        }),
    };
    const client = new NodeControlFrozenMcpCatalogClient(
      ['provider.example.test'],
      {
        discover: () => Promise.resolve({ snapshot, tools: [fresh] }),
      } as unknown as FrozenV1RegistryAdapter,
      reader,
    );
    await expect(
      client.discover({
        localServerId: 'provider-1',
        endpointRef: 'https://provider.example.test/mcp',
        credentialRef: MCP_UNAUTHENTICATED_CREDENTIAL_REF,
        bindingRevision: 2,
        observedAt: timestamp,
        snapshotId: 'binding-declared-precedence',
      }),
    ).resolves.toMatchObject(deriveFrozenMcpCatalogAuthority(snapshot, [fresh], 2));
  });

  it('still rejects mismatched Runtime endpoint identity', async () => {
    const snapshot = protocolSnapshot();
    const tools = [defaultTool()];
    const checksum = deriveFrozenMcpCatalogAuthority(snapshot, tools, 1).catalogChecksum;
    const client = new NodeControlFrozenMcpCatalogClient(
      ['provider.example.test'],
      {
        discover: () => Promise.resolve({ snapshot, tools }),
      } as unknown as FrozenV1RegistryAdapter,
      {
        loadCurrentAuthority: () =>
          Promise.resolve({
            endpoint: 'https://provider.example.test/another-provider',
            status: 'enabled',
            serverUpdatedAt: timestamp,
            toolRevision: 1,
            protocolMode: 'frozen_v1',
            snapshotToolRevision: 1,
            catalogChecksum: checksum,
            discoveredCatalogChecksum: checksum,
            operationCount: 1,
            toolNames: ['light_get_state'],
          }),
      },
    );
    await expect(
      client.discover({
        localServerId: 'provider-1',
        endpointRef: 'https://provider.example.test/mcp',
        credentialRef: MCP_UNAUTHENTICATED_CREDENTIAL_REF,
        bindingRevision: 1,
        observedAt: timestamp,
        snapshotId: 'binding-wrong-endpoint',
      }),
    ).rejects.toThrow('MCP_RUNTIME_CATALOG_AUTHORITY_MISMATCH');
  });
});

function protocolSnapshot(): McpProtocolDiscoverySnapshot {
  return {
    snapshotId: 'snapshot-1',
    serverId: 'provider-1',
    protocolMode: 'frozen_v1',
    protocolVersion: '2026-07-28',
    baselineSha256: 'a'.repeat(64),
    supportedVersions: ['2026-07-28'],
    capabilities: {},
    serverInfo: { name: 'Provider 1', version: '1.0.0' },
    taskNotifications: false,
    discoveredAt: timestamp,
    toolRevision: 1,
  };
}

function tool(properties: Readonly<Record<string, unknown>>): McpTool {
  return {
    serverId: 'provider-1',
    toolName: 'light_get_state',
    inputSchema: { type: 'object', properties, additionalProperties: false },
    outputSchema: { type: 'object' },
    protocolMode: 'frozen_v1',
    executionSemantics: {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'none',
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
      idempotency: 'none',
    },
    discoveredAt: timestamp,
  };
}

function defaultTool(): McpTool {
  return {
    ...tool({ resourceId: { type: 'string' } }),
    executionSemantics: {
      effect: 'unknown',
      execution: 'unknown',
      cancellation: 'unknown',
      idempotency: 'unknown',
      replay: 'unknown',
      source: 'default_unknown',
    },
  };
}

function governedTool(): McpTool {
  return {
    ...defaultTool(),
    executionSemantics: {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'server_managed',
      replay: 'allowed',
      source: 'admin_override',
    },
  };
}
