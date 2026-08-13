import { createHash } from 'node:crypto';

import {
  createSkillAttempt,
  type SkillAttempt,
  type SkillExecutionContract,
  type SkillGoal,
  type TaskGoalCompletionContract,
  type SkillVersion,
} from '../../domain/src/index.js';

export interface SkillGoalDispatchRepository {
  listReadySkillGoals(planId: string): Promise<readonly SkillGoal[]>;
  findPlan(
    planId: string,
  ): Promise<
    Readonly<{ revision: number; forbiddenReplayFingerprints: readonly string[] }> | undefined
  >;
  nextAttemptOrdinal(skillGoalId: string): Promise<number>;
  createDispatchIntent(attempt: SkillAttempt): Promise<boolean>;
  rejectDispatchIntent(attempt: SkillAttempt, updatedAt: string): Promise<void>;
  saveSelectedAttempt(attempt: SkillAttempt, updatedAt: string): Promise<void>;
  saveExecutionContract(
    attempt: SkillAttempt,
    contract: SkillExecutionContract,
    updatedAt: string,
  ): Promise<void>;
  findAttempt(attemptId: string): Promise<SkillAttempt | undefined>;
  saveTaskGoalContract(
    contract: TaskGoalCompletionContract,
    contractHash: string,
    createdAt: string,
  ): Promise<void>;
}

export type SkillGoalDispatch =
  | Readonly<{
      kind: 'selected';
      attempt: SkillAttempt;
      skill: SkillVersion;
      selectionRecordId?: string;
    }>
  | Readonly<{
      kind: 'capability_gap';
      attempt: SkillAttempt;
      skillGoal: SkillGoal;
    }>;

export class SkillGoalScheduler {
  readonly #repository: SkillGoalDispatchRepository;
  readonly #candidates: Readonly<{
    list(
      skillGoal: SkillGoal,
      planId: string,
      agentTaskId?: string,
    ): Promise<readonly SkillVersion[]>;
    selectionRecordId?(skillGoal: SkillGoal, skill: SkillVersion): Promise<string | undefined>;
  }>;
  readonly #now: () => string;
  readonly #nextAttemptId: () => string;
  readonly #nextExecutionContractId: () => string;

  constructor(
    dependencies: Readonly<{
      repository: SkillGoalDispatchRepository;
      candidates: Readonly<{
        list(
          skillGoal: SkillGoal,
          planId: string,
          agentTaskId?: string,
        ): Promise<readonly SkillVersion[]>;
        selectionRecordId?(skillGoal: SkillGoal, skill: SkillVersion): Promise<string | undefined>;
      }>;
      now: () => string;
      nextAttemptId: () => string;
      nextExecutionContractId: () => string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#candidates = dependencies.candidates;
    this.#now = dependencies.now;
    this.#nextAttemptId = dependencies.nextAttemptId;
    this.#nextExecutionContractId = dependencies.nextExecutionContractId;
  }

  async dispatchReady(planId: string, agentTaskId?: string): Promise<readonly SkillGoalDispatch[]> {
    const ready = safeParallelSubset(await this.#repository.listReadySkillGoals(planId));
    const claims: Readonly<{ skillGoal: SkillGoal; attempt: SkillAttempt }>[] = [];
    for (const skillGoal of ready) {
      const createdAt = this.#now();
      const ordinal = await this.#repository.nextAttemptOrdinal(skillGoal.skillGoalId);
      if (ordinal > 2)
        throw new SkillGoalSchedulerError(
          'SKILL_GOAL_ATTEMPT_BUDGET_EXHAUSTED',
          `Skill Goal ${skillGoal.skillGoalId} exhausted its replacement-attempt budget.`,
        );
      const attempt = createSkillAttempt({
        attemptId: this.#nextAttemptId(),
        planId,
        skillGoalId: skillGoal.skillGoalId,
        ordinal,
        status: 'dispatch_intent',
        strategyFingerprint: hashJson({
          schemaVersion: '1.0',
          planId,
          skillGoalId: skillGoal.skillGoalId,
          requiredResult: skillGoal.requiredResult,
          requiredEffectRefs: skillGoal.requiredEffectRefs,
          action: 'initial_dispatch',
        }),
        budget: { maxAttempts: 2, consumedAttempts: ordinal - 1 },
        createdAt,
      });
      if (await this.#repository.createDispatchIntent(attempt)) claims.push({ skillGoal, attempt });
    }

    return Promise.all(
      claims.map(async ({ skillGoal, attempt }) => {
        try {
          const candidates = await this.#candidates.list(skillGoal, planId, agentTaskId);
          const skill = candidates.find((candidate) => isSkillGoalCompatible(skillGoal, candidate));
          const selecting: SkillAttempt = Object.freeze({
            ...attempt,
            status: 'selecting',
            updatedAt: this.#now(),
          });
          await this.#repository.saveSelectedAttempt(selecting, selecting.updatedAt);
          if (agentTaskId !== undefined) {
            const taskContract: TaskGoalCompletionContract = {
              schemaVersion: '1.0',
              taskGoalContractId: stableId('task-goal-contract', selecting.attemptId),
              planId,
              skillGoalId: skillGoal.skillGoalId,
              attemptId: selecting.attemptId,
              agentTaskId,
              requiredEffectRefs: skillGoal.requiredEffectRefs,
              evidenceRequirements: skillGoal.evidenceRequirements,
              artifactRequirements: skillGoal.artifactRequirements,
            };
            await this.#repository.saveTaskGoalContract(
              taskContract,
              hashJson(taskContract),
              selecting.updatedAt,
            );
          }
          if (skill === undefined)
            return { kind: 'capability_gap' as const, attempt: selecting, skillGoal };
          const selectionRecordId = await this.#candidates.selectionRecordId?.(skillGoal, skill);
          return {
            kind: 'selected' as const,
            attempt: selecting,
            skill,
            ...(selectionRecordId === undefined ? {} : { selectionRecordId }),
          };
        } catch (error) {
          await this.#repository.rejectDispatchIntent(attempt, this.#now());
          throw error;
        }
      }),
    );
  }

  async createExecutionContract(
    input: Readonly<{
      attempt: SkillAttempt;
      skill: SkillVersion;
      resolvedInput: unknown;
      selectionRecordId?: string;
      forbiddenReplayFingerprints?: readonly string[];
    }>,
  ): Promise<Readonly<{ attempt: SkillAttempt; contract: SkillExecutionContract }>> {
    if (input.attempt.status !== 'selecting')
      throw new SkillGoalSchedulerError(
        'SKILL_GOAL_ATTEMPT_NOT_SELECTING',
        `Attempt ${input.attempt.attemptId} is not awaiting an execution contract.`,
      );
    const executionContractId = this.#nextExecutionContractId();
    const plan = await this.#repository.findPlan(input.attempt.planId);
    if (plan === undefined)
      throw new SkillGoalSchedulerError(
        'SKILL_GOAL_PLAN_NOT_FOUND',
        `User Goal Plan ${input.attempt.planId} was not found.`,
      );
    const contractWithoutHash = {
      schemaVersion: '1.0' as const,
      executionContractId,
      ...(input.selectionRecordId === undefined
        ? {}
        : { selectionRecordId: input.selectionRecordId }),
      planId: input.attempt.planId,
      skillGoalId: input.attempt.skillGoalId,
      attemptId: input.attempt.attemptId,
      skillId: input.skill.skillId,
      skillVersion: input.skill.version,
      resolvedInput: input.resolvedInput,
      outcomeSpecificationHash: requireOutcome(input.skill).specificationHash,
      allowedAuthorities: [
        ...input.skill.toolPolicy.required,
        ...input.skill.toolPolicy.optional,
      ].map((tool) => `${tool.serverId}/${tool.toolName}`),
      budget: {
        maxReplans: input.skill.runtimePolicy.maxReplans ?? 0,
        maxLlmCalls: input.skill.runtimePolicy.maxLlmCalls ?? 0,
        maxMcpCalls: input.skill.runtimePolicy.maxMcpCalls ?? 0,
      },
      confirmationRequired: !input.skill.runtimePolicy.autoConfirmPlan,
      forbiddenReplayFingerprints: [
        ...new Set([
          ...plan.forbiddenReplayFingerprints,
          ...(input.forbiddenReplayFingerprints ?? []),
        ]),
      ],
    };
    const contract: SkillExecutionContract = Object.freeze({
      ...contractWithoutHash,
      contractHash: hashJson(contractWithoutHash),
    });
    const planning: SkillAttempt = Object.freeze({
      ...input.attempt,
      status: 'planning_workflow',
      strategyFingerprint: hashJson({
        schemaVersion: '1.0',
        planRevision: plan.revision,
        skillId: input.skill.skillId,
        skillVersion: input.skill.version,
        workflowStrategy: input.selectionRecordId ?? 'direct_selection',
        resolvedInput: input.resolvedInput,
        effectTarget: requireOutcome(input.skill).effects,
        recoveryAction: input.attempt.ordinal === 1 ? 'initial_dispatch' : 'replacement_attempt',
      }),
      executionContractId,
      updatedAt: this.#now(),
    });
    await this.#repository.saveExecutionContract(planning, contract, planning.updatedAt);
    return { attempt: planning, contract };
  }

  findAttempt(attemptId: string): Promise<SkillAttempt | undefined> {
    return this.#repository.findAttempt(attemptId);
  }
}

export function isSkillGoalCompatible(skillGoal: SkillGoal, skill: SkillVersion): boolean {
  if (skill.status !== 'enabled' || skill.outcomeSpecification === undefined) return false;
  const capabilities = new Set(skill.capabilities);
  const effects = new Set(skill.outcomeSpecification.effects);
  const evidence = new Set(skill.outcomeSpecification.evidence);
  const artifacts = new Set(skill.outcomeSpecification.artifacts);
  return (
    skillGoal.capabilityNeeds.every((item) => capabilities.has(item)) &&
    skillGoal.requiredEffectRefs.every((item) => effects.has(item)) &&
    skillGoal.evidenceRequirements.every((item) => evidence.has(item)) &&
    skillGoal.artifactRequirements.every((item) => artifacts.has(item)) &&
    policyCompatible(skillGoal.constraints, skill)
  );
}

export class SkillGoalSchedulerError extends Error {
  readonly code:
    | 'SKILL_GOAL_NO_COMPATIBLE_SKILL'
    | 'SKILL_GOAL_ATTEMPT_NOT_SELECTING'
    | 'SKILL_GOAL_ATTEMPT_BUDGET_EXHAUSTED'
    | 'SKILL_GOAL_PLAN_NOT_FOUND';

  constructor(code: SkillGoalSchedulerError['code'], message: string) {
    super(message);
    this.name = 'SkillGoalSchedulerError';
    this.code = code;
  }
}

function safeParallelSubset(ready: readonly SkillGoal[]): readonly SkillGoal[] {
  const selected: SkillGoal[] = [];
  const effects = new Set<string>();
  for (const goal of ready) {
    if (selected.length >= 4) break;
    if (
      goal.requiredEffectRefs.length === 0 ||
      !goal.constraints.includes('policy.parallel=safe')
    ) {
      if (selected.length === 0) selected.push(goal);
      break;
    }
    if (goal.requiredEffectRefs.some((effect) => effects.has(effect))) {
      if (selected.length === 0) selected.push(goal);
      continue;
    }
    selected.push(goal);
    for (const effect of goal.requiredEffectRefs) effects.add(effect);
  }
  return selected;
}

function policyCompatible(constraints: readonly string[], skill: SkillVersion): boolean {
  const policy = requireOutcome(skill).sideEffectPolicy;
  return constraints.every((constraint) => {
    if (!constraint.startsWith('policy.')) return true;
    switch (constraint) {
      case 'policy.confirmation=required':
        return !skill.runtimePolicy.autoConfirmPlan;
      case 'policy.replay=forbidden':
        return policy['replay'] === 'forbidden';
      case 'policy.parallel=safe':
        return policy['parallel'] === 'safe';
      case 'policy.side_effect=read_only':
        return policy['effect'] === 'read_only';
      default:
        return false;
    }
  });
}

function requireOutcome(skill: SkillVersion) {
  if (skill.outcomeSpecification === undefined)
    throw new SkillGoalSchedulerError(
      'SKILL_GOAL_NO_COMPATIBLE_SKILL',
      `Skill ${skill.skillId}@${String(skill.version)} has no outcome specification.`,
    );
  return skill.outcomeSpecification;
}

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}.${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
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
