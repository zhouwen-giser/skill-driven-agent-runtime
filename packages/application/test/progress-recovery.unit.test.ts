import { describe, expect, it, vi } from 'vitest';

import type { ProgressVector } from '../../domain/src/index.js';
import { classifyProgress, RecoveryCoordinator } from '../src/index.js';

const timestamp = '2026-07-22T12:00:00.000Z';

describe('ProgressDetector and RecoveryCoordinator', () => {
  it('classifies complete, progressing, stalled and regressing without percentage authority', () => {
    const previous = vector({ satisfiedCriterionRefs: ['criterion.1'], uncertainty: 0.5 });
    expect(
      classifyProgress(
        vector({ satisfiedCriterionRefs: ['criterion.1', 'criterion.2'] }),
        previous,
      ),
    ).toBe('complete');
    expect(
      classifyProgress(
        vector({
          satisfiedCriterionRefs: ['criterion.1'],
          effectRefs: ['effect.1'],
          uncertainty: 0.5,
        }),
        previous,
      ),
    ).toBe('progressing');
    expect(classifyProgress(previous, previous)).toBe('stalled');
    expect(
      classifyProgress(vector({ satisfiedCriterionRefs: [], uncertainty: 0.8 }), previous),
    ).toBe('regressing');
  });

  it('applies User→Skill→Task→remote→budget recovery authority order', async () => {
    const saveProgressAndDecision = vi.fn(() => Promise.resolve());
    let sequence = 0;
    const coordinator = new RecoveryCoordinator({
      repository: { saveProgressAndDecision },
      ids: {
        nextProgressObservationId: () => `progress.${String(++sequence)}`,
        nextRecoveryDecisionId: () => `recovery.${String(++sequence)}`,
      },
      now: () => timestamp,
    });
    const base = {
      userGoalAchieved: false,
      skillGoalAchieved: false,
      taskGoalAchieved: false,
      uncertainRemoteTask: false,
      inputRequired: false,
      proposedStrategyFingerprint: hash('2'),
      forbiddenReplayFingerprints: [] as readonly string[],
    };
    const decide = (overrides: Partial<typeof base>) =>
      coordinator.coordinate(
        { planId: 'plan.1', skillGoalId: 'skill-goal.1', attemptId: 'attempt.1' },
        vector(),
        { ...base, ...overrides },
        vector(),
      );

    await expect(
      decide({ userGoalAchieved: true, uncertainRemoteTask: true }),
    ).resolves.toMatchObject({
      decision: { action: 'no_action', reasonCode: 'USER_GOAL_ALREADY_ACHIEVED' },
    });
    await expect(decide({ skillGoalAchieved: true })).resolves.toMatchObject({
      decision: { action: 'no_action', reasonCode: 'SKILL_GOAL_ALREADY_ACHIEVED' },
    });
    await expect(decide({ taskGoalAchieved: true })).resolves.toMatchObject({
      decision: { action: 'no_action', reasonCode: 'TASK_GOAL_ALREADY_ACHIEVED_NO_REPLAY' },
    });
    await expect(decide({ uncertainRemoteTask: true })).resolves.toMatchObject({
      decision: { action: 'reconcile_remote_task' },
    });
  });

  it('forbids same-strategy recovery, honors no-replay, and stops at persisted budget exhaustion', async () => {
    const coordinator = new RecoveryCoordinator({
      repository: { saveProgressAndDecision: () => Promise.resolve() },
      ids: {
        nextProgressObservationId: () => 'progress.1',
        nextRecoveryDecisionId: () => 'recovery.1',
      },
      now: () => timestamp,
    });
    const strategy = hash('1');
    const coordinate = (
      current: ProgressVector,
      input: Partial<Parameters<RecoveryCoordinator['coordinate']>[2]> = {},
    ) =>
      coordinator.coordinate(
        { planId: 'plan.1', skillGoalId: 'skill-goal.1', attemptId: 'attempt.1' },
        current,
        {
          userGoalAchieved: false,
          skillGoalAchieved: false,
          taskGoalAchieved: false,
          uncertainRemoteTask: false,
          inputRequired: false,
          proposedStrategyFingerprint: strategy,
          forbiddenReplayFingerprints: [],
          ...input,
        },
        current,
      );
    await expect(coordinate(vector({ strategyFingerprint: strategy }))).resolves.toMatchObject({
      decision: { action: 'revise_plan', reasonCode: 'STALLED_SAME_STRATEGY_FORBIDDEN' },
    });
    await expect(
      coordinate(vector(), {
        replayFingerprint: hash('9'),
        forbiddenReplayFingerprints: [hash('9')],
      }),
    ).resolves.toMatchObject({
      decision: { action: 'revise_plan', reasonCode: 'FORBIDDEN_EFFECT_REPLAY' },
    });
    await expect(
      coordinate(vector({ remainingBudget: { task: 1, workflow: 1, attempt: 0, plan: 1 } })),
    ).resolves.toMatchObject({
      decision: { action: 'fail_goal', reasonCode: 'RECOVERY_BUDGET_EXHAUSTED' },
    });
  });
});

function vector(overrides: Partial<ProgressVector> = {}): ProgressVector {
  return {
    requiredCriterionCount: 2,
    satisfiedCriterionRefs: [],
    effectRefs: [],
    evidenceRefs: [],
    artifactRefs: [],
    invalidatedEffectRefs: [],
    uncertainty: 1,
    attemptOrdinal: 1,
    planRevision: 1,
    strategyFingerprint: hash('1'),
    remainingBudget: { task: 2, workflow: 2, attempt: 1, plan: 3 },
    ...overrides,
  };
}

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
