import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import {
  createPlanningCorrectionFact,
  createPlanningInteractionEpisode,
} from '../../domain/src/index.js';
import { PostgresPlanningCorrectionRepository } from '../src/cognitive/planning-correction-repository.js';

export async function verifyGowmPlanningCorrectionCases(
  pool: Pool,
  scope: DeviceWorkScope,
  run: string,
): Promise<string[]> {
  const [deviceA, deviceB] = scope.allowedDeviceIds;
  assert.ok(deviceA && deviceB);
  const all = new PostgresPlanningCorrectionRepository(pool, scope);
  const onlyA = new PostgresPlanningCorrectionRepository(pool, {
    ...scope,
    allowedDeviceIds: [deviceA],
  });
  const none = new PostgresPlanningCorrectionRepository(pool, { ...scope, allowedDeviceIds: [] });
  const timestamp = new Date().toISOString();
  const sourceRefs = [
    {
      schemaVersion: '1.0' as const,
      sourceRefId: `${run}-correction-source`,
      sourceKind: 'planning_correction' as const,
      sourceId: run,
      sourceRevision: 1,
      authority: 'user_instruction' as const,
      dataClassification: 'user_scoped' as const,
      capturedAt: timestamp,
    },
  ];
  const tasks = [`${run}-task-0`, `${run}-task-1`];
  for (const [index, taskId] of tasks.entries()) {
    for (const correctionScope of ['user', 'tenant'] as const) {
      const fact = createPlanningCorrectionFact({
        schemaVersion: '1.0',
        correctionId: `${taskId}-${correctionScope}`,
        taskId,
        sessionId: `${taskId}-planning-session`,
        turnId: `${taskId}-turn`,
        idempotencyKey: correctionScope,
        actorId: run,
        target: 'skill_goal_plan',
        correctionType: 'wrong_dependency',
        scope: correctionScope,
        userId: run,
        tenantId: run,
        beforeSnapshot: { plan: 1 },
        userInstruction: 'Inspect before report',
        structuredPatch: { dependencies: ['inspect->report'] },
        afterSnapshot: { plan: 2 },
        validation: { valid: true },
        accepted: true,
        counterexampleRefs: [],
        correctionHash: `sha256:${'a'.repeat(64)}`,
        sourceRefs,
        createdAt: timestamp,
      });
      assert.equal((await all.saveIfAbsent(fact)).inserted, true);
      assert.equal((await all.saveIfAbsent(fact)).inserted, false);
      if (index === 1) {
        assert.equal(await onlyA.findByIdempotencyKey(taskId, correctionScope), undefined);
        await assert.rejects(onlyA.saveIfAbsent(fact), { code: 'DEVICE_SCOPE_DENIED' });
      }
    }
    const episode = createPlanningInteractionEpisode({
      schemaVersion: '1.0',
      episodeId: `${taskId}-episode`,
      taskId,
      revision: 1,
      originalRequest: 'Inspect and report',
      turns: [],
      correctionIds: [],
      counterexampleRefs: [],
      completeness: 1,
      inductionFingerprint: `sha256:${'b'.repeat(64)}`,
      episodeHash: `sha256:${'c'.repeat(64)}`,
      sourceRefs,
      createdAt: timestamp,
    });
    assert.equal(await all.saveEpisode(episode), true);
    assert.equal(await all.saveEpisode(episode), false);
    if (index === 1) {
      assert.deepEqual(await onlyA.listByTask(taskId), []);
      assert.deepEqual(await onlyA.listEpisodes(taskId), []);
      await assert.rejects(onlyA.saveEpisode(episode), { code: 'DEVICE_SCOPE_DENIED' });
    }
    const successor = {
      ...episode,
      episodeId: `${taskId}-episode-2`,
      episodeHash: `sha256:${'d'.repeat(64)}`,
    };
    assert.equal(await all.saveEpisode(successor), true);
    assert.deepEqual(
      (await all.listEpisodes(taskId)).map((item) => item.revision),
      [1, 2],
    );
  }
  assert.equal((await onlyA.listUserScoped(run)).length, 1);
  assert.equal((await onlyA.listTenantScoped(run)).length, 1);
  assert.deepEqual(await none.listUserScoped(run), []);
  assert.deepEqual(await none.listTenantScoped(run), []);
  const rows = await pool.query<{ task_id: string; device_id: string; count: string }>(
    'SELECT task_id,device_id,count(*)::text FROM planning_interaction_episode WHERE task_id=ANY($1::text[]) GROUP BY task_id,device_id ORDER BY task_id',
    [tasks],
  );
  assert.deepEqual(
    rows.rows.map((row) => [row.device_id, row.count]),
    [
      [deviceA, '2'],
      [deviceB, '2'],
    ],
  );
  const outbox = await pool.query<{ count: string }>(
    "SELECT count(*)::text FROM cognitive_runtime_outbox WHERE correlation->>'taskId'=ANY($1::text[]) AND event_type='planning.correction_recorded'",
    [tasks],
  );
  assert.equal(outbox.rows[0]?.count, '4');
  return [
    'Planning correction/episode native device lineage, task/user/tenant scope, duplicate denial, append-only revisions and one outbox event per accepted correction',
  ];
}
