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
    _lastEventId: string | undefined,
    limit: number,
  ): Promise<readonly ArtifactOutboxEvent[]> {
    const result = await this.#pool.query<OutboxRow>(
      `SELECT event_id,event_type,aggregate_id,aggregate_version,payload,occurred_at
       FROM cognitive_runtime_outbox event
       WHERE (
         event.event_type LIKE 'artifact.%'
         OR event.event_type LIKE 'compiler.artifact_%'
       )
         AND event.published_at IS NULL
       ORDER BY event.occurred_at,event.event_id
       LIMIT $1`,
      [limit],
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
      const published = await client.query(
        `UPDATE cognitive_runtime_outbox
         SET published_at=$2
         WHERE event_id=$1 AND published_at IS NULL
           AND (
             event_type LIKE 'artifact.%'
             OR event_type LIKE 'compiler.artifact_%'
           )`,
        [eventId, updatedAt],
      );
      if (published.rowCount !== 1) throw new Error('ARTIFACT_OUTBOX_EVENT_CAS_CONFLICT');
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
