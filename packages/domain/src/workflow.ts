import type { ToolReference } from './skill.js';
import type {
  WorkflowBudgetLimits,
  WorkflowBudgetTerminationReason,
  WorkflowBudgetUsage,
} from './workflow-budget.js';

export type WorkflowExpression =
  | Readonly<{ op: 'literal'; value: string | number | boolean | null }>
  | Readonly<{ op: 'ref'; path: readonly string[] }>
  | Readonly<{ op: 'not'; operand: WorkflowExpression }>
  | Readonly<{
      op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'and' | 'or';
      left: WorkflowExpression;
      right: WorkflowExpression;
    }>;

interface WorkflowNodeBase {
  readonly nodeId: string;
  readonly name: string;
}

export type WorkflowNode =
  | (WorkflowNodeBase & Readonly<{ type: 'llm'; instruction: string; responseSchema: unknown }>)
  | (WorkflowNodeBase & Readonly<{ type: 'mcp_tool'; tool: ToolReference; arguments: unknown }>)
  | (WorkflowNodeBase & Readonly<{ type: 'result'; value: WorkflowExpression }>)
  | (WorkflowNodeBase & Readonly<{ type: 'condition'; expression: WorkflowExpression }>)
  | (WorkflowNodeBase & Readonly<{ type: 'parallel'; branchEntryNodeIds: readonly string[] }>)
  | (WorkflowNodeBase &
      Readonly<{
        type: 'loop';
        condition: WorkflowExpression;
        bodyEntryNodeId: string;
        maxIterations: number;
      }>)
  | (WorkflowNodeBase &
      Readonly<{ type: 'subworkflow'; workflowDefinitionId: string; workflowVersion: number }>)
  | (WorkflowNodeBase & Readonly<{ type: 'human_confirmation'; prompt: string }>)
  | (WorkflowNodeBase &
      Readonly<{
        type: 'error_handler';
        handledNodeId: string;
        strategy: 'terminate' | 'continue' | 'goto';
        gotoNodeId?: string | undefined;
      }>)
  | (WorkflowNodeBase & Readonly<{ type: 'skill_call'; skillId: string; input: unknown }>);

export interface WorkflowEdge {
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly outcome?:
    'default' | 'true' | 'false' | 'success' | 'failure' | 'loop' | 'done' | undefined;
}

export interface WorkflowDefinition {
  readonly workflowDefinitionId: string;
  readonly version: number;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly entryNodeId: string;
  readonly exitNodeIds: readonly string[];
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
}

export interface WorkflowPlanAttempt {
  readonly planId: string;
  readonly attempt: number;
  readonly candidate: unknown;
  readonly validationErrors: readonly Readonly<{ code: string; path: string; message: string }>[];
  readonly valid: boolean;
  readonly createdAt: string;
}

export interface WorkflowPlanRecord {
  readonly planId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly definition?: WorkflowDefinition;
  readonly sourceConfirmedPlanId?: string;
  readonly sourcePlanId?: string;
  readonly revisionKind?:
    'auto_correction' | 'natural_language' | 'admin_dsl' | 'admin_dag' | 'replan';
  readonly confirmationStatus: 'awaiting_confirmation' | 'confirmed' | 'failed' | 'superseded';
  readonly attemptCount: number;
  readonly createdAt: string;
}

export interface WorkflowInstance {
  readonly instanceId: string;
  readonly planId: string;
  readonly workflowDefinitionId: string;
  readonly workflowVersion: number;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly skillVersions: readonly Readonly<{ skillId: string; version: number }>[];
  readonly budgetLimits: WorkflowBudgetLimits;
  readonly budgetUsage: WorkflowBudgetUsage;
  readonly status: 'running' | 'succeeded' | 'failed';
  readonly input: unknown;
  readonly result?: unknown;
  readonly errors: Readonly<Record<string, Readonly<{ code: string; message: string }>>>;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly terminationReason?: WorkflowBudgetTerminationReason;
}

export interface WorkflowNodeEvent {
  readonly eventId: string;
  readonly instanceId: string;
  readonly sequence: number;
  readonly nodeId: string;
  readonly eventType: 'node_started' | 'node_succeeded' | 'node_failed';
  readonly timestamp: string;
  readonly summary: string;
}
