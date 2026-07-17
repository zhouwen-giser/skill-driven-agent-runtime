import type { GoalExecutionContract } from './goal.js';
import { DomainError } from './errors.js';
import { createMcpToolExecutionSemantics, type McpToolExecutionSemantics } from './mcp.js';
import type { SkillCompositionContext } from './skill-graph.js';
import type { ToolReference } from './skill.js';
import type { SkillFailurePolicy } from './skill-usage.js';
import type { SkillUsagePlanPolicy } from './skill-usage-planning.js';
import type {
  DslExecutionReadiness,
  McpTaskAvailabilityCheckMode,
  McpTaskExecutionMode,
} from './mcp-task-availability.js';
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

export interface WorkflowBoundObject {
  readonly [key: string]: WorkflowBoundValue;
}

export type WorkflowBoundValue =
  | string
  | number
  | boolean
  | null
  | readonly WorkflowBoundValue[]
  | WorkflowBoundObject
  | Readonly<{ op: 'ref'; path: readonly string[] }>;

interface WorkflowNodeBase {
  readonly nodeId: string;
  readonly name: string;
}

export type WorkflowRecoveryAction =
  'retry' | 'change_arguments' | 'alternative_tool' | 'invoke_skill';

export interface WorkflowRecoveryOption {
  readonly action: WorkflowRecoveryAction;
  readonly targetNodeId: string;
  readonly description: string;
  readonly maxAttempts: number;
}

export type McpTaskStartSpec =
  | Readonly<{ mode: 'immediate'; startToleranceMs: number }>
  | Readonly<{
      mode: 'scheduled';
      scheduledAt: string | Readonly<{ op: 'ref'; path: readonly string[] }>;
      startToleranceMs: number;
    }>;

export interface McpTaskExecutionSpec {
  readonly mode: McpTaskExecutionMode;
  readonly timing?:
    | Readonly<{
        readonly start: McpTaskStartSpec;
        readonly maxElapsedMs?: number | null | undefined;
      }>
    | undefined;
  readonly availabilityCheck?: McpTaskAvailabilityCheckMode | undefined;
}

export type WorkflowNode =
  | (WorkflowNodeBase &
      Readonly<{
        type: 'llm';
        instruction: string;
        context?: WorkflowBoundValue | undefined;
        responseSchema: unknown;
      }>)
  | (WorkflowNodeBase &
      Readonly<{
        type: 'mcp_tool';
        tool: ToolReference;
        arguments: WorkflowBoundValue;
        taskExecution?: McpTaskExecutionSpec | undefined;
      }>)
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
      Readonly<{
        type: 'subworkflow';
        workflowDefinitionId: string;
        workflowVersion: number;
        input: WorkflowBoundValue;
      }>)
  | (WorkflowNodeBase & Readonly<{ type: 'human_confirmation'; prompt: string }>)
  | (WorkflowNodeBase &
      Readonly<{
        type: 'error_handler';
        handledNodeId: string;
        strategy: 'terminate' | 'continue' | 'goto';
        skillFailurePolicy?: SkillFailurePolicy | undefined;
        gotoNodeId?: string | undefined;
        recoveryOptions?: readonly WorkflowRecoveryOption[] | undefined;
      }>)
  | (WorkflowNodeBase &
      Readonly<{ type: 'skill_call'; skillId: string; input: WorkflowBoundValue }>);

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
  /** Validated immutable planning authority; execution never interprets this as code. */
  readonly skillUsagePolicy?: SkillUsagePlanPolicy | undefined;
}

export interface WorkflowPlanAttempt {
  readonly planId: string;
  readonly goalContract: GoalExecutionContract;
  readonly compositionContext?: SkillCompositionContext;
  readonly capabilityGapSkillIds?: readonly string[];
  readonly toolExecutionSemantics?: readonly WorkflowToolExecutionSemanticsSnapshot[];
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
  readonly goalContract: GoalExecutionContract;
  readonly compositionContext?: SkillCompositionContext;
  readonly capabilityGapSkillIds?: readonly string[];
  readonly toolExecutionSemantics?: readonly WorkflowToolExecutionSemanticsSnapshot[];
  readonly definition?: WorkflowDefinition;
  readonly sourceConfirmedPlanId?: string;
  readonly sourcePlanId?: string;
  readonly revisionKind?:
    'auto_correction' | 'natural_language' | 'admin_dsl' | 'admin_dag' | 'replan';
  readonly confirmationStatus:
    'awaiting_confirmation' | 'confirmed' | 'failed' | 'superseded' | 'invalidated';
  readonly confirmationTaskId?: string;
  readonly confirmedAt?: string;
  readonly attemptCount: number;
  readonly createdAt: string;
  /** Latest projection; PostgreSQL stores the authoritative append-only evidence. */
  readonly executionReadiness?: DslExecutionReadiness;
}

export interface WorkflowToolExecutionSemanticsSnapshot {
  readonly reference: ToolReference;
  readonly executionSemantics: McpToolExecutionSemantics;
}

export function snapshotWorkflowToolExecutionSemantics(
  values: readonly WorkflowToolExecutionSemanticsSnapshot[],
): readonly WorkflowToolExecutionSemanticsSnapshot[] {
  const seen = new Set<string>();
  return Object.freeze(
    values.map((value) => {
      const serverId = value.reference.serverId.trim();
      const toolName = value.reference.toolName.trim();
      const key = `${serverId}\u0000${toolName}`;
      if (serverId === '' || toolName === '' || seen.has(key)) {
        throw new DomainError(
          'WORKFLOW_TOOL_EXECUTION_SEMANTICS_INVALID',
          'Workflow Tool execution semantics require unique, non-empty Tool references.',
        );
      }
      seen.add(key);
      return Object.freeze({
        reference: Object.freeze({ serverId, toolName }),
        executionSemantics: Object.freeze(
          createMcpToolExecutionSemantics(
            value.executionSemantics,
            value.executionSemantics.source,
          ),
        ),
      });
    }),
  );
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
  readonly status:
    'running' | 'paused' | 'waiting_external' | 'succeeded' | 'failed' | 'canceled' | 'invalidated';
  readonly input: unknown;
  readonly result?: unknown;
  readonly errors: Readonly<Record<string, Readonly<{ code: string; message: string }>>>;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly terminationReason?: WorkflowBudgetTerminationReason;
  readonly pendingConfirmation?: Readonly<{
    nodeId: string;
    prompt: string;
    kind?: 'human_confirmation' | 'task_pause' | 'skill_confirmation';
    pausedAt?: string;
    parentPlanId?: string;
    childPlanId?: string;
    childSkillId?: string;
    childSkillVersion?: number;
  }>;
}

export interface WorkflowNodeEvent {
  readonly eventId: string;
  readonly instanceId: string;
  readonly sequence: number;
  readonly nodeId: string;
  readonly eventType: 'node_started' | 'node_succeeded' | 'node_failed' | 'node_waiting_external';
  readonly timestamp: string;
  readonly durationMs?: number;
  readonly summary: string;
}
