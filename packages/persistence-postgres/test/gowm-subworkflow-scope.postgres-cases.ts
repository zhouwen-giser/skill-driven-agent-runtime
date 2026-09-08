import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { WorkflowChildCall } from '../../domain/src/index.js';
import { PostgresWorkflowPlanRepository } from '../src/repositories.js';
import { PostgresWorkflowChildCallRepository } from '../src/workflow-child-call-repository.js';

export async function verifyGowmSubworkflowScope(
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
    `SELECT t.task_id,t.device_id,t.sdar_service_key,i.instance_id,p.plan_id FROM agent_task t JOIN workflow_plan p ON p.gowm_task_id=t.task_id JOIN workflow_instance i ON i.plan_id=p.plan_id WHERE t.task_id=ANY($1::text[]) ORDER BY t.task_id`,
    [taskIds],
  );
  const [a, b] = rows.rows;
  assert.ok(a);
  assert.ok(b);
  const scope = {
    allowedDeviceIds: [a.device_id, b.device_id],
    sdarServiceKey: a.sdar_service_key,
    includeNonDevice: false,
  };
  const plans = new PostgresWorkflowPlanRepository(pool, undefined, scope);
  const original = await plans.findPlan(a.plan_id);
  assert.ok(original);
  assert.ok(original.definition);
  const id = randomUUID();
  const { executionTaskId: omitted, ...unowned } = original;
  void omitted;
  const template = {
    ...unowned,
    planId: `${id}-template`,
    definition: { ...original.definition, workflowDefinitionId: `${id}-definition` },
  };
  await new PostgresWorkflowPlanRepository(pool, undefined, {
    ...scope,
    includeNonDevice: true,
  }).savePlan(template);
  const found = await plans.findConfirmedDefinition(
    template.definition.workflowDefinitionId,
    template.definition.version,
  );
  assert.ok(found);
  assert.equal(found.planId, template.planId);
  assert.equal(found.executionTaskId, undefined);
  const calls = new PostgresWorkflowChildCallRepository(pool, scope);
  const ownCalls = new PostgresWorkflowChildCallRepository(pool, {
    ...scope,
    allowedDeviceIds: [a.device_id],
  });
  const records: WorkflowChildCall[] = [];
  for (const row of [a, b]) {
    const executionPlan = {
      ...found,
      planId: `${id}-${row.device_id}`,
      executionTaskId: row.task_id,
      sourceConfirmedPlanId: found.planId,
    };
    await plans.savePlan(executionPlan);
    const stored = await plans.findPlan(executionPlan.planId);
    assert.equal(stored?.executionTaskId, row.task_id);
    const record: WorkflowChildCall = {
      callId: `${id}-${row.task_id}`,
      kind: 'subworkflow',
      parentInstanceId: row.instance_id,
      parentNodeRunId: `${id}-node-run`,
      parentNodeId: 'fixture',
      childPlanId: executionPlan.planId,
      createdAt: new Date().toISOString(),
    };
    assert.deepEqual(await calls.save(record), record);
    assert.deepEqual(await calls.save(record), record);
    records.push(record);
  }
  const [ra, rb] = records;
  assert.ok(ra);
  assert.ok(rb);
  await assert.rejects(ownCalls.save(rb), /WORKFLOW_CHILD_DEVICE_SCOPE_DENIED/u);
  await assert.rejects(
    calls.save({ ...ra, childPlanId: rb.childPlanId }),
    /WORKFLOW_CHILD_DEVICE_SCOPE_DENIED/u,
  );
  assert.equal(await ownCalls.find(rb.parentInstanceId, rb.parentNodeRunId), undefined);
  assert.deepEqual(await ownCalls.listByParent(rb.parentInstanceId), []);
  assert.deepEqual(await ownCalls.find(ra.parentInstanceId, ra.parentNodeRunId), ra);
  const unchanged = await new PostgresWorkflowPlanRepository(pool, undefined, {
    ...scope,
    includeNonDevice: true,
  }).findPlan(template.planId);
  assert.equal(unchanged?.executionTaskId, undefined);
  assert.deepEqual(unchanged?.definition, found.definition);
}
