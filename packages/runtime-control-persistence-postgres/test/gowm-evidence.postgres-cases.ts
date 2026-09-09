import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import {
  createCatalogEvidenceEnvelope,
  hashCanonicalEvidenceJson,
} from '../../domain/src/index.js';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import {
  PostgresEvidenceStore,
  PostgresExperienceReplayArtifactEvidenceSource,
  PostgresRuntimeCoreEvidenceSource,
  PostgresSkillEvidenceSource,
  PostgresMcpCapabilityEvidenceSource,
} from '../src/index.js';

export async function verifyGowmEvidenceCases(
  pool: Pool,
  scope: DeviceWorkScope,
  run: string,
): Promise<string[]> {
  const deviceA = scope.allowedDeviceIds[0];
  assert.ok(deviceA);
  const onlyA = { ...scope, allowedDeviceIds: [deviceA] };
  const store = new PostgresEvidenceStore(pool, scope);
  const restricted = new PostgresEvidenceStore(pool, onlyA);
  const at = new Date().toISOString();
  const envelopes = [0, 1].map((index) => {
    const taskId = `${run}-task-${String(index)}`;
    return createCatalogEvidenceEnvelope({
      recordType: 'runtime.episode',
      sourceRecordId: taskId,
      sourceRevision: hashCanonicalEvidenceJson({ taskId }),
      taskId,
      contextId: `${run}-context`,
      episodeId: taskId,
      environment: 'integration',
      correlationId: taskId,
      occurredAt: at,
      recordedAt: at,
      payload: { episodeId: taskId, taskId, status: 'queued' },
    });
  });
  for (const envelope of envelopes) {
    assert.ok(envelope.taskId);
    const sequence = await store.append(envelope, at, `runtime-core:${envelope.taskId}`);
    assert.equal(await store.append(envelope, at, `runtime-core:${envelope.taskId}`), sequence);
  }
  const rows = await pool.query<{ device_id: string }>(
    'SELECT device_id FROM evidence_outbox WHERE record_id=ANY($1::text[]) ORDER BY task_id',
    [envelopes.map((envelope) => envelope.recordId)],
  );
  assert.deepEqual(
    rows.rows.map((row) => row.device_id),
    scope.allowedDeviceIds,
  );
  const [a, b] = envelopes;
  assert.ok(a && b);
  assert.equal(await restricted.hasRecord(a.recordId), true);
  assert.equal(await restricted.hasRecord(b.recordId), false);
  const foreignPartition = `runtime-core:${run}-task-1`;
  const leaseInput = {
    exportId: `${run}-export`,
    sourcePartition: foreignPartition,
    owner: run,
    token: run,
    acquiredAt: at,
    expiresAt: new Date(Date.parse(at) + 60000).toISOString(),
  };
  await assert.rejects(
    restricted.acquireLease(leaseInput),
    /EVIDENCE_PARTITION_DEVICE_SCOPE_DENIED/u,
  );
  const lease = { ...leaseInput, fencingToken: '1' };
  const sequence = await store.append(b, at, foreignPartition);
  await assert.rejects(
    restricted.markSent(lease, [sequence], at),
    /EVIDENCE_PARTITION_DEVICE_SCOPE_DENIED/u,
  );
  await assert.rejects(
    restricted.acknowledge(lease, sequence, at),
    /EVIDENCE_PARTITION_DEVICE_SCOPE_DENIED/u,
  );
  await assert.rejects(
    restricted.deadLetter(sequence, 'schema_invalid', {}, at),
    /EVIDENCE_DEAD_LETTER_RECORD_MISSING/u,
  );
  assert.equal(
    (
      await pool.query('SELECT 1 FROM evidence_export_state WHERE export_id=$1', [
        leaseInput.exportId,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (await pool.query('SELECT 1 FROM evidence_dead_letter WHERE sequence=$1', [sequence])).rowCount,
    0,
  );

  await assert.rejects(restricted.append(b, at, 'foreign'), /EVIDENCE_TASK_DEVICE_SCOPE_DENIED/u);
  await assert.rejects(
    store.append({ ...a, contextId: 'wrong-context' }, at, 'wrong-context'),
    /EVIDENCE_TASK_DEVICE_SCOPE_DENIED/u,
  );
  for (const Source of [
    PostgresRuntimeCoreEvidenceSource,
    PostgresSkillEvidenceSource,
    PostgresMcpCapabilityEvidenceSource,
  ]) {
    const source = new Source(pool, onlyA);
    assert.equal(await source.load(`${run}-task-1`), undefined);
    assert.ok(await source.load(`${run}-task-0`));
    const none = new Source(pool, { ...scope, allowedDeviceIds: [] });
    assert.deepEqual(await none.pendingTaskIds(10), []);
    assert.equal(await none.load(`${run}-task-0`), undefined);
  }
  assert.deepEqual(
    await new PostgresEvidenceStore(pool, {
      ...scope,
      allowedDeviceIds: [],
    }).pendingTerminalEpisodes(10),
    [],
  );
  for (const index of [0, 1]) {
    const snapshot = await new PostgresRuntimeCoreEvidenceSource(pool, scope).load(
      `${run}-task-${String(index)}`,
    );
    assert.equal(snapshot?.task['goal_id'], `${run}-goal`);
    assert.deepEqual(
      snapshot.stateTransitions.map((event) => event['instance_id']),
      [`${run}-instance-${String(index)}`],
    );
  }
  const experience = new PostgresExperienceReplayArtifactEvidenceSource(pool, onlyA);
  const candidates = await experience.pendingPartitions(1000);
  assert.ok(candidates.some((partition) => partition.sourceId === `${run}-task-0`));
  assert.equal(
    candidates.some((partition) => partition.episodeId === `${run}-task-1`),
    false,
  );
  for (const index of [0, 1]) {
    const taskId = `${run}-task-${String(index)}`;
    const partition = {
      kind: 'experience_task' as const,
      sourceFamily: 'experience' as const,
      sourceId: taskId,
      sourcePartition: `v141:experience_task:${String(taskId.length)}:${taskId}`,
      episodeId: taskId,
    };
    await assert.rejects(
      experience.load({
        kind: partition.kind,
        sourceFamily: partition.sourceFamily,
        sourceId: taskId,
        sourcePartition: partition.sourcePartition,
      }),
      /projection partition identity invalid/u,
    );
    const loaded = await experience.load(partition);
    if (index === 0) {
      assert.equal(loaded?.task?.['task_id'], taskId);
      assert.ok(loaded.corrections.length);
    } else assert.equal(loaded, undefined);
    assert.equal(
      await new PostgresExperienceReplayArtifactEvidenceSource(pool, {
        ...scope,
        allowedDeviceIds: [],
      }).load(partition),
      undefined,
    );
  }
  return [
    'Native Evidence Task ownership, idempotency, context rejection, and Runtime/Skill/MCP/Experience source device isolation',
  ];
}
