import type { Pool, QueryResultRow } from 'pg';

import type {
  NodeControlEventRepository,
  NodeEventPage,
} from '../../node-control-application/src/index.js';
import {
  rehydrateNodeEventEnvelope,
  type NodeEventDataClassification,
  type NodeEventEnvelope,
  type NodeEventType,
} from '../../node-control-domain/src/index.js';

interface EventRow extends QueryResultRow {
  sequence: string;
  event_id: string;
  event_type: NodeEventType;
  occurred_at: Date;
  recorded_at: Date;
  node_id: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_revision: string;
  correlation_id: string;
  causation_id: string | null;
  actor_id: string | null;
  data_classification: NodeEventDataClassification;
  payload: Readonly<Record<string, unknown>>;
}

interface RuntimeEventRow extends QueryResultRow {
  outbox_sequence: string;
  event_id: string;
  event_type: 'node.capability.readiness_changed' | 'node.task.capability_bound';
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  correlation: Readonly<Record<string, unknown>>;
  occurred_at: Date;
}

export class PostgresNodeControlEventRepository implements NodeControlEventRepository {
  readonly #pool: Pool;
  readonly #runtimePool: Pool | undefined;
  #runtimeSynchronizationUnavailable = false;

  constructor(pool: Pool, runtimePool?: Pool) {
    this.#pool = pool;
    this.#runtimePool = runtimePool;
  }

  async listAfter(lastEventId: string | undefined, limit: number): Promise<NodeEventPage> {
    if (this.#runtimePool !== undefined) {
      try {
        await synchronizeRuntimeEvents(this.#pool, this.#runtimePool);
        this.#runtimeSynchronizationUnavailable = false;
      } catch (error) {
        if (errorCode(error) === 'NODE_EVENT_PAYLOAD_CONFLICT') throw error;
        if (!this.#runtimeSynchronizationUnavailable)
          process.stderr.write(
            `${JSON.stringify({ event: 'node_event.runtime_synchronization_failed', errorCode: 'RUNTIME_EVENT_SOURCE_UNAVAILABLE' })}\n`,
          );
        this.#runtimeSynchronizationUnavailable = true;
      }
    }
    let afterSequence = '0';
    if (lastEventId !== undefined) {
      const cursor = await this.#pool.query<{ sequence: string }>(
        'SELECT sequence::text FROM sdar_control.node_event_outbox WHERE event_id=$1',
        [lastEventId],
      );
      const row = cursor.rows[0];
      if (row === undefined)
        throw Object.assign(new Error('Node Event cursor was not found.'), {
          code: 'NODE_EVENT_CURSOR_NOT_FOUND',
          status: 409,
        });
      afterSequence = row.sequence;
    }
    const result = await this.#pool.query<EventRow>(
      `SELECT sequence::text,event_id,event_type,occurred_at,recorded_at,node_id,
              aggregate_type,aggregate_id,aggregate_revision::text,correlation_id,
              causation_id,actor_id,data_classification,payload
         FROM sdar_control.node_event_outbox
        WHERE sequence>$1::bigint
        ORDER BY sequence
        LIMIT $2`,
      [afterSequence, limit],
    );
    const items = Object.freeze(result.rows.map(mapEvent));
    const lastEvent = items.at(-1);
    return Object.freeze({
      items,
      ...(lastEvent === undefined ? {} : { lastEventId: lastEvent.eventId }),
    });
  }
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as Readonly<{ code?: unknown }>).code
    : undefined;
}

async function synchronizeRuntimeEvents(controlPool: Pool, runtimePool: Pool): Promise<void> {
  const client = await controlPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sdar_node_event_runtime_sync'))");
    const cursor = await client.query<{ last_sequence: string }>(
      `SELECT last_sequence::text
         FROM sdar_control.node_event_source_cursor
        WHERE source_name='runtime-cognitive-outbox'
        FOR UPDATE`,
    );
    const lastSequence = cursor.rows[0]?.last_sequence ?? '0';
    const watermark = await runtimePool.query<{ value: string }>(
      `SELECT COALESCE(MAX(outbox_sequence),0)::text AS value
         FROM cognitive_runtime_outbox`,
    );
    const highWatermark = watermark.rows[0]?.value ?? lastSequence;
    const source = await runtimePool.query<RuntimeEventRow>(
      `SELECT outbox_sequence::text,event_id,event_type,aggregate_type,aggregate_id,
              aggregate_version,correlation,occurred_at
         FROM cognitive_runtime_outbox
        WHERE outbox_sequence>$1::bigint AND outbox_sequence<=$2::bigint
          AND event_type IN ('node.capability.readiness_changed','node.task.capability_bound')
        ORDER BY outbox_sequence
        LIMIT 200`,
      [lastSequence, highWatermark],
    );
    const node = await client.query<{ node_id: string }>(
      'SELECT node_id FROM sdar_control.node_profile LIMIT 1',
    );
    const nodeId = node.rows[0]?.node_id;
    if (nodeId === undefined) {
      await client.query('COMMIT');
      return;
    }
    for (const event of source.rows) {
      const eventId = `runtime:${event.event_id}`;
      const correlationId = runtimeCorrelationId(event);
      const payload = {
        resourceRef: {
          type: event.aggregate_type,
          id: event.aggregate_id,
          revision: event.aggregate_version,
        },
        changeCode:
          event.event_type === 'node.capability.readiness_changed'
            ? 'READINESS_CHANGED'
            : 'TASK_CAPABILITY_BOUND',
      };
      const inserted = await client.query(
        `INSERT INTO sdar_control.node_event_outbox(
           event_id,event_type,occurred_at,node_id,aggregate_type,aggregate_id,
           aggregate_revision,correlation_id,causation_id,data_classification,payload)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'internal',$10::jsonb)
         ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
        [
          eventId,
          event.event_type,
          event.occurred_at,
          nodeId,
          event.aggregate_type,
          event.aggregate_id,
          event.aggregate_version,
          correlationId,
          event.event_id,
          JSON.stringify(payload),
        ],
      );
      if (inserted.rowCount === 0) {
        const replay = await client.query<{ identical: boolean }>(
          `SELECT event_type=$2 AND occurred_at=$3::timestamptz AND node_id=$4
                  AND aggregate_type=$5 AND aggregate_id=$6
                  AND aggregate_revision=$7::bigint AND correlation_id=$8
                  AND causation_id=$9 AND actor_id IS NULL
                  AND data_classification='internal' AND payload=$10::jsonb AS identical
             FROM sdar_control.node_event_outbox WHERE event_id=$1`,
          [
            eventId,
            event.event_type,
            event.occurred_at,
            nodeId,
            event.aggregate_type,
            event.aggregate_id,
            event.aggregate_version,
            correlationId,
            event.event_id,
            JSON.stringify(payload),
          ],
        );
        if (replay.rows[0]?.identical !== true) {
          throw Object.assign(
            new Error('Runtime Node Event identity was reused with new content.'),
            {
              code: 'NODE_EVENT_PAYLOAD_CONFLICT',
            },
          );
        }
      }
    }
    const lastCopied = source.rows.at(-1)?.outbox_sequence;
    const nextCursor = source.rows.length === 200 ? (lastCopied ?? lastSequence) : highWatermark;
    await client.query(
      `UPDATE sdar_control.node_event_source_cursor
          SET last_sequence=$2::bigint,updated_at=clock_timestamp()
        WHERE source_name=$1`,
      ['runtime-cognitive-outbox', nextCursor],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function runtimeCorrelationId(event: RuntimeEventRow): string {
  const candidate = event.correlation['correlationId'];
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate : event.event_id;
}

function mapEvent(row: EventRow): NodeEventEnvelope {
  return rehydrateNodeEventEnvelope({
    eventId: row.event_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
    nodeId: row.node_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateRevision: Number(row.aggregate_revision),
    correlationId: row.correlation_id,
    ...(row.causation_id === null ? {} : { causationId: row.causation_id }),
    ...(row.actor_id === null ? {} : { actorId: row.actor_id }),
    dataClassification: row.data_classification,
    payload: row.payload,
  });
}
