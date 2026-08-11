import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deriveFrozenMcpCatalogAuthority,
  frozenMcpCatalogCanonicalJson,
  frozenMcpCatalogDocument,
  type McpProtocolDiscoverySnapshot,
  type McpTool,
} from '../../domain/src/index.js';
import { hashConfigurationRequest, type JsonValue } from '../../node-control-domain/src/index.js';
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
});

describe('NodeControlFrozenMcpCatalogClient governed Runtime authority', () => {
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
        toolRevision: 1,
        protocolMode: 'frozen_v1',
        snapshotToolRevision: 1,
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

  it('fails closed when the remotely discovered Catalog differs from Runtime discovery authority', async () => {
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
