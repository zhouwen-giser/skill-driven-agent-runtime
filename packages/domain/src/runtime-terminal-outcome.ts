import type { ProcessedResultRecord } from './processed-result.js';
import type {
  CompletedEffect,
  OutcomeDecision,
  TaskGoalCompletionContract,
} from './user-goal-runtime.js';
import type { WorkflowControlRound, WorkflowControlStatus } from './workflow-control.js';

export const USER_GOAL_PLAN_TERMINAL_AUTHORITY = 'user_goal_plan_controller' as const;

export interface RuntimeLayeredOutcomeCommit {
  readonly userGoalPlanId: string;
  readonly taskGoalContract: TaskGoalCompletionContract;
  readonly taskGoalContractHash: string;
  readonly taskDecision: OutcomeDecision;
  readonly skillDecision: OutcomeDecision;
  readonly userDecision: OutcomeDecision;
  readonly skillAttemptId: string;
  readonly skillGoalId: string;
  readonly completedEffects: readonly CompletedEffect[];
}

export type RuntimeTerminalOutcomeKind = 'achieved' | 'unachievable' | 'canceled';

export type RuntimeTerminalControlStatus = Extract<
  WorkflowControlStatus,
  'achieved' | 'unachievable' | 'replan_budget_exhausted' | 'canceled'
>;

export interface RuntimeEnhancementWarning {
  readonly source:
    | 'result_memory'
    | 'task_quality'
    | 'evolution_experience'
    | 'evaluation_memory'
    | 'temporary_skill'
    | 'skill_evolution';
  readonly code: string;
  readonly message: string;
  readonly occurredAt: string;
}

/** Immutable authority proven before an achieved terminal commit. */
export interface RuntimeTaskCapabilityTerminalProof {
  readonly taskId: string;
  readonly bindingId: string;
  readonly bindingHash: string;
  readonly attemptId: string;
  readonly requestedCapabilityId: string;
  readonly capabilityVersion: number;
}

export interface RuntimeTerminalOutcomeRecord {
  readonly outcomeId: string;
  readonly kind: RuntimeTerminalOutcomeKind;
  readonly taskId?: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly controlId: string;
  readonly controlStatus: RuntimeTerminalControlStatus;
  readonly roundIndex?: number;
  readonly finalInstanceId?: string;
  readonly resultId?: string;
  readonly capabilityAttemptId?: string;
  readonly summary: string;
  readonly authority?: typeof USER_GOAL_PLAN_TERMINAL_AUTHORITY;
  readonly enhancementWarnings: readonly RuntimeEnhancementWarning[];
  readonly committedAt: string;
}

export interface RuntimeAchievedOutcomeInput {
  readonly outcomeId: string;
  readonly taskId?: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly controlId: string;
  readonly round: WorkflowControlRound;
  readonly processedResult?: ProcessedResultRecord;
  readonly capabilityTerminalProof?: RuntimeTaskCapabilityTerminalProof;
  readonly summary: string;
  readonly authority?: typeof USER_GOAL_PLAN_TERMINAL_AUTHORITY;
  readonly layeredOutcome?: RuntimeLayeredOutcomeCommit;
  readonly eventId?: string;
  readonly committedAt: string;
}

export interface RuntimeUnachievableOutcomeInput {
  readonly outcomeId: string;
  readonly taskId?: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly controlId: string;
  readonly controlStatus: Extract<
    RuntimeTerminalControlStatus,
    'unachievable' | 'replan_budget_exhausted'
  >;
  readonly round: WorkflowControlRound;
  readonly summary: string;
  readonly authority?: typeof USER_GOAL_PLAN_TERMINAL_AUTHORITY;
  readonly layeredOutcome?: RuntimeLayeredOutcomeCommit;
  readonly eventId?: string;
  readonly committedAt: string;
}

export interface RuntimeCanceledOutcomeInput {
  readonly outcomeId: string;
  readonly taskId?: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly controlId: string;
  readonly round?: WorkflowControlRound;
  readonly finalInstanceId?: string;
  readonly summary: string;
  readonly authority?: typeof USER_GOAL_PLAN_TERMINAL_AUTHORITY;
  readonly eventId?: string;
  readonly committedAt: string;
}
