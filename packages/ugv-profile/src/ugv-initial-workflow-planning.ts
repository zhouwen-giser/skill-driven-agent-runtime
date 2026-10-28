import { assertNativeZmqExecutionContext } from '../../domain/src/zmq-site-capability.js';
import { canonicalHash } from '../../application/src/mcp-task-readiness.js';
import type { AsyncLocalStorage } from 'node:async_hooks';
import type {
  Clock,
  RuntimeTaskCapabilityService,
  SkillInputResolutionRepository,
  JsonSchemaValidator,
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
import { prepareNativeZmqWorkflow } from './zmq-workflow.js';
import { zmqToolForSkill, zmqCapabilityId } from '../../domain/src/index.js';
import { ZMQ_PATROL_SKILL, ZMQ_PATROL_CAPABILITY } from '../../domain/src/zmq-area-patrol.js';
import { prepareZmqPatrolWorkflow } from './zmq-patrol-workflow.js';

/** UGV admission and constraint scope only; formal Workflow/Task writers are absent. */
export class UgvInitialWorkflowPlanningPolicy implements TaskPlanningProfilePolicy {
  readonly #dependencies: Readonly<{
    bindings: Pick<RuntimeTaskCapabilityService, 'resolveRuntimeExecutionContext' | 'findBinding'>;
    inputs: Pick<SkillInputResolutionRepository, 'find'>;
    moveBinding: Pick<UgvMoveTaskBindingResolver, 'resolve'> | undefined;
    scope: AsyncLocalStorage<UgvMoveWorkflowCandidateGuard>;
    clock: Clock;
    schemas?: Pick<JsonSchemaValidator, 'validate'>;
  }>;
  constructor(dependencies: UgvInitialWorkflowPlanningPolicyDependencies) {
    this.#dependencies = dependencies;
  }
  async prepareUsage(
    input: Parameters<TaskPlanningProfilePolicy['prepareUsage']>[0],
  ): Promise<TaskPlanningUsageEvidence | undefined> {
    const { skill, candidate, interpretation, workflowDefinitionId, workflowVersion, task } = input;
    if (skill.skillId === ZMQ_PATROL_SKILL) {
      const { bindings, inputs, clock, schemas } = this.#dependencies;
      const binding = await bindings.findBinding(task.task.taskId);
      const resolution = task.skillInputResolution;
      const persisted = resolution && (await inputs.find(resolution.resolutionId));
      const executionContext = await bindings.resolveRuntimeExecutionContext(task.task.taskId);
      if (
        !binding ||
        !resolution ||
        !persisted ||
        !schemas ||
        binding.requestedCapabilityId !== ZMQ_PATROL_CAPABILITY ||
        executionContext?.mode !== 'live' ||
        executionContext.simulationId != null ||
        canonicalHash(binding.inputSnapshot) !== canonicalHash(persisted.structuredInput) ||
        canonicalHash(binding.inputSnapshot) !== canonicalHash(resolution.structuredInput) ||
        !schemas.validate(skill.inputSchema, binding.inputSnapshot).valid
      )
        throw Error('ZMQ_PATROL_INPUT_AUTHORITY_REQUIRED');
      return {
        applicabilityStatus: candidate.applicability.status,
        executionContext,
        prepared: prepareZmqPatrolWorkflow(input, binding.inputSnapshot, clock.now()),
      };
    }
    const nativeTool = zmqToolForSkill(skill.skillId);
    if (nativeTool !== undefined) {
      const { schemas, bindings, inputs, clock } = this.#dependencies;
      const binding = await bindings.findBinding(task.task.taskId),
        resolution = task.skillInputResolution;
      if (
        !schemas ||
        !binding ||
        !resolution ||
        binding.requestedCapabilityId !== zmqCapabilityId(nativeTool)
      )
        throw Error('ZMQ_SKILL_INPUT_AUTHORITY_REQUIRED');
      const persisted = await inputs.find(resolution.resolutionId);
      if (
        !persisted ||
        canonicalHash(persisted.structuredInput) !== canonicalHash(binding.inputSnapshot) ||
        canonicalHash(resolution.structuredInput) !== canonicalHash(binding.inputSnapshot)
      )
        throw Error('ZMQ_SKILL_INPUT_AUTHORITY_CONFLICT');
      const executionContext = await bindings.resolveRuntimeExecutionContext(task.task.taskId);
      if (!executionContext) throw Error('ZMQ_EXECUTION_CONTEXT_REQUIRED');
      assertNativeZmqExecutionContext(binding.constraintSnapshot, executionContext, nativeTool);
      return {
        applicabilityStatus: candidate.applicability.status,
        prepared: prepareNativeZmqWorkflow(input, binding.inputSnapshot, schemas, clock.now()),
        executionContext,
      };
    }
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
  readonly schemas?: Pick<JsonSchemaValidator, 'validate'>;
}
