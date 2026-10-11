import { validateUserGoalPlan, type UserGoalPlan } from '../../domain/src/index.js';
import {
  UserGoalPlanningError,
  type CommitUserGoalPlanCandidateInput,
  type UserGoalPlanCandidateGuard,
  type UserGoalPlanningRepository,
} from './user-goal-planning-contracts.js';
export class UserGoalPlanCommitService {
  readonly #repository: UserGoalPlanningRepository;
  readonly #now: () => string;
  readonly #candidateGuard: UserGoalPlanCandidateGuard | undefined;
  readonly #candidateAuthority: boolean;
  constructor(
    dependencies: Readonly<{
      repository: UserGoalPlanningRepository;
      now: () => string;
      candidateGuard?: UserGoalPlanCandidateGuard;
      candidateAuthorityPresent?: boolean;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#now = dependencies.now;
    this.#candidateGuard = dependencies.candidateGuard;
    this.#candidateAuthority = dependencies.candidateAuthorityPresent === true;
  }
  async commitCandidate(input: CommitUserGoalPlanCandidateInput): Promise<void> {
    validateUserGoalPlan(input.contract, input.plan);
    this.#candidateGuard?.assert(input.plan, input.contract);
    const existing = await this.#repository.findPlan(input.plan.planId);
    if (existing !== undefined) {
      if (existing.contentHash === input.plan.contentHash) return;
      throw new UserGoalPlanningError(
        'USER_GOAL_PLAN_ID_COLLISION',
        'A different User Goal Plan already uses this candidate plan ID.',
      );
    }
    await this.#repository.saveContract(
      input.contract,
      input.plan.contractHash,
      input.plan.createdAt,
    );
    if (input.sourcePlan === undefined) {
      await this.#repository.createPlan(input.plan);
      return;
    }
    if (!(await this.#repository.replacePlan(input.sourcePlan, input.plan, this.#now()))) {
      throw new UserGoalPlanningError(
        'USER_GOAL_PLAN_SOURCE_CAS_FAILED',
        'Source User Goal Plan changed before revision commit.',
      );
    }
  }
  findReusablePlan(
    goalId: string,
    goalVersion: number,
  ): Promise<Readonly<{ plan: UserGoalPlan; lockVersion: number }> | undefined> {
    if (this.#candidateGuard !== undefined || this.#candidateAuthority)
      return Promise.resolve(undefined);
    return this.#repository.findReusablePlan(goalId, goalVersion);
  }
}
