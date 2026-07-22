import { describe, expect, it } from 'vitest';

import type { GoalCancellationRecord, WorkflowInstance } from '../../domain/src/index.js';
import { GoalCancellationService } from '../src/index.js';

const goal = {
  goalId: 'goal-cancel',
  contextId: 'context-cancel',
  version: 2,
  title: 'Cancelable',
  description: 'Cancel all work.',
  constraints: [],
  successCriteria: [],
  status: 'active' as const,
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};

describe('GoalCancellationService', () => {
  it('controls every active instance before committing the Goal cascade', async () => {
    const canceledPlans: string[] = [];
    let persisted: GoalCancellationRecord | undefined;
    const service = new GoalCancellationService({
      goals: {
        findById: () => Promise.resolve(goal),
        findActiveByContextId: () => Promise.resolve(goal),
        findLatestByContextId: () => Promise.resolve(goal),
        listByContextId: () => Promise.resolve([goal]),
        listTransitions: () => Promise.resolve([]),
        save: () => Promise.resolve(),
      },
      instances: {
        findInstance: () => Promise.resolve(undefined),
        findActiveByPlanId: () => Promise.resolve(undefined),
        findLatestByPlanId: () => Promise.resolve(undefined),
        listActiveByGoalId: () =>
          Promise.resolve([instance('instance-1', 'plan-1'), instance('instance-2', 'plan-2')]),
        countNodeEvents: () => Promise.resolve(0),
        listNodeEvents: () => Promise.resolve([]),
        saveInstance: () => Promise.resolve(),
        saveNodeEvents: () => Promise.resolve(),
      },
      execution: {
        cancelForPlan: (planId) => {
          canceledPlans.push(planId);
          return Promise.resolve({
            ...instance(`canceled-${planId}`, planId),
            status: 'canceled',
            errors: {
              cancellationPolicy: {
                code: 'CANCEL_STRATEGY_TRY_INTERRUPT',
                message: `Canceled ${planId}; no automatic compensation ran.`,
              },
            },
            completedAt: '2026-07-12T00:01:00.000Z',
          });
        },
      },
      repository: {
        find: () => Promise.resolve(persisted),
        listByGoal: () => Promise.resolve(persisted === undefined ? [] : [persisted]),
      },
      terminalAuthority: {
        cancelGoal: (input) => {
          persisted = {
            ...input,
            canceledTaskIds: ['task-1', 'task-2'],
            invalidatedPlanIds: ['plan-1', 'plan-2'],
            canceledInstanceIds: ['instance-1', 'instance-2'],
          };
          return Promise.resolve(persisted);
        },
      },
      clock: { now: () => '2026-07-12T00:01:00.000Z' },
      nextId: () => 'goal-cancellation-1',
    });

    await expect(service.cancel(goal.goalId, 'Operator canceled the Goal.')).resolves.toMatchObject(
      {
        canceledTaskIds: ['task-1', 'task-2'],
        warnings: [expect.stringContaining('plan-1'), expect.stringContaining('plan-2')],
      },
    );
    expect(canceledPlans).toEqual(['plan-1', 'plan-2']);
    await expect(service.cancel(goal.goalId, ' ')).rejects.toMatchObject({
      code: 'GOAL_CANCELLATION_REASON_REQUIRED',
    });
  });
});

function instance(instanceId: string, planId: string): WorkflowInstance {
  return {
    instanceId,
    planId,
    workflowDefinitionId: 'workflow-cancel',
    workflowVersion: 1,
    goalId: goal.goalId,
    goalVersion: goal.version,
    skillVersions: [],
    budgetLimits: {
      maxReplans: 1,
      maxDurationSeconds: 60,
      maxLlmCalls: 2,
      maxMcpCalls: 2,
      maxCost: 2,
    },
    budgetUsage: { replanCount: 0, durationMs: 0, llmCalls: 0, mcpCalls: 0, cost: 0 },
    status: 'running',
    input: {},
    errors: {},
    startedAt: '2026-07-12T00:00:00.000Z',
  };
}
