import type { SkillVersion, UserGoalPlan } from '../../domain/src/index.js';
import type { UserGoalPlanCandidateGuard } from './user-goal-planning.js';
import { HOME_LAB_READ_ONLY_COMPOSITE_SKILL } from './home-lab-read-only-workflow-contract.js';

export const HOME_LAB_READ_ONLY_GOAL_REFS = Object.freeze({
  capabilityNeeds: Object.freeze(['home.living-room.read-state']),
  requiredEffectRefs: Object.freeze(['effect.home.living-room.state_read']),
  evidenceRequirements: Object.freeze(['light.state.observation', 'climate.state.observation']),
  artifactRequirements: Object.freeze([]),
} as const);

export class HomeLabReadOnlyUserGoalPlanError extends Error {
  readonly code = 'HOME_LAB_READ_ONLY_USER_GOAL_PLAN_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'HomeLabReadOnlyUserGoalPlanError';
  }
}

export function assertHomeLabReadOnlyUserGoalPlanContract(plan: unknown): void {
  if (!isObject(plan)) invalid();
  const goals = plan['skillGoals'];
  const dependencies = plan['dependencies'];
  if (
    !Array.isArray(goals) ||
    goals.length !== 1 ||
    !Array.isArray(dependencies) ||
    dependencies.length !== 0
  )
    invalid();
  const goal: unknown = goals[0];
  if (
    !isObject(goal) ||
    canonical(goal['capabilityNeeds']) !==
      canonical(HOME_LAB_READ_ONLY_GOAL_REFS.capabilityNeeds) ||
    canonical(goal['requiredEffectRefs']) !==
      canonical(HOME_LAB_READ_ONLY_GOAL_REFS.requiredEffectRefs) ||
    canonical(goal['evidenceRequirements']) !==
      canonical(HOME_LAB_READ_ONLY_GOAL_REFS.evidenceRequirements) ||
    canonical(goal['artifactRequirements']) !==
      canonical(HOME_LAB_READ_ONLY_GOAL_REFS.artifactRequirements)
  )
    invalid();
}

export class HomeLabReadOnlyUserGoalPlanCandidateGuard implements UserGoalPlanCandidateGuard {
  assert(plan: UserGoalPlan): void {
    assertHomeLabReadOnlyUserGoalPlanContract(plan);
  }
}

export function verifiedHomeLabReadOnlyOutcomeRefs(skill: SkillVersion): Readonly<{
  effectRefs: readonly string[];
  evidenceRefs: readonly string[];
  artifactRefs: readonly string[];
}> {
  const outcome = skill.outcomeSpecification;
  if (
    skill.skillId !== HOME_LAB_READ_ONLY_COMPOSITE_SKILL.skillId ||
    skill.version !== HOME_LAB_READ_ONLY_COMPOSITE_SKILL.skillVersion ||
    outcome === undefined ||
    canonical(outcome.effects) !== canonical(HOME_LAB_READ_ONLY_GOAL_REFS.requiredEffectRefs) ||
    canonical(outcome.evidence) !== canonical(HOME_LAB_READ_ONLY_GOAL_REFS.evidenceRequirements) ||
    canonical(outcome.artifacts) !== canonical(HOME_LAB_READ_ONLY_GOAL_REFS.artifactRequirements)
  )
    invalid();
  return Object.freeze({
    effectRefs: Object.freeze([...outcome.effects]),
    evidenceRefs: Object.freeze([...outcome.evidence]),
    artifactRefs: Object.freeze([...outcome.artifacts]),
  });
}

function invalid(): never {
  throw new HomeLabReadOnlyUserGoalPlanError(
    'The home-lab profile requires one composite SkillGoal with exact non-empty outcome references.',
  );
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
