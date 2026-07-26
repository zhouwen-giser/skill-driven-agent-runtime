import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  ArtifactOutboxConsumerRepository,
  ArtifactOutboxCursor,
  ArtifactOutboxEvent,
} from '../../../application/src/index.js';

interface OutboxRow extends QueryResultRow {
  event_id: string;
  event_type: string;
  aggregate_id: string;
  aggregate_version: number;
  payload: Readonly<Record<string, unknown>>;
  occurred_at: Date | string;
}

export class PostgresArtifactOutboxConsumerRepository implements ArtifactOutboxConsumerRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async loadCursor(consumerName: string): Promise<ArtifactOutboxCursor> {
    const result = await this.#pool.query<{ last_event_id: string | null; version: number }>(
      `SELECT last_event_id,version FROM cognitive_runtime_consumer_cursor
       WHERE consumer_name=$1`,
      [consumerName],
    );
    const row = result.rows[0];
    if (row === undefined) return Object.freeze({ version: 0 });
    return Object.freeze({
      ...(row.last_event_id === null ? {} : { lastEventId: row.last_event_id }),
      version: row.version,
    });
  }

  async readAfter(
    lastEventId: string | undefined,
    limit: number,
  ): Promise<readonly ArtifactOutboxEvent[]> {
    let lastSequence: string | null = null;
    if (lastEventId !== undefined) {
      const cursorEvent = await this.#pool.query<{ outbox_sequence: string | null }>(
        `SELECT outbox_sequence::text AS outbox_sequence
         FROM cognitive_runtime_outbox WHERE event_id=$1`,
        [lastEventId],
      );
      const row = cursorEvent.rows[0];
      if (row?.outbox_sequence === null || row === undefined) {
        throw new Error('ARTIFACT_OUTBOX_CURSOR_EVENT_MISSING');
      }
      lastSequence = row.outbox_sequence;
    }
    const result = await this.#pool.query<OutboxRow>(
      `SELECT event_id,event_type,aggregate_id,aggregate_version,payload,occurred_at
       FROM cognitive_runtime_outbox event
       WHERE (
         event.event_type IN (
           'artifact.validation_started',
           'artifact.validation_completed',
           'artifact.approval_recorded',
           'artifact.activated',
           'artifact.revalidating',
           'artifact.deprecated'
         )
         OR event.payload ? 'dependencyRef'
       )
         AND ($1::bigint IS NULL OR event.outbox_sequence>$1)
       ORDER BY event.outbox_sequence
       LIMIT $2`,
      [lastSequence, limit],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          eventId: row.event_id,
          eventType: row.event_type,
          aggregateId: row.aggregate_id,
          aggregateVersion: row.aggregate_version,
          payload: Object.freeze({ ...row.payload }),
          occurredAt:
            row.occurred_at instanceof Date
              ? row.occurred_at.toISOString()
              : new Date(row.occurred_at).toISOString(),
        }),
      ),
    );
  }

  async advanceCursor(
    consumerName: string,
    expectedVersion: number,
    eventId: string,
    updatedAt: string,
  ): Promise<void> {
    await inTransaction(this.#pool, async (client) => {
      const event = await client.query(
        `SELECT event_id FROM cognitive_runtime_outbox
         WHERE event_id=$1
           AND (
             event_type IN (
               'artifact.validation_started',
               'artifact.validation_completed',
               'artifact.approval_recorded',
               'artifact.activated',
               'artifact.revalidating',
               'artifact.deprecated'
             )
             OR payload ? 'dependencyRef'
           )`,
        [eventId],
      );
      if (event.rowCount !== 1) throw new Error('ARTIFACT_OUTBOX_CURSOR_EVENT_MISSING');
      const result =
        expectedVersion === 0
          ? await client.query(
              `INSERT INTO cognitive_runtime_consumer_cursor(
               consumer_name,last_event_id,version,updated_at)
             VALUES($1,$2,1,$3)
             ON CONFLICT(consumer_name) DO NOTHING`,
              [consumerName, eventId, updatedAt],
            )
          : await client.query(
              `UPDATE cognitive_runtime_consumer_cursor
             SET last_event_id=$3,version=version+1,updated_at=$4
             WHERE consumer_name=$1 AND version=$2`,
              [consumerName, expectedVersion, eventId, updatedAt],
            );
      if (result.rowCount !== 1) throw new Error('ARTIFACT_OUTBOX_CURSOR_CAS_CONFLICT');
    });
  }
}

async function inTransaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
