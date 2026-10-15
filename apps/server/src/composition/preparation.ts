import type { AreaReportInitialAdmission } from '../area-report-initial-admission.js';
import type { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type {
  CapabilityBoundSkillInputResolver,
  FastGatewayService,
  GenericTaskUnderstandingService,
  GoalInputInferenceService,
  GoalService,
  InteractiveActionRouter,
  InteractiveGoalSessionService,
  InteractivePlanningSessionService,
  MemoryService,
  ModelRuntimeService,
  RemoteTaskInputService,
  RuntimeTaskCapabilityService,
  SkillCompositionPlanner,
  SkillExecutionRecordingService,
  SkillSelectionService,
  TaskService,
  TemporarySkillResolver,
  TransitiveSkillConfirmationEvaluator,
  UserGoalPlanningService,
  WorkflowControllerService,
  WorkflowExecutionService,
  WorkflowPlannerService,
} from '../../../../packages/application/src/index.js';
import {
  CognitiveEntryRouter,
  PlanPreparationProcessor,
  SkillGoalScheduler,
  StructuredTaskDecisionService,
  admitCapabilitySkillVersions,
  isSkillGoalCompatible,
  validateSkillToolPolicies,
  type SkillUsageSlotChoice,
} from '../../../../packages/application/src/index.js';
import type { ResolveTopLevelSkillInput as CompositionResolveTopLevelSkillInput } from '../../../../packages/application/src/skill-input-resolution.js';
import { FormalTaskPlanPreparationService } from '../../../../packages/application/src/task-plan-preparation.js';
import {
  createGoalExecutionContract,
  type AgentTask,
  type GoalExecutionContract,
  type RuntimeRequestContext,
  type SkillUsageSelectionContext,
  type SkillVersion,
} from '../../../../packages/domain/src/index.js';
import type { SkillInputResolutionRecord as CompositionSkillInputResolutionRecord } from '../../../../packages/domain/src/skill-input-resolution.js';
import type { WorkflowControlRecord as CompositionWorkflowControlRecord } from '../../../../packages/domain/src/workflow-control.js';
import type {
  PostgresAgentTaskRepository,
  PostgresGoalRepository,
  PostgresMcpRegistryRepository,
  PostgresRuntimeEventPublisher,
  PostgresSkillInputResolutionRepository,
  PostgresSkillRepository,
  PostgresSkillSelectionRepository,
  PostgresTaskInputRepository,
  PostgresTemporarySkillRepository,
  PostgresUserGoalRuntimeRepository,
  PostgresWorkflowPlanRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import { UgvInitialWorkflowPlanningPolicy } from '../../../../packages/ugv-profile/src/ugv-initial-workflow-planning.js';
import {
  developmentPreauthorizationPrincipal,
  isDevelopmentPreauthorizedPlan,
} from '.././development-plan-confirmation.js';
import type { UgvAgentProfileInitialAdmission } from '.././ugv-agent-profile-admission.js';
import { isHistoricalUgvPointSkill } from '.././ugv-agent-profile-catalog.js';
import type { UgvAgentProfileSkillRepositoryView } from '.././ugv-agent-profile.js';
import { UGV_AGENT_PROFILE_CAPABILITY_ID } from '.././ugv-agent-profile.js';
import type { UgvMoveTaskBindingResolver } from '.././ugv-move-binding.js';
import { resolveUgvMoveSkillUsageContext } from '.././ugv-move-skill-usage.js';
import type { UgvMoveWorkflowAuthority } from '.././ugv-move-workflow-authority.js';
import type { UgvMoveWorkflowCandidateGuard } from '.././ugv-move-workflow.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
import { runtimeErrorCode } from './runtime-support.js';
import type { RuntimeValueRef } from './runtime-value-ref.js';
import { TaskPlanningCandidateGenerator } from './task-planning-candidate-generator.js';
export interface composePreparationDependencies {
  readonly areaReportInitialAdmission: AreaReportInitialAdmission | undefined;
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly processor: RuntimeValueRef<PlanPreparationProcessor>;
  readonly tasks: PostgresAgentTaskRepository;
  readonly events: PostgresRuntimeEventPublisher;
  readonly clock: { now: () => string };
  readonly ids: { nextId: (kind: 'context' | 'task' | 'event') => string };
  readonly taskCapabilities: RuntimeTaskCapabilityService;
  readonly modelRuntime: ModelRuntimeService;
  readonly memories: MemoryService;
  readonly goalService: GoalService;
  readonly skills: PostgresSkillRepository;
  readonly profileSkillInputResolver:
    | CapabilityBoundSkillInputResolver
    | {
        resolve(
          input: Parameters<
            (
              input: CompositionResolveTopLevelSkillInput,
            ) => Promise<CompositionSkillInputResolutionRecord>
          >[0],
        ): Promise<CompositionSkillInputResolutionRecord>;
      };
  readonly userGoalPlanning: UserGoalPlanningService;
  readonly ugvInitialAdmission: UgvAgentProfileInitialAdmission | undefined;
  readonly userGoalRuntimeRepository: PostgresUserGoalRuntimeRepository;
  readonly goals: PostgresGoalRepository;
  readonly profileSkills: UgvAgentProfileSkillRepositoryView | PostgresSkillRepository;
  readonly managedCapabilityProfile: boolean;
  readonly ugvAgentProfile: boolean;
  readonly resolveSkillUsageContext: (
    goalContract: GoalExecutionContract,
    task?: AgentTask,
  ) => Promise<SkillUsageSelectionContext>;
  readonly skillSelection: SkillSelectionService;
  readonly skillGoalSelectionRecords: Map<string, string>;
  readonly temporarySkillResolver: TemporarySkillResolver;
  readonly goalInputInference: GoalInputInferenceService;
  readonly taskInputs: PostgresTaskInputRepository;
  readonly cognitiveEntryRouter: CognitiveEntryRouter;
  readonly taskUnderstanding: GenericTaskUnderstandingService;
  readonly interactiveGoalSessions: InteractiveGoalSessionService;
  readonly interactivePlanningSessions: RuntimeValueRef<InteractivePlanningSessionService>;
  readonly interactiveActions: InteractiveActionRouter;
  readonly fastGateway: FastGatewayService | undefined;
  readonly fastGatewayContexts:
    | Readonly<{
        create(
          input: Readonly<{ task: AgentTask; requestText: string }>,
        ): Promise<RuntimeRequestContext>;
      }>
    | undefined;
  readonly service: RuntimeValueRef<TaskService>;
  readonly workflowController: RuntimeValueRef<WorkflowControllerService>;
  readonly remoteTaskInput: RuntimeValueRef<RemoteTaskInputService | undefined>;
  readonly workflowPlans: PostgresWorkflowPlanRepository;
  readonly temporarySkillRepository: PostgresTemporarySkillRepository;
  readonly skillSelectionRepository: PostgresSkillSelectionRepository;
  readonly skillComposition: SkillCompositionPlanner;
  readonly resolveSkillUsageSlotChoices: (
    goalContract: GoalExecutionContract,
    skill: SkillVersion,
    value: unknown,
    task?: AgentTask,
  ) => Promise<readonly SkillUsageSlotChoice[]>;
  readonly ugvMoveBindingResolver: UgvMoveTaskBindingResolver | undefined;
  readonly skillInputResolutionRepository: PostgresSkillInputResolutionRepository;
  readonly mcpRepository: PostgresMcpRegistryRepository;
  readonly workflowPlanner: WorkflowPlannerService;
  readonly ugvWorkflowCandidateGuard: AsyncLocalStorage<UgvMoveWorkflowCandidateGuard>;
  readonly skillConfirmation: TransitiveSkillConfirmationEvaluator;
  readonly skillExecutionRecording: SkillExecutionRecordingService;
  readonly ugvMoveWorkflowAuthority: UgvMoveWorkflowAuthority | undefined;
  readonly workflowExecution: WorkflowExecutionService;
  readonly recordSkillProjectionSafely: (operation: () => Promise<unknown>) => Promise<void>;
  readonly projectSkillExecutionControl: RuntimeValueRef<
    (
      workflowPlanId: string,
      control: Awaited<
        ReturnType<(controlId: string) => Promise<CompositionWorkflowControlRecord>>
      >,
    ) => Promise<void>
  >;
  readonly resolveTaskWorkflowControlId: (task: AgentTask) => Promise<string>;
}
export function composePreparation(dependencies: composePreparationDependencies) {
  const interactivePlanningSessions = dependencies.interactivePlanningSessions.value;
  const {
    options,
    tasks,
    events,
    clock,
    ids,
    taskCapabilities,
    modelRuntime,
    memories,
    goalService,
    skills,
    profileSkillInputResolver,
    userGoalPlanning,
    ugvInitialAdmission,
    userGoalRuntimeRepository,
    goals,
    profileSkills,
    managedCapabilityProfile,
    ugvAgentProfile,
    resolveSkillUsageContext,
    skillSelection,
    skillGoalSelectionRecords,
    temporarySkillResolver,
    goalInputInference,
    taskInputs,
    cognitiveEntryRouter,
    taskUnderstanding,
    interactiveGoalSessions,
    interactiveActions,
    fastGateway,
    fastGatewayContexts,
    workflowPlans,
    temporarySkillRepository,
    skillSelectionRepository,
    skillComposition,
    resolveSkillUsageSlotChoices,
    ugvMoveBindingResolver,
    skillInputResolutionRepository,
    mcpRepository,
    workflowPlanner,
    ugvWorkflowCandidateGuard,
    skillConfirmation,
    skillExecutionRecording,
    ugvMoveWorkflowAuthority,
    workflowExecution,
    recordSkillProjectionSafely,
    resolveTaskWorkflowControlId,
  } = dependencies;
  const profileTaskPlanning = ugvAgentProfile
    ? new UgvInitialWorkflowPlanningPolicy({
        bindings: {
          findBinding: (id) => taskCapabilities.findBinding(id),
          resolveRuntimeExecutionContext: (id) =>
            taskCapabilities.resolveRuntimeExecutionContext(id),
        },
        inputs: { find: (id) => skillInputResolutionRepository.find(id) },
        moveBinding: ugvMoveBindingResolver,
        scope: ugvWorkflowCandidateGuard,
        clock,
      })
    : undefined;
  const taskPlanningCandidates = new TaskPlanningCandidateGenerator({
    skills: { findVersion: (...args) => skills.findVersion(...args) },
    temporarySkillRepository: { find: (...args) => temporarySkillRepository.find(...args) },
    skillSelectionRepository: {
      findSelection: (...args) => skillSelectionRepository.findSelection(...args),
    },
    skillComposition: {
      composeUsage: (...args) => skillComposition.composeUsage(...args),
      interpretUsage: (...args) => skillComposition.interpretUsage(...args),
    },
    resolveSkillUsageSlotChoices,

    mcpRepository: { listTools: (...args) => mcpRepository.listTools(...args) },
    profilePlanning: profileTaskPlanning,
    workflowCandidates: workflowPlanner.candidates,
  });
  const formalTaskPlanning = new FormalTaskPlanPreparationService({
    candidates: taskPlanningCandidates,
    commits: workflowPlanner.commits,
    async afterCommit(input, candidate, plan) {
      const { skill, preparedUsage, preparedUsageEvidence, selectedTaskOperation } = candidate.data;
      if (plan.definition === undefined) throw new Error('TASK_PLAN_GENERATION_FAILED');
      const toolPolicyViolations = validateSkillToolPolicies(
        plan.definition,
        skill === undefined ? [] : [skill],
      );
      if (toolPolicyViolations.length > 0)
        throw new Error(
          `TASK_PLAN_SKILL_TOOL_POLICY_INVALID:${JSON.stringify(toolPolicyViolations)}`,
        );
      const confirmation = await skillConfirmation.evaluate(
        skill === undefined ? [] : [skill.skillId],
        plan.definition,
      );
      const autoConfirmed =
        confirmation.autoConfirm &&
        (plan.executionReadiness === undefined ||
          (plan.executionReadiness.disposition === 'ready' &&
            !plan.executionReadiness.confirmationRequired));
      if (
        skill !== undefined &&
        preparedUsage !== undefined &&
        preparedUsageEvidence !== undefined &&
        input.task.skillSelectionId !== undefined
      ) {
        await skillExecutionRecording.recordPlanning({
          executionId: `skill-execution-${plan.planId}`,
          taskId: input.task.taskId,
          goalId: input.goalId,
          goalVersion: input.goalVersion,
          selectionRef: input.task.skillSelectionId,
          applicabilityStatus: preparedUsageEvidence.applicabilityStatus,
          policy: preparedUsage.policy,
          workflowPlanId: plan.planId,
          workflowDefinitionId: plan.definition.workflowDefinitionId,
          workflowDefinitionVersion: plan.definition.version,
          procedureCompiled:
            preparedUsage.deterministicDefinition !== undefined &&
            preparedUsage.policy.mode === 'procedure',
          planCompliancePassed: true,
        });
        if (selectedTaskOperation !== undefined) {
          if (ugvMoveWorkflowAuthority === undefined)
            throw new Error('UGV_MOVE_WORKFLOW_AUTHORITY_RUNTIME_REQUIRED');
          await ugvMoveWorkflowAuthority.append(
            {
              taskId: input.task.taskId,
              workflowPlanId: plan.planId,
              workflowDefinitionId: plan.definition.workflowDefinitionId,
              workflowDefinitionVersion: plan.definition.version,
              goalId: input.goalId,
              goalVersion: input.goalVersion,
              skillId: skill.skillId,
              skillVersion: skill.version,
            },
            selectedTaskOperation,
          );
        }
      }

      return { autoConfirmed };
    },
    confirm: (planId, taskId) => workflowExecution.confirm(planId, taskId),
  });
  dependencies.processor.value = new PlanPreparationProcessor({
    tasks,
    events,
    clock,
    ids,
    taskCapabilities,
    decisions: new StructuredTaskDecisionService(modelRuntime, memories),
    goals: goalService,
    skills,
    skillInputs: profileSkillInputResolver,
    userGoalPlanning,
    ...(ugvInitialAdmission === undefined
      ? {}
      : {
          initialAdmission: {
            async admit(task) {
              const area = await dependencies.areaReportInitialAdmission?.admit(task);
              if (area !== undefined) return area;
              const binding = await taskCapabilities.findBinding(task.taskId);
              return binding?.requestedCapabilityId === UGV_AGENT_PROFILE_CAPABILITY_ID
                ? ugvInitialAdmission.admit(task)
                : undefined;
            },
          },
        }),
    skillGoalScheduler: new SkillGoalScheduler({
      repository: userGoalRuntimeRepository,
      candidates: {
        async list(skillGoal, planId, agentTaskId) {
          if (skillGoal.requiredResult.includes('TEMPORARY_SKILL_GOAL:')) return [];
          const userGoalPlan = await userGoalRuntimeRepository.findPlan(planId);
          if (userGoalPlan === undefined) throw new Error('USER_GOAL_PLAN_NOT_FOUND');
          const goal = await goals.findById(userGoalPlan.goalId);
          if (goal?.version !== userGoalPlan.goalVersion)
            throw new Error('USER_GOAL_PLAN_GOAL_STALE');
          const goalContract = createGoalExecutionContract(goal);
          const capabilityBinding =
            agentTaskId === undefined ? undefined : await taskCapabilities.findBinding(agentTaskId);
          const compatible = admitCapabilitySkillVersions(
            capabilityBinding,
            (await profileSkills.listEnabledVersions()).filter((candidate) =>
              isSkillGoalCompatible(skillGoal, candidate),
            ),
          );
          const task = agentTaskId === undefined ? undefined : await tasks.findById(agentTaskId);
          const taskCapabilityUsage =
            (!managedCapabilityProfile && !ugvAgentProfile) || agentTaskId === undefined
              ? undefined
              : await taskCapabilities.resolveSkillUsageAuthority(agentTaskId);
          if (ugvAgentProfile && taskCapabilityUsage === undefined)
            throw new Error('UGV_AGENT_PROFILE_TASK_CAPABILITY_AUTHORITY_REQUIRED');
          const ugvTaskCapabilityBinding =
            !ugvAgentProfile || agentTaskId === undefined
              ? undefined
              : await taskCapabilities.findBinding(agentTaskId);
          if (ugvAgentProfile && ugvTaskCapabilityBinding === undefined)
            throw new Error('UGV_AGENT_PROFILE_TASK_CAPABILITY_BINDING_REQUIRED');
          const admitted =
            taskCapabilityUsage === undefined
              ? compatible
              : compatible.filter(
                  (candidate) =>
                    candidate.skillId === taskCapabilityUsage.skillId &&
                    candidate.version === taskCapabilityUsage.skillVersion,
                );
          const selectionContext =
            taskCapabilityUsage === undefined
              ? await resolveSkillUsageContext(goalContract, task)
              : !ugvAgentProfile
                ? taskCapabilityUsage.context
                : !isHistoricalUgvPointSkill(
                      taskCapabilityUsage.skillId,
                      taskCapabilityUsage.skillVersion,
                    )
                  ? taskCapabilityUsage.context
                  : ugvTaskCapabilityBinding === undefined
                    ? (() => {
                        throw new Error('UGV_AGENT_PROFILE_TASK_CAPABILITY_BINDING_REQUIRED');
                      })()
                    : resolveUgvMoveSkillUsageContext({
                        authority: taskCapabilityUsage,
                        binding: ugvTaskCapabilityBinding,
                      });
          const selected = await skillSelection.selectFromCandidates(
            goalContract,
            admitted,
            selectionContext,
          );
          skillGoalSelectionRecords.set(skillGoal.skillGoalId, selected.selectionId);
          const exact = await skills.findVersion(
            selected.selectedSkillId,
            selected.selectedSkillVersion,
          );
          return exact === undefined ? [] : [exact];
        },
        selectionRecordId(skillGoal) {
          return Promise.resolve(skillGoalSelectionRecords.get(skillGoal.skillGoalId));
        },
      },
      now: () => clock.now(),
      nextAttemptId: () => `skill-attempt-${randomUUID()}`,
      nextExecutionContractId: () => `skill-execution-contract-${randomUUID()}`,
    }),
    temporarySkillSelection: {
      async resolve(goalContract, task) {
        const resolved = await temporarySkillResolver.resolve(goalContract, task);
        return {
          temporarySkillId: resolved.skill.temporarySkillId,
          name: resolved.skill.name,
          decisionSummary: resolved.decisionSummary,
        };
      },
    },
    nextGoalId: () => `goal-${randomUUID()}`,
    nextGoalTransitionId: () => `goal-transition-${randomUUID()}`,
    inputInference: goalInputInference,
    taskInputs,
    closePendingGoalInput: {
      close: (taskId) => taskInputs.cancelPending(taskId, 'canceled'),
    },
    ...{
      taskUnderstanding: {
        route: (input) => cognitiveEntryRouter.route(input),
        requiresGoalReview: (input) =>
          new CognitiveEntryRouter({
            policy: options.taskUnderstanding?.entryPolicy ?? 'ambiguous_only',
          }).route(input).kind === 'generic_task',
        understand: (input) =>
          taskUnderstanding.understand({
            ...input,
            conversationContext: { requestMetadata: input.requestMetadata },
            worldStateSummary: {},
            lowRiskUserPreferences: options.taskUnderstanding?.lowRiskUserPreferences ?? [],
          }),
      },
    },
    goalSessions: interactiveGoalSessions,
    planningSessions: interactivePlanningSessions,
    interactiveActions,
    ...(fastGateway === undefined || fastGatewayContexts === undefined
      ? {}
      : {
          fastGateway: {
            async evaluate(
              input: Readonly<{
                task: AgentTask;
                requestText: string;
              }>,
            ) {
              const gatewayContext = await fastGatewayContexts.create(input);
              const result = await fastGateway.evaluateDetailed(gatewayContext);
              return {
                decision: result.decision,
                formalHandoffCommitted:
                  result.record.formalHandoffRef !== undefined &&
                  (result.decision.path === 'compiled_fast' ||
                    result.decision.path === 'template_adapt'),
                ...(result.formalPlanRef === undefined
                  ? {}
                  : { formalPlanRef: result.formalPlanRef }),
                ...(result.formalInteractionRef === undefined
                  ? {}
                  : {
                      interactionQuestion: `Continue formal interaction ${result.formalInteractionRef}.`,
                    }),
              };
            },
          },
        }),
    requestTaskInput: (taskId, question, origin) =>
      dependencies.service.value.requestInput(taskId, question, origin),
    workflowContinuation: {
      continueAfterInput(input) {
        if (input.controlId === undefined || input.controlRoundIndex === undefined)
          throw new Error('TASK_INPUT_WORKFLOW_CONTROL_ASSOCIATION_REQUIRED');
        return dependencies.workflowController.value.continueAfterInput({
          controlId: input.controlId,
          taskId: input.taskId,
          inputRequestId: input.inputRequestId,
          controlRoundIndex: input.controlRoundIndex,
          content: input.content,
        });
      },
    },
    ...(dependencies.remoteTaskInput.value === undefined
      ? {}
      : { remoteTaskInput: dependencies.remoteTaskInput.value }),
    taskPlanning: {
      async confirmDevelopmentPlan(taskId, planId) {
        if (options.developmentPreauthorizationActorId === undefined) return;
        const task = await dependencies.service.value.get(taskId);
        const plan = await workflowPlans.findPlan(planId);
        if (
          task.phase !== 'awaiting_plan_confirmation' ||
          task.planId !== planId ||
          task.selectedSkillId === undefined ||
          plan?.definition === undefined ||
          !isDevelopmentPreauthorizedPlan(task.selectedSkillId, plan.definition)
        )
          return;
        await dependencies.service.value.followUp({
          taskId,
          action: 'confirm_plan',
          messageText:
            'Development deployment preauthorization: system confirmed the persisted non-weapon plan.',
          confirmationAuthority: {
            principal: developmentPreauthorizationPrincipal(
              options.developmentPreauthorizationActorId,
              taskId,
              planId,
            ),
          },
        });
      },
      prepare(input) {
        return formalTaskPlanning.prepare(input);
      },
      async executeAuto(input) {
        const task = await dependencies.service.value.get(input.taskId);
        if (
          task.goalId === undefined ||
          task.goalVersion === undefined ||
          task.selectedSkillId === undefined
        )
          throw new Error('TASK_EXECUTION_IDENTITY_INCOMPLETE');
        await recordSkillProjectionSafely(() =>
          skillExecutionRecording.recordStatus({
            workflowPlanId: input.planId,
            eventType: 'skill.execution_started',
            status: 'executing',
            summary: 'Authoritative Workflow execution started.',
          }),
        );
        try {
          const control = await dependencies.workflowController.value.start({
            controlId: await resolveTaskWorkflowControlId(task),
            contextId: task.contextId,
            goalId: task.goalId,
            goalVersion: task.goalVersion,
            taskId: task.taskId,
            initialPlanId: input.planId,
            input: input.executionInput,
            skillIds: [task.selectedSkillId],
            planningInstruction: JSON.stringify({
              operation: 'task_outer_replan',
              requestText: task.requestText,
            }),
          });
          await dependencies.projectSkillExecutionControl.value(input.planId, control);
        } catch (error: unknown) {
          await recordSkillProjectionSafely(() =>
            skillExecutionRecording.recordStatus({
              workflowPlanId: input.planId,
              eventType: 'skill.execution_failed',
              status: 'failed',
              summary: 'Authoritative Workflow execution failed.',
              details: { errorCode: runtimeErrorCode(error) },
            }),
          );
          throw error;
        }
      },
    },
  });
  return {};
}
