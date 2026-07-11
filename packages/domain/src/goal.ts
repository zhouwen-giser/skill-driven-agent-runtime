import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';

export type GoalStatus = 'active' | 'achieved' | 'canceled' | 'unachievable' | 'superseded';

export interface Goal {
  readonly goalId: string;
  readonly contextId: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly constraints: readonly string[];
  readonly successCriteria: readonly string[];
  readonly status: GoalStatus;
  readonly previousGoalId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateGoalInput {
  readonly goalId: string;
  readonly contextId: string;
  readonly title: string;
  readonly description: string;
  readonly constraints?: readonly string[];
  readonly successCriteria?: readonly string[];
  readonly previousGoalId?: string;
  readonly timestamp: string;
}

export function createGoal(input: CreateGoalInput): Goal {
  return {
    goalId: requireIdentifier(input.goalId, 'GOAL_ID_REQUIRED'),
    contextId: requireIdentifier(input.contextId, 'CONTEXT_ID_REQUIRED'),
    version: 1,
    title: input.title.trim(),
    description: input.description.trim(),
    constraints: [...(input.constraints ?? [])],
    successCriteria: [...(input.successCriteria ?? [])],
    status: 'active',
    ...(input.previousGoalId === undefined
      ? {}
      : { previousGoalId: requireIdentifier(input.previousGoalId, 'GOAL_ID_REQUIRED') }),
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

export function changeGoalStatus(
  goal: Goal,
  status: Exclude<GoalStatus, 'active'>,
  timestamp: string,
): Goal {
  if (goal.status !== 'active') {
    throw new DomainError(
      'TASK_TERMINAL_MUTATION_FORBIDDEN',
      'Only an active Goal can change status.',
      {
        goalId: goal.goalId,
        status: goal.status,
      },
    );
  }
  return { ...goal, status, updatedAt: timestamp };
}

export function assertGoalVersion(version: number): number {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new DomainError('GOAL_VERSION_INVALID', 'Goal version must be a positive safe integer.');
  }
  return version;
}
