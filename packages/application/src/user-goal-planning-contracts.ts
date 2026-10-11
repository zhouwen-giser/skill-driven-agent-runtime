import { createHash } from 'node:crypto';
import {
  createUserGoalCompletionContract,
  type Goal,
  type UserGoalCompletionContract,
  type UserGoalPlan,
  type UserGoalPlanRevisionKind,
} from '../../domain/src/index.js';
export type PlanUserGoalInput = Readonly<{
  goal: Goal;
  taskId?: string;
  revision?: number;
  revisionKind?: UserGoalPlanRevisionKind;
  planningContext?: unknown;
  sourcePlan?: Readonly<{
    planId: string;
    revision: number;
    lockVersion: number;
    status: Extract<UserGoalPlan['status'], 'validated' | 'active' | 'revision_pending'>;
    inheritedCompletedEffectIds: readonly string[];
    forbiddenReplayFingerprints: readonly string[];
  }>;
}>;
export type CommitUserGoalPlanCandidateInput = Readonly<{
  contract: UserGoalCompletionContract;
  plan: UserGoalPlan;
  sourcePlan?: Readonly<{
    planId: string;
    revision: number;
    lockVersion: number;
    status: Extract<UserGoalPlan['status'], 'validated' | 'active' | 'revision_pending'>;
    inheritedCompletedEffectIds: readonly string[];
    forbiddenReplayFingerprints: readonly string[];
  }>;
}>;
export interface UserGoalPlanCandidate {
  readonly contract: UserGoalCompletionContract;
  readonly plan: UserGoalPlan;
}
export interface UserGoalPlanningRepository {
  findPlan(planId: string): Promise<UserGoalPlan | undefined>;
  saveContract(
    contract: UserGoalCompletionContract,
    contractHash: string,
    createdAt: string,
  ): Promise<void>;
  createPlan(plan: UserGoalPlan): Promise<void>;
  replacePlan(
    source: NonNullable<PlanUserGoalInput['sourcePlan']>,
    plan: UserGoalPlan,
    updatedAt: string,
  ): Promise<boolean>;
  compareAndSetPlanStatus(
    input: Readonly<{
      planId: string;
      expectedLockVersion: number;
      expectedStatus: UserGoalPlan['status'];
      status: UserGoalPlan['status'];
      updatedAt: string;
    }>,
  ): Promise<number | undefined>;
  findReusablePlan(
    goalId: string,
    goalVersion: number,
  ): Promise<Readonly<{ plan: UserGoalPlan; lockVersion: number }> | undefined>;
}

export interface UserGoalPlanCandidateGuard {
  assert(plan: UserGoalPlan, contract: UserGoalCompletionContract): void;
}

export interface UserGoalPlanCandidateAuthority {
  readonly capabilityNeeds: readonly string[];
  readonly requiredEffectRefs: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly artifactRequirements: readonly string[];
}

export interface UserGoalPlanCandidateAuthorityResolver {
  resolve(taskId: string): Promise<UserGoalPlanCandidateAuthority | undefined>;
}

export class UserGoalPlanningError extends Error {
  readonly code:
    | 'USER_GOAL_PLANNING_EXHAUSTED'
    | 'USER_GOAL_PLAN_SOURCE_CAS_FAILED'
    | 'USER_GOAL_PLAN_ID_COLLISION';

  constructor(code: UserGoalPlanningError['code'], message: string) {
    super(message);
    this.name = 'UserGoalPlanningError';
    this.code = code;
  }
}

export function userGoalCompletionContractFor(goal: Goal): UserGoalCompletionContract {
  return createUserGoalCompletionContract({
    schemaVersion: '1.0',
    goalId: goal.goalId,
    goalVersion: goal.version,
    title: goal.title,
    description: goal.description,
    constraints: goal.constraints,
    criteria: goal.successCriteria.map((description, index) => ({
      criterionId: `criterion-${String(index + 1)}`,
      description,
      required: true,
      expectedEffectRefs: [`effect-${String(index + 1)}`],
      evidenceRequirements: [`evidence-${String(index + 1)}`],
      artifactRequirements: [],
    })),
    assumptions: [],
    policy: {
      maxSkillGoals: 16,
      maxDagDepth: 8,
      maxParallelReadyGoals: 4,
      maxPlanRevisions: 4,
      maxPlanningModelAttempts: 2,
    },
  });
}

export function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(userGoalCanonicalJson(value)).digest('hex')}`;
}

export function userGoalCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(userGoalCanonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${userGoalCanonicalJson(record[key])}`)
    .join(',')}}`;
}
