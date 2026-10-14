import type { GovernedChildTaskPort } from '../../../../packages/application/src/governed-child-task.js';
import { areaReportChildExecutionStatus } from '../area-report-terminal.js';
import { parseAreaPatrolInput } from '../../../../packages/domain/src/area-patrol.js';
import type { UgvMoveTaskBindingResolver } from '../../../../packages/ugv-profile/src/ugv-move-binding.js';
import { resolveUgvMoveSkillUsageContext } from '../../../../packages/ugv-profile/src/ugv-move-skill-usage.js';
import {
  UgvMoveWorkflowCandidateGuard,
  prepareUgvMoveWorkflowPlan,
} from '../../../../packages/ugv-profile/src/ugv-move-workflow.js';
import { assertUgvAgentProfileMoveInputAuthority } from '../../../../packages/ugv-profile/src/ugv-agent-profile-admission.js';
import type { RuntimeValueRef } from './runtime-value-ref.js';
import {
  inspectionTaskExecution,
  inspectionToolArguments,
  projectInspectionResult,
} from '../../../../packages/domain/src/area-inspection.js';
import type { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  McpRegistryService,
  McpTaskReadinessService,
  ModelRuntimeService,
  RemoteTaskAdmissionService,
  RemoteTaskCancellationService,
  RuntimeTaskCapabilityService,
  SkillCompositionPlanner,
  SkillExecutionRecordingService,
  SkillUsageCandidateAssessor,
  StructuredExecutionExceptionDecider,
  WorkflowPlannerService,
  WorkflowValidator,
} from '../../../../packages/application/src/index.js';
import {
  SkillCallWorkflowService,
  SubworkflowExecutionService,
  TransitiveSkillConfirmationEvaluator,
  WorkflowExecutionService,
  WorkflowRevisionService,
  buildMcpToolPlanningMetadata,
  nextSkillCallAncestry,
  prepareSkillUsagePlan,
  reconcileInitialRemoteTaskSnapshot,
  type CognitiveManagementActionLeaseGuard,
  type RemoteTaskAdmissionEnvelope,
  type RemoteTaskAdmissionIntent,
  type RemoteTaskReconciliationContract,
  type SkillUsageSlotChoice,
} from '../../../../packages/application/src/index.js';
import {
  createMcpLogicalInvocationIdentity,
  createRemoteTaskProviderExecutionLink,
  type AgentTask,
  type GoalExecutionContract,
  type McpInvocation,
  type McpInvocationOutcome,
  type McpProtocolContractSnapshot,
  type McpTaskBehavior,
  type McpToolCancellation,
  type RemoteTaskAuthoritySnapshot,
  type SkillUsageSelectionContext,
  type SkillVersion,
  type WorkflowBudgetLimits,
} from '../../../../packages/domain/src/index.js';
import type { AjvJsonSchemaValidator } from '../../../../packages/json-schema-adapter/src/index.js';
import {
  LangGraphWorkflowExecutor,
  WorkflowCompilerError,
  type WorkflowCallCosts,
  type WorkflowRuntimePorts,
} from '../../../../packages/langgraph-runtime/src/index.js';
import { type DeterministicCapabilityExecutionInput } from '../../../../packages/management-api/src/index.js';
import type {
  PostgresAgentTaskCommandContext,
  PostgresAgentTaskRepository,
  PostgresGovernedControlAuthorityRepository,
  PostgresMcpRegistryRepository,
  PostgresRemoteTaskAdmissionIntentStore,
  PostgresRemoteTaskLifecycleQuery,
  PostgresRemoteTaskProviderExecutionLinkStore,
  PostgresRemoteTaskReconciliationAttemptStore,
  PostgresRemoteTaskRepository,
  PostgresSkillCallWorkflowRepository,
  PostgresSkillExecutionRepository,
  PostgresSkillGraphRepository,
  PostgresSkillInputResolutionRepository,
  PostgresSkillRepository,
  PostgresWorkflowPlanRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import {
  PostgresWorkflowChildCallRepository,
  PostgresWorkflowContinuationRepository,
  PostgresWorkflowExecutionRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import {
  deterministicExecutionError,
  deterministicExecutionIdentity,
} from '.././deterministic-capability-recovery.js';
import { isHistoricalUgvPointSkill } from '.././ugv-agent-profile-catalog.js';
import {
  UGV_AGENT_PROFILE_SKILL_ID,
  UGV_AGENT_PROFILE_SKILL_VERSION,
} from '.././ugv-agent-profile.js';
import { type UgvMovePositionPolicy } from '.././ugv-move-position-result.js';
import type { UgvMoveWorkflowAuthority } from '.././ugv-move-workflow-authority.js';
import { projectUgvMoveWorkflowEvidence } from '.././ugv-move-workflow-evidence.js';
import { UGV_MOVE_WORKFLOW_NODE_IDS } from '.././ugv-move-workflow.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
import {
  RemoteMcpTaskAdmissionUncertainError,
  RemoteMcpTaskPhaseNotConnectedError,
  canonicalJson,
  currentTaskProviderBindingContext,
  isRecord,
  loadExactUgvTaskProviderBindingExpectation,
  requestContinuationActivationFailureCancellation,
  uniqueToolReferences,
} from './runtime-support.js';
export interface composeExecutionDependencies {
  readonly governedPatrolChildren: RuntimeValueRef<GovernedChildTaskPort | undefined>;
  readonly ugvMoveBindingResolver: UgvMoveTaskBindingResolver | undefined;
  readonly ugvWorkflowCandidateGuard: AsyncLocalStorage<UgvMoveWorkflowCandidateGuard>;
  readonly skillInputResolutionRepository: PostgresSkillInputResolutionRepository;
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly tasks: PostgresAgentTaskRepository;
  readonly workflowTaskAuthority: AsyncLocalStorage<AgentTask>;
  readonly modelRuntime: ModelRuntimeService;
  readonly deterministicCapabilityLease: AsyncLocalStorage<
    Readonly<{
      input: DeterministicCapabilityExecutionInput;
      lease: CognitiveManagementActionLeaseGuard;
    }>
  >;
  readonly workflowPlans: PostgresWorkflowPlanRepository;
  readonly skillCallWorkflows: PostgresSkillCallWorkflowRepository;
  readonly mcpRepository: PostgresMcpRegistryRepository;
  readonly taskReadiness: McpTaskReadinessService | undefined;
  readonly taskCapabilities: RuntimeTaskCapabilityService;
  readonly ugvAgentProfile: boolean;
  readonly ugvMoveWorkflowAuthority: UgvMoveWorkflowAuthority | undefined;
  readonly remoteTaskAdmission: RemoteTaskAdmissionService | undefined;
  readonly remoteTaskAdmissionIntents: PostgresRemoteTaskAdmissionIntentStore | undefined;
  readonly clock: { now: () => string };
  readonly mcpRegistry: McpRegistryService;
  readonly remoteTaskReconciliationAttempts:
    PostgresRemoteTaskReconciliationAttemptStore | undefined;
  readonly ugvRemoteTaskLifecycle: PostgresRemoteTaskLifecycleQuery | undefined;
  readonly ugvMovePositionPolicy: UgvMovePositionPolicy | undefined;
  readonly governedControlAuthorityRepository: PostgresGovernedControlAuthorityRepository;
  readonly remoteTaskRepository: PostgresRemoteTaskRepository | undefined;
  readonly recordSkillProjectionSafely: (operation: () => Promise<unknown>) => Promise<void>;
  readonly skillExecutionRecording: SkillExecutionRecordingService;
  readonly skillCallAncestry: AsyncLocalStorage<readonly string[]>;
  readonly workflowAncestry: AsyncLocalStorage<readonly string[]>;
  readonly executionExceptionDecider: StructuredExecutionExceptionDecider;
  readonly workflowCallCosts: WorkflowCallCosts;
  readonly pool: Pool;
  readonly taskCommands: PostgresAgentTaskCommandContext;
  readonly deviceWorkScope:
    { allowedDeviceIds: string[]; sdarServiceKey: string; includeNonDevice: boolean } | undefined;
  readonly workflowValidator: WorkflowValidator;
  readonly remoteTaskProviderExecutionLinks:
    PostgresRemoteTaskProviderExecutionLinkStore | undefined;
  readonly remoteTaskCancellation: RemoteTaskCancellationService | undefined;
  readonly skills: PostgresSkillRepository;
  readonly workflowBudgetDefaults: WorkflowBudgetLimits;
  readonly skillGraphRepository: PostgresSkillGraphRepository;
  readonly workflowPlanner: WorkflowPlannerService;
  readonly schemaValidator: AjvJsonSchemaValidator;
  readonly resolveSkillUsageContext: (
    goalContract: GoalExecutionContract,
    task?: AgentTask,
  ) => Promise<SkillUsageSelectionContext>;
  readonly skillUsage: SkillUsageCandidateAssessor;
  readonly profileSkillUsage: Pick<SkillUsageCandidateAssessor, 'assess'>;
  readonly skillComposition: SkillCompositionPlanner;
  readonly resolveSkillUsageSlotChoices: (
    goalContract: GoalExecutionContract,
    skill: SkillVersion,
    value: unknown,
    task?: AgentTask,
  ) => Promise<readonly SkillUsageSlotChoice[]>;
  readonly skillExecutionRepository: PostgresSkillExecutionRepository;
}
export function composeExecution(dependencies: composeExecutionDependencies) {
  const {
    options,
    tasks,
    workflowTaskAuthority,
    modelRuntime,
    deterministicCapabilityLease,
    workflowPlans,
    skillCallWorkflows,
    mcpRepository,
    taskReadiness,
    taskCapabilities,
    ugvAgentProfile,
    ugvMoveWorkflowAuthority,
    remoteTaskAdmission,
    remoteTaskAdmissionIntents,
    clock,
    mcpRegistry,
    remoteTaskReconciliationAttempts,
    ugvRemoteTaskLifecycle,
    ugvMovePositionPolicy,
    governedControlAuthorityRepository,
    remoteTaskRepository,
    recordSkillProjectionSafely,
    skillExecutionRecording,
    skillCallAncestry,
    workflowAncestry,
    executionExceptionDecider,
    workflowCallCosts,
    pool,
    taskCommands,
    deviceWorkScope,
    workflowValidator,
    remoteTaskProviderExecutionLinks,
    remoteTaskCancellation,
    skills,
    workflowBudgetDefaults,
    skillGraphRepository,
    workflowPlanner,
    schemaValidator,
    resolveSkillUsageContext,
    skillComposition,
    resolveSkillUsageSlotChoices,
    skillExecutionRepository,
  } = dependencies;
  const workflowPorts: WorkflowRuntimePorts = {
    async projectResult({ executionId, result }) {
      const instance = await workflowInstances.findInstance(executionId);
      const plan =
        instance === undefined ? undefined : await workflowPlans.findPlan(instance.planId);
      if (
        plan?.definition?.skillUsagePolicy?.skill.skillId === 'embodied.inspect_area' &&
        result !== false
      )
        return projectInspectionResult(result);
      if (
        plan?.definition?.skillUsagePolicy?.skill.skillId === 'embodied.area_patrol' &&
        plan.definition.skillUsagePolicy.skill.skillVersion >= 2 &&
        instance
      ) {
        const task = await tasks.findByPlanId(plan.planId);
        if (!task) throw Error('PATROL_PARENT_TASK_NOT_FOUND');
        return taskCapabilities.readPatrolTerminalReport(task.taskId, plan.planId);
      }
      return result;
    },
    async executeLlm({ executionId, instruction, context, responseSchema, signal }) {
      const instance = await workflowInstances.findInstance(executionId);
      const task =
        (instance === undefined ? undefined : await tasks.findByPlanId(instance.planId)) ??
        workflowTaskAuthority.getStore();
      return modelRuntime.generateStructured({
        stage: 'execution_decision',
        ...(signal === undefined ? {} : { signal }),
        instruction:
          context === undefined
            ? instruction
            : JSON.stringify({ instruction, dynamicContext: context }),
        responseSchema,
        correctionErrors: [],
        ...(task === undefined
          ? {}
          : { taskId: task.taskId, context: { taskId: task.taskId, contextId: task.contextId } }),
      });
    },
    async callMcpTool({
      executionId,
      workflowNodeId,
      workflowNodeRunId,
      tool,
      arguments: arguments_,
      taskExecution,
      signal,
      executionContext,
      prepareExternalWait,
    }) {
      if (!isRecord(arguments_)) throw new Error('WORKFLOW_MCP_ARGUMENTS_NOT_OBJECT');
      const instance = await workflowInstances.findInstance(executionId);
      const task = instance === undefined ? undefined : await tasks.findByPlanId(instance.planId);
      const authorityTask = task ?? workflowTaskAuthority.getStore();
      const deterministicLease = deterministicCapabilityLease.getStore();
      if (
        deterministicLease !== undefined &&
        (authorityTask?.taskId !== deterministicLease.input.taskId ||
          tool.serverId !== deterministicLease.input.serverId ||
          tool.toolName !== deterministicLease.input.toolName ||
          arguments_['resourceId'] !== deterministicLease.input.resourceId)
      )
        throw deterministicExecutionError(
          'DETERMINISTIC_PROVIDER_DISPATCH_AUTHORITY_MISMATCH',
          'The Workflow MCP call differs from its deterministic lease authority.',
        );
      const plan =
        instance === undefined ? undefined : await workflowPlans.findPlan(instance.planId);
      const skillCallLink =
        instance === undefined
          ? undefined
          : await skillCallWorkflows.findByChildInstanceId(instance.instanceId);
      const childCallLink =
        instance === undefined
          ? undefined
          : await workflowChildCalls.findByChildInstanceId(instance.instanceId);
      const parentWorkflowInstanceId =
        childCallLink?.parentInstanceId ?? skillCallLink?.parentInstanceId;
      const planDefinition = plan?.definition;
      const declaredTaskOperation =
        taskExecution === undefined
          ? await mcpRepository.getTaskOperationDefinition(tool)
          : undefined;
      const inspectionInput =
        tool.toolName === 'vehicle_inspect_area' &&
        plan?.definition?.skillUsagePolicy?.skill.skillId === 'embodied.inspect_area' &&
        isRecord(instance?.input)
          ? instance.input['skillInput']
          : undefined;
      let patrolTimingInput: unknown;
      if (
        tool.toolName === 'vehicle_navigate' &&
        skillCallLink !== undefined &&
        task !== undefined &&
        instance !== undefined &&
        plan !== undefined
      ) {
        const parent = await tasks.findByPlanId(skillCallLink.parentPlanId);
        if (
          parent?.selectedSkillId === 'embodied.area_patrol' &&
          (parent.selectedSkillVersion ?? 0) >= 2
        ) {
          const parentPlan = await workflowPlans.findPlan(skillCallLink.parentPlanId);
          const parentBinding = await taskCapabilities.findBinding(parent.taskId);
          const childBinding = await taskCapabilities.findBinding(task.taskId);
          if (
            parentPlan === undefined ||
            parent.phase !== 'executing' ||
            parent.planId !== parentPlan.planId ||
            parentPlan.confirmationStatus !== 'confirmed' ||
            parentBinding?.requestedCapabilityId !== 'embodied.area_patrol' ||
            skillCallLink.childPlanId !== plan.planId ||
            skillCallLink.childInstanceId !== instance.instanceId ||
            childBinding?.requestedCapabilityId !== 'embodied.move'
          )
            throw Error('PATROL_NAVIGATION_WINDOW_AUTHORITY_INVALID');
          const parentInput = parseAreaPatrolInput(parentBinding.inputSnapshot);
          if (
            canonicalJson(childBinding.inputSnapshot) !==
            canonicalJson({ resourceId: parentInput.resourceId, target: parentInput.target })
          )
            throw Error('PATROL_NAVIGATION_INPUT_CONFLICT');
          patrolTimingInput = {
            resourceId: parentInput.resourceId,
            area: parentInput.area,
            timeWindow: parentInput.timeWindow,
          };
        }
      }
      if (tool.toolName === 'vehicle_inspect_area') {
        if (
          inspectionInput === undefined ||
          canonicalJson(inspectionToolArguments(inspectionInput)) !== canonicalJson(arguments_)
        )
          throw new Error('INSPECTION_FROZEN_INPUT_AUTHORITY_INVALID');
      }
      const effectiveTaskExecution =
        inspectionInput === undefined && patrolTimingInput === undefined
          ? (taskExecution ??
            (declaredTaskOperation?.taskExecutionProfile.taskBehavior === 'task_required'
              ? { protocolMode: 'frozen_v1' as const, availabilityCheck: 'required' as const }
              : undefined))
          : inspectionTaskExecution(inspectionInput ?? patrolTimingInput, clock.now());
      if (effectiveTaskExecution !== undefined && taskReadiness === undefined)
        throw new Error('MCP_TASK_READINESS_RUNTIME_DISABLED');
      if (effectiveTaskExecution !== undefined && planDefinition === undefined)
        throw new Error('MCP_TASK_WORKFLOW_DEFINITION_MISSING');
      let guardedTaskExecution =
        effectiveTaskExecution === undefined ||
        taskReadiness === undefined ||
        instance === undefined ||
        plan === undefined ||
        planDefinition === undefined
          ? taskExecution
          : await taskReadiness.assertPreInvocation({
              planId: plan.planId,
              planAttempt: plan.attemptCount,
              definition: planDefinition,
              planConfirmed: plan.confirmationStatus === 'confirmed',
              workflowInstanceId: instance.instanceId,
              workflowNodeId,
              workflowNodeRunId,
              serverId: tool.serverId,
              operationName: tool.toolName,
              arguments: arguments_,
              taskExecution: effectiveTaskExecution,
              executionContext,
              ...(signal === undefined ? {} : { signal }),
            });
      if (inspectionInput !== undefined || patrolTimingInput !== undefined)
        guardedTaskExecution = {
          ...inspectionTaskExecution(inspectionInput ?? patrolTimingInput, clock.now()),
          ...(guardedTaskExecution?.reservationRef === undefined
            ? {}
            : { reservationRef: guardedTaskExecution.reservationRef }),
        };
      const providerBindingContext =
        authorityTask === undefined
          ? undefined
          : await currentTaskProviderBindingContext(
              authorityTask,
              tool.serverId,
              taskCapabilities,
              ugvAgentProfile ? options.currentMcpProviderBindingAuthorityReader : undefined,
              !ugvAgentProfile ||
                authorityTask.selectedSkillId === undefined ||
                authorityTask.selectedSkillVersion === undefined ||
                !isHistoricalUgvPointSkill(
                  authorityTask.selectedSkillId,
                  authorityTask.selectedSkillVersion,
                )
                ? undefined
                : await loadExactUgvTaskProviderBindingExpectation({
                    task: authorityTask,
                    instance,
                    plan,
                    definition: planDefinition,
                    workflowAuthority: ugvMoveWorkflowAuthority,
                  }),
            );
      const preTransportFence =
        deterministicLease === undefined
          ? undefined
          : {
              invocationId: deterministicExecutionIdentity(deterministicLease.input.taskId)
                .mcpInvocationId,
              signal: deterministicLease.lease.signal,
              enter: (
                dispatch: Readonly<{
                  dispatchId: string;
                  dispatchHash: string;
                }>,
              ) => deterministicLease.lease.enterProviderDispatch(dispatch),
            };
      const remoteAdmissionEnabled =
        effectiveTaskExecution !== undefined ||
        declaredTaskOperation?.taskExecutionProfile.taskBehavior === 'server_directed';
      if (
        remoteAdmissionEnabled &&
        (remoteTaskAdmission === undefined ||
          remoteTaskAdmissionIntents === undefined ||
          authorityTask === undefined ||
          instance === undefined ||
          plan === undefined ||
          planDefinition === undefined)
      )
        throw new RemoteMcpTaskPhaseNotConnectedError('not-dispatched');
      const invocationId = remoteAdmissionEnabled
        ? (preTransportFence?.invocationId ?? `mcp-invocation-${randomUUID()}`)
        : undefined;
      const bindingId =
        invocationId === undefined ? undefined : `remote-task-binding-${invocationId}`;
      const intentId =
        invocationId === undefined ? undefined : `remote-task-admission-${invocationId}`;
      const argumentsHash = createHash('sha256').update(canonicalJson(arguments_)).digest('hex');
      const remoteAdmissionEnvelope: RemoteTaskAdmissionEnvelope | undefined =
        invocationId === undefined ||
        bindingId === undefined ||
        authorityTask === undefined ||
        instance === undefined ||
        plan === undefined ||
        planDefinition === undefined
          ? undefined
          : {
              bindingId,
              serverId: tool.serverId,
              operationName: tool.toolName,
              agentTaskId: authorityTask.taskId,
              contextId: authorityTask.contextId,
              goalId: instance.goalId,
              goalVersion: instance.goalVersion,
              workflowPlanId: plan.planId,
              ...(instance.skillGoalId === undefined ? {} : { skillGoalId: instance.skillGoalId }),
              ...(instance.skillAttemptId === undefined
                ? {}
                : { skillAttemptId: instance.skillAttemptId }),
              workflowDefinitionId: planDefinition.workflowDefinitionId,
              workflowDefinitionVersion: planDefinition.version,
              workflowInstanceId: instance.instanceId,
              workflowNodeId,
              workflowNodeRunId,
              ...(parentWorkflowInstanceId === undefined ? {} : { parentWorkflowInstanceId }),
              ...(skillCallLink === undefined ? {} : { parentSkillCallId: skillCallLink.callId }),
              mcpInvocationId: invocationId,
              ...(guardedTaskExecution?.timing === undefined
                ? {}
                : { requestedTiming: guardedTaskExecution.timing }),
              executionContext,
              createdAt: clock.now(),
            };
      const logicalInvocationIdentity =
        remoteAdmissionEnvelope === undefined ||
        authorityTask === undefined ||
        instance === undefined ||
        plan === undefined ||
        planDefinition === undefined
          ? undefined
          : createMcpLogicalInvocationIdentity({
              taskId: authorityTask.taskId,
              contextId: authorityTask.contextId,
              goalId: instance.goalId,
              goalVersion: instance.goalVersion,
              workflowPlanId: plan.planId,
              workflowDefinitionId: planDefinition.workflowDefinitionId,
              workflowDefinitionVersion: planDefinition.version,
              workflowInstanceId: instance.instanceId,
              workflowNodeId,
              workflowNodeRunId,
              serverId: tool.serverId,
              ...(providerBindingContext?.providerBindingId === undefined
                ? {}
                : { providerBindingId: providerBindingContext.providerBindingId }),
              ...(providerBindingContext?.providerId === undefined
                ? {}
                : { providerId: providerBindingContext.providerId }),
              operationName: tool.toolName,
              argumentsHash,
              executionContext,
            });
      const recoveryContinuation =
        remoteAdmissionEnvelope === undefined
          ? undefined
          : await prepareExternalWait({
              waitId: remoteAdmissionEnvelope.bindingId,
              kind: 'remote_task',
              sourceId: remoteAdmissionEnvelope.bindingId,
              nodeId: workflowNodeId,
              nodeRunId: workflowNodeRunId,
              state: 'waiting',
            });
      const remoteAdmissionIntent: RemoteTaskAdmissionIntent | undefined =
        intentId === undefined ||
        invocationId === undefined ||
        remoteAdmissionEnvelope === undefined ||
        remoteTaskAdmissionIntents === undefined ||
        authorityTask === undefined
          ? undefined
          : {
              intentId,
              invocationId,
              taskId: authorityTask.taskId,
              ...(providerBindingContext?.capabilityAttemptId === undefined
                ? {}
                : { capabilityAttemptId: providerBindingContext.capabilityAttemptId }),
              contextId: authorityTask.contextId,
              serverId: tool.serverId,
              operationName: tool.toolName,
              argumentsHash,
              ...(logicalInvocationIdentity === undefined
                ? {}
                : {
                    logicalIdentity: logicalInvocationIdentity,
                    reconciliationSeed: {
                      schemaVersion: 'sdar.remote-task-reconciliation-seed/v1',
                      logicalIdentity: logicalInvocationIdentity,
                      arguments: arguments_,
                      executionContext,
                      ...(recoveryContinuation === undefined
                        ? {}
                        : { continuation: recoveryContinuation }),
                    },
                  }),
              envelope: remoteAdmissionEnvelope,
              status: 'prepared',
              createdAt: remoteAdmissionEnvelope.createdAt,
              updatedAt: remoteAdmissionEnvelope.createdAt,
              version: 1,
            };
      if (remoteAdmissionIntent !== undefined && remoteTaskAdmissionIntents !== undefined)
        await remoteTaskAdmissionIntents.prepare(remoteAdmissionIntent);
      const remoteAdmissionJournal =
        remoteAdmissionIntent === undefined || remoteTaskAdmissionIntents === undefined
          ? undefined
          : {
              invocationId: remoteAdmissionIntent.invocationId,
              async markDispatching(
                input: Readonly<{
                  invocationId: string;
                  dispatchHash: string;
                  reconciliationContract?: RemoteTaskReconciliationContract;
                  at: string;
                }>,
              ) {
                const mutation = await remoteTaskAdmissionIntents.markDispatching({
                  intentId: remoteAdmissionIntent.intentId,
                  ...input,
                  ...(input.reconciliationContract === undefined
                    ? {}
                    : {
                        reconciliationContract: {
                          ...input.reconciliationContract,
                          ...(remoteAdmissionIntent.reconciliationSeed?.continuation === undefined
                            ? {}
                            : {
                                continuation: remoteAdmissionIntent.reconciliationSeed.continuation,
                              }),
                        },
                      }),
                });
                if (!mutation.applied)
                  throw new Error(
                    `REMOTE_TASK_ADMISSION_DISPATCH_${mutation.reason.toUpperCase()}`,
                  );
              },
              async recordRemoteReceipt(
                input: Readonly<{
                  invocation: McpInvocation;
                  outcome: Extract<
                    McpInvocationOutcome,
                    {
                      kind: 'remote_task';
                    }
                  >;
                  credentialRevision: string;
                  sessionRevision: string;
                  protocolContract: McpProtocolContractSnapshot;
                  taskBehavior: McpTaskBehavior;
                  taskCancellation: McpToolCancellation;
                  authoritySnapshot: RemoteTaskAuthoritySnapshot;
                  at: string;
                }>,
              ) {
                const envelope = remoteAdmissionIntent.envelope;
                const continuation =
                  remoteAdmissionIntent.reconciliationSeed?.continuation ??
                  (await prepareExternalWait({
                    waitId: envelope.bindingId,
                    kind: 'remote_task',
                    sourceId: envelope.bindingId,
                    nodeId: workflowNodeId,
                    nodeRunId: workflowNodeRunId,
                    state:
                      (input.outcome.reconciledTask ?? input.outcome.task).status ===
                      'input_required'
                        ? 'awaiting_input'
                        : 'waiting',
                  }));
                const mutation = await remoteTaskAdmissionIntents.recordRemoteReceiptAndInvocation(
                  remoteAdmissionIntent.intentId,
                  input.invocation,
                  {
                    remoteTask: input.outcome.task,
                    ...(input.outcome.reconciledTask === undefined
                      ? {}
                      : { reconciledTask: input.outcome.reconciledTask }),
                    credentialRevision: input.credentialRevision,
                    sessionRevision: input.sessionRevision,
                    protocolContract: input.protocolContract,
                    taskBehavior: input.taskBehavior,
                    taskCancellation: input.taskCancellation,
                    authoritySnapshot: input.authoritySnapshot,
                    continuation,
                  },
                  input.at,
                );
                if (!mutation.applied)
                  throw new Error(`REMOTE_TASK_ADMISSION_RECEIPT_${mutation.reason.toUpperCase()}`);
              },
              async close(
                input: Readonly<{
                  invocationId: string;
                  reasonCode: string;
                  at: string;
                }>,
              ) {
                await remoteTaskAdmissionIntents.close({
                  intentId: remoteAdmissionIntent.intentId,
                  ...input,
                });
              },
              async markUncertain(
                input: Readonly<{
                  invocationId: string;
                  reasonCode: string;
                  at: string;
                }>,
              ) {
                await remoteTaskAdmissionIntents.markUncertain({
                  intentId: remoteAdmissionIntent.intentId,
                  ...input,
                });
              },
            };
      let receipt: Awaited<ReturnType<McpRegistryService['callDetailed']>>;
      const beforeControlAuthorization =
        (inspectionInput !== undefined || patrolTimingInput !== undefined) &&
        taskReadiness &&
        instance &&
        plan &&
        planDefinition &&
        effectiveTaskExecution !== undefined &&
        guardedTaskExecution?.reservationRef === undefined
          ? async () => {
              inspectionTaskExecution(inspectionInput ?? patrolTimingInput, clock.now());
              const fresh = await taskReadiness.assertPreInvocation({
                planId: plan.planId,
                planAttempt: plan.attemptCount,
                definition: planDefinition,
                planConfirmed: plan.confirmationStatus === 'confirmed',
                workflowInstanceId: instance.instanceId,
                workflowNodeId,
                workflowNodeRunId,
                serverId: tool.serverId,
                operationName: tool.toolName,
                arguments: arguments_,
                taskExecution: effectiveTaskExecution,
                executionContext,
                ...(signal === undefined ? {} : { signal }),
              });
              if (fresh.reservationRef !== undefined)
                throw Error('AREA_DISPATCH_RESERVATION_CHANGED');
            }
          : undefined;
      try {
        receipt = await mcpRegistry.callDetailed(
          tool.serverId,
          tool.toolName,
          arguments_,
          signal,
          authorityTask === undefined
            ? {
                executionContext,
                ...(guardedTaskExecution === undefined
                  ? {}
                  : { taskExecution: guardedTaskExecution }),
                ...(preTransportFence === undefined ? {} : { preTransportFence }),
                ...(remoteAdmissionJournal === undefined ? {} : { remoteAdmissionJournal }),
                ...(logicalInvocationIdentity === undefined ? {} : { logicalInvocationIdentity }),
                ...(beforeControlAuthorization === undefined ? {} : { beforeControlAuthorization }),
              }
            : {
                taskId: authorityTask.taskId,
                contextId: authorityTask.contextId,
                ...(providerBindingContext ?? {}),
                executionContext,
                ...(guardedTaskExecution === undefined
                  ? {}
                  : { taskExecution: guardedTaskExecution }),
                ...(preTransportFence === undefined ? {} : { preTransportFence }),
                ...(remoteAdmissionJournal === undefined ? {} : { remoteAdmissionJournal }),
                ...(logicalInvocationIdentity === undefined ? {} : { logicalInvocationIdentity }),
                ...(beforeControlAuthorization === undefined ? {} : { beforeControlAuthorization }),
              },
        );
      } catch (dispatchError: unknown) {
        const uncertainIntent =
          bindingId === undefined || remoteTaskAdmissionIntents === undefined
            ? undefined
            : await remoteTaskAdmissionIntents.findByBindingId(bindingId);
        if (
          uncertainIntent?.status !== 'uncertain' ||
          uncertainIntent.reconciliationContract === undefined ||
          uncertainIntent.logicalIdentity === undefined ||
          uncertainIntent.reconciliationContract.continuation === undefined ||
          remoteTaskReconciliationAttempts === undefined
        )
          throw dispatchError;
        const startedAt = clock.now();
        const attemptNumber = await remoteTaskReconciliationAttempts.nextAttemptNumber(
          uncertainIntent.intentId,
        );
        const reconciled = await mcpRegistry.reconcileRemoteTaskAdmission(
          uncertainIntent.reconciliationContract,
          {
            invocationId: uncertainIntent.invocationId,
            taskId: uncertainIntent.taskId,
            ...(uncertainIntent.capabilityAttemptId === undefined
              ? {}
              : { capabilityAttemptId: uncertainIntent.capabilityAttemptId }),
            contextId: uncertainIntent.contextId,
          },
        );
        const completedAt = clock.now();
        await remoteTaskReconciliationAttempts.append({
          attemptId: `remote-reconcile-${createHash('sha256')
            .update(canonicalJson({ intentId: uncertainIntent.intentId, attemptNumber }))
            .digest('hex')}`,
          intentId: uncertainIntent.intentId,
          logicalInvocationId: uncertainIntent.logicalIdentity.logicalInvocationId,
          expectedIntentVersion: uncertainIntent.version,
          attemptNumber,
          sourceContract: 'sdar.smpp-diagnostics/v1+frozen-mcp-v1',
          requestHash: `sha256:${createHash('sha256')
            .update(canonicalJson(uncertainIntent.reconciliationContract))
            .digest('hex')}`,
          status: reconciled.result.status,
          ...(reconciled.result.status !== 'found_exact'
            ? { safeErrorCode: reconciled.result.safeErrorCode }
            : {
                remoteTaskId: reconciled.result.outcome.task.remoteTaskId,
                ...(reconciled.result.externalExecutionId === undefined
                  ? {}
                  : { externalExecutionId: reconciled.result.externalExecutionId }),
              }),
          identityValidated: reconciled.result.status === 'found_exact',
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
          resultHash: `sha256:${createHash('sha256')
            .update(canonicalJson(reconciled.result))
            .digest('hex')}`,
          version: 1,
        });
        if (reconciled.result.status !== 'found_exact' || reconciled.invocation === undefined)
          throw dispatchError;
        const reconciledReceipt = {
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
          continuation: uncertainIntent.reconciliationContract.continuation,
        };
        const admissionIntents = remoteTaskAdmissionIntents;
        if (admissionIntents === undefined) throw dispatchError;
        const recorded = await admissionIntents.recordReconciledReceiptAndInvocation({
          intentId: uncertainIntent.intentId,
          logicalInvocationId: uncertainIntent.logicalIdentity.logicalInvocationId,
          invocation: reconciled.invocation,
          receipt: reconciledReceipt,
          at: completedAt,
        });
        if (!recorded.applied)
          throw new Error(`REMOTE_TASK_RECONCILED_RECEIPT_${recorded.reason.toUpperCase()}`, {
            cause: dispatchError,
          });
        receipt = {
          invocationId: uncertainIntent.invocationId,
          outcome: reconciled.result.outcome,
          credentialRevision: reconciled.credentialRevision,
          sessionRevision: reconciled.sessionRevision,
          protocolContract: reconciled.protocolContract,
          taskBehavior: reconciled.taskBehavior,
          taskCancellation: reconciled.taskCancellation,
          authoritySnapshot: reconciled.authoritySnapshot,
        };
      }
      if (receipt.outcome.kind === 'immediate') {
        if (!ugvAgentProfile || workflowNodeId !== UGV_MOVE_WORKFLOW_NODE_IDS.finalState)
          return receipt.outcome;
        if (
          authorityTask === undefined ||
          instance === undefined ||
          plan === undefined ||
          planDefinition === undefined ||
          ugvMoveWorkflowAuthority === undefined ||
          ugvRemoteTaskLifecycle === undefined ||
          ugvMovePositionPolicy === undefined ||
          authorityTask.selectedSkillId !== UGV_AGENT_PROFILE_SKILL_ID ||
          authorityTask.selectedSkillVersion !== UGV_AGENT_PROFILE_SKILL_VERSION ||
          tool.toolName !== 'vehicle_get_state'
        )
          throw new Error('UGV_MOVE_FINAL_EVIDENCE_RUNTIME_AUTHORITY_REQUIRED');
        const [invocations, remoteTaskLifecycle, continuationAttempts] = await Promise.all([
          mcpRepository.listInvocationsByTask(authorityTask.taskId),
          ugvRemoteTaskLifecycle.listByAgentTaskId(authorityTask.taskId),
          workflowContinuations.listAttempts(instance.instanceId),
        ]);
        const navigationInvocations = invocations.filter(
          (invocation) => invocation.toolName === 'vehicle_navigate',
        );
        const navigationInvocation = navigationInvocations[0];
        const continuationAttempt = continuationAttempts[0];
        if (
          navigationInvocations.length !== 1 ||
          navigationInvocation === undefined ||
          continuationAttempts.length !== 1 ||
          continuationAttempt?.status !== 'running'
        )
          throw new Error('UGV_MOVE_FINAL_EVIDENCE_CARDINALITY_INVALID');
        const confirmation = await governedControlAuthorityRepository.findConsumedByInvocation(
          navigationInvocation.invocationId,
        );
        if (confirmation === undefined)
          throw new Error('UGV_MOVE_FINAL_EVIDENCE_CONFIRMATION_REQUIRED');
        const selectedTaskOperation = await ugvMoveWorkflowAuthority.loadExact({
          taskId: authorityTask.taskId,
          workflowPlanId: plan.planId,
          workflowDefinitionId: planDefinition.workflowDefinitionId,
          workflowDefinitionVersion: planDefinition.version,
          goalId: instance.goalId,
          goalVersion: instance.goalVersion,
          skillId: authorityTask.selectedSkillId,
          skillVersion: authorityTask.selectedSkillVersion,
        });
        return Object.freeze({
          kind: 'immediate' as const,
          result: projectUgvMoveWorkflowEvidence({
            taskId: authorityTask.taskId,
            selectedTaskOperation,
            confirmation,
            invocations,
            remoteTaskLifecycle,
            continuationAttempt,
            finalToolResult: receipt.outcome.result,
            assessedAt: clock.now(),
            policy: ugvMovePositionPolicy,
          }).result,
        });
      }
      const remote = receipt.outcome.task;
      if (
        remoteTaskAdmission === undefined ||
        remoteTaskAdmissionIntents === undefined ||
        remoteAdmissionIntent === undefined ||
        bindingId === undefined ||
        authorityTask === undefined ||
        instance === undefined ||
        plan === undefined ||
        planDefinition === undefined
      )
        throw new RemoteMcpTaskPhaseNotConnectedError(remote.remoteTaskId);
      try {
        const protocolContract = receipt.protocolContract;
        const taskBehavior = receipt.taskBehavior;
        const taskCancellation = receipt.taskCancellation;
        const runtimeRevision = remote.runtimeRevision;
        if (
          remote.protocolMode !== 'frozen_v1' ||
          protocolContract === undefined ||
          taskBehavior === undefined ||
          taskCancellation === undefined ||
          runtimeRevision === undefined
        )
          throw new Error('MCP_FROZEN_INVOCATION_AUTHORITY_MISSING');
        const taskExpiresAt =
          remote.ttlMs === null
            ? undefined
            : (remote.expiresAt ??
              new Date(Date.parse(remote.createdAt) + remote.ttlMs).toISOString());
        const admitted = await remoteTaskAdmission.admit({
          bindingId,
          serverId: tool.serverId,
          operationName: tool.toolName,
          remoteTaskId: remote.remoteTaskId,
          agentTaskId: authorityTask.taskId,
          contextId: authorityTask.contextId,
          goalId: instance.goalId,
          goalVersion: instance.goalVersion,
          workflowPlanId: plan.planId,
          ...(instance.skillGoalId === undefined ? {} : { skillGoalId: instance.skillGoalId }),
          ...(instance.skillAttemptId === undefined
            ? {}
            : { skillAttemptId: instance.skillAttemptId }),
          workflowDefinitionId: planDefinition.workflowDefinitionId,
          workflowDefinitionVersion: planDefinition.version,
          workflowInstanceId: instance.instanceId,
          workflowNodeId,
          workflowNodeRunId,
          ...(parentWorkflowInstanceId === undefined ? {} : { parentWorkflowInstanceId }),
          ...(skillCallLink === undefined ? {} : { parentSkillCallId: skillCallLink.callId }),
          mcpInvocationId: receipt.invocationId,
          protocolStatus: remote.status,
          protocolRevision: remote.protocolRevision,
          tasksSchemaRevision: remote.tasksSchemaRevision,
          protocolContract,
          taskBehavior,
          taskCancellation,
          runtimeRevision,
          ...(remote.providerRevision === undefined
            ? {}
            : { providerRevision: remote.providerRevision }),
          ...(remote.ttlMs === null || taskExpiresAt === undefined
            ? {}
            : { taskTtlMs: remote.ttlMs, taskExpiresAt }),
          ...(remote.providerObservation?.substate === undefined
            ? {}
            : { providerSubstate: remote.providerObservation.substate }),
          ...(remote.providerObservation?.remoteRevision === undefined
            ? {}
            : { remoteRevision: remote.providerObservation.remoteRevision }),
          ...(guardedTaskExecution?.timing === undefined
            ? {}
            : { requestedTiming: guardedTaskExecution.timing }),
          executionContext,
          authoritySnapshot: receipt.authoritySnapshot,
          credentialRevision: receipt.credentialRevision,
          sessionRevision: receipt.sessionRevision,
          lastProviderUpdatedAt: remote.lastUpdatedAt,
          pollIntervalMs: Math.max(100, remote.pollIntervalMs ?? 1000),
          createdAt: clock.now(),
        });
        const reconciled = receipt.outcome.reconciledTask;
        if (reconciled !== undefined && remoteTaskRepository !== undefined)
          await reconcileInitialRemoteTaskSnapshot({
            repository: remoteTaskRepository,
            admitted: admitted.binding,
            snapshot: reconciled,
            observationId: `remote-task-observation-${randomUUID()}`,
            ...(reconciled.status === 'working'
              ? {}
              : {
                  controlEventId: `remote-task-control-${randomUUID()}`,
                  resultHash: createHash('sha256').update(canonicalJson(reconciled)).digest('hex'),
                }),
            observedAt: clock.now(),
          });
        if (!admitted.pollScheduled)
          process.stderr.write(
            `${JSON.stringify({
              event: 'remote_task.poll_schedule_deferred',
              code: 'REMOTE_TASK_POLL_SCHEDULE_DEFERRED',
              bindingId: admitted.binding.bindingId,
              serverId: admitted.binding.serverId,
              remoteTaskId: admitted.binding.remoteTaskId,
              message:
                'PostgreSQL admission is authoritative; reconciliation will reschedule the poll.',
            })}\n`,
          );
        await recordSkillProjectionSafely(() =>
          skillExecutionRecording.recordReference({
            workflowPlanId: admitted.binding.workflowPlanId,
            kind: 'remote_task_binding',
            referenceId: admitted.binding.bindingId,
            referenceType: 'mcp.remote_task_binding',
            sourceSystem: admitted.binding.serverId,
            producerRefs: [receipt.invocationId],
            metadata: {
              operationName: admitted.binding.operationName,
              workflowInstanceId: admitted.binding.workflowInstanceId,
              workflowNodeId: admitted.binding.workflowNodeId,
            },
          }),
        );
        return {
          kind: 'waiting_external',
          wait: {
            waitId: admitted.binding.bindingId,
            kind: 'remote_task',
            sourceId: admitted.binding.bindingId,
            nodeId: workflowNodeId,
            nodeRunId: workflowNodeRunId,
            state:
              (reconciled ?? remote).status === 'input_required' ? 'awaiting_input' : 'waiting',
          },
        };
      } catch (error: unknown) {
        process.stderr.write(
          `${JSON.stringify({
            event: 'remote_task.admission.uncertain',
            code: 'REMOTE_TASK_ADMISSION_UNCERTAIN',
            serverId: tool.serverId,
            operationName: tool.toolName,
            remoteTaskId: remote.remoteTaskId,
            workflowInstanceId: instance.instanceId,
            workflowNodeRunId,
            recoveryPending: true,
            message: error instanceof Error ? error.message : 'Remote Task binding failed.',
          })}\n`,
        );
        throw new RemoteMcpTaskAdmissionUncertainError(remote.remoteTaskId);
      }
    },
    async isDeterministicSkillCall({ skillId, parentExecutionId, parentNodeId }) {
      const instance = await workflowInstances.findInstance(parentExecutionId);
      const plan = instance && (await workflowPlans.findPlan(instance.planId));
      const policy = plan?.definition?.skillUsagePolicy;
      const node = plan?.definition?.nodes.find((candidate) => candidate.nodeId === parentNodeId);
      if (
        plan?.confirmationStatus !== 'confirmed' ||
        policy?.skill.skillId !== 'embodied.area_patrol' ||
        policy.skill.skillVersion < 2 ||
        node?.type !== 'skill_call' ||
        node.skillId !== skillId
      )
        return false;
      const declared = policy.childPolicies.filter((child) => child.child.skillId === skillId);
      if (declared.length !== 1 || !['embodied.move_to', 'embodied.inspect_area'].includes(skillId))
        return false;
      const declaredChild = declared[0];
      if (!declaredChild) return false;
      const child = await skills.findVersion(skillId, declaredChild.child.skillVersion);
      return child?.status === 'enabled' && child.usageSpecification !== undefined;
    },
    async executeSkill({
      skillId,
      input,
      parentExecutionId,
      parentNodeId,
      parentNodeRunId,
      resumeChild,
      signal,
      executionContext,
    }) {
      const parent = await workflowInstances.findInstance(parentExecutionId);
      if (parent === undefined) throw new Error('WORKFLOW_PARENT_INSTANCE_NOT_FOUND');
      const authorityTask =
        (await tasks.findByPlanId(parent.planId)) ?? workflowTaskAuthority.getStore();
      const ancestry = nextSkillCallAncestry(skillCallAncestry.getStore() ?? [], skillId);
      const executeChild = () =>
        skillCallAncestry.run(ancestry, () =>
          skillCallWorkflowService.execute({
            skillId,
            value: input,
            parentPlanId: parent.planId,
            parentInstanceId: parentExecutionId,
            parentNodeId,
            parentNodeRunId,
            ...(resumeChild === undefined ? {} : { resumeChild }),
            parentGoalId: parent.goalId,
            parentGoalVersion: parent.goalVersion,
            executionContext,
            ...(authorityTask === undefined
              ? {}
              : {
                  continuationAuthority: {
                    agentTaskId: authorityTask.taskId,
                    contextId: authorityTask.contextId,
                    workflowControlId: `control-task-${authorityTask.taskId}`,
                  },
                }),
            ...(signal === undefined ? {} : { signal }),
          }),
        );
      try {
        return await (authorityTask === undefined
          ? executeChild()
          : workflowTaskAuthority.run(authorityTask, executeChild));
      } catch (error) {
        process.stderr.write(
          JSON.stringify({
            event: 'workflow.skill_child_denied',
            skillId,
            parentNodeId,
            summary: error instanceof Error ? error.message : 'Unknown child failure',
          }) + '\n',
        );
        throw error;
      }
    },
    async executeSubworkflow({
      workflowDefinitionId,
      workflowVersion,
      input,
      parentExecutionId,
      parentNodeId,
      parentNodeRunId,
      resumeChild,
      signal,
      executionContext,
    }) {
      const key = `${workflowDefinitionId}@${String(workflowVersion)}`;
      const ancestry = workflowAncestry.getStore() ?? [];
      if (ancestry.includes(key) || ancestry.length >= 16)
        throw new WorkflowCompilerError(
          'WORKFLOW_SUBWORKFLOW_RECURSION_INVALID',
          'Subworkflow recursion or depth limit was reached.',
        );
      const parent = await workflowInstances.findInstance(parentExecutionId);
      if (parent === undefined) throw new Error('WORKFLOW_PARENT_INSTANCE_NOT_FOUND');
      const authorityTask =
        (await tasks.findByPlanId(parent.planId)) ?? workflowTaskAuthority.getStore();
      const execute = () =>
        workflowAncestry.run([...ancestry, key], () =>
          subworkflowExecution.execute({
            workflowDefinitionId,
            workflowVersion,
            input,
            parentInstanceId: parentExecutionId,
            parentNodeId,
            parentNodeRunId,
            executionContext,
            ...(signal === undefined ? {} : { signal }),
            ...(resumeChild === undefined ? {} : { resumeChild }),
            ...(authorityTask === undefined
              ? {}
              : {
                  continuationAuthority: {
                    agentTaskId: authorityTask.taskId,
                    contextId: authorityTask.contextId,
                    workflowControlId: `control-task-${authorityTask.taskId}`,
                  },
                }),
          }),
        );
      return authorityTask === undefined
        ? execute()
        : workflowTaskAuthority.run(authorityTask, execute);
    },
    requestHumanConfirmation: () => {
      throw new Error('WORKFLOW_HUMAN_CONFIRMATION_REQUIRED');
    },
    async decideExecutionError(input) {
      const instance =
        input.executionId === undefined
          ? undefined
          : await workflowInstances.findInstance(input.executionId);
      const plan = instance && (await workflowPlans.findPlan(instance.planId));
      if (
        plan?.confirmationStatus === 'confirmed' &&
        plan.definition?.skillUsagePolicy?.skill.skillId === 'embodied.area_patrol' &&
        plan.definition.skillUsagePolicy.skill.skillVersion >= 2
      ) {
        return {
          strategy: input.allowedStrategies.includes('continue')
            ? ('continue' as const)
            : ('terminate' as const),
          summary: `Preserved child failure ${input.error.code}; no physical redispatch is permitted.`,
        };
      }
      return executionExceptionDecider.decide(input);
    },
    now: clock.now,
    nowMilliseconds: () => Date.now(),
  };
  const langGraphExecutor = new LangGraphWorkflowExecutor(workflowPorts, workflowCallCosts);
  const workflowInstances = new PostgresWorkflowExecutionRepository(
    pool,
    taskCommands,
    deviceWorkScope,
  );
  const workflowContinuations = new PostgresWorkflowContinuationRepository(pool, deviceWorkScope);
  const workflowChildCalls = new PostgresWorkflowChildCallRepository(pool, deviceWorkScope);
  const workflowExecution = new WorkflowExecutionService({
    childCalls: workflowChildCalls,
    plans: workflowPlans,
    instances: workflowInstances,
    validator: workflowValidator,
    executor: langGraphExecutor,
    clock,
    ids: { nextEventId: () => `workflow-event-${randomUUID()}` },
    continuationIds: {
      nextSnapshotId: () => `workflow-continuation-snapshot-${randomUUID()}`,
      nextContinuationId: () => `workflow-continuation-${randomUUID()}`,
    },
    continuations: workflowContinuations,
    async onExternalWaitPrepared(prepared) {
      if (remoteTaskAdmissionIntents === undefined || prepared.completeness !== 'exact_final')
        return;
      for (const wait of prepared.snapshot.waitingNodeRuns) {
        if (wait.kind !== 'remote_task') continue;
        const intent = await remoteTaskAdmissionIntents.findByBindingId(wait.sourceId);
        if (
          intent?.status !== 'receipt_recorded' ||
          intent.receipt?.continuation.completeness !== 'requires_graph_merge'
        )
          continue;
        const mutation = await remoteTaskAdmissionIntents.replaceContinuation({
          intentId: intent.intentId,
          invocationId: intent.invocationId,
          continuation: prepared,
          at: clock.now(),
        });
        if (!mutation.applied)
          throw new Error(`REMOTE_TASK_ADMISSION_CONTINUATION_${mutation.reason.toUpperCase()}`);
      }
    },
    async onExternalWaitActivated(snapshot) {
      if (remoteTaskAdmissionIntents === undefined) return;
      for (const wait of snapshot.waitingNodeRuns) {
        if (wait.kind !== 'remote_task') continue;
        const intent = await remoteTaskAdmissionIntents.findByBindingId(wait.sourceId);
        if (intent === undefined) continue;
        const mutation = await remoteTaskAdmissionIntents.markMaterialized({
          intentId: intent.intentId,
          invocationId: intent.invocationId,
          bindingId: wait.sourceId,
          snapshotId: snapshot.snapshotId,
          at: clock.now(),
        });
        if (!mutation.applied)
          throw new Error(`REMOTE_TASK_ADMISSION_MATERIALIZE_${mutation.reason.toUpperCase()}`);
        if (
          remoteTaskProviderExecutionLinks !== undefined &&
          intent.logicalIdentity !== undefined &&
          intent.reconciliationContract !== undefined &&
          intent.receipt !== undefined
        ) {
          const reconciliationAttempt =
            remoteTaskReconciliationAttempts === undefined
              ? undefined
              : (await remoteTaskReconciliationAttempts.listByIntentId(intent.intentId))
                  .filter((attempt) => attempt.status === 'found_exact')
                  .at(-1);
          await remoteTaskProviderExecutionLinks.save(
            createRemoteTaskProviderExecutionLink({
              bindingId: wait.sourceId,
              logicalInvocationId: intent.logicalIdentity.logicalInvocationId,
              remoteTaskId: intent.receipt.remoteTask.remoteTaskId,
              providerId: intent.reconciliationContract.providerId,
              runtimeServerId: intent.logicalIdentity.serverId,
              ...(intent.reconciliationContract.authoritySnapshot.providerBinding === undefined
                ? {}
                : {
                    providerBindingId:
                      intent.reconciliationContract.authoritySnapshot.providerBinding.bindingId,
                    providerOriginType:
                      intent.reconciliationContract.authoritySnapshot.providerBinding.originType,
                    ...(intent.reconciliationContract.authoritySnapshot.providerBinding
                      .smppSourceId === undefined
                      ? {}
                      : {
                          smppSourceId:
                            intent.reconciliationContract.authoritySnapshot.providerBinding
                              .smppSourceId,
                        }),
                    ...(intent.reconciliationContract.authoritySnapshot.providerBinding
                      .externalServerId === undefined
                      ? {}
                      : {
                          externalServerId:
                            intent.reconciliationContract.authoritySnapshot.providerBinding
                              .externalServerId,
                        }),
                  }),
              operationName: intent.operationName,
              executionStatus:
                reconciliationAttempt?.externalExecutionId === undefined ? 'unresolved' : 'exact',
              ...(reconciliationAttempt?.externalExecutionId === undefined
                ? {}
                : { externalExecutionId: reconciliationAttempt.externalExecutionId }),
              missionStatus: 'unresolved',
              provenance:
                reconciliationAttempt === undefined ? 'committed_receipt' : 'reconcile_found_exact',
              sourceContract: 'sdar.node-control-provider-binding/v1+frozen-mcp-v1',
              sourceRevision:
                intent.reconciliationContract.authoritySnapshot.providerBinding === undefined
                  ? `runtime:${intent.reconciliationContract.authoritySnapshot.runtime.serverUpdatedAt}/catalog:${intent.reconciliationContract.authoritySnapshot.runtime.catalogRevision}`
                  : `binding:${String(intent.reconciliationContract.authoritySnapshot.providerBinding.revision)}/catalog:${intent.reconciliationContract.authoritySnapshot.providerBinding.catalogRevision}`,
              observedAt: intent.receiptRecordedAt ?? intent.updatedAt,
            }),
          );
        }
      }
    },
    async onContinuationActivationFailure({ snapshot, error }) {
      const compensationFailures: unknown[] = [];
      for (const wait of snapshot.waitingNodeRuns) {
        if (wait.kind === 'child_workflow') {
          try {
            const childSnapshot = await workflowContinuations.findCurrent(wait.sourceId);
            const childInstance = await workflowInstances.findInstance(wait.sourceId);
            const invalidatedAt = clock.now();
            if (childSnapshot !== undefined)
              await workflowContinuations.transitionLifecycle(
                childSnapshot.snapshotId,
                'active',
                'invalidated',
                invalidatedAt,
              );
            if (childInstance?.status === 'waiting_external')
              await workflowInstances.saveInstance({
                ...childInstance,
                status: 'canceled',
                errors: {
                  ...childInstance.errors,
                  parentContinuation: {
                    code: 'WORKFLOW_PARENT_CONTINUATION_ACTIVATION_FAILED',
                    message: 'Parent continuation activation failed after the child began waiting.',
                  },
                },
                completedAt: invalidatedAt,
              });
          } catch (childCompensationError: unknown) {
            compensationFailures.push(childCompensationError);
          }
          continue;
        }
        if (remoteTaskRepository === undefined) continue;
        const binding = await remoteTaskRepository.findById(wait.sourceId);
        if (binding === undefined) {
          compensationFailures.push(new Error('REMOTE_TASK_BINDING_NOT_FOUND'));
          continue;
        }
        let cancellationDisposition:
          | Awaited<ReturnType<RemoteTaskCancellationService['request']>>['disposition']
          | 'service_unavailable' = 'service_unavailable';
        let cancellationDeliveryScheduled = false;
        let cancellationFailure: string | undefined;
        try {
          if (remoteTaskCancellation === undefined)
            throw new Error('REMOTE_TASK_CANCELLATION_SERVICE_UNAVAILABLE');
          const cancellation = await requestContinuationActivationFailureCancellation(
            remoteTaskCancellation,
            {
              bindingId: binding.bindingId,
              snapshotId: snapshot.snapshotId,
              workflowInstanceId: snapshot.workflowInstanceId,
            },
          );
          cancellationDisposition = cancellation.disposition;
          cancellationDeliveryScheduled = cancellation.deliveryScheduled;
        } catch (cancellationError: unknown) {
          compensationFailures.push(cancellationError);
          cancellationFailure =
            cancellationError instanceof Error
              ? cancellationError.name
              : 'REMOTE_TASK_CANCEL_FAILED';
        }
        process.stderr.write(
          `${JSON.stringify({
            event: 'workflow_continuation.activation_failed',
            code: 'WORKFLOW_CONTINUATION_ACTIVATION_FAILED',
            bindingId: binding.bindingId,
            serverId: binding.serverId,
            remoteTaskId: binding.remoteTaskId,
            workflowInstanceId: snapshot.workflowInstanceId,
            cancellationDisposition,
            cancellationDeliveryScheduled,
            ...(cancellationFailure === undefined ? {} : { cancellationFailure }),
            cause:
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              typeof error.code === 'string'
                ? error.code
                : 'PERSISTENCE_FAILURE',
          })}\n`,
        );
      }
      if (compensationFailures.length > 0)
        throw new AggregateError(
          compensationFailures,
          'One or more remote Tasks could not be compensated after continuation activation failed.',
          { cause: error },
        );
    },
    skills,
    systemBudgetDefaults: workflowBudgetDefaults,
  });
  const subworkflowExecution = new SubworkflowExecutionService({
    calls: workflowChildCalls,
    plans: workflowPlans,
    execution: workflowExecution,
    clock,
  });
  const skillConfirmation = new TransitiveSkillConfirmationEvaluator({
    skills,
    graph: skillGraphRepository,
  });
  const skillCallWorkflowService = new SkillCallWorkflowService({
    governedChildren: {
      prepare: (input) =>
        dependencies.governedPatrolChildren.value?.prepare(input) ?? Promise.resolve(undefined),
      attach: (input) =>
        dependencies.governedPatrolChildren.value?.attach(input) ?? Promise.resolve(),
      confirm: (planId, authority) =>
        dependencies.governedPatrolChildren.value?.confirm(planId, authority) ??
        Promise.resolve(false),
      execute: (input) =>
        dependencies.governedPatrolChildren.value?.execute(input) ?? Promise.resolve(undefined),
      reject: (planId) =>
        dependencies.governedPatrolChildren.value?.reject(planId) ?? Promise.resolve(),
      cancelChildren: (taskId, planId) =>
        dependencies.governedPatrolChildren.value?.cancelChildren(taskId, planId) ??
        Promise.resolve(),
    },
    skills,
    planner: workflowPlanner,
    planUsage(request, usage) {
      if (usage?.selectedTaskOperation === undefined) return workflowPlanner.plan(request);
      return dependencies.ugvWorkflowCandidateGuard.run(
        new UgvMoveWorkflowCandidateGuard({
          selectedTaskOperation: usage.selectedTaskOperation,
          skillUsagePolicy: usage.prepared.policy,
          taskId: request.taskId ?? '',
          workflowDefinitionId: request.workflowDefinitionId,
          workflowVersion: request.workflowVersion,
          goalId: request.goalId,
          goalVersion: request.goalVersion,
          clock,
        }),
        () => workflowPlanner.plan(request),
      );
    },
    validator: workflowValidator,
    execution: workflowExecution,
    plans: workflowPlans,
    confirmation: skillConfirmation,
    records: skillCallWorkflows,
    schemas: schemaValidator,
    loadToolPlanningMetadata: (skill, taskOperations) =>
      buildMcpToolPlanningMetadata(
        {
          required: uniqueToolReferences([
            ...skill.toolPolicy.required,
            ...taskOperations.map((operation) => ({
              serverId: operation.providerId,
              toolName: operation.operationName,
            })),
          ]),
          optional: skill.toolPolicy.optional,
          forbidden: skill.toolPolicy.forbidden,
        },
        async (reference) =>
          (await mcpRepository.listTools(reference.serverId)).find(
            (tool) => tool.toolName === reference.toolName,
          ),
      ),
    async prepareUsage({ skill, value, goalContract, workflowDefinitionId, taskId }) {
      const task = taskId === undefined ? undefined : await tasks.findById(taskId);
      const authority =
        taskId === undefined
          ? undefined
          : await taskCapabilities.resolveSkillUsageAuthority(taskId);
      const binding = taskId === undefined ? undefined : await taskCapabilities.findBinding(taskId);
      const usageContext =
        authority === undefined
          ? await resolveSkillUsageContext(goalContract, task)
          : isHistoricalUgvPointSkill(skill.skillId, skill.version) && binding !== undefined
            ? resolveUgvMoveSkillUsageContext({ authority, binding })
            : authority.context;
      const candidate = await dependencies.profileSkillUsage.assess(
        skill,
        skill.usageSpecification === undefined
          ? {
              ...usageContext,
              risk: 'low',
              systemPolicy: {
                ...usageContext.systemPolicy,
                preferredMode: 'guidance',
                requireProcedureForHighRisk: false,
              },
            }
          : usageContext,
      );
      if (candidate.modeDecision.decision !== 'selected')
        throw new Error('CHILD_SKILL_USAGE_MODE_NOT_SELECTED');
      const composition = await skillComposition.composeUsage(
        { skillId: skill.skillId, skillVersion: skill.version },
        await resolveSkillUsageSlotChoices(goalContract, skill, value, task),
      );
      const interpretation = skillComposition.interpretUsage(
        skill,
        candidate.modeDecision,
        composition,
      );
      if (isHistoricalUgvPointSkill(skill.skillId, skill.version)) {
        if (!task || !dependencies.ugvMoveBindingResolver)
          throw Error('COMPOSED_MOVE_BINDING_REQUIRED');
        const resolution = await dependencies.skillInputResolutionRepository.findLatest(
          task.taskId,
          skill.skillId,
          skill.version,
          goalContract.version,
        );
        const executionContext = await taskCapabilities.resolveRuntimeExecutionContext(task.taskId);
        const binding = await taskCapabilities.findBinding(task.taskId);
        if (
          !resolution ||
          !binding ||
          !executionContext ||
          executionContext.mode === 'historical-replay'
        )
          throw Error('COMPOSED_MOVE_INPUT_AUTHORITY_REQUIRED');
        const resolved = await dependencies.ugvMoveBindingResolver.resolve({
          skillInput: value,
          executionContext,
        });
        assertUgvAgentProfileMoveInputAuthority({
          binding,
          resolution,
          selectedTaskOperation: resolved.selected,
        });
        return {
          prepared: prepareUgvMoveWorkflowPlan({
            skill,
            candidate,
            interpretation,
            goalContract,
            workflowDefinitionId,
            workflowVersion: skill.version,
            selectedTaskOperation: resolved.selected,
          }),
          applicabilityStatus: candidate.applicability.status,
          selectedTaskOperation: resolved.selected,
        };
      }
      return {
        prepared: prepareSkillUsagePlan({
          skill,
          candidate,
          interpretation,
          goalContract,
          workflowDefinitionId,
          workflowVersion: skill.version,
        }),
        applicabilityStatus: candidate.applicability.status,
      };
    },
    async onUsagePlanPrepared({ skill, plan, preparedUsage, parentPlanId }) {
      await recordSkillProjectionSafely(async () => {
        const parent = await skillExecutionRepository.findByPlan(parentPlanId);
        if (parent === undefined || plan.definition === undefined) return;
        await skillExecutionRecording.recordPlanning({
          executionId: `skill-execution-${plan.planId}`,
          parentExecutionId: parent.executionId,
          taskId: plan.executionTaskId ?? parent.taskId,
          goalId: plan.goalId,
          goalVersion: plan.goalVersion,
          selectionRef: `composition:${parent.executionId}:${skill.skillId}@${String(skill.version)}`,
          applicabilityStatus: preparedUsage.applicabilityStatus,
          policy: preparedUsage.prepared.policy,
          workflowPlanId: plan.planId,
          workflowDefinitionId: plan.definition.workflowDefinitionId,
          workflowDefinitionVersion: plan.definition.version,
          procedureCompiled:
            preparedUsage.prepared.deterministicDefinition !== undefined &&
            preparedUsage.prepared.policy.mode === 'procedure',
          planCompliancePassed: true,
        });
      });
      if (preparedUsage.selectedTaskOperation !== undefined) {
        if (!ugvMoveWorkflowAuthority || !plan.executionTaskId || !plan.definition)
          throw Error('COMPOSED_MOVE_WORKFLOW_AUTHORITY_REQUIRED');
        await ugvMoveWorkflowAuthority.append(
          {
            taskId: plan.executionTaskId,
            workflowPlanId: plan.planId,
            workflowDefinitionId: plan.definition.workflowDefinitionId,
            workflowDefinitionVersion: plan.definition.version,
            goalId: plan.goalId,
            goalVersion: plan.goalVersion,
            skillId: skill.skillId,
            skillVersion: skill.version,
          },
          preparedUsage.selectedTaskOperation,
        );
      }
    },
    async onExecutionStatus({ childPlanId, childInstanceId, status, summary }) {
      await recordSkillProjectionSafely(async () => {
        const projectedStatus = areaReportChildExecutionStatus(
          childInstanceId === undefined
            ? undefined
            : await workflowInstances.findInstance(childInstanceId),
          status,
        );
        if (childInstanceId !== undefined && ['completed', 'failed', 'cancelled'].includes(status))
          await skillExecutionRecording.recordReference({
            workflowPlanId: childPlanId,
            kind: 'outcome',
            referenceId: childInstanceId,
            referenceType: 'workflow.instance.outcome',
            sourceSystem: 'skill_call_workflow',
            producerRefs: [childInstanceId],
            metadata: { status },
          });
        await skillExecutionRecording.recordStatus({
          workflowPlanId: childPlanId,
          eventType:
            projectedStatus === 'degraded'
              ? 'skill.execution_degraded'
              : status === 'executing'
                ? 'skill.execution_started'
                : status === 'waiting_external'
                  ? 'skill.execution_waiting_external'
                  : status === 'completed'
                    ? 'skill.execution_completed'
                    : 'skill.execution_failed',
          status: projectedStatus,
          summary,
          ...(childInstanceId === undefined ? {} : { details: { childInstanceId } }),
        });
      });
    },
    clock,
    nextId: randomUUID,
  });
  const workflowRevision = new WorkflowRevisionService({
    plans: workflowPlans,
    planner: workflowPlanner,
    validator: workflowValidator,
    clock,
  });
  return {
    workflowInstances,
    workflowExecution,
    skillCallWorkflowService,
    workflowRevision,
    workflowContinuations,
    skillConfirmation,
    workflowChildCalls,
  };
}
