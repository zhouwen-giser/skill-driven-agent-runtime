import { PostgresTaskInputRepository } from '../src/repositories.js';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import type { RemoteTaskBinding } from '../../domain/src/remote-task.js';
import { PostgresRemoteTaskInputRepository } from '../src/remote-task-input-repository.js';

/** Seed an activated remote input; exercise the native answer and recovery writers. */
export async function verifyGowmInputCases(
  pool: Pool,
  scope: DeviceWorkScope,
  bindings: readonly RemoteTaskBinding[],
): Promise<string[]> {
  const a = bindings[0];
  const b = bindings[1];
  assert.ok(a?.deviceIdentity && b?.deviceIdentity);
  const all = new PostgresRemoteTaskInputRepository(pool, scope);
  const own = new PostgresRemoteTaskInputRepository(pool, {
    ...scope,
    allowedDeviceIds: [a.deviceIdentity.deviceId],
  });
  for (const binding of bindings) {
    const requestId = `${binding.bindingId}-input`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO remote_task_control_event(event_id,binding_id,event_type,remote_revision,result_hash,payload_json,status,created_at,claimed_at,processed_at)
        VALUES($1,$2,'task.input_required','2',$3,'{}'::jsonb,'processed',$4,$4,$4)`,
        [`${requestId}-event`, binding.bindingId, 'a'.repeat(64), binding.createdAt],
      );
      await client.query(
        `INSERT INTO task_input_request(input_request_id,task_id,context_id,source,question,status,created_at,answered_at)
        VALUES($1,$2,$3,'workflow','Synthetic input','waiting',$4,NULL)`,
        [requestId, binding.agentTaskId, binding.contextId, binding.createdAt],
      );
      await client.query(
        `INSERT INTO remote_task_input_link(input_request_id,control_event_id,binding_id,remote_task_id,workflow_instance_id,workflow_node_id,workflow_node_run_id,remote_revision,result_hash,input_requests_json,status,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'2',$8,'{}'::jsonb,'waiting',$9,$9)`,
        [
          requestId,
          `${requestId}-event`,
          binding.bindingId,
          binding.remoteTaskId,
          binding.workflowInstanceId,
          binding.workflowNodeId,
          binding.workflowNodeRunId,
          'a'.repeat(64),
          binding.createdAt,
        ],
      );
      await client.query(
        "UPDATE remote_task_binding SET local_state='awaiting_input',next_poll_at=NULL WHERE binding_id=$1",
        [binding.bindingId],
      );
      await client.query("UPDATE agent_task SET phase='awaiting_user_input' WHERE task_id=$1", [
        binding.agentTaskId,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const taskInputs = new PostgresTaskInputRepository(pool, undefined, undefined, scope);
  const scopedTaskInputs = new PostgresTaskInputRepository(pool, undefined, undefined, {
    ...scope,
    allowedDeviceIds: [a.deviceIdentity.deviceId],
  });
  const requestId = `${b.bindingId}-input`;
  assert.equal((await taskInputs.findRequest(requestId))?.source, 'remote_task');
  assert.equal(await scopedTaskInputs.findRequest(requestId), undefined);
  assert.equal((await taskInputs.findPendingByTask(b.agentTaskId))?.source, 'remote_task');
  assert.equal(await scopedTaskInputs.findPendingByTask(b.agentTaskId), undefined);
  await scopedTaskInputs.cancelPending(b.agentTaskId, 'canceled');
  assert.equal((await taskInputs.findRequest(requestId))?.status, 'waiting');
  const response = {
    inputResponseId: `${requestId}-response`,
    inputRequestId: requestId,
    taskId: b.agentTaskId,
    content: { value: 'synthetic answer' },
    createdAt: b.createdAt,
  };
  const executionAttempt = {
    attemptId: `${requestId}-execution-attempt`,
    taskId: b.agentTaskId,
    contextId: b.contextId,
    reason: 'input_response' as const,
    status: 'queued' as const,
    inputRequestId: requestId,
    createdAt: b.createdAt,
  };
  const answer = {
    inputRequestId: requestId,
    taskId: b.agentTaskId,
    response,
    attempt: executionAttempt,
    answeredAt: b.createdAt,
    continuationPhase: 'executing' as const,
    phaseMessage: 'Resume remote input',
  };
  await assert.rejects(
    scopedTaskInputs.answerAndCreateAttempt(answer),
    /supplementary input request was not found/u,
  );
  await assert.rejects(
    taskInputs.answerAndCreateAttempt({
      ...answer,
      attempt: { ...executionAttempt, taskId: a.agentTaskId },
    }),
    /TASK_INPUT_RESPONSE_IDENTITY_MISMATCH/u,
  );
  assert.equal((await taskInputs.listResponses(b.agentTaskId)).length, 0);
  assert.equal((await taskInputs.answerAndCreateAttempt(answer)).phase, 'executing');
  assert.equal((await all.findLink(requestId))?.status, 'answered');
  assert.equal(
    (await taskInputs.findResponseForAttempt(executionAttempt.attemptId))?.request.source,
    'remote_task',
  );
  assert.equal(
    await scopedTaskInputs.findResponseForAttempt(executionAttempt.attemptId),
    undefined,
  );
  assert.deepEqual(await scopedTaskInputs.listResponses(b.agentTaskId), []);
  assert.equal(await scopedTaskInputs.findAttempt(executionAttempt.attemptId), undefined);
  assert.deepEqual(await scopedTaskInputs.listQueuedAttempts(1000), []);
  assert.ok(
    (await taskInputs.listQueuedAttempts(1000)).some(
      (item) => item.attemptId === executionAttempt.attemptId,
    ),
  );
  await assert.rejects(
    scopedTaskInputs.updateAttempt(executionAttempt.attemptId, 'running', b.createdAt),
    /TASK_ATTEMPT_TRANSITION_INVALID/u,
  );
  assert.equal((await taskInputs.findAttempt(executionAttempt.attemptId))?.status, 'queued');
  await taskInputs.updateAttempt(executionAttempt.attemptId, 'running', b.createdAt);
  await taskInputs.updateAttempt(executionAttempt.attemptId, 'completed', b.createdAt);
  await scopedTaskInputs.cancelPending(a.agentTaskId, 'canceled');
  assert.equal((await scopedTaskInputs.findRequest(`${a.bindingId}-input`))?.status, 'canceled');
  // Ordinary workflow input without a remote link retains its original source.
  const ordinary = {
    inputRequestId: `${a.bindingId}-ordinary`,
    taskId: a.agentTaskId,
    contextId: a.contextId,
    source: 'workflow' as const,
    question: 'Ordinary workflow input',
    status: 'waiting' as const,
    createdAt: a.createdAt,
  };
  await scopedTaskInputs.createRequest(ordinary);
  assert.equal((await scopedTaskInputs.findRequest(ordinary.inputRequestId))?.source, 'workflow');
  await assert.rejects(
    scopedTaskInputs.createRequest({
      ...ordinary,
      inputRequestId: `${ordinary.inputRequestId}-foreign`,
      taskId: b.agentTaskId,
    }),
    /TASK_INPUT_DEVICE_SCOPE_DENIED/u,
  );
  await assert.rejects(
    taskInputs.createRequest({
      ...ordinary,
      inputRequestId: `${ordinary.inputRequestId}-unlinked`,
      source: 'remote_task',
    }),
    /REMOTE_TASK_INPUT_REQUIRES_ATOMIC_LINK/u,
  );

  assert.equal(await own.findLink(requestId), undefined);
  assert.ok(await own.findLink(`${a.bindingId}-input`));
  const state = (
    await pool.query<{ version: string | number; local_state: string }>(
      'SELECT version,local_state FROM remote_task_binding WHERE binding_id=$1',
      [b.bindingId],
    )
  ).rows[0];
  assert.ok(state);
  const attempt = {
    attemptId: `${requestId}-attempt`,
    inputRequestId: requestId,
    bindingId: b.bindingId,
    expectedBindingVersion: Number(state.version),
    status: 'acknowledged' as const,
    protocolRevision: '2026-07-28',
    startedAt: b.createdAt,
    completedAt: b.createdAt,
    durationMs: 0,
  };
  const outcome = {
    inputRequestId: requestId,
    expectedBindingVersion: Number(state.version),
    attempt,
    status: 'update_acknowledged' as const,
    observedAt: b.createdAt,
  };
  assert.deepEqual(await own.recordUpdateOutcome(outcome), { applied: false });
  assert.equal((await all.listAttempts(requestId)).length, 0);
  assert.equal((await all.findLink(requestId))?.status, 'answered');
  await assert.rejects(
    all.recordUpdateOutcome({ ...outcome, attempt: { ...attempt, bindingId: a.bindingId } }),
    /REMOTE_TASK_INPUT_ATTEMPT_IDENTITY_MISMATCH/u,
  );
  assert.equal((await all.listAttempts(requestId)).length, 0);
  assert.deepEqual(await all.recordUpdateOutcome(outcome), { applied: true });
  assert.equal((await all.findLink(requestId))?.status, 'update_acknowledged');
  assert.deepEqual(await own.listAttempts(requestId), []);
  assert.equal((await all.listAttempts(requestId)).length, 1);
  const updated = (
    await pool.query<{ version: string | number; local_state: string }>(
      'SELECT version,local_state FROM remote_task_binding WHERE binding_id=$1',
      [b.bindingId],
    )
  ).rows[0];
  assert.equal(Number(updated?.version), Number(state.version) + 1);
  assert.equal(updated?.local_state, 'polling');
  assert.deepEqual(await all.recordUpdateOutcome(outcome), { applied: false });
  assert.equal((await all.listAttempts(requestId)).length, 1);
  assert.equal((await all.findLink(requestId))?.status, 'update_acknowledged');
  return [
    'Answered-input recovery queries and writes are device-scoped; foreign and mismatched-parent attempts add no row, while the owned outcome advances its binding exactly once',
  ];
}
