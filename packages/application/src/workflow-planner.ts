import { snapshotGoalExecutionContract } from '../../domain/src/index.js';
import type {
  McpTaskReadinessService,
  WorkflowCandidateReadinessPolicy,
} from './mcp-task-readiness.js';
import type { MemoryService } from './memory-service.js';
import type { Clock, StructuredModelProvider, WorkflowPlanRepository } from './ports.js';
import type { SkillCompositionPlanner } from './skill-composition.js';
import { WorkflowCandidateGenerator } from './workflow-candidate-generator.js';
import { WorkflowPlanCommitService } from './workflow-plan-commit.js';
import {
  WorkflowPlannerError,
  type PlanWorkflowInput,
  type WorkflowCandidateGuard,
} from './workflow-planning-contracts.js';
import type { WorkflowTemplateService } from './workflow-template.js';
import type { WorkflowValidator } from './workflow-validator.js';
export * from './workflow-planning-contracts.js';
/** Formal orchestration facade retained for every existing planner call site. */
export class WorkflowPlannerService {
  readonly candidates: WorkflowCandidateGenerator;
  readonly commits: WorkflowPlanCommitService;
  constructor(
    dependencies: Readonly<{
      model: StructuredModelProvider;
      validator: WorkflowValidator;
      repository: WorkflowPlanRepository;
      workflowSchema: unknown;
      clock: Clock;
      maxAttempts: number;
      templates?: Pick<WorkflowTemplateService, 'findPreferred' | 'recordUse'>;
      memories?: Pick<MemoryService, 'searchForStage'>;
      composition?: Pick<SkillCompositionPlanner, 'compose'>;
      readiness?: WorkflowCandidateReadinessPolicy;
      candidateGuard?: WorkflowCandidateGuard;
      planningAuditCommit?: Pick<McpTaskReadinessService, 'persistPlanningAudit'>;
    }>,
  ) {
    const repository = dependencies.repository;
    const templates = dependencies.templates;
    const memories = dependencies.memories;
    const composition = dependencies.composition;
    this.candidates = new WorkflowCandidateGenerator({
      ...dependencies,
      model: { generateStructured: (request) => dependencies.model.generateStructured(request) },
      ...(memories === undefined
        ? {}
        : { memories: { searchForStage: (...args) => memories.searchForStage(...args) } }),
      ...(composition === undefined
        ? {}
        : { composition: { compose: (root) => composition.compose(root) } }),
      plans: { findPlan: (id) => repository.findPlan(id) },
      audit: {
        saveAttempt: async (attempt) => {
          if (repository.saveCandidateAttempt !== undefined)
            return repository.saveCandidateAttempt(attempt);
          await repository.saveAttempt(attempt);
          return true;
        },
      },
      ...(templates === undefined
        ? {}
        : { templates: { findPreferred: (query) => templates.findPreferred(query) } }),
    });
    this.commits = new WorkflowPlanCommitService({
      repository,
      ...(dependencies.planningAuditCommit === undefined
        ? {}
        : { readinessAudit: dependencies.planningAuditCommit }),
      ...(templates === undefined
        ? {}
        : { templates: { recordUse: (...args) => templates.recordUse(...args) } }),
    });
  }
  async plan(input: PlanWorkflowInput) {
    let request: PlanWorkflowInput;
    try {
      request = { ...input, goalContract: snapshotGoalExecutionContract(input.goalContract) };
    } catch {
      throw new WorkflowPlannerError(
        'WORKFLOW_GOAL_CONTRACT_MISMATCH',
        'Planner Goal identity does not match the supplied execution contract snapshot.',
      );
    }
    return this.commits.commit(await this.candidates.generate(request), request);
  }
}
