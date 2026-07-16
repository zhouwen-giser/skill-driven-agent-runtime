import type { ProcessedResultRecord } from './processed-result.js';
import type { WorkflowControlRound, WorkflowControlStatus } from './workflow-control.js';

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
  readonly summary: string;
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
  readonly summary: string;
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
  readonly eventId?: string;
  readonly committedAt: string;
}
