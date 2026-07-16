export type GoalEvaluationDecision =
  | 'achieved'
  | 'request_input'
  | 'adjust_plan'
  | 'replace_skill'
  | 'invoke_additional_skill'
  | 'capability_gap'
  | 'unachievable';

export interface GoalEvaluationResult {
  readonly decision: GoalEvaluationDecision;
  readonly summary: string;
  readonly actionInstruction?: string;
  readonly question?: string;
  readonly missingCapability?: string;
  readonly suggestedToolContract?: Readonly<{
    name: string;
    description: string;
    inputSchema: unknown;
  }>;
}

export type WorkflowControlStatus =
  | 'running'
  | 'awaiting_confirmation'
  | 'awaiting_input'
  | 'capability_gap'
  | 'achieved'
  | 'unachievable'
  | 'canceled'
  | 'failed'
  | 'replan_budget_exhausted';

export interface WorkflowControlRecord {
  readonly controlId: string;
  readonly contextId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly taskId?: string;
  readonly status: WorkflowControlStatus;
  readonly currentPlanId: string;
  readonly input: unknown;
  readonly skillIds: readonly string[];
  readonly planningInstruction: string;
  readonly roundCount: number;
  readonly replanCount: number;
  readonly finalInstanceId?: string;
  readonly terminalOutcomeId?: string;
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
  readonly terminalOutcomeId?: string;
  readonly createdAt: string;
}

export function isTerminalWorkflowControlStatus(
  status: WorkflowControlStatus,
): status is Extract<
  WorkflowControlStatus,
  'capability_gap' | 'achieved' | 'unachievable' | 'canceled' | 'failed' | 'replan_budget_exhausted'
> {
  return [
    'capability_gap',
    'achieved',
    'unachievable',
    'canceled',
    'failed',
    'replan_budget_exhausted',
  ].includes(status);
}
