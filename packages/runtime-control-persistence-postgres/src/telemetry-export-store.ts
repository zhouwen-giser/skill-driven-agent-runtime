import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  normalizeTelemetryExportConfiguration,
  type TelemetryExportConfiguration,
  type TelemetryExportStatus,
} from '../../node-control-domain/src/index.js';
import type {
  RuntimeTelemetryExportStore,
  TelemetryExportRecord,
} from '../../runtime-control-application/src/index.js';

export class PostgresRuntimeTelemetryExportStore implements RuntimeTelemetryExportStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findActive(): Promise<TelemetryExportConfiguration | undefined> {
    const result = await this.#pool.query<{ definition: TelemetryExportConfiguration }>(
      `SELECT definition FROM runtime_telemetry_export_configuration WHERE is_active`,
    );
    const row = result.rows[0];
    return row === undefined ? undefined : normalizeTelemetryExportConfiguration(row.definition);
  }

  async apply(configuration: TelemetryExportConfiguration, observedAt: string): Promise<void> {
    const normalized = normalizeTelemetryExportConfiguration(configuration);
    const checksum = sha256(JSON.stringify(normalized));
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('runtime.telemetry-export'))`);
      const existing = await client.query<{ checksum: string }>(
        `SELECT checksum::text FROM runtime_telemetry_export_configuration
         WHERE export_id=$1 AND revision=$2`,
        [normalized.exportId, normalized.revision],
      );
      if (existing.rows[0] !== undefined && existing.rows[0].checksum !== checksum)
        throw Object.assign(new Error('Telemetry revision content is immutable.'), {
          code: 'TELEMETRY_EXPORT_REVISION_CONFLICT',
        });
      const active = await client.query<{ revision: string }>(
        `SELECT revision::text FROM runtime_telemetry_export_configuration WHERE is_active`,
      );
      if (active.rows[0] !== undefined && Number(active.rows[0].revision) > normalized.revision)
        throw Object.assign(new Error('Telemetry revision is stale.'), {
          code: 'TELEMETRY_EXPORT_REVISION_STALE',
        });
      await client.query(
        `UPDATE runtime_telemetry_export_configuration SET is_active=false,is_lkg=false
         WHERE is_active OR is_lkg`,
      );
      await client.query(
        `INSERT INTO runtime_telemetry_export_configuration(
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
        `INSERT INTO runtime_telemetry_export_state(singleton,export_id,observed_at)
         VALUES (true,$1,$2)
         ON CONFLICT (singleton) DO UPDATE SET
           collector_created_at=CASE
             WHEN runtime_telemetry_export_state.export_id=EXCLUDED.export_id
             THEN runtime_telemetry_export_state.collector_created_at ELSE NULL END,
           collector_event_id=CASE
             WHEN runtime_telemetry_export_state.export_id=EXCLUDED.export_id
             THEN runtime_telemetry_export_state.collector_event_id ELSE NULL END,
           last_acknowledged_sequence=CASE
             WHEN runtime_telemetry_export_state.export_id=EXCLUDED.export_id
             THEN runtime_telemetry_export_state.last_acknowledged_sequence ELSE NULL END,
           last_acknowledged_at=CASE
             WHEN runtime_telemetry_export_state.export_id=EXCLUDED.export_id
             THEN runtime_telemetry_export_state.last_acknowledged_at ELSE NULL END,
           export_id=EXCLUDED.export_id,observed_at=EXCLUDED.observed_at,
           last_error_code=NULL,last_error_at=NULL`,
        [normalized.exportId, observedAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordProbe(result: Readonly<{ errorCode?: string }>, observedAt: string): Promise<void> {
    await this.#pool.query(
      `UPDATE runtime_telemetry_export_state SET probe_healthy=$1,
         last_error_code=$2,last_error_at=CASE WHEN $2::text IS NULL THEN NULL ELSE $3::timestamptz END,
         observed_at=$3 WHERE singleton`,
      [result.errorCode === undefined, result.errorCode ?? null, observedAt],
    );
  }

  async capture(configuration: TelemetryExportConfiguration, observedAt: string): Promise<number> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('runtime.telemetry-export.capture'))`,
      );
      const pending = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM runtime_telemetry_export_outbox
         WHERE export_id=$1 AND acknowledged_at IS NULL`,
        [configuration.exportId],
      );
      const pendingCount = Number(pending.rows[0]?.count ?? '0');
      const pendingLimit = maximumPending(configuration);
      if (pendingCount >= pendingLimit) {
        await this.#recordError(client, 'TELEMETRY_OUTBOX_HIGH_WATERMARK', observedAt);
        await client.query('COMMIT');
        return 0;
      }
      const state = await client.query<{
        collector_created_at: Date | string | null;
        collector_event_id: string | null;
      }>(
        `SELECT collector_created_at,collector_event_id FROM runtime_telemetry_export_state
         WHERE singleton FOR UPDATE`,
      );
      const cursor = state.rows[0];
      const events = await client.query<{
        event_id: string;
        task_id: string;
        context_id: string;
        event_type: string;
        event_timestamp: Date | string;
        summary: string;
        created_at: Date | string;
      }>(
        `SELECT event_id,task_id,context_id,event_type,event_timestamp,summary,created_at
         FROM runtime_event
         WHERE ($1::timestamptz IS NULL OR (created_at,event_id)>($1::timestamptz,$2::text))
           AND ($4::boolean OR event_type=ANY($5::text[]))
         ORDER BY created_at,event_id LIMIT $3`,
        [
          cursor?.collector_created_at ?? null,
          cursor?.collector_event_id ?? '',
          Math.min(1_000, pendingLimit - pendingCount),
          configuration.recordFamilies.includes('runtime_event') ||
            configuration.recordFamilies.includes('task_event'),
          configuration.recordFamilies,
        ],
      );
      let captured = 0;
      for (const event of events.rows) {
        const inserted = await client.query(
          `INSERT INTO runtime_telemetry_export_outbox(
             export_id,source_event_id,family,occurred_at,payload,captured_at,next_attempt_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$6)
           ON CONFLICT (source_event_id) DO NOTHING`,
          [
            configuration.exportId,
            event.event_id,
            event.event_type,
            toIso(event.event_timestamp),
            JSON.stringify({
              eventId: event.event_id,
              taskId: event.task_id,
              contextId: event.context_id,
              eventType: event.event_type,
              occurredAt: toIso(event.event_timestamp),
              summary: event.summary,
              sourceId: configuration.sourceId,
              ...(configuration.nodeId === undefined ? {} : { nodeId: configuration.nodeId }),
            }),
            observedAt,
          ],
        );
        captured += inserted.rowCount ?? 0;
      }
      const last = events.rows.at(-1);
      if (last !== undefined) {
        await client.query(
          `UPDATE runtime_telemetry_export_state
           SET collector_created_at=$1,collector_event_id=$2,observed_at=$3 WHERE singleton`,
          [last.created_at, last.event_id, observedAt],
        );
      }
      await client.query('COMMIT');
      return captured;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async pending(limit: number, observedAt: string): Promise<readonly TelemetryExportRecord[]> {
    const result = await this.#pool.query<{
      sequence: string;
      family: string;
      occurred_at: Date | string;
      payload: Readonly<Record<string, unknown>>;
    }>(
      `SELECT sequence::text,family,occurred_at,payload
       FROM runtime_telemetry_export_outbox outbox
       JOIN runtime_telemetry_export_state state
         ON state.singleton AND state.export_id=outbox.export_id
       WHERE outbox.acknowledged_at IS NULL AND outbox.next_attempt_at<=$1
       ORDER BY sequence LIMIT $2`,
      [observedAt, limit],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          sequence: Number(row.sequence),
          family: row.family,
          occurredAt: toIso(row.occurred_at),
          payload: Object.freeze(structuredClone(row.payload)),
        }),
      ),
    );
  }

  async acknowledge(lastSequence: number, acknowledgedAt: string): Promise<void> {
    await this.#pool.query(
      `UPDATE runtime_telemetry_export_outbox
       SET acknowledged_at=$2,last_error_code=NULL
       WHERE sequence<=$1 AND acknowledged_at IS NULL
         AND export_id=(SELECT export_id FROM runtime_telemetry_export_state WHERE singleton)`,
      [lastSequence, acknowledgedAt],
    );
    await this.#pool.query(
      `UPDATE runtime_telemetry_export_state SET last_acknowledged_sequence=$1,
       last_acknowledged_at=$2,last_error_code=NULL,last_error_at=NULL,observed_at=$2 WHERE singleton`,
      [lastSequence, acknowledgedAt],
    );
  }

  async recordDeliveryFailure(
    sequences: readonly number[],
    errorCode: string,
    failedAt: string,
  ): Promise<void> {
    await this.#pool.query(
      `UPDATE runtime_telemetry_export_outbox outbox
       SET delivery_attempts=outbox.delivery_attempts+1,
         next_attempt_at=$2::timestamptz + make_interval(secs => LEAST(
           COALESCE((active.definition->'retryPolicy'->>'maxDelaySeconds')::integer,300),
           COALESCE((active.definition->'retryPolicy'->>'baseDelaySeconds')::integer,1) *
             power(2,LEAST(outbox.delivery_attempts,8))::integer)),
         last_error_code=$3
       FROM runtime_telemetry_export_configuration active
       WHERE active.is_active AND outbox.export_id=active.export_id
         AND outbox.sequence=ANY($1::bigint[]) AND outbox.acknowledged_at IS NULL`,
      [sequences, failedAt, errorCode],
    );
    await this.#pool.query(
      `UPDATE runtime_telemetry_export_state SET last_error_code=$1,last_error_at=$2,
       observed_at=$2 WHERE singleton`,
      [errorCode, failedAt],
    );
  }

  async status(observedAt: string): Promise<TelemetryExportStatus> {
    const result = await this.#pool.query<{
      export_id: string | null;
      revision: string | null;
      pending_records: string;
      oldest_pending_at: Date | string | null;
      last_acknowledged_sequence: string | null;
      last_acknowledged_at: Date | string | null;
      last_error_code: string | null;
      last_error_at: Date | string | null;
      probe_healthy: boolean | null;
    }>(
      `SELECT state.export_id,active.revision::text,
          count(outbox.sequence) FILTER (WHERE outbox.acknowledged_at IS NULL)::text AS pending_records,
          min(outbox.captured_at) FILTER (WHERE outbox.acknowledged_at IS NULL) AS oldest_pending_at,
          state.last_acknowledged_sequence::text,state.last_acknowledged_at,
          state.last_error_code,state.last_error_at,state.probe_healthy
       FROM runtime_telemetry_export_state state
       LEFT JOIN runtime_telemetry_export_configuration active ON active.is_active
       LEFT JOIN runtime_telemetry_export_outbox outbox ON outbox.export_id=state.export_id
       WHERE state.singleton
       GROUP BY state.export_id,active.revision,state.last_acknowledged_sequence,
         state.last_acknowledged_at,state.last_error_code,state.last_error_at,state.probe_healthy`,
    );
    const row = result.rows[0];
    if (row === undefined)
      return Object.freeze({
        exportId: 'not-configured',
        status: 'disabled',
        pendingRecords: 0,
        observedAt,
      });
    const status =
      row.last_error_code === 'TELEMETRY_OUTBOX_HIGH_WATERMARK'
        ? 'blocked'
        : row.last_error_code !== null || row.probe_healthy === false
          ? 'degraded'
          : 'healthy';
    return Object.freeze({
      exportId: row.export_id ?? 'not-configured',
      status,
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

  async #recordError(client: PoolClient, errorCode: string, observedAt: string): Promise<void> {
    await client.query(
      `UPDATE runtime_telemetry_export_state SET last_error_code=$1,last_error_at=$2,
       observed_at=$2 WHERE singleton`,
      [errorCode, observedAt],
    );
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
