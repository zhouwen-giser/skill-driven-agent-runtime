import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import type { TelemetryExportConfiguration } from '../../node-control-domain/src/index.js';
import { PostgresRuntimeTelemetryExportStore } from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const pool = new Pool({ connectionString, max: 4 });
const store = new PostgresRuntimeTelemetryExportStore(pool);
const now = '2026-08-03T01:00:00.000Z';

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE runtime_telemetry_export_outbox,runtime_telemetry_export_state,
      runtime_telemetry_export_configuration,runtime_event,agent_task,goal,conversation_context CASCADE`,
  );
  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES ('context-p11','user-p11',$1,$1)`,
    [now],
  );
  await pool.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,phase,phase_message,request_text,request_metadata,created_at,updated_at)
     VALUES ('task-p11','context-p11','user-p11','completed','done','P11 request','{}'::jsonb,$1,$1)`,
    [now],
  );
});

afterAll(async () => {
  await pool.end();
});

describe('P11 Runtime Telemetry Export PostgreSQL authority', { concurrent: false }, () => {
  it('captures real Runtime facts, retains failed records and advances an exact ACK', async () => {
    await store.apply(configuration(), now);
    await insertEvent('event-p11-1', 'task.completed', '2026-08-03T01:00:01.000Z');
    await insertEvent('event-p11-2', 'task.failed', '2026-08-03T01:00:02.000Z');

    await expect(store.capture(configuration(), now)).resolves.toBe(2);
    const pending = await store.pending(100, now);
    expect(pending.map((record) => record.family).sort()).toEqual([
      'task.completed',
      'task.failed',
    ]);
    await store.recordDeliveryFailure(
      pending.map((record) => record.sequence),
      'TELEMETRY_ENDPOINT_UNAVAILABLE',
      now,
    );
    await expect(store.status(now)).resolves.toMatchObject({
      status: 'degraded',
      pendingRecords: 2,
      lastErrorCode: 'TELEMETRY_ENDPOINT_UNAVAILABLE',
    });

    const lastSequence = pending.at(-1)?.sequence;
    if (lastSequence === undefined) throw new Error('P11_PENDING_BATCH_EMPTY');
    await store.acknowledge(lastSequence, '2026-08-03T01:01:00.000Z');
    await expect(store.status('2026-08-03T01:01:00.000Z')).resolves.toMatchObject({
      status: 'healthy',
      pendingRecords: 0,
      lastAcknowledgedSequence: lastSequence,
    });
  });

  it('stops collection at the durable high watermark without deleting retained records', async () => {
    const bounded = configuration({ outboxPolicy: { maxPendingRecords: 1 } });
    await store.apply(bounded, now);
    await insertEvent('event-p11-watermark-1', 'task.completed', '2026-08-03T01:00:01.000Z');
    await expect(store.capture(bounded, now)).resolves.toBe(1);
    await insertEvent('event-p11-watermark-2', 'task.failed', '2026-08-03T01:00:02.000Z');
    await expect(store.capture(bounded, '2026-08-03T01:00:03.000Z')).resolves.toBe(0);
    await expect(store.status('2026-08-03T01:00:03.000Z')).resolves.toMatchObject({
      status: 'blocked',
      pendingRecords: 1,
      lastErrorCode: 'TELEMETRY_OUTBOX_HIGH_WATERMARK',
    });
  });
});

function configuration(
  override: Partial<TelemetryExportConfiguration> = {},
): TelemetryExportConfiguration {
  return Object.freeze({
    exportId: 'export-p11',
    endpointRef: 'https://telemetry.example.test/ingest',
    sourceId: 'runtime-p11',
    credentialRef: 'env:P11_TEST_TOKEN',
    recordFamilies: Object.freeze(['runtime_event']),
    status: 'active',
    revision: 1,
    applyMode: 'hot_reload',
    ...override,
  });
}

async function insertEvent(eventId: string, eventType: string, occurredAt: string): Promise<void> {
  await pool.query(
    `INSERT INTO runtime_event(event_id,task_id,context_id,event_type,event_timestamp,summary,created_at)
     VALUES ($1,'task-p11','context-p11',$2,$3,'P11 runtime fact',$3)`,
    [eventId, eventType, occurredAt],
  );
}
