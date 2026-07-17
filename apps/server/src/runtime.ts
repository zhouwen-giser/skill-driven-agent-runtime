import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import {
  startA2AHttpEndpoint,
  type A2AHttpEndpointHandle,
} from '../../../packages/a2a-adapter/src/http-endpoint.js';
import { A2AProjectionTaskStore } from '../../../packages/a2a-adapter/src/postgres-task-store.js';
import { TaskServiceAgentExecutor } from '../../../packages/a2a-adapter/src/task-service-executor.js';
import {
  PlanPreparationProcessor,
  ResultProcessor,
  ResultProcessingService,
  MemoryService,
  MemoryRetentionPolicyService,
  RuntimeRecoveryService,
  McpRegistryService,
  RemoteTaskAdmissionService,
  RemoteTaskPollingService,
  RemoteTaskReconciler,
  RemoteTaskContinuationService,
  RemoteTaskContinuationReconciler,
  RemoteTaskInputService,
  RemoteTaskCancellationService,
  RemoteTaskCancellationReconciler,
  RemoteTaskCancellationWorker,
  McpTaskReadinessService,
  StructuredTaskRiskDecider,
  StructuredMcpToolEnhancer,
  buildMcpToolPlanningMetadata,
  snapshotMcpToolPlanningExecutionSemantics,
  ModelRuntimeService,
  PromptService,
  SkillGraphService,
  SkillCompositionPlanner,
  SkillAuthoringService,
  SkillSelectionService,
  SkillInputResolutionService,
  SkillQualityService,
  SkillCallWorkflowService,
  TransitiveSkillConfirmationEvaluator,
  nextSkillCallAncestry,
  validateSkillToolPolicies,
  PersistedSkillSemanticRetriever,
  SkillRegistryService,
  SkillPackageImporter,
  SkillPackageValidator,
  TemporarySkillService,
  TemporarySkillResolver,
  SkillEvolutionService,
  EvolutionExperienceService,
  EvolutionPolicyService,
  WorkflowValidator,
  WorkflowPlannerService,
  WorkflowTemplateService,
  WorkflowExecutionService,
  WorkflowControllerService,
  StructuredGoalEvaluator,
  StructuredSkillSelectionDecider,
  StructuredTaskDecisionService,
  StructuredExecutionExceptionDecider,
  GoalService,
  GoalPatchService,
  GoalCancellationService,
  GoalInputInferenceService,
  WorkflowRevisionService,
  TaskService,
  TaskAttemptDispatchService,
  TaskWaitTimeoutService,
  TaskQualityEvaluationService,
  EvaluationInfluenceService,
  EvaluationAnalyticsService,
  ImplicitFeedbackService,
  InMemoryTaskStateNotifier,
  type RegisterSkillVersionInput,
  type StructuredModelProvider,
  type SkillSelectionDecider,
  type TextEmbeddingProvider,
  type RemoteTaskPollingOptions,
} from '../../../packages/application/src/index.js';
import {
  createGoalExecutionContract,
  goalExecutionContractsEqual,
  isTerminalWorkflowControlStatus,
  type AgentTask,
  type GoalExecutionContract,
  type McpInvocationOutcome,
  type SkillVersion,
  type WorkflowBudgetLimits,
  type WorkflowContinuationSnapshot,
  type WorkflowInstance,
} from '../../../packages/domain/src/index.js';
import { Aes256GcmSecretCipher } from '../../../packages/crypto-adapter/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { StreamableHttpMcpAdapter } from '../../../packages/mcp-adapter/src/index.js';
import { NodeSkillPackageReader } from '../../../packages/skill-package-adapter/src/index.js';
import { CompositeModelTransportAdapter } from '../../../packages/model-provider-adapter/src/index.js';
import {
  LangGraphWorkflowExecutor,
  WorkflowCompilerError,
  type WorkflowCallCosts,
  type WorkflowRuntimePorts,
} from '../../../packages/langgraph-runtime/src/index.js';
import {
  startManagementHttpEndpoint,
  type ManagementHttpEndpointHandle,
} from '../../../packages/management-api/src/index.js';
import {
  PostgresAgentTaskRepository,
  PostgresConversationContextRepository,
  PostgresExternalTaskProjectionRepository,
  PostgresMcpRegistryRepository,
  PostgresModelRuntimeRepository,
  PostgresPromptRepository,
  PostgresRuntimeEventPublisher,
  PostgresRuntimeRecoveryRepository,
  PostgresSkillDraftRepository,
  PostgresSkillEmbeddingRepository,
  PostgresSkillGraphRepository,
  PostgresSkillRepository,
  PostgresSkillSelectionRepository,
  PostgresSkillInputResolutionRepository,
  PostgresSkillQualityRepository,
  PostgresSkillCallWorkflowRepository,
  PostgresTemporarySkillRepository,
  PostgresWorkflowPlanRepository,
  PostgresWorkflowTemplateRepository,
  PostgresWorkflowExecutionRepository,
  PostgresWorkflowControlRepository,
  PostgresGoalRepository,
  PostgresGoalPatchRepository,
  PostgresGoalCancellationRepository,
  PostgresProcessedResultRepository,
  PostgresRuntimeTerminalOutcomeRepository,
  PostgresTaskQualityReportRepository,
  PostgresEvaluationInfluenceRepository,
  PostgresEvaluationAnalyticsRepository,
  PostgresImplicitFeedbackRepository,
  PostgresMemoryRepository,
  PostgresMemoryRetentionPolicyRepository,
  PostgresGoalInputInferenceRepository,
  PostgresTaskWaitPolicyRepository,
  PostgresTaskInputRepository,
  PostgresEvolutionExperienceRepository,
  PostgresEvolutionPolicyRepository,
  PostgresRemoteTaskRepository,
  PostgresRemoteTaskInputRepository,
  PostgresRemoteTaskCancellationRepository,
  PostgresRemoteTaskLifecycleQuery,
  PostgresWorkflowContinuationRepository,
  PostgresTaskAvailabilityEvidenceRepository,
} from '../../../packages/persistence-postgres/src/index.js';
import {
  BullMqContextTaskQueue,
  BullMqContextWorker,
  BullMqRemoteTaskPollQueue,
  BullMqRemoteTaskPollWorker,
  BullMqRemoteTaskContinuationQueue,
  BullMqRemoteTaskContinuationWorker,
  BullMqRemoteTaskCancellationQueue,
  BullMqRemoteTaskCancellationWorker,
  ContextSerialExecutor,
  type RedisConnectionConfig,
} from '../../../packages/runtime-redis/src/index.js';

export interface ServerRuntimeOptions {
  readonly postgresUrl: string;
  readonly redis: RedisConnectionConfig;
  readonly masterKeyBase64: string;
  readonly queueName?: string;
  readonly applyMigrations?: boolean;
  readonly a2aHost?: string;
  readonly a2aPort?: number;
  readonly managementHost?: string;
  readonly managementPort?: number;
  readonly skillAuthoringModel?: StructuredModelProvider;
  readonly skillSelection?: Readonly<{
    embeddings: TextEmbeddingProvider;
    decider?: SkillSelectionDecider;
  }>;
  readonly workflowBudgetDefaults?: WorkflowBudgetLimits;
  readonly workflowCallCosts?: WorkflowCallCosts;
  readonly taskWaitSweepIntervalMs?: number;
  readonly taskAttemptDispatchIntervalMs?: number;
  readonly v11McpTasks?: Readonly<{
    /** Explicit opt-in for the additive V1.1 migration/runtime profile. */
    isolationAcknowledged: true;
    queueName?: string;
    reconcileIntervalMs?: number;
    polling?: RemoteTaskPollingOptions;
  }>;
  readonly a2aWaitTimeoutMs?: number;
  readonly a2aSafetyPollIntervalMs?: number;
}

export interface ServerRuntimeHandle {
  readonly a2a: A2AHttpEndpointHandle;
  readonly management: ManagementHttpEndpointHandle;
  requestInput(taskId: string, reason: string): Promise<void>;
  listSkillDrafts(contextId: string): ReturnType<PostgresSkillDraftRepository['listByContextId']>;
  registerSkill(input: RegisterSkillVersionInput): Promise<SkillVersion>;
  setSkillEnabled(skillId: string, enabled: boolean): Promise<SkillVersion>;
  failTask(taskId: string, errorCode: string, message: string): Promise<void>;
  recordResultForSkill(
    taskId: string,
    skillId: string,
    candidate: Readonly<{ text: string; structured: unknown }>,
  ): Promise<void>;
  registerMcpServer(
    input: Parameters<McpRegistryService['register']>[0],
  ): ReturnType<McpRegistryService['register']>;
  refreshMcpServer(serverId: string): ReturnType<McpRegistryService['refresh']>;
  callMcpTool(
    serverId: string,
    toolName: string,
    arguments_: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
    context?: Parameters<McpRegistryService['call']>[4],
  ): Promise<unknown>;
  deleteMcpServer(serverId: string): Promise<void>;
  listMcpInvocations(serverId: string): ReturnType<McpRegistryService['listInvocations']>;
  listSkillCallWorkflows(
    parentInstanceId: string,
  ): ReturnType<PostgresSkillCallWorkflowRepository['listByParent']>;
  getWorkflowInstance(
    instanceId: string,
  ): ReturnType<PostgresWorkflowExecutionRepository['findInstance']>;
  listMcpDependencyWarnings(
    serverId: string,
  ): ReturnType<McpRegistryService['listDependencyWarnings']>;
  updateMcpToolEnhancement(
    serverId: string,
    toolName: string,
    enhancement: Parameters<McpRegistryService['updateToolEnhancement']>[2],
  ): Promise<void>;
  close(): Promise<void>;
}

export async function startServerRuntime(
  options: ServerRuntimeOptions,
): Promise<ServerRuntimeHandle> {
  const pool = new Pool({ connectionString: options.postgresUrl, max: 10 });
  const taskStateNotifier = new InMemoryTaskStateNotifier();
  const publishTaskState = (task: AgentTask) => {
    taskStateNotifier.publish(task);
  };
  if (options.applyMigrations === true) {
    await applyRuntimeMigrations(
      pool,
      options.v11McpTasks === undefined
        ? { profile: 'released' }
        : { profile: 'v1.1-isolated', isolationAcknowledged: true },
    );
  } else if (options.v11McpTasks !== undefined) {
    await assertV11RuntimeReady(pool);
  }
  const contexts = new PostgresConversationContextRepository(pool);
  const goals = new PostgresGoalRepository(pool);
  const tasks = new PostgresAgentTaskRepository(pool, publishTaskState);
  const taskInputs = new PostgresTaskInputRepository(pool, publishTaskState);
  const events = new PostgresRuntimeEventPublisher(pool);
  const skillDrafts = new PostgresSkillDraftRepository(pool);
  const skills = new PostgresSkillRepository(pool);
  const skillGraphRepository = new PostgresSkillGraphRepository(pool);
  const skillSelectionRepository = new PostgresSkillSelectionRepository(pool);
  const mcpRepository = new PostgresMcpRegistryRepository(pool, {
    v11TaskMetadata: options.v11McpTasks !== undefined,
  });
  const temporarySkillRepository = new PostgresTemporarySkillRepository(pool);
  const evolutionPolicyRepository = new PostgresEvolutionPolicyRepository(pool);
  const evolutionExperienceRepository = new PostgresEvolutionExperienceRepository(pool);
  const queueName = options.queueName ?? 'sdar-context-tasks';
  const queue = new BullMqContextTaskQueue({ connection: options.redis, queueName });
  const contextSerial = new ContextSerialExecutor();
  const ids = { nextId: (kind: 'context' | 'task' | 'event') => `${kind}-${randomUUID()}` };
  const clock = { now: () => new Date().toISOString() };
  const secretCipher = new Aes256GcmSecretCipher(options.masterKeyBase64);
  const implicitFeedback = new ImplicitFeedbackService({
    repository: new PostgresImplicitFeedbackRepository(pool),
    clock,
    nextId: () => `implicit-feedback-${randomUUID()}`,
  });
  const workflowTemplates = new WorkflowTemplateService({
    repository: new PostgresWorkflowTemplateRepository(pool),
    clock,
    ids: {
      nextTemplateId: () => `workflow-template-${randomUUID()}`,
      nextUseId: () => `workflow-template-use-${randomUUID()}`,
    },
  });
  const evolutionExperiences = new EvolutionExperienceService({
    repository: evolutionExperienceRepository,
    nextId: () => `evolution-experience-${randomUUID()}`,
    templates: workflowTemplates,
  });
  const evolutionPolicy = new EvolutionPolicyService({
    repository: evolutionPolicyRepository,
    clock,
  });
  const taskWaitTimeouts = new TaskWaitTimeoutService({
    repository: new PostgresTaskWaitPolicyRepository(pool, publishTaskState),
    clock,
  });
  await new RuntimeRecoveryService({
    repository: new PostgresRuntimeRecoveryRepository(pool, publishTaskState, {
      preserveRemoteWaits: options.v11McpTasks !== undefined,
    }),
    clock,
  }).failInterruptedExecutions();
  const taskAttemptDispatch = new TaskAttemptDispatchService({ attempts: taskInputs, queue });
  await taskAttemptDispatch.dispatchQueued();
  const workflowBudgetDefaults = options.workflowBudgetDefaults ?? {
    maxReplans: 3,
    maxDurationSeconds: 300,
    maxLlmCalls: 20,
    maxMcpCalls: 20,
    maxCost: 100,
  };
  const workflowCallCosts = options.workflowCallCosts ?? {
    llm: 1,
    mcp: 1,
    skill: 1,
    subworkflow: 1,
  };
  const modelRuntime = new ModelRuntimeService({
    repository: new PostgresModelRuntimeRepository(pool),
    transport: new CompositeModelTransportAdapter(),
    cipher: secretCipher,
    clock,
    ids: { nextInvocationId: () => `model-invocation-${randomUUID()}` },
  });
  const schemaValidator = new AjvJsonSchemaValidator();
  const skillPackageSchema = JSON.parse(
    await readFile(resolve(process.cwd(), 'schemas', 'skill-package.schema.json'), 'utf8'),
  ) as unknown;
  const skillPackages = new SkillPackageImporter({
    reader: new NodeSkillPackageReader(),
    validator: new SkillPackageValidator({
      schemas: schemaValidator,
      packageSchema: skillPackageSchema,
    }),
    clock,
  });
  const skillComposition = new SkillCompositionPlanner({
    skills,
    graph: skillGraphRepository,
  });
  const workflowValidator = new WorkflowValidator({
    tools: mcpRepository,
    skills,
    schemas: schemaValidator,
  });
  const workflowSchema = JSON.parse(
    await readFile(resolve(process.cwd(), 'schemas', 'workflow-dsl.schema.json'), 'utf8'),
  ) as unknown;
  const memories = new MemoryService({
    repository: new PostgresMemoryRepository(pool),
    embeddings: { embed: (text) => modelRuntime.embed('goal', text) },
    clock,
    nextId: () => `memory-${randomUUID()}`,
    nextTransitionId: () => `memory-transition-${randomUUID()}`,
    model: modelRuntime,
  });
  const memoryRetention = new MemoryRetentionPolicyService({
    repository: new PostgresMemoryRetentionPolicyRepository(pool),
    clock,
  });
  const prompts = new PromptService({
    repository: new PostgresPromptRepository(pool),
    clock,
    memories,
  });
  const resultProcessor = new ResultProcessor(schemaValidator);
  const resultProcessing = new ResultProcessingService({
    model: modelRuntime,
    processor: resultProcessor,
    repository: new PostgresProcessedResultRepository(pool),
    clock,
    nextId: () => `processed-result-${randomUUID()}`,
    memories,
  });
  const runtimeTerminalOutcomes = new PostgresRuntimeTerminalOutcomeRepository(
    pool,
    publishTaskState,
  );
  const goalInputInference = new GoalInputInferenceService({
    repository: new PostgresGoalInputInferenceRepository(pool),
    memories,
    model: modelRuntime,
    clock,
    nextId: () => `goal-input-inference-${randomUUID()}`,
  });
  const skillRegistry = new SkillRegistryService({
    skills,
    validator: schemaValidator,
    clock,
    packages: skillPackages,
  });
  const skillQuality = new SkillQualityService({
    repository: new PostgresSkillQualityRepository(pool),
    skills,
    clock,
    ids: {
      nextObservationId: () => `skill-quality-observation-${randomUUID()}`,
      nextWarningId: () => `skill-quality-warning-${randomUUID()}`,
    },
  });
  const evaluationInfluences = new EvaluationInfluenceService({
    repository: new PostgresEvaluationInfluenceRepository(pool),
    experiences: evolutionExperiences,
    skillQuality,
    templates: workflowTemplates,
    prompts,
    model: modelRuntime,
    clock,
    nextId: () => `evaluation-influence-${randomUUID()}`,
  });
  const evaluationAnalytics = new EvaluationAnalyticsService({
    repository: new PostgresEvaluationAnalyticsRepository(pool),
  });
  const taskQuality = new TaskQualityEvaluationService({
    model: modelRuntime,
    repository: new PostgresTaskQualityReportRepository(pool),
    clock,
    nextId: () => `task-quality-report-${randomUUID()}`,
    influences: evaluationInfluences,
  });
  const skillAuthoring = new SkillAuthoringService({
    model: options.skillAuthoringModel ?? modelRuntime,
    schemas: schemaValidator,
    registry: skillRegistry,
    maxAttempts: 2,
    drafts: skillDrafts,
    clock,
  });
  const skillGraph = new SkillGraphService({
    graph: skillGraphRepository,
    skills,
    clock,
    ids: { nextRelationId: () => `skill-relation-${randomUUID()}` },
  });
  const skillSelection =
    options.skillSelection === undefined
      ? undefined
      : new SkillSelectionService({
          skills,
          graph: skillGraphRepository,
          records: skillSelectionRepository,
          retriever: new PersistedSkillSemanticRetriever({
            embeddings: options.skillSelection.embeddings,
            repository: new PostgresSkillEmbeddingRepository(pool),
            clock,
          }),
          decider:
            options.skillSelection.decider ??
            new StructuredSkillSelectionDecider(modelRuntime, memories),
          mcpWarnings: mcpRepository,
          clock,
          ids: {
            nextSelectionId: () => `skill-selection-${randomUUID()}`,
            nextReplacementPlanId: () => `skill-replacement-${randomUUID()}`,
          },
        });
  const skillInputResolutionRepository = new PostgresSkillInputResolutionRepository(pool);
  const skillInputResolution = new SkillInputResolutionService({
    model: modelRuntime,
    schemas: schemaValidator,
    records: skillInputResolutionRepository,
    memories,
    clock,
    nextId: () => `skill-input-resolution-${randomUUID()}`,
  });
  const mcpTransport = new StreamableHttpMcpAdapter();
  const mcpRegistry = new McpRegistryService({
    repository: mcpRepository,
    transport: mcpTransport,
    cipher: secretCipher,
    schemas: schemaValidator,
    enhancer: new StructuredMcpToolEnhancer(modelRuntime),
    clock,
    ids: {
      nextInvocationId: () => `mcp-invocation-${randomUUID()}`,
      nextManagementOperationId: () => `mcp-management-operation-${randomUUID()}`,
    },
  });
  const taskAvailabilityEvidence =
    options.v11McpTasks === undefined
      ? undefined
      : new PostgresTaskAvailabilityEvidenceRepository(pool);
  const taskReadiness =
    taskAvailabilityEvidence === undefined
      ? undefined
      : new McpTaskReadinessService({
          operations: mcpRepository,
          provider: mcpRegistry,
          evidence: taskAvailabilityEvidence,
          riskDecider: new StructuredTaskRiskDecider(modelRuntime),
          clock,
          ids: {
            nextReadinessId: () => `task-readiness-${randomUUID()}`,
            nextSnapshotId: () => `task-availability-${randomUUID()}`,
          },
        });
  const workflowPlanner = new WorkflowPlannerService({
    model: modelRuntime,
    validator: workflowValidator,
    repository: new PostgresWorkflowPlanRepository(pool),
    workflowSchema,
    clock,
    maxAttempts: 3,
    composition: skillComposition,
    templates: workflowTemplates,
    memories,
    ...(taskReadiness === undefined ? {} : { readiness: taskReadiness }),
  });
  const remoteTaskRepository =
    options.v11McpTasks === undefined ? undefined : new PostgresRemoteTaskRepository(pool);
  const remoteTaskQueue =
    options.v11McpTasks === undefined
      ? undefined
      : new BullMqRemoteTaskPollQueue({
          connection: options.redis,
          ...(options.v11McpTasks.queueName === undefined
            ? {}
            : { queueName: options.v11McpTasks.queueName }),
        });
  const remoteTaskContinuationQueueName =
    options.v11McpTasks?.queueName === undefined
      ? undefined
      : `${options.v11McpTasks.queueName}-continuations`;
  const remoteTaskContinuationQueue =
    options.v11McpTasks === undefined
      ? undefined
      : new BullMqRemoteTaskContinuationQueue({
          connection: options.redis,
          ...(remoteTaskContinuationQueueName === undefined
            ? {}
            : { queueName: remoteTaskContinuationQueueName }),
        });
  const remoteTaskCancellationQueueName =
    options.v11McpTasks?.queueName === undefined
      ? undefined
      : `${options.v11McpTasks.queueName}-cancellations`;
  const remoteTaskCancellationQueue =
    options.v11McpTasks === undefined
      ? undefined
      : new BullMqRemoteTaskCancellationQueue({
          connection: options.redis,
          ...(remoteTaskCancellationQueueName === undefined
            ? {}
            : { queueName: remoteTaskCancellationQueueName }),
        });
  const remoteTaskPolling =
    remoteTaskRepository === undefined || remoteTaskQueue === undefined
      ? undefined
      : new RemoteTaskPollingService({
          repository: remoteTaskRepository,
          queue: remoteTaskQueue,
          reader: mcpRegistry,
          serial: contextSerial,
          clock,
          ids: {
            nextObservationId: () => `remote-task-observation-${randomUUID()}`,
            nextControlEventId: () => `remote-task-control-${randomUUID()}`,
            nextClaimToken: () => `remote-task-claim-${randomUUID()}`,
            nextProtocolAttemptId: () => `remote-task-protocol-attempt-${randomUUID()}`,
          },
          hash: (value) => createHash('sha256').update(canonicalJson(value)).digest('hex'),
          ...(options.v11McpTasks?.polling === undefined
            ? {}
            : { options: options.v11McpTasks.polling }),
        });
  const remoteTaskAdmission =
    remoteTaskRepository === undefined || remoteTaskQueue === undefined
      ? undefined
      : new RemoteTaskAdmissionService({
          repository: remoteTaskRepository,
          queue: remoteTaskQueue,
          nextObservationId: () => `remote-task-observation-${randomUUID()}`,
        });
  const remoteTaskReconciler =
    remoteTaskRepository === undefined || remoteTaskQueue === undefined
      ? undefined
      : new RemoteTaskReconciler({
          repository: remoteTaskRepository,
          queue: remoteTaskQueue,
          clock,
        });
  let remoteTaskInput: RemoteTaskInputService | undefined;
  const remoteTaskCancellations =
    remoteTaskRepository === undefined || remoteTaskCancellationQueue === undefined
      ? undefined
      : new PostgresRemoteTaskCancellationRepository(pool);
  const remoteTaskCancellation =
    remoteTaskRepository === undefined ||
    remoteTaskCancellations === undefined ||
    remoteTaskCancellationQueue === undefined
      ? undefined
      : new RemoteTaskCancellationService({
          remoteTasks: remoteTaskRepository,
          cancellations: remoteTaskCancellations,
          queue: remoteTaskCancellationQueue,
          clock,
          ids: {
            nextRequestId: () => `remote-task-cancel-request-${randomUUID()}`,
            nextAttemptId: () => `remote-task-cancel-attempt-${randomUUID()}`,
            nextClaimToken: () => `remote-task-cancel-claim-${randomUUID()}`,
          },
        });
  const remoteTaskCancellationProcessor =
    remoteTaskRepository === undefined || remoteTaskCancellations === undefined
      ? undefined
      : new RemoteTaskCancellationWorker({
          remoteTasks: remoteTaskRepository,
          cancellations: remoteTaskCancellations,
          sender: mcpRegistry,
          serial: contextSerial,
          clock,
          ids: {
            nextAttemptId: () => `remote-task-cancel-attempt-${randomUUID()}`,
            nextClaimToken: () => `remote-task-cancel-claim-${randomUUID()}`,
          },
        });
  const remoteTaskCancellationReconciler =
    remoteTaskCancellations === undefined || remoteTaskCancellationQueue === undefined
      ? undefined
      : new RemoteTaskCancellationReconciler({
          cancellations: remoteTaskCancellations,
          queue: remoteTaskCancellationQueue,
          clock,
        });
  const workflowPlans = new PostgresWorkflowPlanRepository(pool);
  const skillCallWorkflows = new PostgresSkillCallWorkflowRepository(pool);
  const executionExceptionDecider = new StructuredExecutionExceptionDecider(modelRuntime, memories);
  const workflowAncestry = new AsyncLocalStorage<readonly string[]>();
  const skillCallAncestry = new AsyncLocalStorage<readonly string[]>();
  const workflowTaskAuthority = new AsyncLocalStorage<AgentTask>();
  const workflowPorts: WorkflowRuntimePorts = {
    async executeLlm({ executionId, instruction, context, responseSchema }) {
      const instance = await workflowInstances.findInstance(executionId);
      const task =
        (instance === undefined ? undefined : await tasks.findByPlanId(instance.planId)) ??
        workflowTaskAuthority.getStore();
      return modelRuntime.generateStructured({
        stage: 'execution_decision',
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
    }) {
      if (!isRecord(arguments_)) throw new Error('WORKFLOW_MCP_ARGUMENTS_NOT_OBJECT');
      const instance = await workflowInstances.findInstance(executionId);
      const task = instance === undefined ? undefined : await tasks.findByPlanId(instance.planId);
      const authorityTask = task ?? workflowTaskAuthority.getStore();
      const plan =
        instance === undefined ? undefined : await workflowPlans.findPlan(instance.planId);
      const skillCallLink =
        instance === undefined
          ? undefined
          : await skillCallWorkflows.findByChildInstanceId(instance.instanceId);
      const planDefinition = plan?.definition;
      const declaredTaskSemantics =
        taskExecution === undefined
          ? await mcpRepository.getTaskOperationSemantics(tool)
          : undefined;
      const effectiveTaskExecution =
        taskExecution ??
        (declaredTaskSemantics?.execution === 'task_required'
          ? { mode: 'require_task' as const, availabilityCheck: 'required' as const }
          : undefined);
      if (effectiveTaskExecution !== undefined && taskReadiness === undefined)
        throw new Error('MCP_TASK_READINESS_RUNTIME_DISABLED');
      if (effectiveTaskExecution !== undefined && planDefinition === undefined)
        throw new Error('MCP_TASK_WORKFLOW_DEFINITION_MISSING');
      const guardedTaskExecution =
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
      const receipt = await mcpRegistry.callDetailed(
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
            }
          : {
              taskId: authorityTask.taskId,
              contextId: authorityTask.contextId,
              executionContext,
              ...(guardedTaskExecution === undefined
                ? {}
                : { taskExecution: guardedTaskExecution }),
            },
      );
      if (receipt.outcome.kind === 'immediate') return receipt.outcome;
      const remote = receipt.outcome.task;
      if (
        remoteTaskAdmission === undefined ||
        authorityTask === undefined ||
        instance === undefined ||
        plan === undefined ||
        planDefinition === undefined
      ) {
        let cancellationAcknowledged = false;
        let cancellationFailure: string | undefined;
        try {
          cancellationAcknowledged = (
            await mcpRegistry.cancelRemoteTask({
              serverId: tool.serverId,
              remoteTaskId: remote.remoteTaskId,
              executionContext,
              ...(signal === undefined ? {} : { signal }),
            })
          ).acknowledged;
        } catch (cancellationError: unknown) {
          cancellationFailure =
            cancellationError instanceof Error
              ? cancellationError.name
              : 'REMOTE_TASK_CANCEL_FAILED';
        }
        process.stderr.write(
          `${JSON.stringify({
            event: 'remote_task.phase_not_connected',
            code: 'REMOTE_MCP_TASK_PHASE_NOT_CONNECTED',
            serverId: tool.serverId,
            operationName: tool.toolName,
            remoteTaskId: remote.remoteTaskId,
            executionId,
            workflowNodeRunId,
            cancellationAcknowledged,
            ...(cancellationFailure === undefined ? {} : { cancellationFailure }),
          })}\n`,
        );
        throw new RemoteMcpTaskPhaseNotConnectedError(remote.remoteTaskId);
      }
      const bindingId = `remote-task-binding-${randomUUID()}`;
      try {
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
          workflowDefinitionId: planDefinition.workflowDefinitionId,
          workflowDefinitionVersion: planDefinition.version,
          workflowInstanceId: instance.instanceId,
          workflowNodeId,
          workflowNodeRunId,
          ...(skillCallLink === undefined
            ? {}
            : {
                parentWorkflowInstanceId: skillCallLink.parentInstanceId,
                parentSkillCallId: skillCallLink.callId,
              }),
          mcpInvocationId: receipt.invocationId,
          protocolStatus: remote.status,
          protocolRevision: remote.protocolRevision,
          tasksSchemaRevision: remote.tasksSchemaRevision,
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
          credentialRevision: receipt.credentialRevision,
          sessionRevision: receipt.sessionRevision,
          lastProviderUpdatedAt: remote.lastUpdatedAt,
          pollIntervalMs: Math.max(100, remote.pollIntervalMs ?? 1_000),
          createdAt: clock.now(),
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
        return {
          kind: 'waiting_external',
          wait: {
            waitId: admitted.binding.bindingId,
            kind: 'remote_task',
            sourceId: admitted.binding.bindingId,
            nodeId: workflowNodeId,
            nodeRunId: workflowNodeRunId,
            state: remote.status === 'input_required' ? 'awaiting_input' : 'waiting',
          },
        };
      } catch (error: unknown) {
        let cancellationAcknowledged = false;
        let cancellationFailure: string | undefined;
        try {
          const cancellation = await mcpRegistry.cancelRemoteTask({
            serverId: tool.serverId,
            remoteTaskId: remote.remoteTaskId,
            executionContext,
            ...(signal === undefined ? {} : { signal }),
          });
          cancellationAcknowledged = cancellation.acknowledged;
        } catch (cancellationError: unknown) {
          cancellationFailure =
            cancellationError instanceof Error
              ? cancellationError.name
              : 'REMOTE_TASK_CANCEL_FAILED';
        }
        process.stderr.write(
          `${JSON.stringify({
            event: 'remote_task.admission.uncertain',
            code: 'REMOTE_TASK_ADMISSION_UNCERTAIN',
            serverId: tool.serverId,
            operationName: tool.toolName,
            remoteTaskId: remote.remoteTaskId,
            workflowInstanceId: instance.instanceId,
            workflowNodeRunId,
            cancellationAcknowledged,
            ...(cancellationFailure === undefined ? {} : { cancellationFailure }),
            message: error instanceof Error ? error.message : 'Remote Task binding failed.',
          })}\n`,
        );
        throw new RemoteMcpTaskAdmissionUncertainError(remote.remoteTaskId);
      }
    },
    async executeSkill({
      skillId,
      input,
      parentExecutionId,
      parentNodeId,
      parentNodeRunId,
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
      return authorityTask === undefined
        ? executeChild()
        : workflowTaskAuthority.run(authorityTask, executeChild);
    },
    async executeSubworkflow({
      workflowDefinitionId,
      workflowVersion,
      input,
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
      const plan = await workflowPlans.findConfirmedDefinition(
        workflowDefinitionId,
        workflowVersion,
      );
      if (plan?.definition === undefined) throw new Error('WORKFLOW_SUBWORKFLOW_NOT_CONFIRMED');
      const definition = plan.definition;
      return workflowAncestry.run([...ancestry, key], async () => {
        const outcome = await new LangGraphWorkflowExecutor(
          workflowPorts,
          workflowCallCosts,
        ).execute(definition, input, workflowBudgetDefaults, signal, undefined, executionContext);
        if (outcome.status === 'failed') throw new Error('WORKFLOW_SUBWORKFLOW_FAILED');
        return outcome.result;
      });
    },
    requestHumanConfirmation: () => {
      throw new Error('WORKFLOW_HUMAN_CONFIRMATION_REQUIRED');
    },
    decideExecutionError: (input) => executionExceptionDecider.decide(input),
    now: clock.now,
    nowMilliseconds: () => Date.now(),
  };
  const langGraphExecutor = new LangGraphWorkflowExecutor(workflowPorts, workflowCallCosts);
  const workflowInstances = new PostgresWorkflowExecutionRepository(pool);
  const workflowContinuations = new PostgresWorkflowContinuationRepository(pool);
  const workflowExecution = new WorkflowExecutionService({
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
        let cancellationAcknowledged = false;
        let cancellationFailure: string | undefined;
        try {
          cancellationAcknowledged = (
            await mcpRegistry.cancelRemoteTask({
              serverId: binding.serverId,
              remoteTaskId: binding.remoteTaskId,
              executionContext: binding.executionContext,
            })
          ).acknowledged;
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
            cancellationAcknowledged,
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
  const skillConfirmation = new TransitiveSkillConfirmationEvaluator({
    skills,
    graph: skillGraphRepository,
  });
  const skillCallWorkflowService = new SkillCallWorkflowService({
    skills,
    planner: workflowPlanner,
    validator: workflowValidator,
    execution: workflowExecution,
    plans: workflowPlans,
    confirmation: skillConfirmation,
    records: skillCallWorkflows,
    schemas: schemaValidator,
    loadToolPlanningMetadata: (skill) =>
      buildMcpToolPlanningMetadata(skill.toolPolicy, async (reference) =>
        (await mcpRepository.listTools(reference.serverId)).find(
          (tool) => tool.toolName === reference.toolName,
        ),
      ),
    clock,
    nextId: randomUUID,
  });
  const workflowRevision = new WorkflowRevisionService({
    plans: workflowPlans,
    planner: workflowPlanner,
    validator: workflowValidator,
    clock,
  });
  const goalService = new GoalService({ goals, contexts, clock });
  const goalCancellations = new GoalCancellationService({
    goals,
    instances: workflowInstances,
    execution: workflowExecution,
    repository: new PostgresGoalCancellationRepository(pool, publishTaskState),
    clock,
    nextId: () => `goal-cancellation-${randomUUID()}`,
  });
  const goalPatches = new GoalPatchService({
    goals,
    patches: new PostgresGoalPatchRepository(pool, publishTaskState),
    plans: workflowPlans,
    planner: workflowPlanner,
    skills,
    model: modelRuntime,
    clock,
    ids: {
      nextPatchId: () => `goal-patch-${randomUUID()}`,
      nextPlanId: () => `plan-goal-patch-${randomUUID()}`,
    },
    beforeReplan: {
      async prepare({ goal, taskId }) {
        const task = await service.get(taskId);
        if (task.selectedSkillId === undefined || task.selectedSkillVersion === undefined)
          return { status: 'ready' } as const;
        const skill = await skills.findVersion(task.selectedSkillId, task.selectedSkillVersion);
        if (skill?.status !== 'enabled') throw new Error('SELECTED_SKILL_NOT_EXECUTABLE');
        const resolution = await skillInputResolution.resolve({
          task: { ...task, goalId: goal.goalId, goalVersion: goal.version },
          goal,
          skill,
          supplementaryInputs: await taskInputs.listResponses(taskId),
        });
        if (resolution.status === 'input_required') return { status: 'input_required' } as const;
        if (resolution.status !== 'resolved') throw new Error('TASK_SKILL_INPUT_NOT_RESOLVED');
        return {
          status: 'ready',
          planningContext: {
            resolutionId: resolution.resolutionId,
            structuredInput: resolution.structuredInput,
            sourceRefs: resolution.sourceRefs,
          },
        } as const;
      },
    },
  });
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
  const service = new TaskService({
    contexts,
    tasks,
    events,
    skillDrafts,
    taskInputs,
    ...(options.v11McpTasks === undefined
      ? {}
      : {
          remoteTaskInputs: {
            prepareResponse(inputRequestId: string, inputContent: unknown) {
              if (remoteTaskInput === undefined)
                throw new Error('REMOTE_TASK_INPUT_SERVICE_UNAVAILABLE');
              return remoteTaskInput.prepareResponse(inputRequestId, inputContent);
            },
          },
        }),
    skillInputs: skillInputResolutionRepository,
    queue,
    clock,
    ids,
    memories,
    feedback: implicitFeedback,
    planActions: {
      async confirm(task) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        if (await skillCallWorkflowService.confirmPendingForParentPlan(task.planId, task.taskId))
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
              workflowControlId: `control-task-${task.taskId}`,
            });
            return;
          }
          const controlId = `control-task-${task.taskId}`;
          try {
            const existing = await workflowController.get(controlId);
            if (existing.status === 'awaiting_confirmation') {
              await workflowController.continueAfterConfirmation(controlId);
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
          await workflowController.start({
            controlId,
            contextId: task.contextId,
            goalId,
            goalVersion,
            taskId: task.taskId,
            initialPlanId: planId,
            input: await service.executionInput(task.taskId),
            skillIds: selectedSkillIds,
            planningInstruction: JSON.stringify({
              operation: 'task_outer_replan',
              requestText: task.requestText,
            }),
          });
        })().catch(async (error: unknown) => {
          const code =
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof error.code === 'string'
              ? error.code
              : 'TASK_EXECUTION_FAILED';
          await service.fail(task.taskId, code, `Confirmed Task execution failed with ${code}.`);
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
        await goalPatches.apply({
          goalId: task.goalId,
          sourcePlanId: task.planId,
          instruction,
          taskId: task.taskId,
        });
      },
      async pause(task) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        await workflowExecution.pauseForPlan(task.planId);
      },
      async commitRuntimeCancellation(task, reason) {
        if (
          task.goalId === undefined ||
          task.goalVersion === undefined ||
          task.planId === undefined
        )
          return false;
        const controlId = `control-task-${task.taskId}`;
        let control;
        try {
          control = await workflowController.get(controlId);
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
        try {
          await runtimeTerminalOutcomes.commitCanceled({
            outcomeId: `terminal-outcome-task-${task.taskId}`,
            taskId: task.taskId,
            goalId: task.goalId,
            goalVersion: task.goalVersion,
            controlId,
            ...(canceled?.instanceId === undefined && control.finalInstanceId === undefined
              ? {}
              : { finalInstanceId: canceled?.instanceId ?? control.finalInstanceId }),
            summary: reason,
            eventId: `event-terminal-${task.taskId}`,
            committedAt: clock.now(),
          });
        } catch (error: unknown) {
          const latest = await workflowController.get(controlId);
          if (isTerminalWorkflowControlStatus(latest.status)) return true;
          throw error;
        }
        return true;
      },
      async cancel(task) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        if (await skillCallWorkflowService.rejectPendingForParentPlan(task.planId)) return;
        if (task.phase === 'awaiting_plan_confirmation' || task.phase === 'canceled') return;
        await workflowExecution.cancelForPlan(task.planId);
      },
      async resume(task) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        return (
          await workflowExecution.resumePauseForPlan(task.planId, 300, {
            agentTaskId: task.taskId,
            contextId: task.contextId,
            workflowControlId: `control-task-${task.taskId}`,
          })
        ).disposition;
      },
      async cancelGoal(task, reason) {
        if (task.goalId === undefined) throw new Error('TASK_GOAL_NOT_ATTACHED');
        await goalCancellations.cancel(task.goalId, reason);
      },
    },
  });
  const workflowController = new WorkflowControllerService({
    controls: new PostgresWorkflowControlRepository(pool),
    plans: workflowPlans,
    goals,
    confirmation: skillConfirmation,
    planner: workflowPlanner,
    execution: workflowExecution,
    evaluator: new StructuredGoalEvaluator(modelRuntime, memories),
    experiences: evolutionExperiences,
    memories,
    taskOutcomes: {
      reportCapabilityGap: (taskId, evaluation) => service.reportCapabilityGap(taskId, evaluation),
      requestInput: (taskId, question, controlId, controlRoundIndex) =>
        service.requestInput(taskId, question, {
          source: 'goal_evaluation',
          controlId,
          controlRoundIndex,
        }),
      requestSkillConfirmation: (taskId, input) =>
        service.requestNestedSkillConfirmation(taskId, input),
      async prepareSkillReplacement(taskId) {
        if (skillSelection === undefined) throw new Error('SKILL_SELECTION_RUNTIME_NOT_CONFIGURED');
        const task = await service.get(taskId);
        if (task.skillSelectionId === undefined || task.selectedSkillId === undefined)
          throw new Error('TASK_SKILL_SELECTION_NOT_BOUND');
        if (task.goalId === undefined || task.goalVersion === undefined)
          throw new Error('TASK_GOAL_NOT_ATTACHED');
        const goal = await goals.findById(task.goalId);
        if (goal?.version !== task.goalVersion) throw new Error('TASK_GOAL_VERSION_STALE');
        const replacement = await skillSelection.planReplacement(
          task.skillSelectionId,
          task.selectedSkillId,
          createGoalExecutionContract(goal),
        );
        return {
          skillId: replacement.replacementSkillId,
          skillVersion: replacement.replacementSkillVersion,
          decisionSummary: replacement.decisionSummary,
        };
      },
      reportReplacementPlan: (taskId, input) => service.awaitReplacementConfirmation(taskId, input),
      reportInputContinuationPlan: (taskId, input) =>
        service.awaitInputContinuationConfirmation(taskId, input),
      async prepareAchieved(taskId, instance) {
        const task = await service.get(taskId);
        if (task.temporarySkillId !== undefined) {
          const temporary = await temporarySkillRepository.find(task.temporarySkillId);
          if (temporary?.status !== 'active') throw new Error('TEMPORARY_SKILL_NOT_ACTIVE');
          return resultProcessing.prepare({
            resultId: `processed-result-terminal-${taskId}`,
            taskId,
            skillId: temporary.temporarySkillId,
            skillVersion: 1,
            outputInstruction: `Evaluate Temporary Skill ${temporary.name} output.`,
            outputSchema: temporary.outputSchema,
            rawResult: instance.result,
          });
        }
        const selected = instance.skillVersions[0];
        if (selected === undefined) throw new Error('TASK_SKILL_VERSION_REQUIRED');
        const skill = await skills.findVersion(selected.skillId, selected.version);
        if (skill?.status !== 'enabled') throw new Error('TASK_SKILL_VERSION_NOT_ENABLED');
        return resultProcessing.prepare({
          resultId: `processed-result-terminal-${taskId}`,
          taskId,
          skillId: skill.skillId,
          skillVersion: skill.version,
          outputInstruction: skill.outputInstruction,
          outputSchema: skill.outputSchema,
          rawResult: instance.result,
        });
      },
      enhanceResultMemory: (processed) => resultProcessing.enhance(processed),
      async enhanceTaskQuality(taskId, instance, evaluation, processed) {
        const task = await service.get(taskId);
        const plan = await workflowPlans.findPlan(instance.planId);
        const goal = await goals.findById(instance.goalId);
        if (plan?.definition === undefined || goal === undefined)
          throw new Error('TASK_QUALITY_EVIDENCE_MISSING');
        const temporary =
          task.temporarySkillId === undefined
            ? undefined
            : await temporarySkillRepository.find(task.temporarySkillId);
        const skill =
          temporary === undefined
            ? await skills.findVersion(processed.skillId, processed.skillVersion)
            : {
                skillId: temporary.temporarySkillId,
                version: 1,
                inputSchema: temporary.inputSchema,
                outputSchema: temporary.outputSchema,
              };
        if (skill === undefined) throw new Error('TASK_QUALITY_SKILL_EVIDENCE_MISSING');
        await taskQuality.evaluate({
          taskId,
          goal,
          goalEvaluation: evaluation,
          workflow: plan.definition,
          instance,
          skill,
          processedResult: processed,
          isTemporarySkill: temporary !== undefined,
        });
      },
      async enhanceTemporarySkill(taskId) {
        const task = await service.get(taskId);
        if (task.temporarySkillId === undefined) return undefined;
        const completed = await temporarySkills.complete(
          task.temporarySkillId,
          true,
          'Temporary Skill Workflow completed and its output Schema passed.',
        );
        return completed.formalizationCandidate?.candidateId;
      },
      async enhanceSkillEvolution(candidateId) {
        await skillEvolution.evaluateAndPublish(candidateId);
      },
    },
    terminalOutcomes: runtimeTerminalOutcomes,
    reportWarning: (warning) => {
      process.stderr.write(
        `${JSON.stringify({ event: 'runtime.enhancement.warning', ...warning })}\n`,
      );
    },
    clock,
    ids: {
      nextPlanId: (controlId, replanCount) =>
        `plan-${controlId}-${String(replanCount)}-${randomUUID()}`,
      nextInstanceId: (controlId, roundIndex) =>
        `instance-${controlId}-${String(roundIndex)}-${randomUUID()}`,
    },
  });
  const continueWorkflowHierarchy = async (
    input: Readonly<{
      snapshot: WorkflowContinuationSnapshot;
      instance: WorkflowInstance;
      continuationAttemptId: string;
    }>,
  ): Promise<void> => {
    let currentSnapshot = input.snapshot;
    let currentInstance = input.instance;
    let depth = 0;
    for (;;) {
      const childLink = await skillCallWorkflows.findByChildInstanceId(currentInstance.instanceId);
      if (childLink === undefined) {
        if (currentInstance.status !== 'waiting_external')
          await workflowController.continueAfterExternal(
            currentSnapshot.workflowControlId,
            currentInstance.instanceId,
          );
        return;
      }
      if (
        currentInstance.status === 'running' ||
        currentInstance.status === 'paused' ||
        currentInstance.status === 'waiting_external'
      )
        throw new Error('WORKFLOW_SKILL_CHILD_CONTINUATION_INCOMPLETE');
      const child = await skillCallWorkflowService.completeExternalChild(currentInstance);
      const parentSnapshot = await workflowContinuations.findCurrent(child.parentInstanceId);
      const parentWait = parentSnapshot?.waitingNodeRuns.find(
        (wait) =>
          wait.kind === 'child_workflow' &&
          wait.sourceId === child.childInstanceId &&
          wait.nodeId === child.parentNodeId,
      );
      if (parentSnapshot === undefined || parentWait === undefined)
        throw new Error('WORKFLOW_SKILL_PARENT_CONTINUATION_NOT_FOUND');
      currentInstance = await workflowExecution.continueExternal({
        instanceId: child.parentInstanceId,
        continuationAttemptId: `${input.continuationAttemptId}-parent-${String(depth)}`,
        resolution:
          child.outcome.kind === 'completed'
            ? {
                kind: 'completed',
                waitId: parentWait.waitId,
                nodeRunId: parentWait.nodeRunId,
                result: child.outcome.result,
              }
            : {
                kind: 'failed',
                waitId: parentWait.waitId,
                nodeRunId: parentWait.nodeRunId,
                error: child.outcome.error,
              },
      });
      currentSnapshot = parentSnapshot;
      depth += 1;
      if (currentInstance.status === 'waiting_external') return;
    }
  };
  const remoteTaskContinuation =
    remoteTaskRepository === undefined ||
    remoteTaskQueue === undefined ||
    remoteTaskContinuationQueue === undefined
      ? undefined
      : (() => {
          remoteTaskInput = new RemoteTaskInputService({
            continuations: workflowContinuations,
            remoteTasks: remoteTaskRepository,
            inputs: new PostgresRemoteTaskInputRepository(pool),
            tasks,
            events,
            sender: mcpRegistry,
            pollQueue: remoteTaskQueue,
            schemas: schemaValidator,
            serial: contextSerial,
            clock,
            ids: {
              nextInputRequestId: () => `remote-task-input-${randomUUID()}`,
              nextClaimToken: () => `remote-task-input-claim-${randomUUID()}`,
              nextProtocolAttemptId: () => `remote-task-input-attempt-${randomUUID()}`,
              nextEventId: () => `remote-task-input-event-${randomUUID()}`,
            },
            onTaskChanged: publishTaskState,
          });
          return new RemoteTaskContinuationService({
            continuations: workflowContinuations,
            remoteTasks: remoteTaskRepository,
            execution: workflowExecution,
            serial: contextSerial,
            clock,
            ids: {
              nextClaimToken: () => `workflow-continuation-claim-${randomUUID()}`,
              nextAttemptId: () => `workflow-continuation-attempt-${randomUUID()}`,
            },
            onContinued: continueWorkflowHierarchy,
            inputRequired: remoteTaskInput,
          });
        })();
  const remoteTaskContinuationReconciler =
    remoteTaskContinuation === undefined || remoteTaskContinuationQueue === undefined
      ? undefined
      : new RemoteTaskContinuationReconciler({
          continuations: workflowContinuations,
          queue: remoteTaskContinuationQueue,
          clock,
        });
  const temporarySkills = new TemporarySkillService({
    repository: temporarySkillRepository,
    tools: mcpRepository,
    schemas: schemaValidator,
    clock,
    ids: {
      nextTemporarySkillId: () => `temporary-skill-${randomUUID()}`,
      nextExperienceId: () => `temporary-skill-experience-${randomUUID()}`,
      nextFormalizationCandidateId: () => `skill-formalization-candidate-${randomUUID()}`,
      nextEvolutionTriggerId: () => `evolution-trigger-${randomUUID()}`,
    },
    fingerprint: (canonical) => createHash('sha256').update(canonical).digest('hex'),
    evolutionPolicy: evolutionPolicyRepository,
  });
  const temporarySkillResolver = new TemporarySkillResolver({
    mcp: mcpRepository,
    model: modelRuntime,
    temporarySkills,
  });
  const skillEvolution = new SkillEvolutionService({
    temporarySkills: temporarySkillRepository,
    model: modelRuntime,
    schemas: schemaValidator,
    tools: mcpRepository,
    skills: skillRegistry,
    experiences: new PostgresEvolutionExperienceRepository(pool),
    runner: {
      async run({ proposedSkill, case_, executionContext }) {
        const tool = proposedSkill.tools[0];
        if (tool === undefined)
          return { passed: false, summary: 'No Tool is available for simulation.' };
        const inputValidation = schemaValidator.validate(proposedSkill.inputSchema, case_.input);
        if (!inputValidation.valid)
          return {
            passed: case_.expectedOutcome === 'failure',
            summary:
              case_.expectedOutcome === 'failure'
                ? 'The Skill input was rejected by its corrected Schema as expected.'
                : `The Skill input unexpectedly failed Schema validation: ${inputValidation.errors.join('; ')}`,
          };
        try {
          await mcpRegistry.call(tool.serverId, tool.toolName, case_.input, undefined, {
            contextId: `skill-evolution:${proposedSkill.skillId}`,
            executionContext,
          });
          return {
            passed: case_.expectedOutcome === 'success',
            summary:
              case_.expectedOutcome === 'success'
                ? 'The simulation call succeeded as expected.'
                : 'The simulation unexpectedly succeeded.',
          };
        } catch (error: unknown) {
          return {
            passed: case_.expectedOutcome === 'failure',
            summary:
              case_.expectedOutcome === 'failure'
                ? 'The simulation failed as expected.'
                : `The simulation unexpectedly failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          };
        }
      },
      async replay({ experience, executionContext }) {
        try {
          const outcome = await langGraphExecutor.execute(
            experience.workflow,
            experience.input,
            workflowBudgetDefaults,
            undefined,
            `evolution-replay-${experience.experienceId}-${randomUUID()}`,
            executionContext,
          );
          return {
            succeeded: outcome.status === 'succeeded',
            summary: `Historical Workflow replay finished with ${outcome.status}.`,
          };
        } catch (error: unknown) {
          return {
            succeeded: false,
            summary: `Historical Workflow replay failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          };
        }
      },
    },
    clock,
    nextCorrectionId: () => `skill-evolution-correction-${randomUUID()}`,
    memories,
  });
  const temporarySkillOperations = {
    create: temporarySkills.create.bind(temporarySkills),
    listByTask: temporarySkills.listByTask.bind(temporarySkills),
    async complete(temporarySkillId: string, successful: boolean, outcomeSummary: string) {
      const completed = await temporarySkills.complete(
        temporarySkillId,
        successful,
        outcomeSummary,
      );
      if (completed.formalizationCandidate === undefined) return completed;
      return {
        ...completed,
        formalizationCandidate: await skillEvolution.evaluateAndPublish(
          completed.formalizationCandidate.candidateId,
        ),
      };
    },
  };
  const processor = new PlanPreparationProcessor({
    tasks,
    events,
    clock,
    ids,
    decisions: new StructuredTaskDecisionService(modelRuntime, memories),
    goals: goalService,
    skills,
    skillInputs: skillInputResolution,
    skillSelection: {
      async select(goalContract, task) {
        if (
          !goalContract.description.includes('TEMPORARY_SKILL_GOAL') &&
          skillSelection !== undefined
        ) {
          try {
            return await skillSelection.select(goalContract);
          } catch (error: unknown) {
            if (!(
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === 'SKILL_SELECTION_NO_CANDIDATES'
            ))
              throw error;
          }
        }
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
    requestTaskInput: (taskId, question, origin) => service.requestInput(taskId, question, origin),
    workflowContinuation: {
      continueAfterInput(input) {
        if (input.controlId === undefined || input.controlRoundIndex === undefined)
          throw new Error('TASK_INPUT_WORKFLOW_CONTROL_ASSOCIATION_REQUIRED');
        return workflowController.continueAfterInput({
          controlId: input.controlId,
          taskId: input.taskId,
          inputRequestId: input.inputRequestId,
          controlRoundIndex: input.controlRoundIndex,
          content: input.content,
        });
      },
    },
    ...(remoteTaskInput === undefined ? {} : { remoteTaskInput }),
    taskPlanning: {
      async prepare(input) {
        const skill =
          input.skillId === undefined || input.skillVersion === undefined
            ? undefined
            : await skills.findVersion(input.skillId, input.skillVersion);
        const temporary =
          input.temporarySkillId === undefined
            ? undefined
            : await temporarySkillRepository.find(input.temporarySkillId);
        if (skill?.status !== 'enabled' && temporary?.status !== 'active')
          throw new Error('SELECTED_SKILL_NOT_EXECUTABLE');
        if (skill?.status === 'enabled' && input.skillInputResolution === undefined)
          throw new Error('SELECTED_SKILL_INPUT_NOT_RESOLVED');
        const planningToolPolicy = skill?.toolPolicy ?? {
          required: temporary?.tools ?? [],
          optional: [],
          forbidden: [],
        };
        const toolPlanningMetadata = await buildMcpToolPlanningMetadata(
          planningToolPolicy,
          async (reference) =>
            (await mcpRepository.listTools(reference.serverId)).find(
              (tool) => tool.toolName === reference.toolName,
            ),
        );
        const planId = `plan-task-${input.task.taskId}-${randomUUID()}`;
        const plan = await workflowPlanner.plan({
          planId,
          workflowDefinitionId: `workflow-task-${input.task.taskId}`,
          workflowVersion: 1,
          goalId: input.goalId,
          goalVersion: input.goalVersion,
          goalContract: input.goalContract,
          toolExecutionSemantics: snapshotMcpToolPlanningExecutionSemantics(toolPlanningMetadata),
          ...(skill === undefined
            ? {}
            : {
                compositionRoot: {
                  skillId: skill.skillId,
                  skillVersion: skill.version,
                },
              }),
          taskId: input.task.taskId,
          templateQuery: input.goalDescription,
          planningInstruction: JSON.stringify({
            operation: 'task_initial_plan',
            workflowIdentity: {
              workflowDefinitionId: `workflow-task-${input.task.taskId}`,
              version: 1,
              goalId: input.goalId,
              goalVersion: input.goalVersion,
            },
            goalDescription: input.goalDescription,
            ...(skill === undefined
              ? {
                  selectedTemporarySkill: {
                    temporarySkillId: temporary?.temporarySkillId,
                    description: temporary?.description,
                    tools: temporary?.tools,
                    toolPlanningMetadata,
                    inputSchema: temporary?.inputSchema,
                    outputSchema: temporary?.outputSchema,
                  },
                }
              : {
                  selectedSkill: {
                    skillId: skill.skillId,
                    version: skill.version,
                    description: skill.description,
                    toolPolicy: skill.toolPolicy,
                    toolPlanningMetadata,
                    workflowGuidance: skill.workflowGuidance,
                    inputSchema: skill.inputSchema,
                    resolvedInput: input.skillInputResolution,
                    outputSchema: skill.outputSchema,
                  },
                }),
          }),
        });
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
        if (autoConfirmed) await workflowExecution.confirm(plan.planId, input.task.taskId);
        return {
          planId: plan.planId,
          autoConfirmed,
        };
      },
      async executeAuto(input) {
        const task = await service.get(input.taskId);
        if (
          task.goalId === undefined ||
          task.goalVersion === undefined ||
          task.selectedSkillId === undefined
        )
          throw new Error('TASK_EXECUTION_IDENTITY_INCOMPLETE');
        await workflowController.start({
          controlId: `control-task-${task.taskId}`,
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
      },
    },
  });
  const waitSweepTimer = setInterval(() => {
    void (async () => {
      const expired = await taskWaitTimeouts.sweep();
      const releases = await Promise.allSettled(
        expired.map((task) => service.releaseTimedOutWait(task.taskId)),
      );
      const failures: unknown[] = [];
      for (const release of releases)
        if (release.status === 'rejected') failures.push(release.reason as unknown);
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'One or more expired Task checkpoints were not released.',
        );
    })().catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({ event: 'task_wait_sweep.failed', error: error instanceof Error ? error.message : String(error) })}\n`,
      );
    });
  }, options.taskWaitSweepIntervalMs ?? 1000);
  waitSweepTimer.unref();
  let attemptDispatchRunning = false;
  const attemptDispatchTimer = setInterval(() => {
    if (attemptDispatchRunning) return;
    attemptDispatchRunning = true;
    void taskAttemptDispatch
      .dispatchQueued()
      .catch((error: unknown) => {
        process.stderr.write(
          `${JSON.stringify({ event: 'task_attempt_dispatch.failed', error: error instanceof Error ? error.message : String(error) })}\n`,
        );
      })
      .finally(() => {
        attemptDispatchRunning = false;
      });
  }, options.taskAttemptDispatchIntervalMs ?? 1000);
  attemptDispatchTimer.unref();
  const worker = new BullMqContextWorker({
    connection: options.redis,
    queueName,
    processor,
    serial: contextSerial,
  });
  const remoteTaskWorker =
    remoteTaskPolling === undefined
      ? undefined
      : new BullMqRemoteTaskPollWorker({
          connection: options.redis,
          ...(options.v11McpTasks?.queueName === undefined
            ? {}
            : { queueName: options.v11McpTasks.queueName }),
          processor: remoteTaskPolling,
        });
  const remoteTaskContinuationWorker =
    remoteTaskContinuation === undefined
      ? undefined
      : new BullMqRemoteTaskContinuationWorker({
          connection: options.redis,
          ...(remoteTaskContinuationQueueName === undefined
            ? {}
            : { queueName: remoteTaskContinuationQueueName }),
          processor: {
            process: (job) => remoteTaskContinuation.process(job),
          },
        });
  const remoteTaskCancellationWorker =
    remoteTaskCancellationProcessor === undefined
      ? undefined
      : new BullMqRemoteTaskCancellationWorker({
          connection: options.redis,
          ...(remoteTaskCancellationQueueName === undefined
            ? {}
            : { queueName: remoteTaskCancellationQueueName }),
          processor: remoteTaskCancellationProcessor,
        });
  let remoteTaskReconcileRunning = false;
  const remoteTaskReconcileTimer =
    remoteTaskReconciler === undefined
      ? undefined
      : setInterval(() => {
          if (remoteTaskReconcileRunning) return;
          remoteTaskReconcileRunning = true;
          void remoteTaskReconciler
            .reconcile()
            .catch((error: unknown) => {
              process.stderr.write(
                `${JSON.stringify({ event: 'remote_task_reconcile.failed', error: error instanceof Error ? error.message : String(error) })}\n`,
              );
            })
            .finally(() => {
              remoteTaskReconcileRunning = false;
            });
        }, options.v11McpTasks?.reconcileIntervalMs ?? 1000);
  remoteTaskReconcileTimer?.unref();
  let remoteTaskContinuationReconcileRunning = false;
  const remoteTaskContinuationReconcileTimer =
    remoteTaskContinuationReconciler === undefined
      ? undefined
      : setInterval(() => {
          if (remoteTaskContinuationReconcileRunning) return;
          remoteTaskContinuationReconcileRunning = true;
          void remoteTaskContinuationReconciler
            .reconcile()
            .catch((error: unknown) => {
              process.stderr.write(
                `${JSON.stringify({ event: 'remote_task_continuation_reconcile.failed', error: error instanceof Error ? error.message : String(error) })}\n`,
              );
            })
            .finally(() => {
              remoteTaskContinuationReconcileRunning = false;
            });
        }, options.v11McpTasks?.reconcileIntervalMs ?? 1000);
  remoteTaskContinuationReconcileTimer?.unref();
  let remoteTaskCancellationReconcileRunning = false;
  const remoteTaskCancellationReconcileTimer =
    remoteTaskCancellationReconciler === undefined
      ? undefined
      : setInterval(() => {
          if (remoteTaskCancellationReconcileRunning) return;
          remoteTaskCancellationReconcileRunning = true;
          void remoteTaskCancellationReconciler
            .reconcile()
            .catch((error: unknown) => {
              process.stderr.write(
                `${JSON.stringify({ event: 'remote_task_cancellation_reconcile.failed', error: error instanceof Error ? error.message : String(error) })}\n`,
              );
            })
            .finally(() => {
              remoteTaskCancellationReconcileRunning = false;
            });
        }, options.v11McpTasks?.reconcileIntervalMs ?? 1000);
  remoteTaskCancellationReconcileTimer?.unref();
  if (remoteTaskReconciler !== undefined) await remoteTaskReconciler.reconcile();
  if (remoteTaskContinuationReconciler !== undefined)
    await remoteTaskContinuationReconciler.reconcile();
  if (remoteTaskCancellationReconciler !== undefined)
    await remoteTaskCancellationReconciler.reconcile();
  worker.start();
  remoteTaskWorker?.start();
  remoteTaskContinuationWorker?.start();
  remoteTaskCancellationWorker?.start();
  let management: ManagementHttpEndpointHandle | undefined;
  try {
    const startedManagement = await startManagementHttpEndpoint({
      operations: {
        graph: skillGraph,
        goals: goalService,
        goalPatches,
        goalCancellations,
        tasks: service,
        taskWaitTimeouts,
        resultProcessing,
        taskQuality,
        implicitFeedback,
        evaluationInfluences,
        evaluationAnalytics,
        runtimeEvents: events,
        runtimeTerminalOutcomes,
        memories,
        memoryRetention,
        goalInputInference,
        skillInputResolution,
        mcp: mcpRegistry,
        skills: skillRegistry,
        skillAuthoring,
        models: modelRuntime,
        prompts,
        ...(skillSelection === undefined
          ? {}
          : {
              skillSelection: {
                select: async (goalContract: GoalExecutionContract) => {
                  const goal = await goals.findById(goalContract.goalId);
                  if (
                    goal !== undefined &&
                    (goal.status !== 'active' ||
                      !goalExecutionContractsEqual(createGoalExecutionContract(goal), goalContract))
                  )
                    throw Object.assign(
                      new Error(
                        'Registered Skill selection requires the exact active Goal contract.',
                      ),
                      { code: 'SKILL_SELECTION_GOAL_CONTRACT_STALE' as const },
                    );
                  return skillSelection.select(goalContract);
                },
              },
            }),
        skillQuality,
        workflowTemplates,
        temporarySkills: temporarySkillOperations,
        skillEvolution,
        evolutionExperiences,
        evolutionPolicy,
        workflows: {
          validate: (raw) => workflowValidator.validate(raw),
          plan: async (input) => {
            const goal = await goals.findById(input.goalId);
            if (
              goal !== undefined &&
              (goal.status !== 'active' ||
                !goalExecutionContractsEqual(createGoalExecutionContract(goal), input.goalContract))
            )
              throw Object.assign(
                new Error('Registered planning requires the exact active Goal contract.'),
                { code: 'WORKFLOW_GOAL_CONTRACT_STALE' as const },
              );
            return workflowPlanner.plan(input);
          },
          confirm: (planId) => workflowExecution.confirm(planId),
          execute: (input) => workflowExecution.execute(input),
          resumeHumanConfirmation: (input) => workflowExecution.resumeHumanConfirmation(input),
          pauseForPlan: (planId) => workflowExecution.pauseForPlan(planId),
          resumePauseForPlan: (planId) => workflowExecution.resumePauseForPlan(planId),
          cancelForPlan: (planId) => workflowExecution.cancelForPlan(planId),
          trace: (instanceId) => workflowExecution.trace(instanceId),
          traceForPlan: (planId) => workflowExecution.traceForPlan(planId),
        },
        workflowControls: workflowController,
        workflowRevisions: workflowRevision,
        ...(taskAvailabilityEvidence === undefined
          ? {}
          : { taskAvailability: taskAvailabilityEvidence }),
        ...(options.v11McpTasks === undefined
          ? {}
          : {
              remoteTaskLifecycle: new PostgresRemoteTaskLifecycleQuery(pool),
              ...(remoteTaskPolling === undefined ? {} : { remoteTaskPolling }),
              ...(remoteTaskCancellation === undefined ? {} : { remoteTaskCancellation }),
            }),
      },
      ...(options.managementHost === undefined ? {} : { host: options.managementHost }),
      ...(options.managementPort === undefined ? {} : { port: options.managementPort }),
      consoleDirectory: resolve('apps/console/dist'),
    });
    management = startedManagement;
    const taskExecutor = new TaskServiceAgentExecutor({
      tasks: service,
      notifier: taskStateNotifier,
      ...(options.a2aWaitTimeoutMs === undefined
        ? {}
        : { waitTimeoutMs: options.a2aWaitTimeoutMs }),
      ...(options.a2aSafetyPollIntervalMs === undefined
        ? {}
        : { safetyPollIntervalMs: options.a2aSafetyPollIntervalMs }),
    });
    const a2a = await startA2AHttpEndpoint({
      executor: taskExecutor,
      taskStore: new A2AProjectionTaskStore(
        new PostgresExternalTaskProjectionRepository(pool),
        tasks,
        async (taskId) => {
          if ((await service.get(taskId)).phase !== 'canceled') await service.cancel(taskId);
        },
      ),
      skillProvider: {
        async listEnabled() {
          return (await skills.listEnabledVersions()).map((skill) => ({
            id: skill.skillId,
            name: skill.name,
            description: skill.summary,
            tags: [...skill.capabilities],
          }));
        },
      },
      ...(options.a2aHost === undefined ? {} : { host: options.a2aHost }),
      ...(options.a2aPort === undefined ? {} : { port: options.a2aPort }),
    });
    return {
      a2a,
      management: startedManagement,
      async requestInput(taskId: string, reason: string): Promise<void> {
        await service.requestInput(taskId, reason);
      },
      listSkillDrafts(contextId: string) {
        return skillDrafts.listByContextId(contextId);
      },
      registerSkill(input: RegisterSkillVersionInput) {
        return skillRegistry.register(input);
      },
      setSkillEnabled(skillId: string, enabled: boolean) {
        return skillRegistry.setEnabled(skillId, enabled);
      },
      async failTask(taskId: string, errorCode: string, message: string): Promise<void> {
        await service.fail(taskId, errorCode, message);
      },
      async recordResultForSkill(taskId, skillId, candidate): Promise<void> {
        const skill = await skills.findCurrentVersion(skillId);
        if (skill?.status !== 'enabled') throw new Error('SKILL_NOT_ENABLED');
        const processed = await resultProcessing.process({
          taskId,
          skillId,
          skillVersion: skill.version,
          outputInstruction: skill.outputInstruction,
          outputSchema: skill.outputSchema,
          rawResult: candidate,
        });
        await service.recordResult(
          taskId,
          { ...processed.output, outputSchema: skill.outputSchema },
          resultProcessor,
        );
      },
      registerMcpServer(input) {
        return mcpRegistry.register(input);
      },
      refreshMcpServer(serverId) {
        return mcpRegistry.refresh(serverId);
      },
      async callMcpTool(serverId, toolName, arguments_, signal, context) {
        return unwrapMcpInvocationOutcome(
          await mcpRegistry.call(serverId, toolName, arguments_, signal, context),
        );
      },
      deleteMcpServer(serverId) {
        return mcpRegistry.delete(serverId);
      },
      listMcpInvocations(serverId) {
        return mcpRegistry.listInvocations(serverId);
      },
      listSkillCallWorkflows(parentInstanceId) {
        return skillCallWorkflows.listByParent(parentInstanceId);
      },
      getWorkflowInstance(instanceId) {
        return workflowInstances.findInstance(instanceId);
      },
      listMcpDependencyWarnings(serverId) {
        return mcpRegistry.listDependencyWarnings(serverId);
      },
      updateMcpToolEnhancement(serverId, toolName, enhancement) {
        return mcpRegistry.updateToolEnhancement(serverId, toolName, enhancement);
      },
      async close(): Promise<void> {
        clearInterval(waitSweepTimer);
        clearInterval(attemptDispatchTimer);
        if (remoteTaskReconcileTimer !== undefined) clearInterval(remoteTaskReconcileTimer);
        if (remoteTaskContinuationReconcileTimer !== undefined)
          clearInterval(remoteTaskContinuationReconcileTimer);
        if (remoteTaskCancellationReconcileTimer !== undefined)
          clearInterval(remoteTaskCancellationReconcileTimer);
        taskExecutor.close();
        await a2a.close();
        await startedManagement.close();
        await remoteTaskWorker?.close();
        await remoteTaskContinuationWorker?.close();
        await remoteTaskCancellationWorker?.close();
        await worker.close();
        await remoteTaskQueue?.close();
        await remoteTaskContinuationQueue?.close();
        await remoteTaskCancellationQueue?.close();
        await queue.close();
        await Promise.allSettled([...backgroundExecutions]);
        await mcpTransport.close();
        await pool.end();
        if (backgroundExecutionErrors.length > 0) {
          throw new AggregateError(
            backgroundExecutionErrors,
            'One or more tracked background executions failed during runtime shutdown.',
          );
        }
      },
    };
  } catch (error: unknown) {
    clearInterval(waitSweepTimer);
    clearInterval(attemptDispatchTimer);
    if (remoteTaskReconcileTimer !== undefined) clearInterval(remoteTaskReconcileTimer);
    if (remoteTaskContinuationReconcileTimer !== undefined)
      clearInterval(remoteTaskContinuationReconcileTimer);
    taskStateNotifier.close();
    await management?.close();
    await mcpTransport.close();
    await remoteTaskWorker?.close();
    await remoteTaskContinuationWorker?.close();
    await worker.close();
    await remoteTaskQueue?.close();
    await remoteTaskContinuationQueue?.close();
    await queue.close();
    await pool.end();
    throw error;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function unwrapMcpInvocationOutcome(outcome: McpInvocationOutcome): unknown {
  if (outcome.kind === 'immediate') return outcome.result;
  throw new RemoteMcpTaskPhaseNotConnectedError(outcome.task.remoteTaskId);
}

class RemoteMcpTaskPhaseNotConnectedError extends Error {
  readonly code = 'MCP_REMOTE_TASK_PHASE_NOT_CONNECTED';

  constructor(remoteTaskId: string) {
    super(
      `Remote MCP Task ${remoteTaskId} was accepted before the Phase 4 continuation is active.`,
    );
    this.name = 'RemoteMcpTaskPhaseNotConnectedError';
  }
}

class RemoteMcpTaskAdmissionUncertainError extends Error {
  readonly code = 'REMOTE_TASK_ADMISSION_UNCERTAIN';

  constructor(remoteTaskId: string) {
    super(
      `Remote MCP Task ${remoteTaskId} may be running, but its local binding could not be committed.`,
    );
    this.name = 'RemoteMcpTaskAdmissionUncertainError';
  }
}

export interface RuntimeMigrationOptions {
  readonly profile?: 'released' | 'v1.1-isolated';
  readonly isolationAcknowledged?: boolean;
}

export async function applyRuntimeMigrations(
  pool: Pool,
  options: RuntimeMigrationOptions = {},
): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migration (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const profile = options.profile ?? 'released';
  const database = await pool.query<{ name: string }>('SELECT current_database() AS name');
  const databaseName = database.rows[0]?.name ?? '';
  if (profile === 'v1.1-isolated') {
    if (options.isolationAcknowledged !== true || !/^sdar_v11_[a-z0-9_]+$/u.test(databaseName)) {
      throw new Error('V11_MIGRATION_ISOLATION_REQUIRED');
    }
  }
  let ledger = await pool.query<{ version: string }>('SELECT version FROM schema_migration');
  if (
    profile === 'released' &&
    ledger.rows.some((row) => Number.parseInt(row.version.slice(0, 4), 10) >= 100)
  ) {
    throw new Error('V11_MIGRATION_PROFILE_REQUIRED');
  }
  const highestAppliedSequence = Math.max(
    0,
    ...ledger.rows
      .map((row) => Number.parseInt(row.version.slice(0, 4), 10))
      .filter(Number.isFinite),
  );
  const releasedMigrations = [
    '0002_protocol_domain.up.sql',
    '0003_external_task_projection.up.sql',
    '0004_task_request.up.sql',
    '0005_projection_decoupling.up.sql',
    '0006_skill_draft.up.sql',
    '0007_skill_registry.up.sql',
    '0008_mcp_registry.up.sql',
    '0009_mcp_audit.up.sql',
    '0010_skill_graph.up.sql',
    '0011_skill_selection.up.sql',
    '0012_temporary_skill.up.sql',
    '0013_skill_embedding.up.sql',
    '0014_model_runtime.up.sql',
    '0015_prompt_runtime.up.sql',
    '0016_workflow_planning.up.sql',
    '0017_workflow_execution.up.sql',
    '0018_workflow_budget.up.sql',
    '0019_workflow_control.up.sql',
    '0020_plan_revision.up.sql',
    '0021_workflow_interrupt.up.sql',
    '0022_model_api_style.up.sql',
    '0023_goal_patch.up.sql',
    '0024_task_wait_timeout.up.sql',
    '0025_workflow_execution_control.up.sql',
    '0026_goal_continuity.up.sql',
    '0027_goal_cancellation.up.sql',
    '0028_result_processing.up.sql',
    '0029_goal_evaluation_decisions.up.sql',
    '0030_task_capability_gap.up.sql',
    '0031_global_memory.up.sql',
    '0032_goal_input_inference.up.sql',
    '0033_task_selected_skill.up.sql',
    '0034_skill_call_workflow.up.sql',
    '0035_task_skill_selection.up.sql',
    '0036_task_temporary_skill.up.sql',
    '0037_skill_evolution_simulation.up.sql',
    '0038_evolution_experience.up.sql',
    '0039_evolution_policy.up.sql',
    '0040_skill_evolution_correction.up.sql',
    '0041_skill_draft_publication.up.sql',
    '0042_skill_quality_warning.up.sql',
    '0043_workflow_template.up.sql',
    '0044_memory_status_transition.up.sql',
    '0045_memory_retention_policy.up.sql',
    '0046_task_quality_report.up.sql',
    '0047_implicit_feedback.up.sql',
    '0048_evaluation_influence.up.sql',
    '0049_evaluation_analytics.up.sql',
    '0050_mcp_management_operation.up.sql',
    '0051_workflow_node_duration.up.sql',
    '0052_observability_correlation.up.sql',
    '0053_mcp_tool_enhancement_stage.up.sql',
    '0054_skill_call_history.up.sql',
    '0055_task_input_continuation.up.sql',
    '0056_mcp_execution_mode.up.sql',
    '0057_nested_skill_confirmation.up.sql',
    '0058_runtime_terminal_outcome.up.sql',
    '0059_skill_input_resolution.up.sql',
    '0060_task_skill_input_resolution_binding.up.sql',
    '0061_goal_execution_contract.up.sql',
    '0062_skill_composition_context.up.sql',
    '0063_mcp_tool_execution_semantics.up.sql',
    '0064_memory_production_hardening.up.sql',
  ] as const;
  for (const name of releasedMigrations) {
    const sequence = Number.parseInt(name.slice(0, 4), 10);
    if (sequence <= highestAppliedSequence) continue;
    const migration = await readFile(
      resolve(process.cwd(), 'infra', 'postgres', 'migrations', name),
      'utf8',
    );
    await pool.query(migration);
  }
  if (profile !== 'v1.1-isolated') return;
  ledger = await pool.query<{ version: string }>('SELECT version FROM schema_migration');
  const applied = new Set(ledger.rows.map((row) => row.version));
  // The complete v1.0.13 hardening chain must precede the reserved V1.1 range.
  if (!applied.has('0064_memory_production_hardening')) {
    throw new Error('V11_MIGRATION_RELEASED_CHAIN_INCOMPLETE');
  }
  const v11Migrations = [
    '0100_remote_mcp_task_tracking.up.sql',
    '0101_task_execution_readiness.up.sql',
    '0102_remote_task_continuation.up.sql',
    '0103_remote_task_input_and_cancellation.up.sql',
    '0104_workflow_external_wait_event.up.sql',
    '0105_skill_usage_specification.up.sql',
  ] as const;
  const v11Versions = v11Migrations.map((name) => name.replace('.up.sql', ''));
  for (const [index, version] of v11Versions.entries()) {
    if (
      !applied.has(version) &&
      v11Versions.slice(index + 1).some((laterVersion) => applied.has(laterVersion))
    )
      throw new Error('V11_MIGRATION_LEDGER_GAP');
  }
  for (const v11Migration of v11Migrations) {
    if (applied.has(v11Migration.replace('.up.sql', ''))) continue;
    const migration = await readFile(
      resolve(process.cwd(), 'infra', 'postgres', 'migrations', v11Migration),
      'utf8',
    );
    await pool.query(migration);
  }
}

async function assertV11RuntimeReady(pool: Pool): Promise<void> {
  const database = await pool.query<{ name: string }>('SELECT current_database() AS name');
  const databaseName = database.rows[0]?.name ?? '';
  if (!/^sdar_v11_[a-z0-9_]+$/u.test(databaseName)) {
    throw new Error('V11_MIGRATION_ISOLATION_REQUIRED');
  }
  const ledger = await pool.query<{ released_present: boolean; v11_count: number }>(
    `SELECT EXISTS (
       SELECT 1 FROM schema_migration WHERE version = '0064_memory_production_hardening'
     ) AS released_present,
     (SELECT count(*)::integer FROM schema_migration
      WHERE version IN (
        '0100_remote_mcp_task_tracking',
        '0101_task_execution_readiness',
        '0102_remote_task_continuation',
        '0103_remote_task_input_and_cancellation',
        '0104_workflow_external_wait_event',
        '0105_skill_usage_specification'
      )) AS v11_count`,
  );
  const ledgerState = ledger.rows[0];
  if (ledgerState?.released_present !== true)
    throw new Error('V11_MIGRATION_RELEASED_CHAIN_INCOMPLETE');
  if (ledgerState.v11_count !== 6) throw new Error('V11_MIGRATION_NOT_APPLIED');
}
