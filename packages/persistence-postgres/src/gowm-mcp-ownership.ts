import type { Pool, PoolClient } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { taskDeviceScopeSql } from './gowm-work-scope.js';

export interface GowmMcpOwner {
  readonly deviceId: string | null;
  readonly smppServiceKey: string | null;
  readonly providerId: string | null;
  readonly resourceId: string | null;
}

/** Resolve the immutable Task binding, never the device's newest directory row. */
export async function readGowmMcpOwner(
  client: Pool | PoolClient,
  scope: DeviceWorkScope,
  taskId: string | undefined,
  serverId: string,
  arguments_?: Readonly<Record<string, unknown>>,
): Promise<GowmMcpOwner> {
  const nonDevice = { deviceId: null, smppServiceKey: null, providerId: null, resourceId: null };
  if (taskId === undefined) {
    if (!scope.includeNonDevice) throw new GowmMcpOwnershipError('MCP_DEVICE_TASK_REQUIRED');
    await assertNonDeviceServer(client, serverId);
    return nonDevice;
  }
  const filter = taskDeviceScopeSql(scope, 2, 't');
  const selected = await client.query<{
    device_id: string | null;
    smpp_service_key: string | null;
    sdar_mcp_server_id: string | null;
    provider_id: string | null;
    resource_id: string | null;
  }>(
    `SELECT t.device_id,b.smpp_service_key,b.sdar_mcp_server_id,b.provider_id,b.resource_id
       FROM agent_task t LEFT JOIN gowm_device.device_service_binding b
         ON b.binding_id=t.gowm_binding_id AND b.device_id=t.device_id AND b.sdar_service_key=t.sdar_service_key
       WHERE t.task_id=$1 AND ${filter.predicate} FOR KEY SHARE OF t`,
    [taskId, ...filter.values],
  );
  const row = selected.rows[0];
  if (row === undefined) throw new GowmMcpOwnershipError('MCP_TASK_DEVICE_SCOPE_DENIED');
  if (row.device_id === null) {
    await assertNonDeviceServer(client, serverId);
    return nonDevice;
  }
  if (
    row.sdar_mcp_server_id !== serverId ||
    row.smpp_service_key === null ||
    row.provider_id === null ||
    row.resource_id === null
  )
    throw new GowmMcpOwnershipError('MCP_TASK_SERVER_BINDING_MISMATCH');
  if (
    arguments_ !== undefined &&
    Object.hasOwn(arguments_, 'resourceId') &&
    arguments_['resourceId'] !== row.resource_id
  )
    throw new GowmMcpOwnershipError('MCP_TASK_RESOURCE_BINDING_MISMATCH');
  return {
    deviceId: row.device_id,
    smppServiceKey: row.smpp_service_key,
    providerId: row.provider_id,
    resourceId: row.resource_id,
  };
}

export function remoteTaskScopeSql(
  scope: DeviceWorkScope | undefined,
  firstParameter: number,
  alias = 'remote_task_binding',
) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(alias)) throw new Error('SQL_IDENTIFIER_INVALID');
  const task = taskDeviceScopeSql(scope, firstParameter, 'owner_task');
  if (scope === undefined) return task;
  return {
    predicate: `EXISTS(SELECT 1 FROM agent_task owner_task
    WHERE owner_task.task_id=${alias}.agent_task_id AND owner_task.device_id IS NOT DISTINCT FROM ${alias}.device_id
      AND ${task.predicate})`,
    values: task.values,
  };
}

export class GowmMcpOwnershipError extends Error {
  constructor(
    readonly code:
      | 'MCP_NONDEVICE_SERVER_BINDING_FORBIDDEN'
      | 'MCP_DEVICE_TASK_REQUIRED'
      | 'MCP_TASK_DEVICE_SCOPE_DENIED'
      | 'MCP_TASK_SERVER_BINDING_MISMATCH'
      | 'MCP_TASK_RESOURCE_BINDING_MISMATCH',
  ) {
    super(code);
    this.name = 'GowmMcpOwnershipError';
  }
}

async function assertNonDeviceServer(client: Pool | PoolClient, serverId: string): Promise<void> {
  const result = await client.query<{ bound: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM gowm_device.device_service_binding WHERE sdar_mcp_server_id=$1) AS bound',
    [serverId],
  );
  if (result.rows[0]?.bound !== false)
    throw new GowmMcpOwnershipError('MCP_NONDEVICE_SERVER_BINDING_FORBIDDEN');
}

/** Child tables inherit scope through their immutable native binding_id parent. */
export function remoteTaskChildScopeSql(
  scope: DeviceWorkScope | undefined,
  firstParameter: number,
  childAlias: string,
) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(childAlias)) throw new Error('SQL_IDENTIFIER_INVALID');
  const parent = remoteTaskScopeSql(scope, firstParameter, 'scope_binding');
  if (scope === undefined) return parent;
  return {
    predicate: `EXISTS(SELECT 1 FROM remote_task_binding scope_binding
      WHERE scope_binding.binding_id=${childAlias}.binding_id AND ${parent.predicate})`,
    values: parent.values,
  };
}
