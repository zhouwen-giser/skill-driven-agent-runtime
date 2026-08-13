import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  createUserGoalCompletionContract,
  createUserGoalPlan,
  validateUserGoalPlan,
  type Goal,
  type UserGoalCompletionContract,
  type UserGoalPlan,
  type UserGoalPlanRevisionKind,
} from '../../domain/src/index.js';

import type { StructuredModelProvider } from './ports.js';

const SkillGoalCandidateSchema = z
  .object({
    skillGoalId: z.string().min(1).max(128),
    requiredResult: z.string().min(1),
    capabilityNeeds: z.array(z.string().min(1)),
    coveredCriterionIds: z.array(z.string().min(1)),
    requiredEffectRefs: z.array(z.string().min(1)),
    evidenceRequirements: z.array(z.string().min(1)),
    artifactRequirements: z.array(z.string().min(1)),
    assumptions: z.array(z.string()),
    constraints: z.array(z.string()),
  })
  .loose();
const DependencyCandidateSchema = z
  .object({
    dependencyId: z.string().min(1).max(128),
    predecessorSkillGoalId: z.string().min(1).max(128),
    successorSkillGoalId: z.string().min(1).max(128),
    predicate: z.enum(['required', 'optional']),
  })
  .strict();
const PlanCandidateSchema = z
  .object({
    skillGoals: z.array(SkillGoalCandidateSchema).min(1).max(16),
    dependencies: z.array(DependencyCandidateSchema),
  })
  .strict();

const planCandidateResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['skillGoals', 'dependencies'],
  properties: {
    skillGoals: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'skillGoalId',
          'requiredResult',
          'capabilityNeeds',
          'coveredCriterionIds',
          'requiredEffectRefs',
          'evidenceRequirements',
          'artifactRequirements',
          'assumptions',
          'constraints',
        ],
        properties: {
          skillGoalId: { type: 'string', minLength: 1, maxLength: 128 },
          requiredResult: { type: 'string', minLength: 1 },
          capabilityNeeds: { type: 'array', items: { type: 'string', minLength: 1 } },
          coveredCriterionIds: { type: 'array', items: { type: 'string', minLength: 1 } },
          requiredEffectRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
          evidenceRequirements: { type: 'array', items: { type: 'string', minLength: 1 } },
          artifactRequirements: { type: 'array', items: { type: 'string', minLength: 1 } },
          assumptions: { type: 'array', items: { type: 'string' } },
          constraints: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    dependencies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dependencyId', 'predecessorSkillGoalId', 'successorSkillGoalId', 'predicate'],
        properties: {
          dependencyId: { type: 'string', minLength: 1, maxLength: 128 },
          predecessorSkillGoalId: { type: 'string', minLength: 1, maxLength: 128 },
          successorSkillGoalId: { type: 'string', minLength: 1, maxLength: 128 },
          predicate: { enum: ['required', 'optional'] },
        },
      },
    },
  },
} as const;

export interface UserGoalPlanningRepository {
  findPlan(planId: string): Promise<UserGoalPlan | undefined>;
  saveContract(
    contract: UserGoalCompletionContract,
    contractHash: string,
    createdAt: string,
  ): Promise<void>;
  createPlan(plan: UserGoalPlan): Promise<void>;
  replacePlan(
    source: NonNullable<Parameters<UserGoalPlanningService['plan']>[0]['sourcePlan']>,
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

export class UserGoalPlanningService {
  readonly #model: StructuredModelProvider;
  readonly #repository: UserGoalPlanningRepository;
  readonly #now: () => string;
  readonly #nextPlanId: () => string;
  readonly #candidateGuard: UserGoalPlanCandidateGuard | undefined;
  readonly #candidateAuthority: UserGoalPlanCandidateAuthorityResolver | undefined;

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
    this.#model = dependencies.model;
    this.#repository = dependencies.repository;
    this.#now = dependencies.now;
    this.#nextPlanId = dependencies.nextPlanId;
    this.#candidateGuard = dependencies.candidateGuard;
    this.#candidateAuthority = dependencies.candidateAuthority;
  }

  async plan(
    input: Readonly<{
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
    }>,
  ): Promise<Readonly<{ contract: UserGoalCompletionContract; plan: UserGoalPlan }>> {
    const generated = await this.generateCandidate(input);
    await this.commitCandidate({
      ...generated,
      ...(input.sourcePlan === undefined ? {} : { sourcePlan: input.sourcePlan }),
    });
    return generated;
  }

  async generateCandidate(
    input: Readonly<{
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
    }>,
  ): Promise<Readonly<{ contract: UserGoalCompletionContract; plan: UserGoalPlan }>> {
    const createdAt = this.#now();
    const contract = userGoalCompletionContractFor(input.goal);
    const contractHash = hashJson(contract);
    const candidateAuthority =
      input.taskId === undefined
        ? undefined
        : await this.#candidateAuthority?.resolve(input.taskId);
    const correctionErrors: string[] = [];
    for (let attempt = 1; attempt <= contract.policy.maxPlanningModelAttempts; attempt += 1) {
      try {
        const candidate = PlanCandidateSchema.parse(
          await this.#model.generateStructured({
            stage: 'goal_planning',
            instruction: JSON.stringify({
              operation: 'plan_user_goal_skill_goal_dag',
              contract,
              limits: contract.policy,
              forbiddenExecutionAuthority: [
                'Skill/version',
                'Tool',
                'Provider/MCP operation',
                'Workflow/model provider',
              ],
              ...(candidateAuthority === undefined
                ? {}
                : {
                    taskCapabilityPlanAuthority: candidateAuthority,
                    taskCapabilityPlanAuthorityPolicy:
                      'Produce exactly one Skill Goal and no dependencies. Runtime deterministically owns the four reference arrays and required criterion coverage.',
                  }),
              ...(input.planningContext === undefined
                ? {}
                : {
                    advisoryPlanningContext: input.planningContext,
                    immutableAuthorities: {
                      contract,
                      safetyPolicy: contract.policy,
                      readiness: 'resolved_later_by_existing_runtime',
                      terminal: 'UserGoalPlanController',
                    },
                  }),
            }),
            responseSchema: planCandidateResponseSchema,
            correctionErrors,
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
          }),
        );
        const planId = this.#nextPlanId();
        const authoritativeCandidate =
          candidateAuthority === undefined
            ? candidate
            : applyCandidateAuthority(candidate, candidateAuthority, contract);
        const normalizedCandidate = normalizeCandidateIdentifiers(authoritativeCandidate, planId);
        const revision =
          input.revision ?? (input.sourcePlan === undefined ? 1 : input.sourcePlan.revision + 1);
        const plan = validateUserGoalPlan(
          contract,
          createUserGoalPlan({
            schemaVersion: '1.0',
            planId,
            goalId: contract.goalId,
            goalVersion: contract.goalVersion,
            revision,
            revisionKind: input.revisionKind ?? 'initial',
            ...(input.sourcePlan === undefined ? {} : { sourcePlanId: input.sourcePlan.planId }),
            status: 'validated',
            contractHash,
            contentHash: hashJson({
              schemaVersion: '1.0',
              goalId: contract.goalId,
              goalVersion: contract.goalVersion,
              revision,
              skillGoals: normalizedCandidate.skillGoals,
              dependencies: normalizedCandidate.dependencies,
            }),
            skillGoals: normalizedCandidate.skillGoals.map((goal) => ({
              ...goal,
              status: 'pending',
            })),
            dependencies: normalizedCandidate.dependencies,
            inheritedCompletedEffectIds: input.sourcePlan?.inheritedCompletedEffectIds ?? [],
            forbiddenReplayFingerprints: input.sourcePlan?.forbiddenReplayFingerprints ?? [],
            createdAt,
          }),
        );
        if (candidateAuthority !== undefined) assertCandidateAuthority(plan, candidateAuthority);
        this.#candidateGuard?.assert(plan, contract);
        return { contract, plan };
      } catch (error) {
        if (error instanceof UserGoalPlanningError) throw error;
        correctionErrors.push(errorCode(error));
      }
    }
    throw new UserGoalPlanningError(
      'USER_GOAL_PLANNING_EXHAUSTED',
      `Planning failed closed after ${String(contract.policy.maxPlanningModelAttempts)} invalid attempts: ${correctionErrors.join(',')}`,
    );
  }

  async commitCandidate(
    input: Readonly<{
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
    }>,
  ): Promise<void> {
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
    if (this.#candidateGuard !== undefined || this.#candidateAuthority !== undefined)
      return Promise.resolve(undefined);
    return this.#repository.findReusablePlan(goalId, goalVersion);
  }
}

function applyCandidateAuthority(
  candidate: z.infer<typeof PlanCandidateSchema>,
  authority: UserGoalPlanCandidateAuthority,
  contract: UserGoalCompletionContract,
): z.infer<typeof PlanCandidateSchema> {
  const skillGoal = candidate.skillGoals[0];
  if (candidate.skillGoals.length !== 1 || skillGoal === undefined || candidate.dependencies.length)
    return candidate;
  return {
    skillGoals: [
      {
        ...skillGoal,
        capabilityNeeds: [...authority.capabilityNeeds],
        coveredCriterionIds: contract.criteria
          .filter((criterion) => criterion.required)
          .map((criterion) => criterion.criterionId),
        requiredEffectRefs: [...authority.requiredEffectRefs],
        evidenceRequirements: [...authority.evidenceRequirements],
        artifactRequirements: [...authority.artifactRequirements],
      },
    ],
    dependencies: [],
  };
}

function assertCandidateAuthority(
  plan: UserGoalPlan,
  authority: UserGoalPlanCandidateAuthority,
): void {
  const skillGoal = plan.skillGoals[0];
  if (
    plan.skillGoals.length !== 1 ||
    skillGoal === undefined ||
    plan.dependencies.length !== 0 ||
    canonicalJson(skillGoal.capabilityNeeds) !== canonicalJson(authority.capabilityNeeds) ||
    canonicalJson(skillGoal.requiredEffectRefs) !== canonicalJson(authority.requiredEffectRefs) ||
    canonicalJson(skillGoal.evidenceRequirements) !==
      canonicalJson(authority.evidenceRequirements) ||
    canonicalJson(skillGoal.artifactRequirements) !== canonicalJson(authority.artifactRequirements)
  )
    throw Object.assign(
      new Error('The User Goal Plan does not match the immutable Task Capability authority.'),
      { code: 'USER_GOAL_PLAN_TASK_CAPABILITY_AUTHORITY_INVALID' as const },
    );
}

function normalizeCandidateIdentifiers(
  candidate: z.infer<typeof PlanCandidateSchema>,
  planId: string,
): z.infer<typeof PlanCandidateSchema> {
  const originalIds = candidate.skillGoals.map((goal) => goal.skillGoalId);
  if (new Set(originalIds).size !== originalIds.length)
    throw Object.assign(new Error('Skill Goal candidate identifiers must be unique.'), {
      code: 'USER_GOAL_PLAN_CANDIDATE_ID_INVALID' as const,
    });
  const mapped = new Map(
    originalIds.map((originalId, index) => [
      originalId,
      `${planId}:skill-goal:${String(index + 1)}`,
    ]),
  );
  return {
    skillGoals: candidate.skillGoals.map((goal, index) => ({
      ...goal,
      skillGoalId: `${planId}:skill-goal:${String(index + 1)}`,
    })),
    dependencies: candidate.dependencies.map((dependency, index) => {
      const predecessorSkillGoalId = mapped.get(dependency.predecessorSkillGoalId);
      const successorSkillGoalId = mapped.get(dependency.successorSkillGoalId);
      if (predecessorSkillGoalId === undefined || successorSkillGoalId === undefined)
        throw Object.assign(new Error('Skill Goal dependency references an unknown candidate.'), {
          code: 'USER_GOAL_PLAN_CANDIDATE_ID_INVALID' as const,
        });
      return {
        ...dependency,
        dependencyId: `${planId}:dependency:${String(index + 1)}`,
        predecessorSkillGoalId,
        successorSkillGoalId,
      };
    }),
  };
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

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : error instanceof Error
      ? error.name
      : 'UNKNOWN_PLANNING_ERROR';
}
