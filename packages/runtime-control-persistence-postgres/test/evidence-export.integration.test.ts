import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  createCatalogEvidenceEnvelope,
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
    await store.apply(configuration(), now);
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
    await store.markSent(
      lease,
      pending.map((record) => record.sequence),
      '2026-08-04T01:00:01.000Z',
    );
    const firstSequence = pending[0]?.sequence;
    if (firstSequence === undefined) throw new Error('EVIDENCE_TEST_BATCH_EMPTY');
    await store.acknowledge(lease, firstSequence, '2026-08-04T01:00:02.000Z');
    await expect(store.status('2026-08-04T01:00:02.000Z')).resolves.toMatchObject({
      status: 'healthy',
      pendingRecords: 1,
      lastAcknowledgedSequence: firstSequence,
    });
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
      pendingRecords: 1,
    });
    const deadLetters = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM evidence_dead_letter',
    );
    expect(deadLetters.rows[0]?.count).toBe('1');
    await expect(store.nextPendingPartition('2026-08-04T01:01:00.000Z')).resolves.toBeUndefined();
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

function envelope(taskId: string, revision: string) {
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
    payload: { episodeId: taskId, taskId, status: 'completed' },
  });
}
