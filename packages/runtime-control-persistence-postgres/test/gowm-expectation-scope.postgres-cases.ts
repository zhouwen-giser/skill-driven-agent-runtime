import { PostgresEvidenceOperationsRepository } from '../src/evidence-operations-repository.js';
import { EpisodeEvidenceCoverageService } from '../../runtime-control-application/src/evidence-coverage-service.js';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { EPISODE_EVIDENCE_POLICY } from '../../domain/src/index.js';
import { PostgresEvidenceStore } from '../src/evidence-store.js';

export async function verifyGowmExpectationScope(
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
  const store = new PostgresEvidenceStore(pool, {
    allowedDeviceIds: [owner.device_id],
    sdarServiceKey: owner.sdar_service_key,
    includeNonDevice: false,
  });
  const input = {
    episodeId: a,
    taskId: a,
    policyRecords: EPISODE_EVIDENCE_POLICY.records,
    recomputedAt: new Date().toISOString(),
  };
  const first = await store.refreshEpisodeExpectations(input);
  assert.ok(first.expectedRecords.length > 0);
  const second = await store.refreshEpisodeExpectations(input);
  assert.deepEqual(second.expectedRecords, first.expectedRecords);
  const before = (
    await pool.query(
      'SELECT * FROM evidence_expected_record WHERE episode_id=$1 ORDER BY expectation_id',
      [b],
    )
  ).rows;
  await assert.rejects(
    store.refreshEpisodeExpectations({ ...input, episodeId: b, taskId: b }),
    /EVIDENCE_TASK_DEVICE_SCOPE_DENIED/u,
  );
  await assert.rejects(
    store.refreshEpisodeExpectations({ ...input, episodeId: b }),
    /EVIDENCE_EPISODE_TASK_IDENTITY_CONFLICT/u,
  );
  const after = (
    await pool.query(
      'SELECT * FROM evidence_expected_record WHERE episode_id=$1 ORDER BY expectation_id',
      [b],
    )
  ).rows;
  assert.deepEqual(after, before);
  const terminal = (
    await pool.query<{ outcome_id: string }>(
      'SELECT outcome_id FROM runtime_terminal_outcome WHERE task_id=$1',
      [a],
    )
  ).rows[0];
  assert.ok(terminal);
  const service = new EpisodeEvidenceCoverageService({
    repository: store,
    clock: { now: () => input.recomputedAt },
  });
  const manifest = await service.reconcile({
    episodeId: a,
    taskId: a,
    terminalOutcomeId: terminal.outcome_id,
    sealRequested: false,
  });
  await store.saveManifest(manifest);
  assert.equal(
    (
      await pool.query<{ device_id: string }>(
        'SELECT device_id FROM episode_evidence_manifest WHERE episode_id=$1',
        [a],
      )
    ).rows[0]?.device_id,
    owner.device_id,
  );
  const wrong = await pool.query(
    'SELECT 1 FROM evidence_expected_record WHERE episode_id=$1 AND device_id IS DISTINCT FROM $2',
    [a, owner.device_id],
  );
  assert.equal(wrong.rowCount, 0);
  await assert.rejects(
    store.saveManifest({ ...manifest, taskId: b }),
    /EVIDENCE_TASK_DEVICE_SCOPE_DENIED/u,
  );
}

export async function verifyGowmEvidenceReadScope(
  pool: Pool,
  taskIds: readonly string[],
): Promise<void> {
  const [a, b] = taskIds;
  assert.ok(a);
  assert.ok(b);
  const owners = await pool.query<{ task_id: string; device_id: string; sdar_service_key: string }>(
    'SELECT task_id,device_id,sdar_service_key FROM agent_task WHERE task_id=ANY($1::text[])',
    [taskIds],
  );
  for (const taskId of [a, b]) {
    const owner = owners.rows.find((row) => row.task_id === taskId);
    assert.ok(owner);
    const scope = {
      allowedDeviceIds: [owner.device_id],
      sdarServiceKey: owner.sdar_service_key,
      includeNonDevice: false,
    };
    const store = new PostgresEvidenceStore(pool, scope);
    const operations = new PostgresEvidenceOperationsRepository(pool, scope);
    const expected = await store.listExpectedRecords(a);
    const manifest = await store.loadManifest(a);
    const metadata = await operations.getManifest(a);
    const outbox = await operations.listOutbox({ limit: 10, episodeId: a });
    if (taskId === a) {
      assert.ok(expected.length > 0);
      assert.ok(manifest);
      assert.ok(metadata);
      assert.ok(outbox.items.length > 0);
    } else {
      assert.deepEqual(expected, []);
      assert.equal(manifest, undefined);
      assert.equal(metadata, undefined);
      assert.deepEqual(outbox.items, []);
    }
  }
}
