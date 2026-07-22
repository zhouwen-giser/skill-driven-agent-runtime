import {
  COGNITIVE_SCHEMA_VERSION,
  createInteractivePlanningSessionSnapshot,
  createInteractivePlanningTurn,
  createUserGoalPlanCandidateSnapshot,
  type CognitiveSourceRef,
  type Goal,
  type InteractivePlanningAction,
  type InteractivePlanningSessionSnapshot,
  type PlanConfirmationPolicy,
  type UserGoalPlan,
  type UserGoalPlanCandidateSnapshot,
} from '../../../domain/src/index.js';
import {
  userGoalCompletionContractFor,
  type UserGoalPlanningService,
} from '../user-goal-planning.js';
import type { ConfirmedPlanHandoff } from './confirmed-plan-handoff.js';
import type { InteractivePlanPatchService } from './interactive-plan-patch-service.js';
import type { InteractivePlanningMutationResult, InteractivePlanningRepository } from './ports.js';
import type { UserGoalPlanCandidateValidator } from './user-goal-plan-candidate-validator.js';

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

export class InteractivePlanningSessionService {
  readonly #repository: InteractivePlanningRepository;
  readonly #planner: Pick<UserGoalPlanningService, 'generateCandidate'>;
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

  constructor(
    dependencies: Readonly<{
      repository: InteractivePlanningRepository;
      planner: Pick<UserGoalPlanningService, 'generateCandidate'>;
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
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#planner = dependencies.planner;
    this.#patches = dependencies.patches;
    this.#validator = dependencies.validator;
    this.#handoff = dependencies.handoff;
    this.#goals = dependencies.goals;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#maxRevisions = dependencies.maxRevisions;
    this.#maxElapsedMs = dependencies.maxElapsedMs;
    this.#defaultConfirmationPolicy = dependencies.defaultConfirmationPolicy ?? 'manual_all';
  }

  async start(
    input: Readonly<{
      taskId: string;
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
    const generated = await this.#planner.generateCandidate({ goal: input.goal });
    const validation = this.#validator.validate(
      generated.contract,
      generated.plan,
      this.#defaultConfirmationPolicy,
    );
    if (!validation.valid) throw new Error(validation.errorCodes.join(','));
    const riskLevel = this.#validator.riskLevel(generated.plan);
    const autoConfirm = shouldAutoConfirm(this.#defaultConfirmationPolicy, riskLevel);
    const candidate = createUserGoalPlanCandidateSnapshot({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      candidateId: this.#ids.nextCandidateId(),
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
      experienceHints: input.experienceHints ?? [],
      confirmationPolicy: this.#defaultConfirmationPolicy,
      riskLevel,
      planningMetadata: { priorities: {}, parallelGroups: {} },
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
    const persisted = await this.#repository.start(session, candidate);
    return this.#viewAndEnsureHandoff(
      persisted.sessionId === session.sessionId ? 'started' : 'duplicate',
      persisted,
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
    if (duplicate !== undefined)
      return this.#viewAndEnsureHandoff('duplicate', await this.#requiredSession(input.sessionId));
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
      if (!current.validation.valid) throw new Error('PLAN_CANDIDATE_VALIDATION_REQUIRED');
      candidate = createUserGoalPlanCandidateSnapshot({ ...current, status: 'confirmed' });
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
    return this.#viewAndEnsureHandoff(result.outcome, result.session);
  }

  async #viewAndEnsureHandoff(
    outcome: InteractivePlanningSessionView['outcome'],
    session: InteractivePlanningSessionSnapshot,
  ): Promise<InteractivePlanningSessionView> {
    const candidate = await this.#currentCandidate(session);
    if (session.state === 'confirmed') {
      const goal = await this.#goals.get(session.goalId);
      if (goal.version !== session.goalVersion) throw new Error('INTERACTIVE_PLANNING_GOAL_STALE');
      await this.#handoff.commit(candidate, userGoalCompletionContractFor(goal));
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

function requiredInstruction(payload: Readonly<Record<string, unknown>>): string {
  const instruction = payload['instruction'];
  if (typeof instruction !== 'string' || instruction.trim() === '')
    throw new Error('INTERACTIVE_PLAN_PATCH_INSTRUCTION_REQUIRED');
  return instruction;
}

function shouldAutoConfirm(policy: PlanConfirmationPolicy, risk: 'low' | 'high'): boolean {
  return risk === 'low' && (policy === 'manual_risky' || policy === 'auto_validated');
}
