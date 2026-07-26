import { once } from 'node:events';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';

import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import type {
  McpRegistryService,
  McpProtocolOperationsService,
  FrozenMcpRegistryService,
  ModelRuntimeService,
  PromptService,
  SkillAuthoringService,
  SkillSelectionService,
  SkillInputResolutionService,
  SkillQualityService,
  RegisterSkillVersionInput,
  SkillRegistryService,
  SkillGraphService,
  TemporarySkillService,
  SkillEvolutionService,
  EvolutionExperienceService,
  EvolutionPolicyService,
  WorkflowValidator,
  WorkflowPlannerService,
  WorkflowExecutionService,
  WorkflowControllerService,
  GoalService,
  GoalPatchService,
  GoalCancellationService,
  ResultProcessingService,
  MemoryService,
  MemoryRetentionPolicyService,
  GoalInputInferenceService,
  WorkflowRevisionService,
  WorkflowTemplateService,
  TaskService,
  TaskWaitTimeoutService,
  TaskQualityEvaluationService,
  ImplicitFeedbackService,
  EvaluationInfluenceService,
  EvaluationAnalyticsService,
  RuntimeEventQuery,
  RuntimeTerminalOutcomeRepository,
  TaskAvailabilityEvidenceRepository,
  RemoteTaskLifecycleQuery,
  RemoteTaskLifecycleEvidence,
  RemoteTaskPollingService,
  RemoteTaskCancellationService,
  SkillExecutionRepository,
  CapabilitySummaryService,
  CapabilityCardPublisher,
  TaskUnderstandingRepository,
  InteractiveGoalSessionService,
  InteractivePlanningSessionService,
  PlanningCorrectionService,
  ExperienceManagementService,
  TaskTypeInductionService,
  CapabilityPatternInductionService,
} from '../../application/src/index.js';
import type { SkillExecutionView, SkillUsageSpecification } from '../../domain/src/index.js';

const TaskWaitPolicySchema = z.object({ timeoutSeconds: z.number().int().positive() });
const AgentTaskPhaseSchema = z.enum([
  'queued',
  'context_loading',
  'goal_deliberation',
  'skill_resolution',
  'planning',
  'awaiting_plan_confirmation',
  'awaiting_user_input',
  'paused',
  'executing',
  'evaluating',
  'capability_gap',
  'completed',
  'canceled',
  'failed',
  'invalidated',
]);
const EvolutionPolicySchema = z.object({ successThreshold: z.number().int().min(2) });
const MemoryRetentionPolicySchema = z.object({
  reviewAfterDays: z.number().int().positive(),
  archiveAfterDays: z.number().int().positive().nullable(),
  deleteAfterDays: z.number().int().positive().nullable(),
  automaticArchiveEnabled: z.boolean(),
  automaticDeleteEnabled: z.boolean(),
});
const CancelGoalSchema = z.object({ reason: z.string().min(1) });
const TaskActionSchema = z
  .object({
    action: z.enum([
      'confirm_plan',
      'reject_plan',
      'revise_plan',
      'patch_goal',
      'cancel_goal',
      'provide_input',
      'pause',
      'resume',
    ]),
    messageText: z.string().min(1),
    inputRequestId: z.string().min(1).optional(),
    inputContent: z.unknown().optional(),
  })
  .strict();
const InteractiveGoalActionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().min(1).max(256),
    actorId: z.string().min(1).max(128),
    action: z.enum(['answer', 'accept', 'patch', 'reject', 'restart_understanding', 'cancel']),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const InteractivePlanningActionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().min(1).max(256),
    actorId: z.string().min(1).max(128),
    action: z.enum(['accept', 'patch', 'reject', 'cancel']),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const EvaluationAnalyticsFilterSchema = z
  .object({
    skillId: z.string().min(1).optional(),
    skillVersion: z.coerce.number().int().positive().optional(),
    providerId: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    serverId: z.string().min(1).optional(),
    toolName: z.string().min(1).optional(),
  })
  .strict();
const CreateMemorySchema = z.object({
  memoryId: z.string().min(1).optional(),
  type: z.enum([
    'fact',
    'success_experience',
    'failure_experience',
    'workflow_pattern',
    'skill_learning',
    'prompt_learning',
  ]),
  content: z.record(z.string(), z.unknown()),
  summary: z.string().min(1),
  sourceRefs: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1),
  supersedes: z.array(z.string().min(1)).optional(),
});
const SupersedeMemorySchema = CreateMemorySchema.omit({ supersedes: true }).extend({
  actor: z.string().min(1),
  reason: z.string().min(1),
});
const InvalidateMemorySchema = z.object({ actor: z.string().min(1), reason: z.string().min(1) });
const TaskReadinessQuerySchema = z
  .object({
    phase: z.enum(['planning', 'pre_invocation']).optional(),
    limit: z.coerce.number().int().min(1).max(1_000).optional(),
  })
  .strict();
const RefreshRemoteTaskSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const CancelRemoteTaskSchema = z
  .object({
    idempotencyKey: z.string().min(1).max(512),
    reasonCode: z.string().min(1).max(128),
    summary: z.string().min(1).max(2_048),
  })
  .strict();

const JsonSchema = z.union([z.boolean(), z.record(z.string(), z.unknown())]);
const RegisterMcpServerSchema = z.object({
  serverId: z.string().min(1),
  name: z.string().min(1),
  endpoint: z.url(),
  credentialHeaders: z.record(z.string(), z.string()),
});
const ToolEnhancementSchema = z.object({
  purpose: z.string(),
  scenarios: z.array(z.string()),
  constraints: z.array(z.string()),
  returnDescription: z.string(),
  commonErrors: z.array(z.string()),
  tags: z.array(z.string()),
});
const ToolExecutionSemanticsValuesSchema = z
  .object({
    effect: z.enum(['read_only', 'side_effecting', 'unknown']),
    execution: z.enum(['synchronous', 'task_capable', 'task_required', 'unknown']),
    cancellation: z.enum(['unsupported', 'cooperative', 'task_cancel', 'unknown']),
    idempotency: z.enum(['none', 'client_request_key', 'server_managed', 'unknown']),
    replay: z.enum(['allowed', 'simulation_only', 'forbidden', 'unknown']),
  })
  .strict();
const ToolReferenceSchema = z.object({ serverId: z.string().min(1), toolName: z.string().min(1) });
const SkillRelationSchema = z.object({
  sourceSkillId: z.string().min(1),
  targetSkillId: z.string().min(1),
  relationType: z.enum([
    'parent_child',
    'depends_on',
    'input_output_match',
    'alternative',
    'composition',
    'capability_coverage',
  ]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
const SkillOutcomeSpecificationSchema = z.object({
  schemaVersion: z.literal('1.0'),
  skillId: z.string().min(1),
  skillVersion: z.number().int().positive(),
  specificationHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  effects: z.array(z.string().min(1)).min(1),
  evidence: z.array(z.string().min(1)).min(1),
  artifacts: z.array(z.string().min(1)),
  taskGoalPolicy: z.record(z.string(), z.unknown()),
  confidencePolicy: z.record(z.string(), z.unknown()),
  sideEffectPolicy: z.record(z.string(), z.unknown()),
});
const RegisterSkillSchema = z.object({
  skillId: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().min(1),
  capabilities: z.array(z.string()),
  workflowGuidance: z.string(),
  outputInstruction: z.string(),
  inputSchema: JsonSchema,
  outputSchema: JsonSchema,
  toolPolicy: z.object({
    required: z.array(ToolReferenceSchema),
    optional: z.array(ToolReferenceSchema),
    forbidden: z.array(ToolReferenceSchema),
  }),
  runtimePolicy: z.object({
    autoConfirmPlan: z.boolean(),
    maxReplans: z.number().int().nonnegative().optional(),
    maxDurationSeconds: z.number().int().positive().optional(),
    maxLlmCalls: z.number().int().nonnegative().optional(),
    maxMcpCalls: z.number().int().nonnegative().optional(),
    maxCost: z.number().nonnegative().optional(),
    pauseReplanThresholdSeconds: z.number().int().nonnegative().optional(),
    cancelStrategy: z.enum(['wait_current', 'try_interrupt', 'cleanup_workflow']).optional(),
    compensationGuidance: z.string().optional(),
  }),
  status: z.enum(['draft', 'validating', 'enabled', 'disabled', 'deprecated', 'validation_failed']),
  sourceKind: z.enum(['admin', 'a2a_draft', 'experience_evolution', 'manual_correction']),
  validationPassed: z.boolean(),
  usageSpecification: z.unknown().optional(),
  outcomeSpecification: SkillOutcomeSpecificationSchema.optional(),
});
const SkillPackageRootSchema = z.object({ packageRoot: z.string().min(1).max(4096) }).strict();
const SkillCatalogQuerySchema = z
  .object({
    lifecycle: z
      .enum(['draft', 'validating', 'active', 'inactive', 'deprecated', 'validation_failed'])
      .optional(),
    mode: z.enum(['guidance', 'template', 'procedure']).optional(),
    domain: z.string().min(1).optional(),
    tag: z.string().min(1).optional(),
    userSelectable: z.enum(['true', 'false']).optional(),
    composable: z.enum(['true', 'false']).optional(),
    internalOnly: z.enum(['true', 'false']).optional(),
  })
  .strict();
const CapabilitySummaryQuerySchema = z
  .object({
    maxEntries: z.coerce.number().int().min(1).max(256).optional(),
    maxCharacters: z.coerce.number().int().min(256).max(65_536).optional(),
  })
  .strict();
const CreateTemporarySkillSchema = z.object({
  contextId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  tools: z.array(ToolReferenceSchema).min(1),
  inputSchema: JsonSchema,
  outputSchema: JsonSchema,
});
const CompleteTemporarySkillSchema = z.object({
  successful: z.boolean(),
  outcomeSummary: z.string().min(1),
});
const CorrectEvolutionCandidateSchema = z.object({
  actor: z.string().min(1),
  summary: z.string().min(1),
  proposedSkill: z.object({
    skillId: z.string().min(1),
    name: z.string().min(1),
    summary: z.string().min(1),
    description: z.string().min(1),
    capabilities: z.array(z.string().min(1)).min(1),
    workflowGuidance: z.string().min(1),
    outputInstruction: z.string().min(1),
    inputSchema: JsonSchema,
    outputSchema: JsonSchema,
    tools: z.array(ToolReferenceSchema).min(1),
    usageSpecification: z.unknown(),
    outcomeSpecification: SkillOutcomeSpecificationSchema,
  }),
});
const AuthorSkillSchema = z.object({
  skillId: z.string().min(1),
  naturalLanguageDescription: z.string().min(1),
  toolPolicy: z.object({
    required: z.array(ToolReferenceSchema),
    optional: z.array(ToolReferenceSchema),
    forbidden: z.array(ToolReferenceSchema),
  }),
  runtimePolicy: RegisterSkillSchema.shape.runtimePolicy,
  status: z.enum(['draft', 'enabled', 'disabled']),
  sourceKind: z.enum(['admin', 'a2a_draft']),
  outcomeSpecification: RegisterSkillSchema.shape.outcomeSpecification,
  usageSpecification: RegisterSkillSchema.shape.usageSpecification,
});
const PublishSkillDraftSchema = z.object({
  actor: z.string().min(1),
  skillId: z.string().min(1),
  toolPolicy: RegisterSkillSchema.shape.toolPolicy,
  runtimePolicy: RegisterSkillSchema.shape.runtimePolicy,
  status: z.enum(['enabled', 'disabled']),
  outcomeSpecification: RegisterSkillSchema.shape.outcomeSpecification,
  usageSpecification: RegisterSkillSchema.shape.usageSpecification,
});
const GoalExecutionContractSchema = z
  .object({
    goalId: z.string().min(1),
    version: z.number().int().positive(),
    title: z.string().min(1),
    description: z.string().min(1),
    constraints: z.array(z.string()),
    successCriteria: z.array(z.string()),
  })
  .strict();
const SelectSkillSchema = z.object({ goalContract: GoalExecutionContractSchema }).strict();
const SkillQualityObservationSchema = z.object({
  skillVersion: z.number().int().positive(),
  evaluationRef: z.string().min(1),
  score: z.number().min(0).max(1),
  successful: z.boolean(),
});
const ModelStageSchema = z.enum([
  'intent',
  'goal',
  'tool_enhancement',
  'skill_authoring',
  'goal_planning',
  'skill_selection',
  'skill_input_resolution',
  'workflow_planning',
  'execution_decision',
  'goal_evaluation',
  'evaluation',
  'result_processing',
  'task_understanding',
  'task_clarification',
  'goal_contract_generation',
  'interactive_plan_patch',
  'experience_observation',
  'experience_reflection',
  'task_type_induction',
  'capability_pattern_induction',
]);
const ConfigureModelProviderSchema = z.object({
  providerId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['openai_compatible', 'local', 'other_vendor']),
  apiStyle: z.enum(['openai_chat_completions', 'anthropic_messages']),
  baseUrl: z.url(),
  model: z.string().min(1),
  enabled: z.boolean(),
  timeoutMs: z.number().int().positive(),
  credentialHeaders: z.record(z.string(), z.string()),
});
const RouteModelStageSchema = z.object({ providerId: z.string().min(1) });
const CreatePromptSchema = z.object({
  promptId: z.string().min(1),
  stage: ModelStageSchema,
  content: z.string().min(1),
  source: z.enum(['admin', 'auto_candidate', 'manual_correction']),
  publish: z.boolean(),
});
const PlanWorkflowSchema = z.object({
  planId: z.string().min(1),
  workflowDefinitionId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  goalId: z.string().min(1),
  goalVersion: z.number().int().positive(),
  goalContract: GoalExecutionContractSchema,
  planningInstruction: z.string().min(1),
  compositionRoot: z
    .object({
      skillId: z.string().min(1),
      skillVersion: z.number().int().positive(),
    })
    .strict()
    .optional(),
  sourceConfirmedPlanId: z.string().min(1).optional(),
});
const ExecuteWorkflowSchema = z.object({
  instanceId: z.string().min(1),
  input: z.unknown(),
  skillIds: z.array(z.string().min(1)).optional(),
});
const ResumeHumanConfirmationSchema = z.object({ confirmed: z.boolean() });
const CreateGoalSchema = z.object({
  goalId: z.string().min(1),
  contextId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  constraints: z.array(z.string()).optional(),
  successCriteria: z.array(z.string()).optional(),
});
const ApplyGoalPatchSchema = z.object({
  sourcePlanId: z.string().min(1),
  instruction: z.string().min(1),
  taskId: z.string().min(1).optional(),
});
const StartWorkflowControlSchema = z.object({
  controlId: z.string().min(1),
  contextId: z.string().min(1),
  goalId: z.string().min(1),
  goalVersion: z.number().int().positive(),
  taskId: z.string().min(1).optional(),
  initialPlanId: z.string().min(1),
  input: z.unknown(),
  skillIds: z.array(z.string().min(1)),
  planningInstruction: z.string().min(1),
});
const AttachTaskPlanSchema = z.object({
  planId: z.string().min(1),
  goalId: z.string().min(1),
  goalVersion: z.number().int().positive(),
});
const AdminWorkflowRevisionSchema = z.object({
  newPlanId: z.string().min(1),
  format: z.enum(['dsl', 'dag']),
  definition: z.unknown(),
});
const PlanningPreferenceDeletionSchema = z
  .object({ actorId: z.string().trim().min(1).max(256) })
  .strict();
const ExperienceListQuerySchema = z
  .object({
    goalId: z.string().trim().min(1).max(128).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
const ExperienceDeadLetterReplaySchema = z
  .object({ actorId: z.string().trim().min(1).max(256) })
  .strict();

export interface ManagementOperations {
  readonly goals: Pick<GoalService, 'create' | 'get' | 'history'>;
  readonly goalPatches: Pick<GoalPatchService, 'apply' | 'get' | 'list'>;
  readonly goalCancellations: Pick<GoalCancellationService, 'cancel' | 'get' | 'list'>;
  readonly tasks: Pick<TaskService, 'attachPlan' | 'followUp' | 'get' | 'list'>;
  readonly taskWaitTimeouts: Pick<TaskWaitTimeoutService, 'getPolicy' | 'updatePolicy'>;
  readonly resultProcessing: Pick<ResultProcessingService, 'get' | 'list'>;
  readonly taskQuality: Pick<TaskQualityEvaluationService, 'getByTask'>;
  readonly implicitFeedback: Pick<ImplicitFeedbackService, 'listByTask'>;
  readonly evaluationInfluences: Pick<EvaluationInfluenceService, 'getByReport'>;
  readonly evaluationAnalytics: Pick<EvaluationAnalyticsService, 'summarize'>;
  readonly runtimeEvents: RuntimeEventQuery;
  readonly skillExecutions?: Pick<SkillExecutionRepository, 'find' | 'listByTask' | 'listChildren'>;
  readonly runtimeTerminalOutcomes: Pick<RuntimeTerminalOutcomeRepository, 'find'>;
  readonly memories: Pick<
    MemoryService,
    'refine' | 'get' | 'search' | 'supersede' | 'invalidate' | 'listTransitions'
  >;
  readonly memoryRetention: Pick<MemoryRetentionPolicyService, 'getPolicy' | 'updatePolicy'>;
  readonly goalInputInference: Pick<GoalInputInferenceService, 'list'>;
  readonly skillInputResolution: Pick<SkillInputResolutionService, 'get' | 'list'>;
  readonly graph: Pick<SkillGraphService, 'create' | 'delete' | 'list'>;
  readonly mcp: Pick<
    McpRegistryService,
    | 'delete'
    | 'listDependencyWarnings'
    | 'listInvocations'
    | 'listInvocationsByTask'
    | 'listManagementOperations'
    | 'listServers'
    | 'listTools'
    | 'updateToolEnhancement'
    | 'updateToolExecutionSemantics'
  >;
  readonly mcpProtocol?: Pick<
    McpProtocolOperationsService,
    'auditBaseline' | 'diagnose' | 'listProviders'
  >;
  readonly frozenMcp?: Pick<FrozenMcpRegistryService, 'refresh' | 'register'>;
  readonly frozenMcpNotifications?: Readonly<{
    reconnect(serverId: string): Promise<
      Readonly<{
        serverId: string;
        disposition: 'started' | 'already_running' | 'no_active_tasks';
        taskIds: readonly string[];
      }>
    >;
  }>;
  readonly skills: Pick<
    SkillRegistryService,
    | 'diff'
    | 'importPackageRoot'
    | 'listCatalog'
    | 'listCurrentVersions'
    | 'listVersions'
    | 'readExactVersion'
    | 'register'
    | 'rollback'
    | 'setEnabled'
    | 'validatePackage'
  >;
  readonly capabilities: Pick<CapabilitySummaryService, 'getSummary' | 'rebuild'>;
  readonly capabilityCards: Pick<CapabilityCardPublisher, 'findActive' | 'publish'>;
  readonly taskUnderstandings: Pick<TaskUnderstandingRepository, 'findCurrent' | 'listRevisions'>;
  readonly goalSessions?: Pick<InteractiveGoalSessionService, 'getByTask' | 'applyAction'>;
  readonly planningSessions?: Pick<InteractivePlanningSessionService, 'getByTask' | 'applyAction'>;
  readonly planningInteractions?: Pick<
    PlanningCorrectionService,
    'listTaskInteractions' | 'deleteUserScopedProjection'
  >;
  readonly experience?: Pick<
    ExperienceManagementService,
    'listEpisodes' | 'listObservations' | 'listReflections' | 'listDeadLetters' | 'replayDeadLetter'
  >;
  readonly taskTypes?: Pick<TaskTypeInductionService, 'list'>;
  readonly capabilityPatterns?: Pick<CapabilityPatternInductionService, 'list' | 'listGaps'>;
  readonly temporarySkills: Pick<TemporarySkillService, 'complete' | 'create' | 'listByTask'>;
  readonly skillEvolution: Pick<
    SkillEvolutionService,
    'correctAndRevalidate' | 'evaluateAndPublish' | 'get' | 'listCorrections'
  >;
  readonly evolutionExperiences: Pick<
    EvolutionExperienceService,
    'get' | 'listByGoal' | 'listBySkill'
  >;
  readonly evolutionPolicy: Pick<
    EvolutionPolicyService,
    'getPolicy' | 'listTriggers' | 'updatePolicy'
  >;
  readonly skillAuthoring?: Pick<
    SkillAuthoringService,
    'authorAndRegister' | 'getDraft' | 'publishDraft'
  >;
  readonly skillSelection?: Pick<SkillSelectionService, 'select'>;
  readonly skillQuality: Pick<SkillQualityService, 'listWarnings' | 'record'>;
  readonly workflowTemplates: Pick<WorkflowTemplateService, 'listTemplates' | 'listUses'>;
  readonly models: Pick<
    ModelRuntimeService,
    | 'configureProvider'
    | 'listInvocations'
    | 'listInvocationsByTask'
    | 'listProviders'
    | 'listStageRoutes'
    | 'route'
  >;
  readonly prompts: Pick<
    PromptService,
    'create' | 'disable' | 'effect' | 'listVersions' | 'publish' | 'rollback'
  >;
  readonly workflows: Pick<WorkflowValidator, 'validate'> &
    Pick<WorkflowPlannerService, 'plan'> &
    Pick<
      WorkflowExecutionService,
      | 'cancelForPlan'
      | 'confirm'
      | 'execute'
      | 'pauseForPlan'
      | 'resumeHumanConfirmation'
      | 'resumePauseForPlan'
      | 'trace'
      | 'traceForPlan'
    >;
  readonly workflowControls: Pick<
    WorkflowControllerService,
    'continueAfterConfirmation' | 'get' | 'listRounds' | 'start'
  >;
  readonly workflowRevisions: Pick<WorkflowRevisionService, 'get' | 'reviseAdmin'>;
  readonly taskAvailability?: Pick<TaskAvailabilityEvidenceRepository, 'listByPlan'>;
  readonly remoteTaskLifecycle?: RemoteTaskLifecycleQuery;
  readonly remoteTaskPolling?: Pick<RemoteTaskPollingService, 'process'>;
  readonly remoteTaskCancellation?: Pick<RemoteTaskCancellationService, 'request'>;
  readonly businessEvents?: Readonly<{
    start(serverId: string): Promise<'disabled' | 'started' | 'already_running'>;
    health(serverId: string): unknown;
    listSubscriptions(limit: number): Promise<readonly unknown[]>;
    listInbox(limit: number): Promise<readonly unknown[]>;
    listAssessments(limit: number): Promise<readonly unknown[]>;
    listIncidents(limit: number): Promise<readonly unknown[]>;
  }>;
  readonly userGoalRuntime?: Readonly<{
    current(goalId: string, goalVersion: number): Promise<unknown>;
  }>;
}

export interface ManagementHttpEndpointHandle {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export async function startManagementHttpEndpoint(
  options: Readonly<{
    operations: ManagementOperations;
    consoleDirectory?: string;
    host?: string;
    port?: number;
  }>,
): Promise<ManagementHttpEndpointHandle> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((_request, response, next) => {
    response.setHeader('X-SDAR-Security-Warning', 'trusted-intranet-only-no-auth');
    next();
  });
  app.get('/api/v1/health', (_request, response) => {
    response.json({
      status: 'ok',
      authentication: 'none',
      deployment: 'trusted-intranet-only',
      historicalDataRetention: {
        default: 'indefinite',
        automaticArchive: false,
        automaticDelete: false,
        policyFieldsAreAdvisory: true,
      },
    });
  });
  app.get(
    '/api/v1/business-events/providers/:serverId/health',
    asyncRoute((request, response) => {
      response.json({
        enabled: options.operations.businessEvents !== undefined,
        health: options.operations.businessEvents?.health(pathValue(request, 'serverId')) ?? null,
      });
      return Promise.resolve();
    }),
  );
  app.post(
    '/api/v1/business-events/providers/:serverId/reconnect',
    asyncRoute(async (request, response) => {
      if (options.operations.businessEvents === undefined)
        throw new HttpInputError(
          'BUSINESS_EVENTS_DISABLED',
          'Business Events runtime is disabled by default and requires explicit opt-in.',
        );
      response.status(202).json({
        serverId: pathValue(request, 'serverId'),
        disposition: await options.operations.businessEvents.start(pathValue(request, 'serverId')),
      });
    }),
  );
  app.get(
    '/api/v1/business-events/subscriptions',
    asyncRoute(async (request, response) => {
      const limit = boundedQueryLimit(request, 100);
      response.json({
        items: (await options.operations.businessEvents?.listSubscriptions(limit)) ?? [],
      });
    }),
  );
  app.get(
    '/api/v1/business-events/inbox',
    asyncRoute(async (request, response) => {
      const limit = boundedQueryLimit(request, 100);
      response.json({ items: (await options.operations.businessEvents?.listInbox(limit)) ?? [] });
    }),
  );
  app.get(
    '/api/v1/business-events/impact-assessments',
    asyncRoute(async (request, response) => {
      const limit = boundedQueryLimit(request, 100);
      response.json({
        items: (await options.operations.businessEvents?.listAssessments(limit)) ?? [],
      });
    }),
  );
  app.get(
    '/api/v1/business-events/incidents',
    asyncRoute(async (request, response) => {
      const limit = boundedQueryLimit(request, 100);
      response.json({
        items: (await options.operations.businessEvents?.listIncidents(limit)) ?? [],
      });
    }),
  );
  app.get(
    '/api/v1/runtime-terminal-outcomes/:outcomeId',
    asyncRoute(async (request, response) => {
      const outcome = await options.operations.runtimeTerminalOutcomes.find(
        pathValue(request, 'outcomeId'),
      );
      if (outcome === undefined)
        throw new HttpInputError(
          'RUNTIME_TERMINAL_OUTCOME_NOT_FOUND',
          'Runtime terminal outcome was not found.',
        );
      response.json(outcome);
    }),
  );
  app.post(
    '/api/v1/memories',
    asyncRoute(async (request, response) => {
      const input = CreateMemorySchema.parse(request.body);
      response.status(201).json(
        await options.operations.memories.refine({
          type: input.type,
          content: input.content,
          summary: input.summary,
          sourceRefs: input.sourceRefs,
          confidence: input.confidence,
          ...(input.memoryId === undefined ? {} : { memoryId: input.memoryId }),
          ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
        }),
      );
    }),
  );
  app.get(
    '/api/v1/memories/search',
    asyncRoute(async (request, response) => {
      const query = z.string().min(1).parse(request.query['q']);
      const limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .parse(request.query['limit']);
      response.json({ items: await options.operations.memories.search(query, limit) });
    }),
  );
  app.post(
    '/api/v1/memories/:memoryId/supersede',
    asyncRoute(async (request, response) => {
      const input = SupersedeMemorySchema.parse(request.body);
      response.status(201).json(
        await options.operations.memories.supersede(pathValue(request, 'memoryId'), {
          type: input.type,
          content: input.content,
          summary: input.summary,
          sourceRefs: input.sourceRefs,
          confidence: input.confidence,
          actor: input.actor,
          reason: input.reason,
          ...(input.memoryId === undefined ? {} : { memoryId: input.memoryId }),
        }),
      );
    }),
  );
  app.post(
    '/api/v1/memories/:memoryId/invalidate',
    asyncRoute(async (request, response) => {
      const input = InvalidateMemorySchema.parse(request.body);
      await options.operations.memories.invalidate(
        pathValue(request, 'memoryId'),
        input.actor,
        input.reason,
      );
      response.status(204).end();
    }),
  );
  app.get(
    '/api/v1/memories/:memoryId/transitions',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.memories.listTransitions(pathValue(request, 'memoryId')),
      });
    }),
  );
  app.get(
    '/api/v1/memories/:memoryId',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.memories.get(pathValue(request, 'memoryId')));
    }),
  );
  app.get(
    '/api/v1/system/task-wait-policy',
    asyncRoute(async (_request, response) => {
      response.json(await options.operations.taskWaitTimeouts.getPolicy());
    }),
  );
  app.get(
    '/api/v1/system/memory-retention-policy',
    asyncRoute(async (_request, response) => {
      response.json(await options.operations.memoryRetention.getPolicy());
    }),
  );
  app.put(
    '/api/v1/system/memory-retention-policy',
    asyncRoute(async (request, response) => {
      response.json(
        await options.operations.memoryRetention.updatePolicy(
          MemoryRetentionPolicySchema.parse(request.body),
        ),
      );
    }),
  );
  app.put(
    '/api/v1/system/task-wait-policy',
    asyncRoute(async (request, response) => {
      const input = TaskWaitPolicySchema.parse(request.body);
      response.json(await options.operations.taskWaitTimeouts.updatePolicy(input.timeoutSeconds));
    }),
  );
  app.get('/api/v1/system/evolution-policy', async (_request, response) => {
    response.json(await options.operations.evolutionPolicy.getPolicy());
  });
  app.put(
    '/api/v1/system/evolution-policy',
    asyncRoute(async (request, response) => {
      const input = EvolutionPolicySchema.parse(request.body);
      response.json(await options.operations.evolutionPolicy.updatePolicy(input.successThreshold));
    }),
  );
  app.get(
    '/api/v1/evolution-triggers',
    asyncRoute(async (request, response) => {
      const fingerprint =
        typeof request.query['capabilityFingerprint'] === 'string'
          ? request.query['capabilityFingerprint']
          : undefined;
      response.json({
        items: await options.operations.evolutionPolicy.listTriggers(fingerprint),
      });
    }),
  );
  app.post(
    '/api/v1/goals',
    asyncRoute(async (request, response) => {
      const input = CreateGoalSchema.parse(request.body);
      response.status(201).json(
        await options.operations.goals.create({
          goalId: input.goalId,
          contextId: input.contextId,
          title: input.title,
          description: input.description,
          ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
          ...(input.successCriteria === undefined
            ? {}
            : { successCriteria: input.successCriteria }),
        }),
      );
    }),
  );
  app.get(
    '/api/v1/goals/:goalId',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.goals.get(pathValue(request, 'goalId')));
    }),
  );
  app.get(
    '/api/v1/goals/:goalId/user-goal-plan',
    asyncRoute(async (request, response) => {
      if (options.operations.userGoalRuntime === undefined)
        throw new HttpInputError(
          'USER_GOAL_RUNTIME_UNAVAILABLE',
          'User Goal runtime projection is unavailable.',
        );
      const goalVersion = z.coerce.number().int().positive().parse(request.query['goalVersion']);
      response.json(
        await options.operations.userGoalRuntime.current(pathValue(request, 'goalId'), goalVersion),
      );
    }),
  );
  app.post(
    '/api/v1/goals/:goalId/cancel',
    asyncRoute(async (request, response) => {
      const input = CancelGoalSchema.parse(request.body);
      response
        .status(201)
        .json(
          await options.operations.goalCancellations.cancel(
            pathValue(request, 'goalId'),
            input.reason,
          ),
        );
    }),
  );
  app.get(
    '/api/v1/goals/:goalId/cancellations',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.goalCancellations.list(pathValue(request, 'goalId')),
      });
    }),
  );
  app.get(
    '/api/v1/goal-cancellations/:cancellationId',
    asyncRoute(async (request, response) => {
      response.json(
        await options.operations.goalCancellations.get(pathValue(request, 'cancellationId')),
      );
    }),
  );
  app.get(
    '/api/v1/contexts/:contextId/goals',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.goals.history(pathValue(request, 'contextId')));
    }),
  );
  app.post(
    '/api/v1/goals/:goalId/patches',
    asyncRoute(async (request, response) => {
      const input = ApplyGoalPatchSchema.parse(request.body);
      response.status(201).json(
        await options.operations.goalPatches.apply({
          goalId: pathValue(request, 'goalId'),
          sourcePlanId: input.sourcePlanId,
          instruction: input.instruction,
          ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        }),
      );
    }),
  );
  app.get(
    '/api/v1/goals/:goalId/patches',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.goalPatches.list(pathValue(request, 'goalId')),
      });
    }),
  );
  app.get(
    '/api/v1/goal-patches/:patchId',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.goalPatches.get(pathValue(request, 'patchId')));
    }),
  );
  app.post(
    '/api/v1/workflow-controls',
    asyncRoute(async (request, response) => {
      const input = StartWorkflowControlSchema.parse(request.body);
      response.status(201).json(
        await options.operations.workflowControls.start({
          controlId: input.controlId,
          contextId: input.contextId,
          goalId: input.goalId,
          goalVersion: input.goalVersion,
          ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
          initialPlanId: input.initialPlanId,
          input: input.input,
          skillIds: input.skillIds,
          planningInstruction: input.planningInstruction,
        }),
      );
    }),
  );
  app.get(
    '/api/v1/workflow-controls/:controlId',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.workflowControls.get(pathValue(request, 'controlId')));
    }),
  );
  app.get(
    '/api/v1/workflow-controls/:controlId/rounds',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.workflowControls.listRounds(
          pathValue(request, 'controlId'),
        ),
      });
    }),
  );
  app.post(
    '/api/v1/workflow-controls/:controlId/continue',
    asyncRoute(async (request, response) => {
      response.json(
        await options.operations.workflowControls.continueAfterConfirmation(
          pathValue(request, 'controlId'),
        ),
      );
    }),
  );
  app.get(
    '/api/v1/tasks',
    asyncRoute(async (request, response) => {
      const contextId =
        typeof request.query['contextId'] === 'string' ? request.query['contextId'] : undefined;
      const planId =
        typeof request.query['planId'] === 'string' ? request.query['planId'] : undefined;
      const goalId =
        typeof request.query['goalId'] === 'string' ? request.query['goalId'] : undefined;
      const skillId =
        typeof request.query['skillId'] === 'string' ? request.query['skillId'] : undefined;
      const phase =
        request.query['phase'] === undefined
          ? undefined
          : AgentTaskPhaseSchema.parse(request.query['phase']);
      const limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .default(50)
        .parse(request.query['limit']);
      response.json({
        items: await options.operations.tasks.list({
          ...(contextId === undefined ? {} : { contextId }),
          ...(planId === undefined ? {} : { planId }),
          ...(goalId === undefined ? {} : { goalId }),
          ...(skillId === undefined ? {} : { skillId }),
          ...(phase === undefined ? {} : { phase }),
          limit,
        }),
      });
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.tasks.get(pathValue(request, 'taskId')));
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/events',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.runtimeEvents.listByTask(pathValue(request, 'taskId')),
      });
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/skill-executions',
    asyncRoute(async (request, response) => {
      if (options.operations.skillExecutions === undefined) {
        response.status(503).json({ code: 'SKILL_EXECUTION_QUERY_UNAVAILABLE' });
        return;
      }
      const items = await options.operations.skillExecutions.listByTask(
        pathValue(request, 'taskId'),
      );
      response.json(skillExecutionCollection(items));
    }),
  );
  app.get(
    '/api/v1/skill-executions/:executionId',
    asyncRoute(async (request, response) => {
      if (options.operations.skillExecutions === undefined) {
        response.status(503).json({ code: 'SKILL_EXECUTION_QUERY_UNAVAILABLE' });
        return;
      }
      const execution = await options.operations.skillExecutions.find(
        pathValue(request, 'executionId'),
      );
      if (execution === undefined) {
        response.status(404).json({ code: 'SKILL_EXECUTION_NOT_FOUND' });
        return;
      }
      const taskExecutions = await options.operations.skillExecutions.listByTask(execution.taskId);
      const collection = skillExecutionCollection(taskExecutions);
      response.json({
        warnings: collection.warnings,
        item: presentSkillExecution(execution),
        tree: collection.tree.find((node) => containsExecution(node, execution.executionId)),
      });
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/remote-task-lifecycle',
    asyncRoute(async (request, response) => {
      const taskId = pathValue(request, 'taskId');
      const task = await options.operations.tasks.get(taskId);
      const evidence =
        options.operations.remoteTaskLifecycle === undefined
          ? []
          : await options.operations.remoteTaskLifecycle.listByAgentTaskId(taskId);
      response.json({
        warnings: [
          'Trusted-intranet V1 has no authentication; do not expose this management endpoint publicly.',
          'The MCP Provider is authoritative for remote Task status, substate, admission, business timers, and final result.',
          'A tasks/cancel acknowledgement or transport uncertainty does not prove Provider cancellation; observation continues until tasks/get is terminal.',
          'Side effects may already have occurred, and running local work is not automatically recovered after process failure.',
        ],
        actions: {
          refreshEvidence: {
            method: 'GET',
            path: `/api/v1/tasks/${encodeURIComponent(taskId)}/remote-task-lifecycle`,
          },
          provideInput: {
            method: 'POST',
            path: `/api/v1/tasks/${encodeURIComponent(taskId)}/actions`,
            action: 'provide_input',
          },
          cancelGoal: {
            method: 'POST',
            path: `/api/v1/tasks/${encodeURIComponent(taskId)}/actions`,
            action: 'cancel_goal',
          },
          forceReconciliation: {
            method: 'POST',
            pathTemplate: '/api/v1/remote-task-bindings/{bindingId}/refresh',
            concurrency: 'expectedVersion CAS',
          },
          reconnectNotifications: {
            status:
              options.operations.frozenMcpNotifications === undefined
                ? 'component_required'
                : 'available',
            ...(options.operations.frozenMcpNotifications === undefined
              ? {
                  warning:
                    'Notification reconnect is unavailable until a Frozen subscription component is composed; polling remains authoritative fallback.',
                }
              : {
                  note: 'Reconnect performs tasks/get reconciliation before admitting subscription Notifications; polling remains authoritative fallback.',
                }),
          },
        },
        correlationRoot: {
          taskId: task.taskId,
          contextId: task.contextId,
          ...(task.goalId === undefined ? {} : { goalId: task.goalId }),
          ...(task.goalVersion === undefined ? {} : { goalVersion: task.goalVersion }),
          ...(task.planId === undefined ? {} : { workflowPlanId: task.planId }),
          ...(task.selectedSkillId === undefined ? {} : { skillId: task.selectedSkillId }),
          ...(task.selectedSkillVersion === undefined
            ? {}
            : { skillVersion: task.selectedSkillVersion }),
        },
        items: await Promise.all(
          evidence.map(async (item) => {
            const tool = (await options.operations.mcp.listTools(item.binding.serverId)).find(
              (candidate) => candidate.toolName === item.binding.operationName,
            );
            const availabilityEvidence =
              options.operations.taskAvailability === undefined
                ? []
                : await options.operations.taskAvailability.listByPlan(
                    item.binding.workflowPlanId,
                    { limit: 1_000 },
                  );
            return {
              binding: sanitizeRemoteTaskBinding(item.binding),
              capability:
                tool === undefined
                  ? { status: 'not_found_in_current_registry' }
                  : {
                      status: 'registered',
                      protocolMode: 'frozen_v1',
                      taskExecution: tool.taskExecutionProfile ?? null,
                      executionSemantics: tool.executionSemantics,
                      discoveredAt: tool.discoveredAt,
                    },
              availability: availabilityEvidence.map(sanitizeTaskAvailabilityEvidence),
              observations: item.observations.map((observation) => ({
                ...observation,
                payload: sanitizeDisplayableValue(observation.payload),
              })),
              controls: item.controls.map((control) => ({
                ...control,
                payload: sanitizeDisplayableValue(control.payload),
              })),
              protocolAttempts: item.protocolAttempts,
              protocol: item.frozenProtocol ?? {
                pollHealth: item.binding.providerFailureCount === 0 ? 'healthy' : 'degraded',
                notificationHealth: 'not_observed',
                evidenceSummary: {
                  providerItems: item.binding.resultSnapshot?.evidence?.length ?? 0,
                  validatedRequirements: Object.values(
                    item.binding.resultSnapshot?.validatedEvidence ?? {},
                  ).filter((value) => value).length,
                  unsatisfiedRequirements: Object.values(
                    item.binding.resultSnapshot?.validatedEvidence ?? {},
                  ).filter((value) => !value).length,
                },
              },
              continuations: item.continuations,
              inputRounds: item.inputRounds.map((round) => ({
                ...round,
                link: {
                  ...round.link,
                  inputRequests: sanitizeDisplayableValue(round.link.inputRequests),
                },
                ...(round.responseContent === undefined
                  ? {}
                  : { responseContent: sanitizeDisplayableValue(round.responseContent) }),
              })),
              cancellations: item.cancellations.map((cancellation) => ({
                request: sanitizeCancellationRequest(cancellation.request),
                attempts: cancellation.attempts,
              })),
              finalOutcome: {
                providerStatus: item.binding.protocolStatus,
                authoritative: item.binding.terminalAt !== undefined,
                ...(item.binding.resultSnapshot === undefined
                  ? {}
                  : { result: sanitizeDisplayableValue(item.binding.resultSnapshot) }),
                ...(item.binding.errorSnapshot === undefined
                  ? {}
                  : { error: sanitizeDisplayableValue(item.binding.errorSnapshot) }),
                ...(item.binding.terminalAt === undefined
                  ? {}
                  : { terminalAt: item.binding.terminalAt }),
              },
            };
          }),
        ),
      });
    }),
  );
  app.post(
    '/api/v1/remote-task-bindings/:bindingId/refresh',
    asyncRoute(async (request, response) => {
      if (options.operations.remoteTaskPolling === undefined)
        throw new HttpInputError(
          'REMOTE_TASK_MANAGEMENT_ACTION_UNAVAILABLE',
          'Remote Task refresh is not composed in this runtime.',
        );
      const input = RefreshRemoteTaskSchema.parse(request.body);
      response.json({
        disposition: await options.operations.remoteTaskPolling.process({
          bindingId: pathValue(request, 'bindingId'),
          expectedVersion: input.expectedVersion,
        }),
      });
    }),
  );
  app.post(
    '/api/v1/remote-task-bindings/:bindingId/cancel',
    asyncRoute(async (request, response) => {
      if (options.operations.remoteTaskCancellation === undefined)
        throw new HttpInputError(
          'REMOTE_TASK_MANAGEMENT_ACTION_UNAVAILABLE',
          'Remote Task cancellation is not composed in this runtime.',
        );
      const input = CancelRemoteTaskSchema.parse(request.body);
      response.json(
        await options.operations.remoteTaskCancellation.request({
          bindingId: pathValue(request, 'bindingId'),
          idempotencyKey: input.idempotencyKey,
          source: 'management',
          reasonCode: input.reasonCode,
          summary: input.summary,
        }),
      );
    }),
  );
  app.post(
    '/api/v1/tasks/:taskId/actions',
    asyncRoute(async (request, response) => {
      const input = TaskActionSchema.parse(request.body);
      response.json(
        await options.operations.tasks.followUp({
          taskId: pathValue(request, 'taskId'),
          action: input.action,
          messageText: input.messageText,
          ...(input.inputRequestId === undefined ? {} : { inputRequestId: input.inputRequestId }),
          ...(input.inputContent === undefined ? {} : { inputContent: input.inputContent }),
        }),
      );
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/processed-results',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.resultProcessing.list(pathValue(request, 'taskId')),
      });
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/quality-report',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.taskQuality.getByTask(pathValue(request, 'taskId')));
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/implicit-feedback',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.implicitFeedback.listByTask(pathValue(request, 'taskId')),
      });
    }),
  );
  app.get(
    '/api/v1/task-quality-reports/:reportId/influence',
    asyncRoute(async (request, response) => {
      response.json(
        await options.operations.evaluationInfluences.getByReport(pathValue(request, 'reportId')),
      );
    }),
  );
  app.get(
    '/api/v1/evaluation/analytics',
    asyncRoute(async (request, response) => {
      const query = EvaluationAnalyticsFilterSchema.parse(request.query);
      response.json(
        await options.operations.evaluationAnalytics.summarize({
          ...(query.skillId === undefined ? {} : { skillId: query.skillId }),
          ...(query.skillVersion === undefined ? {} : { skillVersion: query.skillVersion }),
          ...(query.providerId === undefined ? {} : { providerId: query.providerId }),
          ...(query.model === undefined ? {} : { model: query.model }),
          ...(query.serverId === undefined ? {} : { serverId: query.serverId }),
          ...(query.toolName === undefined ? {} : { toolName: query.toolName }),
        }),
      );
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/input-inferences',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.goalInputInference.list(pathValue(request, 'taskId')),
      });
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/skill-input-resolutions',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.skillInputResolution.list(pathValue(request, 'taskId')),
      });
    }),
  );
  app.get(
    '/api/v1/skill-input-resolutions/:resolutionId',
    asyncRoute(async (request, response) => {
      const record = await options.operations.skillInputResolution.get(
        pathValue(request, 'resolutionId'),
      );
      if (record === undefined) {
        response.status(404).json({
          error: {
            code: 'SKILL_INPUT_RESOLUTION_NOT_FOUND',
            message: 'Skill input resolution was not found.',
          },
        });
        return;
      }
      response.json(record);
    }),
  );
  app.get(
    '/api/v1/processed-results/:resultId',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.resultProcessing.get(pathValue(request, 'resultId')));
    }),
  );
  app.put(
    '/api/v1/tasks/:taskId/plan',
    asyncRoute(async (request, response) => {
      const input = AttachTaskPlanSchema.parse(request.body);
      response.json(await options.operations.tasks.attachPlan(pathValue(request, 'taskId'), input));
    }),
  );
  app.post(
    '/api/v1/workflows/validate',
    asyncRoute(async (request, response) => {
      const result = await options.operations.workflows.validate(request.body);
      response.status(result.valid ? 200 : 422).json(result);
    }),
  );
  app.post(
    '/api/v1/workflows/plan',
    asyncRoute(async (request, response) => {
      const input = PlanWorkflowSchema.parse(request.body);
      response.status(201).json(
        await options.operations.workflows.plan({
          planId: input.planId,
          workflowDefinitionId: input.workflowDefinitionId,
          workflowVersion: input.workflowVersion,
          goalId: input.goalId,
          goalVersion: input.goalVersion,
          goalContract: input.goalContract,
          planningInstruction: input.planningInstruction,
          ...(input.compositionRoot === undefined
            ? {}
            : { compositionRoot: input.compositionRoot }),
          ...(input.sourceConfirmedPlanId === undefined
            ? {}
            : { sourceConfirmedPlanId: input.sourceConfirmedPlanId }),
        }),
      );
    }),
  );
  app.post(
    '/api/v1/workflows/plans/:planId/confirm',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.workflows.confirm(pathValue(request, 'planId')));
    }),
  );
  app.post(
    '/api/v1/workflows/plans/:planId/execute',
    asyncRoute(async (request, response) => {
      const input = ExecuteWorkflowSchema.parse(request.body);
      response.status(201).json(
        await options.operations.workflows.execute({
          instanceId: input.instanceId,
          planId: pathValue(request, 'planId'),
          input: input.input,
          ...(input.skillIds === undefined ? {} : { skillIds: input.skillIds }),
        }),
      );
    }),
  );
  app.post(
    '/api/v1/workflows/plans/:planId/pause',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.workflows.pauseForPlan(pathValue(request, 'planId')));
    }),
  );
  app.post(
    '/api/v1/workflows/plans/:planId/resume',
    asyncRoute(async (request, response) => {
      response.json(
        await options.operations.workflows.resumePauseForPlan(pathValue(request, 'planId')),
      );
    }),
  );
  app.post(
    '/api/v1/workflows/plans/:planId/cancel',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.workflows.cancelForPlan(pathValue(request, 'planId')));
    }),
  );
  app.post(
    '/api/v1/workflows/instances/:instanceId/human-confirmation',
    asyncRoute(async (request, response) => {
      const input = ResumeHumanConfirmationSchema.parse(request.body);
      response.json(
        await options.operations.workflows.resumeHumanConfirmation({
          instanceId: pathValue(request, 'instanceId'),
          confirmed: input.confirmed,
        }),
      );
    }),
  );
  app.get(
    '/api/v1/workflows/instances/:instanceId',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.workflows.trace(pathValue(request, 'instanceId')));
    }),
  );
  app.get(
    '/api/v1/workflows/plans/:planId/trace',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.workflows.traceForPlan(pathValue(request, 'planId')));
    }),
  );
  app.get(
    '/api/v1/workflows/plans/:planId/task-readiness',
    asyncRoute(async (request, response) => {
      const query = TaskReadinessQuerySchema.parse(request.query);
      const evidence =
        options.operations.taskAvailability === undefined
          ? []
          : await options.operations.taskAvailability.listByPlan(
              pathValue(request, 'planId'),
              query,
            );
      response.json({
        warning:
          'Availability is a time-bounded Provider forecast, not authoritative device state or a resource lock. Provider owns final admission and business timers.',
        items: evidence.map((item) => ({
          readiness: item.readiness,
          snapshots: item.snapshots.map((snapshot) => ({
            snapshotId: snapshot.snapshotId,
            nodeId: snapshot.nodeId,
            serverId: snapshot.serverId,
            operationName: snapshot.operationName,
            argumentsHash: snapshot.argumentsHash,
            ...(snapshot.arguments.unresolved
              ? { unresolvedPaths: snapshot.arguments.unresolvedPaths }
              : {}),
            ...(snapshot.timing === undefined ? {} : { timing: snapshot.timing }),
            availability: snapshot.result.availability,
            riskLevel: snapshot.result.riskLevel,
            ...(snapshot.result.reasonCode === undefined
              ? {}
              : { reasonCode: snapshot.result.reasonCode }),
            ...(snapshot.result.description === undefined
              ? {}
              : { description: snapshot.result.description }),
            ...(snapshot.result.validUntil === undefined
              ? {}
              : { validUntil: snapshot.result.validUntil }),
            ...(snapshot.result.earliestStartTime === undefined
              ? {}
              : { earliestStartTime: snapshot.result.earliestStartTime }),
            nextAvailableWindows: snapshot.result.nextAvailableWindows,
            ...(snapshot.result.estimatedDelayMs === undefined
              ? {}
              : { estimatedDelayMs: snapshot.result.estimatedDelayMs }),
            reservationMode: snapshot.result.reservationMode,
            ...(snapshot.result.reservationMode === 'guaranteed' &&
            snapshot.result.reservationRef !== undefined
              ? { reservationRef: snapshot.result.reservationRef }
              : {}),
            possibleEffects: snapshot.result.possibleEffects,
            sourceRevision: snapshot.sourceRevision,
            checkedAt: snapshot.checkedAt,
            normalizationReasonCodes: snapshot.normalizationReasonCodes,
          })),
        })),
      });
    }),
  );
  app.get(
    '/api/v1/workflows/plans/:planId',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.workflowRevisions.get(pathValue(request, 'planId')));
    }),
  );
  app.post(
    '/api/v1/workflows/plans/:planId/revisions',
    asyncRoute(async (request, response) => {
      const input = AdminWorkflowRevisionSchema.parse(request.body);
      response.status(201).json(
        await options.operations.workflowRevisions.reviseAdmin({
          sourcePlanId: pathValue(request, 'planId'),
          newPlanId: input.newPlanId,
          format: input.format,
          definition: input.definition,
        }),
      );
    }),
  );
  app.put(
    '/api/v1/models/providers/:providerId',
    asyncRoute(async (request, response) => {
      const input = ConfigureModelProviderSchema.parse({
        ...request.body,
        providerId: pathValue(request, 'providerId'),
      });
      const timestamp = new Date().toISOString();
      await options.operations.models.configureProvider(
        {
          providerId: input.providerId,
          name: input.name,
          kind: input.kind,
          apiStyle: input.apiStyle,
          baseUrl: input.baseUrl,
          model: input.model,
          enabled: input.enabled,
          timeoutMs: input.timeoutMs,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        input.credentialHeaders,
      );
      response.status(204).end();
    }),
  );
  app.get(
    '/api/v1/models/providers',
    asyncRoute(async (_request, response) => {
      response.json({ items: await options.operations.models.listProviders() });
    }),
  );
  app.put(
    '/api/v1/models/routes/:stage',
    asyncRoute(async (request, response) => {
      const stage = ModelStageSchema.parse(pathValue(request, 'stage'));
      const input = RouteModelStageSchema.parse(request.body);
      await options.operations.models.route(stage, input.providerId);
      response.status(204).end();
    }),
  );
  app.get(
    '/api/v1/models/routes',
    asyncRoute(async (_request, response) => {
      response.json({ items: await options.operations.models.listStageRoutes() });
    }),
  );
  app.get(
    '/api/v1/models/invocations',
    asyncRoute(async (request, response) => {
      const taskId =
        typeof request.query['taskId'] === 'string' ? request.query['taskId'] : undefined;
      const stage =
        request.query['stage'] === undefined
          ? undefined
          : ModelStageSchema.parse(request.query['stage']);
      response.json({
        items:
          taskId === undefined
            ? await options.operations.models.listInvocations(stage)
            : await options.operations.models.listInvocationsByTask(taskId),
      });
    }),
  );
  app.post(
    '/api/v1/prompts',
    asyncRoute(async (request, response) => {
      response
        .status(201)
        .json(await options.operations.prompts.create(CreatePromptSchema.parse(request.body)));
    }),
  );
  app.get(
    '/api/v1/prompts/:promptId/versions',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.prompts.listVersions(pathValue(request, 'promptId')),
      });
    }),
  );
  app.post(
    '/api/v1/prompts/:promptId/publish/:version',
    asyncRoute(async (request, response) => {
      response.json(
        await options.operations.prompts.publish(
          pathValue(request, 'promptId'),
          z.coerce.number().int().positive().parse(pathValue(request, 'version')),
        ),
      );
    }),
  );
  app.post(
    '/api/v1/prompts/:promptId/rollback/:version',
    asyncRoute(async (request, response) => {
      response.json(
        await options.operations.prompts.rollback(
          pathValue(request, 'promptId'),
          z.coerce.number().int().positive().parse(pathValue(request, 'version')),
        ),
      );
    }),
  );
  app.post(
    '/api/v1/prompts/:promptId/disable',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.prompts.disable(pathValue(request, 'promptId')));
    }),
  );
  app.get(
    '/api/v1/prompts/:promptId/effects/:version',
    asyncRoute(async (request, response) => {
      response.json(
        await options.operations.prompts.effect(
          pathValue(request, 'promptId'),
          z.coerce.number().int().positive().parse(pathValue(request, 'version')),
        ),
      );
    }),
  );
  app.get('/api/v1/mcp/servers', async (_request, response) => {
    if (options.operations.mcpProtocol === undefined) {
      response.json({ items: await options.operations.mcp.listServers() });
      return;
    }
    const providers = await options.operations.mcpProtocol.listProviders();
    response.json({
      items: providers.map((provider) => ({
        ...provider.server,
        ...(provider.currentDiscovery === undefined
          ? {}
          : {
              currentDiscovery: provider.currentDiscovery,
              supportedVersions: provider.currentDiscovery.supportedVersions,
              baselineHash: provider.currentDiscovery.baselineSha256,
              taskNotifications: provider.currentDiscovery.taskNotifications,
            }),
        taskBehavior: provider.tools.map((tool) => ({
          toolName: tool.toolName,
          ...(tool.taskBehavior === undefined ? {} : { taskBehavior: tool.taskBehavior }),
        })),
        outputSchemaHash: provider.tools.map((tool) => ({
          toolName: tool.toolName,
          ...(tool.outputSchemaHash === undefined
            ? {}
            : { outputSchemaHash: tool.outputSchemaHash }),
        })),
        notificationStatus: provider.notificationStatus,
        protocolWarnings: provider.warnings,
      })),
    });
  });
  app.get(
    '/api/v1/mcp/servers/:serverId/protocol',
    asyncRoute(async (request, response) => {
      if (options.operations.mcpProtocol === undefined)
        throw new HttpInputError(
          'MCP_PROTOCOL_OPERATIONS_UNAVAILABLE',
          'MCP protocol diagnosis is not composed in this runtime.',
        );
      response.json(await options.operations.mcpProtocol.diagnose(pathValue(request, 'serverId')));
    }),
  );
  app.post(
    '/api/v1/mcp/servers/:serverId/protocol-baseline-audit',
    asyncRoute(async (request, response) => {
      if (options.operations.mcpProtocol === undefined)
        throw new HttpInputError(
          'MCP_PROTOCOL_OPERATIONS_UNAVAILABLE',
          'MCP protocol baseline audit is not composed in this runtime.',
        );
      response.json(
        await options.operations.mcpProtocol.auditBaseline(pathValue(request, 'serverId')),
      );
    }),
  );
  app.get(
    '/api/v1/mcp/invocations',
    asyncRoute(async (request, response) => {
      const taskId = z.string().min(1).parse(request.query['taskId']);
      response.json({ items: await options.operations.mcp.listInvocationsByTask(taskId) });
    }),
  );
  app.post(
    '/api/v1/mcp/servers',
    asyncRoute(async (request, response) => {
      const input = RegisterMcpServerSchema.parse(request.body);
      if (options.operations.frozenMcp === undefined)
        throw new HttpInputError(
          'FROZEN_MCP_REGISTRY_UNAVAILABLE',
          'Frozen MCP registration is not composed in this runtime.',
        );
      response.status(201).json(await options.operations.frozenMcp.register(input));
    }),
  );
  app.post(
    '/api/v1/mcp/servers/:serverId/notifications/reconnect',
    asyncRoute(async (request, response) => {
      if (options.operations.frozenMcpNotifications === undefined)
        throw new HttpInputError(
          'FROZEN_MCP_NOTIFICATION_RUNTIME_UNAVAILABLE',
          'Frozen notification reconnect requires the local subscription component.',
        );
      response
        .status(202)
        .json(
          await options.operations.frozenMcpNotifications.reconnect(pathValue(request, 'serverId')),
        );
    }),
  );
  app.get(
    '/api/v1/mcp/servers/:serverId/tools',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.mcp.listTools(pathValue(request, 'serverId')),
      });
    }),
  );
  app.get(
    '/api/v1/mcp/servers/:serverId/invocations',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.mcp.listInvocations(pathValue(request, 'serverId')),
      });
    }),
  );
  app.get(
    '/api/v1/mcp/servers/:serverId/operations',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.mcp.listManagementOperations(
          pathValue(request, 'serverId'),
        ),
      });
    }),
  );
  app.get(
    '/api/v1/mcp/servers/:serverId/warnings',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.mcp.listDependencyWarnings(pathValue(request, 'serverId')),
      });
    }),
  );
  app.post(
    '/api/v1/mcp/servers/:serverId/refresh',
    asyncRoute(async (request, response) => {
      if (options.operations.frozenMcp === undefined)
        throw new HttpInputError(
          'FROZEN_MCP_REGISTRY_UNAVAILABLE',
          'Frozen MCP refresh is not composed in this runtime.',
        );
      response.json(await options.operations.frozenMcp.refresh(pathValue(request, 'serverId')));
    }),
  );
  app.put(
    '/api/v1/mcp/servers/:serverId/tools/:toolName/enhancement',
    asyncRoute(async (request, response) => {
      await options.operations.mcp.updateToolEnhancement(
        pathValue(request, 'serverId'),
        pathValue(request, 'toolName'),
        ToolEnhancementSchema.parse(request.body),
      );
      response.status(204).end();
    }),
  );
  app.put(
    '/api/v1/mcp/servers/:serverId/tools/:toolName/execution-semantics',
    asyncRoute(async (request, response) => {
      await options.operations.mcp.updateToolExecutionSemantics(
        pathValue(request, 'serverId'),
        pathValue(request, 'toolName'),
        ToolExecutionSemanticsValuesSchema.parse(request.body),
      );
      response.status(204).end();
    }),
  );
  app.delete(
    '/api/v1/mcp/servers/:serverId',
    asyncRoute(async (request, response) => {
      await options.operations.mcp.delete(pathValue(request, 'serverId'));
      response.status(204).end();
    }),
  );
  app.get(
    '/api/v1/experience/episodes',
    asyncRoute(async (request, response) => {
      if (options.operations.experience === undefined) {
        throw new HttpInputError('EXPERIENCE_UNAVAILABLE', 'Experience capture is not configured.');
      }
      const query = ExperienceListQuerySchema.parse(request.query);
      response.json({
        items: await options.operations.experience.listEpisodes(query.goalId, query.limit),
      });
    }),
  );
  app.get(
    '/api/v1/experience/dead-letters',
    asyncRoute(async (request, response) => {
      if (options.operations.experience === undefined) {
        throw new HttpInputError('EXPERIENCE_UNAVAILABLE', 'Experience capture is not configured.');
      }
      const query = ExperienceListQuerySchema.pick({ limit: true }).parse(request.query);
      response.json({ items: await options.operations.experience.listDeadLetters(query.limit) });
    }),
  );
  app.get(
    '/api/v1/experience/observations',
    asyncRoute(async (request, response) => {
      if (options.operations.experience === undefined) {
        throw new HttpInputError('EXPERIENCE_UNAVAILABLE', 'Experience capture is not configured.');
      }
      const query = ExperienceListQuerySchema.parse(request.query);
      response.json({
        items: await options.operations.experience.listObservations(query.goalId, query.limit),
      });
    }),
  );
  app.get(
    '/api/v1/experience/reflections',
    asyncRoute(async (request, response) => {
      if (options.operations.experience === undefined) {
        throw new HttpInputError('EXPERIENCE_UNAVAILABLE', 'Experience capture is not configured.');
      }
      const query = ExperienceListQuerySchema.pick({ limit: true }).parse(request.query);
      response.json({
        items: await options.operations.experience.listReflections(query.limit),
      });
    }),
  );
  app.get(
    '/api/v1/task-types',
    asyncRoute(async (request, response) => {
      if (options.operations.taskTypes === undefined) {
        throw new HttpInputError(
          'TASK_TYPES_UNAVAILABLE',
          'Task Type induction is not configured.',
        );
      }
      const query = ExperienceListQuerySchema.pick({ limit: true }).parse(request.query);
      response.json({ items: await options.operations.taskTypes.list(query.limit) });
    }),
  );
  app.get(
    '/api/v1/capability-patterns',
    asyncRoute(async (request, response) => {
      if (options.operations.capabilityPatterns === undefined) {
        throw new HttpInputError(
          'CAPABILITY_PATTERNS_UNAVAILABLE',
          'Capability Pattern induction is not configured.',
        );
      }
      const query = ExperienceListQuerySchema.pick({ limit: true }).parse(request.query);
      const [items, gaps] = await Promise.all([
        options.operations.capabilityPatterns.list(query.limit),
        options.operations.capabilityPatterns.listGaps(query.limit),
      ]);
      response.json({ items, gaps });
    }),
  );
  app.post(
    '/api/v1/experience/dead-letters/:deadLetterId/replay',
    asyncRoute(async (request, response) => {
      if (options.operations.experience === undefined) {
        throw new HttpInputError('EXPERIENCE_UNAVAILABLE', 'Experience capture is not configured.');
      }
      const input = ExperienceDeadLetterReplaySchema.parse(request.body);
      response.json(
        await options.operations.experience.replayDeadLetter(
          pathValue(request, 'deadLetterId'),
          input.actorId,
        ),
      );
    }),
  );
  app.get('/api/v1/skills', async (_request, response) => {
    response.json({ items: await options.operations.skills.listCurrentVersions() });
  });
  app.get(
    '/api/v1/capabilities/summary',
    asyncRoute(async (request, response) => {
      const query = CapabilitySummaryQuerySchema.parse(request.query);
      const budget =
        query.maxEntries === undefined && query.maxCharacters === undefined
          ? undefined
          : {
              maxEntries: query.maxEntries ?? 32,
              maxCharacters: query.maxCharacters ?? 12_000,
            };
      const view = await options.operations.capabilities.getSummary(budget);
      if (view === undefined) {
        throw new HttpInputError(
          'CAPABILITY_SUMMARY_NOT_AVAILABLE',
          'No active Capability Summary matches the current Skill catalog.',
        );
      }
      response.json(view);
    }),
  );
  app.post(
    '/api/v1/capabilities/rebuild',
    asyncRoute(async (_request, response) => {
      response.json(await options.operations.capabilities.rebuild());
    }),
  );
  app.get(
    '/api/v1/capabilities/card',
    asyncRoute(async (_request, response) => {
      const card = await options.operations.capabilityCards.findActive();
      if (card === undefined) {
        throw new HttpInputError(
          'CAPABILITY_CARD_NOT_AVAILABLE',
          'No active Public Capability Card is available.',
        );
      }
      response.json(card);
    }),
  );
  app.post(
    '/api/v1/capabilities/card/rebuild',
    asyncRoute(async (_request, response) => {
      response.json(await options.operations.capabilityCards.publish());
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/understanding',
    asyncRoute(async (request, response) => {
      const taskId = pathValue(request, 'taskId');
      const understanding = await options.operations.taskUnderstandings.findCurrent(taskId);
      if (understanding === undefined) {
        throw new HttpInputError(
          'TASK_UNDERSTANDING_NOT_FOUND',
          `No Task Understanding exists for Task ${taskId}.`,
        );
      }
      response.json(understanding);
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/understanding/revisions',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.taskUnderstandings.listRevisions(
          pathValue(request, 'taskId'),
        ),
      });
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/goal-session',
    asyncRoute(async (request, response) => {
      if (options.operations.goalSessions === undefined) {
        throw new HttpInputError(
          'INTERACTIVE_GOAL_SESSION_UNAVAILABLE',
          'Interactive Goal sessions are not configured.',
        );
      }
      const taskId = pathValue(request, 'taskId');
      const session = await options.operations.goalSessions.getByTask(taskId);
      if (session === undefined) {
        throw new HttpInputError(
          'INTERACTIVE_GOAL_SESSION_NOT_FOUND',
          `No interactive Goal session exists for Task ${taskId}.`,
        );
      }
      response.json(session);
    }),
  );
  app.post(
    '/api/v1/tasks/:taskId/goal-session/actions',
    asyncRoute(async (request, response) => {
      if (options.operations.goalSessions === undefined) {
        throw new HttpInputError(
          'INTERACTIVE_GOAL_SESSION_UNAVAILABLE',
          'Interactive Goal sessions are not configured.',
        );
      }
      const taskId = pathValue(request, 'taskId');
      const session = await options.operations.goalSessions.getByTask(taskId);
      if (session === undefined) {
        throw new HttpInputError(
          'INTERACTIVE_GOAL_SESSION_NOT_FOUND',
          `No interactive Goal session exists for Task ${taskId}.`,
        );
      }
      const input = InteractiveGoalActionSchema.parse(request.body);
      response.json(
        await options.operations.goalSessions.applyAction({
          sessionId: session.session.sessionId,
          ...input,
        }),
      );
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/planning-session',
    asyncRoute(async (request, response) => {
      if (options.operations.planningSessions === undefined) {
        throw new HttpInputError(
          'INTERACTIVE_PLANNING_SESSION_UNAVAILABLE',
          'Interactive planning sessions are not configured.',
        );
      }
      const taskId = pathValue(request, 'taskId');
      const session = await options.operations.planningSessions.getByTask(taskId);
      if (session === undefined) {
        throw new HttpInputError(
          'INTERACTIVE_PLANNING_SESSION_NOT_FOUND',
          `No interactive planning session exists for Task ${taskId}.`,
        );
      }
      response.json(session);
    }),
  );
  app.post(
    '/api/v1/tasks/:taskId/planning-session/actions',
    asyncRoute(async (request, response) => {
      if (options.operations.planningSessions === undefined) {
        throw new HttpInputError(
          'INTERACTIVE_PLANNING_SESSION_UNAVAILABLE',
          'Interactive planning sessions are not configured.',
        );
      }
      const taskId = pathValue(request, 'taskId');
      const session = await options.operations.planningSessions.getByTask(taskId);
      if (session === undefined) {
        throw new HttpInputError(
          'INTERACTIVE_PLANNING_SESSION_NOT_FOUND',
          `No interactive planning session exists for Task ${taskId}.`,
        );
      }
      const input = InteractivePlanningActionSchema.parse(request.body);
      response.json(
        await options.operations.planningSessions.applyAction({
          sessionId: session.session.sessionId,
          ...input,
        }),
      );
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/planning-interactions',
    asyncRoute(async (request, response) => {
      if (options.operations.planningInteractions === undefined) {
        throw new HttpInputError(
          'PLANNING_INTERACTIONS_UNAVAILABLE',
          'Planning interaction evidence is not configured.',
        );
      }
      response.json(
        await options.operations.planningInteractions.listTaskInteractions(
          pathValue(request, 'taskId'),
        ),
      );
    }),
  );
  app.delete(
    '/api/v1/users/:userId/planning-preferences',
    asyncRoute(async (request, response) => {
      if (options.operations.planningInteractions === undefined) {
        throw new HttpInputError(
          'PLANNING_INTERACTIONS_UNAVAILABLE',
          'Planning interaction evidence is not configured.',
        );
      }
      const input = PlanningPreferenceDeletionSchema.parse(request.body);
      response.json({
        deleted: await options.operations.planningInteractions.deleteUserScopedProjection(
          pathValue(request, 'userId'),
          input.actorId,
        ),
      });
    }),
  );
  app.get(
    '/api/v1/skills/catalog',
    asyncRoute(async (request, response) => {
      const query = SkillCatalogQuerySchema.parse(request.query);
      const visibility = {
        ...(query.userSelectable === undefined
          ? {}
          : { userSelectable: query.userSelectable === 'true' }),
        ...(query.composable === undefined ? {} : { composable: query.composable === 'true' }),
        ...(query.internalOnly === undefined
          ? {}
          : { internalOnly: query.internalOnly === 'true' }),
      };
      response.json({
        items: await options.operations.skills.listCatalog({
          ...(query.lifecycle === undefined ? {} : { lifecycle: query.lifecycle }),
          ...(query.mode === undefined ? {} : { mode: query.mode }),
          ...(query.domain === undefined ? {} : { domain: query.domain }),
          ...(query.tag === undefined ? {} : { tag: query.tag }),
          ...(Object.keys(visibility).length === 0 ? {} : { visibility }),
        }),
      });
    }),
  );
  app.post(
    '/api/v1/skill-packages/validate',
    asyncRoute(async (request, response) => {
      const candidate = await options.operations.skills.validatePackage(
        SkillPackageRootSchema.parse(request.body).packageRoot,
      );
      response.json({
        skillVersion: candidate.skillVersion,
        packageChecksum: candidate.packageChecksum,
        packageRoot: candidate.packageRoot,
        fileChecksums: candidate.fileChecksums,
        validatedAt: candidate.validatedAt,
      });
    }),
  );
  app.post(
    '/api/v1/skill-packages/import',
    asyncRoute(async (request, response) => {
      response
        .status(201)
        .json(
          await options.operations.skills.importPackageRoot(
            SkillPackageRootSchema.parse(request.body).packageRoot,
          ),
        );
    }),
  );
  app.get(
    '/api/v1/tasks/:taskId/temporary-skills',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.temporarySkills.listByTask(pathValue(request, 'taskId')),
      });
    }),
  );
  app.post(
    '/api/v1/tasks/:taskId/temporary-skills',
    asyncRoute(async (request, response) => {
      response.status(201).json(
        await options.operations.temporarySkills.create({
          taskId: pathValue(request, 'taskId'),
          ...CreateTemporarySkillSchema.parse(request.body),
        }),
      );
    }),
  );
  app.post(
    '/api/v1/temporary-skills/:temporarySkillId/complete',
    asyncRoute(async (request, response) => {
      const input = CompleteTemporarySkillSchema.parse(request.body);
      response.json(
        await options.operations.temporarySkills.complete(
          pathValue(request, 'temporarySkillId'),
          input.successful,
          input.outcomeSummary,
        ),
      );
    }),
  );
  app.get(
    '/api/v1/skill-formalization-candidates/:candidateId',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.skillEvolution.get(pathValue(request, 'candidateId')));
    }),
  );
  app.post(
    '/api/v1/skill-formalization-candidates/:candidateId/simulate',
    asyncRoute(async (request, response) => {
      response.json(
        await options.operations.skillEvolution.evaluateAndPublish(
          pathValue(request, 'candidateId'),
        ),
      );
    }),
  );
  app.post(
    '/api/v1/skill-formalization-candidates/:candidateId/corrections',
    asyncRoute(async (request, response) => {
      const input = CorrectEvolutionCandidateSchema.parse(request.body);
      response.json(
        await options.operations.skillEvolution.correctAndRevalidate(
          pathValue(request, 'candidateId'),
          {
            ...input,
            proposedSkill: {
              ...input.proposedSkill,
              usageSpecification: input.proposedSkill.usageSpecification as SkillUsageSpecification,
            },
          },
        ),
      );
    }),
  );
  app.get(
    '/api/v1/skill-formalization-candidates/:candidateId/corrections',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.skillEvolution.listCorrections(
          pathValue(request, 'candidateId'),
        ),
      });
    }),
  );
  app.get(
    '/api/v1/evolution-experiences/:experienceId',
    asyncRoute(async (request, response) => {
      const experience = await options.operations.evolutionExperiences.get(
        pathValue(request, 'experienceId'),
      );
      if (experience === undefined)
        throw new HttpInputError('EVOLUTION_EXPERIENCE_NOT_FOUND', 'Experience was not found.');
      response.json(experience);
    }),
  );
  app.get(
    '/api/v1/goals/:goalId/evolution-experiences',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.evolutionExperiences.listByGoal(
          pathValue(request, 'goalId'),
        ),
      });
    }),
  );
  app.get(
    '/api/v1/skills/:skillId/evolution-experiences',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.evolutionExperiences.listBySkill(
          pathValue(request, 'skillId'),
        ),
      });
    }),
  );
  app.get('/api/v1/skill-graph', async (_request, response) => {
    response.json({ items: await options.operations.graph.list() });
  });
  app.post(
    '/api/v1/skill-graph/relations',
    asyncRoute(async (request, response) => {
      response
        .status(201)
        .json(await options.operations.graph.create(SkillRelationSchema.parse(request.body)));
    }),
  );
  app.delete(
    '/api/v1/skill-graph/relations/:relationId',
    asyncRoute(async (request, response) => {
      await options.operations.graph.delete(pathValue(request, 'relationId'));
      response.status(204).end();
    }),
  );
  app.post(
    '/api/v1/skills',
    asyncRoute(async (request, response) => {
      const parsed = RegisterSkillSchema.parse(request.body);
      if (parsed.sourceKind === 'a2a_draft')
        throw new HttpInputError(
          'SKILL_A2A_DRAFT_MANAGEMENT_PUBLICATION_REQUIRED',
          'A2A Skill drafts must be published from their persisted draft.',
        );
      const input = skillRegistrationInput(parsed);
      response.status(201).json(await options.operations.skills.register(input));
    }),
  );
  app.post(
    '/api/v1/skills/author',
    asyncRoute(async (request, response) => {
      if (options.operations.skillAuthoring === undefined) {
        throw new HttpInputError(
          'SKILL_AUTHORING_MODEL_NOT_CONFIGURED',
          'A production Skill authoring ModelProvider is not configured.',
        );
      }
      const parsed = AuthorSkillSchema.parse(request.body);
      const { outcomeSpecification, usageSpecification, ...authoring } = parsed;
      response.status(201).json(
        await options.operations.skillAuthoring.authorAndRegister({
          ...authoring,
          runtimePolicy: compactRuntimePolicy(parsed.runtimePolicy),
          ...(outcomeSpecification === undefined ? {} : { outcomeSpecification }),
          ...(usageSpecification === undefined
            ? {}
            : { usageSpecification: usageSpecification as SkillUsageSpecification }),
        }),
      );
    }),
  );
  app.get(
    '/api/v1/skill-drafts/:draftId',
    asyncRoute(async (request, response) => {
      if (options.operations.skillAuthoring === undefined)
        throw new HttpInputError('SKILL_AUTHORING_UNAVAILABLE', 'Skill authoring is unavailable.');
      const draft = await options.operations.skillAuthoring.getDraft(pathValue(request, 'draftId'));
      if (draft === undefined)
        throw new HttpInputError('SKILL_DRAFT_NOT_FOUND', 'Skill draft was not found.');
      response.json(draft);
    }),
  );
  app.post(
    '/api/v1/skill-drafts/:draftId/publish',
    asyncRoute(async (request, response) => {
      if (options.operations.skillAuthoring === undefined)
        throw new HttpInputError('SKILL_AUTHORING_UNAVAILABLE', 'Skill authoring is unavailable.');
      const input = PublishSkillDraftSchema.parse(request.body);
      const { outcomeSpecification, usageSpecification, ...publication } = input;
      response.json(
        await options.operations.skillAuthoring.publishDraft(pathValue(request, 'draftId'), {
          ...publication,
          runtimePolicy: compactRuntimePolicy(input.runtimePolicy),
          ...(outcomeSpecification === undefined ? {} : { outcomeSpecification }),
          ...(usageSpecification === undefined
            ? {}
            : { usageSpecification: usageSpecification as SkillUsageSpecification }),
        }),
      );
    }),
  );
  app.post(
    '/api/v1/skill-selections',
    asyncRoute(async (request, response) => {
      if (options.operations.skillSelection === undefined) {
        throw new HttpInputError(
          'SKILL_SELECTION_MODEL_NOT_CONFIGURED',
          'Embedding and selection model providers are not configured.',
        );
      }
      const input = SelectSkillSchema.parse(request.body);
      response.status(201).json(await options.operations.skillSelection.select(input.goalContract));
    }),
  );
  app.post(
    '/api/v1/skills/:skillId/quality-observations',
    asyncRoute(async (request, response) => {
      const input = SkillQualityObservationSchema.parse(request.body);
      response.status(201).json(
        await options.operations.skillQuality.record({
          skillId: pathValue(request, 'skillId'),
          ...input,
        }),
      );
    }),
  );
  app.get(
    '/api/v1/skill-quality-warnings',
    asyncRoute(async (request, response) => {
      const skillId =
        typeof request.query['skillId'] === 'string' ? request.query['skillId'] : undefined;
      response.json({ items: await options.operations.skillQuality.listWarnings(skillId) });
    }),
  );
  app.get(
    '/api/v1/workflow-templates',
    asyncRoute(async (_request, response) => {
      response.json({ items: await options.operations.workflowTemplates.listTemplates() });
    }),
  );
  app.get(
    '/api/v1/workflow-templates/:templateId/uses',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.workflowTemplates.listUses(
          pathValue(request, 'templateId'),
        ),
      });
    }),
  );
  app.post(
    '/api/v1/skills/:skillId/enable',
    asyncRoute(async (request, response) => {
      response.json(
        await options.operations.skills.setEnabled(pathValue(request, 'skillId'), true),
      );
    }),
  );
  app.post(
    '/api/v1/skills/:skillId/disable',
    asyncRoute(async (request, response) => {
      response.json(
        await options.operations.skills.setEnabled(pathValue(request, 'skillId'), false),
      );
    }),
  );
  app.get(
    '/api/v1/skills/:skillId/versions',
    asyncRoute(async (request, response) => {
      response.json({
        items: await options.operations.skills.listVersions(pathValue(request, 'skillId')),
      });
    }),
  );
  app.get(
    '/api/v1/skills/:skillId/versions/:version',
    asyncRoute(async (request, response) => {
      response.json(
        await options.operations.skills.readExactVersion(
          pathValue(request, 'skillId'),
          z.coerce.number().int().positive().parse(pathValue(request, 'version')),
        ),
      );
    }),
  );
  app.get(
    '/api/v1/skills/:skillId/diff',
    asyncRoute(async (request, response) => {
      const query = z
        .object({
          from: z.coerce.number().int().positive(),
          to: z.coerce.number().int().positive(),
        })
        .parse(request.query);
      response.json(
        await options.operations.skills.diff(pathValue(request, 'skillId'), query.from, query.to),
      );
    }),
  );
  app.post(
    '/api/v1/skills/:skillId/rollback/:version',
    asyncRoute(async (request, response) => {
      const version = z.coerce.number().int().positive().parse(pathValue(request, 'version'));
      response.json(
        await options.operations.skills.rollback(pathValue(request, 'skillId'), version),
      );
    }),
  );
  if (options.consoleDirectory !== undefined) {
    const consoleDirectory = path.resolve(options.consoleDirectory);
    app.use('/console', express.static(consoleDirectory, { index: 'index.html' }));
    app.get('/console/{*path}', (_request, response) => {
      response.sendFile(path.join(consoleDirectory, 'index.html'));
    });
  }
  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    void next;
    const normalized = normalizeHttpError(error);
    response.status(normalized.status).json({ error: normalized.body });
  });

  const server = createServer(app);
  const host = options.host ?? '127.0.0.1';
  server.listen(options.port ?? 0, host);
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('MANAGEMENT_ENDPOINT_ADDRESS_UNAVAILABLE');
  }
  return {
    baseUrl: `http://${host}:${String(address.port)}`,
    close: () => closeServer(server),
  };
}

type TaskAvailabilityEvidence = Awaited<
  ReturnType<TaskAvailabilityEvidenceRepository['listByPlan']>
>[number];

type LifecycleBinding = RemoteTaskLifecycleEvidence['binding'];
type LifecycleCancellation = RemoteTaskLifecycleEvidence['cancellations'][number]['request'];

function sanitizeRemoteTaskBinding(binding: LifecycleBinding) {
  return {
    bindingId: binding.bindingId,
    serverId: binding.serverId,
    operationName: binding.operationName,
    remoteTaskId: binding.remoteTaskId,
    agentTaskId: binding.agentTaskId,
    contextId: binding.contextId,
    goalId: binding.goalId,
    goalVersion: binding.goalVersion,
    workflowPlanId: binding.workflowPlanId,
    workflowDefinitionId: binding.workflowDefinitionId,
    workflowDefinitionVersion: binding.workflowDefinitionVersion,
    workflowInstanceId: binding.workflowInstanceId,
    workflowNodeId: binding.workflowNodeId,
    workflowNodeRunId: binding.workflowNodeRunId,
    ...(binding.parentWorkflowInstanceId === undefined
      ? {}
      : { parentWorkflowInstanceId: binding.parentWorkflowInstanceId }),
    ...(binding.parentSkillCallId === undefined
      ? {}
      : { parentSkillCallId: binding.parentSkillCallId }),
    mcpInvocationId: binding.mcpInvocationId,
    protocolStatus: binding.protocolStatus,
    protocolContract: binding.protocolContract,
    ...(binding.taskBehavior === undefined ? {} : { taskBehavior: binding.taskBehavior }),
    ...(binding.runtimeRevision === undefined ? {} : { runtimeRevision: binding.runtimeRevision }),
    ...(binding.providerRevision === undefined
      ? {}
      : { providerRevision: binding.providerRevision }),
    ...(binding.taskTtlMs === undefined ? {} : { taskTtlMs: binding.taskTtlMs }),
    ...(binding.taskExpiresAt === undefined ? {} : { taskExpiresAt: binding.taskExpiresAt }),
    ...(binding.providerSubstate === undefined
      ? {}
      : { providerSubstate: binding.providerSubstate }),
    ...(binding.remoteRevision === undefined ? {} : { remoteRevision: binding.remoteRevision }),
    localState: binding.localState,
    ...(binding.requestedTiming === undefined ? {} : { requestedTiming: binding.requestedTiming }),
    executionMode: binding.executionContext.mode,
    lastProviderUpdatedAt: binding.lastProviderUpdatedAt,
    pollIntervalMs: binding.pollIntervalMs,
    ...(binding.nextPollAt === undefined ? {} : { nextPollAt: binding.nextPollAt }),
    pollAttempt: binding.pollAttempt,
    providerFailureCount: binding.providerFailureCount,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
    ...(binding.invalidatedAt === undefined ? {} : { invalidatedAt: binding.invalidatedAt }),
    ...(binding.terminalAt === undefined ? {} : { terminalAt: binding.terminalAt }),
    version: binding.version,
  };
}

function sanitizeCancellationRequest(request: LifecycleCancellation) {
  return {
    requestId: request.requestId,
    bindingId: request.bindingId,
    idempotencyKey: request.idempotencyKey,
    source: request.source,
    reasonCode: request.reasonCode,
    summary: request.summary,
    deliveryStatus: request.deliveryStatus,
    ...(request.providerTerminalStatus === undefined
      ? {}
      : { providerTerminalStatus: request.providerTerminalStatus }),
    ...(request.protocolRevision === undefined
      ? {}
      : { protocolRevision: request.protocolRevision }),
    ...(request.acknowledgedAt === undefined ? {} : { acknowledgedAt: request.acknowledgedAt }),
    ...(request.resolvedAt === undefined ? {} : { resolvedAt: request.resolvedAt }),
    attemptCount: request.attemptCount,
    ...(request.lastSafeErrorCode === undefined
      ? {}
      : { lastSafeErrorCode: request.lastSafeErrorCode }),
    requestedAt: request.requestedAt,
    updatedAt: request.updatedAt,
    version: request.version,
  };
}

const SENSITIVE_DISPLAY_KEYS = new Set([
  'authorization',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'cookie',
  'setcookie',
  'credential',
  'credentialheaders',
  'password',
  'secret',
  'stack',
  'chainofthought',
  'privatereasoning',
  'reasoningcontent',
  'pollclaimtoken',
  'claimtoken',
]);

function sanitizeDisplayableValue(value: unknown, depth = 0): unknown {
  if (depth > 32) return '[redacted:depth-limit]';
  if (Array.isArray(value))
    return value.map((candidate) => sanitizeDisplayableValue(candidate, depth + 1));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, candidate]) => [
      key,
      SENSITIVE_DISPLAY_KEYS.has(key.toLowerCase().replaceAll(/[^a-z0-9]/g, ''))
        ? '[redacted]'
        : sanitizeDisplayableValue(candidate, depth + 1),
    ]),
  );
}

function boundedQueryLimit(request: Request, defaultValue: number): number {
  return z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(defaultValue)
    .parse(request.query['limit']);
}

function sanitizeTaskAvailabilityEvidence(item: TaskAvailabilityEvidence) {
  return {
    readiness: item.readiness,
    snapshots: item.snapshots.map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      nodeId: snapshot.nodeId,
      serverId: snapshot.serverId,
      operationName: snapshot.operationName,
      argumentsHash: snapshot.argumentsHash,
      ...(snapshot.arguments.unresolved
        ? { unresolvedPaths: snapshot.arguments.unresolvedPaths }
        : {}),
      ...(snapshot.timing === undefined ? {} : { timing: snapshot.timing }),
      availability: snapshot.result.availability,
      riskLevel: snapshot.result.riskLevel,
      ...(snapshot.result.reasonCode === undefined
        ? {}
        : { reasonCode: snapshot.result.reasonCode }),
      ...(snapshot.result.description === undefined
        ? {}
        : { description: snapshot.result.description }),
      ...(snapshot.result.validUntil === undefined
        ? {}
        : { validUntil: snapshot.result.validUntil }),
      ...(snapshot.result.earliestStartTime === undefined
        ? {}
        : { earliestStartTime: snapshot.result.earliestStartTime }),
      nextAvailableWindows: snapshot.result.nextAvailableWindows,
      ...(snapshot.result.estimatedDelayMs === undefined
        ? {}
        : { estimatedDelayMs: snapshot.result.estimatedDelayMs }),
      reservationMode: snapshot.result.reservationMode,
      ...(snapshot.result.reservationMode === 'guaranteed' &&
      snapshot.result.reservationRef !== undefined
        ? { reservationRef: snapshot.result.reservationRef }
        : {}),
      possibleEffects: snapshot.result.possibleEffects,
      sourceRevision: snapshot.sourceRevision,
      checkedAt: snapshot.checkedAt,
      normalizationReasonCodes: snapshot.normalizationReasonCodes,
    })),
  };
}

function skillRegistrationInput(
  parsed: z.infer<typeof RegisterSkillSchema>,
): RegisterSkillVersionInput {
  const policy = parsed.runtimePolicy;
  const { usageSpecification, outcomeSpecification, ...definition } = parsed;
  return {
    ...definition,
    runtimePolicy: compactRuntimePolicy(policy),
    ...(usageSpecification === undefined
      ? {}
      : { usageSpecification: usageSpecification as SkillUsageSpecification }),
    ...(outcomeSpecification === undefined ? {} : { outcomeSpecification: outcomeSpecification }),
  };
}

function compactRuntimePolicy(policy: z.infer<typeof RegisterSkillSchema>['runtimePolicy']) {
  return {
    autoConfirmPlan: policy.autoConfirmPlan,
    ...(policy.maxReplans === undefined ? {} : { maxReplans: policy.maxReplans }),
    ...(policy.maxDurationSeconds === undefined
      ? {}
      : { maxDurationSeconds: policy.maxDurationSeconds }),
    ...(policy.maxLlmCalls === undefined ? {} : { maxLlmCalls: policy.maxLlmCalls }),
    ...(policy.maxMcpCalls === undefined ? {} : { maxMcpCalls: policy.maxMcpCalls }),
    ...(policy.maxCost === undefined ? {} : { maxCost: policy.maxCost }),
    ...(policy.pauseReplanThresholdSeconds === undefined
      ? {}
      : { pauseReplanThresholdSeconds: policy.pauseReplanThresholdSeconds }),
    ...(policy.cancelStrategy === undefined ? {} : { cancelStrategy: policy.cancelStrategy }),
    ...(policy.compensationGuidance === undefined
      ? {}
      : { compensationGuidance: policy.compensationGuidance }),
  };
}

function presentSkillExecution(execution: SkillExecutionView) {
  const taskProviderReferences = execution.references.filter((reference) =>
    ['provider', 'resource', 'remote_task_binding'].includes(reference.kind),
  );
  const evidenceReferences = execution.references.filter(
    (reference) => reference.kind === 'evidence' || reference.kind === 'outcome',
  );
  const hardGates = execution.references.filter((reference) => reference.kind === 'hard_gate');
  const degraded = [...execution.events]
    .reverse()
    .find((event) => event.eventType === 'skill.execution_degraded');
  return {
    ...execution,
    taskProviderReferences,
    evidenceReferences,
    hardGates,
    ...(degraded === undefined
      ? {}
      : { degradedReason: { summary: degraded.summary, details: degraded.details } }),
  };
}

interface SkillExecutionTreeNode {
  readonly item: ReturnType<typeof presentSkillExecution>;
  readonly children: readonly SkillExecutionTreeNode[];
}

function skillExecutionCollection(items: readonly SkillExecutionView[]) {
  const children = new Map<string, SkillExecutionView[]>();
  for (const item of items) {
    if (item.parentExecutionId === undefined) continue;
    const existing = children.get(item.parentExecutionId) ?? [];
    existing.push(item);
    children.set(item.parentExecutionId, existing);
  }
  const node = (item: SkillExecutionView): SkillExecutionTreeNode => ({
    item: presentSkillExecution(item),
    children: (children.get(item.executionId) ?? []).map(node),
  });
  const ids = new Set(items.map((item) => item.executionId));
  return {
    warnings: [
      'Skill execution status is an evidence projection; Task and Workflow remain authoritative.',
      'Evidence references are thin links and do not embed credentials or private model reasoning.',
      'Trusted-intranet V1 has no authentication; do not expose this endpoint publicly.',
    ],
    items: items.map(presentSkillExecution),
    tree: items
      .filter((item) => item.parentExecutionId === undefined || !ids.has(item.parentExecutionId))
      .map(node),
  };
}

function containsExecution(node: SkillExecutionTreeNode, executionId: string): boolean {
  return (
    node.item.executionId === executionId ||
    node.children.some((child) => containsExecution(child, executionId))
  );
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => void handler(request, response).catch(next);
}

function pathValue(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== 'string' || value.trim() === '')
    throw new HttpInputError('PATH_PARAMETER_INVALID');
  return value;
}

function normalizeHttpError(error: unknown): Readonly<{
  status: number;
  body: Readonly<{ code: string; message: string; details?: unknown }>;
}> {
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'Request validation failed.',
        details: error.issues,
      },
    };
  }
  const code = errorCode(error);
  if (code === undefined) {
    return {
      status: 500,
      body: { code: 'MANAGEMENT_INTERNAL_ERROR', message: 'Management operation failed.' },
    };
  }
  const message = error instanceof Error ? error.message : 'Unexpected management API error.';
  if (code.endsWith('_NOT_FOUND')) return { status: 404, body: { code, message } };
  if (code.endsWith('_ALREADY_EXISTS')) return { status: 409, body: { code, message } };
  return { status: 400, body: { code, message } };
}

function errorCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error.code;
  return error instanceof HttpInputError ? error.code : undefined;
}

class HttpInputError extends Error {
  readonly code: string;
  constructor(code: string, message = 'A required path parameter is invalid.') {
    super(message);
    this.code = code;
  }
}

async function closeServer(server: HttpServer): Promise<void> {
  if (!server.listening) return;
  server.close();
  server.closeAllConnections();
  await once(server, 'close');
}
