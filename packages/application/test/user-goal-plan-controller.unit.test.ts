import { describe, expect, it, vi } from 'vitest';

import {
  USER_GOAL_PLAN_TERMINAL_AUTHORITY,
  USER_GOAL_RUNTIME_LIMITS,
  type RuntimeAchievedOutcomeInput,
  type RuntimeTerminalOutcomeRecord,
  type SkillAttempt,
  type SkillGoal,
  type UserGoalCompletionContract,
  type UserGoalPlan,
  type WorkflowExecutionOutcome,
} from '../../domain/src/index.js';
import type { RuntimeTerminalOutcomeRepository } from '../src/index.js';
import { UserGoalPlanController } from '../src/index.js';

const timestamp = '2026-07-22T08:00:00.000Z';

describe('UserGoalPlanController terminal authority', () => {
  it('stamps the sole authority and sends all three judgments to the atomic terminal commit', async () => {
    const terminal = terminalRepository();
    const controller = new UserGoalPlanController({
      terminal,
      outcomes: {
        findOutcomeContext: vi.fn().mockResolvedValue(outcomeContext(['criterion.result'])),
        listSkillGoalOutcomeDecisions: vi.fn().mockResolvedValue([]),
        commitWorkingOutcome: vi.fn(),
      },
    });

    await controller.adjudicateAchieved(achievedCandidate());

    expect(terminal.commitAchieved).toHaveBeenCalledOnce();
    expect(terminal.commitAchieved).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: USER_GOAL_PLAN_TERMINAL_AUTHORITY,
        layeredOutcome: expect.objectContaining({
          userGoalPlanId: 'user-goal-plan.1',
          skillAttemptId: 'attempt.1',
          skillGoalId: 'skill-goal.1',
          taskDecision: expect.objectContaining({ level: 'task_goal', status: 'achieved' }),
          skillDecision: expect.objectContaining({ level: 'skill_goal', status: 'achieved' }),
          userDecision: expect.objectContaining({ level: 'user_goal', status: 'achieved' }),
        }),
      }),
    );
  });

  it('keeps the User Goal working before terminal commit while required coverage is incomplete', async () => {
    const terminal = terminalRepository();
    const commitWorkingOutcome = vi.fn();
    const controller = new UserGoalPlanController({
      terminal,
      outcomes: {
        findOutcomeContext: vi.fn().mockResolvedValue(outcomeContext(['criterion.other'])),
        listSkillGoalOutcomeDecisions: vi.fn().mockResolvedValue([]),
        commitWorkingOutcome,
      },
    });

    await expect(controller.adjudicateAchieved(achievedCandidate())).resolves.toEqual({
      disposition: 'working',
      userGoalPlanId: 'user-goal-plan.1',
      skillGoalId: 'skill-goal.1',
      skillAttemptId: 'attempt.1',
    });
    expect(commitWorkingOutcome).toHaveBeenCalledOnce();
    expect(terminal.commitAchieved).not.toHaveBeenCalled();
  });

  it('fails closed when semantic success has no explicit required effect or evidence references', async () => {
    const terminal = terminalRepository();
    const commitWorkingOutcome = vi.fn();
    const controller = new UserGoalPlanController({
      terminal,
      outcomes: {
        findOutcomeContext: vi.fn().mockResolvedValue(outcomeContext(['criterion.result'])),
        listSkillGoalOutcomeDecisions: vi.fn().mockResolvedValue([]),
        commitWorkingOutcome,
      },
    });

    const candidate = achievedCandidate();
    await expect(
      controller.adjudicateAchieved({
        ...candidate,
        workflowOutcome: {
          ...candidate.workflowOutcome,
          effectRefs: [],
          evidenceRefs: [],
        },
      }),
    ).resolves.toMatchObject({ disposition: 'working' });

    expect(commitWorkingOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        taskDecision: expect.objectContaining({ status: 'unknown' }),
        skillDecision: expect.objectContaining({ status: 'unknown' }),
        userDecision: expect.objectContaining({ status: 'unknown' }),
      }),
      timestamp,
    );
    expect(terminal.commitAchieved).not.toHaveBeenCalled();
  });
});

function achievedCandidate(): Omit<RuntimeAchievedOutcomeInput, 'authority' | 'layeredOutcome'> &
  Readonly<{ workflowOutcome: WorkflowExecutionOutcome }> {
  return {
    outcomeId: 'outcome.1',
    taskId: 'task.1',
    goalId: 'goal.1',
    goalVersion: 1,
    controlId: 'control.1',
    round: {
      controlId: 'control.1',
      roundIndex: 0,
      planId: 'workflow-plan.1',
      instanceId: 'workflow-instance.1',
      workflowVersion: 1,
      evaluation: { decision: 'achieved', summary: 'Goal evaluator accepted the result.' },
      createdAt: timestamp,
    },
    processedResult: {
      resultId: 'result.1',
      taskId: 'task.1',
      skillId: 'skill.1',
      skillVersion: 1,
      normalized: {
        data: {},
        errors: [],
        originalSize: 2,
        contextValue: {},
        contextTruncated: false,
        summary: 'Successful result.',
      },
      output: { text: 'done', structured: {} },
      facts: [],
      valuable: false,
      valueSummary: 'No retained value.',
      memoryCandidates: [],
      createdAt: timestamp,
    },
    summary: 'Goal achieved.',
    committedAt: timestamp,
    workflowOutcome: {
      schemaVersion: '1.0',
      workflowPlanId: 'workflow-plan.1',
      workflowInstanceId: 'workflow-instance.1',
      executionStatus: 'succeeded',
      effectRefs: ['effect.result'],
      evidenceRefs: ['evidence.result'],
      artifactRefs: [],
      confidence: 'high',
      summary: 'Explicit workflow outcome.',
    },
  };
}

function outcomeContext(coveredCriterionIds: readonly string[]): Readonly<{
  plan: UserGoalPlan;
  contract: UserGoalCompletionContract;
  skillGoal: SkillGoal;
  attempt: SkillAttempt;
}> {
  const skillGoal: SkillGoal = {
    skillGoalId: 'skill-goal.1',
    requiredResult: 'Produce the result.',
    capabilityNeeds: ['result.production'],
    coveredCriterionIds,
    requiredEffectRefs: ['effect.result'],
    evidenceRequirements: ['evidence.result'],
    artifactRequirements: [],
    assumptions: [],
    constraints: [],
    status: 'judging',
  };
  return {
    contract: {
      schemaVersion: '1.0',
      goalId: 'goal.1',
      goalVersion: 1,
      title: 'Produce a result',
      description: 'Produce a verified result.',
      constraints: [],
      criteria: [
        {
          criterionId: 'criterion.result',
          description: 'The result exists.',
          required: true,
          expectedEffectRefs: ['effect.result'],
          evidenceRequirements: ['evidence.result'],
          artifactRequirements: [],
        },
      ],
      assumptions: [],
      policy: USER_GOAL_RUNTIME_LIMITS,
    },
    plan: {
      schemaVersion: '1.0',
      planId: 'user-goal-plan.1',
      goalId: 'goal.1',
      goalVersion: 1,
      revision: 1,
      revisionKind: 'initial',
      status: 'active',
      contractHash: `sha256:${'a'.repeat(64)}`,
      contentHash: `sha256:${'b'.repeat(64)}`,
      skillGoals: [skillGoal],
      dependencies: [],
      inheritedCompletedEffectIds: [],
      forbiddenReplayFingerprints: [],
      createdAt: timestamp,
    },
    skillGoal,
    attempt: {
      attemptId: 'attempt.1',
      planId: 'user-goal-plan.1',
      skillGoalId: 'skill-goal.1',
      ordinal: 1,
      status: 'judging',
      strategyFingerprint: `sha256:${'c'.repeat(64)}`,
      budget: { maxAttempts: 2, consumedAttempts: 1 },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

function terminalRepository() {
  const outcome: RuntimeTerminalOutcomeRecord = {
    outcomeId: 'outcome.1',
    kind: 'achieved',
    taskId: 'task.1',
    goalId: 'goal.1',
    goalVersion: 1,
    controlId: 'control.1',
    controlStatus: 'achieved',
    roundIndex: 0,
    finalInstanceId: 'workflow-instance.1',
    resultId: 'result.1',
    summary: 'Goal achieved.',
    authority: USER_GOAL_PLAN_TERMINAL_AUTHORITY,
    enhancementWarnings: [],
    committedAt: timestamp,
  };
  return {
    commitAchieved: vi.fn().mockResolvedValue(outcome),
    commitUnachievable: vi.fn(),
    commitCanceled: vi.fn(),
    recordEnhancementWarning: vi.fn(),
    find: vi.fn(),
    findByControl: vi.fn(),
  } satisfies RuntimeTerminalOutcomeRepository;
}
