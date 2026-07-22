import { createHash } from 'node:crypto';

import type {
  OutcomeDecision,
  GoalCancellationRecord,
  RuntimeAchievedOutcomeInput,
  RuntimeCanceledOutcomeInput,
  RuntimeEnhancementWarning,
  RuntimeTerminalOutcomeRecord,
  RuntimeUnachievableOutcomeInput,
  SkillAttempt,
  SkillGoal,
  TaskGoalCompletionContract,
  UserGoalCompletionContract,
  UserGoalPlan,
  WorkflowExecutionOutcome,
  RuntimeLayeredOutcomeCommit,
} from '../../domain/src/index.js';
import {
  createCompletedEffect,
  USER_GOAL_PLAN_TERMINAL_AUTHORITY,
} from '../../domain/src/index.js';

import type { RuntimeTerminalOutcomeRepository } from './ports.js';
import type { GoalCancellationRepository } from './ports.js';
import { SkillGoalJudge, TaskGoalJudge, UserGoalJudge } from './outcome-judges.js';

export interface UserGoalOutcomeContext {
  readonly plan: UserGoalPlan;
  readonly contract: UserGoalCompletionContract;
  readonly skillGoal: SkillGoal;
  readonly attempt: SkillAttempt;
}

export interface UserGoalOutcomeRepository {
  findOutcomeContext(
    workflowPlanId: string,
    agentTaskId: string,
  ): Promise<UserGoalOutcomeContext | undefined>;
  listSkillGoalOutcomeDecisions(planId: string): Promise<readonly OutcomeDecision[]>;
  commitWorkingOutcome(layered: RuntimeLayeredOutcomeCommit, updatedAt: string): Promise<void>;
}

export interface UserGoalWorkingResult {
  readonly disposition: 'working';
  readonly userGoalPlanId: string;
  readonly skillGoalId: string;
  readonly skillAttemptId: string;
}

type AchievedCandidate = Omit<RuntimeAchievedOutcomeInput, 'authority' | 'layeredOutcome'> &
  Readonly<{ workflowOutcome: WorkflowExecutionOutcome }>;
type UnachievableCandidate = Omit<RuntimeUnachievableOutcomeInput, 'authority' | 'layeredOutcome'> &
  Readonly<{ workflowOutcome: WorkflowExecutionOutcome }>;
type CanceledCandidate = Omit<RuntimeCanceledOutcomeInput, 'authority'>;

/** The sole application authority allowed to commit an AgentTask/User Goal terminal projection. */
export class UserGoalPlanController {
  readonly #terminal: RuntimeTerminalOutcomeRepository;
  readonly #outcomes: UserGoalOutcomeRepository | undefined;
  readonly #goalCancellations: Pick<GoalCancellationRepository, 'cancel'> | undefined;

  constructor(
    dependencies: Readonly<{
      terminal: RuntimeTerminalOutcomeRepository;
      outcomes?: UserGoalOutcomeRepository;
      goalCancellations?: Pick<GoalCancellationRepository, 'cancel'>;
    }>,
  ) {
    this.#terminal = dependencies.terminal;
    this.#outcomes = dependencies.outcomes;
    this.#goalCancellations = dependencies.goalCancellations;
  }

  async adjudicateAchieved(
    input: AchievedCandidate,
  ): Promise<RuntimeTerminalOutcomeRecord | UserGoalWorkingResult> {
    const layeredOutcome = await this.#judge(input, true);
    if (layeredOutcome !== undefined && layeredOutcome.userDecision.status !== 'achieved') {
      if (this.#outcomes === undefined) throw new Error('USER_GOAL_OUTCOME_REPOSITORY_UNAVAILABLE');
      await this.#outcomes.commitWorkingOutcome(layeredOutcome, input.committedAt);
      return {
        disposition: 'working',
        userGoalPlanId: layeredOutcome.userGoalPlanId,
        skillGoalId: layeredOutcome.skillGoalId,
        skillAttemptId: layeredOutcome.skillAttemptId,
      };
    }
    const outcome = await this.#terminal.commitAchieved({
      ...withoutWorkflowOutcome(input),
      authority: USER_GOAL_PLAN_TERMINAL_AUTHORITY,
      ...(layeredOutcome === undefined ? {} : { layeredOutcome }),
    });
    return outcome;
  }

  adjudicateUnachievable(
    input: UnachievableCandidate,
  ): Promise<RuntimeTerminalOutcomeRecord | UserGoalWorkingResult> {
    return this.#adjudicateUnachievable(input);
  }

  adjudicateCancellation(input: CanceledCandidate): Promise<RuntimeTerminalOutcomeRecord> {
    return this.#terminal.commitCanceled({
      ...input,
      authority: USER_GOAL_PLAN_TERMINAL_AUTHORITY,
    });
  }

  appendEnhancementWarning(outcomeId: string, warning: RuntimeEnhancementWarning): Promise<void> {
    return this.#terminal.recordEnhancementWarning(outcomeId, warning);
  }

  cancelGoal(
    input: Omit<
      GoalCancellationRecord,
      'canceledTaskIds' | 'invalidatedPlanIds' | 'canceledInstanceIds'
    >,
  ): Promise<GoalCancellationRecord> {
    if (this.#goalCancellations === undefined)
      throw new Error('USER_GOAL_PLAN_CANCELLATION_AUTHORITY_UNAVAILABLE');
    return this.#goalCancellations.cancel(input);
  }

  async #judge(
    input: AchievedCandidate | UnachievableCandidate,
    semanticAchieved: boolean,
  ): Promise<RuntimeLayeredOutcomeCommit | undefined> {
    if (this.#outcomes === undefined || input.taskId === undefined) return undefined;
    const context = await this.#outcomes.findOutcomeContext(input.round.planId, input.taskId);
    if (context === undefined) return undefined;
    const createdAt = input.round.createdAt;
    const taskContract: TaskGoalCompletionContract = {
      schemaVersion: '1.0',
      taskGoalContractId: stableId('task-goal-contract', context.attempt.attemptId),
      planId: context.plan.planId,
      skillGoalId: context.skillGoal.skillGoalId,
      attemptId: context.attempt.attemptId,
      agentTaskId: input.taskId,
      requiredEffectRefs: context.skillGoal.requiredEffectRefs,
      evidenceRequirements: context.skillGoal.evidenceRequirements,
      artifactRequirements: context.skillGoal.artifactRequirements,
    };
    const workflow: WorkflowExecutionOutcome = semanticAchieved
      ? input.workflowOutcome
      : { ...input.workflowOutcome, confidence: 'low' };
    const ids = {
      next: (level: OutcomeDecision['level'], subjectId: string) =>
        stableId(
          `${level}-decision`,
          `${input.controlId}:${String(input.round.roundIndex)}:${subjectId}`,
        ),
    };
    const taskDecision = new TaskGoalJudge({ ids, now: () => createdAt }).judge(
      taskContract,
      workflow,
    );
    const skillDecision = new SkillGoalJudge({ ids, now: () => createdAt }).judge(
      context.skillGoal,
      [taskDecision],
      workflow,
    );
    const prior = await this.#outcomes.listSkillGoalOutcomeDecisions(context.plan.planId);
    const userDecision = new UserGoalJudge({ ids, now: () => createdAt }).judge(context.contract, [
      ...prior.filter((item) => item.subjectId !== skillDecision.subjectId),
      skillDecision,
    ]);
    return {
      userGoalPlanId: context.plan.planId,
      taskGoalContract: taskContract,
      taskGoalContractHash: hashJson(taskContract),
      taskDecision,
      skillDecision,
      userDecision,
      skillAttemptId: context.attempt.attemptId,
      skillGoalId: context.skillGoal.skillGoalId,
      completedEffects:
        skillDecision.status !== 'achieved'
          ? []
          : skillDecision.effectRefs.map((effectRef) =>
              createCompletedEffect({
                completedEffectId: stableId(
                  'completed-effect',
                  `${input.controlId}:${String(input.round.roundIndex)}:${effectRef}`,
                ),
                goalId: context.plan.goalId,
                planId: context.plan.planId,
                skillGoalId: context.skillGoal.skillGoalId,
                status: 'verified',
                effectFingerprint: hashJson({
                  schemaVersion: '1.0',
                  goalId: context.plan.goalId,
                  effectRef,
                }),
                evidenceRefs: skillDecision.evidenceRefs,
                createdAt,
              }),
            ),
    };
  }

  async #adjudicateUnachievable(
    input: UnachievableCandidate,
  ): Promise<RuntimeTerminalOutcomeRecord | UserGoalWorkingResult> {
    const layeredOutcome = await this.#judge(input, false);
    if (
      layeredOutcome !== undefined &&
      layeredOutcome.userDecision.status !== 'achieved' &&
      input.controlStatus !== 'replan_budget_exhausted'
    ) {
      if (this.#outcomes === undefined) throw new Error('USER_GOAL_OUTCOME_REPOSITORY_UNAVAILABLE');
      await this.#outcomes.commitWorkingOutcome(layeredOutcome, input.committedAt);
      return {
        disposition: 'working',
        userGoalPlanId: layeredOutcome.userGoalPlanId,
        skillGoalId: layeredOutcome.skillGoalId,
        skillAttemptId: layeredOutcome.skillAttemptId,
      };
    }
    const outcome = await this.#terminal.commitUnachievable({
      ...withoutWorkflowOutcome(input),
      authority: USER_GOAL_PLAN_TERMINAL_AUTHORITY,
      ...(layeredOutcome === undefined ? {} : { layeredOutcome }),
    });
    return outcome;
  }
}

function withoutWorkflowOutcome<T extends Readonly<{ workflowOutcome: WorkflowExecutionOutcome }>>(
  input: T,
): Omit<T, 'workflowOutcome'> {
  const { workflowOutcome: _workflowOutcome, ...terminalInput } = input;
  void _workflowOutcome;
  return terminalInput;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}.${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
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
