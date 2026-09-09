import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import {
  createOutcomeDecision,
  createCompletedEffect,
  hashCanonicalEvidenceJson,
} from '../../domain/src/index.js';
import { PostgresUserGoalRuntimeRepository } from '../src/user-goal-runtime-repository.js';
import { PostgresRuntimeTerminalOutcomeRepository } from '../src/repositories.js';

export async function verifyGowmOutcomeWriteScope(
  pool: Pool,
  scope: DeviceWorkScope,
  run: string,
): Promise<void> {
  const id = randomUUID();
  const goalId = `${run}-goal`;
  const row = (
    await pool.query<{ plan_id: string }>(
      'SELECT plan_id FROM user_goal_plan WHERE goal_id=$1 AND revision=1',
      [goalId],
    )
  ).rows[0];
  assert.ok(row);
  const device = scope.allowedDeviceIds[0];
  assert.ok(device);
  const ownScope = { ...scope, allowedDeviceIds: [device] };
  const own = new PostgresUserGoalRuntimeRepository(pool, ownScope);
  const all = new PostgresUserGoalRuntimeRepository(pool, scope);
  const at = new Date().toISOString();
  const decision = createOutcomeDecision({
    outcomeDecisionId: `${id}-decision`,
    executionTaskId: `${run}-task-0`,
    level: 'user_goal',
    subjectId: goalId,
    status: 'achieved',
    confidence: 'high',
    ruleIds: [],
    criterionRefs: [],
    effectRefs: [],
    evidenceRefs: [],
    artifactRefs: [],
    summary: 'Scope regression',
    createdAt: at,
  });
  const foreign = createOutcomeDecision({
    ...decision,
    outcomeDecisionId: `${id}-foreign`,
    executionTaskId: `${run}-task-1`,
  });
  await assert.rejects(
    own.saveOutcomeDecisions(row.plan_id, [decision, foreign]),
    /OUTCOME_TASK_DEVICE_SCOPE_DENIED/u,
  );
  assert.equal(
    (
      await pool.query('SELECT 1 FROM outcome_decision WHERE outcome_decision_id=$1', [
        decision.outcomeDecisionId,
      ])
    ).rowCount,
    0,
  );
  await own.saveOutcomeDecisions(row.plan_id, [decision]);
  await own.saveOutcomeDecisions(row.plan_id, [decision]);
  const effect = createCompletedEffect({
    completedEffectId: `${id}-effect`,
    executionTaskId: `${run}-task-1`,
    goalId,
    planId: row.plan_id,
    status: 'verified',
    effectFingerprint: hashCanonicalEvidenceJson(id),
    evidenceRefs: [],
    createdAt: at,
  });
  await assert.rejects(own.saveCompletedEffect(effect), /OUTCOME_TASK_DEVICE_SCOPE_DENIED/u);
  await all.saveCompletedEffect(effect);
  await assert.rejects(
    own.saveCompletedEffect(
      createCompletedEffect({
        ...effect,
        completedEffectId: `${id}-invalidate`,
        executionTaskId: `${run}-task-0`,
        status: 'invalidated',
        predecessorEffectId: effect.completedEffectId,
      }),
    ),
    /COMPLETED_EFFECT_PREDECESSOR_DEVICE_MISMATCH/u,
  );
  assert.equal(
    (
      await pool.query('SELECT 1 FROM completed_effect WHERE predecessor_effect_id=$1', [
        effect.completedEffectId,
      ])
    ).rowCount,
    0,
  );
  const terminal = new PostgresRuntimeTerminalOutcomeRepository(
    pool,
    undefined,
    undefined,
    ownScope,
  );
  // The boundary must reject before consulting or mutating a foreign task's control/Goal.
  await assert.rejects(
    terminal.commitCanceled({
      taskId: `${run}-task-1`,
      goalId,
      goalVersion: 1,
      controlId: `${id}-irrelevant`,
      outcomeId: `${id}-terminal`,
      committedAt: at,
      summary: 'scope regression',
    }),
    /TERMINAL_TASK_DEVICE_SCOPE_DENIED/u,
  );
}

export async function verifyGowmTerminalProjectionScope(
  pool: Pool,
  ownTaskId: string,
  foreignTaskId: string,
): Promise<void> {
  const task = (
    await pool.query<{ device_id: string; sdar_service_key: string }>(
      'SELECT device_id,sdar_service_key FROM agent_task WHERE task_id=$1',
      [ownTaskId],
    )
  ).rows[0];
  assert.ok(task);
  const repository = new PostgresRuntimeTerminalOutcomeRepository(pool, undefined, undefined, {
    allowedDeviceIds: [task.device_id],
    sdarServiceKey: task.sdar_service_key,
    includeNonDevice: false,
  });
  const outcomes = await pool.query<{
    task_id: string;
    outcome_id: string;
    control_id: string;
    enhancement_warnings_json: unknown;
  }>(
    'SELECT task_id,outcome_id,control_id,enhancement_warnings_json FROM runtime_terminal_outcome WHERE task_id=ANY($1::text[])',
    [[ownTaskId, foreignTaskId]],
  );
  assert.equal(outcomes.rows.length, 2);
  for (const row of outcomes.rows) {
    if (row.task_id === ownTaskId) {
      assert.ok(await repository.find(row.outcome_id));
      assert.ok(await repository.findByControl(row.control_id));
    } else {
      assert.equal(await repository.find(row.outcome_id), undefined);
      assert.equal(await repository.findByControl(row.control_id), undefined);
      await assert.rejects(
        repository.recordEnhancementWarning(row.outcome_id, {
          source: 'task_quality',
          code: 'SCOPE_FIXTURE',
          message: 'Must not persist',
          occurredAt: new Date().toISOString(),
        }),
        /RUNTIME_TERMINAL_OUTCOME_NOT_FOUND/u,
      );
      assert.deepEqual(
        (
          await pool.query<{ enhancement_warnings_json: unknown }>(
            'SELECT enhancement_warnings_json FROM runtime_terminal_outcome WHERE outcome_id=$1',
            [row.outcome_id],
          )
        ).rows[0]?.enhancement_warnings_json,
        row.enhancement_warnings_json,
      );
    }
  }
}
