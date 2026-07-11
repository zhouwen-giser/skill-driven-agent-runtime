import { describe, expect, it } from 'vitest';

import type {
  McpDependencyWarning,
  McpInvocation,
  McpTool,
  McpToolEnhancement,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  McpRegistryService,
  type McpRegistryRepository,
  type McpServerRecord,
  type McpTransportAdapter,
} from '../src/index.js';

describe('McpRegistryService', () => {
  it('discovers once on registration, refreshes manually, and reports dependency warnings', async () => {
    const repository = new MemoryMcpRepository();
    const transport = new ChangingTransport();
    const service = createService(repository, transport);
    const registered = await service.register({
      serverId: 'mcp.devices',
      name: 'Devices',
      endpoint: 'https://mcp.example.test/mcp',
      credentialHeaders: { Authorization: 'Bearer secret' },
    });
    await service.updateToolEnhancement('mcp.devices', 'device_status', {
      purpose: ' Read device status ',
      scenarios: [' inspection ', 'inspection'],
      constraints: ['Read-only'],
      returnDescription: ' Device state ',
      commonErrors: ['Unavailable'],
      tags: [' device ', 'device'],
    });
    const refreshed = await service.refresh('mcp.devices');

    expect(registered.tools.map((tool) => tool.toolName)).toEqual([
      'device_status',
      'removed_tool',
    ]);
    expect(refreshed.server.toolRevision).toBe(2);
    expect(refreshed.dependencyWarnings).toEqual([
      { toolName: 'device_status', reason: 'schema_changed' },
      { toolName: 'removed_tool', reason: 'removed' },
    ]);
    expect(transport.discoveries).toBe(2);
    expect(refreshed.tools[0]?.enhancement).toEqual({
      purpose: 'Read device status',
      scenarios: ['inspection'],
      constraints: ['Read-only'],
      returnDescription: 'Device state',
      commonErrors: ['Unavailable'],
      tags: ['device'],
    });
  });

  it('validates calls against the current original Tool schema before transport invocation', async () => {
    const repository = new MemoryMcpRepository();
    const transport = new ChangingTransport();
    const service = createService(repository, transport);
    await service.register({
      serverId: 'mcp.devices',
      name: 'Devices',
      endpoint: 'https://mcp.example.test/mcp',
      credentialHeaders: { Authorization: 'Bearer secret' },
    });

    await expect(service.call('mcp.devices', 'device_status', {})).rejects.toMatchObject({
      code: 'MCP_ARGUMENT_SCHEMA_MISMATCH',
    });
    expect(transport.calls).toBe(0);
    await expect(
      service.call('mcp.devices', 'device_status', { deviceId: 'device-1' }),
    ).resolves.toEqual({ ok: true });
    expect(transport.calls).toBe(1);
    expect(repository.invocations).toEqual([
      expect.objectContaining({
        invocationId: 'invocation-1',
        status: 'succeeded',
        arguments: { deviceId: 'device-1' },
        result: { ok: true },
      }),
    ]);
  });

  it('persists a replayable failure summary and rethrows the transport error', async () => {
    const repository = new MemoryMcpRepository();
    const transport = new ChangingTransport();
    transport.failure = new Error('remote unavailable');
    const service = createService(repository, transport);
    await service.register({
      serverId: 'mcp.devices',
      name: 'Devices',
      endpoint: 'https://mcp.example.test/mcp',
      credentialHeaders: {},
    });

    await expect(
      service.call('mcp.devices', 'device_status', { deviceId: 'device-1' }),
    ).rejects.toThrow('remote unavailable');
    expect(repository.invocations).toEqual([
      expect.objectContaining({
        status: 'failed',
        errorCode: 'MCP_CALL_FAILED',
        errorMessage: 'remote unavailable',
      }),
    ]);
  });

  it('does not deduplicate repeated side-effect Tool calls in V1', async () => {
    const repository = new MemoryMcpRepository();
    const transport = new ChangingTransport();
    const service = createService(repository, transport);
    await service.register({
      serverId: 'mcp.devices',
      name: 'Devices',
      endpoint: 'https://mcp.example.test/mcp',
      credentialHeaders: {},
    });
    const arguments_ = { deviceId: 'device-1' };
    await service.call('mcp.devices', 'device_status', arguments_);
    await service.call('mcp.devices', 'device_status', arguments_);

    expect(transport.calls).toBe(2);
    expect(repository.invocations.map((item) => item.invocationId)).toEqual([
      'invocation-1',
      'invocation-2',
    ]);
  });
});

function createService(repository: McpRegistryRepository, transport: McpTransportAdapter) {
  let invocationSequence = 0;
  return new McpRegistryService({
    repository,
    transport,
    schemas: new AjvJsonSchemaValidator(),
    cipher: {
      encrypt: () => 'encrypted',
      decrypt: () => ({ Authorization: 'Bearer secret' }),
    },
    clock: { now: () => '2026-07-11T10:00:00.000Z' },
    ids: { nextInvocationId: () => `invocation-${String(++invocationSequence)}` },
  });
}

class ChangingTransport implements McpTransportAdapter {
  discoveries = 0;
  calls = 0;
  failure: Error | undefined;
  discover() {
    this.discoveries += 1;
    const schema =
      this.discoveries === 1
        ? { type: 'object', required: ['deviceId'], properties: { deviceId: { type: 'string' } } }
        : { type: 'object', required: ['serial'], properties: { serial: { type: 'string' } } };
    return Promise.resolve([
      { name: 'device_status', inputSchema: schema },
      ...(this.discoveries === 1
        ? [{ name: 'removed_tool', inputSchema: { type: 'object' } }]
        : []),
    ]);
  }
  call() {
    this.calls += 1;
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return Promise.resolve({ ok: true });
  }
  disconnect() {
    return Promise.resolve();
  }
}

class MemoryMcpRepository implements McpRegistryRepository {
  record: McpServerRecord | undefined;
  tools: readonly McpTool[] = [];
  invocations: readonly McpInvocation[] = [];
  warnings: readonly McpDependencyWarning[] = [];
  findServer() {
    return Promise.resolve(this.record);
  }
  listTools() {
    return Promise.resolve(this.tools);
  }
  saveServerAndReplaceTools(record: McpServerRecord, tools: readonly McpTool[]) {
    this.record = record;
    this.tools = tools;
    return Promise.resolve();
  }
  deleteServer() {
    this.record = undefined;
    this.tools = [];
    return Promise.resolve();
  }
  saveInvocation(invocation: McpInvocation) {
    this.invocations = [...this.invocations, invocation];
    return Promise.resolve();
  }
  listInvocations() {
    return Promise.resolve(this.invocations);
  }
  listDependencyWarnings() {
    return Promise.resolve(this.warnings);
  }
  updateToolEnhancement(serverId: string, toolName: string, enhancement: McpToolEnhancement) {
    this.tools = this.tools.map((tool) =>
      tool.serverId === serverId && tool.toolName === toolName ? { ...tool, enhancement } : tool,
    );
    return Promise.resolve();
  }
}
