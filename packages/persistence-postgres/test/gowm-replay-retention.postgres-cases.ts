import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { createReplayDatasetManifest, hashCanonicalEvidenceJson } from '../../domain/src/index.js';
import { PostgresArtifactReplayValidationRepository } from '../src/index.js';

/** Storage retention fixtures only; does not claim candidate execution or validation. */
export async function verifyGowmReplayRetention(
  pool: Pool,
  scope: DeviceWorkScope,
  taskIds: readonly string[],
): Promise<string[]> {
  assert.equal(taskIds.length, 2);
  const at = new Date().toISOString();
  const run = randomUUID();
  const datasetIds: string[] = [];
  const caseIds: string[] = [];
  for (const [index, taskId] of taskIds.entries()) {
    const source = await pool.query<{ episode_id: string }>(
      'SELECT episode_id FROM goal_experience_episode WHERE task_id=$1 ORDER BY created_at LIMIT 1',
      [taskId],
    );
    const episode = source.rows[0];
    assert.ok(episode, 'Requires an actual saved normal Task experience episode');
    const caseId = `${run}-case-${String(index)}`;
    const hash = hashCanonicalEvidenceJson(caseId);
    await pool.query(
      `INSERT INTO artifact_replay_case(replay_case_id,tenant_id,task_type_id,primary_source_episode_id,content,fixture,content_hash,snapshot_completeness,retention_until,created_at)
      VALUES($1,$2,'retention-fixture',$3,'{}'::jsonb,'{}'::jsonb,$4,1,$5,$5)`,
      [caseId, run, episode.episode_id, hash, at],
    );
    const manifest = createReplayDatasetManifest({
      datasetId: `${run}-dataset-${String(index)}`,
      datasetVersion: 1,
      purpose: 'promotion_holdout',
      tenantId: run,
      taskTypeIds: ['retention-fixture'],
      caseRefs: [caseId],
      splitPolicyVersion: 'retention-fixture',
      sourceRange: { from: at, to: at },
      sourceHash: hash,
      contentHash: hashCanonicalEvidenceJson({ caseId, version: 1 }),
      leakageCheckRef: `${run}-leakage`,
      createdAt: at,
    });
    await pool.query(
      `INSERT INTO replay_dataset_manifest(dataset_id,dataset_version,purpose,tenant_id,content,source_hash,content_hash,leakage_check_ref,promotion_eligible,created_at)
      VALUES($1,1,$2,$3,$4::jsonb,$5,$6,$7,true,$8)`,
      [
        manifest.datasetId,
        manifest.purpose,
        run,
        JSON.stringify(manifest),
        manifest.sourceHash,
        manifest.contentHash,
        manifest.leakageCheckRef,
        at,
      ],
    );
    await pool.query(
      'INSERT INTO replay_dataset_case(dataset_id,dataset_version,replay_case_id,ordinal) VALUES($1,1,$2,0)',
      [manifest.datasetId, caseId],
    );
    datasetIds.push(manifest.datasetId);
    caseIds.push(caseId);
  }
  const a = scope.allowedDeviceIds[0];
  assert.ok(a);
  const repository = new PostgresArtifactReplayValidationRepository(pool, {
    ...scope,
    allowedDeviceIds: [a],
  });
  assert.equal(
    await repository.purgeExpired(at, 1),
    0,
    'Shared expiry must not report physical deletions',
  );
  const state = await pool.query<{
    dataset_id: string;
    promotion_eligible: boolean;
    invalidation_reason: string | null;
  }>(
    'SELECT dataset_id,promotion_eligible,invalidation_reason FROM replay_dataset_manifest WHERE dataset_id=ANY($1::text[]) AND dataset_version=1 ORDER BY dataset_id',
    [datasetIds],
  );
  assert.equal(state.rows[0]?.promotion_eligible, false);
  assert.equal(state.rows[0].invalidation_reason, 'retention_expired');
  assert.equal(state.rows[1]?.promotion_eligible, true);
  assert.equal(
    (
      await pool.query('SELECT 1 FROM artifact_replay_case WHERE replay_case_id=ANY($1::text[])', [
        caseIds,
      ])
    ).rowCount,
    2,
  );
  const before = (
    await pool.query('SELECT 1 FROM replay_dataset_manifest WHERE dataset_id=ANY($1::text[])', [
      datasetIds,
    ])
  ).rowCount;
  assert.equal(await repository.purgeExpired(at, 1), 0);
  assert.equal(
    (
      await pool.query('SELECT 1 FROM replay_dataset_manifest WHERE dataset_id=ANY($1::text[])', [
        datasetIds,
      ])
    ).rowCount,
    before,
    'Repeated retention must not create another successor',
  );
  return [
    'Replay expiry preserves native source cases, invalidates the owned dataset, leaves the other device eligible, and avoids repeat successors',
  ];
}
