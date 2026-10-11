import { goalExecutionContractsEqual, type WorkflowPlanRecord } from '../../domain/src/index.js';
import type { McpTaskReadinessService } from './mcp-task-readiness.js';
import { canonicalHash } from './mcp-task-readiness.js';
import type { WorkflowPlanRepository } from './ports.js';
import { assertWorkflowCandidateHash } from './workflow-plan-candidate.js';
import {
  WorkflowPlannerError,
  type PlanWorkflowInput,
  type WorkflowPlanCandidate,
} from './workflow-planning-contracts.js';
import type { WorkflowTemplateService } from './workflow-template.js';

/** Sole formal plan writer for all Workflow planning paths; execution keeps confirmation ownership. */
export class WorkflowPlanCommitService {
  readonly #repository: Pick<
    WorkflowPlanRepository,
    'findPlan' | 'savePlan' | 'savePlanAndSupersede' | 'saveAttempt'
  >;
  readonly #readinessAudit: Pick<McpTaskReadinessService, 'persistPlanningAudit'> | undefined;
  readonly #templates: Pick<WorkflowTemplateService, 'recordUse'> | undefined;
  constructor(
    dependencies: Readonly<{
      repository: Pick<
        WorkflowPlanRepository,
        'findPlan' | 'savePlan' | 'savePlanAndSupersede' | 'saveAttempt'
      >;
      readinessAudit?: Pick<McpTaskReadinessService, 'persistPlanningAudit'>;
      templates?: Pick<WorkflowTemplateService, 'recordUse'>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#readinessAudit = dependencies.readinessAudit;
    this.#templates = dependencies.templates;
  }

  async commit(
    candidate: WorkflowPlanCandidate,
    input: PlanWorkflowInput,
  ): Promise<WorkflowPlanRecord> {
    assertWorkflowCandidateHash(candidate);
    const plan = candidate.plan;
    if (
      plan.planId !== input.planId ||
      plan.goalId !== input.goalId ||
      plan.goalVersion !== input.goalVersion ||
      plan.executionTaskId !== input.taskId ||
      plan.skillGoalId !== input.skillGoalId ||
      plan.skillAttemptId !== input.skillAttemptId ||
      !goalExecutionContractsEqual(plan.goalContract, input.goalContract) ||
      (plan.definition !== undefined &&
        (plan.definition.workflowDefinitionId !== input.workflowDefinitionId ||
          plan.definition.version !== input.workflowVersion))
    )
      throw new WorkflowPlannerError(
        'WORKFLOW_GOAL_CONTRACT_MISMATCH',
        'Candidate identity does not match the formal planning request.',
      );
    const existing = await this.#repository.findPlan(plan.planId);
    if (
      existing !== undefined &&
      !(
        existing.definition === undefined &&
        existing.confirmationStatus === 'awaiting_confirmation' &&
        existing.goalId === plan.goalId &&
        existing.goalVersion === plan.goalVersion &&
        goalExecutionContractsEqual(existing.goalContract, plan.goalContract)
      )
    ) {
      if (planIdentityHash(existing) !== planIdentityHash(plan))
        throw new Error('WORKFLOW_PLAN_CANDIDATE_ID_COLLISION');
      if (candidate.outcome === 'failed') throwPlanningFailure(candidate);
      return existing;
    }
    if (candidate.outcome === 'ready' && plan.sourceConfirmedPlanId !== undefined) {
      const source = await this.#repository.findPlan(plan.sourceConfirmedPlanId);
      if (source?.confirmationStatus !== 'confirmed')
        throw new WorkflowPlannerError(
          'WORKFLOW_REPAIR_SOURCE_NOT_CONFIRMED',
          'Repair source plan is not confirmed.',
        );
      if (!goalExecutionContractsEqual(source.goalContract, plan.goalContract))
        throw new WorkflowPlannerError(
          'WORKFLOW_REPAIR_GOAL_CONTRACT_MISMATCH',
          'Repair source confirmation belongs to a different Goal execution contract.',
        );
    }
    for (const audit of candidate.planningAudits) {
      if (audit.kind === 'attempt') {
        if (!audit.persisted) await this.#repository.saveAttempt(audit.attempt);
      } else {
        if (this.#readinessAudit === undefined)
          throw new Error('WORKFLOW_PLANNING_READINESS_AUDIT_WRITER_REQUIRED');
        await this.#readinessAudit.persistPlanningAudit(audit.evaluation);
      }
    }
    if (candidate.supersedeSourcePlan) {
      if (plan.sourcePlanId === undefined)
        throw new WorkflowPlannerError(
          'WORKFLOW_REVISION_SOURCE_REQUIRED',
          'Superseding revision requires a source plan.',
        );
      await this.#repository.savePlanAndSupersede(plan, plan.sourcePlanId);
    } else await this.#repository.savePlan(plan);
    if (candidate.outcome === 'failed') throwPlanningFailure(candidate);
    if (candidate.preferredTemplate !== undefined && plan.definition !== undefined)
      await this.#templates?.recordUse(candidate.preferredTemplate, plan.planId, plan.definition);
    return plan;
  }
}
function throwPlanningFailure(candidate: WorkflowPlanCandidate): never {
  throw new WorkflowPlannerError(
    'WORKFLOW_PLANNING_FAILED',
    candidate.failureMessage ?? 'Workflow remained invalid after configured correction attempts.',
  );
}
function planIdentityHash(plan: WorkflowPlanRecord): string {
  return canonicalHash({
    planId: plan.planId,
    executionTaskId: plan.executionTaskId,
    skillGoalId: plan.skillGoalId,
    skillAttemptId: plan.skillAttemptId,
    goalId: plan.goalId,
    goalVersion: plan.goalVersion,
    goalContract: plan.goalContract,
    definition: plan.definition,
    compositionContext: plan.compositionContext,
    capabilityGapSkillIds: plan.capabilityGapSkillIds ?? [],
    toolExecutionSemantics: plan.toolExecutionSemantics ?? [],
    sourceConfirmedPlanId: plan.sourceConfirmedPlanId,
    sourcePlanId: plan.sourcePlanId,
    revisionKind: plan.revisionKind,
  });
}
