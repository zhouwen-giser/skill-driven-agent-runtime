import { readdir, readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  EPISODE_EVIDENCE_POLICY,
  EPISODE_EVIDENCE_POLICY_VERSION,
  createCatalogEvidenceEnvelope,
  type CanonicalEvidenceEnvelope,
  type EvidenceExportConfiguration,
  type EvidenceQualityIssue,
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
    `TRUNCATE evidence_expected_record,episode_evidence_manifest,evidence_quality_issue,evidence_projection_issue,
      evidence_export_ack,evidence_export_batch,
      evidence_dead_letter,evidence_source_checkpoint,evidence_outbox,evidence_export_state,
      evidence_export_configuration RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('v1.4.1 canonical Evidence PostgreSQL authority', { concurrent: false }, () => {
  it('cleanly retires legacy telemetry tables and creates all nine constrained authorities', async () => {
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
          'evidence_expected_record',
        ],
      ],
    );
    expect(result.rows[0]).toEqual({
      old_configuration: null,
      old_state: null,
      old_outbox: null,
      authority_count: 9,
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

  it('rejects an Evidence reference that crosses tenant authority', async () => {
    const source = createCatalogEvidenceEnvelope({
      recordType: 'runtime.episode',
      sourceRecordId: 'episode-tenant-a',
      sourceRevision: '1',
      tenantId: 'tenant-a',
      environment: 'integration',
      correlationId: 'correlation-tenant-a',
      occurredAt: baseTime,
      recordedAt: baseTime,
      taskId: 'task-tenant-a',
      episodeId: 'episode-tenant-a',
      payload: { episodeId: 'episode-tenant-a', taskId: 'task-tenant-a', status: 'completed' },
    });
    await store.append(source, baseTime, 'runtime:episodes');
    const crossTenant = createCatalogEvidenceEnvelope({
      recordType: 'runtime.episode',
      sourceRecordId: 'episode-tenant-b',
      sourceRevision: '1',
      tenantId: 'tenant-b',
      environment: 'integration',
      correlationId: 'correlation-tenant-b',
      occurredAt: baseTime,
      recordedAt: baseTime,
      taskId: 'task-tenant-b',
      episodeId: 'episode-tenant-b',
      evidenceRefs: [source.recordId],
      payload: { episodeId: 'episode-tenant-b', taskId: 'task-tenant-b', status: 'completed' },
    });

    await expect(store.append(crossTenant, baseTime, 'runtime:episodes')).rejects.toMatchObject({
      code: 'EVIDENCE_REFERENCE_SCOPE_CONFLICT',
    });
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
      lastSourceRevision: `sha256:${'f'.repeat(64)}`,
      lastPayloadHash: episode('episode-2', '2').payloadHash,
      lastProjectedAt: '2026-08-04T03:01:01.000Z',
      projectorVersion: 'v1.4.1-test',
    });
    await expect(
      store.saveCheckpoint({
        sourceFamily: 'runtime_episode',
        sourcePartition: 'tenant-a',
        lastOccurredAt: '2026-08-04T03:01:00.000Z',
        lastSourceRecordId: 'episode-2',
        lastSourceRevision: `sha256:${'0'.repeat(64)}`,
        lastPayloadHash: episode('episode-2', '2').payloadHash,
        lastProjectedAt: '2026-08-04T03:01:02.000Z',
        projectorVersion: 'v1.4.1-test',
      }),
    ).resolves.toBeUndefined();
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
    await expect(
      store.saveCheckpoint({
        sourceFamily: 'runtime_episode',
        sourcePartition: 'tenant-a',
        lastOccurredAt: '2026-08-04T03:01:00.000Z',
        lastSourceRecordId: 'episode-1',
        lastSourceRevision: `sha256:${'f'.repeat(64)}`,
        lastProjectedAt: '2026-08-04T03:02:00.000Z',
        projectorVersion: 'v1.4.1-test',
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_CHECKPOINT_REGRESSION' });
    const stored = await pool.query<{ last_source_revision: string }>(
      `SELECT last_source_revision
       FROM evidence_source_checkpoint
       WHERE source_family='runtime_episode' AND source_partition='tenant-a'`,
    );
    expect(stored.rows[0]?.last_source_revision).toBe(`sha256:${'0'.repeat(64)}`);
    const count = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM evidence_source_checkpoint',
    );
    expect(count.rows[0]?.count).toBe('2');
  });

  it('resolves only obsolete Runtime quality issues in the exact source and record-type scope', async () => {
    const issues = [
      qualityIssue('target-obsolete', 'runtime', 'experience_trace', 'trace-a', 'experience.trace'),
      qualityIssue(
        'target-retained',
        'runtime',
        'experience_trace',
        'trace-a',
        'experience.activity',
      ),
      qualityIssue('other-record', 'runtime', 'experience_trace', 'trace-b', 'experience.trace'),
      qualityIssue('other-table', 'runtime', 'workflow_pattern', 'trace-a', 'experience.trace'),
      qualityIssue('other-family', 'runtime', 'experience_trace', 'trace-a', 'replay.run'),
      qualityIssue(
        'other-source-system',
        'node_control',
        'experience_trace',
        'trace-a',
        'experience.trace',
      ),
    ] as const;
    await Promise.all(issues.map((issue) => store.recordQualityIssue(issue)));

    await store.resolveSourceQualityIssues({
      sourceTable: 'experience_trace',
      sourceRecordId: 'trace-a',
      recordTypePrefix: 'experience.',
      retainedIssueIds: ['quality-target-retained'],
      resolvedAt: '2026-08-04T03:04:00.000Z',
    });

    const result = await pool.query<{ issue_id: string; resolved_at: Date | null }>(
      `SELECT issue_id,resolved_at
       FROM evidence_quality_issue
       ORDER BY issue_id`,
    );
    expect(
      Object.fromEntries(result.rows.map((row) => [row.issue_id, row.resolved_at !== null])),
    ).toEqual({
      'quality-other-family': false,
      'quality-other-record': false,
      'quality-other-source-system': false,
      'quality-other-table': false,
      'quality-target-obsolete': true,
      'quality-target-retained': false,
    });
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
        revision: 1,
        policyVersion: EPISODE_EVIDENCE_POLICY_VERSION,
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
        sourceSnapshotHash: `sha256:${'1'.repeat(64)}`,
        createdAt: baseTime,
        recomputedAt: baseTime,
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
    await store.applyConfiguration(configuration(100), baseTime);
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

  it('recomputes exact multi-instance expectations idempotently without self-observation', async () => {
    const episodeId = 'episode-coverage';
    const taskId = 'task-episode-coverage';
    await store.append(episode(episodeId, '1'), baseTime, 'runtime:coverage');
    for (const ordinal of [1, 2]) {
      await store.append(
        createCatalogEvidenceEnvelope({
          recordType: 'runtime.plan_step',
          sourceRecordId: `step-${String(ordinal)}`,
          sourceRevision: String(ordinal),
          environment: 'integration',
          correlationId: taskId,
          occurredAt: baseTime,
          recordedAt: baseTime,
          taskId,
          episodeId,
          payload: { skillGoalId: `step-${String(ordinal)}`, ordinal, status: 'completed' },
        }),
        baseTime,
        'runtime:coverage',
      );
    }
    await store.append(
      createCatalogEvidenceEnvelope({
        recordType: 'evidence.quality_issue',
        sourceRecordId: 'self-observation',
        sourceRevision: '1',
        environment: 'integration',
        correlationId: taskId,
        occurredAt: baseTime,
        recordedAt: baseTime,
        observationGeneration: 1,
        taskId,
        episodeId,
        payload: {
          issueId: 'self-observation',
          revision: 1,
          issueCode: 'source_identity_missing',
          ruleId: 'sequence_gap',
          severity: 'diagnostic',
          episodeId,
          recordType: 'runtime.episode',
          recordId: 'self-record',
          sourceSystem: 'runtime',
          sourceTable: 'evidence_quality_issue',
          sourceRecordId: 'self-observation',
          detail: {},
          createdAt: baseTime,
          resolvedAt: null,
        },
      }),
      baseTime,
      'runtime:coverage',
    );

    const first = await store.refreshEpisodeExpectations({
      episodeId,
      taskId,
      policyRecords: EPISODE_EVIDENCE_POLICY.records,
      recomputedAt: baseTime,
    });
    const second = await store.refreshEpisodeExpectations({
      episodeId,
      taskId,
      policyRecords: EPISODE_EVIDENCE_POLICY.records,
      recomputedAt: '2026-08-04T03:00:01.000Z',
    });
    expect(
      first.expectedRecords.filter((record) => record.recordType === 'runtime.plan_step'),
    ).toEqual([
      expect.objectContaining({ sourceRecordId: 'step-1', stage: 'projected_pending_export' }),
      expect.objectContaining({ sourceRecordId: 'step-2', stage: 'projected_pending_export' }),
    ]);
    expect(first.expectedRecords.some((record) => record.recordFamily === 'evidence')).toBe(false);
    expect(second.sourceSnapshotHash).toBe(first.sourceSnapshotHash);
    const revisions = await pool.query<{ minimum: string; maximum: string }>(
      `SELECT min(revision)::text AS minimum,max(revision)::text AS maximum
       FROM evidence_expected_record WHERE episode_id=$1`,
      [episodeId],
    );
    expect(revisions.rows[0]).toEqual({ minimum: '1', maximum: '1' });

    const projectionIssueId = 'projection-task-coverage';
    await store.recordProjectionIssue(
      {
        issueId: projectionIssueId,
        issueCode: 'schema_invalid',
        severity: 'blocking',
        episodeId,
        sourceSystem: 'runtime',
        sourceTable: 'artifact_execution',
        sourceRecordId: 'artifact-execution-coverage',
        sourcePartition: 'v141:usage:27:artifact-execution-coverage',
        projectorVersion: '1.4.1-phase8.2',
        retryable: true,
        detail: { failureStage: 'item_projection', sourceFamily: 'artifact' },
        createdAt: '2026-08-04T03:00:02.000Z',
      },
      'required',
    );
    const blocked = await store.refreshEpisodeExpectations({
      episodeId,
      taskId,
      policyRecords: EPISODE_EVIDENCE_POLICY.records,
      recomputedAt: '2026-08-04T03:00:03.000Z',
    });
    expect(blocked.qualityIssues).toEqual([
      expect.objectContaining({ issueId: projectionIssueId, severity: 'blocking' }),
    ]);

    const manifest = {
      manifestId: 'manifest-coverage',
      revision: 1,
      policyVersion: EPISODE_EVIDENCE_POLICY_VERSION,
      episodeId,
      taskId,
      terminalOutcomeId: 'outcome-coverage',
      expectedRequiredRecords: 7,
      projectedRequiredRecords: 3,
      pendingRequiredRecords: 4,
      failedRequiredRecords: 0,
      expectedFamilies: ['runtime'] as const,
      completedFamilies: [] as const,
      missingFamilies: ['runtime'] as const,
      sourceCoverage: {
        runtime: { expected: 7, projected: 3, pending: 4, failed: 0 },
      },
      lastEvidenceSequence: '3',
      status: 'incomplete' as const,
      qualityIssueIds: [projectionIssueId] as const,
      sourceSnapshotHash: blocked.sourceSnapshotHash,
      createdAt: baseTime,
      recomputedAt: '2026-08-04T03:00:03.000Z',
      sealedAt: '2026-08-04T03:00:03.000Z',
    };
    await store.saveManifest(manifest);
    await store.saveManifest(manifest);
    await expect(
      store.saveManifest({ ...manifest, revision: 2, projectedRequiredRecords: 2 }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_MANIFEST_SNAPSHOT_CONFLICT' });
    await expect(
      store.saveManifest({
        ...manifest,
        revision: 3,
        sourceSnapshotHash: `sha256:${'f'.repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_MANIFEST_REVISION_CONFLICT' });
    await expect(store.loadManifest(episodeId)).resolves.toMatchObject({ revision: 1 });
  });

  it('persists stable quality-rule revisions across idempotent observe, resolve, and reopen', async () => {
    const issue = qualityIssue(
      'stable-rule',
      'runtime',
      'agent_task',
      'task-stable-rule',
      'runtime.verification',
    );
    await store.recordQualityIssue(issue, 'missing_verification');
    await store.recordQualityIssue(issue, 'missing_verification');
    await store.resolveQualityIssue({
      issueId: issue.issueId,
      ruleId: 'missing_verification',
      resolvedAt: '2026-08-04T03:01:00.000Z',
    });
    await store.recordQualityIssue(issue, 'missing_verification');
    await store.resolveQualityRuleIssues({
      ruleId: 'missing_verification',
      retainedIssueIds: [],
      resolvedAt: '2026-08-04T03:02:00.000Z',
    });
    await store.resolveQualityRuleIssues({
      ruleId: 'missing_verification',
      retainedIssueIds: [],
      resolvedAt: '2026-08-04T03:03:00.000Z',
    });
    const persisted = await pool.query<{
      rule_id: string;
      revision: string;
      resolved_at: Date | null;
    }>(
      `SELECT rule_id,revision::text,resolved_at FROM evidence_quality_issue
       WHERE issue_id=$1`,
      [issue.issueId],
    );
    expect(persisted.rows[0]).toEqual({
      rule_id: 'missing_verification',
      revision: '4',
      resolved_at: new Date('2026-08-04T03:02:00.000Z'),
    });
  });

  it('rolls the dependent Evidence migrations back to immutable 0142 and reapplies cleanly', async () => {
    const migrationDirectory = new URL('../../../infra/postgres/migrations/', import.meta.url);
    const laterMigrationDowns = (await readdir(migrationDirectory))
      .filter((file) => {
        const version = Number(file.slice(0, 4));
        return file.endsWith('.down.sql') && version >= 149;
      })
      .sort()
      .reverse();
    const recoveryDown = await readFile(
      new URL(
        '../../../infra/postgres/migrations/0148_v14_evidence_operations_recovery.down.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const coverageDown = await readFile(
      new URL(
        '../../../infra/postgres/migrations/0147_v14_evidence_coverage_authority.down.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const ledgerDown = await readFile(
      new URL(
        '../../../infra/postgres/migrations/0146_v14_evidence_export_observation_ledger.down.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const artifactMatchDown = await readFile(
      new URL(
        '../../../infra/postgres/migrations/0145_v14_artifact_match_exact_version.down.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const down = await readFile(
      new URL(
        '../../../infra/postgres/migrations/0144_v14_canonical_evidence.down.sql',
        import.meta.url,
      ),
      'utf8',
    );
    for (const migration of laterMigrationDowns) {
      await pool.query(await readFile(new URL(migration, migrationDirectory), 'utf8'));
    }
    await pool.query(recoveryDown);
    await pool.query(coverageDown);
    const coverageRolledBack = await pool.query<{
      marker_absent: boolean;
      expectations_absent: boolean;
      export_ledger_preserved: boolean;
    }>(
      `SELECT
         NOT EXISTS(SELECT 1 FROM schema_migration
           WHERE version='0147_v14_evidence_coverage_authority') AS marker_absent,
         to_regclass('public.evidence_expected_record') IS NULL AS expectations_absent,
         to_regclass('public.evidence_export_batch') IS NOT NULL AS export_ledger_preserved`,
    );
    expect(coverageRolledBack.rows[0]).toEqual({
      marker_absent: true,
      expectations_absent: true,
      export_ledger_preserved: true,
    });
    await pool.query(ledgerDown);
    await pool.query(artifactMatchDown);
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
    await applyRuntimeMigrations(pool);
    await applyRuntimeMigrations(pool);
    const reapplied = await pool.query<{
      marker_present: boolean;
      evidence_present: boolean;
      legacy_absent: boolean;
      coverage_present: boolean;
      recovery_present: boolean;
    }>(
      `SELECT
         EXISTS(SELECT 1 FROM schema_migration
           WHERE version='0144_v14_canonical_evidence') AS marker_present,
         to_regclass('public.evidence_outbox') IS NOT NULL AS evidence_present,
         to_regclass('public.runtime_telemetry_export_outbox') IS NULL AS legacy_absent,
         to_regclass('public.evidence_expected_record') IS NOT NULL AS coverage_present,
         to_regclass('public.evidence_recovery_run') IS NOT NULL AS recovery_present`,
    );
    expect(reapplied.rows[0]).toEqual({
      marker_present: true,
      evidence_present: true,
      legacy_absent: true,
      coverage_present: true,
      recovery_present: true,
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

function qualityIssue(
  suffix: string,
  sourceSystem: EvidenceQualityIssue['sourceSystem'],
  sourceTable: string,
  sourceRecordId: string,
  recordType: string,
): EvidenceQualityIssue {
  return Object.freeze({
    issueId: `quality-${suffix}`,
    issueCode: 'reference_unresolved',
    severity: 'blocking',
    recordType,
    episodeId: `episode-${suffix}`,
    sourceSystem,
    sourceTable,
    sourceRecordId,
    detail: { missingReference: 'evidence-test-reference' },
    createdAt: baseTime,
  });
}
