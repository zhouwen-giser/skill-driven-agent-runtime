import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  createCatalogEvidenceEnvelope,
  hashCanonicalEvidenceJson,
  type EvidenceBatchRequest,
  type ManagedEvidenceExportConfiguration,
} from '../../domain/src/index.js';
import { PostgresEvidenceStore, PostgresRuntimeEvidenceExportStore } from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const pool = new Pool({ connectionString, max: 4 });
const store = new PostgresRuntimeEvidenceExportStore(pool);
const evidence = new PostgresEvidenceStore(pool);
const now = '2026-08-04T01:00:00.000Z';

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE evidence_dead_letter,evidence_source_checkpoint,evidence_outbox,
      evidence_export_state,evidence_export_configuration CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('Canonical Evidence Export PostgreSQL adapter', { concurrent: false }, () => {
  it('leases one source partition, marks the exact sent batch and supports a partial ACK', async () => {
    const active = configuration();
    await store.apply(active, now);
    await evidence.append(envelope('task-1', '1'), now, 'runtime:episodes');
    await evidence.append(envelope('task-2', '1'), now, 'runtime:episodes');
    await expect(store.nextPendingPartition(now)).resolves.toBe('runtime:episodes');
    const lease = await store.acquireLease({
      exportId: 'primary-evidence-export',
      sourcePartition: 'runtime:episodes',
      owner: 'worker-1',
      token: 'lease-1',
      acquiredAt: now,
      expiresAt: '2026-08-04T01:01:00.000Z',
    });
    const pending = await store.pending('runtime:episodes', 100, now);
    expect(pending).toHaveLength(2);
    const attempted = await store.recordBatchAttempt({
      lease,
      batch: batch(active, pending),
      recordedAt: '2026-08-04T01:00:00.500Z',
    });
    await expect(
      pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM evidence_export_ack WHERE batch_id=$1',
        [attempted.batchId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '0' }] });
    await store.markSent(
      lease,
      pending.map((record) => record.sequence),
      '2026-08-04T01:00:01.000Z',
    );
    const firstSequence = pending[0]?.sequence;
    if (firstSequence === undefined) throw new Error('EVIDENCE_TEST_BATCH_EMPTY');
    await store.recordAcknowledgement({
      lease,
      batch: attempted,
      acknowledgedSequence: firstSequence,
      ackDisposition: 'partial',
      errorCode: null,
      acknowledgedAt: '2026-08-04T01:00:02.000Z',
    });
    await expect(store.status('2026-08-04T01:00:02.000Z')).resolves.toMatchObject({
      status: 'healthy',
      pendingRecords: 1,
      lastAcknowledgedSequence: firstSequence,
    });
    const ledger = await pool.query<{
      status: string;
      attempt_no: number;
      ack_disposition: string;
      observation_generation: number;
    }>(
      `SELECT batch.status,batch.attempt_no,ack.ack_disposition,
         ack.observation_generation
       FROM evidence_export_batch batch
       JOIN evidence_export_ack ack ON ack.batch_id=batch.batch_id
       WHERE batch.batch_id=$1`,
      [attempted.batchId],
    );
    expect(ledger.rows).toEqual([
      {
        status: 'attempted',
        attempt_no: 1,
        ack_disposition: 'partial',
        observation_generation: 1,
      },
    ]);
  });

  it('persists bounded retry failure and dead-letters after the configured maximum attempts', async () => {
    const active = configuration({
      retryPolicy: { baseDelayMs: 10, maxDelayMs: 100, maxAttempts: 1 },
    });
    await store.apply(active, now);
    await evidence.append(envelope('task-failed', '1'), now, 'runtime:episodes');
    const pending = await store.pending('runtime:episodes', 10, now);
    const sequences = pending.map((record) => record.sequence);
    await store.recordDeliveryFailure(
      'runtime:episodes',
      sequences,
      'EVIDENCE_ENDPOINT_UNAVAILABLE',
      active,
      now,
    );
    await expect(store.status(now)).resolves.toMatchObject({
      status: 'degraded',
      lastErrorCode: 'EVIDENCE_ENDPOINT_UNAVAILABLE',
      pendingRecords: 0,
    });
    const deadLetters = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM evidence_dead_letter WHERE issue_code=$1',
      ['export_rejected'],
    );
    expect(deadLetters.rows[0]?.count).toBe('1');
    await expect(store.nextPendingPartition('2026-08-04T01:01:00.000Z')).resolves.toBeUndefined();
  });

  it('persists a rejected ACK without advancing authority and classifies its dead letter', async () => {
    const active = configuration({
      retryPolicy: { baseDelayMs: 10, maxDelayMs: 100, maxAttempts: 1 },
    });
    await store.apply(active, now);
    await evidence.append(envelope('task-ack-invalid', '1'), now, 'runtime:episodes');
    const lease = await store.acquireLease({
      exportId: active.exportId,
      sourcePartition: 'runtime:episodes',
      owner: 'worker-invalid-ack',
      token: 'lease-invalid-ack',
      acquiredAt: now,
      expiresAt: '2026-08-04T01:01:00.000Z',
    });
    const pending = await store.pending('runtime:episodes', 10, now);
    const request = batch(active, pending);
    const attempted = await store.recordBatchAttempt({
      lease,
      batch: request,
      recordedAt: '2026-08-04T01:00:00.250Z',
    });
    await store.markSent(
      lease,
      pending.map((record) => record.sequence),
      '2026-08-04T01:00:00.500Z',
    );
    await store.recordAcknowledgement({
      lease,
      batch: attempted,
      acknowledgedSequence: null,
      ackDisposition: 'rejected',
      errorCode: 'EVIDENCE_ACK_INVALID',
      acknowledgedAt: '2026-08-04T01:00:01.000Z',
    });
    await store.recordDeliveryFailure(
      'runtime:episodes',
      pending.map((record) => record.sequence),
      'EVIDENCE_ACK_INVALID',
      active,
      '2026-08-04T01:00:01.000Z',
    );

    await expect(store.status('2026-08-04T01:00:01.000Z')).resolves.toMatchObject({
      lastErrorCode: 'EVIDENCE_ACK_INVALID',
      pendingRecords: 0,
    });
    const authority = await pool.query<{
      last_acknowledged_sequence: string | null;
      ack_disposition: string;
      acknowledged_sequence: string | null;
      issue_code: string;
    }>(
      `SELECT state.last_acknowledged_sequence::text,ack.ack_disposition,
         ack.acknowledged_sequence::text,dead.issue_code
       FROM evidence_export_state state
       JOIN evidence_export_ack ack
         ON ack.export_id=state.export_id AND ack.source_partition=state.source_partition
       JOIN evidence_dead_letter dead ON true
       WHERE state.export_id=$1 AND state.source_partition=$2`,
      [active.exportId, 'runtime:episodes'],
    );
    expect(authority.rows).toEqual([
      {
        last_acknowledged_sequence: null,
        ack_disposition: 'rejected',
        acknowledged_sequence: null,
        issue_code: 'ack_invalid',
      },
    ]);
  });

  it('round-trips generation-1 records so the exporter can suppress recursive observations', async () => {
    await store.apply(configuration(), now);
    await evidence.append(envelope('telemetry-delivery', '1', 1), now, 'runtime:telemetry');

    const pending = await store.pending('runtime:telemetry', 10, now);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.envelope.observationGeneration).toBe(1);
  });
});

function configuration(
  override: Partial<ManagedEvidenceExportConfiguration> = {},
): ManagedEvidenceExportConfiguration {
  return Object.freeze({
    exportId: 'primary-evidence-export',
    revision: 1,
    endpointRef: 'https://evidence.example.test/ingest',
    sourceId: 'sdar-runtime',
    nodeId: 'node-001',
    credentialRef: 'env:TEST_EVIDENCE_TOKEN',
    includedFamilies: [
      'runtime',
      'skill',
      'mcp_task',
      'capability',
      'experience',
      'replay',
      'artifact',
      'node_control',
      'evidence',
    ] as const,
    batchPolicy: { maxRecords: 100, maxBytes: 262_144, flushIntervalMs: 1_000 },
    retryPolicy: { baseDelayMs: 100, maxDelayMs: 10_000 },
    outboxPolicy: { maxPendingRecords: 10_000, retentionDays: 30 },
    redactionProfile: 'strict_internal_v1',
    artifactMode: 'reference',
    status: 'active',
    applyMode: 'hot_reload',
    ...override,
  });
}

function envelope(taskId: string, revision: string, observationGeneration?: 0 | 1) {
  return createCatalogEvidenceEnvelope({
    recordType: 'runtime.episode',
    sourceRecordId: taskId,
    sourceRevision: revision,
    environment: 'test',
    correlationId: taskId,
    occurredAt: now,
    recordedAt: now,
    taskId,
    contextId: `context-${taskId}`,
    episodeId: taskId,
    ...(observationGeneration === undefined ? {} : { observationGeneration }),
    payload: { episodeId: taskId, taskId, status: 'completed' },
  });
}

function batch(
  active: ManagedEvidenceExportConfiguration,
  pending: Awaited<ReturnType<PostgresRuntimeEvidenceExportStore['pending']>>,
): EvidenceBatchRequest {
  const first = pending[0];
  const last = pending.at(-1);
  if (first === undefined || last === undefined) throw new Error('EVIDENCE_TEST_BATCH_EMPTY');
  const unsigned = {
    contractVersion: 'sdar.evidence/v1' as const,
    exportId: active.exportId,
    sourceId: active.sourceId,
    nodeId: active.nodeId ?? active.sourceId,
    revision: active.revision,
    firstSequence: first.sequence,
    lastSequence: last.sequence,
    records: pending.map((record) => record.envelope),
  };
  return Object.freeze({ ...unsigned, batchHash: hashCanonicalEvidenceJson(unsigned) });
}
