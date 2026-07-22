import { describe, expect, it } from 'vitest';

import type { McpProtocolDiscoverySnapshot, McpServer, McpTool } from '../../domain/src/index.js';
import {
  FrozenMcpRegistryService,
  type FrozenMcpDiscoveryPort,
  type FrozenMcpRegistryRepository,
  type McpServerRecord,
} from '../src/index.js';

const timestamp = '2026-07-19T03:00:00.000Z';

describe('Frozen MCP registry', () => {
  it('registers an explicit Frozen identity and persists discovery atomically', async () => {
    const repository = new MemoryRepository();
    const service = createService(repository);

    const result = await service.register({
      serverId: 'provider-1',
      name: 'Provider 1',
      endpoint: 'https://provider.test/mcp',
      credentialHeaders: { Authorization: 'Bearer secret' },
    });

    expect(result.server).toMatchObject({
      protocolMode: 'frozen_v1',
      toolRevision: 1,
      currentProtocolSnapshotId: 'snapshot-1',
    });
    expect(repository.record?.encryptedCredential).toBe('encrypted');
    expect(repository.snapshot?.baselineSha256).toBe('a'.repeat(64));
    expect(repository.tools).toHaveLength(1);
  });

  it('detects removed or changed Tools on Frozen refresh', async () => {
    const repository = new MemoryRepository();
    const service = createService(repository);
    repository.record = {
      server: server({ protocolMode: 'frozen_v1', currentProtocolSnapshotId: 'snapshot-0' }),
      encryptedCredential: 'encrypted',
    };
    repository.tools = [tool('removed'), tool('move_to', { type: 'string' })];
    const result = await service.refresh('provider-1');
    expect(result.server.toolRevision).toBe(2);
    expect(result.dependencyWarnings).toEqual([
      { toolName: 'removed', reason: 'removed' },
      { toolName: 'move_to', reason: 'schema_changed' },
    ]);
  });

  it('rejects execution-control headers as persisted credentials', async () => {
    await expect(
      createService(new MemoryRepository()).register({
        serverId: 'provider-1',
        name: 'Provider 1',
        endpoint: 'https://provider.test/mcp',
        credentialHeaders: { 'X-SDAR-Execution-Mode': 'live' },
      }),
    ).rejects.toMatchObject({ code: 'MCP_RESERVED_HEADER_FORBIDDEN' });
  });
});

class MemoryRepository implements FrozenMcpRegistryRepository {
  record: McpServerRecord | undefined;
  tools: readonly McpTool[] = [];
  snapshot: McpProtocolDiscoverySnapshot | undefined;
  changes = [] as readonly Readonly<{ toolName: string; reason: 'removed' | 'schema_changed' }>[];

  findServer() {
    return Promise.resolve(this.record);
  }
  listTools() {
    return Promise.resolve(this.tools);
  }
  saveFrozenServerAndReplaceTools(
    record: McpServerRecord,
    tools: readonly McpTool[],
    snapshot: McpProtocolDiscoverySnapshot,
    changes = [],
  ) {
    this.record = record;
    this.tools = tools;
    this.snapshot = snapshot;
    this.changes = changes;
    return Promise.resolve();
  }
}

function createService(repository: MemoryRepository) {
  const discovery: FrozenMcpDiscoveryPort = {
    discover: (input) =>
      Promise.resolve({
        snapshot: snapshot(input.server.toolRevision, input.snapshotId),
        tools: [tool('move_to')],
      }),
  };
  return new FrozenMcpRegistryService({
    repository,
    discovery,
    cipher: {
      encrypt: () => 'encrypted',
      decrypt: () => ({ Authorization: 'Bearer secret' }),
    },
    clock: { now: () => timestamp },
    nextSnapshotId: () => 'snapshot-1',
    baselineSha256: 'a'.repeat(64),
  });
}

function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    serverId: 'provider-1',
    name: 'Provider 1',
    endpoint: 'https://provider.test/mcp',
    transport: 'streamable_http',
    status: 'enabled',
    toolRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function tool(toolName: string, inputSchema: unknown = { type: 'object' }): McpTool {
  return {
    serverId: 'provider-1',
    toolName,
    inputSchema,
    outputSchema: { type: 'object' },
    protocolMode: 'frozen_v1',
    executionSemantics: {
      effect: 'unknown',
      execution: 'unknown',
      cancellation: 'unknown',
      idempotency: 'unknown',
      replay: 'unknown',
      source: 'default_unknown',
    },
    taskExecutionProfile: profile,
    discoveredAt: timestamp,
  };
}

function snapshot(toolRevision: number, snapshotId: string): McpProtocolDiscoverySnapshot {
  return {
    snapshotId,
    serverId: 'provider-1',
    protocolMode: 'frozen_v1',
    protocolVersion: '2026-07-28',
    baselineSha256: 'a'.repeat(64),
    supportedVersions: ['2026-07-28'],
    capabilities: {},
    serverInfo: { name: 'Provider 1', version: '1.0.0' },
    taskNotifications: true,
    discoveredAt: timestamp,
    toolRevision,
  };
}

const profile = {
  profileVersion: '1.0',
  taskBehavior: 'task_required',
  availability: 'dynamic',
  supportsScheduling: true,
  supportsMaxElapsed: true,
  supportsObservations: true,
  supportsInputRequired: true,
  idempotency: 'client_request_key',
} as const;
