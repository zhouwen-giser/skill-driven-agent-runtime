import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { createCatalogEvidenceEnvelope } from '../../domain/src/index.js';
import {
  normalizeTelemetryExportConfiguration,
  type TelemetryExportConfiguration,
  type TelemetryExportStatus,
} from '../../node-control-domain/src/index.js';
import type {
  RuntimeTelemetryExportStore,
  TelemetryExportRecord,
} from '../../runtime-control-application/src/index.js';
import { PostgresEvidenceStore } from './evidence-store.js';

const compatibilityPartition = 'runtime:episodes';
const compatibilityProjector = 'v1.4.1-phase3-compatibility';

/**
 * Temporary Phase 3 compatibility for the P11 application surface. The legacy
 * telemetry tables are gone: this class projects authoritative agent_task rows
 * into canonical runtime.episode records in the sole Evidence outbox. Phase 4
 * removes this application-facing compatibility name and wire contract.
 */
export class PostgresRuntimeTelemetryExportStore implements RuntimeTelemetryExportStore {
  readonly #pool: Pool;
  readonly #evidence: PostgresEvidenceStore;

  constructor(pool: Pool) {
    this.#pool = pool;
    this.#evidence = new PostgresEvidenceStore(pool);
  }

  async findActive(): Promise<TelemetryExportConfiguration | undefined> {
    const result = await this.#pool.query<{ definition: TelemetryExportConfiguration }>(
      'SELECT definition FROM evidence_export_configuration WHERE is_active',
    );
    const row = result.rows[0];
    return row === undefined ? undefined : normalizeTelemetryExportConfiguration(row.definition);
  }

  async apply(configuration: TelemetryExportConfiguration, observedAt: string): Promise<void> {
    const normalized = normalizeTelemetryExportConfiguration(configuration);
    const checksum = sha256(JSON.stringify(normalized));
    await withTransaction(this.#pool, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('runtime.evidence-export'))`);
      const existing = await client.query<{ checksum: string }>(
        `SELECT checksum::text FROM evidence_export_configuration
         WHERE export_id=$1 AND revision=$2`,
        [normalized.exportId, normalized.revision],
      );
      if (existing.rows[0] !== undefined && existing.rows[0].checksum !== checksum) {
        throw Object.assign(new Error('Evidence export revision content is immutable.'), {
          code: 'TELEMETRY_EXPORT_REVISION_CONFLICT',
        });
      }
      const active = await client.query<{ revision: string }>(
        'SELECT revision::text FROM evidence_export_configuration WHERE is_active',
      );
      if (active.rows[0] !== undefined && Number(active.rows[0].revision) > normalized.revision) {
        throw Object.assign(new Error('Evidence export revision is stale.'), {
          code: 'TELEMETRY_EXPORT_REVISION_STALE',
        });
      }
      await client.query(
        'UPDATE evidence_export_configuration SET is_active=false,is_lkg=false WHERE is_active OR is_lkg',
      );
      await client.query(
        `INSERT INTO evidence_export_configuration(
           export_id,revision,definition,checksum,applied_at,is_active,is_lkg)
         VALUES ($1,$2,$3::jsonb,$4,$5,true,true)
         ON CONFLICT (export_id,revision) DO UPDATE SET
           applied_at=EXCLUDED.applied_at,is_active=true,is_lkg=true`,
        [
          normalized.exportId,
          normalized.revision,
          JSON.stringify(normalized),
          checksum,
          observedAt,
        ],
      );
      await client.query(
        `INSERT INTO evidence_export_state(export_id,source_partition,observed_at)
         VALUES ($1,$2,$3)
         ON CONFLICT (export_id,source_partition) DO UPDATE SET
           observed_at=EXCLUDED.observed_at,last_error_code=NULL,last_error_at=NULL`,
        [normalized.exportId, compatibilityPartition, observedAt],
      );
    });
  }

  async recordProbe(result: Readonly<{ errorCode?: string }>, observedAt: string): Promise<void> {
    await this.#pool.query(
      `UPDATE evidence_export_state SET
         status=CASE WHEN $1::text IS NULL THEN 'idle' ELSE 'degraded' END,
         last_error_code=$1,last_error_at=CASE WHEN $1::text IS NULL THEN NULL ELSE $2::timestamptz END,
         observed_at=$2 WHERE source_partition=$3`,
      [result.errorCode ?? null, observedAt, compatibilityPartition],
    );
  }

  async capture(configuration: TelemetryExportConfiguration, observedAt: string): Promise<number> {
    return withTransaction(this.#pool, async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('runtime.evidence-export.compatibility-capture'))`,
      );
      const pending = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM evidence_outbox
         WHERE acknowledged_at IS NULL`,
      );
      const remaining = maximumPending(configuration) - Number(pending.rows[0]?.count ?? '0');
      if (remaining <= 0) {
        await client.query(
          `UPDATE evidence_export_state SET status='high_watermark',
             last_error_code='EVIDENCE_OUTBOX_HIGH_WATERMARK',last_error_at=$1,observed_at=$1
           WHERE export_id=$2 AND source_partition=$3`,
          [observedAt, configuration.exportId, compatibilityPartition],
        );
        return 0;
      }
      const checkpoint = await client.query<{
        last_occurred_at: Date | string | null;
        last_source_record_id: string | null;
      }>(
        `SELECT last_occurred_at,last_source_record_id FROM evidence_source_checkpoint
         WHERE source_family='runtime.episode' AND source_partition=$1 FOR UPDATE`,
        [compatibilityPartition],
      );
      const cursor = checkpoint.rows[0];
      const tasks = await client.query<{
        task_id: string;
        context_id: string;
        phase: string;
        created_at: Date | string;
        updated_at: Date | string;
      }>(
        `SELECT task_id,context_id,phase,created_at,updated_at FROM agent_task
         WHERE ($1::timestamptz IS NULL OR (updated_at,task_id)>($1::timestamptz,$2::text))
         ORDER BY updated_at,task_id LIMIT $3`,
        [
          cursor?.last_occurred_at ?? null,
          cursor?.last_source_record_id ?? '',
          Math.min(1_000, remaining),
        ],
      );
      let captured = 0;
      for (const task of tasks.rows) {
        const updatedAt = toIso(task.updated_at);
        const envelope = createCatalogEvidenceEnvelope({
          recordType: 'runtime.episode',
          sourceRecordId: task.task_id,
          sourceRevision: updatedAt,
          environment: 'runtime',
          correlationId: task.context_id,
          occurredAt: updatedAt,
          recordedAt: updatedAt,
          taskId: task.task_id,
          contextId: task.context_id,
          episodeId: task.task_id,
          payload: { episodeId: task.task_id, taskId: task.task_id, status: task.phase },
        });
        await this.#evidence.appendWithinTransaction(
          client,
          envelope,
          observedAt,
          compatibilityPartition,
        );
        captured += 1;
      }
      const last = tasks.rows.at(-1);
      if (last !== undefined) {
        const lastUpdated = toIso(last.updated_at);
        const lastEnvelope = createCatalogEvidenceEnvelope({
          recordType: 'runtime.episode',
          sourceRecordId: last.task_id,
          sourceRevision: lastUpdated,
          environment: 'runtime',
          correlationId: last.context_id,
          occurredAt: lastUpdated,
          recordedAt: lastUpdated,
          taskId: last.task_id,
          contextId: last.context_id,
          episodeId: last.task_id,
          payload: { episodeId: last.task_id, taskId: last.task_id, status: last.phase },
        });
        await client.query(
          `INSERT INTO evidence_source_checkpoint(
             source_family,source_partition,last_occurred_at,last_source_record_id,
             last_source_revision,last_payload_hash,last_projected_at,projector_version)
           VALUES ('runtime.episode',$1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (source_family,source_partition) DO UPDATE SET
             last_occurred_at=EXCLUDED.last_occurred_at,
             last_source_record_id=EXCLUDED.last_source_record_id,
             last_source_revision=EXCLUDED.last_source_revision,
             last_payload_hash=EXCLUDED.last_payload_hash,
             last_projected_at=EXCLUDED.last_projected_at,
             projector_version=EXCLUDED.projector_version`,
          [
            compatibilityPartition,
            last.updated_at,
            last.task_id,
            lastUpdated,
            lastEnvelope.payloadHash,
            observedAt,
            compatibilityProjector,
          ],
        );
      }
      return captured;
    });
  }

  async pending(limit: number, observedAt: string): Promise<readonly TelemetryExportRecord[]> {
    const result = await this.#pool.query<{
      sequence: string;
      record_type: string;
      occurred_at: Date | string;
      payload: Readonly<Record<string, unknown>>;
    }>(
      `SELECT sequence::text,record_type,occurred_at,payload FROM evidence_outbox
       WHERE source_partition=$1 AND acknowledged_at IS NULL AND next_attempt_at<=$2
       ORDER BY sequence LIMIT $3`,
      [compatibilityPartition, observedAt, Math.max(1, Math.min(limit, 1_000))],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          sequence: Number(row.sequence),
          family: row.record_type,
          occurredAt: toIso(row.occurred_at),
          payload: Object.freeze(structuredClone(row.payload)),
        }),
      ),
    );
  }

  async acknowledge(lastSequence: number, acknowledgedAt: string): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      await client.query(
        `UPDATE evidence_outbox SET acknowledged_at=$2,last_error_code=NULL
         WHERE sequence<=$1 AND source_partition=$3 AND acknowledged_at IS NULL`,
        [lastSequence, acknowledgedAt, compatibilityPartition],
      );
      await client.query(
        `UPDATE evidence_export_state SET last_sent_sequence=GREATEST(
           COALESCE(last_sent_sequence,0),$1),last_acknowledged_sequence=$1,
           last_acknowledged_at=$2,status='idle',last_error_code=NULL,last_error_at=NULL,
           observed_at=$2 WHERE source_partition=$3`,
        [lastSequence, acknowledgedAt, compatibilityPartition],
      );
    });
  }

  async recordDeliveryFailure(
    sequences: readonly number[],
    errorCode: string,
    failedAt: string,
  ): Promise<void> {
    await this.#pool.query(
      `UPDATE evidence_outbox SET delivery_attempts=delivery_attempts+1,
         next_attempt_at=$2::timestamptz + make_interval(secs => LEAST(300,
           power(2,LEAST(delivery_attempts,8))::integer)),last_error_code=$3
       WHERE sequence=ANY($1::bigint[]) AND acknowledged_at IS NULL`,
      [sequences, failedAt, errorCode],
    );
    await this.#pool.query(
      `UPDATE evidence_export_state SET status='degraded',last_error_code=$1,
         last_error_at=$2,observed_at=$2 WHERE source_partition=$3`,
      [errorCode, failedAt, compatibilityPartition],
    );
  }

  async status(observedAt: string): Promise<TelemetryExportStatus> {
    const result = await this.#pool.query<{
      export_id: string;
      revision: string | null;
      status: string;
      pending_records: string;
      oldest_pending_at: Date | string | null;
      last_acknowledged_sequence: string | null;
      last_acknowledged_at: Date | string | null;
      last_error_code: string | null;
      last_error_at: Date | string | null;
    }>(
      `SELECT state.export_id,active.revision::text,state.status,
          count(outbox.sequence) FILTER (WHERE outbox.acknowledged_at IS NULL)::text AS pending_records,
          min(outbox.captured_at) FILTER (WHERE outbox.acknowledged_at IS NULL) AS oldest_pending_at,
          state.last_acknowledged_sequence::text,state.last_acknowledged_at,
          state.last_error_code,state.last_error_at
       FROM evidence_export_state state
       LEFT JOIN evidence_export_configuration active ON active.is_active AND active.export_id=state.export_id
       LEFT JOIN evidence_outbox outbox ON outbox.source_partition=state.source_partition
       WHERE state.source_partition=$1
       GROUP BY state.export_id,active.revision,state.status,state.last_acknowledged_sequence,
         state.last_acknowledged_at,state.last_error_code,state.last_error_at`,
      [compatibilityPartition],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return Object.freeze({
        exportId: 'not-configured',
        status: 'disabled',
        pendingRecords: 0,
        observedAt,
      });
    }
    return Object.freeze({
      exportId: row.export_id,
      status:
        row.status === 'high_watermark'
          ? 'blocked'
          : row.last_error_code === null
            ? 'healthy'
            : 'degraded',
      ...(row.revision === null ? {} : { activeRevision: Number(row.revision) }),
      ...(row.last_acknowledged_sequence === null
        ? {}
        : { lastAcknowledgedSequence: Number(row.last_acknowledged_sequence) }),
      pendingRecords: Number(row.pending_records),
      ...(row.oldest_pending_at === null ? {} : { oldestPendingAt: toIso(row.oldest_pending_at) }),
      ...(row.last_acknowledged_at === null
        ? {}
        : { lastAcknowledgedAt: toIso(row.last_acknowledged_at) }),
      ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
      ...(row.last_error_at === null ? {} : { lastErrorAt: toIso(row.last_error_at) }),
      observedAt,
    });
  }
}

function maximumPending(configuration: TelemetryExportConfiguration): number {
  const value = configuration.outboxPolicy?.['maxPendingRecords'];
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 1_000_000
    ? value
    : 10_000;
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
