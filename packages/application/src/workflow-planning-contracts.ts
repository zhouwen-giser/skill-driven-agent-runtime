import type { WorkflowCandidateReadinessAudit } from './mcp-task-readiness.js';
import {
  type GoalExecutionContract,
  type RuntimeExecutionContext,
  type SkillCompositionContext,
  type SkillUsagePlanPolicy,
  type WorkflowDefinition,
  type WorkflowPlanAttempt,
  type WorkflowPlanRecord,
  type WorkflowToolExecutionSemanticsSnapshot,
} from '../../domain/src/index.js';
import type { SkillCompositionRoot } from './skill-composition.js';
import type { WorkflowTemplateService } from './workflow-template.js';
export interface PlanWorkflowInput {
  readonly planId: string;
  readonly workflowDefinitionId: string;
  readonly workflowVersion: number;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly goalContract: GoalExecutionContract;
  readonly skillGoalId?: string;
  readonly skillAttemptId?: string;
  readonly compositionRoot?: SkillCompositionRoot;
  readonly compositionContext?: SkillCompositionContext;
  readonly capabilityGapSkillIds?: readonly string[];
  readonly toolExecutionSemantics?: readonly WorkflowToolExecutionSemanticsSnapshot[];
  readonly planningInstruction: string;
  readonly sourceConfirmedPlanId?: string;
  readonly sourcePlanId?: string;
  readonly revisionKind?: NonNullable<WorkflowPlanRecord['revisionKind']>;
  readonly supersedeSourcePlan?: boolean;
  readonly templateQuery?: string;
  readonly taskId?: string;
  readonly executionContext?: RuntimeExecutionContext;
  readonly skillUsagePolicy?: SkillUsagePlanPolicy;
  readonly deterministicDefinition?: WorkflowDefinition;
  /** Reject invalid deterministic plans without invoking the planning model. */
  readonly deterministicOnly?: boolean;
}

export interface WorkflowCandidateGuardError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface WorkflowCandidateGuard {
  validate(
    input: Readonly<{
      definition: WorkflowDefinition;
      taskId?: string;
      skillUsagePolicy?: SkillUsagePlanPolicy;
      compositionRoot?: SkillCompositionRoot;
    }>,
  ): readonly WorkflowCandidateGuardError[] | Promise<readonly WorkflowCandidateGuardError[]>;
}

export type WorkflowPlannerErrorCode =
  | 'WORKFLOW_DETERMINISTIC_DEFINITION_REQUIRED'
  | 'WORKFLOW_PLANNER_ATTEMPTS_INVALID'
  | 'WORKFLOW_PLANNING_FAILED'
  | 'WORKFLOW_GOAL_CONTRACT_MISMATCH'
  | 'WORKFLOW_CAPABILITY_GAP_SKILL_INVALID'
  | 'WORKFLOW_COMPOSITION_AUTHORITY_AMBIGUOUS'
  | 'WORKFLOW_SKILL_ATTEMPT_BINDING_INVALID'
  | 'WORKFLOW_COMPOSITION_PLANNER_UNAVAILABLE'
  | 'WORKFLOW_REPAIR_GOAL_CONTRACT_MISMATCH'
  | 'WORKFLOW_REPAIR_TOOL_SEMANTICS_MISMATCH'
  | 'WORKFLOW_REPAIR_COMPOSITION_CONTEXT_MISMATCH'
  | 'WORKFLOW_REVISION_SOURCE_REQUIRED'
  | 'WORKFLOW_REPAIR_SOURCE_NOT_CONFIRMED';

export class WorkflowPlannerError extends Error {
  readonly code: WorkflowPlannerErrorCode;
  constructor(code: WorkflowPlannerErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowPlannerError';
    this.code = code;
  }
}
export interface WorkflowCandidatePlanReader {
  findPlan(planId: string): Promise<WorkflowPlanRecord | undefined>;
}
export interface WorkflowPlanningAudit {
  saveAttempt(attempt: WorkflowPlanAttempt): Promise<boolean>;
}
export type WorkflowCandidateAudit =
  | Readonly<{ kind: 'attempt'; attempt: WorkflowPlanAttempt; persisted: boolean }>
  | Readonly<{ kind: 'readiness'; evaluation: WorkflowCandidateReadinessAudit }>;
export interface WorkflowPlanCandidate {
  readonly planningAudits: readonly WorkflowCandidateAudit[];
  readonly outcome: 'ready' | 'failed';
  readonly plan: WorkflowPlanRecord;
  readonly supersedeSourcePlan: boolean;
  readonly preferredTemplate?: NonNullable<
    Awaited<ReturnType<WorkflowTemplateService['findPreferred']>>
  >;
  readonly failureMessage?: string;
  readonly candidateHash: string;
}
