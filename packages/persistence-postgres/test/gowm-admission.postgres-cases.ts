import { createMcpLogicalInvocationIdentity } from '../../domain/src/mcp-task-consumer-sync.js';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { RemoteTaskAdmissionIntent } from '../../application/src/index.js';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import type { RemoteTaskBinding } from '../../domain/src/remote-task.js';
import {
  PostgresRemoteTaskAdmissionIntentStore,
  PostgresRemoteTaskAdmissionObservationQuery,
} from '../src/remote-task-admission-intent-store.js';

/** Actual intent SQL under the consumer role, including CAS fallback read isolation. */
export async function verifyGowmAdmissionCases(
  pool: Pool,
  scope: DeviceWorkScope,
  bindings: readonly RemoteTaskBinding[],
): Promise<string[]> {
  const all = new PostgresRemoteTaskAdmissionIntentStore(pool, scope);
  const first = bindings[0];
  const second = bindings[1];
  assert.ok(first?.deviceIdentity && second?.deviceIdentity);
  const ownScope = { ...scope, allowedDeviceIds: [first.deviceIdentity.deviceId] };
  const own = new PostgresRemoteTaskAdmissionIntentStore(pool, ownScope);
  const intents: RemoteTaskAdmissionIntent[] = bindings.map((binding) => {
    const logicalIdentity = createMcpLogicalInvocationIdentity({
      ...binding,
      taskId: binding.agentTaskId,
      workflowNodeRunId: `${binding.workflowNodeRunId}-intent`,
      argumentsHash: 'a'.repeat(64),
    });
    return {
      intentId: `${binding.bindingId}-intent`,
      invocationId: `${binding.mcpInvocationId}-intent`,
      taskId: binding.agentTaskId,
      contextId: binding.contextId,
      serverId: binding.serverId,
      operationName: binding.operationName,
      argumentsHash: 'a'.repeat(64),
      logicalIdentity,
      reconciliationSeed: {
        schemaVersion: 'sdar.remote-task-reconciliation-seed/v1',
        logicalIdentity,
        arguments: {},
        executionContext: binding.executionContext,
      },
      envelope: {
        bindingId: `${binding.bindingId}-intent`,
        serverId: binding.serverId,
        operationName: binding.operationName,
        agentTaskId: binding.agentTaskId,
        contextId: binding.contextId,
        goalId: binding.goalId,
        goalVersion: binding.goalVersion,
        workflowPlanId: binding.workflowPlanId,
        workflowDefinitionId: binding.workflowDefinitionId,
        workflowDefinitionVersion: binding.workflowDefinitionVersion,
        workflowInstanceId: binding.workflowInstanceId,
        workflowNodeId: binding.workflowNodeId,
        workflowNodeRunId: `${binding.workflowNodeRunId}-intent`,
        mcpInvocationId: `${binding.mcpInvocationId}-intent`,
        executionContext: binding.executionContext,
        createdAt: binding.createdAt,
      },
      status: 'prepared',
      createdAt: binding.createdAt,
      updatedAt: binding.createdAt,
      version: 1,
    };
  });
  for (const intent of intents) {
    assert.equal((await all.prepare(intent)).created, true);
    assert.equal((await all.prepare(intent)).created, false);
  }
  const a = intents[0];
  const b = intents[1];
  assert.ok(a && b);
  await assert.rejects(own.prepare(b), /MCP_TASK_DEVICE_SCOPE_DENIED/u);
  assert.equal(await own.findByBindingId(b.envelope.bindingId), undefined);
  const recoverable = await own.listRecoverable(1000);
  assert.ok(recoverable.some((intent) => intent.intentId === a.intentId));
  assert.ok(recoverable.every((intent) => intent.taskId === a.taskId));
  const observations = new PostgresRemoteTaskAdmissionObservationQuery(pool, ownScope);
  assert.deepEqual(await observations.listByAgentTaskId(b.taskId), []);
  assert.equal((await observations.listByAgentTaskId(a.taskId)).length, 1);
  const dispatch = {
    intentId: b.intentId,
    invocationId: b.invocationId,
    dispatchHash: `sha256:${'d'.repeat(64)}`,
    at: b.createdAt,
  };
  assert.deepEqual(await own.markDispatching(dispatch), { applied: false, reason: 'missing' });
  assert.equal((await all.markDispatching(dispatch)).applied, true);
  // The update cannot apply now; the fallback SELECT must still hide the foreign row.
  assert.deepEqual(await own.markDispatching(dispatch), { applied: false, reason: 'missing' });
  const finish = { ...dispatch, reasonCode: 'TEST_UNCERTAIN' };
  assert.deepEqual(await own.markUncertain(finish), { applied: false, reason: 'missing' });
  assert.deepEqual(await own.close(finish), { applied: false, reason: 'missing' });
  assert.deepEqual(await own.closeReceiptAsUncertain(finish), {
    applied: false,
    reason: 'missing',
  });
  assert.deepEqual(
    await own.markMaterialized({
      ...dispatch,
      bindingId: b.envelope.bindingId,
      snapshotId: 'absent',
    }),
    { applied: false, reason: 'missing' },
  );
  assert.equal((await all.findByBindingId(b.envelope.bindingId))?.version, 2);
  assert.equal((await all.markUncertain(finish)).applied, true);
  assert.equal((await all.findByBindingId(b.envelope.bindingId))?.version, 3);
  assert.equal(
    (await own.close({ ...finish, intentId: a.intentId, invocationId: a.invocationId })).applied,
    true,
  );
  return [
    'Device-scoped admission preparation, recovery scan, observation and CAS fallback exclude foreign Tasks and preserve their intent version',
  ];
}
