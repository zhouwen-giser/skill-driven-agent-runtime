import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import type { RemoteTaskBinding } from '../../domain/src/remote-task.js';
import { createRemoteTaskProviderExecutionLink } from '../../domain/src/mcp-task-consumer-sync.js';
import { PostgresRemoteTaskAdmissionIntentStore } from '../src/remote-task-admission-intent-store.js';
import {
  PostgresRemoteTaskReconciliationAttemptStore,
  PostgresRemoteTaskProviderExecutionLinkStore,
} from '../src/remote-task-consumer-sync-repository.js';

export async function verifyGowmConsumerSyncCases(
  pool: Pool,
  scope: DeviceWorkScope,
  bindings: readonly RemoteTaskBinding[],
): Promise<string[]> {
  const a = bindings[0];
  const b = bindings[1];
  assert.ok(a?.deviceIdentity && b?.deviceIdentity);
  const owned = { ...scope, allowedDeviceIds: [a.deviceIdentity.deviceId] };
  const intents = new PostgresRemoteTaskAdmissionIntentStore(pool, scope);
  const intent = await intents.findByBindingId(`${b.bindingId}-intent`);
  assert.ok(intent?.logicalIdentity);
  const all = new PostgresRemoteTaskReconciliationAttemptStore(pool, scope);
  const own = new PostgresRemoteTaskReconciliationAttemptStore(pool, owned);
  assert.equal(await all.nextAttemptNumber(intent.intentId), 1);
  await assert.rejects(
    own.nextAttemptNumber(intent.intentId),
    /REMOTE_TASK_RECONCILIATION_INTENT_SCOPE_DENIED/u,
  );
  const attempt = {
    attemptId: `${intent.intentId}-reconcile`,
    intentId: intent.intentId,
    logicalInvocationId: intent.logicalIdentity.logicalInvocationId,
    expectedIntentVersion: intent.version,
    attemptNumber: 1,
    sourceContract: 'sdar.smpp-diagnostics/v1+frozen-mcp-v1' as const,
    requestHash: `sha256:${'2'.repeat(64)}`,
    status: 'not_found' as const,
    safeErrorCode: 'SYNTHETIC_NOT_FOUND',
    identityValidated: false,
    startedAt: b.createdAt,
    completedAt: b.createdAt,
    durationMs: 0,
    resultHash: `sha256:${'3'.repeat(64)}`,
    version: 1 as const,
  };
  await assert.rejects(own.append(attempt), /REMOTE_TASK_RECONCILIATION_ATTEMPT_CONFLICT/u);
  assert.deepEqual(await all.listByIntentId(intent.intentId), []);
  assert.deepEqual(await all.append(attempt), attempt);
  assert.deepEqual(await all.append(attempt), attempt);
  assert.equal(await all.nextAttemptNumber(intent.intentId), 2);
  assert.deepEqual(await own.listByIntentId(intent.intentId), []);
  await assert.rejects(
    all.append({ ...attempt, resultHash: `sha256:${'4'.repeat(64)}` }),
    /REMOTE_TASK_RECONCILIATION_ATTEMPT_CONFLICT/u,
  );
  const links = new PostgresRemoteTaskProviderExecutionLinkStore(pool, scope);
  const ownLinks = new PostgresRemoteTaskProviderExecutionLinkStore(pool, owned);
  const createLink = async (binding: RemoteTaskBinding) => {
    const admission = await intents.findByBindingId(`${binding.bindingId}-intent`);
    assert.ok(admission?.logicalIdentity);
    return createRemoteTaskProviderExecutionLink({
      bindingId: binding.bindingId,
      logicalInvocationId: admission.logicalIdentity.logicalInvocationId,
      remoteTaskId: binding.remoteTaskId,
      providerId: 'synthetic-peer',
      runtimeServerId: binding.serverId,
      operationName: binding.operationName,
      executionStatus: 'unresolved',
      missionStatus: 'unresolved',
      provenance: 'committed_receipt',
      sourceContract: 'sdar.node-control-provider-binding/v1+frozen-mcp-v1',
      sourceRevision: 'synthetic-1',
      observedAt: binding.createdAt,
    });
  };
  const foreignLink = await createLink(b);
  await assert.rejects(ownLinks.save(foreignLink), /REMOTE_TASK_PROVIDER_EXECUTION_LINK_CONFLICT/u);
  assert.equal(await links.findByBindingId(b.bindingId), undefined);
  assert.deepEqual(await links.save(foreignLink), foreignLink);
  assert.deepEqual(await links.save(foreignLink), foreignLink);
  assert.equal(await ownLinks.findByBindingId(b.bindingId), undefined);
  const ownLink = await createLink(a);
  assert.equal(a.remoteTaskId, b.remoteTaskId, 'exercise the same opaque provider handle');
  assert.deepEqual(await ownLinks.save(ownLink), ownLink);
  assert.deepEqual(await links.save(ownLink), ownLink);
  assert.deepEqual(await links.findByBindingId(a.bindingId), ownLink);
  assert.deepEqual(await links.findByBindingId(b.bindingId), foreignLink);
  const owners = (
    await pool.query<{ binding_id: string; device_id: string; smpp_service_key: string }>(
      'SELECT binding_id,device_id,smpp_service_key FROM remote_task_provider_execution_link WHERE binding_id=ANY($1::text[]) ORDER BY binding_id',
      [[a.bindingId, b.bindingId]],
    )
  ).rows;
  assert.equal(owners.length, 2);
  for (const binding of [a, b]) {
    const row = owners.find((entry) => entry.binding_id === binding.bindingId);
    assert.equal(row?.device_id, binding.deviceIdentity?.deviceId);
    assert.equal(row?.smpp_service_key, binding.deviceIdentity?.smppServiceKey);
  }
  await assert.rejects(
    pool.query('UPDATE remote_task_provider_execution_link SET device_id=$2 WHERE binding_id=$1', [
      a.bindingId,
      b.deviceIdentity.deviceId,
    ]),
    /REMOTE_TASK_CONSUMER_SYNC_IMMUTABLE/u,
  );
  // Even raw consumer SQL cannot assert a different owner or source identity.
  for (const [column, value] of [
    ['device_id', b.deviceIdentity.deviceId],
    ['remote_task_id', 'forged-handle'],
    ['runtime_server_id', 'forged-server'],
    ['smpp_service_key', 'forged-service'],
  ] as const) {
    await assert.rejects(
      pool.query(
        `INSERT INTO remote_task_provider_execution_link SELECT (jsonb_populate_record(NULL::remote_task_provider_execution_link, to_jsonb(link) || jsonb_build_object($2::text,$3::text))).* FROM remote_task_provider_execution_link link WHERE binding_id=$1`,
        [a.bindingId, column, value],
      ),
      /REMOTE_PROVIDER_LINK_BINDING_MISMATCH/u,
    );
  }
  return [
    'Two devices preserve identical opaque Provider handles in separate immutable execution links',
    'Reconciliation attempts and Provider links enforce Task/Binding scope and idempotency; no foreign row is exposed or overwritten',
  ];
}
