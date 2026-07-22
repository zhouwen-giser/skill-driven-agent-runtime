import {
  validateUserGoalPlan,
  type UserGoalCompletionContract,
  type UserGoalPlan,
  type UserGoalPlanCandidateSnapshot,
} from '../../../domain/src/index.js';
import type { UserGoalPlanningService } from '../user-goal-planning.js';
import type { GoalVersionLock } from './ports.js';

/** The only boundary allowed to promote an interactive plan candidate into v1.2.2 authority. */
export class ConfirmedPlanHandoff {
  readonly #lock: GoalVersionLock;
  readonly #planner: Pick<UserGoalPlanningService, 'commitCandidate'>;

  constructor(
    dependencies: Readonly<{
      lock: GoalVersionLock;
      planner: Pick<UserGoalPlanningService, 'commitCandidate'>;
    }>,
  ) {
    this.#lock = dependencies.lock;
    this.#planner = dependencies.planner;
  }

  async commit(
    candidate: UserGoalPlanCandidateSnapshot<UserGoalPlan>,
    contract: UserGoalCompletionContract,
  ): Promise<void> {
    if (candidate.status !== 'confirmed') throw new Error('PLAN_CANDIDATE_NOT_CONFIRMED');
    if (!candidate.validation.valid) throw new Error('PLAN_CANDIDATE_VALIDATION_REQUIRED');
    if (
      candidate.plan.goalId !== contract.goalId ||
      candidate.plan.goalVersion !== contract.goalVersion
    ) {
      throw new Error('PLAN_CANDIDATE_GOAL_BINDING_INVALID');
    }
    validateUserGoalPlan(contract, candidate.plan);
    await this.#lock.withLock(contract.goalId, contract.goalVersion, () =>
      this.#planner.commitCandidate({ contract, plan: candidate.plan }),
    );
  }
}
