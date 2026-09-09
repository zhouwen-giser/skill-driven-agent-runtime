import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { PostgresRuntimeRecoveryRepository } from '../src/repositories.js';

export async function verifyGowmRecoveryCases(
  pool: Pool,
  scope: DeviceWorkScope,
  run: string,
): Promise<string[]> {
  const timestamp = new Date().toISOString();
  for (const index of [0, 1]) {
    const taskId = `${run}-task-${String(index)}`;
    await pool.query("UPDATE agent_task SET phase='executing' WHERE task_id=$1", [taskId]);
    await pool.query(
      `INSERT INTO task_execution_attempt(attempt_id,task_id,context_id,reason,status,created_at,started_at)
       VALUES($1,$2,$3,'initial','running',$4,$4)`,
      [`${taskId}-attempt`, taskId, `${run}-context`, timestamp],
    );
  }
  const notifications: string[] = [];
  const deviceId = scope.allowedDeviceIds[0];
  assert.ok(deviceId);
  const repo = new PostgresRuntimeRecoveryRepository(
    pool,
    (task) => notifications.push(task.taskId),
    {
      deviceScope: { ...scope, allowedDeviceIds: [deviceId] },
      preserveRemoteWaits: true,
    },
  );
  const result = await repo.failInterrupted(timestamp);
  assert.equal(result.tasks, 1);
  assert.equal(result.taskAttempts, 1);
  assert.ok(result.workflowInstances > 0);
  assert.deepEqual(notifications, [`${run}-task-0`]);
  const tasks = await pool.query<{ task_id: string; phase: string }>(
    'SELECT task_id,phase FROM agent_task WHERE task_id=ANY($1::text[]) ORDER BY task_id',
    [[`${run}-task-0`, `${run}-task-1`]],
  );
  assert.deepEqual(
    tasks.rows.map((row) => row.phase),
    ['failed', 'executing'],
  );
  const attempts = await pool.query<{ status: string }>(
    'SELECT status FROM task_execution_attempt WHERE attempt_id=ANY($1::text[]) ORDER BY task_id',
    [[`${run}-task-0-attempt`, `${run}-task-1-attempt`]],
  );
  assert.deepEqual(
    attempts.rows.map((row) => row.status),
    ['failed', 'running'],
  );
  const instances = await pool.query<{ device_id: string; status: string }>(
    'SELECT device_id,status FROM workflow_instance WHERE instance_id=ANY($1::text[]) ORDER BY instance_id',
    [[`${run}-remote-instance-0`, `${run}-remote-instance-1`]],
  );
  assert.deepEqual(
    instances.rows.map((row) => row.status),
    ['failed', 'running'],
  );
  assert.deepEqual(await repo.failInterrupted(timestamp), {
    tasks: 0,
    workflowInstances: 0,
    taskAttempts: 0,
  });
  assert.equal(notifications.length, 1);
  return [
    'Scoped process-loss recovery fails only the owned Task, attempts and instances; foreign device remains running and repeat recovery publishes no duplicate state',
  ];
}
