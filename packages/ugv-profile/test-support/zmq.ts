import catalog from '../src/zmq-catalog-contract.json' with { type: 'json' };
import type { McpTool } from '../../domain/src/mcp.js';
import { deriveFrozenMcpCatalogAuthority } from '../../domain/src/mcp-catalog-authority.js';
export const now = '2026-10-24T00:00:00.000Z',
  resource = 'vehicle:SIMULATED';
export function tools(): McpTool[] {
  return catalog.tools.map(
    (t) =>
      ({
        ...t,
        serverId: 'zmq-isolated',
        toolName: t.name,
        inputSchema: {
          ...t.inputSchema,
          properties: {
            ...t.inputSchema.properties,
            resourceId: { ...t.inputSchema.properties.resourceId, const: resource },
          },
        },
        protocolMode: 'frozen_v1',
        taskExecutionProfile: t._meta['io.sdar/taskExecution'],
        executionSemantics: {
          effect:
            t._meta['io.sdar/taskExecution'].taskBehavior === 'task_required'
              ? 'side_effecting'
              : 'read_only',
          execution:
            t._meta['io.sdar/taskExecution'].taskBehavior === 'task_required'
              ? 'task_required'
              : 'synchronous',
          cancellation: t._meta['io.sdar/taskExecution'].supportsCancellation
            ? 'task_cancel'
            : 'unsupported',
          idempotency: 'server_managed',
          replay:
            t._meta['io.sdar/taskExecution'].taskBehavior === 'task_required'
              ? 'forbidden'
              : 'allowed',
          source: 'mcp_declared',
        },
        discoveredAt: now,
      }) as McpTool,
  );
}
export const discovery = {
  protocolVersion: '2026-07-28' as const,
  serverInfo: { name: 'SIMULATED-provider', version: '1.0' },
  providerCatalog: {
    providerId: 'SIMULATED-provider',
    providerType: 'isr.vehicle.ugv.zmq',
    providerVersion: '1.0',
    manifestHash: 'a'.repeat(64),
  },
};
export const authority = (ts = tools()) => ({
  bindingId: 'SIMULATED-binding',
  providerId: 'SIMULATED-provider',
  resourceId: resource,
  localServerId: 'zmq-isolated',
  bindingRevision: 1,
  registryRevision: 1,
  registryChecksum: 'b'.repeat(64),
  catalogRevision: deriveFrozenMcpCatalogAuthority(discovery, ts, 1).catalogRevision,
  catalogChecksum: deriveFrozenMcpCatalogAuthority(discovery, ts, 1).catalogChecksum,
  simulationId: 'SIMULATED-scene',
  validUntil: '2026-10-24T00:01:00.000Z',
});
