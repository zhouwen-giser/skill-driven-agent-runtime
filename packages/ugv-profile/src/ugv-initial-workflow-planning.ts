import type { AsyncLocalStorage } from 'node:async_hooks';
import type {
  Clock,
  RuntimeTaskCapabilityService,
  SkillInputResolutionRepository,
} from '../../application/src/index.js';
import type {
  TaskPlanningProfilePolicy,
  TaskPlanningUsageEvidence,
} from '../../application/src/task-planning-profile.js';
import type {
  PlanWorkflowInput,
  WorkflowPlanCandidate,
} from '../../application/src/workflow-planning-contracts.js';
import { assertUgvAgentProfileMoveInputAuthority } from './ugv-agent-profile-admission.js';
import { isHistoricalUgvPointSkill } from './ugv-agent-profile-catalog.js';
import type { UgvMoveTaskBindingResolver } from './ugv-move-binding.js';
import { UgvMoveWorkflowCandidateGuard, prepareUgvMoveWorkflowPlan } from './ugv-move-workflow.js';

/** UGV admission and constraint scope only; formal Workflow/Task writers are absent. */
export class UgvInitialWorkflowPlanningPolicy implements TaskPlanningProfilePolicy {
  readonly #dependencies: Readonly<{
    bindings: Pick<RuntimeTaskCapabilityService, 'resolveRuntimeExecutionContext' | 'findBinding'>;
    inputs: Pick<SkillInputResolutionRepository, 'find'>;
    moveBinding: Pick<UgvMoveTaskBindingResolver, 'resolve'> | undefined;
    scope: AsyncLocalStorage<UgvMoveWorkflowCandidateGuard>;
    clock: Clock;
  }>;
  constructor(dependencies: UgvInitialWorkflowPlanningPolicyDependencies) {
    this.#dependencies = dependencies;
  }
  async prepareUsage(
    input: Parameters<TaskPlanningProfilePolicy['prepareUsage']>[0],
  ): Promise<TaskPlanningUsageEvidence | undefined> {
    const { skill, candidate, interpretation, workflowDefinitionId, workflowVersion, task } = input;
    if (!isHistoricalUgvPointSkill(skill.skillId, skill.version)) return undefined;
    const taskCapabilities = this.#dependencies.bindings;
    const skillInputResolutionRepository = this.#dependencies.inputs;
    const ugvMoveBindingResolver = this.#dependencies.moveBinding;

    if (ugvMoveBindingResolver === undefined || task.skillInputResolution === undefined)
      throw new Error('UGV_AGENT_PROFILE_MOVE_BINDING_RUNTIME_REQUIRED');
    const executionContext = await taskCapabilities.resolveRuntimeExecutionContext(
      task.task.taskId,
    );
    if (
      executionContext === undefined ||
      executionContext.mode === 'historical-replay' ||
      (executionContext.mode === 'simulation' && executionContext.simulationId === undefined)
    )
      throw new Error('UGV_AGENT_PROFILE_EXECUTION_CONTEXT_REQUIRED');
    const resolved = await ugvMoveBindingResolver.resolve({
      skillInput: task.skillInputResolution.structuredInput,
      executionContext,
    });
    const [taskCapabilityBinding, formalResolution] = await Promise.all([
      taskCapabilities.findBinding(task.task.taskId),
      skillInputResolutionRepository.find(task.skillInputResolution.resolutionId),
    ]);
    if (taskCapabilityBinding === undefined || formalResolution === undefined)
      throw new Error('UGV_AGENT_PROFILE_SKILL_INPUT_AUTHORITY_REQUIRED');
    assertUgvAgentProfileMoveInputAuthority({
      binding: taskCapabilityBinding,
      resolution: formalResolution,
      selectedTaskOperation: resolved.selected,
    });
    return {
      applicabilityStatus: candidate.applicability.status,
      prepared: prepareUgvMoveWorkflowPlan({
        skill,
        candidate,
        interpretation,
        goalContract: task.goalContract,
        workflowDefinitionId,
        workflowVersion,
        selectedTaskOperation: resolved.selected,
      }),
      selectedTaskOperation: resolved.selected,
      executionContext,
    } as const;
  }
  async generateCandidate(
    request: PlanWorkflowInput,
    evidence: TaskPlanningUsageEvidence | undefined,
    generate: () => Promise<WorkflowPlanCandidate>,
  ): Promise<WorkflowPlanCandidate> {
    if (evidence?.selectedTaskOperation === undefined) return generate();
    return this.#dependencies.scope.run(
      new UgvMoveWorkflowCandidateGuard({
        selectedTaskOperation: evidence.selectedTaskOperation,
        skillUsagePolicy: evidence.prepared.policy,
        taskId: request.taskId ?? '',
        workflowDefinitionId: request.workflowDefinitionId,
        workflowVersion: request.workflowVersion,
        goalId: request.goalId,
        goalVersion: request.goalVersion,
        clock: this.#dependencies.clock,
      }),
      generate,
    );
  }
}
export interface UgvInitialWorkflowPlanningPolicyDependencies {
  readonly bindings: Pick<
    RuntimeTaskCapabilityService,
    'resolveRuntimeExecutionContext' | 'findBinding'
  >;
  readonly inputs: Pick<SkillInputResolutionRepository, 'find'>;
  readonly moveBinding: Pick<UgvMoveTaskBindingResolver, 'resolve'> | undefined;
  readonly scope: AsyncLocalStorage<UgvMoveWorkflowCandidateGuard>;
  readonly clock: Clock;
}
