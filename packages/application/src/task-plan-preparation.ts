import type { WorkflowPlanRecord } from '../../domain/src/index.js';
import type { PlanPreparationProcessorDependencies } from './plan-preparation-processor.js';
import type { WorkflowPlanCommitService } from './workflow-plan-commit.js';
import type { PlanWorkflowInput, WorkflowPlanCandidate } from './workflow-planning-contracts.js';

type TaskPlanningInput = Parameters<
  PlanPreparationProcessorDependencies['taskPlanning']['prepare']
>[0];
export interface PreparedTaskPlanningCandidate<TData> {
  readonly request: PlanWorkflowInput;
  readonly workflow: WorkflowPlanCandidate;
  readonly data: TData;
}

/** Formal initial-task orchestration: persist, project evidence, confirm; the processor binds/publishes. */
export class FormalTaskPlanPreparationService<TData> {
  readonly #dependencies: FormalTaskPlanPreparationDependencies<TData>;
  constructor(dependencies: FormalTaskPlanPreparationDependencies<TData>) {
    this.#dependencies = dependencies;
  }
  async prepare(
    input: TaskPlanningInput,
  ): Promise<Readonly<{ planId: string; autoConfirmed: boolean }>> {
    const candidate = await this.#dependencies.candidates.generate(input);
    const plan = await this.#dependencies.commits.commit(candidate.workflow, candidate.request);
    const { autoConfirmed } = await this.#dependencies.afterCommit(input, candidate, plan);
    if (autoConfirmed) await this.#dependencies.confirm(plan.planId, input.task.taskId);
    return { planId: plan.planId, autoConfirmed };
  }
}

export type FormalTaskPlanPreparationDependencies<TData> = Readonly<{
  candidates: Readonly<{
    generate(input: TaskPlanningInput): Promise<PreparedTaskPlanningCandidate<TData>>;
  }>;
  commits: Pick<WorkflowPlanCommitService, 'commit'>;
  afterCommit(
    input: TaskPlanningInput,
    candidate: PreparedTaskPlanningCandidate<TData>,
    plan: WorkflowPlanRecord,
  ): Promise<Readonly<{ autoConfirmed: boolean }>>;
  confirm(planId: string, taskId: string): Promise<unknown>;
}>;
