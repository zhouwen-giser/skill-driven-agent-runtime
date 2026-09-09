import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
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
  // This is a known contract limitation, not a passing cross-device link requirement.
  await assert.rejects(links.save(ownLink), /REMOTE_TASK_PROVIDER_EXECUTION_LINK_CONFLICT/u);
  assert.equal(await links.findByBindingId(a.bindingId), undefined);
  assert.deepEqual(await links.findByBindingId(b.bindingId), foreignLink);
  await writeFile(
    'reports/sdar-gowm-shared-storage-integration-v0.1/auxiliary-link-contract-gap.json',
    JSON.stringify(
      {
        status: 'INCOMPLETE',
        reproduced: true,
        contract: 'a1a86186ea866911124de72374e17fe19897fa9e',
        table: 'ugv_sdar.remote_task_provider_execution_link',
        constraint: 'remote_task_provider_executio_runtime_server_id_remote_task_key',
        identity: ['runtime_server_id', 'remote_task_id'],
        missingScope: ['device_id', 'smpp_service_key'],
        observed:
          'Native Remote Bindings for two devices share one opaque handle, but only one auxiliary Provider execution link can persist. Second link rejects without modifying the first.',
        next: 'Requires a contract-compatible resolution; not SOURCE_READY. Do not namespace opaque handles or alter GOWM DDL from SDAR.',
      },
      null,
      2,
    ) + '\n',
  );
  return [
    'Reconciliation attempts and Provider links enforce Task/Binding scope and idempotency; no foreign row is exposed or overwritten',
  ];
}
