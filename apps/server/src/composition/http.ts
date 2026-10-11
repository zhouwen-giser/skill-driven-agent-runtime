import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { startA2AHttpEndpoint } from '../../../../packages/a2a-adapter/src/http-endpoint.js';
import { parseOfficialAgentCard } from '../../../../packages/a2a-adapter/src/node-control-agent-card.js';
import { A2AProjectionTaskStore } from '../../../../packages/a2a-adapter/src/postgres-task-store.js';
import { TaskServiceAgentExecutor } from '../../../../packages/a2a-adapter/src/task-service-executor.js';
import {
  A2ATerminalProjectionReconciler,
  resolveA2ATerminalReconciliationIntervalMs,
} from '../../../../packages/a2a-adapter/src/terminal-projection-reconciler.js';
import type {
  A2AArtifactProjectionService,
  ArtifactManagementCommandService,
  ArtifactManagementQueryService,
  ArtifactPromotionGovernanceService,
  ArtifactRegistryService,
  ArtifactRevalidationApplicationService,
  ArtifactShadowApplicationService,
  CandidateGenerationRunReconciler,
  CandidateGenerationTriggerDispatcher,
  CapabilityCardPublisher,
  CapabilityPatternInductionService,
  CapabilitySummaryService,
  CognitiveManagementActionGate,
  CompilationRunReconciler,
  ConfiguredTaskTypeImportService,
  DeferredSkillEvolutionService,
  DeletionPropagationService,
  EvaluationAnalyticsService,
  EvaluationInfluenceService,
  EvolutionExperienceService,
  EvolutionPolicyService,
  ExperienceCompilationTriggerDispatcher,
  ExperienceManagementService,
  FastGatewayService,
  FrozenMcpRegistryService,
  FrozenRemoteTaskNotificationService,
  GoalCancellationService,
  GoalInputInferenceService,
  GoalPatchService,
  GoalService,
  GovernedControlConfirmationQueryService,
  GovernedControlManagementService,
  ImplicitFeedbackService,
  InMemoryTaskStateNotifier,
  InteractiveGoalSessionService,
  InteractivePlanningSessionService,
  KnowledgePromotionService,
  McpProtocolOperationsService,
  McpRegistryService,
  MemoryService,
  ModelRuntimeService,
  PlanPreparationProcessor,
  PlanningCorrectionService,
  PlanningKnowledgeRetriever,
  PromptService,
  ProviderSubscriptionCoordinator,
  RemoteTaskCancellationService,
  RemoteTaskPollingService,
  ReplayValidationRunReconciler,
  ReplayValidationTriggerDispatcher,
  ResultProcessingService,
  ResultProcessor,
  RetentionService,
  RuntimeSkillGovernanceService,
  RuntimeTaskCapabilityService,
  SkillAuthoringService,
  SkillGraphService,
  SkillInputResolutionService,
  SkillQualityService,
  SkillRegistryService,
  SkillSelectionService,
  TaskBusinessCommandService,
  TaskBusinessSyncService,
  TaskQualityEvaluationService,
  TaskService,
  TaskTypeInductionService,
  TaskWaitTimeoutService,
  TemplateRuntimeService,
  WorkflowControllerService,
  WorkflowExecutionService,
  WorkflowPlannerService,
  WorkflowRevisionService,
  WorkflowTemplateService,
  WorkflowValidator,
} from '../../../../packages/application/src/index.js';
import {
  ReadOnlyTaskProjectionService,
  type ArtifactShadowEnrollment,
  type ManagementPrincipalResolver,
  type RegisterSkillVersionInput,
} from '../../../../packages/application/src/index.js';
import { IsolatedDemoService } from '../../../../packages/application/src/isolated-demo-service.js';
import type { CreateTemporarySkillInput as CompositionCreateTemporarySkillInput } from '../../../../packages/application/src/temporary-skill.js';
import {
  createGoalExecutionContract,
  goalExecutionContractsEqual,
  type AgentTask,
  type GoalExecutionContract,
  type SkillUsageSelectionContext,
} from '../../../../packages/domain/src/index.js';
import type {
  SkillFormalizationCandidate as CompositionSkillFormalizationCandidate,
  TemporarySkill as CompositionTemporarySkill,
  TemporarySkillExperience as CompositionTemporarySkillExperience,
} from '../../../../packages/domain/src/temporary-skill.js';
import {
  BearerCognitiveManagementAuthorizer,
  startManagementHttpEndpoint,
  type DeterministicCapabilityExecutionOperation,
  type ManagementHttpEndpointHandle,
} from '../../../../packages/management-api/src/index.js';
import type {
  PostgresAgentTaskCommandContext,
  PostgresAgentTaskRepository,
  PostgresArtifactShadowGovernanceRepository,
  PostgresCaseModelRuntimeRepository,
  PostgresCognitiveManagementActionRepository,
  PostgresFastGatewayRepository,
  PostgresGoalRepository,
  PostgresRuntimeEventPublisher,
  PostgresRuntimeTerminalOutcomeRepository,
  PostgresSkillCallWorkflowRepository,
  PostgresSkillDraftRepository,
  PostgresSkillExecutionRepository,
  PostgresSkillRepository,
  PostgresTaskAvailabilityEvidenceRepository,
  PostgresTaskBusinessRepository,
  PostgresTaskUnderstandingRepository,
  PostgresUserGoalRuntimeRepository,
  PostgresWorkflowExecutionRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import {
  PostgresExternalTaskProjectionRepository,
  PostgresRemoteTaskAdmissionObservationQuery,
  PostgresRemoteTaskLifecycleQuery,
} from '../../../../packages/persistence-postgres/src/index.js';
import { PostgresIsolatedDemoAudit } from '../../../../packages/persistence-postgres/src/isolated-demo-audit.js';
import type {
  EvidenceOperationsService,
  ForegroundActivityTracker,
  RuntimeEvidenceExportService,
} from '../../../../packages/runtime-control-application/src/index.js';
import type { PostgresRuntimeAgentCardRepository } from '../../../../packages/runtime-control-persistence-postgres/src/index.js';
import {
  PostgresRuntimeSourceArtifactResolver,
  PostgresRuntimeTaskRevisionAuthority,
} from '../../../../packages/runtime-control-persistence-postgres/src/index.js';
import type {
  BullMqArtifactRevalidationQueue,
  BullMqArtifactRevalidationWorker,
  BullMqArtifactShadowQueue,
  BullMqArtifactShadowWorker,
  BullMqCandidateGenerationQueue,
  BullMqCandidateGenerationWorker,
  BullMqCompilationQueue,
  BullMqCompilationWorker,
  BullMqContextTaskQueue,
  BullMqContextWorker,
  BullMqExperienceQueue,
  BullMqExperienceWorker,
  BullMqObservationQueue,
  BullMqObservationWorker,
  BullMqReflectionQueue,
  BullMqReflectionWorker,
  BullMqRemoteTaskCancellationQueue,
  BullMqRemoteTaskCancellationWorker,
  BullMqRemoteTaskContinuationQueue,
  BullMqRemoteTaskContinuationWorker,
  BullMqRemoteTaskPollQueue,
  BullMqRemoteTaskPollWorker,
  BullMqReplayValidationQueue,
  BullMqReplayValidationWorker,
} from '../../../../packages/runtime-redis/src/index.js';
import type { UgvAgentProfileSkillRepositoryView } from '.././ugv-agent-profile.js';
import {
  UGV_AGENT_PROFILE_EXPOSURE_ID,
  UGV_AGENT_PROFILE_SKILL_ID,
  UGV_AGENT_PROFILE_SKILL_VERSION,
  useManagedAgentCardForProfile,
} from '.././ugv-agent-profile.js';
import type { UgvSimulationQualificationService } from '.././ugv-simulation-qualification.js';
import type { ServerRuntimeHandle, ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
import {
  createA2ACancelReconciliationHandler,
  resumeTaskOwnedHumanConfirmation,
  runtimeErrorCode,
  unwrapMcpInvocationOutcome,
} from './runtime-support.js';
import type { RuntimeValueRef } from './runtime-value-ref.js';
export interface composeHttpDependencies {
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly pool: Pool;
  readonly skillGraph: SkillGraphService;
  readonly capabilitySummaries: CapabilitySummaryService;
  readonly capabilityCards: CapabilityCardPublisher;
  readonly taskUnderstandings: PostgresTaskUnderstandingRepository;
  readonly interactiveGoalSessions: InteractiveGoalSessionService;
  readonly processor: RuntimeValueRef<PlanPreparationProcessor>;
  readonly interactivePlanningSessions: RuntimeValueRef<InteractivePlanningSessionService>;
  readonly planningCorrections: PlanningCorrectionService;
  readonly deletionPropagation: DeletionPropagationService;
  readonly experienceManagement: ExperienceManagementService;
  readonly taskTypeInduction: TaskTypeInductionService;
  readonly configuredTaskTypes: ConfiguredTaskTypeImportService;
  readonly capabilityPatternInduction: CapabilityPatternInductionService;
  readonly knowledgePromotion: KnowledgePromotionService;
  readonly cognitiveManagementActionRepository: PostgresCognitiveManagementActionRepository;
  readonly artifactPromotionGovernance: ArtifactPromotionGovernanceService | undefined;
  readonly goalService: GoalService;
  readonly goalPatches: GoalPatchService;
  readonly goalCancellations: GoalCancellationService;
  readonly service: RuntimeValueRef<TaskService>;
  readonly taskWaitTimeouts: TaskWaitTimeoutService;
  readonly resultProcessing: ResultProcessingService;
  readonly taskQuality: TaskQualityEvaluationService;
  readonly implicitFeedback: ImplicitFeedbackService;
  readonly evaluationInfluences: EvaluationInfluenceService;
  readonly evaluationAnalytics: EvaluationAnalyticsService;
  readonly events: PostgresRuntimeEventPublisher;
  readonly fastGatewayRepository: PostgresFastGatewayRepository;
  readonly caseModelRuntimeRepository: PostgresCaseModelRuntimeRepository;
  readonly skillExecutionRepository: PostgresSkillExecutionRepository;
  readonly runtimeTerminalOutcomes: PostgresRuntimeTerminalOutcomeRepository;
  readonly memories: MemoryService;
  readonly memoryRetention: RetentionService;
  readonly goalInputInference: GoalInputInferenceService;
  readonly skillInputResolution: SkillInputResolutionService;
  readonly mcpRegistry: McpRegistryService;
  readonly mcpProtocolOperations: McpProtocolOperationsService;
  readonly frozenMcpRegistry: FrozenMcpRegistryService;
  readonly businessEventCoordinator: ProviderSubscriptionCoordinator | undefined;
  readonly startBusinessEventsProvider: (
    serverId: string,
  ) => Promise<'disabled' | 'started' | 'already_running'>;
  readonly frozenTaskNotifications: FrozenRemoteTaskNotificationService | undefined;
  readonly userGoalRuntimeRepository: PostgresUserGoalRuntimeRepository;
  readonly skillRegistry: SkillRegistryService;
  readonly skillAuthoring: SkillAuthoringService;
  readonly modelRuntime: ModelRuntimeService;
  readonly prompts: PromptService;
  readonly goals: PostgresGoalRepository;
  readonly skillSelection: SkillSelectionService;
  readonly resolveSkillUsageContext: (
    goalContract: GoalExecutionContract,
    task?: AgentTask,
  ) => Promise<SkillUsageSelectionContext>;
  readonly skillQuality: SkillQualityService;
  readonly workflowTemplates: WorkflowTemplateService;
  readonly temporarySkillOperations: {
    create: (input: CompositionCreateTemporarySkillInput) => Promise<CompositionTemporarySkill>;
    listByTask: (taskId: string) => Promise<readonly CompositionTemporarySkill[]>;
    complete(
      temporarySkillId: string,
      successful: boolean,
      outcomeSummary: string,
    ): Promise<
      Readonly<{
        skill: CompositionTemporarySkill;
        experience: CompositionTemporarySkillExperience;
        formalizationCandidate?: CompositionSkillFormalizationCandidate;
      }>
    >;
  };
  readonly skillEvolution: DeferredSkillEvolutionService;
  readonly evolutionExperiences: EvolutionExperienceService;
  readonly evolutionPolicy: EvolutionPolicyService;
  readonly workflowValidator: WorkflowValidator;
  readonly workflowPlanner: WorkflowPlannerService;
  readonly workflowExecution: WorkflowExecutionService;
  readonly tasks: PostgresAgentTaskRepository;
  readonly workflowController: RuntimeValueRef<WorkflowControllerService>;
  readonly workflowRevision: WorkflowRevisionService;
  readonly taskAvailabilityEvidence: PostgresTaskAvailabilityEvidenceRepository | undefined;
  readonly deviceWorkScope:
    { allowedDeviceIds: string[]; sdarServiceKey: string; includeNonDevice: boolean } | undefined;
  readonly remoteTaskPolling: RemoteTaskPollingService | undefined;
  readonly remoteTaskCancellation: RemoteTaskCancellationService | undefined;
  readonly taskBusinessCommands: TaskBusinessCommandService | undefined;
  readonly taskBusinessRepository: PostgresTaskBusinessRepository;
  readonly cognitiveManagementActions: CognitiveManagementActionGate;
  readonly deterministicCapabilityExecutions: DeterministicCapabilityExecutionOperation;
  readonly artifactManagement:
    | {
        queries: ArtifactManagementQueryService;
        commands: ArtifactManagementCommandService;
        principalResolver: ManagementPrincipalResolver;
      }
    | undefined;
  readonly governedControlManagement: GovernedControlManagementService;
  readonly governedControlConfirmationQuery: GovernedControlConfirmationQueryService;
  readonly ugvAgentProfile: boolean;
  readonly emergencyControlManagement: GovernedControlManagementService;
  readonly weaponControlManagement: GovernedControlManagementService;
  readonly runtimeSkillGovernance: RuntimeSkillGovernanceService;
  readonly clock: { now: () => string };
  readonly evidenceExport: RuntimeEvidenceExportService;
  readonly evidenceOperations: EvidenceOperationsService;
  readonly taskCommands: PostgresAgentTaskCommandContext;
  readonly ugvSimulationQualification: UgvSimulationQualificationService | undefined;
  readonly foregroundActivity: ForegroundActivityTracker;
  readonly interactiveGoalMetadata: (
    taskId: string,
  ) => Promise<Readonly<Record<string, unknown>> | undefined>;
  readonly taskStateNotifier: InMemoryTaskStateNotifier;
  readonly profileSkills: UgvAgentProfileSkillRepositoryView | PostgresSkillRepository;
  readonly a2aArtifactProjection: A2AArtifactProjectionService;
  readonly taskCapabilities: RuntimeTaskCapabilityService;
  readonly managedAgentCards: PostgresRuntimeAgentCardRepository;
  readonly planningKnowledge: PlanningKnowledgeRetriever;
  readonly artifactRegistry: RuntimeValueRef<ArtifactRegistryService | undefined>;
  readonly templateRuntime: TemplateRuntimeService | undefined;
  readonly fastGateway: FastGatewayService | undefined;
  readonly artifactShadowRuntime:
    | {
        revalidationWorker?: BullMqArtifactRevalidationWorker;
        repository: PostgresArtifactShadowGovernanceRepository;
        service: ArtifactShadowApplicationService;
        queue: BullMqArtifactShadowQueue;
        revalidationQueue: BullMqArtifactRevalidationQueue;
        revalidation: ArtifactRevalidationApplicationService | undefined;
        worker: BullMqArtifactShadowWorker;
      }
    | undefined;
  readonly skillDrafts: PostgresSkillDraftRepository;
  readonly skills: PostgresSkillRepository;
  readonly resultProcessor: ResultProcessor;
  readonly skillCallWorkflows: PostgresSkillCallWorkflowRepository;
  readonly workflowInstances: PostgresWorkflowExecutionRepository;
  readonly waitSweepTimer: NodeJS.Timeout;
  readonly attemptDispatchTimer: NodeJS.Timeout;
  readonly capabilityCatalogRefreshTimer: NodeJS.Timeout;
  readonly providerBindingReconciliationTimer: NodeJS.Timeout | undefined;
  readonly experienceDispatchTimer: NodeJS.Timeout;
  readonly evidenceExportTimer: NodeJS.Timeout;
  readonly evidenceOperationsMaintenanceTimer: NodeJS.Timeout;
  readonly runtimeCoreEvidenceProjectionTimer: NodeJS.Timeout;
  readonly remoteTaskReconcileTimer: NodeJS.Timeout | undefined;
  readonly remoteTaskContinuationReconcileTimer: NodeJS.Timeout | undefined;
  readonly remoteTaskCancellationReconcileTimer: NodeJS.Timeout | undefined;
  readonly businessEventIngressTimer: NodeJS.Timeout | undefined;
  readonly businessRefreshTimer: NodeJS.Timeout | undefined;
  readonly taskBusinessSync: TaskBusinessSyncService | undefined;
  readonly businessRefreshCompletion: RuntimeValueRef<Promise<void> | undefined>;
  readonly remoteTaskWorker: BullMqRemoteTaskPollWorker | undefined;
  readonly remoteTaskContinuationWorker: BullMqRemoteTaskContinuationWorker | undefined;
  readonly remoteTaskCancellationWorker: BullMqRemoteTaskCancellationWorker | undefined;
  readonly experienceWorker: BullMqExperienceWorker;
  readonly observationWorker: BullMqObservationWorker;
  readonly reflectionWorker: BullMqReflectionWorker;
  readonly experienceCompilation:
    | {
        replayValidationDispatcher?: ReplayValidationTriggerDispatcher;
        replayValidationReconciler?: ReplayValidationRunReconciler;
        replayValidationQueue?: BullMqReplayValidationQueue;
        replayValidationRetention?: (retentionNow: string, limit?: number) => Promise<number>;
        replayValidationWorker?: BullMqReplayValidationWorker;
        candidateDispatcher?: CandidateGenerationTriggerDispatcher;
        candidateReconciler?: CandidateGenerationRunReconciler;
        candidateQueue?: BullMqCandidateGenerationQueue;
        candidateWorker?: BullMqCandidateGenerationWorker;
        dispatcher: ExperienceCompilationTriggerDispatcher;
        normalizationReconciler: CompilationRunReconciler;
        miningReconciler: CompilationRunReconciler;
        normalizationQueue: BullMqCompilationQueue;
        miningQueue: BullMqCompilationQueue;
        normalizationWorker: BullMqCompilationWorker;
        miningWorker: BullMqCompilationWorker;
      }
    | undefined;
  readonly worker: BullMqContextWorker;
  readonly remoteTaskQueue: BullMqRemoteTaskPollQueue | undefined;
  readonly remoteTaskContinuationQueue: BullMqRemoteTaskContinuationQueue | undefined;
  readonly remoteTaskCancellationQueue: BullMqRemoteTaskCancellationQueue | undefined;
  readonly experienceQueue: BullMqExperienceQueue;
  readonly observationQueue: BullMqObservationQueue;
  readonly reflectionQueue: BullMqReflectionQueue;
  readonly queue: BullMqContextTaskQueue;
  readonly backgroundExecutions: Set<Promise<void>>;
  readonly evidenceExportInFlight: RuntimeValueRef<Promise<void> | undefined>;
  readonly evidenceOperationsMaintenanceInFlight: RuntimeValueRef<Promise<void> | undefined>;
  readonly runtimeCoreEvidenceProjection: RuntimeValueRef<Promise<void> | undefined>;
  readonly providerBindingReconciliationInFlight: RuntimeValueRef<Promise<void> | undefined>;
  readonly backgroundExecutionErrors: unknown[];
  readonly resolveTaskWorkflowControlId: (task: AgentTask) => Promise<string>;
}
export async function composeHttp(
  dependencies: composeHttpDependencies,
): Promise<ServerRuntimeHandle> {
  const { cleanupScope } = dependencies;
  const interactivePlanningSessions = dependencies.interactivePlanningSessions.value;
  const {
    options,
    pool,
    skillGraph,
    capabilitySummaries,
    capabilityCards,
    taskUnderstandings,
    interactiveGoalSessions,
    planningCorrections,
    deletionPropagation,
    experienceManagement,
    taskTypeInduction,
    configuredTaskTypes,
    capabilityPatternInduction,
    knowledgePromotion,
    cognitiveManagementActionRepository,
    artifactPromotionGovernance,
    goalService,
    goalPatches,
    goalCancellations,
    taskWaitTimeouts,
    resultProcessing,
    taskQuality,
    implicitFeedback,
    evaluationInfluences,
    evaluationAnalytics,
    events,
    fastGatewayRepository,
    caseModelRuntimeRepository,
    skillExecutionRepository,
    runtimeTerminalOutcomes,
    memories,
    memoryRetention,
    goalInputInference,
    skillInputResolution,
    mcpRegistry,
    mcpProtocolOperations,
    frozenMcpRegistry,
    businessEventCoordinator,
    startBusinessEventsProvider,
    frozenTaskNotifications,
    userGoalRuntimeRepository,
    skillRegistry,
    skillAuthoring,
    modelRuntime,
    prompts,
    goals,
    skillSelection,
    resolveSkillUsageContext,
    skillQuality,
    workflowTemplates,
    temporarySkillOperations,
    skillEvolution,
    evolutionExperiences,
    evolutionPolicy,
    workflowValidator,
    workflowPlanner,
    workflowExecution,
    tasks,
    workflowRevision,
    taskAvailabilityEvidence,
    deviceWorkScope,
    remoteTaskPolling,
    remoteTaskCancellation,
    taskBusinessCommands,
    taskBusinessRepository,
    cognitiveManagementActions,
    deterministicCapabilityExecutions,
    artifactManagement,
    governedControlManagement,
    governedControlConfirmationQuery,
    ugvAgentProfile,
    emergencyControlManagement,
    weaponControlManagement,
    runtimeSkillGovernance,
    clock,
    evidenceExport,
    evidenceOperations,
    taskCommands,
    ugvSimulationQualification,
    foregroundActivity,
    interactiveGoalMetadata,
    taskStateNotifier,
    profileSkills,
    a2aArtifactProjection,
    taskCapabilities,
    managedAgentCards,
    planningKnowledge,
    templateRuntime,
    fastGateway,
    artifactShadowRuntime,
    skillDrafts,
    skills,
    resultProcessor,
    skillCallWorkflows,
    workflowInstances,
    waitSweepTimer,
    attemptDispatchTimer,
    capabilityCatalogRefreshTimer,
    providerBindingReconciliationTimer,
    experienceDispatchTimer,
    evidenceExportTimer,
    evidenceOperationsMaintenanceTimer,
    runtimeCoreEvidenceProjectionTimer,
    remoteTaskReconcileTimer,
    remoteTaskContinuationReconcileTimer,
    remoteTaskCancellationReconcileTimer,
    businessEventIngressTimer,
    businessRefreshTimer,
    taskBusinessSync,
    remoteTaskWorker,
    remoteTaskContinuationWorker,
    remoteTaskCancellationWorker,
    experienceWorker,
    observationWorker,
    reflectionWorker,
    experienceCompilation,
    worker,
    remoteTaskQueue,
    remoteTaskContinuationQueue,
    remoteTaskCancellationQueue,
    experienceQueue,
    observationQueue,
    reflectionQueue,
    queue,
    backgroundExecutions,
    backgroundExecutionErrors,
    resolveTaskWorkflowControlId,
  } = dependencies;
  let management: ManagementHttpEndpointHandle | undefined;
  let a2aTerminalProjectionReconciliationTimer: NodeJS.Timeout | undefined;
  let a2aTerminalProjectionReconciliationInFlight: Promise<void> | undefined;
  try {
    const startedManagement = await startManagementHttpEndpoint({
      operations: {
        ...(options.disableDeviceWeapons === true
          ? {
              isolatedDemo: new IsolatedDemoService(new PostgresIsolatedDemoAudit(pool), () =>
                new Date().toISOString(),
              ),
            }
          : {}),
        graph: skillGraph,
        capabilities: capabilitySummaries,
        capabilityCards,
        taskUnderstandings,
        ...{
          goalSessions: {
            getByTask: interactiveGoalSessions.getByTask.bind(interactiveGoalSessions),
            async applyAction(input) {
              const view = await interactiveGoalSessions.applyAction(input);
              if (view.session.state === 'confirmed' && view.candidate !== undefined) {
                await dependencies.processor.value.continueConfirmedGoalSession(
                  view.session.taskId,
                  view.candidate.contract,
                );
              }
              return view;
            },
          },
        },
        ...{
          planningSessions: {
            getByTask: interactivePlanningSessions.getByTask.bind(interactivePlanningSessions),
            async applyAction(input) {
              const view = await interactivePlanningSessions.applyAction(input);
              if (view.session.state === 'confirmed') {
                await dependencies.processor.value.continueConfirmedPlanningSession(
                  view.session.taskId,
                  view.candidate.plan.planId,
                );
              }
              return view;
            },
          },
        },
        planningInteractions: {
          listTaskInteractions: planningCorrections.listTaskInteractions.bind(planningCorrections),
          async deleteUserScopedProjection(userId, actorId) {
            return (await deletionPropagation.propagate(userId, actorId)).deletedCount;
          },
        },
        experience: experienceManagement,
        taskTypes: taskTypeInduction,
        configuredTaskTypes,
        capabilityPatterns: capabilityPatternInduction,
        knowledgePromotion,
        cognitiveManagementAudit: cognitiveManagementActionRepository,
        ...(artifactPromotionGovernance === undefined
          ? {}
          : { artifactPromotion: artifactPromotionGovernance }),
        goals: goalService,
        goalPatches,
        goalCancellations,
        tasks: dependencies.service.value,
        taskWaitTimeouts,
        resultProcessing,
        taskQuality,
        implicitFeedback,
        evaluationInfluences,
        evaluationAnalytics,
        runtimeEvents: events,
        gatewayEvidence: fastGatewayRepository,
        caseModelRuntimeEvidence: caseModelRuntimeRepository,
        skillExecutions: skillExecutionRepository,
        runtimeTerminalOutcomes,
        memories,
        memoryRetention,
        goalInputInference,
        skillInputResolution,
        mcp: mcpRegistry,
        mcpProtocol: mcpProtocolOperations,
        frozenMcp: {
          async register(input) {
            const registered = await frozenMcpRegistry.register(input);
            if (businessEventCoordinator !== undefined)
              await startBusinessEventsProvider(registered.server.serverId);
            return registered;
          },
          async refresh(serverId) {
            const refreshed = await frozenMcpRegistry.refresh(serverId);
            if (businessEventCoordinator !== undefined) await startBusinessEventsProvider(serverId);
            return refreshed;
          },
          replaceCredentials: frozenMcpRegistry.replaceCredentials.bind(frozenMcpRegistry),
        },
        ...(frozenTaskNotifications === undefined
          ? {}
          : { frozenMcpNotifications: frozenTaskNotifications }),
        ...(businessEventCoordinator === undefined
          ? {}
          : {
              businessEvents: {
                start: startBusinessEventsProvider,
                health: (serverId: string) => businessEventCoordinator.health(serverId),
                listSubscriptions: (limit: number) =>
                  userGoalRuntimeRepository.listBusinessEventSubscriptions(limit),
                listInbox: (limit: number) =>
                  userGoalRuntimeRepository.listBusinessEventInbox(limit),
                listAssessments: (limit: number) =>
                  userGoalRuntimeRepository.listEventImpactAssessments(limit),
                listIncidents: (limit: number) =>
                  userGoalRuntimeRepository.listEventIncidents(limit),
              },
            }),
        userGoalRuntime: {
          async current(goalId: string, goalVersion: number) {
            const current =
              (await userGoalRuntimeRepository.findCurrentPlan(goalId, goalVersion)) ??
              (await userGoalRuntimeRepository.findLatestPlan(goalId, goalVersion));
            if (current === undefined) return null;
            return {
              ...current,
              outcomes: await userGoalRuntimeRepository.listSkillGoalOutcomeDecisions(
                current.plan.planId,
              ),
              completedEffects: await userGoalRuntimeRepository.listValidCompletedEffects(goalId),
              progress: await userGoalRuntimeRepository.findLatestProgress(current.plan.planId),
            };
          },
        },
        skills: skillRegistry,
        skillAuthoring,
        models: modelRuntime,
        prompts,
        ...{
          skillSelection: {
            select: async (goalContract: GoalExecutionContract) => {
              const goal = await goals.findById(goalContract.goalId);
              if (
                goal !== undefined &&
                (goal.status !== 'active' ||
                  !goalExecutionContractsEqual(createGoalExecutionContract(goal), goalContract))
              )
                throw Object.assign(
                  new Error('Registered Skill selection requires the exact active Goal contract.'),
                  { code: 'SKILL_SELECTION_GOAL_CONTRACT_STALE' as const },
                );
              return skillSelection.select(
                goalContract,
                await resolveSkillUsageContext(goalContract),
              );
            },
          },
        },
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
          resumeHumanConfirmation: (input) =>
            resumeTaskOwnedHumanConfirmation(input, {
              findInstance: (instanceId) => workflowExecution.get(instanceId),
              findTaskByPlanId: (planId) => tasks.findByPlanId(planId),
              taskIdentity: (task) => ({ taskId: task.taskId, contextId: task.contextId }),
              resolveWorkflowControlId: (task) => resolveTaskWorkflowControlId(task),
              resume: (resumeInput) => workflowExecution.resumeHumanConfirmation(resumeInput),
            }),
          pauseForPlan: (planId) => workflowExecution.pauseForPlan(planId),
          resumePauseForPlan: (planId) => workflowExecution.resumePauseForPlan(planId),
          cancelForPlan: (planId) => workflowExecution.cancelForPlan(planId),
          trace: (instanceId) => workflowExecution.trace(instanceId),
          traceForPlan: (planId) => workflowExecution.traceForPlan(planId),
        },
        workflowControls: dependencies.workflowController.value,
        workflowRevisions: workflowRevision,
        ...(taskAvailabilityEvidence === undefined
          ? {}
          : { taskAvailability: taskAvailabilityEvidence }),
        ...(options.frozenMcpTasks === undefined
          ? {}
          : {
              remoteTaskLifecycle: new PostgresRemoteTaskLifecycleQuery(pool, deviceWorkScope),
              remoteTaskAdmissionObservations: new PostgresRemoteTaskAdmissionObservationQuery(
                pool,
                deviceWorkScope,
              ),
              ...(remoteTaskPolling === undefined ? {} : { remoteTaskPolling }),
              ...(remoteTaskCancellation === undefined ? {} : { remoteTaskCancellation }),
              ...(taskBusinessCommands === undefined
                ? {}
                : {
                    taskBusiness: {
                      list: (taskId: string) => taskBusinessRepository.listByTask(taskId),
                      commands: taskBusinessCommands,
                      async sourceArtifact(taskId, ref) {
                        try {
                          return (
                            await new PostgresRuntimeSourceArtifactResolver(
                              pool,
                              deviceWorkScope,
                            ).resolveTaskBusiness(taskId, ref)
                          ).canonicalBytes;
                        } catch (error: unknown) {
                          if (
                            error instanceof Error &&
                            'code' in error &&
                            error.code === 'RUNTIME_SOURCE_ARTIFACT_NOT_FOUND'
                          )
                            throw Object.assign(
                              new Error('The original Task does not own this source artifact.'),
                              { code: 'TASK_BUSINESS_CONTENT_NOT_FOUND', status: 404 },
                            );
                          throw error;
                        }
                      },
                      async content(taskId: string, bindingId: string, digest: string) {
                        const target = await taskBusinessRepository.loadTarget(bindingId);
                        if (target?.binding.agentTaskId !== taskId)
                          throw Object.assign(
                            new Error('The original Task does not own this business content.'),
                            { code: 'TASK_BUSINESS_CONTENT_NOT_FOUND', status: 404 },
                          );
                        const bytes = await taskBusinessRepository.readContent(bindingId, digest);
                        if (bytes === undefined)
                          throw Object.assign(new Error('Business content was not found.'), {
                            code: 'TASK_BUSINESS_CONTENT_NOT_FOUND',
                            status: 404,
                          });
                        return Buffer.from(bytes);
                      },
                    },
                  }),
            }),
      },
      ...(options.managementHost === undefined ? {} : { host: options.managementHost }),
      ...(options.managementPort === undefined ? {} : { port: options.managementPort }),
      consoleDirectory: resolve('apps/console/dist'),
      cognitiveManagementActions,
      ...(options.cognitiveManagementBearerToken === undefined
        ? {}
        : {
            cognitiveManagementAuthorizer: new BearerCognitiveManagementAuthorizer(
              options.cognitiveManagementBearerToken,
            ),
          }),
      ...(options.cognitiveManagementBearerToken === undefined ||
      options.currentMcpProviderBindingAuthorityReader === undefined
        ? {}
        : {
            deterministicCapabilityExecution: {
              operation: deterministicCapabilityExecutions,
              authorizer: new BearerCognitiveManagementAuthorizer(
                options.cognitiveManagementBearerToken,
              ),
              actions: cognitiveManagementActions,
            },
          }),
      ...(artifactManagement === undefined ? {} : { artifactManagement }),
      ...(options.governedControlPrincipalResolver === undefined
        ? {}
        : {
            governedControl: {
              confirmations: governedControlManagement,
              query: governedControlConfirmationQuery,
              ...(ugvAgentProfile
                ? {
                    emergencyStop: emergencyControlManagement,
                    weapon: weaponControlManagement,
                  }
                : {}),
              principalResolver: options.governedControlPrincipalResolver,
            },
          }),
      ...(options.runtimeControlServiceToken === undefined
        ? {}
        : {
            runtimeControl: {
              bearerToken: options.runtimeControlServiceToken,
              skills: runtimeSkillGovernance,
              health: {
                async get() {
                  const observedAt = clock.now();
                  try {
                    const result = await pool.query<{
                      active_tasks: string;
                    }>(`SELECT count(*)::text AS active_tasks
                         FROM agent_task
                        WHERE phase NOT IN ('completed','failed','canceled','invalidated','capability_gap')`);
                    const activeTasks = Number(result.rows[0]?.active_tasks ?? '0');
                    if (!Number.isSafeInteger(activeTasks) || activeTasks < 0)
                      throw new Error('RUNTIME_ACTIVE_TASK_COUNT_INVALID');
                    return Object.freeze({
                      nodeId: 'sdar-runtime',
                      status: 'healthy' as const,
                      components: Object.freeze([
                        Object.freeze({
                          component: 'runtime_database',
                          status: 'healthy' as const,
                          observedAt,
                        }),
                        Object.freeze({
                          component: 'task_authority',
                          status: 'healthy' as const,
                          observedAt,
                        }),
                      ]),
                      activeTasks,
                      observedAt,
                    });
                  } catch {
                    return Object.freeze({
                      nodeId: 'sdar-runtime',
                      status: 'unavailable' as const,
                      components: Object.freeze([
                        Object.freeze({
                          component: 'runtime_database',
                          status: 'unavailable' as const,
                          reasonCode: 'RUNTIME_DATABASE_UNAVAILABLE',
                          observedAt,
                        }),
                      ]),
                      activeTasks: 0,
                      observedAt,
                    });
                  }
                },
              },
              version: {
                get: () =>
                  Promise.resolve(
                    Object.freeze({
                      runtimeVersion: '1.4.1',
                      nodeControlContractVersion: '1.0.0',
                      runtimeControlContractVersion: '1.0.0',
                    }),
                  ),
              },
              evidenceExport,
              evidenceOperations,
              taskRevisionAuthority: new PostgresRuntimeTaskRevisionAuthority(pool, taskCommands),
              ...(ugvSimulationQualification === undefined ? {} : { ugvSimulationQualification }),
              actorId: 'sdar-node-control',
              ...(options.runtimeControlArtifactPrincipalResolver === undefined
                ? {}
                : {
                    artifactPrincipalResolver: options.runtimeControlArtifactPrincipalResolver,
                  }),
            },
          }),
    });
    startedManagement.close = cleanupScope.register(
      startedManagement.close.bind(startedManagement),
    );

    management = startedManagement;
    const foregroundAwareTasks = {
      submit: (command: Parameters<typeof dependencies.service.value.submit>[0]) =>
        foregroundActivity.run(() => dependencies.service.value.submit(command)),
      get: dependencies.service.value.get.bind(dependencies.service.value),
      followUp: (command: Parameters<typeof dependencies.service.value.followUp>[0]) =>
        foregroundActivity.run(() => dependencies.service.value.followUp(command)),
      cancel: (taskId: string) =>
        foregroundActivity.run(() => dependencies.service.value.cancel(taskId)),
    };
    const a2aProjections = new PostgresExternalTaskProjectionRepository(pool, deviceWorkScope);
    const taskProjectionReader = new ReadOnlyTaskProjectionService({
      readState: (taskId) => tasks.findWithRevision(taskId),
      readInteraction: interactiveGoalMetadata,
      readArtifacts: (taskId) => taskBusinessRepository.exportTaskArtifacts(taskId),
      hash: (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    });
    const a2aTaskStore = new A2AProjectionTaskStore(
      a2aProjections,
      tasks,
      createA2ACancelReconciliationHandler(foregroundAwareTasks),
      interactiveGoalMetadata,
      taskProjectionReader,
    );
    const taskExecutor = new TaskServiceAgentExecutor({
      observationOwnedByHandler: true,
      tasks: foregroundAwareTasks,
      notifier: taskStateNotifier,
      interaction: interactiveGoalMetadata,
      businessArtifacts: (taskId) => taskBusinessRepository.exportTaskArtifacts(taskId),
      ...(options.a2aWaitTimeoutMs === undefined
        ? {}
        : { waitTimeoutMs: options.a2aWaitTimeoutMs }),
      ...(options.a2aSafetyPollIntervalMs === undefined
        ? {}
        : { safetyPollIntervalMs: options.a2aSafetyPollIntervalMs }),
    });
    const a2aTerminalProjectionReconciler = new A2ATerminalProjectionReconciler({
      projections: a2aProjections,
      tasks,
      taskStore: a2aTaskStore,
      interaction: interactiveGoalMetadata,
    });
    await a2aTerminalProjectionReconciler.reconcile();
    const scheduleA2ATerminalProjectionReconciliation = (): void => {
      if (a2aTerminalProjectionReconciliationInFlight !== undefined) return;
      a2aTerminalProjectionReconciliationInFlight = a2aTerminalProjectionReconciler
        .reconcile()
        .then((result) => {
          if (result.reconciled === 0) return;
          process.stdout.write(
            `${JSON.stringify({ event: 'a2a_terminal_projection.reconciled', ...result })}\n`,
          );
        })
        .catch((error: unknown) => {
          process.stderr.write(
            `${JSON.stringify({ event: 'a2a_terminal_projection.reconciliation_failed', errorCode: runtimeErrorCode(error), summary: error instanceof Error ? error.message : String(error) })}\n`,
          );
        })
        .finally(() => {
          a2aTerminalProjectionReconciliationInFlight = undefined;
        });
    };
    a2aTerminalProjectionReconciliationTimer = setInterval(
      scheduleA2ATerminalProjectionReconciliation,
      resolveA2ATerminalReconciliationIntervalMs(options.a2aTerminalReconciliationIntervalMs),
    );
    a2aTerminalProjectionReconciliationTimer.unref();
    const a2a = await startA2AHttpEndpoint({
      executor: taskExecutor,
      observation: {
        reader: taskProjectionReader,
        notifier: taskStateNotifier,
        waitTimeoutMs: options.a2aWaitTimeoutMs ?? 30000,
        pollIntervalMs: options.a2aSafetyPollIntervalMs ?? 1000,
      },
      taskStore: a2aTaskStore,
      skillProvider: {
        async listEnabled() {
          return (await profileSkills.listEnabledVersions()).map((skill) => ({
            id: skill.skillId,
            name: skill.name,
            description: skill.summary,
            tags: [...skill.capabilities],
          }));
        },
      },
      ...(artifactManagement === undefined
        ? {}
        : {
            artifactProjectionProvider: {
              projectPublic: () =>
                Promise.resolve(
                  a2aArtifactProjection.project({
                    capabilities: [
                      'experience-informed-planning',
                      'validated-planning-templates',
                      'policy-governed-fast-paths',
                      'interactive-confirmation',
                    ],
                    inputRequired: true,
                    confirmation: true,
                    formalTaskState: 'unchanged',
                    evidence: {
                      artifactEnhancement: true,
                      formalAuthority: 'existing-runtime',
                    },
                  }),
                ),
            },
          }),
      capabilityCardProvider: capabilityCards,
      ...(ugvAgentProfile
        ? {
            naturalLanguageAdmissionContractProvider: {
              async findCurrent() {
                const pointSkill = await profileSkills.findVersion(
                  UGV_AGENT_PROFILE_SKILL_ID,
                  UGV_AGENT_PROFILE_SKILL_VERSION,
                );
                if (pointSkill?.status !== 'enabled') return undefined;
                return taskCapabilities.describeCurrentAdmissionExposure(
                  UGV_AGENT_PROFILE_EXPOSURE_ID,
                  clock.now(),
                );
              },
            },
          }
        : {}),
      ...(ugvAgentProfile && options.governedControlPrincipalResolver !== undefined
        ? { confirmationPrincipalResolver: options.governedControlPrincipalResolver }
        : {}),
      ...(useManagedAgentCardForProfile(options.taskUnderstanding?.profile)
        ? {
            agentCardProvider: {
              async findActive() {
                const card = await managedAgentCards.findActiveCard();
                return card === undefined ? undefined : parseOfficialAgentCard(card);
              },
            },
          }
        : {}),
      ...(options.a2aHost === undefined ? {} : { host: options.a2aHost }),
      ...(options.a2aPublicBaseUrl === undefined
        ? {}
        : { publicBaseUrl: options.a2aPublicBaseUrl }),
      ...(options.a2aPort === undefined ? {} : { port: options.a2aPort }),
    });
    a2a.close = cleanupScope.register(a2a.close.bind(a2a));

    return {
      a2a,
      management: startedManagement,
      planningKnowledge,
      ...(dependencies.artifactRegistry.value === undefined
        ? {}
        : { artifactRegistry: dependencies.artifactRegistry.value }),
      ...(templateRuntime === undefined ? {} : { templateRuntime }),
      ...(fastGateway === undefined ? {} : { fastGateway }),
      gatewayEvidence(taskId: string) {
        return fastGatewayRepository.findByTaskId(taskId);
      },
      taskBusiness(taskId: string) {
        return taskBusinessRepository.listByTask(taskId);
      },
      taskBusinessContent(bindingId: string, digest: string) {
        return taskBusinessRepository.readContent(bindingId, digest);
      },
      enrollArtifactShadow(input: ArtifactShadowEnrollment) {
        // The formal runtime must provide an exact already-selected artifact and
        // formal fact correlation. P06 does not perform retrieval or selection.
        return artifactShadowRuntime?.service.enroll(input) ?? Promise.resolve(undefined);
      },
      async requestInput(taskId: string, reason: string): Promise<void> {
        await dependencies.service.value.requestInput(taskId, reason);
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
        await dependencies.service.value.fail(taskId, errorCode, message);
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
        await dependencies.service.value.recordResult(
          taskId,
          { ...processed.output, outputSchema: skill.outputSchema },
          resultProcessor,
        );
      },
      async registerMcpServer(input) {
        const registered = await frozenMcpRegistry.register(input);
        if (businessEventCoordinator !== undefined)
          await startBusinessEventsProvider(registered.server.serverId);
        return registered;
      },
      async refreshMcpServer(serverId) {
        const refreshed = await frozenMcpRegistry.refresh(serverId);
        if (businessEventCoordinator !== undefined) await startBusinessEventsProvider(serverId);
        return refreshed;
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
      startBusinessEvents(serverId) {
        return startBusinessEventsProvider(serverId);
      },
      businessEventsHealth(serverId) {
        return businessEventCoordinator?.health(serverId);
      },
      async close(): Promise<void> {
        clearInterval(waitSweepTimer);
        clearInterval(attemptDispatchTimer);
        clearInterval(capabilityCatalogRefreshTimer);
        if (providerBindingReconciliationTimer !== undefined)
          clearInterval(providerBindingReconciliationTimer);
        clearInterval(experienceDispatchTimer);
        clearInterval(evidenceExportTimer);
        clearInterval(evidenceOperationsMaintenanceTimer);
        clearInterval(runtimeCoreEvidenceProjectionTimer);
        if (remoteTaskReconcileTimer !== undefined) clearInterval(remoteTaskReconcileTimer);
        if (remoteTaskContinuationReconcileTimer !== undefined)
          clearInterval(remoteTaskContinuationReconcileTimer);
        if (remoteTaskCancellationReconcileTimer !== undefined)
          clearInterval(remoteTaskCancellationReconcileTimer);
        if (businessEventIngressTimer !== undefined) clearInterval(businessEventIngressTimer);
        if (businessRefreshTimer !== undefined) clearInterval(businessRefreshTimer);
        if (a2aTerminalProjectionReconciliationTimer !== undefined)
          clearInterval(a2aTerminalProjectionReconciliationTimer);
        taskExecutor.close();
        frozenTaskNotifications?.close();
        businessEventCoordinator?.close();
        await taskBusinessSync?.stop();
        await dependencies.businessRefreshCompletion.value;
        await a2a.close();
        await startedManagement.close();
        await remoteTaskWorker?.close();
        await remoteTaskContinuationWorker?.close();
        await remoteTaskCancellationWorker?.close();
        await experienceWorker.close();
        await observationWorker.close();
        await reflectionWorker.close();
        await experienceCompilation?.normalizationWorker.close();
        await experienceCompilation?.miningWorker.close();
        await experienceCompilation?.candidateWorker?.close();
        await experienceCompilation?.replayValidationWorker?.close();
        await artifactShadowRuntime?.worker.close();
        await artifactShadowRuntime?.revalidationWorker?.close();
        await worker.close();
        await remoteTaskQueue?.close();
        await remoteTaskContinuationQueue?.close();
        await remoteTaskCancellationQueue?.close();
        await experienceQueue.close();
        await observationQueue.close();
        await reflectionQueue.close();
        await experienceCompilation?.normalizationQueue.close();
        await experienceCompilation?.miningQueue.close();
        await experienceCompilation?.candidateQueue?.close();
        await experienceCompilation?.replayValidationQueue?.close();
        await artifactShadowRuntime?.queue.close();
        await artifactShadowRuntime?.revalidationQueue.close();
        await queue.close();
        await Promise.allSettled([...backgroundExecutions]);
        await a2aTerminalProjectionReconciliationInFlight;
        await dependencies.evidenceExportInFlight.value;
        await dependencies.evidenceOperationsMaintenanceInFlight.value;
        await dependencies.runtimeCoreEvidenceProjection.value;
        await dependencies.providerBindingReconciliationInFlight.value;
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
    clearInterval(capabilityCatalogRefreshTimer);
    if (providerBindingReconciliationTimer !== undefined)
      clearInterval(providerBindingReconciliationTimer);
    clearInterval(experienceDispatchTimer);
    clearInterval(evidenceExportTimer);
    clearInterval(evidenceOperationsMaintenanceTimer);
    clearInterval(runtimeCoreEvidenceProjectionTimer);
    if (remoteTaskReconcileTimer !== undefined) clearInterval(remoteTaskReconcileTimer);
    if (remoteTaskContinuationReconcileTimer !== undefined)
      clearInterval(remoteTaskContinuationReconcileTimer);
    if (businessEventIngressTimer !== undefined) clearInterval(businessEventIngressTimer);
    if (businessRefreshTimer !== undefined) clearInterval(businessRefreshTimer);
    if (a2aTerminalProjectionReconciliationTimer !== undefined)
      clearInterval(a2aTerminalProjectionReconciliationTimer);
    taskStateNotifier.close();
    frozenTaskNotifications?.close();
    businessEventCoordinator?.close();
    await taskBusinessSync?.stop();
    await dependencies.businessRefreshCompletion.value;
    await management?.close();
    await remoteTaskWorker?.close();
    await remoteTaskContinuationWorker?.close();
    await experienceWorker.close();
    await observationWorker.close();
    await reflectionWorker.close();
    await experienceCompilation?.normalizationWorker.close();
    await experienceCompilation?.miningWorker.close();
    await experienceCompilation?.candidateWorker?.close();
    await experienceCompilation?.replayValidationWorker?.close();
    await artifactShadowRuntime?.worker.close();
    await artifactShadowRuntime?.revalidationWorker?.close();
    await worker.close();
    await remoteTaskQueue?.close();
    await remoteTaskContinuationQueue?.close();
    await experienceQueue.close();
    await observationQueue.close();
    await reflectionQueue.close();
    await experienceCompilation?.normalizationQueue.close();
    await experienceCompilation?.miningQueue.close();
    await experienceCompilation?.candidateQueue?.close();
    await experienceCompilation?.replayValidationQueue?.close();
    await artifactShadowRuntime?.queue.close();
    await artifactShadowRuntime?.revalidationQueue.close();
    await queue.close();
    await a2aTerminalProjectionReconciliationInFlight;
    await dependencies.evidenceExportInFlight.value;
    await dependencies.evidenceOperationsMaintenanceInFlight.value;
    await dependencies.runtimeCoreEvidenceProjection.value;
    await dependencies.providerBindingReconciliationInFlight.value;
    await pool.end();
    throw error;
  }
}
