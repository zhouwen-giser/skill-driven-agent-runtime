import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { SkillCallWorkflowRecord } from '../../domain/src/index.js';
import { PostgresSkillCallWorkflowRepository } from '../src/repositories.js';

/** Storage-only association fixtures reuse normal Task plans; they do not execute children. */
export async function verifyGowmSkillChildScope(
  pool: Pool,
  taskIds: readonly string[],
): Promise<void> {
  const rows = await pool.query<{
    task_id: string;
    device_id: string;
    sdar_service_key: string;
    instance_id: string;
    plan_id: string;
  }>(
    `SELECT task.task_id,task.device_id,task.sdar_service_key,wi.instance_id,plan.plan_id
     FROM agent_task task JOIN workflow_plan plan ON plan.gowm_task_id=task.task_id
     JOIN workflow_instance wi ON wi.plan_id=plan.plan_id WHERE task.task_id=ANY($1::text[])
     ORDER BY task.task_id`,
    [taskIds],
  );
  const [a, b] = rows.rows;
  assert.ok(a);
  assert.ok(b);
  assert.notEqual(a.device_id, b.device_id);
  const skill = (
    await pool.query<{ skill_id: string; version: number }>(
      'SELECT skill_id,version FROM skill_version ORDER BY skill_id,version LIMIT 1',
    )
  ).rows[0];
  assert.ok(skill);
  const scope = {
    allowedDeviceIds: [a.device_id, b.device_id],
    sdarServiceKey: a.sdar_service_key,
    includeNonDevice: false,
  };
  const own = new PostgresSkillCallWorkflowRepository(pool, {
    ...scope,
    allowedDeviceIds: [a.device_id],
  });
  const all = new PostgresSkillCallWorkflowRepository(pool, scope);
  const records: SkillCallWorkflowRecord[] = [];
  for (const row of [a, b]) {
    const id = randomUUID();
    const record: SkillCallWorkflowRecord = {
      callId: id,
      parentPlanId: row.plan_id,
      parentInstanceId: row.instance_id,
      parentNodeId: 'storage-fixture',
      parentNodeRunId: `${id}-run`,
      childPlanId: row.plan_id,
      skillId: skill.skill_id,
      skillVersion: skill.version,
      confirmationStatus: 'confirmed',
      status: 'running',
      evaluationSummary: 'Association scope fixture only',
      createdAt: new Date().toISOString(),
    };
    await all.save(record);
    await all.save(record);
    records.push(record);
  }
  const [recordA, recordB] = records;
  assert.ok(recordA);
  assert.ok(recordB);
  assert.ok(recordA.parentNodeRunId);
  assert.ok(recordB.parentNodeRunId);
  assert.ok(await own.find(a.instance_id, recordA.parentNodeRunId));
  assert.equal(await own.find(b.instance_id, recordB.parentNodeRunId), undefined);
  assert.deepEqual(await own.listByParent(b.instance_id), []);
  await assert.rejects(own.save(recordB), /SKILL_CALL_DEVICE_SCOPE_DENIED/u);
  await assert.rejects(
    all.save({ ...recordA, childPlanId: b.plan_id }),
    /SKILL_CALL_DEVICE_SCOPE_DENIED/u,
  );
  // Legacy records without node-run identity still cannot hijack an existing call ID.
  const { parentNodeRunId: omitted, ...legacy } = recordA;
  void omitted;
  await assert.rejects(
    all.save({
      ...legacy,
      parentPlanId: b.plan_id,
      parentInstanceId: b.instance_id,
      childPlanId: b.plan_id,
    }),
    /SKILL_CALL_IDENTITY_CONFLICT/u,
  );
  assert.deepEqual(await own.find(a.instance_id, recordA.parentNodeRunId), recordA);
}
