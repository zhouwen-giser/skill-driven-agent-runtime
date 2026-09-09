import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { hashCanonicalEvidenceJson } from '../../domain/src/index.js';
import { PostgresEvidenceStore, PostgresEvidenceOperationsRepository } from '../src/index.js';

export async function verifyGowmRecoveryScope(
  pool: Pool,
  scope: DeviceWorkScope,
  run: string,
): Promise<void> {
  const configuration = await new PostgresEvidenceStore(pool, scope).findActiveConfiguration();
  assert.ok(configuration);
  const device = scope.allowedDeviceIds[0];
  assert.ok(device);
  const own = new PostgresEvidenceOperationsRepository(pool, {
    ...scope,
    allowedDeviceIds: [device],
  });
  const all = new PostgresEvidenceOperationsRepository(pool, scope);
  const records = await pool.query<{
    record_id: string;
    task_id: string;
    source_partition: string;
    sequence: string;
  }>(
    'SELECT DISTINCT ON(task_id) record_id,task_id,source_partition,sequence::text FROM evidence_outbox WHERE task_id=ANY($1::text[]) ORDER BY task_id,sequence DESC',
    [[`${run}-task-0`, `${run}-task-1`]],
  );
  const a = records.rows.find((row) => row.task_id === `${run}-task-0`);
  const b = records.rows.find((row) => row.task_id === `${run}-task-1`);
  assert.ok(a);
  assert.ok(b);
  const command = (recordId: string) => {
    const id = randomUUID();
    return {
      operation: 'replay_record' as const,
      operationId: id,
      idempotencyKeyHash: hashCanonicalEvidenceJson({ id }),
      requestHash: hashCanonicalEvidenceJson({ id, recordId }),
      exportId: configuration.exportId,
      configurationRevision: configuration.revision,
      actorId: 'isolated-fixture',
      reason: 'Device scope regression',
      requestedAt: new Date().toISOString(),
      recordId,
    };
  };
  const foreign = command(b.record_id);
  const before = (await pool.query('SELECT * FROM evidence_outbox WHERE sequence=$1', [b.sequence]))
    .rows;
  await assert.rejects(own.startRecoveryRun(foreign), {
    code: 'EVIDENCE_RECOVERY_DEVICE_SCOPE_DENIED',
  });
  assert.equal(
    (
      await pool.query('SELECT 1 FROM evidence_recovery_run WHERE operation_id=$1', [
        foreign.operationId,
      ])
    ).rowCount,
    0,
  );
  const requested = await all.startRecoveryRun(foreign);
  await assert.rejects(own.resumeRecoveryRun(requested.recoveryRunId), {
    code: 'EVIDENCE_RECOVERY_SCOPE_UNPROVEN',
  });
  assert.equal(await own.getRecoveryRun(requested.recoveryRunId), undefined);
  assert.equal(
    (await own.listRecoverableRuns(100)).some(
      (row) => row.recoveryRunId === requested.recoveryRunId,
    ),
    false,
  );
  assert.equal(
    await own.claimCoverageRecoveryTarget(requested.recoveryRunId, new Date().toISOString()),
    undefined,
  );
  await assert.rejects(
    own.failRecoveryRun(requested.recoveryRunId, 'TEST_FOREIGN', new Date().toISOString()),
    { code: 'EVIDENCE_RECOVERY_SCOPE_UNPROVEN' },
  );
  await assert.rejects(
    own.completeCoverageRecoveryTarget(
      {
        recoveryRunId: requested.recoveryRunId,
        episodeId: `${run}-task-1`,
        taskId: `${run}-task-1`,
        terminalOutcomeId: 'not-used',
        sealRequested: false,
        claimToken: 'not-used',
      },
      new Date().toISOString(),
    ),
    { code: 'EVIDENCE_RECOVERY_SCOPE_UNPROVEN' },
  );
  const reordered = new PostgresEvidenceOperationsRepository(pool, {
    ...scope,
    allowedDeviceIds: [...scope.allowedDeviceIds].reverse(),
  });
  assert.equal((await reordered.getRecoveryRun(requested.recoveryRunId))?.status, 'requested');
  assert.equal((await all.getRecoveryRun(requested.recoveryRunId))?.status, 'requested');
  assert.deepEqual(
    (await pool.query('SELECT * FROM evidence_outbox WHERE sequence=$1', [b.sequence])).rows,
    before,
  );
  const accepted = await own.startRecoveryRun(command(a.record_id));
  assert.equal(accepted.status, 'requested');
  assert.ok(
    (await own.listRecoverableRuns(100)).some(
      (row) => row.recoveryRunId === accepted.recoveryRunId,
    ),
  );
  const legacyRepository = new PostgresEvidenceOperationsRepository(pool);
  const legacy = await legacyRepository.startRecoveryRun(command(a.record_id));
  await assert.rejects(own.resumeRecoveryRun(legacy.recoveryRunId), {
    code: 'EVIDENCE_RECOVERY_SCOPE_UNPROVEN',
  });
  assert.equal((await legacyRepository.getRecoveryRun(legacy.recoveryRunId))?.status, 'requested');
  // Finish only this invocation's fixture requests through their owning repositories.
  await all.failRecoveryRun(requested.recoveryRunId, 'FIXTURE_FINISHED', new Date().toISOString());
  await own.failRecoveryRun(accepted.recoveryRunId, 'FIXTURE_FINISHED', new Date().toISOString());
  await legacyRepository.failRecoveryRun(
    legacy.recoveryRunId,
    'FIXTURE_FINISHED',
    new Date().toISOString(),
  );
}
