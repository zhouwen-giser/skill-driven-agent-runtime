import {
  COGNITIVE_SCHEMA_VERSION,
  createInteractivePlanningSessionSnapshot,
  createInteractivePlanningTurn,
  createUserGoalPlanCandidateSnapshot,
  type CognitiveInjectionMode,
  type CognitiveSourceRef,
  type ExperienceUsageRecord,
  type Goal,
  type InteractivePlanningAction,
  type InteractivePlanningSessionSnapshot,
  type PlanConfirmationPolicy,
  type PlanningCorrectionType,
  type PlanningPreferenceCategory,
  type UserGoalPlan,
  type UserGoalPlanCandidateSnapshot,
  type UserGoalCompletionContract,
} from '../../../domain/src/index.js';
import {
  userGoalCompletionContractFor,
  type UserGoalPlanningService,
} from '../user-goal-planning.js';
import type { ConfirmedPlanHandoff } from './confirmed-plan-handoff.js';
import type { InteractivePlanPatchService } from './interactive-plan-patch-service.js';
import type {
  ExperienceUsageRepository,
  InteractivePlanningMutationResult,
  InteractivePlanningRepository,
  PlanningCommitFence,
} from './ports.js';
import type {
  ExperienceEnrichedUserGoalPlanningService,
  ExperiencePlanningResult,
} from './experience-enriched-planner.js';
import type { UserGoalPlanCandidateValidator } from './user-goal-plan-candidate-validator.js';
import type {
  PlanningCorrectionObserver,
  PlanningCorrectionRecordInput,
} from './planning-correction-service.js';

export interface InteractivePlanningActionInput {
  readonly sessionId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly action: InteractivePlanningAction;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface InteractivePlanningSessionView {
  readonly outcome: 'started' | InteractivePlanningMutationResult['outcome'];
  readonly session: InteractivePlanningSessionSnapshot;
  readonly candidate: UserGoalPlanCandidateSnapshot<UserGoalPlan>;
}

/**
 * Admits a deterministic, already-materialized plan candidate.  This is the
 * narrow P08 seam: it deliberately reuses this session's validation,
 * confirmation policy, CAS persistence and ConfirmedPlanHandoff rather than
 * introducing another plan authority.
 */
export interface MaterializedPlanningCandidateInput {
  readonly taskId: string;
  readonly userId: string;
  readonly goalSessionId: string;
  readonly confirmedContractCandidateId: string;
  readonly goal: Goal;
  readonly contract: UserGoalCompletionContract;
  readonly plan: UserGoalPlan;
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly experienceHints?: readonly string[];
  readonly confirmationPolicy?: PlanConfirmationPolicy;
  /** A fact supplied by P08; the existing session retains confirmation authority. */
  readonly requiresManualConfirmation: boolean;
  readonly planningMetadata?: UserGoalPlanCandidateSnapshot<UserGoalPlan>['planningMetadata'];
  readonly commitFence?: PlanningCommitFence;
}

export class InteractivePlanningSessionService {
  readonly #repository: InteractivePlanningRepository;
  readonly #planner: Pick<UserGoalPlanningService, 'generateCandidate'>;
  readonly #experiencePlanner: Pick<ExperienceEnrichedUserGoalPlanningService, 'plan'> | undefined;
  readonly #experienceUsage: ExperienceUsageRepository | undefined;
  readonly #injectionMode: CognitiveInjectionMode;
  readonly #patches: Pick<InteractivePlanPatchService, 'compile'>;
  readonly #validator: UserGoalPlanCandidateValidator;
  readonly #handoff: Pick<ConfirmedPlanHandoff, 'commit'>;
  readonly #goals: Readonly<{ get(goalId: string): Promise<Goal> }>;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #ids: Readonly<{
    nextSessionId(): string;
    nextTurnId(): string;
    nextCandidateId(): string;
  }>;
  readonly #maxRevisions: number;
  readonly #maxElapsedMs: number;
  readonly #defaultConfirmationPolicy: PlanConfirmationPolicy;
  readonly #interactions: PlanningCorrectionObserver | undefined;

  constructor(
    dependencies: Readonly<{
      repository: InteractivePlanningRepository;
      planner: Pick<UserGoalPlanningService, 'generateCandidate'>;
      experiencePlanner?: Pick<ExperienceEnrichedUserGoalPlanningService, 'plan'>;
      experienceUsage?: ExperienceUsageRepository;
      injectionMode?: CognitiveInjectionMode;
      patches: Pick<InteractivePlanPatchService, 'compile'>;
      validator: UserGoalPlanCandidateValidator;
      handoff: Pick<ConfirmedPlanHandoff, 'commit'>;
      goals: Readonly<{ get(goalId: string): Promise<Goal> }>;
      clock: Readonly<{ now(): string }>;
      ids: Readonly<{
        nextSessionId(): string;
        nextTurnId(): string;
        nextCandidateId(): string;
      }>;
      maxRevisions: number;
      maxElapsedMs: number;
      defaultConfirmationPolicy?: PlanConfirmationPolicy;
      interactions?: PlanningCorrectionObserver;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#planner = dependencies.planner;
    this.#experiencePlanner = dependencies.experiencePlanner;
    this.#experienceUsage = dependencies.experienceUsage;
    this.#injectionMode = dependencies.injectionMode ?? 'off';
    this.#patches = dependencies.patches;
    this.#validator = dependencies.validator;
    this.#handoff = dependencies.handoff;
    this.#goals = dependencies.goals;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#maxRevisions = dependencies.maxRevisions;
    this.#maxElapsedMs = dependencies.maxElapsedMs;
    this.#defaultConfirmationPolicy = dependencies.defaultConfirmationPolicy ?? 'manual_all';
    this.#interactions = dependencies.interactions;
  }

  async start(
    input: Readonly<{
      taskId: string;
      userId: string;
      goalSessionId: string;
      confirmedContractCandidateId: string;
      goal: Goal;
      sourceRefs: readonly CognitiveSourceRef[];
      experienceHints?: readonly string[];
    }>,
  ): Promise<InteractivePlanningSessionView> {
    const existing = await this.#repository.findByTask(input.taskId);
    if (existing !== undefined) {
      if (existing.goalId !== input.goal.goalId || existing.goalVersion !== input.goal.version)
        throw new Error('INTERACTIVE_PLANNING_GOAL_BINDING_INVALID');
      return this.#viewAndEnsureHandoff('duplicate', existing);
    }
    const timestamp = this.#clock.now();
    const sessionId = this.#ids.nextSessionId();
    const candidateId = this.#ids.nextCandidateId();
    const planned = await this.#plan({
      taskId: input.taskId,
      userId: input.userId,
      sessionId,
      candidateId,
      goal: input.goal,
    });
    const generated = { contract: planned.contract, plan: planned.plan };
    const confirmationPolicy = planned.requiresManualConfirmation
      ? 'manual_all'
      : this.#defaultConfirmationPolicy;
    const validation = this.#validator.validate(
      generated.contract,
      generated.plan,
      confirmationPolicy,
    );
    if (!validation.valid) throw new Error(validation.errorCodes.join(','));
    const riskLevel = this.#validator.riskLevel(generated.plan);
    const autoConfirm = shouldAutoConfirm(confirmationPolicy, riskLevel);
    const candidate = createUserGoalPlanCandidateSnapshot({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      candidateId,
      sessionId,
      revision: 1,
      status: autoConfirm ? 'confirmed' : 'candidate',
      plan: generated.plan,
      planHash: generated.plan.contentHash,
      validation,
      diff: {
        changedFields: ['skillGoals', 'dependencies', 'confirmationPolicy'],
        addedSkillGoalIds: generated.plan.skillGoals.map((goal) => goal.skillGoalId).sort(),
        removedSkillGoalIds: [],
      },
      experienceHints: [
        ...(input.experienceHints ?? []),
        `injection_mode:${planned.mode}`,
        ...(planned.fallbackReason === undefined
          ? []
          : [`experience_fallback:${planned.fallbackReason}`]),
        ...planned.usageRecords.map((record) => `knowledge:${record.authoritativeRef}`),
      ],
      confirmationPolicy,
      riskLevel,
      planningMetadata: { priorities: {}, parallelGroups: {} },
      sourceRefs: [...input.sourceRefs, ...knowledgeSourceRefs(planned.usageRecords, timestamp)],
      createdAt: timestamp,
    });
    const session = createInteractivePlanningSessionSnapshot({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      sessionId,
      taskId: input.taskId,
      goalSessionId: input.goalSessionId,
      confirmedContractCandidateId: input.confirmedContractCandidateId,
      goalId: input.goal.goalId,
      goalVersion: input.goal.version,
      state: autoConfirm ? 'confirmed' : 'plan_review',
      version: 1,
      currentCandidateId: candidate.candidateId,
      currentCandidateRevision: candidate.revision,
      revisionCount: 1,
      maxRevisions: this.#maxRevisions,
      maxElapsedMs: this.#maxElapsedMs,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const persisted =
      planned.usageRecords.length > 0 && this.#experienceUsage !== undefined
        ? await this.#experienceUsage.saveWithPlanCandidate(
            session,
            candidate,
            planned.usageRecords,
          )
        : await this.#repository.start(session, candidate);
    return this.#viewAndEnsureHandoff(
      persisted.sessionId === session.sessionId ? 'started' : 'duplicate',
      persisted,
    );
  }

  async startWithMaterializedCandidate(
    input: MaterializedPlanningCandidateInput,
  ): Promise<InteractivePlanningSessionView> {
    if (
      input.goal.goalId !== input.contract.goalId ||
      input.goal.version !== input.contract.goalVersion
    ) {
      throw new Error('INTERACTIVE_PLANNING_GOAL_BINDING_INVALID');
    }
    const existing = await this.#repository.findByTask(input.taskId);
    if (existing !== undefined) {
      if (existing.goalId !== input.goal.goalId || existing.goalVersion !== input.goal.version)
        throw new Error('INTERACTIVE_PLANNING_GOAL_BINDING_INVALID');
      const current = await this.#currentCandidate(existing);
      if (current.plan.contentHash !== input.plan.contentHash)
        throw new Error('INTERACTIVE_PLANNING_IDEMPOTENCY_CONFLICT');
      return this.#viewAndEnsureHandoff('duplicate', existing, input.contract);
    }

    const timestamp = this.#clock.now();
    const sessionId = this.#ids.nextSessionId();
    const candidateId = this.#ids.nextCandidateId();
    const confirmationPolicy = input.requiresManualConfirmation
      ? 'manual_all'
      : (input.confirmationPolicy ?? this.#defaultConfirmationPolicy);
    const validation = this.#validator.validate(input.contract, input.plan, confirmationPolicy);
    if (!validation.valid) throw new Error(validation.errorCodes.join(','));
    const riskLevel = this.#validator.riskLevel(input.plan);
    const autoConfirm = shouldAutoConfirm(confirmationPolicy, riskLevel);
    const candidate = createUserGoalPlanCandidateSnapshot({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      candidateId,
      sessionId,
      revision: 1,
      status: autoConfirm ? 'confirmed' : 'candidate',
      plan: input.plan,
      planHash: input.plan.contentHash,
      validation,
      diff: {
        changedFields: ['skillGoals', 'dependencies', 'confirmationPolicy'],
        addedSkillGoalIds: input.plan.skillGoals.map((goal) => goal.skillGoalId).sort(),
        removedSkillGoalIds: [],
      },
      experienceHints: [...(input.experienceHints ?? [])],
      confirmationPolicy,
      riskLevel,
      planningMetadata: input.planningMetadata ?? { priorities: {}, parallelGroups: {} },
      sourceRefs: input.sourceRefs,
      createdAt: timestamp,
    });
    const session = createInteractivePlanningSessionSnapshot({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      sessionId,
      taskId: input.taskId,
      goalSessionId: input.goalSessionId,
      confirmedContractCandidateId: input.confirmedContractCandidateId,
      goalId: input.goal.goalId,
      goalVersion: input.goal.version,
      state: autoConfirm ? 'confirmed' : 'plan_review',
      version: 1,
      currentCandidateId: candidate.candidateId,
      currentCandidateRevision: candidate.revision,
      revisionCount: 1,
      maxRevisions: this.#maxRevisions,
      maxElapsedMs: this.#maxElapsedMs,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    assertPlanningCommitAllowed(input.commitFence);
    const persisted = await this.#repository.start(session, candidate, input.commitFence);
    return this.#viewAndEnsureHandoff(
      persisted.sessionId === session.sessionId ? 'started' : 'duplicate',
      persisted,
      input.contract,
    );
  }

  async getByTask(taskId: string): Promise<InteractivePlanningSessionView | undefined> {
    const session = await this.#repository.findByTask(taskId);
    return session === undefined ? undefined : this.#viewAndEnsureHandoff('duplicate', session);
  }

  async applyAction(
    input: InteractivePlanningActionInput,
  ): Promise<InteractivePlanningSessionView> {
    const duplicate = await this.#repository.findTurnByIdempotencyKey(
      input.sessionId,
      input.idempotencyKey,
    );
    if (duplicate !== undefined) {
      const session = await this.#requiredSession(input.sessionId);
      await this.#interactions?.recordInteraction(session.taskId);
      return this.#viewAndEnsureHandoff('duplicate', session);
    }
    const session = await this.#requiredSession(input.sessionId);
    if (session.version !== input.expectedVersion)
      return this.#view('conflict', session, await this.#currentCandidate(session));
    if (session.state !== 'plan_review') throw new Error('INTERACTIVE_PLANNING_SESSION_TERMINAL');
    const current = await this.#currentCandidate(session);
    const goal = await this.#goals.get(session.goalId);
    if (goal.version !== session.goalVersion) throw new Error('INTERACTIVE_PLANNING_GOAL_STALE');
    const timestamp = this.#clock.now();
    let candidate: UserGoalPlanCandidateSnapshot<UserGoalPlan> | undefined;
    let nextState: InteractivePlanningSessionSnapshot['state'] = session.state;
    let compiledPatch: unknown;
    if (input.action === 'patch') {
      if (
        session.revisionCount >= session.maxRevisions ||
        Date.parse(timestamp) - Date.parse(session.createdAt) >= session.maxElapsedMs
      ) {
        nextState = 'budget_exhausted';
      } else {
        const instruction = requiredInstruction(input.payload);
        candidate = await this.#patches.compile({
          taskId: session.taskId,
          sessionId: session.sessionId,
          contract: userGoalCompletionContractFor(goal),
          current,
          instruction,
          sourceRefs: current.sourceRefs,
        });
        compiledPatch = { candidateId: candidate.candidateId, planHash: candidate.planHash };
      }
    } else if (input.action === 'accept') {
      const validation = this.#validator.validate(
        userGoalCompletionContractFor(goal),
        current.plan,
        current.confirmationPolicy,
      );
      if (!validation.valid) throw new Error(validation.errorCodes.join(','));
      candidate = createUserGoalPlanCandidateSnapshot({
        ...current,
        status: 'confirmed',
        validation,
      });
      nextState = 'confirmed';
    } else if (input.action === 'reject') {
      candidate = createUserGoalPlanCandidateSnapshot({ ...current, status: 'rejected' });
      nextState = 'rejected';
    } else {
      nextState = 'canceled';
    }
    const nextSession = createInteractivePlanningSessionSnapshot({
      ...session,
      state: nextState,
      version: session.version + 1,
      currentCandidateId: candidate?.candidateId ?? current.candidateId,
      currentCandidateRevision: candidate?.revision ?? current.revision,
      revisionCount:
        input.action === 'patch' && candidate !== undefined
          ? session.revisionCount + 1
          : session.revisionCount,
      updatedAt: timestamp,
    });
    const turn = createInteractivePlanningTurn({
      turnId: this.#ids.nextTurnId(),
      sessionId: session.sessionId,
      ordinal: session.version,
      expectedSessionVersion: session.version,
      idempotencyKey: input.idempotencyKey,
      action: input.action,
      actorId: input.actorId,
      payload: input.payload,
      ...(compiledPatch === undefined ? {} : { compiledPatch }),
      createdAt: timestamp,
    });
    const result = await this.#repository.apply({
      expectedVersion: session.version,
      idempotencyKey: input.idempotencyKey,
      turn,
      nextSession,
      ...(candidate === undefined ? {} : { candidate }),
    });
    if (result.outcome === 'conflict')
      return this.#view('conflict', result.session, await this.#currentCandidate(result.session));
    if (this.#interactions !== undefined) {
      if (input.action === 'patch' && candidate !== undefined) {
        await this.#interactions.record(
          planCorrectionInput({ input, session, turn, current, candidate }),
        );
      } else {
        await this.#interactions.recordInteraction(session.taskId);
      }
    }
    return this.#viewAndEnsureHandoff(result.outcome, result.session);
  }

  async #plan(input: {
    taskId: string;
    userId: string;
    sessionId: string;
    candidateId: string;
    goal: Goal;
  }): Promise<ExperiencePlanningResult> {
    if (this.#experiencePlanner !== undefined) {
      return this.#experiencePlanner.plan({
        mode: this.#injectionMode,
        taskId: input.taskId,
        userId: input.userId,
        planningSessionId: input.sessionId,
        planCandidateId: input.candidateId,
        promotionPolicyVersion: 'knowledge-promotion-v1',
        goal: input.goal,
      });
    }
    const generated = await this.#planner.generateCandidate({
      goal: input.goal,
      taskId: input.taskId,
    });
    return {
      ...generated,
      mode: 'off',
      selected: 'base',
      requiresManualConfirmation: false,
      usageRecords: [],
    };
  }

  async #viewAndEnsureHandoff(
    outcome: InteractivePlanningSessionView['outcome'],
    session: InteractivePlanningSessionSnapshot,
    contract?: UserGoalCompletionContract,
  ): Promise<InteractivePlanningSessionView> {
    const candidate = await this.#currentCandidate(session);
    if (session.state === 'confirmed') {
      const goal = await this.#goals.get(session.goalId);
      if (goal.version !== session.goalVersion) throw new Error('INTERACTIVE_PLANNING_GOAL_STALE');
      await this.#handoff.commit(candidate, contract ?? userGoalCompletionContractFor(goal));
    }
    return this.#view(outcome, session, candidate);
  }

  async #requiredSession(sessionId: string): Promise<InteractivePlanningSessionSnapshot> {
    const session = await this.#repository.find(sessionId);
    if (session === undefined) throw new Error('INTERACTIVE_PLANNING_SESSION_NOT_FOUND');
    return session;
  }

  async #currentCandidate(
    session: InteractivePlanningSessionSnapshot,
  ): Promise<UserGoalPlanCandidateSnapshot<UserGoalPlan>> {
    const candidates = await this.#repository.listCandidates(session.sessionId);
    const candidate = candidates.find((item) => item.candidateId === session.currentCandidateId);
    if (candidate === undefined) throw new Error('INTERACTIVE_PLANNING_CANDIDATE_NOT_FOUND');
    return candidate;
  }

  #view(
    outcome: InteractivePlanningSessionView['outcome'],
    session: InteractivePlanningSessionSnapshot,
    candidate: UserGoalPlanCandidateSnapshot<UserGoalPlan>,
  ): InteractivePlanningSessionView {
    return { outcome, session, candidate };
  }
}

function assertPlanningCommitAllowed(commitFence: PlanningCommitFence | undefined): void {
  if (commitFence?.mayCommit() === false)
    throw new Error('INTERACTIVE_PLANNING_COMMIT_FENCE_EXPIRED');
}

function knowledgeSourceRefs(
  records: readonly ExperienceUsageRecord[],
  capturedAt: string,
): readonly CognitiveSourceRef[] {
  return records.map((record) => ({
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    sourceRefId: `source.knowledge.${record.knowledgeKind}.${record.knowledgeId}.${String(record.knowledgeRevision)}`,
    sourceKind: 'knowledge_revision',
    sourceId: record.knowledgeId,
    sourceRevision: record.knowledgeRevision,
    authority: 'promoted_knowledge',
    dataClassification: knowledgeDataClassification(record),
    capturedAt,
    contentHash: record.queryFingerprint,
  }));
}

function knowledgeDataClassification(
  record: ExperienceUsageRecord,
): CognitiveSourceRef['dataClassification'] {
  const scope = record.influence['knowledgeScope'];
  if (scope === 'user') return 'user_scoped';
  if (scope === 'global_candidate') return 'internal';
  return 'restricted';
}

function planCorrectionInput(
  input: Readonly<{
    input: InteractivePlanningActionInput;
    session: InteractivePlanningSessionSnapshot;
    turn: ReturnType<typeof createInteractivePlanningTurn>;
    current: UserGoalPlanCandidateSnapshot<UserGoalPlan>;
    candidate: UserGoalPlanCandidateSnapshot<UserGoalPlan>;
  }>,
): PlanningCorrectionRecordInput {
  const patch = derivePlanPatch(input.current, input.candidate);
  return {
    taskId: input.session.taskId,
    goalId: input.session.goalId,
    goalVersion: input.session.goalVersion,
    sessionId: input.session.sessionId,
    turnId: input.turn.turnId,
    idempotencyKey: `plan:${input.session.sessionId}:${input.input.idempotencyKey}`,
    actorId: input.input.actorId,
    target: 'skill_goal_plan',
    correctionType: planCorrectionType(patch),
    ...correctionScope(input.input),
    beforeSnapshot: jsonObject(input.current.plan),
    userInstruction: requiredInstruction(input.input.payload),
    structuredPatch: patch,
    afterSnapshot: jsonObject(input.candidate.plan),
    validation: jsonObject(input.candidate.validation),
    accepted: true,
    ...preferenceCategory(input.input.payload),
    sourceRefs: input.candidate.sourceRefs,
  };
}

function derivePlanPatch(
  before: UserGoalPlanCandidateSnapshot<UserGoalPlan>,
  after: UserGoalPlanCandidateSnapshot<UserGoalPlan>,
): Readonly<Record<string, unknown>> {
  const beforeGoals = new Map(before.plan.skillGoals.map((goal) => [goal.skillGoalId, goal]));
  const afterGoals = new Map(after.plan.skillGoals.map((goal) => [goal.skillGoalId, goal]));
  const addedSkillGoals = after.plan.skillGoals.filter(
    (goal) => !beforeGoals.has(goal.skillGoalId),
  );
  const removedSkillGoalIds = before.plan.skillGoals
    .filter((goal) => !afterGoals.has(goal.skillGoalId))
    .map((goal) => goal.skillGoalId);
  const updatedSkillGoals = after.plan.skillGoals.filter((goal) => {
    const prior = beforeGoals.get(goal.skillGoalId);
    return prior !== undefined && JSON.stringify(prior) !== JSON.stringify(goal);
  });
  return {
    addedSkillGoals,
    removedSkillGoalIds,
    updatedSkillGoals,
    dependencies: after.plan.dependencies,
    priorities: after.planningMetadata.priorities,
    parallelGroups: after.planningMetadata.parallelGroups,
    confirmationPolicy: after.confirmationPolicy,
    changedFields: after.diff.changedFields,
  };
}

function planCorrectionType(patch: Readonly<Record<string, unknown>>): PlanningCorrectionType {
  if (Array.isArray(patch['removedSkillGoalIds']) && patch['removedSkillGoalIds'].length > 0) {
    return 'unnecessary_goal';
  }
  if (
    (Array.isArray(patch['addedSkillGoals']) && patch['addedSkillGoals'].length > 0) ||
    (Array.isArray(patch['updatedSkillGoals']) && patch['updatedSkillGoals'].length > 0)
  ) {
    return 'wrong_decomposition';
  }
  const changed = Array.isArray(patch['changedFields']) ? patch['changedFields'] : [];
  if (changed.includes('dependencies')) return 'wrong_dependency';
  if (changed.includes('planningMetadata')) {
    const groups = patch['parallelGroups'];
    return typeof groups === 'object' && groups !== null && Object.keys(groups).length > 0
      ? 'parallelism_correction'
      : 'wrong_priority';
  }
  return 'wrong_priority';
}

function correctionScope(input: InteractivePlanningActionInput) {
  const value = input.payload['correctionScope'];
  const scope =
    value === 'user' || value === 'tenant' || value === 'global_candidate' ? value : 'task';
  if (scope === 'user') {
    const userId = input.payload['userId'];
    return {
      scope,
      userId: typeof userId === 'string' && userId.trim() !== '' ? userId : input.actorId,
    } as const;
  }
  if (scope === 'tenant') {
    const tenantId = input.payload['tenantId'];
    if (typeof tenantId !== 'string' || tenantId.trim() === '') {
      throw new Error('PLANNING_CORRECTION_TENANT_ID_REQUIRED');
    }
    return { scope, tenantId: tenantId.trim() } as const;
  }
  return { scope } as const;
}

function preferenceCategory(payload: Readonly<Record<string, unknown>>): Readonly<{
  preferenceCategory?: PlanningPreferenceCategory;
}> {
  const value = payload['preferenceCategory'];
  return value === 'display' ||
    value === 'interaction' ||
    value === 'report_format' ||
    value === 'detailed_plan' ||
    value === 'parallel_explanation' ||
    value === 'time_expression' ||
    value === 'language'
    ? { preferenceCategory: value }
    : {};
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('PLANNING_CORRECTION_SNAPSHOT_INVALID');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function requiredInstruction(payload: Readonly<Record<string, unknown>>): string {
  const instruction = payload['instruction'];
  if (typeof instruction !== 'string' || instruction.trim() === '')
    throw new Error('INTERACTIVE_PLAN_PATCH_INSTRUCTION_REQUIRED');
  return instruction;
}

function shouldAutoConfirm(policy: PlanConfirmationPolicy, risk: 'low' | 'high'): boolean {
  return risk === 'low' && (policy === 'manual_risky' || policy === 'auto_validated');
}
