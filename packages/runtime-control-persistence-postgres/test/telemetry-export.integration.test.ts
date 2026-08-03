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
    `TRUNCATE evidence_source_checkpoint,evidence_outbox,evidence_export_state,
      evidence_export_configuration,runtime_event,agent_task,goal,conversation_context CASCADE`,
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

describe(
  'P11 compatibility over canonical Evidence PostgreSQL authority',
  { concurrent: false },
  () => {
    it('projects a real agent_task episode, retains failure and advances an exact ACK', async () => {
      await store.apply(configuration(), now);
      await updateTask('failed', '2026-08-03T01:00:02.000Z');

      await expect(store.capture(configuration(), now)).resolves.toBe(1);
      const pending = await store.pending(100, now);
      expect(pending.map((record) => record.family)).toEqual(['runtime.episode']);
      await store.recordDeliveryFailure(
        pending.map((record) => record.sequence),
        'TELEMETRY_ENDPOINT_UNAVAILABLE',
        now,
      );
      await expect(store.status(now)).resolves.toMatchObject({
        status: 'degraded',
        pendingRecords: 1,
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
      const bounded = configuration({ outboxPolicy: { maxPendingRecords: 2 } });
      await store.apply(bounded, now);
      await expect(store.capture(bounded, now)).resolves.toBe(1);
      await updateTask('failed', '2026-08-03T01:00:03.000Z');
      await expect(store.capture(bounded, '2026-08-03T01:00:04.000Z')).resolves.toBe(1);
      await expect(store.capture(bounded, '2026-08-03T01:00:05.000Z')).resolves.toBe(0);
      await expect(store.status('2026-08-03T01:00:05.000Z')).resolves.toMatchObject({
        status: 'blocked',
        pendingRecords: 2,
        lastErrorCode: 'EVIDENCE_OUTBOX_HIGH_WATERMARK',
      });
    });
  },
);

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

async function updateTask(phase: string, occurredAt: string): Promise<void> {
  await pool.query(
    `UPDATE agent_task SET phase=$1,phase_message=$1,updated_at=$2 WHERE task_id='task-p11'`,
    [phase, occurredAt],
  );
}
