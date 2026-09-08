import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import {
  createWorkflowContinuationSnapshot,
  createWorkflowContinuationAttempt,
} from '../../domain/src/workflow-continuation.js';
import type { RemoteTaskBinding } from '../../domain/src/remote-task.js';
import { PostgresWorkflowContinuationRepository } from '../src/workflow-continuation-repository.js';

/** Native continuation persistence and worker boundary; no checkpoint is executed here. */
export async function verifyGowmContinuationCases(
  pool: Pool,
  scope: DeviceWorkScope,
  bindings: readonly RemoteTaskBinding[],
): Promise<string[]> {
  const a = bindings[0];
  const b = bindings[1];
  assert.ok(a?.deviceIdentity && b?.deviceIdentity);
  const all = new PostgresWorkflowContinuationRepository(pool, scope);
  const own = new PostgresWorkflowContinuationRepository(pool, {
    ...scope,
    allowedDeviceIds: [a.deviceIdentity.deviceId],
  });
  const snapshots = [];
  for (const binding of bindings) {
    const id = `${binding.bindingId}-continuation`;
    await pool.query(
      `INSERT INTO workflow_control(control_id,context_id,goal_id,goal_version,task_id,status,current_plan_id,input_json,skill_ids_json,planning_instruction,round_count,replan_count,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,'running',$6,'{}'::jsonb,'[]'::jsonb,'Synthetic continuation',0,0,$7,$7)`,
      [
        id,
        binding.contextId,
        binding.goalId,
        binding.goalVersion,
        binding.agentTaskId,
        binding.workflowPlanId,
        binding.createdAt,
      ],
    );
    const snapshot = createWorkflowContinuationSnapshot({
      schemaVersion: '1.0',
      snapshotId: id,
      continuationId: id,
      stateVersion: 1,
      lifecycle: 'building',
      agentTaskId: binding.agentTaskId,
      contextId: binding.contextId,
      workflowControlId: id,
      goalId: binding.goalId,
      goalVersion: binding.goalVersion,
      workflowPlanId: binding.workflowPlanId,
      workflowDefinitionId: binding.workflowDefinitionId,
      workflowDefinitionVersion: binding.workflowDefinitionVersion,
      workflowDefinitionHash: 'b'.repeat(64),
      inputHash: 'c'.repeat(64),
      workflowInstanceId: binding.workflowInstanceId,
      input: {},
      waitingNodeRuns: [
        {
          waitId: id,
          kind: 'remote_task',
          sourceId: binding.bindingId,
          nodeId: binding.workflowNodeId,
          nodeRunId: binding.workflowNodeRunId,
          state: 'waiting',
        },
      ],
      runnableFrontier: [],
      completedNodeRunIds: [],
      nodeRunCounts: { [binding.workflowNodeId]: 1 },
      outputs: {},
      errors: {},
      routes: {},
      loopCounts: {},
      recoveryCounts: {},
      parallelJoinState: [],
      failed: false,
      executionContext: binding.executionContext,
      budgetLimits: {
        maxReplans: 0,
        maxDurationSeconds: 60,
        maxLlmCalls: 0,
        maxMcpCalls: 10,
        maxCost: 10,
      },
      budgetUsage: { replanCount: 0, durationMs: 0, llmCalls: 0, mcpCalls: 1, cost: 0 },
      createdAt: binding.createdAt,
      updatedAt: binding.createdAt,
    });
    await all.saveSnapshot(snapshot);
    await all.saveSnapshot(snapshot);
    snapshots.push(snapshot);
  }
  const first = snapshots[0];
  const second = snapshots[1];
  assert.ok(first && second);
  await assert.rejects(
    all.saveSnapshot({ ...first, input: { changed: true } }),
    /snapshot identity is already bound to different evidence/u,
  );
  assert.equal(await own.findById(second.snapshotId), undefined);
  assert.equal(
    await own.findLatestForWait(second.workflowInstanceId, {
      kind: 'remote_task',
      sourceId: b.bindingId,
      nodeId: b.workflowNodeId,
    }),
    undefined,
  );
  await assert.rejects(own.saveSnapshot(second), /WORKFLOW_CONTINUATION_DEVICE_SCOPE_DENIED/u);
  await assert.rejects(
    all.saveSnapshot({
      ...second,
      snapshotId: `${second.snapshotId}-wrong-owner`,
      continuationId: `${second.continuationId}-wrong-owner`,
      agentTaskId: a.agentTaskId,
    }),
    /WORKFLOW_CONTINUATION_DEVICE_SCOPE_DENIED/u,
  );
  await assert.rejects(
    all.saveSnapshot({
      ...second,
      snapshotId: `${second.snapshotId}-wrong-control`,
      continuationId: `${second.continuationId}-wrong-control`,
      workflowControlId: first.workflowControlId,
    }),
    /WORKFLOW_CONTINUATION_DEVICE_SCOPE_DENIED/u,
  );
  await assert.rejects(
    own.transitionLifecycle(second.snapshotId, 'building', 'active', b.createdAt),
    /continuation lifecycle changed/u,
  );
  for (const snapshot of snapshots)
    await all.transitionLifecycle(snapshot.snapshotId, 'building', 'active', snapshot.createdAt);
  assert.equal(await own.findCurrentByBinding(b.bindingId), undefined);
  assert.equal(await own.findCurrent(b.workflowInstanceId), undefined);
  assert.equal((await own.findCurrentByBinding(a.bindingId))?.snapshotId, first.snapshotId);
  // A pending native control row with a real wait/snapshot supplies worker authority.
  const eventId = `${b.bindingId}-scope-event`;
  await pool.query(
    `INSERT INTO remote_task_control_event(event_id,binding_id,event_type,remote_revision,result_hash,payload_json,status,created_at)
    VALUES($1,$2,'task.completed','scope-test',$3,'{}'::jsonb,'pending',$4)`,
    [eventId, b.bindingId, 'd'.repeat(64), b.createdAt],
  );
  await pool.query(
    "UPDATE remote_task_binding SET local_state='terminal_event_pending',next_poll_at=NULL WHERE binding_id=$1",
    [b.bindingId],
  );
  assert.ok((await all.listInbox(b.createdAt, 1000)).some((event) => event.eventId === eventId));
  assert.ok((await own.listInbox(b.createdAt, 1000)).every((event) => event.eventId !== eventId));
  const claim = {
    eventId,
    claimToken: `${eventId}-claim`,
    claimedAt: b.createdAt,
    expiresAt: new Date(Date.parse(b.createdAt) + 30000).toISOString(),
  };
  assert.equal(await own.claimControl(claim), undefined);
  assert.equal((await all.claimControl(claim))?.eventId, eventId);
  const attempt = createWorkflowContinuationAttempt({
    attemptId: `${eventId}-attempt`,
    eventId,
    snapshotId: second.snapshotId,
    continuationId: second.continuationId,
    workflowInstanceId: second.workflowInstanceId,
    snapshotStateVersion: second.stateVersion,
    claimToken: claim.claimToken,
    status: 'claimed',
    createdAt: b.createdAt,
  });
  await assert.rejects(own.saveAttempt(attempt), /continuation attempt identity/u);
  await all.saveAttempt(attempt);
  await all.saveAttempt(attempt);
  await assert.rejects(
    all.saveAttempt({ ...attempt, claimToken: `${claim.claimToken}-changed` }),
    /continuation attempt identity/u,
  );
  assert.equal(await own.findAttempt(attempt.attemptId), undefined);
  assert.equal(await own.findLatestAttemptByEvent(eventId), undefined);
  assert.deepEqual(await own.listAttempts(b.workflowInstanceId), []);
  await assert.rejects(
    own.updateAttempt(attempt, 'claimed'),
    /continuation attempt status changed/u,
  );
  await assert.rejects(
    own.deferControl({ eventId, claimToken: claim.claimToken, errorCode: 'TEST_RETRY' }),
    /remote Task control claim is stale/u,
  );
  await assert.rejects(
    own.finishControl({
      eventId,
      claimToken: claim.claimToken,
      status: 'processed',
      processedAt: b.createdAt,
    }),
    /remote Task control claim is stale/u,
  );
  await all.finishControl({
    eventId,
    claimToken: claim.claimToken,
    status: 'processed',
    processedAt: b.createdAt,
  });
  for (const snapshot of snapshots)
    await all.transitionLifecycle(snapshot.snapshotId, 'active', 'invalidated', snapshot.createdAt);
  // Restore this synthetic control fixture; the test never executes/replays a checkpoint.
  await pool.query(
    "UPDATE remote_task_binding SET local_state='polling',next_poll_at=$2 WHERE binding_id=$1",
    [b.bindingId, b.createdAt],
  );
  return [
    'Continuation snapshots enforce exact Task/Plan/Instance ownership; foreign inbox, claims, lifecycle and attempt mutations are denied without checkpoint execution',
  ];
}
