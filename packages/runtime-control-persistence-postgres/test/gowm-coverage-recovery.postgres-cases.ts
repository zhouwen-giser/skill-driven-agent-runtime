import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { hashCanonicalEvidenceJson } from '../../domain/src/index.js';
import { EpisodeEvidenceCoverageService } from '../../runtime-control-application/src/evidence-coverage-service.js';
import { PostgresEvidenceStore, PostgresEvidenceOperationsRepository } from '../src/index.js';

export async function verifyGowmCoverageRecovery(
  pool: Pool,
  taskIds: readonly string[],
): Promise<void> {
  const [a, b] = taskIds;
  assert.ok(a);
  assert.ok(b);
  const owners = await pool.query<{ task_id: string; device_id: string; sdar_service_key: string }>(
    'SELECT task_id,device_id,sdar_service_key FROM agent_task WHERE task_id=ANY($1::text[])',
    [taskIds],
  );
  const own = owners.rows.find((row) => row.task_id === a);
  const other = owners.rows.find((row) => row.task_id === b);
  assert.ok(own);
  assert.ok(other);
  const scope = {
    allowedDeviceIds: [own.device_id],
    sdarServiceKey: own.sdar_service_key,
    includeNonDevice: false,
  };
  const store = new PostgresEvidenceStore(pool, scope);
  const id = randomUUID();
  const at = new Date().toISOString();
  const configuration = (await store.findActiveConfiguration()) ?? {
    exportId: `coverage-${id}`,
    revision: 1,
    endpointRef: 'https://evidence.example.test/v1/batches',
    sourceId: 'isolated-gowm',
    nodeId: 'isolated-gowm',
    credentialRef: 'env:UNUSED_TEST_EVIDENCE_TOKEN',
    includedFamilies: ['runtime', 'evidence'] as const,
    batchPolicy: { maxRecords: 1000, maxBytes: 262144, flushIntervalMs: 1000 },
    retryPolicy: { baseDelayMs: 100, maxDelayMs: 10000, maxAttempts: 5 },
    outboxPolicy: { maxPendingRecords: 100000, retentionDays: 30 },
    redactionProfile: 'strict_internal_v1' as const,
    artifactMode: 'reference' as const,
  };
  await store.applyConfiguration(configuration, at);
  const repository = new PostgresEvidenceOperationsRepository(pool, scope);
  const foreign = new PostgresEvidenceOperationsRepository(pool, {
    ...scope,
    allowedDeviceIds: [other.device_id],
  });
  const request = await repository.startRecoveryRun({
    operation: 'reconcile_coverage',
    operationId: id,
    idempotencyKeyHash: hashCanonicalEvidenceJson(id),
    requestHash: hashCanonicalEvidenceJson({ id, operation: 'reconcile_coverage' }),
    exportId: configuration.exportId,
    configurationRevision: configuration.revision,
    actorId: 'isolated-fixture',
    reason: 'Coverage target device regression',
    requestedAt: at,
  });
  const running = await repository.resumeRecoveryRun(request.recoveryRunId);
  assert.equal(running.status, 'running', JSON.stringify(running));
  const targets = await pool.query<{ episode_id: string }>(
    'SELECT episode_id FROM evidence_coverage_reconcile_target WHERE recovery_run_id=$1',
    [request.recoveryRunId],
  );
  assert.deepEqual(
    targets.rows.map((row) => row.episode_id),
    [a],
  );
  assert.equal(
    await foreign.claimCoverageRecoveryTarget(request.recoveryRunId, new Date().toISOString()),
    undefined,
  );
  const claimed = await repository.claimCoverageRecoveryTarget(
    request.recoveryRunId,
    new Date().toISOString(),
  );
  assert.ok(claimed);
  assert.equal(claimed.taskId, a);
  assert.equal(
    await repository.claimCoverageRecoveryTarget(request.recoveryRunId, new Date().toISOString()),
    undefined,
  );
  const manifest = await new EpisodeEvidenceCoverageService({ repository: store }).reconcile(
    claimed,
  );
  assert.equal(manifest.taskId, a);
  const completed = await repository.completeCoverageRecoveryTarget(
    claimed,
    new Date().toISOString(),
  );
  assert.equal(completed.status, 'succeeded');
  assert.equal(
    (await repository.completeCoverageRecoveryTarget(claimed, new Date().toISOString())).revision,
    completed.revision,
  );
  assert.equal(
    await repository.claimCoverageRecoveryTarget(request.recoveryRunId, new Date().toISOString()),
    undefined,
  );
}
