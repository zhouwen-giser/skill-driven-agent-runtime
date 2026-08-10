import type { Pool, PoolClient } from 'pg';

import {
  hashCanonicalEvidenceJson,
  type EvidenceBatchRequest,
  type EvidenceExportAckLedgerEntry,
  type EvidenceExportBatchLedgerEntry,
  type EvidenceExportStatus,
  type ManagedEvidenceExportConfiguration,
} from '../../domain/src/index.js';
import type {
  EvidenceDeliveryLease,
  RuntimeEvidenceExportStore,
} from '../../runtime-control-application/src/index.js';
import { EvidencePersistenceError, PostgresEvidenceStore } from './evidence-store.js';

const controlPartition = '__export__';

export class PostgresRuntimeEvidenceExportStore implements RuntimeEvidenceExportStore {
  readonly #pool: Pool;
  readonly #evidence: PostgresEvidenceStore;

  constructor(pool: Pool) {
    this.#pool = pool;
    this.#evidence = new PostgresEvidenceStore(pool);
  }

  async findActive(): Promise<ManagedEvidenceExportConfiguration | undefined> {
    const configuration = await this.#evidence.findActiveConfiguration();
    return configuration as ManagedEvidenceExportConfiguration | undefined;
  }

  apply(configuration: ManagedEvidenceExportConfiguration, observedAt: string): Promise<void> {
    return this.#evidence.applyConfiguration(configuration, observedAt);
  }

  async recordProbe(
    exportId: string,
    result: Readonly<{ errorCode?: string }>,
    observedAt: string,
  ): Promise<void> {
    await this.#pool.query(
      `INSERT INTO evidence_export_state(
         export_id,source_partition,status,last_error_code,last_error_at,observed_at)
       VALUES ($1,$2,$3,$4,CASE WHEN $4::text IS NULL THEN NULL ELSE $5::timestamptz END,$5)
       ON CONFLICT (export_id,source_partition) DO UPDATE SET
         status=EXCLUDED.status,last_error_code=EXCLUDED.last_error_code,
         last_error_at=EXCLUDED.last_error_at,observed_at=EXCLUDED.observed_at`,
      [
        exportId,
        controlPartition,
        result.errorCode === undefined ? 'idle' : 'degraded',
        result.errorCode ?? null,
        observedAt,
      ],
    );
  }

  async nextPendingPartition(observedAt: string): Promise<string | undefined> {
    const result = await this.#pool.query<{ source_partition: string }>(
      `SELECT source_partition FROM evidence_outbox
       WHERE acknowledged_at IS NULL AND next_attempt_at<=$1
         AND NOT EXISTS (
           SELECT 1 FROM evidence_dead_letter
           WHERE evidence_dead_letter.sequence=evidence_outbox.sequence
             AND evidence_dead_letter.requeued_at IS NULL)
         AND EXISTS (
           SELECT 1 FROM evidence_export_configuration configuration
           WHERE configuration.is_active
             AND configuration.definition->'includedFamilies' ? evidence_outbox.record_family
             AND NOT (
               evidence_outbox.evaluation_role='diagnostic'
               AND COALESCE(
                 configuration.definition->'excludedDiagnosticTypes','[]'::jsonb
               ) ? evidence_outbox.record_type
             )
         )
       GROUP BY source_partition ORDER BY min(sequence) LIMIT 1`,
      [observedAt],
    );
    return result.rows[0]?.source_partition;
  }

  acquireLease(input: {
    readonly exportId: string;
    readonly sourcePartition: string;
    readonly owner: string;
    readonly token: string;
    readonly acquiredAt: string;
    readonly expiresAt: string;
  }): Promise<EvidenceDeliveryLease> {
    return this.#evidence.acquireLease(input);
  }

  pending(sourcePartition: string, limit: number, observedAt: string) {
    return this.#evidence.pending(sourcePartition, limit, observedAt);
  }

  markSent(
    lease: EvidenceDeliveryLease,
    sequences: readonly string[],
    observedAt: string,
  ): Promise<void> {
    return this.#evidence.markSent(lease, sequences, observedAt);
  }

  async recordBatchAttempt(input: {
    readonly lease: EvidenceDeliveryLease;
    readonly batch: EvidenceBatchRequest;
    readonly recordedAt: string;
  }): Promise<EvidenceExportBatchLedgerEntry> {
    if (input.batch.exportId !== input.lease.exportId) {
      throw new EvidencePersistenceError(
        'EVIDENCE_ACK_INVALID',
        'Evidence batch export identity does not match the fenced lease.',
      );
    }
    return withTransaction(this.#pool, async (client) => {
      const lease = await client.query(
        `SELECT 1 FROM evidence_export_state
         WHERE export_id=$1 AND source_partition=$2 AND lease_owner=$3 AND lease_token=$4
           AND fencing_token=$5::bigint AND lease_expires_at>$6 FOR UPDATE`,
        [
          input.lease.exportId,
          input.lease.sourcePartition,
          input.lease.owner,
          input.lease.token,
          input.lease.fencingToken,
          input.recordedAt,
        ],
      );
      if (lease.rowCount !== 1) {
        throw new EvidencePersistenceError(
          'EVIDENCE_LEASE_NOT_OWNED',
          'Evidence export lease is expired, fenced, or owned by another worker.',
        );
      }
      const nextAttempt = await client.query<{ attempt_no: number }>(
        `SELECT COALESCE(max(attempt_no),0)::integer + 1 AS attempt_no
         FROM evidence_export_batch
         WHERE export_id=$1 AND source_partition=$2`,
        [input.batch.exportId, input.lease.sourcePartition],
      );
      const attemptNo = nextAttempt.rows[0]?.attempt_no ?? 1;
      const batchId = stableLedgerId('evidence-export-batch', {
        exportId: input.batch.exportId,
        sourcePartition: input.lease.sourcePartition,
        configurationRevision: input.batch.revision,
        firstSequence: input.batch.firstSequence,
        lastSequence: input.batch.lastSequence,
        batchHash: input.batch.batchHash,
        attemptNo,
      });
      const entry: EvidenceExportBatchLedgerEntry = Object.freeze({
        batchId,
        exportId: input.batch.exportId,
        sourcePartition: input.lease.sourcePartition,
        configurationRevision: input.batch.revision,
        firstSequence: input.batch.firstSequence,
        lastSequence: input.batch.lastSequence,
        batchHash: input.batch.batchHash,
        recordCount: input.batch.records.length,
        attemptNo,
        deliveryStatus: 'attempted',
        observationGeneration: 1,
        recordedAt: input.recordedAt,
      });
      await client.query(
        `INSERT INTO evidence_export_batch(
           batch_id,export_id,source_partition,configuration_revision,first_sequence,
           last_sequence,batch_hash,attempt_no,record_count,status,observation_generation,
           recorded_at)
         VALUES ($1,$2,$3,$4,$5::bigint,$6::bigint,$7,$8,$9,$10,$11,$12)`,
        [
          entry.batchId,
          entry.exportId,
          entry.sourcePartition,
          entry.configurationRevision,
          entry.firstSequence,
          entry.lastSequence,
          entry.batchHash,
          entry.attemptNo,
          entry.recordCount,
          entry.deliveryStatus,
          entry.observationGeneration,
          entry.recordedAt,
        ],
      );
      return entry;
    });
  }

  async recordAcknowledgement(input: {
    readonly lease: EvidenceDeliveryLease;
    readonly batch: EvidenceExportBatchLedgerEntry;
    readonly acknowledgedSequence: string | null;
    readonly ackDisposition: EvidenceExportAckLedgerEntry['ackDisposition'];
    readonly errorCode: string | null;
    readonly acknowledgedAt: string;
  }): Promise<EvidenceExportAckLedgerEntry> {
    if (
      input.batch.exportId !== input.lease.exportId ||
      input.batch.sourcePartition !== input.lease.sourcePartition
    ) {
      throw new EvidencePersistenceError(
        'EVIDENCE_ACK_INVALID',
        'Evidence ACK batch identity does not match the fenced lease.',
      );
    }
    if (input.ackDisposition !== 'rejected' && input.acknowledgedSequence === null) {
      throw new EvidencePersistenceError(
        'EVIDENCE_ACK_INVALID',
        'An accepted or partial ACK must identify an acknowledged sequence.',
      );
    }
    const ackId = stableLedgerId('evidence-export-ack', {
      batchId: input.batch.batchId,
      exportId: input.batch.exportId,
      sourcePartition: input.batch.sourcePartition,
      acknowledgedSequence: input.acknowledgedSequence,
      batchHash: input.batch.batchHash,
      ackDisposition: input.ackDisposition,
      errorCode: input.errorCode,
    });
    const entry: EvidenceExportAckLedgerEntry = Object.freeze({
      ackId,
      batchId: input.batch.batchId,
      exportId: input.batch.exportId,
      sourcePartition: input.batch.sourcePartition,
      acknowledgedSequence: input.acknowledgedSequence,
      batchHash: input.batch.batchHash,
      ackDisposition: input.ackDisposition,
      errorCode: input.errorCode,
      observationGeneration: 1,
      acknowledgedAt: input.acknowledgedAt,
    });
    await withTransaction(this.#pool, async (client) => {
      await client.query(
        `INSERT INTO evidence_export_ack(
           ack_id,batch_id,export_id,source_partition,acknowledged_sequence,batch_hash,
           ack_disposition,error_code,observation_generation,acknowledged_at)
         VALUES ($1,$2,$3,$4,$5::bigint,$6,$7,$8,$9,$10)`,
        [
          entry.ackId,
          entry.batchId,
          entry.exportId,
          entry.sourcePartition,
          entry.acknowledgedSequence,
          entry.batchHash,
          entry.ackDisposition,
          entry.errorCode,
          entry.observationGeneration,
          entry.acknowledgedAt,
        ],
      );
      if (entry.ackDisposition !== 'rejected' && entry.acknowledgedSequence !== null) {
        await this.#evidence.acknowledgeWithinTransaction(
          client,
          input.lease,
          entry.acknowledgedSequence,
          entry.acknowledgedAt,
        );
      }
    });
    return entry;
  }

  acknowledge(
    lease: EvidenceDeliveryLease,
    lastSequence: string,
    acknowledgedAt: string,
  ): Promise<void> {
    return this.#evidence.acknowledge(lease, lastSequence, acknowledgedAt);
  }

  async recordDeliveryFailure(
    sourcePartition: string,
    sequences: readonly string[],
    errorCode: string,
    configuration: ManagedEvidenceExportConfiguration,
    failedAt: string,
  ): Promise<void> {
    if (sequences.length === 0) return;
    const maximumAttempts = configuration.retryPolicy.maxAttempts ?? null;
    await withTransaction(this.#pool, async (client) => {
      const result = await client.query<{
        sequence: string;
        record_id: string;
        attempts: number;
      }>(
        `UPDATE evidence_outbox SET
         delivery_attempts=delivery_attempts+1,
         next_attempt_at=$1::timestamptz + make_interval(secs => LEAST(
           $2::double precision / 1000.0,
           ($3::double precision / 1000.0) * power(2,LEAST(delivery_attempts,20)))),
         last_error_code=$4
       WHERE source_partition=$5 AND sequence=ANY($6::bigint[]) AND acknowledged_at IS NULL
       RETURNING sequence::text,record_id,delivery_attempts::integer AS attempts`,
        [
          failedAt,
          configuration.retryPolicy.maxDelayMs,
          configuration.retryPolicy.baseDelayMs,
          errorCode,
          sourcePartition,
          sequences,
        ],
      );
      if (maximumAttempts !== null) {
        const issueCode = errorCode === 'EVIDENCE_ACK_INVALID' ? 'ack_invalid' : 'export_rejected';
        for (const record of result.rows.filter((row) => row.attempts >= maximumAttempts)) {
          await client.query(
            `INSERT INTO evidence_dead_letter(
             dead_letter_id,sequence,record_id,issue_code,attempts,detail,failed_at)
           VALUES ($1,$2::bigint,$3,$4,$5,$6::jsonb,$7)
           ON CONFLICT (sequence) DO UPDATE SET attempts=EXCLUDED.attempts,
             detail=EXCLUDED.detail,failed_at=EXCLUDED.failed_at,
             requeued_at=NULL,requeued_by=NULL,requeue_reason=NULL`,
            [
              `dead-letter:${record.sequence}`,
              record.sequence,
              record.record_id,
              issueCode,
              record.attempts,
              JSON.stringify({ errorCode }),
              failedAt,
            ],
          );
        }
      }
      await client.query(
        `INSERT INTO evidence_export_state(
         export_id,source_partition,status,last_error_code,last_error_at,observed_at)
       VALUES ($1,$2,'degraded',$3,$4,$4)
       ON CONFLICT (export_id,source_partition) DO UPDATE SET
         status='degraded',last_error_code=EXCLUDED.last_error_code,
         last_error_at=EXCLUDED.last_error_at,observed_at=EXCLUDED.observed_at`,
        [configuration.exportId, sourcePartition, errorCode, failedAt],
      );
    });
  }

  async status(observedAt: string): Promise<EvidenceExportStatus> {
    const result = await this.#pool.query<{
      export_id: string | null;
      revision: string | null;
      pending_records: string;
      oldest_pending_at: Date | string | null;
      last_acknowledged_sequence: string | null;
      last_acknowledged_at: Date | string | null;
      blocked: boolean;
      degraded: boolean;
      last_error_code: string | null;
      last_error_at: Date | string | null;
    }>(
      `WITH active AS (
         SELECT * FROM evidence_export_configuration WHERE is_active
       ), eligible AS (
         SELECT evidence.sequence,evidence.captured_at
         FROM evidence_outbox evidence
         JOIN active ON true
         WHERE evidence.acknowledged_at IS NULL
           AND active.definition->'includedFamilies' ? evidence.record_family
           AND NOT (evidence.evaluation_role='diagnostic' AND COALESCE(
             active.definition->'excludedDiagnosticTypes','[]'::jsonb
           ) ? evidence.record_type)
           AND NOT EXISTS (
             SELECT 1 FROM evidence_dead_letter dead_letter
             WHERE dead_letter.sequence=evidence.sequence
               AND dead_letter.requeued_at IS NULL
           )
       ), frontier_records AS (
         SELECT evidence.sequence,evidence.acknowledged_at
         FROM evidence_outbox evidence
         JOIN active ON true
         WHERE active.definition->'includedFamilies' ? evidence.record_family
           AND NOT (evidence.evaluation_role='diagnostic' AND COALESCE(
             active.definition->'excludedDiagnosticTypes','[]'::jsonb
           ) ? evidence.record_type)
       )
       SELECT active.export_id,active.revision::text,
         (SELECT count(*)::text FROM eligible) AS pending_records,
         (SELECT min(captured_at) FROM eligible) AS oldest_pending_at,
         (SELECT CASE
           WHEN count(*)=0 THEN NULL
           WHEN min(sequence) FILTER (WHERE acknowledged_at IS NULL) IS NULL
             THEN max(sequence)::text
           ELSE GREATEST(
             0,min(sequence) FILTER (WHERE acknowledged_at IS NULL)-1
           )::text
         END FROM frontier_records) AS last_acknowledged_sequence,
         (SELECT max(last_acknowledged_at) FROM evidence_export_state
           WHERE export_id=active.export_id) AS last_acknowledged_at,
         (SELECT count(*) FROM eligible) >= COALESCE(
           (active.definition->'outboxPolicy'->>'maxPendingRecords')::bigint,10000
         ) AS blocked,
         EXISTS(SELECT 1 FROM evidence_export_state WHERE export_id=active.export_id
           AND (status='degraded' OR (last_error_code IS NOT NULL
             AND last_error_code<>'EVIDENCE_OUTBOX_HIGH_WATERMARK'))) AS degraded,
         (SELECT last_error_code FROM evidence_export_state WHERE export_id=active.export_id
           AND last_error_code IS NOT NULL
           AND last_error_code<>'EVIDENCE_OUTBOX_HIGH_WATERMARK'
           ORDER BY last_error_at DESC NULLS LAST LIMIT 1)
           AS last_error_code,
         (SELECT max(last_error_at) FROM evidence_export_state WHERE export_id=active.export_id
           AND last_error_code<>'EVIDENCE_OUTBOX_HIGH_WATERMARK')
           AS last_error_at
       FROM active`,
    );
    const row = result.rows[0];
    if (row?.export_id === null || row?.export_id === undefined) {
      return Object.freeze({
        exportId: 'not-configured',
        status: 'disabled',
        pendingRecords: Number(row?.pending_records ?? '0'),
        observedAt,
      });
    }
    return Object.freeze({
      exportId: row.export_id,
      status: row.blocked ? 'blocked' : row.degraded ? 'degraded' : 'healthy',
      ...(row.revision === null ? {} : { activeRevision: Number(row.revision) }),
      ...(row.last_acknowledged_sequence === null
        ? {}
        : { lastAcknowledgedSequence: row.last_acknowledged_sequence }),
      pendingRecords: Number(row.pending_records),
      ...(row.oldest_pending_at === null ? {} : { oldestPendingAt: iso(row.oldest_pending_at) }),
      ...(row.last_acknowledged_at === null
        ? {}
        : { lastAcknowledgedAt: iso(row.last_acknowledged_at) }),
      ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
      ...(row.last_error_at === null ? {} : { lastErrorAt: iso(row.last_error_at) }),
      observedAt,
    });
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function stableLedgerId(
  prefix: 'evidence-export-batch' | 'evidence-export-ack',
  identity: Parameters<typeof hashCanonicalEvidenceJson>[0],
): string {
  return `${prefix}:${hashCanonicalEvidenceJson(identity).slice('sha256:'.length)}`;
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
