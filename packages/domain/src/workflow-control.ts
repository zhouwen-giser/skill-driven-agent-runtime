export type GoalEvaluationDecision = 'achieved' | 'replan' | 'unachievable';

export interface GoalEvaluationResult {
  readonly decision: GoalEvaluationDecision;
  readonly summary: string;
  readonly replanInstruction?: string;
}

export type WorkflowControlStatus =
  | 'running'
  | 'awaiting_confirmation'
  | 'achieved'
  | 'unachievable'
  | 'failed'
  | 'replan_budget_exhausted';

export interface WorkflowControlRecord {
  readonly controlId: string;
  readonly contextId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly status: WorkflowControlStatus;
  readonly currentPlanId: string;
  readonly input: unknown;
  readonly skillIds: readonly string[];
  readonly planningInstruction: string;
  readonly roundCount: number;
  readonly replanCount: number;
  readonly finalInstanceId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowControlRound {
  readonly controlId: string;
  readonly roundIndex: number;
  readonly planId: string;
  readonly instanceId: string;
  readonly workflowVersion: number;
  readonly evaluation: GoalEvaluationResult;
  readonly createdAt: string;
}
