import type { PoolClient } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import type { WorkflowContinuationSnapshot } from '../../domain/src/index.js';
import { taskDeviceScopeSql } from './gowm-work-scope.js';

export function continuationScopeSql(
  scope: DeviceWorkScope | undefined,
  firstParameter: number,
  alias = 'workflow_continuation_snapshot',
) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(alias)) throw new Error('DEVICE_SCOPE_SQL_INVALID');
  const owner = taskDeviceScopeSql(scope, firstParameter, 'continuation_owner');
  if (scope === undefined) return owner;
  return {
    predicate: `EXISTS(SELECT 1 FROM agent_task continuation_owner WHERE continuation_owner.task_id=${alias}.agent_task_id AND ${owner.predicate})`,
    values: owner.values,
  };
}

export function continuationAttemptScopeSql(
  scope: DeviceWorkScope | undefined,
  firstParameter: number,
) {
  const parent = continuationScopeSql(scope, firstParameter, 'scope_snapshot');
  if (scope === undefined) return parent;
  return {
    predicate: `EXISTS(SELECT 1 FROM workflow_continuation_snapshot scope_snapshot WHERE scope_snapshot.snapshot_id=workflow_continuation_attempt.snapshot_id AND ${parent.predicate})`,
    values: parent.values,
  };
}

export async function assertContinuationOwner(
  client: PoolClient,
  scope: DeviceWorkScope,
  snapshot: WorkflowContinuationSnapshot,
) {
  const owner = taskDeviceScopeSql(scope, 5, 'owner_task');
  const result = await client.query(
    `SELECT 1 FROM agent_task owner_task JOIN workflow_instance instance ON instance.instance_id=$2
      JOIN workflow_plan plan ON plan.plan_id=instance.plan_id
      JOIN workflow_control control ON control.control_id=$4 AND control.task_id=owner_task.task_id
      WHERE owner_task.task_id=$1 AND plan.plan_id=$3
        AND instance.device_id IS NOT DISTINCT FROM owner_task.device_id
        AND plan.device_id IS NOT DISTINCT FROM owner_task.device_id
        AND (plan.gowm_task_id=owner_task.task_id OR (plan.device_id IS NULL AND plan.gowm_task_id IS NULL))
        AND ${owner.predicate} FOR KEY SHARE OF owner_task,instance,plan`,
    [
      snapshot.agentTaskId,
      snapshot.workflowInstanceId,
      snapshot.workflowPlanId,
      snapshot.workflowControlId,
      ...owner.values,
    ],
  );
  if (result.rowCount !== 1) throw new Error('WORKFLOW_CONTINUATION_DEVICE_SCOPE_DENIED');
}
