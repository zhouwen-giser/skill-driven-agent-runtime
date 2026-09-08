import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { createAgentTask, type AgentTask } from '../../domain/src/task.js';
import {
  PostgresAgentTaskRepository,
  PostgresTaskInputRepository,
  PostgresTaskWaitPolicyRepository,
} from '../src/repositories.js';

export async function verifyGowmWaitTimeoutCases(
  pool: Pool,
  scope: DeviceWorkScope,
  run: string,
): Promise<string[]> {
  const tasks = new PostgresAgentTaskRepository(pool, undefined, undefined, scope);
  const inputs = new PostgresTaskInputRepository(pool, undefined, undefined, scope);
  const before = '2026-01-01T00:00:00.000Z';
  const now = '2026-01-02T00:00:00.000Z';
  const created: AgentTask[] = [];
  for (const index of [0, 1]) {
    const parent = await tasks.findById(`${run}-task-${String(index)}`);
    assert.ok(parent?.deviceOwnership);
    const task = {
      ...createAgentTask({
        taskId: `${run}-wait-${String(index)}`,
        contextId: parent.contextId,
        userId: parent.userId,
        requestText: 'Synthetic wait timeout',
        requestMetadata: {},
        timestamp: before,
        deviceOwnership: parent.deviceOwnership,
      }),
      phase: 'awaiting_user_input' as const,
    };
    await tasks.save(task);
    await inputs.createRequest({
      inputRequestId: `${task.taskId}-input`,
      taskId: task.taskId,
      contextId: task.contextId,
      source: 'workflow',
      question: 'Synthetic pending input',
      status: 'waiting',
      createdAt: before,
    });
    created.push(task);
  }
  const a = created[0];
  const b = created[1];
  assert.ok(a?.deviceOwnership && b?.deviceOwnership);
  const notifications: AgentTask[] = [];
  const timeout = new PostgresTaskWaitPolicyRepository(pool, (task) => notifications.push(task), {
    ...scope,
    allowedDeviceIds: [a.deviceOwnership.deviceId],
  });
  const expired = await timeout.expireWaiting(before, now);
  assert.equal(expired.length, 1);
  assert.equal(expired[0]?.taskId, a.taskId);
  assert.deepEqual(expired[0].deviceOwnership, a.deviceOwnership);
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0]?.deviceOwnership, a.deviceOwnership);
  assert.equal((await tasks.findById(a.taskId))?.phase, 'canceled');
  assert.equal((await tasks.findById(b.taskId))?.phase, 'awaiting_user_input');
  assert.equal((await inputs.findRequest(`${a.taskId}-input`))?.status, 'expired');
  assert.equal((await inputs.findRequest(`${b.taskId}-input`))?.status, 'waiting');
  const events = await pool.query<{ task_id: string }>(
    'SELECT task_id FROM runtime_event WHERE task_id=ANY($1::text[]) AND event_timestamp=$2 ORDER BY task_id',
    [[a.taskId, b.taskId], now],
  );
  assert.deepEqual(events.rows, [{ task_id: a.taskId }]);
  assert.deepEqual(await timeout.expireWaiting(before, now), []);
  assert.equal(notifications.length, 1);
  const foreignService = new PostgresTaskWaitPolicyRepository(pool, undefined, {
    ...scope,
    sdarServiceKey: 'not-this-service',
  });
  assert.deepEqual(await foreignService.expireWaiting(before, now), []);
  assert.equal((await tasks.findById(b.taskId))?.phase, 'awaiting_user_input');
  const withNonDevice = { ...scope, includeNonDevice: true };
  const mixedTasks = new PostgresAgentTaskRepository(pool, undefined, undefined, withNonDevice);
  const nonDevice = {
    ...createAgentTask({
      taskId: `${run}-wait-nondevice`,
      contextId: a.contextId,
      userId: a.userId,
      requestText: 'Independent non-device wait',
      requestMetadata: {},
      timestamp: before,
    }),
    phase: 'awaiting_user_input' as const,
  };
  await mixedTasks.save(nonDevice);
  assert.deepEqual(await timeout.expireWaiting(before, now), []);
  assert.equal((await mixedTasks.findById(nonDevice.taskId))?.phase, 'awaiting_user_input');
  const none = new PostgresTaskWaitPolicyRepository(pool, undefined, {
    ...scope,
    allowedDeviceIds: [],
  });
  assert.deepEqual(await none.expireWaiting(before, now), []);
  const nonDeviceOnly = new PostgresTaskWaitPolicyRepository(pool, undefined, {
    ...withNonDevice,
    allowedDeviceIds: [],
  });
  assert.deepEqual(
    (await nonDeviceOnly.expireWaiting(before, now)).map((task) => task.taskId),
    [nonDevice.taskId],
  );
  assert.equal((await tasks.findById(b.taskId))?.phase, 'awaiting_user_input');
  return [
    'Wait timeout sweep cancels only the allowed device/service, expires only its input, preserves ownership in callbacks and emits one native event on repeat; explicit non-device cleanup never widens an empty device allowlist',
  ];
}
