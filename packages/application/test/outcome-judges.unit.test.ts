import { describe, expect, it } from 'vitest';

import type {
  SkillGoal,
  TaskGoalCompletionContract,
  UserGoalCompletionContract,
  WorkflowExecutionOutcome,
} from '../../domain/src/index.js';
import { SkillGoalJudge, TaskGoalJudge, UserGoalJudge } from '../src/index.js';

const now = '2026-07-22T03:00:00.000Z';
let sequence = 0;
const dependencies = {
  ids: { next: (level: string) => `decision.${level}.${String(++sequence)}` },
  now: () => now,
};

describe('SDAR v1.2.2 layered Outcome Judges', () => {
  it('does not treat Provider/Workflow terminal status as Goal achievement', () => {
    const task = new TaskGoalJudge(dependencies);
    const completedWithoutEvidence = task.judge(taskContract(), workflow('succeeded', [], 'high'));
    expect(completedWithoutEvidence).toMatchObject({ status: 'unknown' });

    const skill = new SkillGoalJudge(dependencies);
    expect(
      skill.judge(skillGoal(), [completedWithoutEvidence], workflow('succeeded', [], 'high')),
    ).toMatchObject({ status: 'unknown' });
  });

  it('allows a failed execution to satisfy a Task Goal when authoritative effects are present', () => {
    const decision = new TaskGoalJudge(dependencies).judge(
      taskContract(),
      workflow('failed', ['effect.result'], 'high'),
    );
    expect(decision).toMatchObject({ status: 'achieved', confidence: 'high' });
  });

  it('keeps the User Goal working until all required criteria are covered', () => {
    const task = new TaskGoalJudge(dependencies).judge(
      taskContract(),
      workflow('succeeded', ['effect.result'], 'high'),
    );
    const skill = new SkillGoalJudge(dependencies).judge(
      skillGoal(),
      [task],
      workflow('succeeded', ['effect.result'], 'high'),
    );
    expect(skill.status).toBe('achieved');
    expect(new UserGoalJudge(dependencies).judge(userContract(), [skill])).toMatchObject({
      status: 'unknown',
      criterionRefs: ['criterion.result'],
    });
  });

  it('completes only at 100% required criterion coverage and fails closed on low confidence', () => {
    const skill = new SkillGoalJudge(dependencies).judge(
      { ...skillGoal(), coveredCriterionIds: ['criterion.result', 'criterion.verified'] },
      [
        new TaskGoalJudge(dependencies).judge(
          taskContract(),
          workflow('succeeded', ['effect.result'], 'high'),
        ),
      ],
      workflow('succeeded', ['effect.result'], 'high'),
    );
    expect(new UserGoalJudge(dependencies).judge(userContract(), [skill])).toMatchObject({
      status: 'achieved',
    });
    expect(
      new TaskGoalJudge(dependencies).judge(
        taskContract(),
        workflow('succeeded', ['effect.result'], 'low'),
      ),
    ).toMatchObject({ status: 'unknown', confidence: 'low' });
  });
});

function taskContract(): TaskGoalCompletionContract {
  return {
    schemaVersion: '1.0',
    taskGoalContractId: 'task-goal.1',
    planId: 'user-goal-plan.1',
    skillGoalId: 'skill-goal.1',
    attemptId: 'attempt.1',
    agentTaskId: 'task.1',
    requiredEffectRefs: ['effect.result'],
    evidenceRequirements: [],
    artifactRequirements: [],
  };
}

function skillGoal(): SkillGoal {
  return {
    skillGoalId: 'skill-goal.1',
    requiredResult: 'Produce a result.',
    capabilityNeeds: ['result.production'],
    coveredCriterionIds: ['criterion.result'],
    requiredEffectRefs: ['effect.result'],
    evidenceRequirements: [],
    artifactRequirements: [],
    assumptions: [],
    constraints: [],
    status: 'judging',
  };
}

function userContract(): UserGoalCompletionContract {
  return {
    schemaVersion: '1.0',
    goalId: 'goal.1',
    goalVersion: 1,
    title: 'Produce and verify',
    description: 'Produce and verify a result.',
    constraints: [],
    criteria: [
      {
        criterionId: 'criterion.result',
        description: 'Result exists.',
        required: true,
        expectedEffectRefs: ['effect.result'],
        evidenceRequirements: [],
        artifactRequirements: [],
      },
      {
        criterionId: 'criterion.verified',
        description: 'Result verified.',
        required: true,
        expectedEffectRefs: ['effect.verified'],
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
  };
}

function workflow(
  executionStatus: WorkflowExecutionOutcome['executionStatus'],
  effectRefs: readonly string[],
  confidence: WorkflowExecutionOutcome['confidence'],
): WorkflowExecutionOutcome {
  return {
    schemaVersion: '1.0',
    workflowPlanId: 'workflow-plan.1',
    workflowInstanceId: 'workflow-instance.1',
    executionStatus,
    effectRefs,
    evidenceRefs: [],
    artifactRefs: [],
    confidence,
    summary: 'Observed workflow outcome.',
  };
}
