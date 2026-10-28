import {
  isGovernedPatrol,
  isPatrolCapability,
  ZMQ_PATROL_SKILL,
} from '../../../../packages/domain/src/zmq-area-patrol.js';
import {
  zmqToolForSkill,
  ZMQ_NATIVE_CONTROLS,
  nativeZmqTaskExecution,
} from '../../../../packages/domain/src/zmq-capability.js';
import { nativeZmqCatalogProfile } from '../../../../packages/domain/src/zmq-site-capability.js';
import { randomUUID } from 'node:crypto';
import type {
  GoalCancellationService,
  GoalPatchService,
  GovernedControlManagementService,
  ImplicitFeedbackService,
  McpRegistryService,
  MemoryService,
  PlanPreparationProcessor,
  RemoteTaskAdmissionService,
  RemoteTaskInputService,
  ResultProcessor,
  RuntimeTaskCapabilityService,
  SkillCallWorkflowService,
  SkillExecutionRecordingService,
  UserGoalPlanController,
  WorkflowControllerService,
  WorkflowExecutionService,
  WorkflowRevisionService,
} from '../../../../packages/application/src/index.js';
import {
  GenericCapabilityAdmissionResolver,
  RemoteTaskAdmissionRecoveryService,
  TaskService,
  type CognitiveStructuredModelStageInvoker,
  type TaskPlanConfirmationAuthority,
} from '../../../../packages/application/src/index.js';
import type { SubmitTaskCommand as CompositionSubmitTaskCommand } from '../../../../packages/application/src/task-service.js';
import type { DeviceTaskOwnership as CompositionDeviceTaskOwnership } from '../../../../packages/domain/src/device-task-context.js';
import {
  isTerminalWorkflowControlStatus,
  type AgentTask,
} from '../../../../packages/domain/src/index.js';
import type { WorkflowControlRecord as CompositionWorkflowControlRecord } from '../../../../packages/domain/src/workflow-control.js';
import type { AjvJsonSchemaValidator } from '../../../../packages/json-schema-adapter/src/index.js';
import type {
  PostgresAgentTaskCommandContext,
  PostgresAgentTaskRepository,
  PostgresConversationContextRepository,
  PostgresGovernedControlAuthorityRepository,
  PostgresMcpRegistryRepository,
  PostgresRemoteTaskAdmissionIntentStore,
  PostgresRemoteTaskLifecycleQuery,
  PostgresRemoteTaskProviderExecutionLinkStore,
  PostgresRemoteTaskReconciliationAttemptStore,
  PostgresRemoteTaskRepository,
  PostgresRuntimeEventPublisher,
  PostgresSkillDraftRepository,
  PostgresSkillInputResolutionRepository,
  PostgresSkillRepository,
  PostgresTaskCapabilityRepository,
  PostgresTaskInputRepository,
  PostgresWorkflowContinuationRepository,
  PostgresWorkflowExecutionRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import type { BullMqContextTaskQueue } from '../../../../packages/runtime-redis/src/index.js';
import type { UgvGovernedControlManagementService } from '../../../../packages/ugv-profile/src/index.js';
import {
  isHistoricalUgvPointSkill,
  ugvCapabilityForSkill,
} from '.././ugv-agent-profile-catalog.js';
import { type UgvMovePositionPolicy } from '.././ugv-move-position-result.js';
import { UgvMoveTerminalOutcomeAuthority } from '.././ugv-move-terminal-outcome.js';
import type { UgvMoveWorkflowAuthority } from '.././ugv-move-workflow-authority.js';
import { UgvNaturalLanguageCapabilityAdmissionResolver } from '.././ugv-natural-language-capability-admission.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
import type { RuntimeValueRef } from './runtime-value-ref.js';
import type { GovernedChildTaskPort } from '../../../../packages/application/src/governed-child-task.js';
export interface composeTasksDependencies {
  readonly governedPatrolChildren: RuntimeValueRef<GovernedChildTaskPort | undefined>;
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly resolveDeviceOwnership:
    | ((
        command: CompositionSubmitTaskCommand,
      ) => Promise<CompositionDeviceTaskOwnership | undefined>)
    | undefined;
  readonly contexts: PostgresConversationContextRepository;
  readonly tasks: PostgresAgentTaskRepository;
  readonly events: PostgresRuntimeEventPublisher;
  readonly skillDrafts: PostgresSkillDraftRepository;
  readonly taskInputs: PostgresTaskInputRepository;
  readonly taskCapabilities: RuntimeTaskCapabilityService;
  readonly taskCapabilityRepository: PostgresTaskCapabilityRepository;
  readonly ugvAgentProfile: boolean;
  readonly homeLabReadOnlyProfile: boolean;
  readonly homeLabGovernedLightProfile: boolean;
  readonly cognitiveModel: CognitiveStructuredModelStageInvoker;
  readonly schemaValidator: AjvJsonSchemaValidator;
  readonly clock: { now: () => string };
  readonly remoteTaskInput: RuntimeValueRef<RemoteTaskInputService | undefined>;
  readonly skillInputResolutionRepository: PostgresSkillInputResolutionRepository;
  readonly queue: BullMqContextTaskQueue;
  readonly ids: { nextId: (kind: 'context' | 'task' | 'event') => string };
  readonly memories: MemoryService;
  readonly implicitFeedback: ImplicitFeedbackService;
  readonly ugvGovernedControlManagement: UgvGovernedControlManagementService | undefined;
  readonly emergencyControlManagement: GovernedControlManagementService;
  readonly governedControlManagement: GovernedControlManagementService;
  readonly weaponControlManagement: GovernedControlManagementService;
  readonly skillCallWorkflowService: SkillCallWorkflowService;
  readonly workflowExecution: WorkflowExecutionService;
  readonly recordSkillProjectionSafely: (operation: () => Promise<unknown>) => Promise<void>;
  readonly skillExecutionRecording: SkillExecutionRecordingService;
  readonly workflowController: RuntimeValueRef<WorkflowControllerService>;
  readonly projectSkillExecutionControl: RuntimeValueRef<
    (
      workflowPlanId: string,
      control: Awaited<
        ReturnType<(controlId: string) => Promise<CompositionWorkflowControlRecord>>
      >,
    ) => Promise<void>
  >;
  readonly workflowRevision: WorkflowRevisionService;
  readonly goalPatches: GoalPatchService;
  readonly taskCommands: PostgresAgentTaskCommandContext;
  readonly workflowInstances: PostgresWorkflowExecutionRepository;
  readonly userGoalPlanController: UserGoalPlanController;
  readonly goalCancellations: GoalCancellationService;
  readonly remoteTaskAdmissionIntents: PostgresRemoteTaskAdmissionIntentStore | undefined;
  readonly remoteTaskAdmission: RemoteTaskAdmissionService | undefined;
  readonly remoteTaskRepository: PostgresRemoteTaskRepository | undefined;
  readonly workflowContinuations: PostgresWorkflowContinuationRepository;
  readonly remoteTaskReconciliationAttempts:
    PostgresRemoteTaskReconciliationAttemptStore | undefined;
  readonly remoteTaskProviderExecutionLinks:
    PostgresRemoteTaskProviderExecutionLinkStore | undefined;
  readonly mcpRegistry: McpRegistryService;
  readonly ugvMoveWorkflowAuthority: UgvMoveWorkflowAuthority | undefined;
  readonly ugvRemoteTaskLifecycle: PostgresRemoteTaskLifecycleQuery | undefined;
  readonly ugvMovePositionPolicy: UgvMovePositionPolicy | undefined;
  readonly skills: PostgresSkillRepository;
  readonly mcpRepository: PostgresMcpRegistryRepository;
  readonly governedControlAuthorityRepository: PostgresGovernedControlAuthorityRepository;
  readonly resultProcessor: ResultProcessor;
  readonly service: RuntimeValueRef<TaskService>;
  readonly ugvMoveTerminalOutcomeAuthority: RuntimeValueRef<
    UgvMoveTerminalOutcomeAuthority | undefined
  >;
  readonly processor: RuntimeValueRef<PlanPreparationProcessor>;
}
export async function composeTasks(dependencies: composeTasksDependencies) {
  dependencies.ugvMoveTerminalOutcomeAuthority.value = undefined;
  const {
    options,
    resolveDeviceOwnership,
    contexts,
    tasks,
    events,
    skillDrafts,
    taskInputs,
    taskCapabilities,
    taskCapabilityRepository,
    ugvAgentProfile,
    homeLabReadOnlyProfile,
    homeLabGovernedLightProfile,
    cognitiveModel,
    schemaValidator,
    clock,
    skillInputResolutionRepository,
    queue,
    ids,
    memories,
    implicitFeedback,
    ugvGovernedControlManagement,
    emergencyControlManagement,
    governedControlManagement,
    weaponControlManagement,
    skillCallWorkflowService,
    workflowExecution,
    recordSkillProjectionSafely,
    skillExecutionRecording,
    workflowRevision,
    goalPatches,
    taskCommands,
    workflowInstances,
    userGoalPlanController,
    goalCancellations,
    remoteTaskAdmissionIntents,
    remoteTaskAdmission,
    remoteTaskRepository,
    workflowContinuations,
    remoteTaskReconciliationAttempts,
    remoteTaskProviderExecutionLinks,
    mcpRegistry,
    ugvMoveWorkflowAuthority,
    ugvRemoteTaskLifecycle,
    ugvMovePositionPolicy,
    skills,
    mcpRepository,
    governedControlAuthorityRepository,
    resultProcessor,
  } = dependencies;
  const backgroundExecutions = new Set<Promise<void>>();
  const backgroundExecutionErrors: unknown[] = [];
  const trackBackgroundExecution = (execution: Promise<void>): void => {
    backgroundExecutions.add(execution);
    void execution.then(
      () => {
        backgroundExecutions.delete(execution);
      },
      (error: unknown) => {
        backgroundExecutions.delete(execution);
        backgroundExecutionErrors.push(error);
      },
    );
  };
  async function isNativeSiteTask(task: AgentTask) {
    const binding = await taskCapabilities.findBinding(task.taskId);
    if (task.selectedSkillId === ZMQ_PATROL_SKILL)
      return binding?.requestedCapabilityId === 'vehicle.ugv.zmq.area_patrol';
    const name = zmqToolForSkill(task.selectedSkillId ?? '');
    return (
      name !== undefined &&
      ZMQ_NATIVE_CONTROLS.has(name) &&
      binding !== undefined &&
      nativeZmqCatalogProfile(binding.constraintSnapshot) === 'zmq_v1_2_0_site_control_13'
    );
  }
  async function controlNativeRemote(task: AgentTask, action: 'pause' | 'resume') {
    if (!ugvRemoteTaskLifecycle) throw Error('ZMQ_TASK_LIFECYCLE_UNAVAILABLE');
    const rows = await ugvRemoteTaskLifecycle.listByAgentTaskId(task.taskId);
    const active = rows
      .map((row) => row.binding)
      .filter(
        (binding) =>
          binding.workflowPlanId === task.planId &&
          !['completed', 'failed', 'cancelled'].includes(binding.protocolStatus),
      );
    if (active.length > 1) throw Error('ZMQ_TASK_LIFECYCLE_IDENTITY_CONFLICT');
    for (const binding of active) {
      if (
        binding.agentTaskId !== task.taskId ||
        binding.contextId !== task.contextId ||
        binding.executionContext.mode !== 'live' ||
        binding.executionContext.simulationId != null
      )
        throw Error('ZMQ_TASK_LIFECYCLE_IDENTITY_CONFLICT');
      if (taskCommands.current())
        await taskCommands.recordEffect('native_lifecycle_intent', binding.bindingId, {
          action,
          remoteTaskId: binding.remoteTaskId,
          workflowPlanId: binding.workflowPlanId,
        });
      const ack = await mcpRegistry.controlRemoteTask(binding, action);
      if (taskCommands.current())
        await taskCommands.recordEffect('native_lifecycle_ack', binding.bindingId, {
          action,
          remoteTaskId: binding.remoteTaskId,
          ack,
        });
    }
  }
  dependencies.service.value = new TaskService({
    ...(resolveDeviceOwnership === undefined ? {} : { resolveDeviceOwnership }),
    contexts,
    tasks,
    events,
    skillDrafts,
    taskInputs,
    taskCapabilities,
    initialAdmissions: taskCapabilityRepository,
    admissionReceipts: taskCapabilityRepository,
    ...(ugvAgentProfile || homeLabReadOnlyProfile || homeLabGovernedLightProfile
      ? {}
      : {
          genericCapabilityAdmissions: new GenericCapabilityAdmissionResolver({
            listCurrentExposures: (limit) => taskCapabilityRepository.listCurrentExposures(limit),
            model: cognitiveModel,
            schemas: schemaValidator,
          }),
        }),
    ...(ugvAgentProfile
      ? {
          naturalLanguageCapabilityAdmissions: new UgvNaturalLanguageCapabilityAdmissionResolver({
            exposures: {
              findCurrent: (exposureId) =>
                taskCapabilities.describeCurrentAdmissionExposure(exposureId, clock.now()),
            },
          }),
        }
      : {}),
    ...(options.frozenMcpTasks === undefined
      ? {}
      : {
          remoteTaskInputs: {
            prepareResponse(
              inputRequestId: string,
              inputContent: unknown,
              principal?: TaskPlanConfirmationAuthority['principal'],
            ) {
              if (dependencies.remoteTaskInput.value === undefined)
                throw new Error('REMOTE_TASK_INPUT_SERVICE_UNAVAILABLE');
              return dependencies.remoteTaskInput.value.prepareResponse(
                inputRequestId,
                inputContent,
                principal,
              );
            },
          },
        }),
    skillInputs: skillInputResolutionRepository,
    queue,
    clock,
    ids,
    memories,
    feedback: implicitFeedback,
    ...(ugvAgentProfile
      ? {
          async beforePlanExecution(input) {
            if (input.confirmationAuthority === undefined)
              throw new Error('UGV_AGENT_PROFILE_OUTER_CONFIRMATION_AUTHORITY_REQUIRED');
            if (
              input.task.selectedSkillId !== undefined &&
              input.task.selectedSkillVersion !== undefined &&
              isHistoricalUgvPointSkill(input.task.selectedSkillId, input.task.selectedSkillVersion)
            ) {
              if (input.emergencyAuthorization !== undefined)
                throw new Error('UGV_AGENT_PROFILE_EMERGENCY_AUTHORITY_SCOPE_INVALID');
              if (ugvGovernedControlManagement === undefined)
                throw new Error('UGV_AGENT_PROFILE_POINT_CONTROL_AUTHORITY_REQUIRED');
              await ugvGovernedControlManagement.issue({
                taskId: input.task.taskId,
                reason: 'Confirmed the immutable UGV point-navigation outer Workflow plan.',
                principal: input.confirmationAuthority.principal,
              });
              return;
            }
            if (isGovernedPatrol(input.task.selectedSkillId, input.task.selectedSkillVersion)) {
              const binding = await taskCapabilities.findBinding(input.task.taskId);
              if (
                !isPatrolCapability(binding?.requestedCapabilityId) ||
                binding.constraintSnapshot.filter(
                  (item) => item['type'] === 'composition_authority_policy',
                ).length !== 1
              )
                throw Error('PATROL_COMPOSITION_CONFIRMATION_AUTHORITY_MISSING');
              if (input.task.selectedSkillId === ZMQ_PATROL_SKILL) {
                const port = dependencies.governedPatrolChildren.value;
                if (!port?.recordParentConfirmation)
                  throw Error('ZMQ_PATROL_CONFIRMATION_STORE_REQUIRED');
                await port.recordParentConfirmation(input.task, input.confirmationAuthority);
              }
              // Each physical child receives its own exact confirmation; parent confirmation permits composition.
              return;
            }
            const declaration =
              input.task.selectedSkillId === undefined
                ? undefined
                : ugvCapabilityForSkill(input.task.selectedSkillId);
            if (
              input.emergencyAuthorization !== undefined &&
              declaration?.kind !== 'emergency_stop'
            )
              throw new Error('UGV_AGENT_PROFILE_EMERGENCY_AUTHORITY_SCOPE_INVALID');
            if (declaration === undefined || declaration.kind === 'read_only') return;
            if (declaration.kind === 'weapon_control')
              return Object.freeze({ deferExecution: 'weapon_confirmation' as const });
            await (
              declaration.kind === 'emergency_stop'
                ? emergencyControlManagement
                : governedControlManagement
            ).issue({
              taskId: input.task.taskId,
              reason:
                declaration.kind === 'emergency_stop'
                  ? 'Confirmed the exact immutable emergency-stop plan.'
                  : 'Confirmed the exact immutable UGV physical-control plan.',
              principal: input.confirmationAuthority.principal,
              ...(declaration.kind === 'emergency_stop' &&
              input.emergencyAuthorization !== undefined
                ? {
                    expectedToolName: 'vehicle_emergency_stop',
                    expectedResourceId: input.emergencyAuthorization.resourceId,
                  }
                : {}),
            });
            return undefined;
          },
          weaponActions: {
            async confirm(taskId, authorization, authority) {
              await weaponControlManagement.issue({
                taskId,
                reason: 'Confirmed the exact immutable single-shot weapon action.',
                principal: authority.principal,
                expectedToolName: 'vehicle_fire_weapon',
                expectedResourceId: authorization.resourceId,
                expectedArguments: Object.freeze({ ...authorization }),
              });
            },
          },
        }
      : {}),
    planActions: {
      async confirm(task, authority) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        if (
          await skillCallWorkflowService.confirmPendingForParentPlan(
            task.planId,
            task.taskId,
            authority,
          )
        )
          return 'nested_skill_plan';
        await workflowExecution.confirm(task.planId, task.taskId);
        return 'task_plan';
      },
      async reject(task) {
        if (task.planId !== undefined)
          await skillCallWorkflowService.rejectPendingForParentPlan(task.planId);
      },
      executeConfirmed(task, confirmationTarget) {
        if (
          task.planId === undefined ||
          task.goalId === undefined ||
          task.goalVersion === undefined ||
          (task.selectedSkillId === undefined && task.temporarySkillId === undefined)
        )
          throw new Error('TASK_EXECUTION_IDENTITY_INCOMPLETE');
        const planId = task.planId;
        const goalId = task.goalId;
        const goalVersion = task.goalVersion;
        const selectedSkillIds = task.selectedSkillId === undefined ? [] : [task.selectedSkillId];
        const execution = (async () => {
          if (confirmationTarget === 'nested_skill_plan') {
            await skillCallWorkflowService.resumeConfirmedForParentPlan(planId, {
              agentTaskId: task.taskId,
              contextId: task.contextId,
              workflowControlId: await resolveTaskWorkflowControlId(task),
            });
            return;
          }
          const controlId = await resolveTaskWorkflowControlId(task);
          await recordSkillProjectionSafely(() =>
            skillExecutionRecording.recordStatus({
              workflowPlanId: planId,
              eventType: 'skill.execution_started',
              status: 'executing',
              summary: 'Authoritative Workflow execution started after confirmation.',
            }),
          );
          try {
            const existing = await dependencies.workflowController.value.get(controlId);
            if (existing.status === 'awaiting_confirmation') {
              const continued =
                await dependencies.workflowController.value.continueAfterConfirmation(controlId);
              await dependencies.projectSkillExecutionControl.value(planId, continued);
              return;
            }
          } catch (error: unknown) {
            if (!(
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === 'WORKFLOW_CONTROL_NOT_FOUND'
            ))
              throw error;
          }
          const started = await dependencies.workflowController.value.start({
            controlId,
            contextId: task.contextId,
            goalId,
            goalVersion,
            taskId: task.taskId,
            initialPlanId: planId,
            input: await dependencies.service.value.executionInput(task.taskId),
            skillIds: selectedSkillIds,
            planningInstruction: JSON.stringify({
              operation: 'task_outer_replan',
              requestText: task.requestText,
            }),
          });
          await dependencies.projectSkillExecutionControl.value(planId, started);
        })().catch(async (error: unknown) => {
          const latestTask = await dependencies.service.value.get(task.taskId);
          if (['completed', 'canceled', 'failed', 'invalidated'].includes(latestTask.phase)) return;
          const code =
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof error.code === 'string'
              ? error.code
              : 'TASK_EXECUTION_FAILED';
          const errorSummary =
            error instanceof Error ? error.message : 'Unknown confirmed execution failure.';
          process.stderr.write(
            `${JSON.stringify({
              level: 'error',
              event: 'task_confirmed_execution_failed',
              taskId: task.taskId,
              workflowPlanId: planId,
              errorCode: code,
              errorSummary,
            })}\n`,
          );
          await recordSkillProjectionSafely(() =>
            skillExecutionRecording.recordStatus({
              workflowPlanId: planId,
              eventType: 'skill.execution_failed',
              status: 'failed',
              summary: 'Confirmed authoritative Workflow execution failed.',
              details: { errorCode: code, errorSummary },
            }),
          );
          await dependencies.service.value.fail(
            task.taskId,
            code,
            `Confirmed Task execution failed with ${code}.`,
          );
        });
        trackBackgroundExecution(execution);
        return Promise.resolve();
      },
      async reviseNaturalLanguage(task, instruction) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        const revised = await workflowRevision.reviseNaturalLanguage({
          sourcePlanId: task.planId,
          newPlanId: `plan-task-${task.taskId}-${randomUUID()}`,
          instruction,
        });
        return { planId: revised.planId, goalId: revised.goalId, goalVersion: revised.goalVersion };
      },
      async patchGoal(task, instruction) {
        if (task.goalId === undefined || task.planId === undefined)
          throw new Error('TASK_PLAN_NOT_ATTACHED');
        await dependencies.governedPatrolChildren.value?.cancelChildren(task.taskId, task.planId);
        await goalPatches.apply({
          goalId: task.goalId,
          sourcePlanId: task.planId,
          instruction,
          taskId: task.taskId,
        });
      },
      async pause(task) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        const command = taskCommands.current();
        if (command !== undefined && command.taskId !== task.taskId)
          throw new Error('AGENT_TASK_COMMAND_SCOPE_VIOLATION');
        // A running executor may have been created before this command's ALS
        // scope, so its paused save cannot be assumed to record command
        // evidence. Persist the same payload as the repository; a same-scope
        // save is exact-idempotent and a background save gets its missing proof.
        const native = await isNativeSiteTask(task);
        const paused = await workflowExecution.pauseForPlan(task.planId, native);
        if (native) {
          await dependencies.governedPatrolChildren.value?.controlChildren?.(
            task.taskId,
            task.planId,
            'pause',
          );
          await controlNativeRemote(task, 'pause');
        }
        if (command !== undefined)
          await taskCommands.recordEffect('workflow_paused', paused.instanceId, {
            instanceId: paused.instanceId,
            planId: paused.planId,
            goalId: paused.goalId,
            goalVersion: paused.goalVersion,
            status: paused.status,
            pendingConfirmation: paused.pendingConfirmation,
          });
      },
      async commitRuntimeCancellation(task, reason) {
        if (task.planId !== undefined)
          await dependencies.governedPatrolChildren.value?.cancelChildren(task.taskId, task.planId);
        if (
          task.goalId === undefined ||
          task.goalVersion === undefined ||
          task.planId === undefined
        )
          return false;
        const controlId = await resolveTaskWorkflowControlId(task);
        let control;
        try {
          control = await dependencies.workflowController.value.get(controlId);
        } catch (error: unknown) {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'WORKFLOW_CONTROL_NOT_FOUND'
          )
            return false;
          throw error;
        }
        if (isTerminalWorkflowControlStatus(control.status)) return true;
        await skillCallWorkflowService.rejectPendingForParentPlan(control.currentPlanId);
        const active = await workflowInstances.findActiveByPlanId(control.currentPlanId);
        const canceled =
          active === undefined
            ? undefined
            : await workflowExecution.cancelForPlan(control.currentPlanId);
        const retainedReport = isGovernedPatrol(task.selectedSkillId, task.selectedSkillVersion)
          ? {
              ...(await taskCapabilities.readPatrolTerminalReport(task.taskId, task.planId)),
              status: 'cancelled',
            }
          : undefined;
        try {
          await userGoalPlanController.adjudicateCancellation({
            outcomeId: `terminal-outcome-task-${task.taskId}`,
            taskId: task.taskId,
            goalId: task.goalId,
            goalVersion: task.goalVersion,
            controlId,
            ...(canceled?.instanceId === undefined && control.finalInstanceId === undefined
              ? {}
              : { finalInstanceId: canceled?.instanceId ?? control.finalInstanceId }),
            summary: reason,
            ...(retainedReport === undefined ? {} : { retainedReport }),
            eventId: `event-terminal-${task.taskId}`,
            committedAt: clock.now(),
          });
        } catch (error: unknown) {
          const latest = await dependencies.workflowController.value.get(controlId);
          if (isTerminalWorkflowControlStatus(latest.status)) return true;
          throw error;
        }
        return true;
      },
      async cancel(task) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        await dependencies.governedPatrolChildren.value?.cancelChildren(task.taskId, task.planId);
        if (await skillCallWorkflowService.rejectPendingForParentPlan(task.planId)) return;
        if (task.phase === 'awaiting_plan_confirmation' || task.phase === 'canceled') return;
        await workflowExecution.cancelForPlan(task.planId);
      },
      async resume(task) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        const native = await isNativeSiteTask(task);
        if (native) {
          const active = await workflowInstances.findActiveByPlanId(task.planId);
          if (active?.status !== 'paused' || active.pendingConfirmation?.kind !== 'task_pause')
            throw Error('ZMQ_TASK_RESUME_NOT_PAUSED');
          const binding = await taskCapabilities.findBinding(task.taskId);
          const value = binding?.inputSnapshot;
          if (value === null || typeof value !== 'object' || Array.isArray(value))
            throw Error('ZMQ_TASK_INPUT_UNAVAILABLE');
          nativeZmqTaskExecution((value as Record<string, unknown>)['timeWindow'], clock.now());
          await controlNativeRemote(task, 'resume');
        }
        const resumed = await workflowExecution.resumePauseForPlan(
          task.planId,
          300,
          {
            agentTaskId: task.taskId,
            contextId: task.contextId,
            workflowControlId: await resolveTaskWorkflowControlId(task),
          },
          native,
        );
        if (native)
          await dependencies.governedPatrolChildren.value?.controlChildren?.(
            task.taskId,
            task.planId,
            'resume',
          );
        return resumed.disposition;
      },
      async cancelGoal(task, reason) {
        if (task.goalId === undefined) throw new Error('TASK_GOAL_NOT_ATTACHED');
        if (task.planId !== undefined)
          await dependencies.governedPatrolChildren.value?.cancelChildren(task.taskId, task.planId);
        await goalCancellations.cancel(task.goalId, reason);
      },
    },
  });
  const remoteTaskAdmissionRecovery =
    remoteTaskAdmissionIntents === undefined ||
    remoteTaskAdmission === undefined ||
    remoteTaskRepository === undefined
      ? undefined
      : new RemoteTaskAdmissionRecoveryService({
          store: remoteTaskAdmissionIntents,
          admission: remoteTaskAdmission,
          remoteTasks: remoteTaskRepository,
          continuations: workflowContinuations,
          clock,
          async failTask(taskId, errorCode, summary) {
            await dependencies.service.value.fail(taskId, errorCode, summary);
          },
          nextObservationId: () => `remote-task-observation-${randomUUID()}`,
          nextControlEventId: () => `remote-task-control-${randomUUID()}`,
          ...(remoteTaskReconciliationAttempts === undefined
            ? {}
            : { reconciliationAttempts: remoteTaskReconciliationAttempts }),
          ...(remoteTaskProviderExecutionLinks === undefined
            ? {}
            : { providerExecutionLinks: remoteTaskProviderExecutionLinks }),
          async reconcileUncertain(intent) {
            const contract = intent.reconciliationContract;
            const continuation = contract?.continuation;
            if (contract === undefined || continuation === undefined)
              return {
                result: {
                  status: 'unavailable',
                  safeErrorCode: 'MCP_RECONCILIATION_CONTINUATION_AUTHORITY_MISSING',
                },
              };
            const reconciled = await mcpRegistry.reconcileRemoteTaskAdmission(contract, {
              invocationId: intent.invocationId,
              taskId: intent.taskId,
              ...(intent.capabilityAttemptId === undefined
                ? {}
                : { capabilityAttemptId: intent.capabilityAttemptId }),
              contextId: intent.contextId,
            });
            if (reconciled.result.status !== 'found_exact' || reconciled.invocation === undefined)
              return { result: reconciled.result };
            return {
              result: reconciled.result,
              invocation: reconciled.invocation,
              receipt: {
                remoteTask: reconciled.result.outcome.task,
                ...(reconciled.result.outcome.reconciledTask === undefined
                  ? {}
                  : { reconciledTask: reconciled.result.outcome.reconciledTask }),
                credentialRevision: reconciled.credentialRevision,
                sessionRevision: reconciled.sessionRevision,
                protocolContract: reconciled.protocolContract,
                taskBehavior: reconciled.taskBehavior,
                taskCancellation: reconciled.taskCancellation,
                authoritySnapshot: reconciled.authoritySnapshot,
                continuation,
              },
            };
          },
          async markWorkflowWaitingExternal(intent) {
            const instance = await workflowInstances.findInstance(
              intent.envelope.workflowInstanceId,
            );
            if (instance === undefined)
              throw new Error('REMOTE_TASK_RECOVERY_WORKFLOW_AUTHORITY_CONFLICT');
            if (
              instance.planId !== intent.envelope.workflowPlanId ||
              instance.workflowDefinitionId !== intent.envelope.workflowDefinitionId ||
              instance.workflowVersion !== intent.envelope.workflowDefinitionVersion
            )
              throw new Error('REMOTE_TASK_RECOVERY_WORKFLOW_AUTHORITY_CONFLICT');
            if (instance.status === 'waiting_external') return;
            if (instance.status !== 'running')
              throw new Error('REMOTE_TASK_RECOVERY_WORKFLOW_NOT_RUNNING');
            await workflowInstances.saveInstance({ ...instance, status: 'waiting_external' });
          },
        });
  if (remoteTaskAdmissionRecovery !== undefined) await remoteTaskAdmissionRecovery.reconcile();
  async function resolveTaskWorkflowControlId(task: AgentTask): Promise<string> {
    const baseControlId = `control-task-${task.taskId}`;
    try {
      const existing = await dependencies.workflowController.value.get(baseControlId);
      if (!isTerminalWorkflowControlStatus(existing.status)) return baseControlId;
      return task.skillAttemptId === undefined
        ? baseControlId
        : `${baseControlId}-${task.skillAttemptId}`;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'WORKFLOW_CONTROL_NOT_FOUND'
      )
        return baseControlId;
      throw error;
    }
  }
  if (ugvAgentProfile) {
    if (
      ugvMoveWorkflowAuthority === undefined ||
      ugvRemoteTaskLifecycle === undefined ||
      ugvMovePositionPolicy === undefined
    )
      throw new Error('UGV_MOVE_TERMINAL_OUTCOME_RUNTIME_REQUIRED');
    dependencies.ugvMoveTerminalOutcomeAuthority.value = new UgvMoveTerminalOutcomeAuthority({
      taskCapabilities,
      skills,
      workflowAuthority: ugvMoveWorkflowAuthority,
      invocations: mcpRepository,
      remoteTasks: ugvRemoteTaskLifecycle,
      confirmations: governedControlAuthorityRepository,
      continuations: workflowContinuations,
      resultProcessor,
      positionPolicy: ugvMovePositionPolicy,
    });
  }
  return {
    remoteTaskAdmissionRecovery,
    backgroundExecutions,
    backgroundExecutionErrors,
    resolveTaskWorkflowControlId,
  };
}
