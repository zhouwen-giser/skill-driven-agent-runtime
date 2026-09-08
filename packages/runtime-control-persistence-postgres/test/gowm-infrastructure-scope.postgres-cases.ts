import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { evidenceInfrastructureSourcePartition } from '../../runtime-control-application/src/index.js';
import { PostgresEvidenceInfrastructureSource } from '../src/evidence-infrastructure-source.js';

/** Reuses existing direct Task checkpoints; creates no Task or external calls. */
export async function verifyGowmInfrastructureScope(pool: Pool, taskIds: readonly string[]) {
  const [a, b] = taskIds;
  assert.ok(a);
  assert.ok(b);
  const owners = await pool.query<{ task_id: string; device_id: string; sdar_service_key: string }>(
    'SELECT task_id,device_id,sdar_service_key FROM agent_task WHERE task_id=ANY($1::text[])',
    [taskIds],
  );
  assert.equal(owners.rowCount, 2);
  const owner = owners.rows.find((row) => row.task_id === a);
  assert.ok(owner);
  assert.notEqual(owner.device_id, owners.rows.find((row) => row.task_id === b)?.device_id);
  const source = new PostgresEvidenceInfrastructureSource(pool, {
    allowedDeviceIds: [owner.device_id],
    sdarServiceKey: owner.sdar_service_key,
    includeNonDevice: false,
  });
  for (const taskId of [a, b]) {
    const result = await pool.query<{ source_family: string; source_partition: string }>(
      `SELECT source_family,source_partition FROM evidence_source_checkpoint
       WHERE source_partition=$1 AND source_family LIKE 'scope-fixture-%'
       ORDER BY last_projected_at DESC LIMIT 1`,
      [`runtime-core:${taskId}`],
    );
    const row = result.rows[0];
    assert.ok(row, 'Existing checkpoint fixture must be nonempty');
    const sourceRecordId = `${String(row.source_family.length)}:${row.source_family}:${String(row.source_partition.length)}:${row.source_partition}`;
    const partition = {
      kind: 'source_checkpoint',
      recordType: 'evidence.source_checkpoint',
      sourceRecordId,
      sourcePartition: evidenceInfrastructureSourcePartition('source_checkpoint', sourceRecordId),
    } as const;
    const snapshot = await source.load(partition);
    if (taskId === a) {
      assert.ok(snapshot);
      assert.equal(snapshot.row['task_id'], a);
    } else assert.equal(snapshot, undefined);
  }
  const pending = await source.pendingPartitions(1000);
  assert.ok(pending.length > 0, 'Pending source list must be nonempty');
  for (const partition of pending) {
    const snapshot = await source.load(partition);
    if (snapshot?.row['task_id'] !== undefined) assert.equal(snapshot.row['task_id'], a);
  }
}
