import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  createCatalogEvidenceEnvelope,
  type CanonicalEvidenceEnvelope,
  type EvidenceExportConfiguration,
} from '../../domain/src/index.js';
import { PostgresEvidenceStore } from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const pool = new Pool({ connectionString, max: 8 });
const store = new PostgresEvidenceStore(pool);
const baseTime = '2026-08-04T03:00:00.000Z';

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE episode_evidence_manifest,evidence_quality_issue,evidence_projection_issue,
      evidence_dead_letter,evidence_source_checkpoint,evidence_outbox,evidence_export_state,
      evidence_export_configuration RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('v1.4.1 canonical Evidence PostgreSQL authority', { concurrent: false }, () => {
  it('cleanly retires legacy telemetry tables and creates all eight constrained authorities', async () => {
    const result = await pool.query<{
      old_configuration: string | null;
      old_state: string | null;
      old_outbox: string | null;
      authority_count: number;
    }>(
      `SELECT
         to_regclass('public.runtime_telemetry_export_configuration')::text AS old_configuration,
         to_regclass('public.runtime_telemetry_export_state')::text AS old_state,
         to_regclass('public.runtime_telemetry_export_outbox')::text AS old_outbox,
         (SELECT count(*)::integer FROM information_schema.tables
          WHERE table_schema='public' AND table_name=ANY($1::text[])) AS authority_count`,
      [
        [
          'evidence_export_configuration',
          'evidence_outbox',
          'evidence_source_checkpoint',
          'evidence_export_state',
          'evidence_dead_letter',
          'evidence_projection_issue',
          'evidence_quality_issue',
          'episode_evidence_manifest',
        ],
      ],
    );
    expect(result.rows[0]).toEqual({
      old_configuration: null,
      old_state: null,
      old_outbox: null,
      authority_count: 8,
    });
  });

  it('is idempotent under duplicate and concurrent append and rejects same-ID hash conflict', async () => {
    const envelope = episode('episode-idempotent', '1');
    const sequences = await Promise.all(
      Array.from({ length: 12 }, () => store.append(envelope, baseTime, 'runtime:episodes')),
    );
    expect(new Set(sequences)).toEqual(new Set(['1']));
    await expect(
      store.append(episode('episode-idempotent', '1', 'failed'), baseTime, 'runtime:episodes'),
    ).rejects.toMatchObject({ code: 'EVIDENCE_PAYLOAD_HASH_CONFLICT' });
    const count = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM evidence_outbox',
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('does not create false evidence when the caller transaction rolls back', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await store.appendWithinTransaction(
        client,
        episode('episode-rollback', '1'),
        baseTime,
        'runtime:episodes',
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM evidence_outbox
       WHERE source_record_id='episode-rollback'`,
    );
    expect(count.rows[0]?.count).toBe('0');
  });

  it('stops evidence capture at the durable high watermark without network or Runtime mutation', async () => {
    await store.applyConfiguration(configuration(1), baseTime);
    await store.append(episode('episode-watermark-1', '1'), baseTime, 'runtime:episodes');
    await expect(
      store.append(episode('episode-watermark-2', '1'), baseTime, 'runtime:episodes'),
    ).rejects.toMatchObject({ code: 'EVIDENCE_OUTBOX_HIGH_WATERMARK' });
    const state = await pool.query<{ status: string; last_error_code: string }>(
      `SELECT status,last_error_code FROM evidence_export_state
       WHERE export_id='evidence-primary' AND source_partition='all'`,
    );
    expect(state.rows[0]).toEqual({
      status: 'high_watermark',
      last_error_code: 'EVIDENCE_OUTBOX_HIGH_WATERMARK',
    });
  });

  it('uses independent durable cursors and rejects checkpoint regression', async () => {
    await store.saveCheckpoint({
      sourceFamily: 'runtime_episode',
      sourcePartition: 'tenant-a',
      lastOccurredAt: '2026-08-04T03:01:00.000Z',
      lastSourceRecordId: 'episode-2',
      lastSourceRevision: '2',
      lastPayloadHash: episode('episode-2', '2').payloadHash,
      lastProjectedAt: '2026-08-04T03:01:01.000Z',
      projectorVersion: 'v1.4.1-test',
    });
    await store.saveCheckpoint({
      sourceFamily: 'runtime_episode',
      sourcePartition: 'tenant-b',
      lastOccurredAt: '2026-08-04T03:00:30.000Z',
      lastSourceRecordId: 'episode-1',
      lastSourceRevision: '1',
      lastPayloadHash: episode('episode-1', '1').payloadHash,
      lastProjectedAt: '2026-08-04T03:00:31.000Z',
      projectorVersion: 'v1.4.1-test',
    });
    await expect(
      store.saveCheckpoint({
        sourceFamily: 'runtime_episode',
        sourcePartition: 'tenant-a',
        lastOccurredAt: '2026-08-04T03:00:59.000Z',
        lastSourceRecordId: 'episode-1',
        lastSourceRevision: '1',
        lastProjectedAt: '2026-08-04T03:02:00.000Z',
        projectorVersion: 'v1.4.1-test',
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_CHECKPOINT_REGRESSION' });
    const count = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM evidence_source_checkpoint',
    );
    expect(count.rows[0]?.count).toBe('2');
  });

  it('fences leases and accepts only monotonic partial ACKs within the sent boundary', async () => {
    await store.applyConfiguration(configuration(100), baseTime);
    await store.append(episode('episode-ack-1', '1'), baseTime, 'runtime:episodes');
    await store.append(episode('episode-ack-2', '1'), baseTime, 'runtime:episodes');
    const pending = await store.pending('runtime:episodes', 100, baseTime);
    const first = pending[0]?.sequence;
    const last = pending.at(-1)?.sequence;
    if (first === undefined || last === undefined) throw new Error('EVIDENCE_TEST_BATCH_MISSING');
    const lease = await store.acquireLease({
      exportId: 'evidence-primary',
      sourcePartition: 'runtime:episodes',
      owner: 'worker-a',
      token: 'lease-a',
      acquiredAt: baseTime,
      expiresAt: '2026-08-04T03:10:00.000Z',
    });
    await store.markSent(lease, [last], '2026-08-04T03:00:01.000Z');
    await expect(store.acknowledge(lease, last, '2026-08-04T03:00:01.500Z')).rejects.toMatchObject({
      code: 'EVIDENCE_ACK_INVALID',
    });
    await store.markSent(
      lease,
      pending.map((record) => record.sequence),
      '2026-08-04T03:00:01.000Z',
    );
    await store.acknowledge(lease, first, '2026-08-04T03:00:02.000Z');
    await expect(store.acknowledge(lease, '0', '2026-08-04T03:00:03.000Z')).rejects.toMatchObject({
      code: 'EVIDENCE_ACK_INVALID',
    });
    await expect(
      store.acknowledge(lease, (BigInt(last) + 1n).toString(), '2026-08-04T03:00:03.000Z'),
    ).rejects.toMatchObject({ code: 'EVIDENCE_ACK_INVALID' });

    const nextLease = await store.acquireLease({
      exportId: 'evidence-primary',
      sourcePartition: 'runtime:episodes',
      owner: 'worker-b',
      token: 'lease-b',
      acquiredAt: '2026-08-04T03:11:00.000Z',
      expiresAt: '2026-08-04T03:20:00.000Z',
    });
    expect(BigInt(nextLease.fencingToken)).toBeGreaterThan(BigInt(lease.fencingToken));
    await expect(store.markSent(lease, [last], '2026-08-04T03:11:01.000Z')).rejects.toMatchObject({
      code: 'EVIDENCE_LEASE_NOT_OWNED',
    });
  });

  it('persists required projection failures and prevents an early complete manifest', async () => {
    const sequence = await store.append(
      episode('episode-dead-letter', '1'),
      baseTime,
      'runtime:episodes',
    );
    await store.deadLetter(
      sequence,
      'export_rejected',
      { errorCode: 'SINK_REJECTED_CANONICAL_RECORD' },
      baseTime,
    );
    await store.recordProjectionIssue(
      {
        issueId: 'projection-required-1',
        issueCode: 'source_unavailable',
        severity: 'blocking',
        episodeId: 'episode-manifest',
        sourceSystem: 'runtime',
        sourceTable: 'agent_task',
        sourceRecordId: 'task-manifest',
        sourcePartition: 'runtime:episodes',
        projectorVersion: 'v1.4.1-test',
        retryable: true,
        detail: { reason: 'source temporarily unavailable' },
        createdAt: baseTime,
      },
      'required',
    );
    await expect(
      store.saveManifest({
        manifestId: 'manifest-early',
        episodeId: 'episode-manifest',
        taskId: 'task-manifest',
        terminalOutcomeId: 'outcome-manifest',
        expectedRequiredRecords: 2,
        projectedRequiredRecords: 1,
        pendingRequiredRecords: 1,
        failedRequiredRecords: 0,
        expectedFamilies: ['runtime'],
        completedFamilies: [],
        missingFamilies: ['runtime'],
        sourceCoverage: {
          runtime: { expected: 2, projected: 1, pending: 1, failed: 0 },
        },
        lastEvidenceSequence: '0',
        status: 'complete',
        qualityIssueIds: ['projection-required-1'],
        createdAt: baseTime,
        sealedAt: baseTime,
      }),
    ).rejects.toMatchObject({ code: '23514' });
    const issue = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM evidence_projection_issue
       WHERE issue_id='projection-required-1' AND evaluation_role='required'`,
    );
    expect(issue.rows[0]?.count).toBe('1');
    const deadLetter = await pool.query<{ issue_code: string; attempts: number }>(
      'SELECT issue_code,attempts::integer FROM evidence_dead_letter WHERE sequence=$1::bigint',
      [sequence],
    );
    expect(deadLetter.rows[0]).toEqual({ issue_code: 'export_rejected', attempts: 1 });
  });

  it('recovers committed rows after a new store instance and never depends on Redis', async () => {
    const sequence = await store.append(
      episode('episode-restart', '1'),
      baseTime,
      'runtime:episodes',
    );
    const restarted = new PostgresEvidenceStore(pool);
    const pending = await restarted.pending('runtime:episodes', 10, baseTime);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sequence).toBe(sequence);
    expect(pending[0]?.envelope.sourceRecordId).toBe('episode-restart');
  });

  it('rolls migration 0144 back to the immutable 0142 shape and reapplies cleanly', async () => {
    const down = await readFile(
      new URL(
        '../../../infra/postgres/migrations/0144_v14_canonical_evidence.down.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const up = await readFile(
      new URL(
        '../../../infra/postgres/migrations/0144_v14_canonical_evidence.up.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await pool.query(down);
    const rolledBack = await pool.query<{
      marker_absent: boolean;
      evidence_absent: boolean;
      legacy_present: boolean;
    }>(
      `SELECT
         NOT EXISTS(SELECT 1 FROM schema_migration
           WHERE version='0144_v14_canonical_evidence') AS marker_absent,
         to_regclass('public.evidence_outbox') IS NULL AS evidence_absent,
         to_regclass('public.runtime_telemetry_export_outbox') IS NOT NULL AS legacy_present`,
    );
    expect(rolledBack.rows[0]).toEqual({
      marker_absent: true,
      evidence_absent: true,
      legacy_present: true,
    });
    await pool.query(up);
    const reapplied = await pool.query<{
      marker_present: boolean;
      evidence_present: boolean;
      legacy_absent: boolean;
    }>(
      `SELECT
         EXISTS(SELECT 1 FROM schema_migration
           WHERE version='0144_v14_canonical_evidence') AS marker_present,
         to_regclass('public.evidence_outbox') IS NOT NULL AS evidence_present,
         to_regclass('public.runtime_telemetry_export_outbox') IS NULL AS legacy_absent`,
    );
    expect(reapplied.rows[0]).toEqual({
      marker_present: true,
      evidence_present: true,
      legacy_absent: true,
    });
  });
});

function episode(
  episodeId: string,
  revision: string,
  status = 'completed',
): CanonicalEvidenceEnvelope {
  return createCatalogEvidenceEnvelope({
    recordType: 'runtime.episode',
    sourceRecordId: episodeId,
    sourceRevision: revision,
    environment: 'integration',
    correlationId: `correlation-${episodeId}`,
    occurredAt: baseTime,
    recordedAt: baseTime,
    taskId: `task-${episodeId}`,
    episodeId,
    payload: { episodeId, taskId: `task-${episodeId}`, status },
  });
}

function configuration(maxPendingRecords: number): EvidenceExportConfiguration {
  return Object.freeze({
    exportId: 'evidence-primary',
    revision: 1,
    endpointRef: 'https://evidence.example.test/v1/batches',
    sourceId: 'sdar-runtime',
    nodeId: 'node-test',
    credentialRef: 'env:EVIDENCE_TEST_TOKEN',
    includedFamilies: Object.freeze([
      'runtime',
      'skill',
      'mcp_task',
      'capability',
      'experience',
      'replay',
      'artifact',
      'node_control',
      'evidence',
    ] as const),
    batchPolicy: Object.freeze({ maxRecords: 100, maxBytes: 262_144, flushIntervalMs: 1_000 }),
    retryPolicy: Object.freeze({ baseDelayMs: 100, maxDelayMs: 10_000, maxAttempts: 5 }),
    outboxPolicy: Object.freeze({ maxPendingRecords, retentionDays: 30 }),
    redactionProfile: 'strict_internal_v1',
    artifactMode: 'reference',
  });
}
