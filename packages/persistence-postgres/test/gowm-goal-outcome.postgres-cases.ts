import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import {
  createUserGoalCompletionContract,
  createUserGoalPlan,
  createCompletedEffect,
  createOutcomeDecision,
  createProgressObservation,
  createRecoveryDecision,
  hashCanonicalEvidenceJson,
} from '../../domain/src/index.js';
import { PostgresUserGoalRuntimeRepository } from '../src/user-goal-runtime-repository.js';
import { PostgresRuntimeCoreEvidenceSource } from '../../runtime-control-persistence-postgres/src/runtime-core-evidence-source.js';

export async function verifyGowmGoalOutcomes(
  pool: Pool,
  scope: DeviceWorkScope,
  run: string,
): Promise<string[]> {
  const suffix = randomUUID();
  const at = new Date().toISOString();
  const repository = new PostgresUserGoalRuntimeRepository(pool, scope);
  const goalId = `${run}-goal`;
  const contract = createUserGoalCompletionContract({
    schemaVersion: '1.0',
    goalId,
    goalVersion: 1,
    title: 'Shared Goal',
    description: 'Outcome attribution fixture',
    constraints: [],
    criteria: [
      {
        criterionId: 'result',
        description: 'Read result',
        required: true,
        expectedEffectRefs: ['read'],
        evidenceRequirements: [],
        artifactRequirements: [],
      },
    ],
    assumptions: [],
    policy: {
      maxSkillGoals: 16,
      maxDagDepth: 8,
      maxParallelReadyGoals: 4,
      maxPlanRevisions: 4,
      maxPlanningModelAttempts: 2,
    },
  });
  const contractHash = hashCanonicalEvidenceJson(contract);
  await repository.saveContract(contract, contractHash, at);
  const plan = createUserGoalPlan({
    schemaVersion: '1.0',
    planId: `${suffix}-plan`,
    goalId,
    goalVersion: 1,
    revision: 1,
    revisionKind: 'initial',
    status: 'validated',
    contractHash,
    contentHash: hashCanonicalEvidenceJson(suffix),
    skillGoals: [
      {
        skillGoalId: `${suffix}-step`,
        requiredResult: 'Read result',
        capabilityNeeds: ['read'],
        coveredCriterionIds: ['result'],
        requiredEffectRefs: ['read'],
        evidenceRequirements: [],
        artifactRequirements: [],
        assumptions: [],
        constraints: [],
        status: 'pending',
      },
    ],
    dependencies: [],
    inheritedCompletedEffectIds: [],
    forbiddenReplayFingerprints: [],
    createdAt: at,
  });
  await repository.createPlan(plan);
  for (const [index, device] of scope.allowedDeviceIds.entries()) {
    const taskId = `${run}-task-${String(index)}`;
    await repository.saveOutcomeDecisions(plan.planId, [
      createOutcomeDecision({
        outcomeDecisionId: `${suffix}-decision-${String(index)}`,
        executionTaskId: taskId,
        level: 'skill_goal',
        subjectId: `${suffix}-step`,
        status: 'achieved',
        confidence: 'high',
        ruleIds: [],
        criterionRefs: ['result'],
        effectRefs: ['read'],
        evidenceRefs: [],
        artifactRefs: [],
        summary: 'Fixture read complete',
        createdAt: at,
      }),
    ]);
    await repository.saveCompletedEffect(
      createCompletedEffect({
        completedEffectId: `${suffix}-effect-${String(index)}`,
        executionTaskId: taskId,
        goalId,
        planId: plan.planId,
        skillGoalId: `${suffix}-step`,
        status: 'verified',
        effectFingerprint: hashCanonicalEvidenceJson({
          goalId,
          device,
          effect: 'read',
          fixture: suffix,
        }),
        evidenceRefs: [],
        createdAt: at,
      }),
    );
    const vector = {
      executionTaskId: taskId,
      requiredCriterionCount: 1,
      satisfiedCriterionRefs: [],
      effectRefs: [],
      evidenceRefs: [],
      artifactRefs: [],
      invalidatedEffectRefs: [],
      uncertainty: 1,
      attemptOrdinal: 1,
      planRevision: 1,
      strategyFingerprint: hashCanonicalEvidenceJson({ suffix, index }),
      remainingBudget: { task: 3, workflow: 3, attempt: 3, plan: 3 },
    };
    const observation = createProgressObservation({
      progressObservationId: `${suffix}-progress-${String(index)}`,
      planId: plan.planId,
      classification: 'stalled',
      vector,
      observedAt: at,
    });
    const recovery = createRecoveryDecision({
      recoveryDecisionId: `${suffix}-recovery-${String(index)}`,
      executionTaskId: taskId,
      planId: plan.planId,
      action: 'no_action',
      reasonCode: 'fixture',
      strategyFingerprint: vector.strategyFingerprint,
      createdAt: at,
    });
    await repository.saveProgressAndDecision(observation, recovery);
    const deviceA = scope.allowedDeviceIds[0];
    assert.ok(deviceA);
    if (index === 1)
      await assert.rejects(
        new PostgresUserGoalRuntimeRepository(pool, {
          ...scope,
          allowedDeviceIds: [deviceA],
        }).saveProgressAndDecision(observation, recovery),
        /RECOVERY_TASK_DEVICE_SCOPE_DENIED/u,
      );
    assert.deepEqual(
      (await repository.listSkillGoalOutcomeDecisions(plan.planId, taskId)).map(
        (item) => item.executionTaskId,
      ),
      [taskId],
    );
    assert.deepEqual(
      (await repository.listValidCompletedEffects(goalId, taskId))
        .filter((item) => item.planId === plan.planId)
        .map((item) => item.executionTaskId),
      [taskId],
    );
  }
  const source = new PostgresRuntimeCoreEvidenceSource(pool, scope);
  for (const index of [0, 1]) {
    const taskId = `${run}-task-${String(index)}`;
    assert.equal(
      (await repository.findLatestProgress(plan.planId, taskId))?.vector.executionTaskId,
      taskId,
    );
    const snapshot = await source.load(taskId);
    assert.ok(snapshot);
    assert.deepEqual(
      snapshot.verifications
        .filter((effect) => effect['plan_id'] === plan.planId)
        .map(
          (effect) =>
            effect['effect_json'] &&
            (effect['effect_json'] as { executionTaskId: string }).executionTaskId,
        ),
      [taskId],
    );
    assert.deepEqual(
      snapshot.outcomes
        .filter((decision) => decision['plan_id'] === plan.planId)
        .map(
          (decision) => (decision['decision_json'] as { executionTaskId: string }).executionTaskId,
        ),
      [taskId],
    );
  }
  const ownProgress = await repository.findLatestProgress(plan.planId, `${run}-task-0`);
  assert.ok(ownProgress);
  const legacyVector = { ...ownProgress.vector };
  delete legacyVector.executionTaskId;
  const legacyObservation = createProgressObservation({
    ...ownProgress,
    progressObservationId: `${suffix}-legacy-progress`,
    vector: legacyVector,
    observedAt: new Date(Date.parse(at) + 1_000).toISOString(),
  });
  const legacyDecision = createRecoveryDecision({
    recoveryDecisionId: `${suffix}-legacy-recovery`,
    planId: plan.planId,
    action: 'no_action',
    reasonCode: 'legacy_fixture',
    strategyFingerprint: legacyVector.strategyFingerprint,
    createdAt: legacyObservation.observedAt,
  });
  await assert.rejects(
    repository.saveProgressAndDecision(legacyObservation, legacyDecision),
    /RECOVERY_EXECUTION_TASK_REQUIRED/u,
  );
  // Simulate a pre-integration record through the legacy repository contract.
  await new PostgresUserGoalRuntimeRepository(pool).saveProgressAndDecision(
    legacyObservation,
    legacyDecision,
  );
  for (const index of [0, 1])
    await assert.rejects(
      repository.findLatestProgress(plan.planId, `${run}-task-${String(index)}`),
      { code: 'RECOVERY_PROGRESS_SOURCE_UNPROVEN' },
    );
  return [
    'Same-Goal outcomes/effects preserve source Task and read only the current device, including canonical Evidence projection',
  ];
}
