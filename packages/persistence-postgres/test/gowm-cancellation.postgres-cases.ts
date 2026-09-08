import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import {
  createRemoteTaskCancellationRequest,
  type RemoteTaskBinding,
} from '../../domain/src/remote-task.js';
import { PostgresRemoteTaskCancellationRepository } from '../src/remote-task-cancellation-repository.js';
import { PostgresRemoteTaskLifecycleQuery } from '../src/remote-task-lifecycle-query.js';

export async function verifyGowmCancellationCases(
  pool: Pool,
  scope: DeviceWorkScope,
  bindings: readonly RemoteTaskBinding[],
): Promise<string[]> {
  const a = bindings[0];
  const b = bindings[1];
  assert.ok(a?.deviceIdentity && b?.deviceIdentity);
  const owned = { ...scope, allowedDeviceIds: [a.deviceIdentity.deviceId] };
  const all = new PostgresRemoteTaskCancellationRepository(pool, scope);
  const own = new PostgresRemoteTaskCancellationRepository(pool, owned);
  const makeRequest = (binding: RemoteTaskBinding) =>
    createRemoteTaskCancellationRequest({
      requestId: `${binding.bindingId}-cancel`,
      bindingId: binding.bindingId,
      idempotencyKey: 'shared-cancel-key',
      source: 'management',
      reasonCode: 'TEST_CANCEL',
      summary: 'Synthetic cancellation; no network dispatch',
      requestedAt: binding.createdAt,
    });
  const foreign = makeRequest(b);
  assert.deepEqual(await own.requestCancellation(foreign, b.version), {
    requested: false,
    reason: 'missing',
  });
  for (const binding of bindings) {
    const request = makeRequest(binding);
    const created = await all.requestCancellation(request, binding.version);
    assert.ok(created.requested && created.created);
    const replay = await all.requestCancellation(request, binding.version);
    assert.ok(replay.requested && !replay.created);
  }
  assert.equal(await own.findCancellation(foreign.requestId), undefined);
  const pending = await own.listRequiringDelivery(b.createdAt, 1000);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.bindingId, a.bindingId);
  const claim = {
    requestId: foreign.requestId,
    expectedVersion: 1,
    claimToken: 'test-claim',
    claimedAt: b.createdAt,
    expiresAt: new Date(Date.parse(b.createdAt) + 30000).toISOString(),
  };
  assert.deepEqual(await own.claimCancellation(claim), { claimed: false, reason: 'missing' });
  const claimed = await all.claimCancellation(claim);
  assert.ok(claimed.claimed);
  const attempt = {
    attemptId: `${foreign.requestId}-attempt`,
    requestId: foreign.requestId,
    bindingId: b.bindingId,
    expectedRequestVersion: claimed.request.version,
    protocolRevision: '2026-07-28',
    status: 'acknowledged' as const,
    startedAt: b.createdAt,
    completedAt: b.createdAt,
    durationMs: 0,
  };
  const outcome = {
    requestId: foreign.requestId,
    expectedVersion: claimed.request.version,
    claimToken: claim.claimToken,
    attempt,
    acknowledgedAt: b.createdAt,
    protocolRevision: '2026-07-28',
  };
  assert.deepEqual(await own.recordCancellationAcknowledged(outcome), {
    applied: false,
    reason: 'missing',
  });
  assert.equal((await all.listCancellationAttempts(foreign.requestId)).length, 0);
  await assert.rejects(
    all.recordCancellationAcknowledged({
      ...outcome,
      attempt: { ...attempt, bindingId: a.bindingId },
    }),
    /REMOTE_TASK_CANCELLATION_ATTEMPT_IDENTITY_MISMATCH/u,
  );
  assert.equal((await all.listCancellationAttempts(foreign.requestId)).length, 0);
  assert.equal((await all.recordCancellationAcknowledged(outcome)).applied, true);
  assert.deepEqual(await own.listCancellationAttempts(foreign.requestId), []);
  assert.equal((await all.listCancellationAttempts(foreign.requestId)).length, 1);
  assert.deepEqual(
    await own.resolveCancellationFromProvider(b.bindingId, 'cancelled', b.createdAt),
    [],
  );
  assert.equal((await all.findCancellation(foreign.requestId))?.providerTerminalStatus, undefined);
  assert.equal(
    (await all.resolveCancellationFromProvider(b.bindingId, 'cancelled', b.createdAt)).length,
    1,
  );
  const projection = new PostgresRemoteTaskLifecycleQuery(pool, owned);
  assert.deepEqual(await projection.listByAgentTaskId(b.agentTaskId), []);
  const ownProjection = await projection.listByAgentTaskId(a.agentTaskId);
  const ownBinding = ownProjection.find((item) => item.binding.bindingId === a.bindingId);
  assert.equal(ownBinding?.cancellations.length, 1);
  assert.equal(ownBinding.cancellations[0]?.request.bindingId, a.bindingId);
  return [
    'Cancellation request/delivery/claim/outcome/terminal reconciliation and lifecycle projection are device-scoped; cross-binding attempt injection rolls back without an audit row',
  ];
}
