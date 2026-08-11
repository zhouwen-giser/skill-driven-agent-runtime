import {
  validateUserGoalPlan,
  type UserGoalCompletionContract,
  type UserGoalPlan,
  type UserGoalPlanCandidateValidation,
  type PlanConfirmationPolicy,
} from '../../../domain/src/index.js';

const checkNames = [
  'dag',
  'bounds',
  'coverage',
  'capability_shape',
  'policy',
  'side_effect',
  'no_replay',
] as const;

export interface ExternalUserGoalPlanCandidateGuard {
  assert(plan: UserGoalPlan, contract: UserGoalCompletionContract): void;
}

export class UserGoalPlanCandidateValidator {
  readonly #externalGuard: ExternalUserGoalPlanCandidateGuard | undefined;

  constructor(dependencies: Readonly<{ externalGuard?: ExternalUserGoalPlanCandidateGuard }> = {}) {
    this.#externalGuard = dependencies.externalGuard;
  }

  validate(
    contract: UserGoalCompletionContract,
    candidate: UserGoalPlan,
    confirmationPolicy: PlanConfirmationPolicy = 'manual_all',
  ): UserGoalPlanCandidateValidation {
    let errorCode: string | undefined;
    if (
      candidate.skillGoals.some(
        (goal) => goal.requiredResult.trim() === '' || goal.capabilityNeeds.length === 0,
      )
    ) {
      errorCode = 'USER_GOAL_PLAN_CAPABILITY_SHAPE_INVALID';
    }
    // Confirmation policy controls handoff, not plan validity. High-risk candidates remain
    // reviewable but the session service always forces a manual confirmation boundary.
    void confirmationPolicy;
    if (errorCode === undefined) {
      try {
        validateUserGoalPlan(contract, candidate);
      } catch (error: unknown) {
        errorCode = errorCodeOf(error);
      }
    }
    if (errorCode === undefined && this.#externalGuard !== undefined) {
      try {
        this.#externalGuard.assert(candidate, contract);
      } catch (error: unknown) {
        errorCode = errorCodeOf(error);
      }
    }
    const failedCheck = errorCode === undefined ? undefined : checkFor(errorCode);
    return {
      valid: errorCode === undefined,
      errorCodes: errorCode === undefined ? [] : [errorCode],
      checks: checkNames.map((check) =>
        check === failedCheck && errorCode !== undefined
          ? { check, passed: false, errorCode }
          : { check, passed: true },
      ),
    };
  }

  riskLevel(plan: UserGoalPlan): 'low' | 'high' {
    const text = JSON.stringify({
      effects: plan.skillGoals.flatMap((goal) => goal.requiredEffectRefs),
      capabilities: plan.skillGoals.flatMap((goal) => goal.capabilityNeeds),
      constraints: plan.skillGoals.flatMap((goal) => goal.constraints),
    }).toLocaleLowerCase();
    return /\b(delete|write|move|control|mutate|update|execute|purchase|send)\b/u.test(text)
      ? 'high'
      : 'low';
  }
}

function errorCodeOf(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'USER_GOAL_PLAN_INVALID';
}

function checkFor(errorCode: string): (typeof checkNames)[number] {
  if (errorCode.includes('CYCLE')) return 'dag';
  if (errorCode.includes('BOUND')) return 'bounds';
  if (errorCode.includes('COVERAGE')) return 'coverage';
  if (errorCode.includes('CAPABILITY_SHAPE')) return 'capability_shape';
  if (errorCode.includes('HIGH_RISK') || errorCode.includes('POLICY')) return 'policy';
  if (errorCode.includes('SIDE_EFFECT')) return 'side_effect';
  if (errorCode.includes('REPLAY')) return 'no_replay';
  return 'dag';
}
