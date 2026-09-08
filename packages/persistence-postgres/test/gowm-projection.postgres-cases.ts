import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { PostgresExternalTaskProjectionRepository } from '../src/repositories.js';

export async function verifyGowmProjectionCases(
  pool: Pool,
  scope: DeviceWorkScope,
  run: string,
): Promise<string[]> {
  const devices = scope.allowedDeviceIds;
  assert.equal(devices.length, 2);
  const deviceA = devices[0];
  assert.ok(deviceA);
  const all = new PostgresExternalTaskProjectionRepository(pool, scope);
  const onlyA = new PostgresExternalTaskProjectionRepository(pool, {
    ...scope,
    allowedDeviceIds: [deviceA],
  });
  const projections = devices.map((_, index) => ({
    protocol: 'a2a-v1' as const,
    taskId: `${run}-task-${String(index)}`,
    contextId: `${run}-context`,
    state: 'TASK_STATE_WORKING',
    statusTimestamp: new Date().toISOString(),
    document: { fixture: run, index },
  }));
  const [a, b] = projections;
  assert.ok(a && b);
  for (const projection of projections) await all.save(projection);
  const rows = await pool.query<{ task_id: string; device_id: string }>(
    'SELECT task_id,device_id FROM external_task_projection WHERE task_id=ANY($1::text[]) ORDER BY task_id',
    [projections.map((projection) => projection.taskId)],
  );
  assert.deepEqual(
    rows.rows.map((row) => row.device_id),
    devices,
  );
  assert.equal(await onlyA.find('a2a-v1', b.taskId), undefined);
  const listed = await onlyA.list({
    protocol: 'a2a-v1',
    contextId: `${run}-context`,
    offset: 0,
    limit: 10,
  });
  assert.deepEqual(
    listed.items.map((projection) => projection.taskId),
    [a.taskId],
  );
  assert.equal(listed.total, 1);
  await assert.rejects(onlyA.save(b), { code: 'DEVICE_SCOPE_DENIED' });
  await assert.rejects(all.save({ ...a, contextId: 'wrong-context' }), {
    code: 'DEVICE_SCOPE_DENIED',
  });
  await all.save({ ...a, state: 'TASK_STATE_COMPLETED', document: { final: true } });
  await all.save(a);
  assert.equal((await onlyA.find('a2a-v1', a.taskId))?.state, 'TASK_STATE_COMPLETED');
  const none = new PostgresExternalTaskProjectionRepository(pool, {
    ...scope,
    allowedDeviceIds: [],
  });
  assert.deepEqual((await none.list({ protocol: 'a2a-v1', offset: 0, limit: 10 })).items, []);
  return [
    'A2A projection derives device from native Task; scoped reads/writes/counts reject foreign ownership and context while retaining terminal monotonicity',
  ];
}
