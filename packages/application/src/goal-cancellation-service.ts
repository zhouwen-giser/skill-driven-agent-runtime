import type { GoalCancellationRecord } from '../../domain/src/index.js';

import type {
  Clock,
  GoalCancellationRepository,
  GoalRepository,
  WorkflowExecutionRepository,
} from './ports.js';
import type { WorkflowExecutionService } from './workflow-execution.js';
import type { UserGoalPlanController } from './user-goal-plan-controller.js';

export class GoalCancellationService {
  readonly #goals: GoalRepository;
  readonly #instances: WorkflowExecutionRepository;
  readonly #execution: Pick<WorkflowExecutionService, 'cancelForPlan'>;
  readonly #repository: Pick<GoalCancellationRepository, 'find' | 'listByGoal'>;
  readonly #terminalAuthority: Pick<UserGoalPlanController, 'cancelGoal'>;
  readonly #clock: Clock;
  readonly #nextId: () => string;

  constructor(
    dependencies: Readonly<{
      goals: GoalRepository;
      instances: WorkflowExecutionRepository;
      execution: Pick<WorkflowExecutionService, 'cancelForPlan'>;
      repository: Pick<GoalCancellationRepository, 'find' | 'listByGoal'>;
      terminalAuthority: Pick<UserGoalPlanController, 'cancelGoal'>;
      clock: Clock;
      nextId: () => string;
    }>,
  ) {
    this.#goals = dependencies.goals;
    this.#instances = dependencies.instances;
    this.#execution = dependencies.execution;
    this.#repository = dependencies.repository;
    this.#terminalAuthority = dependencies.terminalAuthority;
    this.#clock = dependencies.clock;
    this.#nextId = dependencies.nextId;
  }

  async cancel(goalId: string, reason: string): Promise<GoalCancellationRecord> {
    const normalizedReason = reason.trim();
    if (normalizedReason === '')
      throw new GoalCancellationError(
        'GOAL_CANCELLATION_REASON_REQUIRED',
        'Goal cancellation requires a displayable reason.',
      );
    const goal = await this.#goals.findById(goalId);
    if (goal?.status !== 'active')
      throw new GoalCancellationError('GOAL_NOT_ACTIVE', 'Only an active Goal can be canceled.');
    const active = await this.#instances.listActiveByGoalId(goalId);
    const warnings: string[] = [];
    for (const instance of active) {
      const canceled = await this.#execution.cancelForPlan(instance.planId);
      const policy = canceled.errors['cancellationPolicy'];
      if (policy !== undefined) warnings.push(policy.message);
    }
    return this.#terminalAuthority.cancelGoal({
      cancellationId: this.#nextId(),
      goalId,
      goalVersion: goal.version,
      reason: normalizedReason,
      warnings,
      createdAt: this.#clock.now(),
    });
  }

  async get(cancellationId: string): Promise<GoalCancellationRecord> {
    const record = await this.#repository.find(cancellationId);
    if (record === undefined)
      throw new GoalCancellationError(
        'GOAL_CANCELLATION_NOT_FOUND',
        'Goal cancellation record was not found.',
      );
    return record;
  }

  list(goalId: string): Promise<readonly GoalCancellationRecord[]> {
    return this.#repository.listByGoal(goalId);
  }
}

export type GoalCancellationErrorCode =
  'GOAL_CANCELLATION_NOT_FOUND' | 'GOAL_CANCELLATION_REASON_REQUIRED' | 'GOAL_NOT_ACTIVE';
export class GoalCancellationError extends Error {
  readonly code: GoalCancellationErrorCode;
  constructor(code: GoalCancellationErrorCode, message: string) {
    super(message);
    this.name = 'GoalCancellationError';
    this.code = code;
  }
}
