import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';

/** Column aliases and parameter positions are adapter-owned, never request data. */
export function taskDeviceScopeSql(
  scope: DeviceWorkScope | undefined,
  firstParameter: number,
  alias = 'agent_task',
): { readonly predicate: string; readonly values: readonly unknown[] } {
  if (scope === undefined) return { predicate: 'TRUE', values: [] };
  if (
    !/^[a-z_][a-z0-9_]*$/u.test(alias) ||
    !Number.isSafeInteger(firstParameter) ||
    firstParameter < 1
  )
    throw new Error('DEVICE_SCOPE_SQL_INVALID');
  return {
    predicate: `((${alias}.device_id=ANY($${String(firstParameter)}::text[]) AND ${alias}.sdar_service_key=$${String(firstParameter + 1)}) OR (${alias}.device_id IS NULL AND $${String(firstParameter + 2)}::boolean))`,
    values: [scope.allowedDeviceIds, scope.sdarServiceKey, scope.includeNonDevice],
  };
}

/** Adapter-owned child alias with a native task_id; no parallel ownership column. */
export function taskChildScopeSql(
  scope: DeviceWorkScope | undefined,
  firstParameter: number,
  alias: string,
) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(alias)) throw new Error('DEVICE_SCOPE_SQL_INVALID');
  const owner = taskDeviceScopeSql(scope, firstParameter, 'scope_task');
  if (scope === undefined) return owner;
  return {
    predicate: `EXISTS(SELECT 1 FROM agent_task scope_task WHERE scope_task.task_id=${alias}.task_id AND ${owner.predicate})`,
    values: owner.values,
  };
}

/** Pinned GOWM stores remote Workflow inputs as workflow; the exact link is authoritative. */
export function taskInputSourceProjection(scope: DeviceWorkScope | undefined, alias: string) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(alias)) throw new Error('DEVICE_SCOPE_SQL_INVALID');
  if (scope === undefined) return '';
  return `,CASE WHEN ${alias}.source='workflow' AND EXISTS(
    SELECT 1 FROM remote_task_input_link source_link JOIN remote_task_binding source_binding
      ON source_binding.binding_id=source_link.binding_id
    WHERE source_link.input_request_id=${alias}.input_request_id AND source_binding.agent_task_id=${alias}.task_id
  ) THEN 'remote_task' ELSE ${alias}.source END AS source`;
}
