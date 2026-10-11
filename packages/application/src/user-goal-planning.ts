import type { StructuredModelProvider } from './ports.js';
import { UserGoalCandidateGenerator } from './user-goal-candidate-generator.js';
import { UserGoalPlanCommitService } from './user-goal-plan-commit.js';
import type {
  CommitUserGoalPlanCandidateInput,
  PlanUserGoalInput,
  UserGoalPlanCandidateAuthorityResolver,
  UserGoalPlanCandidateGuard,
  UserGoalPlanningRepository,
} from './user-goal-planning-contracts.js';
export * from './user-goal-planning-contracts.js';
/** Compatibility facade: generation has no formal writer; promotion is explicit. */
export class UserGoalPlanningService {
  readonly candidates: UserGoalCandidateGenerator;
  readonly commits: UserGoalPlanCommitService;
  constructor(
    dependencies: Readonly<{
      model: StructuredModelProvider;
      repository: UserGoalPlanningRepository;
      now: () => string;
      nextPlanId: () => string;
      candidateGuard?: UserGoalPlanCandidateGuard;
      candidateAuthority?: UserGoalPlanCandidateAuthorityResolver;
    }>,
  ) {
    this.candidates = new UserGoalCandidateGenerator({
      ...dependencies,
      model: { generateStructured: (request) => dependencies.model.generateStructured(request) },
    });
    this.commits = new UserGoalPlanCommitService({
      ...dependencies,
      candidateAuthorityPresent: dependencies.candidateAuthority !== undefined,
    });
  }
  async plan(input: PlanUserGoalInput) {
    const generated = await this.candidates.generateCandidate(input);
    await this.commits.commitCandidate({
      ...generated,
      ...(input.sourcePlan === undefined ? {} : { sourcePlan: input.sourcePlan }),
    });
    return generated;
  }
  generateCandidate(input: PlanUserGoalInput) {
    return this.candidates.generateCandidate(input);
  }
  commitCandidate(input: CommitUserGoalPlanCandidateInput) {
    return this.commits.commitCandidate(input);
  }
  findReusablePlan(goalId: string, goalVersion: number) {
    return this.commits.findReusablePlan(goalId, goalVersion);
  }
}
