import type {
  RuntimeExecutionContext,
  SelectedTaskOperation,
  SkillUsageCandidateSnapshot,
} from '../../domain/src/index.js';
import type { PlanPreparationProcessorDependencies } from './plan-preparation-processor.js';
import type { PreparedSkillUsagePlan, prepareSkillUsagePlan } from './skill-usage-planning.js';
import type { PlanWorkflowInput, WorkflowPlanCandidate } from './workflow-planning-contracts.js';

export interface TaskPlanningUsageEvidence {
  readonly applicabilityStatus: SkillUsageCandidateSnapshot['applicability']['status'];
  readonly prepared: PreparedSkillUsagePlan;
  readonly selectedTaskOperation?: SelectedTaskOperation;
  readonly executionContext?: RuntimeExecutionContext;
}
export interface TaskPlanningProfilePolicy {
  prepareUsage(
    input: Parameters<typeof prepareSkillUsagePlan>[0] &
      Readonly<{
        task: Parameters<PlanPreparationProcessorDependencies['taskPlanning']['prepare']>[0];
      }>,
  ): Promise<TaskPlanningUsageEvidence | undefined>;
  generateCandidate(
    request: PlanWorkflowInput,
    evidence: TaskPlanningUsageEvidence | undefined,
    generate: () => Promise<WorkflowPlanCandidate>,
  ): Promise<WorkflowPlanCandidate>;
}

export type TaskPlanPreparationInput = Parameters<
  PlanPreparationProcessorDependencies['taskPlanning']['prepare']
>[0];
