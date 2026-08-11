import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  deriveFrozenMcpCatalogAuthority,
  frozenMcpCatalogCanonicalJson,
  frozenMcpCatalogDocument,
  type McpProtocolDiscoverySnapshot,
  type McpTool,
} from '../../domain/src/index.js';
import { hashConfigurationRequest, type JsonValue } from '../../node-control-domain/src/index.js';

const timestamp = '2026-08-11T01:00:00.000Z';

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
