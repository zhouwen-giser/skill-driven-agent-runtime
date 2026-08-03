import type { Pool, PoolClient } from 'pg';

import type {
  EvidenceExportStatus,
  ManagedEvidenceExportConfiguration,
} from '../../domain/src/index.js';
import type {
  EvidenceDeliveryLease,
  RuntimeEvidenceExportStore,
} from '../../runtime-control-application/src/index.js';
import { PostgresEvidenceStore } from './evidence-store.js';

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
           WHERE evidence_dead_letter.sequence=evidence_outbox.sequence)
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
        for (const record of result.rows.filter((row) => row.attempts >= maximumAttempts)) {
          await client.query(
            `INSERT INTO evidence_dead_letter(
             dead_letter_id,sequence,record_id,issue_code,attempts,detail,failed_at)
           VALUES ($1,$2::bigint,$3,'export_rejected',$4,$5::jsonb,$6)
           ON CONFLICT (sequence) DO UPDATE SET attempts=EXCLUDED.attempts,
             detail=EXCLUDED.detail,failed_at=EXCLUDED.failed_at`,
            [
              `dead-letter:${record.sequence}`,
              record.sequence,
              record.record_id,
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
      `SELECT active.export_id,active.revision::text,
         (SELECT count(*)::text FROM evidence_outbox WHERE acknowledged_at IS NULL) AS pending_records,
         (SELECT min(captured_at) FROM evidence_outbox WHERE acknowledged_at IS NULL) AS oldest_pending_at,
         (SELECT max(last_acknowledged_sequence)::text FROM evidence_export_state
           WHERE export_id=active.export_id) AS last_acknowledged_sequence,
         (SELECT max(last_acknowledged_at) FROM evidence_export_state
           WHERE export_id=active.export_id) AS last_acknowledged_at,
         EXISTS(SELECT 1 FROM evidence_export_state WHERE export_id=active.export_id
           AND status='high_watermark') AS blocked,
         EXISTS(SELECT 1 FROM evidence_export_state WHERE export_id=active.export_id
           AND (status='degraded' OR last_error_code IS NOT NULL)) AS degraded,
         (SELECT last_error_code FROM evidence_export_state WHERE export_id=active.export_id
           AND last_error_code IS NOT NULL ORDER BY last_error_at DESC NULLS LAST LIMIT 1)
           AS last_error_code,
         (SELECT max(last_error_at) FROM evidence_export_state WHERE export_id=active.export_id)
           AS last_error_at
       FROM evidence_export_configuration active WHERE active.is_active`,
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
