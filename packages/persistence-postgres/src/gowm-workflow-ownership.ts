import type { PoolClient } from 'pg';

import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import type { WorkflowPlanAttempt } from '../../domain/src/workflow.js';
import { taskDeviceScopeSql } from './gowm-work-scope.js';

export function workflowPlanScopeSql(scope: DeviceWorkScope | undefined, firstParameter: number) {
  const taskScope = taskDeviceScopeSql(scope, firstParameter, 'owner_task');
  if (scope === undefined) return taskScope;
  return {
    predicate: `((workflow_plan.device_id IS NULL AND $${String(firstParameter + 2)}::boolean)
      OR EXISTS(SELECT 1 FROM agent_task owner_task WHERE owner_task.task_id=workflow_plan.gowm_task_id
        AND owner_task.device_id=workflow_plan.device_id AND ${taskScope.predicate}))`,
    values: taskScope.values,
  };
}

export async function readGowmWorkflowDevice(
  client: PoolClient,
  scope: DeviceWorkScope,
  reference: { planId: string } | { instanceId: string },
): Promise<string | null> {
  const filter = workflowPlanScopeSql(scope, 2);
  const row = await client.query<{ device_id: string | null }>(
    'planId' in reference
      ? `SELECT workflow_plan.device_id FROM workflow_plan WHERE plan_id=$1 AND ${filter.predicate} FOR KEY SHARE`
      : `SELECT workflow_plan.device_id FROM workflow_instance JOIN workflow_plan USING(plan_id)
          WHERE instance_id=$1 AND ${filter.predicate} FOR KEY SHARE OF workflow_plan`,
    ['planId' in reference ? reference.planId : reference.instanceId, ...filter.values],
  );
  if (row.rows[0] === undefined) throw new Error('WORKFLOW_DEVICE_SCOPE_DENIED');
  return row.rows[0].device_id;
}

export interface GowmPlanOwner {
  readonly deviceId: string | null;
  readonly taskId: string | null;
}

export async function readGowmPlanOwner(
  client: PoolClient,
  scope: DeviceWorkScope,
  executionTaskId: string | undefined,
): Promise<GowmPlanOwner> {
  // Shared planning definitions are intentionally not owned by their first consumer.
  if (executionTaskId === undefined) return { deviceId: null, taskId: null };
  const filter = taskDeviceScopeSql(scope, 2);
  const task = await client.query<{ device_id: string | null }>(
    `SELECT device_id FROM agent_task WHERE task_id=$1 AND ${filter.predicate} FOR KEY SHARE`,
    [executionTaskId, ...filter.values],
  );
  const row = task.rows[0];
  if (row === undefined) throw new Error('WORKFLOW_TASK_DEVICE_SCOPE_DENIED');
  return { deviceId: row.device_id, taskId: row.device_id === null ? null : executionTaskId };
}

/** Persist the real planning root and its attempt in one caller-owned transaction. */
export async function ensureGowmPlanningRoot(
  client: PoolClient,
  attempt: WorkflowPlanAttempt,
  owner: GowmPlanOwner,
): Promise<void> {
  await client.query(
    `INSERT INTO workflow_plan(plan_id,goal_id,goal_version,goal_contract_json,
       confirmation_status,attempt_count,created_at,device_id,gowm_task_id)
     VALUES($1,$2,$3,$4::jsonb,'awaiting_confirmation',$5,$6,$7,$8)
     ON CONFLICT(plan_id) DO NOTHING`,
    [
      attempt.planId,
      attempt.goalContract.goalId,
      attempt.goalContract.version,
      JSON.stringify(attempt.goalContract),
      attempt.attempt,
      attempt.createdAt,
      owner.deviceId,
      owner.taskId,
    ],
  );
  const root = await client.query(
    `SELECT plan_id FROM workflow_plan WHERE plan_id=$1
       AND device_id IS NOT DISTINCT FROM $2::text AND gowm_task_id IS NOT DISTINCT FROM $3::text
       AND goal_contract_json=$4::jsonb AND definition_json IS NULL
       AND confirmation_status='awaiting_confirmation' FOR UPDATE`,
    [attempt.planId, owner.deviceId, owner.taskId, JSON.stringify(attempt.goalContract)],
  );
  if (root.rowCount !== 1) throw new Error('WORKFLOW_PLANNING_ROOT_CONFLICT');
}

/** Finalize only an unexecuted planning root; never mutate a finalized definition. */
export const GOWM_FINALIZE_PLANNING_ROOT_SQL = `
 ON CONFLICT(plan_id) DO UPDATE SET
   skill_goal_id=EXCLUDED.skill_goal_id,skill_attempt_id=EXCLUDED.skill_attempt_id,
   composition_context_json=EXCLUDED.composition_context_json,
   capability_gap_skill_ids_json=EXCLUDED.capability_gap_skill_ids_json,
   tool_execution_semantics_json=EXCLUDED.tool_execution_semantics_json,
   definition_json=EXCLUDED.definition_json,source_confirmed_plan_id=EXCLUDED.source_confirmed_plan_id,
   source_plan_id=EXCLUDED.source_plan_id,mcp_protocol_contract_json=EXCLUDED.mcp_protocol_contract_json,
   revision_kind=EXCLUDED.revision_kind,confirmation_status=EXCLUDED.confirmation_status,
   attempt_count=EXCLUDED.attempt_count
 WHERE workflow_plan.definition_json IS NULL AND workflow_plan.confirmation_status='awaiting_confirmation'
   AND workflow_plan.device_id IS NOT DISTINCT FROM EXCLUDED.device_id
   AND workflow_plan.gowm_task_id IS NOT DISTINCT FROM EXCLUDED.gowm_task_id
   AND workflow_plan.goal_contract_json=EXCLUDED.goal_contract_json`;
