import { describe, expect, it } from 'vitest';

import type { McpServer, McpTool } from '../../domain/src/index.js';
import {
  McpProtocolOperationsService,
  type McpProtocolOperationsRepository,
} from '../src/index.js';

const server: McpServer = {
  serverId: 'provider-1',
  name: 'Provider 1',
  endpoint: 'https://provider.test/mcp',
  transport: 'streamable_http',
  status: 'enabled',
  toolRevision: 3,
  protocolMode: 'frozen_v1',
  currentProtocolSnapshotId: 'snapshot-3',
  createdAt: '2026-07-19T01:00:00.000Z',
  updatedAt: '2026-07-19T02:00:00.000Z',
};

describe('MCP protocol operations', () => {
  it('projects current discovery, task behavior, stable output hash and notification status', async () => {
    const service = createService();
    const evidence = await service.diagnose('provider-1');
    expect(evidence).toMatchObject({
      server: { protocolMode: 'frozen_v1' },
      currentDiscovery: {
        supportedVersions: ['2026-07-28'],
        baselineSha256: 'a'.repeat(64),
        taskNotifications: true,
      },
      notificationStatus: 'streaming_supported',
      tools: [{ toolName: 'move_to', taskBehavior: 'server_directed' }],
    });
    expect(evidence.tools[0]?.outputSchemaHash).toMatch(/^[0-9a-f]{64}$/u);
    await expect(service.auditBaseline('provider-1')).resolves.toMatchObject({ passed: true });
  });
});

function createService() {
  const tool: McpTool = {
    serverId: 'provider-1',
    toolName: 'move_to',
    inputSchema: { type: 'object' },
    outputSchema: { properties: { ok: { type: 'boolean' } }, type: 'object' },
    protocolMode: 'frozen_v1',
    executionSemantics: {
      effect: 'unknown',
      execution: 'unknown',
      cancellation: 'unknown',
      idempotency: 'none',
      replay: 'forbidden',
      source: 'default_unknown',
    },
    taskExecutionProfile: {
      profileVersion: '1.0',
      taskBehavior: 'server_directed',
      availability: 'dynamic',
      supportsScheduling: true,
      supportsMaxElapsed: true,
      supportsObservations: true,
      supportsInputRequired: true,
      idempotency: 'client_request_key',
    },
    discoveredAt: '2026-07-19T02:00:00.000Z',
  };
  const repository: McpProtocolOperationsRepository = {
    listServers: () => Promise.resolve([server]),
    listTools: () => Promise.resolve([tool]),
    findCurrentProtocolSnapshot: () =>
      Promise.resolve({
        snapshotId: 'snapshot-3',
        serverId: 'provider-1',
        protocolMode: 'frozen_v1',
        protocolVersion: '2026-07-28',
        baselineSha256: 'a'.repeat(64),
        supportedVersions: ['2026-07-28'],
        capabilities: {},
        serverInfo: { name: 'provider-1', version: '1.0.0' },
        taskNotifications: true,
        discoveredAt: '2026-07-19T02:00:00.000Z',
        toolRevision: 3,
      }),
  };
  return new McpProtocolOperationsService({
    repository,
    expectedBaselineSha256: 'a'.repeat(64),
  });
}
