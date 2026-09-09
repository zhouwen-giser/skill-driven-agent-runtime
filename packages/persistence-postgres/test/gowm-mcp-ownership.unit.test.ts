import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { readGowmMcpOwner } from '../src/gowm-mcp-ownership.js';
import { insertMcpInvocation } from '../src/mcp-invocation-writer.js';
import type { McpInvocation } from '../../domain/src/mcp.js';
import { DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS } from '../../domain/src/mcp.js';

const scope = { allowedDeviceIds: ['device-a'], sdarServiceKey: 'sdar', includeNonDevice: false };
const row = {
  device_id: 'device-a',
  smpp_service_key: 'smpp-old',
  sdar_mcp_server_id: 'server-old',
  provider_id: 'provider',
  resource_id: 'resource-a',
};
function database(rows = [row]) {
  const query = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
  return { query, client: { query } as unknown as PoolClient };
}
describe('GOWM MCP Task binding authority', () => {
  it('uses the frozen Task binding, with exact service scope and no current-binding fallback', async () => {
    const db = database();
    await expect(
      readGowmMcpOwner(db.client, scope, 'task', 'server-old', { resourceId: 'resource-a' }),
    ).resolves.toEqual({
      deviceId: 'device-a',
      smppServiceKey: 'smpp-old',
      providerId: 'provider',
      resourceId: 'resource-a',
    });
    expect(db.query.mock.calls[0]?.[1]).toEqual(['task', ['device-a'], 'sdar', false]);
    expect(db.query.mock.calls[0]?.[0]).toContain('b.binding_id=t.gowm_binding_id');
    expect(db.query.mock.calls[0]?.[0]).not.toContain('valid_to');
  });
  it('rejects mismatched Task, server or resource instead of recording the wrong device', async () => {
    await expect(
      readGowmMcpOwner(database([]).client, scope, 'outside', 'server-old'),
    ).rejects.toThrow('MCP_TASK_DEVICE_SCOPE_DENIED');
    await expect(readGowmMcpOwner(database().client, scope, 'task', 'server-new')).rejects.toThrow(
      'MCP_TASK_SERVER_BINDING_MISMATCH',
    );
    await expect(
      readGowmMcpOwner(database().client, scope, 'task', 'server-old', {
        resourceId: 'resource-b',
      }),
    ).rejects.toThrow('MCP_TASK_RESOURCE_BINDING_MISMATCH');
  });
  it('requires the independent non-device channel for calls without a Task', async () => {
    const db = database();
    await expect(readGowmMcpOwner(db.client, scope, undefined, 'server')).rejects.toThrow(
      'MCP_DEVICE_TASK_REQUIRED',
    );
    expect(db.query).not.toHaveBeenCalled();
    db.query.mockResolvedValue({ rows: [{ bound: false }], rowCount: 1 });
    await expect(
      readGowmMcpOwner(db.client, { ...scope, includeNonDevice: true }, undefined, 'server'),
    ).resolves.toMatchObject({ deviceId: null, smppServiceKey: null });
    db.query.mockResolvedValue({ rows: [{ bound: true }], rowCount: 1 });
    await expect(
      readGowmMcpOwner(
        db.client,
        { ...scope, allowedDeviceIds: [], includeNonDevice: true },
        undefined,
        'device-server',
      ),
    ).rejects.toThrow('MCP_NONDEVICE_SERVER_BINDING_FORBIDDEN');
  });
  it('the common Invocation writer derives ownership rather than trusting an input deviceId', async () => {
    const db = database();
    const invocation: McpInvocation = {
      invocationId: 'i',
      taskId: 'task',
      deviceId: 'forged',
      serverId: 'server-old',
      toolName: 'read',
      executionMode: 'live',
      executionSemantics: DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
      arguments: { resourceId: 'resource-a' },
      status: 'succeeded',
      startedAt: '2026-09-08T00:00:00Z',
      completedAt: '2026-09-08T00:00:00Z',
      durationMs: 0,
    };
    await insertMcpInvocation(db.client, invocation, scope);
    expect(db.query.mock.calls[1]?.[0]).toContain('duration_ms,device_id');
    const parameters: readonly unknown[] = db.query.mock.calls[1]?.[1] as readonly unknown[];
    expect(parameters.at(-1)).toBe('device-a');
    expect(db.query.mock.calls[1]?.[1]).not.toContain('forged');
  });
});
