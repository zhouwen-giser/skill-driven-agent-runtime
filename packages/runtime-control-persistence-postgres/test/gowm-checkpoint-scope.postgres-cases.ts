import { hashCanonicalEvidenceJson } from '../../domain/src/index.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PostgresEvidenceStore, PostgresEvidenceOperationsRepository } from '../src/index.js';
import { directEvidencePartitionTask } from '../src/gowm-evidence-scope.js';

export async function verifyGowmCheckpointScope(
  pool: Pool,
  taskIds: readonly string[],
): Promise<void> {
  const [a, b] = taskIds;
  assert.ok(a);
  assert.ok(b);
  const owner = (
    await pool.query<{ device_id: string; sdar_service_key: string }>(
      'SELECT device_id,sdar_service_key FROM agent_task WHERE task_id=$1',
      [a],
    )
  ).rows[0];
  assert.ok(owner);
  const scope = {
    allowedDeviceIds: [owner.device_id],
    sdarServiceKey: owner.sdar_service_key,
    includeNonDevice: false,
  };
  const own = new PostgresEvidenceStore(pool, scope);
  const fixture = new PostgresEvidenceStore(pool);
  const query = new PostgresEvidenceOperationsRepository(pool, scope);
  const id = randomUUID();
  const at = new Date().toISOString();
  const partitions = (taskId: string) => [
    `runtime-core:${taskId}`,
    `skill:${taskId}`,
    `mcp-capability:${taskId}`,
    `v141:experience_task:${String(taskId.length)}:${taskId}`,
  ];
  for (const taskId of [a, b])
    for (const partition of partitions(taskId)) {
      const checkpoint = {
        sourceFamily: `scope-fixture-${id}`,
        sourcePartition: partition,
        lastOccurredAt: at,
        lastSourceRecordId: taskId,
        lastSourceRevision: id,
        lastPayloadHash: hashCanonicalEvidenceJson({ id, taskId, partition }),
        lastProjectedAt: at,
        projectorVersion: 'scope-fixture/v1',
      };
      if (taskId === a) {
        await own.saveCheckpoint(checkpoint);
        await own.saveCheckpoint(checkpoint);
      } else {
        await assert.rejects(own.saveCheckpoint(checkpoint), /EVIDENCE_TASK_DEVICE_SCOPE_DENIED/u);
        await fixture.saveCheckpoint(checkpoint);
        await assert.rejects(
          own.saveCheckpoint({ ...checkpoint, lastProjectedAt: new Date().toISOString() }),
          /EVIDENCE_TASK_DEVICE_SCOPE_DENIED/u,
        );
      }
      const result = await query.listCheckpoints({ sourcePartition: partition, limit: 100 });
      assert.equal(
        result.items.some((item) => item.sourceFamily === checkpoint.sourceFamily),
        taskId === a,
      );
    }
  assert.equal(directEvidencePartitionTask('v141:experience_task:4:a:车1'), 'a:车1');
  assert.throws(
    () => directEvidencePartitionTask(`v141:experience_task:1:${a}`),
    /EVIDENCE_PARTITION_IDENTITY_INVALID/u,
  );
  const global = {
    sourceFamily: `scope-fixture-${id}`,
    sourcePartition: `v141:experience_pattern:${String(id.length)}:${id}`,
    projectorVersion: 'scope-fixture/v1',
    lastOccurredAt: at,
    lastSourceRecordId: id,
    lastSourceRevision: id,
    lastPayloadHash: hashCanonicalEvidenceJson(id),
    lastProjectedAt: at,
  };
  await own.saveCheckpoint(global);
  assert.ok(
    (
      await query.listCheckpoints({ sourcePartition: global.sourcePartition, limit: 100 })
    ).items.some((item) => item.sourceFamily === global.sourceFamily),
  );
}
