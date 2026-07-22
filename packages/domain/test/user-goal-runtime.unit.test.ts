import { describe, expect, it } from 'vitest';

import {
  createSkillAttempt,
  createUserGoalCompletionContract,
  createUserGoalPlan,
  transitionSkillAttempt,
  validateUserGoalPlan,
} from '../src/index.js';

function contract() {
  return createUserGoalCompletionContract({
    schemaVersion: '1.0',
    goalId: 'goal.v122',
    goalVersion: 1,
    title: 'Deliver a verified result',
    description: 'Produce and verify the requested result.',
    constraints: [],
    criteria: [
      {
        criterionId: 'criterion.result',
        description: 'The requested result exists.',
        required: true,
        expectedEffectRefs: ['effect.result'],
        evidenceRequirements: ['evidence.result'],
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
}

function validPlan() {
  return createUserGoalPlan({
    schemaVersion: '1.0',
    planId: 'plan.v122.1',
    goalId: 'goal.v122',
    goalVersion: 1,
    revision: 1,
    revisionKind: 'initial',
    status: 'validated',
    contractHash: `sha256:${'a'.repeat(64)}`,
    contentHash: `sha256:${'b'.repeat(64)}`,
    skillGoals: [
      {
        skillGoalId: 'skill-goal.result',
        requiredResult: 'A verified requested result.',
        capabilityNeeds: ['result.production'],
        coveredCriterionIds: ['criterion.result'],
        requiredEffectRefs: ['effect.result'],
        evidenceRequirements: ['evidence.result'],
        artifactRequirements: [],
        assumptions: [],
        constraints: [],
        status: 'pending',
      },
    ],
    dependencies: [],
    inheritedCompletedEffectIds: [],
    forbiddenReplayFingerprints: [],
    createdAt: '2026-07-22T00:00:00.000Z',
  });
}

describe('SDAR v1.2.2 User Goal domain', () => {
  it('accepts a bounded DAG with exactly 100% required criterion coverage', () => {
    expect(validateUserGoalPlan(contract(), validPlan())).toEqual(validPlan());
  });

  it('rejects missing required criterion coverage', () => {
    const plan = validPlan();
    const first = firstSkillGoal(plan);
    expect(() =>
      validateUserGoalPlan(contract(), {
        ...plan,
        skillGoals: [{ ...first, coveredCriterionIds: [] }],
      }),
    ).toThrow(expect.objectContaining({ code: 'USER_GOAL_PLAN_CRITERION_COVERAGE_INCOMPLETE' }));
  });

  it('rejects dependency cycles and execution authority identifiers in Skill Goals', () => {
    const plan = validPlan();
    const first = firstSkillGoal(plan);
    const second = {
      ...first,
      skillGoalId: 'skill-goal.second',
      coveredCriterionIds: [],
    };
    expect(() =>
      validateUserGoalPlan(contract(), {
        ...plan,
        skillGoals: [...plan.skillGoals, second],
        dependencies: [
          {
            dependencyId: 'dep.1',
            predecessorSkillGoalId: 'skill-goal.result',
            successorSkillGoalId: 'skill-goal.second',
            predicate: 'required',
          },
          {
            dependencyId: 'dep.2',
            predecessorSkillGoalId: 'skill-goal.second',
            successorSkillGoalId: 'skill-goal.result',
            predicate: 'required',
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'USER_GOAL_PLAN_CYCLE' }));
    expect(() =>
      validateUserGoalPlan(contract(), {
        ...plan,
        skillGoals: [{ ...first, skillId: 'forbidden.skill' }],
      }),
    ).toThrow(expect.objectContaining({ code: 'SKILL_GOAL_EXECUTION_AUTHORITY_FORBIDDEN' }));
  });

  it('allows only explicit Skill Attempt state transitions', () => {
    const attempt = createSkillAttempt({
      attemptId: 'attempt.1',
      planId: 'plan.v122.1',
      skillGoalId: 'skill-goal.result',
      ordinal: 1,
      status: 'dispatch_intent',
      strategyFingerprint: `sha256:${'c'.repeat(64)}`,
      budget: { maxAttempts: 2, consumedAttempts: 0 },
      createdAt: '2026-07-22T00:00:00.000Z',
    });
    expect(transitionSkillAttempt(attempt, 'selecting', '2026-07-22T00:00:01.000Z')).toMatchObject({
      status: 'selecting',
    });
    expect(() => transitionSkillAttempt(attempt, 'achieved', '2026-07-22T00:00:01.000Z')).toThrow(
      expect.objectContaining({ code: 'SKILL_ATTEMPT_TRANSITION_INVALID' }),
    );
  });
});

function firstSkillGoal(plan: ReturnType<typeof validPlan>) {
  const first = plan.skillGoals[0];
  if (first === undefined) throw new Error('TEST_PLAN_SKILL_GOAL_MISSING');
  return first;
}
