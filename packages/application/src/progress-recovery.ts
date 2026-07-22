import { createHash } from 'node:crypto';

import {
  createProgressObservation,
  createRecoveryDecision,
  type ProgressClass,
  type ProgressObservation,
  type ProgressVector,
  type RecoveryDecision,
  type CompletedEffect,
  type OutcomeDecision,
  type SkillAttempt,
  type SkillGoal,
  type UserGoalCompletionContract,
  type UserGoalPlan,
  type WorkflowExecutionOutcome,
} from '../../domain/src/index.js';

export interface ProgressDetectorIds {
  nextProgressObservationId(): string;
}

export class ProgressDetector {
  readonly #ids: ProgressDetectorIds;
  readonly #now: () => string;

  constructor(dependencies: Readonly<{ ids: ProgressDetectorIds; now: () => string }>) {
    this.#ids = dependencies.ids;
    this.#now = dependencies.now;
  }

  observe(planId: string, current: ProgressVector, previous?: ProgressVector): ProgressObservation {
    return createProgressObservation({
      progressObservationId: this.#ids.nextProgressObservationId(),
      planId,
      classification: classifyProgress(current, previous),
      vector: current,
      observedAt: this.#now(),
    });
  }
}

export function classifyProgress(
  current: ProgressVector,
  previous?: ProgressVector,
): ProgressClass {
  if (
    current.requiredCriterionCount > 0 &&
    current.satisfiedCriterionRefs.length >= current.requiredCriterionCount
  )
    return 'complete';
  if (
    current.invalidatedEffectRefs.length > 0 ||
    (previous !== undefined &&
      (current.uncertainty > previous.uncertainty ||
        lostAny(previous.satisfiedCriterionRefs, current.satisfiedCriterionRefs) ||
        lostAny(previous.effectRefs, current.effectRefs) ||
        lostAny(previous.evidenceRefs, current.evidenceRefs) ||
        lostAny(previous.artifactRefs, current.artifactRefs)))
  )
    return 'regressing';
  if (
    previous === undefined
      ? hasSubstantiveProgress(current)
      : current.uncertainty < previous.uncertainty ||
        addedAny(previous.satisfiedCriterionRefs, current.satisfiedCriterionRefs) ||
        addedAny(previous.effectRefs, current.effectRefs) ||
        addedAny(previous.evidenceRefs, current.evidenceRefs) ||
        addedAny(previous.artifactRefs, current.artifactRefs)
  )
    return 'progressing';
  return 'stalled';
}

export interface RecoveryAdmissionSnapshot {
  readonly userGoalAchieved: boolean;
  readonly skillGoalAchieved: boolean;
  readonly taskGoalAchieved: boolean;
  readonly uncertainRemoteTask: boolean;
  readonly inputRequired: boolean;
  readonly proposedStrategyFingerprint: string;
  readonly replayFingerprint?: string;
  readonly forbiddenReplayFingerprints: readonly string[];
  readonly changedStrategyAction?: Extract<
    RecoveryDecision['action'],
    'replacement_attempt' | 'revise_plan'
  >;
}

export interface RecoveryEvidenceRepository {
  saveProgressAndDecision(
    observation: ProgressObservation,
    decision: RecoveryDecision,
  ): Promise<void>;
}

export class RecoveryCoordinator {
  readonly #repository: RecoveryEvidenceRepository;
  readonly #ids: Readonly<{
    nextProgressObservationId(): string;
    nextRecoveryDecisionId(): string;
  }>;
  readonly #now: () => string;

  constructor(
    dependencies: Readonly<{
      repository: RecoveryEvidenceRepository;
      ids: Readonly<{
        nextProgressObservationId(): string;
        nextRecoveryDecisionId(): string;
      }>;
      now: () => string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#ids = dependencies.ids;
    this.#now = dependencies.now;
  }

  async coordinate(
    identity: Readonly<{ planId: string; skillGoalId?: string; attemptId?: string }>,
    current: ProgressVector,
    admission: RecoveryAdmissionSnapshot,
    previous?: ProgressVector,
  ): Promise<Readonly<{ observation: ProgressObservation; decision: RecoveryDecision }>> {
    const observation = new ProgressDetector({ ids: this.#ids, now: this.#now }).observe(
      identity.planId,
      current,
      previous,
    );
    const selected = selectRecovery(observation, admission);
    const decision = createRecoveryDecision({
      recoveryDecisionId: this.#ids.nextRecoveryDecisionId(),
      planId: identity.planId,
      ...(identity.skillGoalId === undefined ? {} : { skillGoalId: identity.skillGoalId }),
      ...(identity.attemptId === undefined ? {} : { attemptId: identity.attemptId }),
      ...selected,
      strategyFingerprint: admission.proposedStrategyFingerprint,
      createdAt: this.#now(),
    });
    await this.#repository.saveProgressAndDecision(observation, decision);
    return { observation, decision };
  }
}

export interface UserGoalRecoveryContext {
  readonly plan: UserGoalPlan;
  readonly contract: UserGoalCompletionContract;
  readonly skillGoal: SkillGoal;
  readonly attempt: SkillAttempt;
}

export interface UserGoalRecoveryRepository extends RecoveryEvidenceRepository {
  findOutcomeContext(
    workflowPlanId: string,
    agentTaskId: string,
  ): Promise<UserGoalRecoveryContext | undefined>;
  findLatestProgress(planId: string): Promise<ProgressObservation | undefined>;
  listSkillGoalOutcomeDecisions(planId: string): Promise<readonly OutcomeDecision[]>;
  listValidCompletedEffects(goalId: string): Promise<readonly CompletedEffect[]>;
  supersedeAttemptForRecovery(
    planId: string,
    skillGoalId: string,
    attemptId: string,
    updatedAt: string,
  ): Promise<void>;
}

/** One application entry point for runtime recovery admission and durable recovery effects. */
export class UserGoalRecoveryService {
  readonly #repository: UserGoalRecoveryRepository;
  readonly #coordinator: RecoveryCoordinator;
  readonly #now: () => string;
  readonly #taskAttemptLimit: number;

  constructor(
    dependencies: Readonly<{
      repository: UserGoalRecoveryRepository;
      ids: Readonly<{
        nextProgressObservationId(): string;
        nextRecoveryDecisionId(): string;
      }>;
      now: () => string;
      taskAttemptLimit?: number;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#coordinator = new RecoveryCoordinator(dependencies);
    this.#now = dependencies.now;
    this.#taskAttemptLimit = dependencies.taskAttemptLimit ?? 4;
  }

  async recoverWorkflow(
    input: Readonly<{
      workflowPlanId: string;
      agentTaskId: string;
      workflowOutcome: WorkflowExecutionOutcome;
      workflowRemainingBudget: number;
      taskAttemptsConsumed: number;
      inputRequired?: boolean;
      uncertainRemoteTask?: boolean;
      recoveryAction: string;
      changedStrategyAction?: Extract<
        RecoveryDecision['action'],
        'replacement_attempt' | 'revise_plan'
      >;
    }>,
  ): Promise<RecoveryDecision | undefined> {
    const context = await this.#repository.findOutcomeContext(
      input.workflowPlanId,
      input.agentTaskId,
    );
    if (context === undefined) return undefined;
    const [prior, effects, previous] = await Promise.all([
      this.#repository.listSkillGoalOutcomeDecisions(context.plan.planId),
      this.#repository.listValidCompletedEffects(context.plan.goalId),
      this.#repository.findLatestProgress(context.plan.planId),
    ]);
    const current = progressVectorForRecovery({
      context,
      prior,
      effects,
      workflowOutcome: input.workflowOutcome,
      workflowRemainingBudget: input.workflowRemainingBudget,
      taskRemainingBudget: Math.max(0, this.#taskAttemptLimit - input.taskAttemptsConsumed),
    });
    const proposedStrategyFingerprint = hashJson({
      schemaVersion: '1.0',
      planRevision: context.plan.revision,
      skillGoalId: context.skillGoal.skillGoalId,
      skillAttemptId: context.attempt.attemptId,
      priorStrategyFingerprint: context.attempt.strategyFingerprint,
      workflowPlanId: input.workflowPlanId,
      recoveryAction: input.recoveryAction,
      remainingEffectTargets: context.skillGoal.requiredEffectRefs.filter(
        (ref) => !current.effectRefs.includes(ref),
      ),
    });
    const coordinated = await this.#coordinator.coordinate(
      {
        planId: context.plan.planId,
        skillGoalId: context.skillGoal.skillGoalId,
        attemptId: context.attempt.attemptId,
      },
      current,
      {
        userGoalAchieved: context.plan.status === 'completed',
        skillGoalAchieved: context.skillGoal.status === 'achieved',
        taskGoalAchieved: false,
        uncertainRemoteTask: input.uncertainRemoteTask ?? false,
        inputRequired: input.inputRequired ?? false,
        proposedStrategyFingerprint,
        forbiddenReplayFingerprints: context.plan.forbiddenReplayFingerprints,
        ...(input.changedStrategyAction === undefined
          ? {}
          : { changedStrategyAction: input.changedStrategyAction }),
      },
      previous?.vector,
    );
    if (coordinated.decision.action === 'replacement_attempt')
      await this.#repository.supersedeAttemptForRecovery(
        context.plan.planId,
        context.skillGoal.skillGoalId,
        context.attempt.attemptId,
        this.#now(),
      );
    return coordinated.decision;
  }
}

function selectRecovery(
  observation: ProgressObservation,
  admission: RecoveryAdmissionSnapshot,
): Pick<RecoveryDecision, 'action' | 'reasonCode'> {
  if (admission.userGoalAchieved)
    return { action: 'no_action', reasonCode: 'USER_GOAL_ALREADY_ACHIEVED' };
  if (admission.skillGoalAchieved)
    return { action: 'no_action', reasonCode: 'SKILL_GOAL_ALREADY_ACHIEVED' };
  if (admission.taskGoalAchieved)
    return { action: 'no_action', reasonCode: 'TASK_GOAL_ALREADY_ACHIEVED_NO_REPLAY' };
  if (admission.uncertainRemoteTask)
    return { action: 'reconcile_remote_task', reasonCode: 'REMOTE_TASK_TERMINAL_UNCERTAIN' };
  if (admission.inputRequired)
    return { action: 'request_input', reasonCode: 'RECOVERY_INPUT_REQUIRED' };
  if (
    admission.replayFingerprint !== undefined &&
    admission.forbiddenReplayFingerprints.includes(admission.replayFingerprint)
  )
    return observation.vector.remainingBudget.plan > 0
      ? { action: 'revise_plan', reasonCode: 'FORBIDDEN_EFFECT_REPLAY' }
      : { action: 'fail_goal', reasonCode: 'FORBIDDEN_EFFECT_REPLAY_PLAN_BUDGET_EXHAUSTED' };
  if (Object.values(observation.vector.remainingBudget).some((remaining) => remaining <= 0))
    return { action: 'fail_goal', reasonCode: 'RECOVERY_BUDGET_EXHAUSTED' };
  if (observation.classification === 'regressing')
    return { action: 'revise_plan', reasonCode: 'PROGRESS_REGRESSING' };
  if (observation.classification === 'stalled')
    return observation.vector.strategyFingerprint === admission.proposedStrategyFingerprint
      ? { action: 'revise_plan', reasonCode: 'STALLED_SAME_STRATEGY_FORBIDDEN' }
      : {
          action: admission.changedStrategyAction ?? 'replacement_attempt',
          reasonCode: 'STALLED_CHANGED_STRATEGY',
        };
  return { action: 'no_action', reasonCode: 'PROGRESS_CONTINUES' };
}

function hasSubstantiveProgress(vector: ProgressVector): boolean {
  return (
    vector.satisfiedCriterionRefs.length > 0 ||
    vector.effectRefs.length > 0 ||
    vector.evidenceRefs.length > 0 ||
    vector.artifactRefs.length > 0 ||
    vector.uncertainty < 1
  );
}

function addedAny(previous: readonly string[], current: readonly string[]): boolean {
  const prior = new Set(previous);
  return current.some((value) => !prior.has(value));
}

function lostAny(previous: readonly string[], current: readonly string[]): boolean {
  const next = new Set(current);
  return previous.some((value) => !next.has(value));
}

function progressVectorForRecovery(
  input: Readonly<{
    context: UserGoalRecoveryContext;
    prior: readonly OutcomeDecision[];
    effects: readonly CompletedEffect[];
    workflowOutcome: WorkflowExecutionOutcome;
    workflowRemainingBudget: number;
    taskRemainingBudget: number;
  }>,
): ProgressVector {
  const achieved = input.prior.filter((decision) => decision.status === 'achieved');
  const validEffectRefs = input.effects.flatMap((effect) => [...effect.evidenceRefs]);
  const hasCurrentEvidence =
    input.workflowOutcome.effectRefs.length > 0 ||
    input.workflowOutcome.evidenceRefs.length > 0 ||
    input.workflowOutcome.artifactRefs.length > 0;
  return {
    requiredCriterionCount: input.context.contract.criteria.filter(
      (criterion) => criterion.required,
    ).length,
    satisfiedCriterionRefs: unique(achieved.flatMap((decision) => decision.criterionRefs)),
    effectRefs: unique([
      ...achieved.flatMap((decision) => decision.effectRefs),
      ...input.workflowOutcome.effectRefs,
    ]),
    evidenceRefs: unique([
      ...achieved.flatMap((decision) => decision.evidenceRefs),
      ...validEffectRefs,
      ...input.workflowOutcome.evidenceRefs,
    ]),
    artifactRefs: unique([
      ...achieved.flatMap((decision) => decision.artifactRefs),
      ...input.workflowOutcome.artifactRefs,
    ]),
    invalidatedEffectRefs: [],
    uncertainty: hasCurrentEvidence ? (input.workflowOutcome.confidence === 'high' ? 0 : 0.5) : 1,
    attemptOrdinal: input.context.attempt.ordinal,
    planRevision: input.context.plan.revision,
    strategyFingerprint: input.context.attempt.strategyFingerprint,
    remainingBudget: {
      task: input.taskRemainingBudget,
      workflow: Math.max(0, input.workflowRemainingBudget),
      attempt: Math.max(
        0,
        input.context.attempt.budget.maxAttempts - input.context.attempt.ordinal,
      ),
      plan: Math.max(
        0,
        input.context.contract.policy.maxPlanRevisions - input.context.plan.revision,
      ),
    },
  };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}
