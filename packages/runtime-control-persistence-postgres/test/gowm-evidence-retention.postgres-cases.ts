import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import {
  createCatalogEvidenceEnvelope,
  hashCanonicalEvidenceJson,
} from '../../domain/src/index.js';
import { PostgresEvidenceStore, PostgresEvidenceOperationsRepository } from '../src/index.js';

export async function verifyGowmEvidenceRetention(
  pool: Pool,
  scope: DeviceWorkScope,
  run: string,
): Promise<string[]> {
  const store = new PostgresEvidenceStore(pool, scope);
  const at = new Date().toISOString();
  const old = '2000-01-01T00:00:00.000Z';
  const id = randomUUID();
  const configuration = (await store.findActiveConfiguration()) ?? {
    exportId: `${run}-retention`,
    revision: 1,
    endpointRef: 'https://evidence.example.test/v1/batches',
    sourceId: run,
    nodeId: run,
    credentialRef: 'env:UNUSED_TEST_EVIDENCE_TOKEN',
    includedFamilies: ['runtime', 'evidence'] as const,
    batchPolicy: { maxRecords: 1000, maxBytes: 262144, flushIntervalMs: 1000 },
    retryPolicy: { baseDelayMs: 100, maxDelayMs: 10000, maxAttempts: 5 },
    outboxPolicy: { maxPendingRecords: 100000, retentionDays: 30 },
    redactionProfile: 'strict_internal_v1' as const,
    artifactMode: 'reference' as const,
  };
  await store.applyConfiguration(configuration, at);
  const records = [];
  // Two Task-owned records, one disposable service diagnostic, one referenced diagnostic.
  for (let index = 0; index < 4; index++) {
    const source = `${id}-${String(index)}`;
    const envelope = createCatalogEvidenceEnvelope({
      recordType: 'evidence.source_checkpoint',
      sourceRecordId: source,
      sourceRevision: hashCanonicalEvidenceJson({ source }),
      environment: 'integration',
      correlationId: run,
      occurredAt: old,
      recordedAt: old,
      ...(index < 2 ? { taskId: `${run}-task-${String(index)}`, contextId: `${run}-context` } : {}),
      payload: {
        sourceFamily: 'runtime',
        sourcePartition: source,
        lastOccurredAt: old,
        lastSourceRecordId: source,
        lastSourceRevision: null,
        lastPayloadHash: null,
        lastProjectedAt: old,
        projectorVersion: 'retention-test/v1',
      },
    });
    await store.append(envelope, old, source);
    records.push(envelope);
  }
  const referenced = records[3];
  assert.ok(referenced);
  await store.append(
    createCatalogEvidenceEnvelope({
      recordType: 'runtime.episode',
      sourceRecordId: `${id}-dependent`,
      sourceRevision: hashCanonicalEvidenceJson(id),
      environment: 'integration',
      correlationId: run,
      occurredAt: at,
      recordedAt: at,
      taskId: `${run}-task-0`,
      contextId: `${run}-context`,
      evidenceRefs: [referenced.recordId],
      payload: { episodeId: `${run}-task-0`, taskId: `${run}-task-0`, status: 'queued' },
    }),
    at,
    `${id}-dependent`,
  );
  await pool.query(
    'UPDATE evidence_outbox SET acknowledged_at=$2 WHERE record_id=ANY($1::text[])',
    [records.map((record) => record.recordId), at],
  );
  const repository = new PostgresEvidenceOperationsRepository(pool, scope);
  const requested = await repository.startRecoveryRun({
    operation: 'apply_retention',
    operationId: id,
    idempotencyKeyHash: hashCanonicalEvidenceJson(id),
    requestHash: hashCanonicalEvidenceJson({ id, operation: 'apply_retention' }),
    exportId: configuration.exportId,
    configurationRevision: configuration.revision,
    actorId: 'isolated-test',
    reason: 'Verify shared Task history retention',
    requestedAt: at,
  });
  const completed = await repository.resumeRecoveryRun(requested.recoveryRunId);
  assert.equal(completed.status, 'succeeded');
  const retained = await pool.query<{ record_id: string }>(
    'SELECT record_id FROM evidence_outbox WHERE record_id=ANY($1::text[])',
    [records.map((record) => record.recordId)],
  );
  assert.deepEqual(
    new Set(retained.rows.map((row) => row.record_id)),
    new Set(records.filter((_, index) => index !== 2).map((record) => record.recordId)),
  );
  assert.equal(
    (await repository.resumeRecoveryRun(requested.recoveryRunId)).affectedRecords,
    completed.affectedRecords,
  );
  const appending = await pool.connect();
  const retaining = await pool.connect();
  const failures: unknown[] = [];
  try {
    await appending.query('BEGIN');
    await retaining.query('BEGIN');
    // Exercise the real append transaction, including its idempotent path.
    await store.appendWithinTransaction(appending, referenced, old, referenced.sourceRecordId);
    const busy = await retaining.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('runtime.evidence-export')) AS acquired",
    );
    assert.equal(busy.rows[0]?.acquired, false, 'Retention must not race an in-flight append');
    await appending.query('ROLLBACK');
    const available = await retaining.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('runtime.evidence-export')) AS acquired",
    );
    assert.equal(available.rows[0]?.acquired, true, 'Append completion must release the barrier');
  } catch (error) {
    failures.push(error);
  } finally {
    const cleanup = await Promise.allSettled([
      appending.query('ROLLBACK'),
      retaining.query('ROLLBACK'),
    ]);
    appending.release();
    retaining.release();
    for (const result of cleanup) if (result.status === 'rejected') failures.push(result.reason);
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'Retention regression or cleanup failed');
  return [
    'Shared retention preserves both devices and referenced diagnostics, purges only unbound expired diagnostics, resumes idempotently, and excludes concurrent append transactions',
  ];
}
