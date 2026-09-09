import type { PoolClient } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import type { RuntimeLayeredOutcomeCommit } from '../../domain/src/index.js';
import { taskDeviceScopeSql } from './gowm-work-scope.js';

/** Validate provenance before any outcome write, within its owning transaction. */
export async function requireOutcomeTask(
  client: PoolClient,
  scope: DeviceWorkScope | undefined,
  taskId: string | undefined,
  planId: string,
  goalId?: string,
): Promise<void> {
  if (scope === undefined) return;
  if (taskId === undefined) throw new Error('OUTCOME_EXECUTION_TASK_REQUIRED');
  const filter = taskDeviceScopeSql(scope, 4, 'task');
  const owner = await client.query(
    `SELECT task.task_id FROM agent_task task JOIN user_goal_plan plan
       ON plan.goal_id=task.goal_id AND plan.goal_version=task.goal_version
     WHERE task.task_id=$1 AND plan.plan_id=$2 AND ($3::text IS NULL OR plan.goal_id=$3)
       AND ${filter.predicate} FOR KEY SHARE OF task`,
    [taskId, planId, goalId ?? null, ...filter.values],
  );
  if (owner.rowCount !== 1) throw new Error('OUTCOME_TASK_DEVICE_SCOPE_DENIED');
}

export function requireLayeredOutcomeSource(
  scope: DeviceWorkScope | undefined,
  layered: RuntimeLayeredOutcomeCommit,
  taskId: string,
): void {
  if (scope === undefined) return;
  if (
    [
      layered.taskDecision,
      layered.skillDecision,
      layered.userDecision,
      ...layered.completedEffects,
    ].some((record) => record.executionTaskId !== taskId)
  )
    throw new Error('OUTCOME_EXECUTION_TASK_MISMATCH');
}
