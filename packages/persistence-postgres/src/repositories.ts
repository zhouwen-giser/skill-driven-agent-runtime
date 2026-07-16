import type {
  AgentTaskRepository,
  TaskWaitPolicyRepository,
  ConversationContextRepository,
  ExternalTaskProjection,
  ExternalTaskProjectionQuery,
  ExternalTaskProjectionRepository,
  McpRegistryRepository,
  McpToolCatalog,
  McpTaskOperationCatalog,
  McpServerRecord,
  ModelProviderRecord,
  ModelRuntimeRepository,
  PromptRepository,
  WorkflowPlanRepository,
  WorkflowTemplateRepository,
  WorkflowExecutionRepository,
  WorkflowControlRepository,
  GoalRepository,
  ImplicitFeedbackRepository,
  GoalPatchRepository,
  GoalCancellationRepository,
  ProcessedResultRepository,
  TaskQualityReportRepository,
  EvaluationInfluenceRepository,
  EvaluationAnalyticsRepository,
  MemoryRepository,
  MemoryRetentionPolicyRepository,
  GoalInputInferenceRepository,
  RuntimeEventPublisher,
  RuntimeRecoveryRepository,
  RuntimeTerminalOutcomeRepository,
  RuntimeTaskEvent,
  SkillDraftRepository,
  SkillGraphRepository,
  SkillEmbeddingRepository,
  SkillSelectionRepository,
  SkillInputResolutionRepository,
  SkillQualityRepository,
  TemporarySkillRepository,
  SkillRepository,
  SkillCallWorkflowRepository,
  EvolutionExperienceRepository,
  EvolutionPolicyRepository,
  TaskInputRepository,
} from '../../application/src/index.js';
import {
  createMemoryItem,
  createMcpTool,
  createMcpToolExecutionSemantics,
  DomainError,
  MAX_SKILL_COMPOSITION_RELATED_SKILLS,
  MAX_SKILL_COMPOSITION_RELATIONS,
  snapshotSkillCompositionContext,
  snapshotWorkflowToolExecutionSemantics,
  type TaskExecutionAttempt,
  type TaskInputRequest,
  type TaskInputResponse,
} from '../../domain/src/index.js';
import type {
  AgentTask,
  ConversationContext,
  McpDependencyWarning,
  McpInvocation,
  McpManagementOperation,
  McpServer,
  McpTool,
  McpToolDependencyChange,
  McpToolEnhancement,
  McpTaskOperationSemantics,
  ModelInvocationRecord,
  ModelProviderConfiguration,
  StageModelRoute,
  ModelStage,
  PromptEffectSummary,
  PromptVersion,
  WorkflowDefinition,
  WorkflowTemplate,
  WorkflowTemplateOccurrence,
  WorkflowTemplateUse,
  WorkflowPlanAttempt,
  WorkflowPlanRecord,
  WorkflowInstance,
  WorkflowNodeEvent,
  WorkflowControlRecord,
  WorkflowControlRound,
  Goal,
  GoalExecutionContract,
  GoalPatchRecord,
  GoalCancellationRecord,
  ProcessedResultRecord,
  RuntimeAchievedOutcomeInput,
  RuntimeCanceledOutcomeInput,
  RuntimeEnhancementWarning,
  RuntimeTerminalControlStatus,
  RuntimeTerminalOutcomeKind,
  RuntimeTerminalOutcomeRecord,
  RuntimeUnachievableOutcomeInput,
  TaskQualityReport,
  EvaluationInfluenceRecord,
  EvaluationAnalyticsFilter,
  EvaluationAnalyticsSample,
  MemoryItem,
  MemorySearchHit,
  MemoryStatusTransition,
  MemoryRetentionPolicy,
  GoalInferenceSource,
  GoalInputInferenceRecord,
  GoalTransitionRecord,
  ImplicitFeedbackRecord,
  Skill,
  SkillCompositionContext,
  SkillRelation,
  SkillPerformanceMetrics,
  SkillQualityObservation,
  SkillQualityWarning,
  SkillReplacementPlan,
  SkillSelectionRecord,
  SkillInputResolutionRecord,
  SkillFormalizationCandidate,
  SkillEvolutionCorrectionExperience,
  SkillInductionReport,
  SkillSimulationReport,
  ProposedEvolutionSkill,
  TemporarySkill,
  TemporarySkillExperience,
  ToolReference,
  SkillDraft,
  SkillRuntimePolicy,
  SkillVersion,
  SkillCallWorkflowRecord,
  EvolutionExperience,
  EvolutionPolicy,
  EvolutionTriggerRecord,
  TaskPhase,
  TaskWaitPolicy,
} from '../../domain/src/index.js';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

type TaskStateCommitted = (task: AgentTask) => void;

const ToolReferenceSchema = z.object({ serverId: z.string(), toolName: z.string() });
const ToolReferencesSchema = z.array(ToolReferenceSchema);
const SkillInductionReportSchema = z.object({
  consistent: z.boolean(),
  stable: z.boolean(),
  generalizable: z.boolean(),
  duplicateSkillId: z.string().optional(),
  duplicateScore: z.number(),
  evolutionKind: z.enum(['new_skill', 'new_version']),
  targetSkillId: z.string(),
  boundaryDecisionSummary: z.string(),
  decisionSummary: z.string(),
});
const ProposedEvolutionSkillSchema: z.ZodType<ProposedEvolutionSkill> = z.object({
  skillId: z.string(),
  name: z.string(),
  summary: z.string(),
  description: z.string(),
  capabilities: z.array(z.string()),
  workflowGuidance: z.string(),
  outputInstruction: z.string(),
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  tools: ToolReferencesSchema,
});
const SkillSimulationReportSchema: z.ZodType<SkillSimulationReport> = z.object({
  allPassed: z.boolean(),
  cases: z.array(
    z.object({
      caseId: z.string(),
      kind: z.enum([
        'static_validation',
        'source_experience',
        'historical_replay',
        'normal',
        'boundary',
        'exception',
      ]),
      input: z.record(z.string(), z.unknown()),
      expectedOutcome: z.enum(['success', 'failure']),
      passed: z.boolean(),
      summary: z.string(),
    }),
  ),
  decisionSummary: z.string(),
});
const EvolutionGoalSchema = z.object({
  goalId: z.string(),
  version: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  constraints: z.array(z.string()),
  successCriteria: z.array(z.string()),
});
const GoalExecutionContractSchema: z.ZodType<GoalExecutionContract> = z
  .object({
    goalId: z.string().min(1),
    version: z.number().int().positive(),
    title: z.string(),
    description: z.string(),
    constraints: z.array(z.string()),
    successCriteria: z.array(z.string()),
  })
  .strict();
const CapabilitiesSchema = z.array(z.string());
const ToolPolicySchema = z.object({
  required: z.array(ToolReferenceSchema),
  optional: z.array(ToolReferenceSchema),
  forbidden: z.array(ToolReferenceSchema),
});
const RuntimePolicySchema = z.object({
  autoConfirmPlan: z.boolean().default(false),
  maxReplans: z.number().int().optional(),
  maxDurationSeconds: z.number().int().optional(),
  maxLlmCalls: z.number().int().optional(),
  maxMcpCalls: z.number().int().optional(),
  maxCost: z.number().optional(),
  pauseReplanThresholdSeconds: z.number().int().optional(),
  cancelStrategy: z.enum(['wait_current', 'try_interrupt', 'cleanup_workflow']).optional(),
  compensationGuidance: z.string().optional(),
});
const SkillVersionSnapshotSchema = z
  .object({
    skillId: z.string(),
    version: z.number().int().positive(),
    name: z.string(),
    summary: z.string(),
    description: z.string(),
    capabilities: z.array(z.string()),
    workflowGuidance: z.string(),
    outputInstruction: z.string(),
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    toolPolicy: ToolPolicySchema,
    runtimePolicy: RuntimePolicySchema,
    createdAt: z.string(),
  })
  .strict();
const SkillRelationSchema = z
  .object({
    relationId: z.string(),
    sourceSkillId: z.string(),
    targetSkillId: z.string(),
    relationType: z.enum([
      'parent_child',
      'depends_on',
      'input_output_match',
      'alternative',
      'composition',
      'capability_coverage',
    ]),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .strict();
const SkillCompositionContextSchema = z
  .object({
    selectedSkill: SkillVersionSnapshotSchema,
    relatedSkills: z.array(SkillVersionSnapshotSchema).max(MAX_SKILL_COMPOSITION_RELATED_SKILLS),
    relations: z.array(SkillRelationSchema).max(MAX_SKILL_COMPOSITION_RELATIONS),
    allowedChildSkillIds: z.array(z.string()).max(MAX_SKILL_COMPOSITION_RELATED_SKILLS),
    decisionSummary: z.string(),
  })
  .strict();
const StringArraySchema = z.array(z.string());
const McpEnhancementSchema = z.object({
  purpose: z.string(),
  scenarios: StringArraySchema,
  constraints: StringArraySchema,
  returnDescription: z.string(),
  commonErrors: StringArraySchema,
  tags: StringArraySchema,
});
const McpExecutionSemanticsSchema = z
  .object({
    effect: z.enum(['read_only', 'side_effecting', 'unknown']),
    execution: z.enum(['synchronous', 'task_capable', 'task_required', 'unknown']),
    cancellation: z.enum(['unsupported', 'cooperative', 'task_cancel', 'unknown']),
    idempotency: z.enum(['none', 'client_request_key', 'server_managed', 'unknown']),
    replay: z.enum(['allowed', 'simulation_only', 'forbidden', 'unknown']),
    source: z.enum(['mcp_declared', 'admin_override', 'default_unknown']),
  })
  .strict();
const WorkflowToolExecutionSemanticsSchema = z.array(
  z
    .object({
      reference: z.object({ serverId: z.string().min(1), toolName: z.string().min(1) }).strict(),
      executionSemantics: McpExecutionSemanticsSchema,
    })
    .strict(),
);
const McpTaskOperationSemanticsSchema: z.ZodType<McpTaskOperationSemantics> = z
  .object({
    execution: z.enum(['synchronous', 'task_capable', 'task_required', 'unknown']),
    availability: z.enum(['not_supported', 'dynamic']),
    supportsScheduling: z.boolean(),
    supportsMaxElapsed: z.boolean(),
    supportsObservations: z.boolean(),
    cancellation: z.enum(['unsupported', 'cooperative', 'task_cancel', 'unknown']),
    revision: z.literal('1.0'),
  })
  .strict();
const SkillMetricsSchema = z.object({
  sampleCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  averageDurationMs: z.number().nonnegative(),
  averageCost: z.number().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  stabilityScore: z.number().min(0).max(1),
});
const SkillCandidateSchema = z.object({
  skillId: z.string(),
  skillVersion: z.number().int().positive(),
  name: z.string(),
  summary: z.string(),
  capabilities: z.array(z.string()),
  inputSchemaSummary: z.object({
    type: z.string(),
    requiredFields: z.array(z.string()),
    propertyNames: z.array(z.string()),
    allowsAdditionalProperties: z.union([z.boolean(), z.literal('unspecified')]),
  }),
  outputSchemaSummary: z.object({
    type: z.string(),
    requiredFields: z.array(z.string()),
    propertyNames: z.array(z.string()),
    allowsAdditionalProperties: z.union([z.boolean(), z.literal('unspecified')]),
  }),
  toolPolicy: ToolPolicySchema,
  workflowGuidanceSummary: z.string(),
  runtimePolicy: RuntimePolicySchema,
  activeMcpDependencyWarnings: z.array(
    z.object({
      warningId: z.string(),
      serverId: z.string(),
      toolName: z.string(),
      reason: z.enum(['removed', 'schema_changed']),
      toolRevision: z.number().int().positive(),
      createdAt: z.string(),
    }),
  ),
  autoConfirmPlan: z.boolean(),
  createdAt: z.string(),
  semanticScore: z.number().min(0).max(1),
  metrics: SkillMetricsSchema,
});

interface ContextRow extends QueryResultRow {
  context_id: string;
  user_id: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface GoalRow extends QueryResultRow {
  goal_id: string;
  context_id: string;
  version: number;
  title: string;
  description: string;
  constraints_json: unknown;
  success_criteria_json: unknown;
  status: Goal['status'];
  previous_goal_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TaskRow extends QueryResultRow {
  task_id: string;
  context_id: string;
  user_id: string;
  request_text: string;
  request_metadata: Record<string, unknown>;
  phase: TaskPhase;
  phase_message: string;
  goal_id: string | null;
  goal_version: number | null;
  plan_id: string | null;
  selected_skill_id: string | null;
  selected_skill_version: number | null;
  skill_selection_id: string | null;
  skill_input_resolution_id: string | null;
  temporary_skill_id: string | null;
  output_text: string | null;
  output_structured: unknown;
  capability_gap_json: unknown;
  error_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TaskInputRequestRow extends QueryResultRow {
  input_request_id: string;
  task_id: string;
  context_id: string;
  source: TaskInputRequest['source'];
  question: string;
  status: TaskInputRequest['status'];
  control_id: string | null;
  control_round_index: number | null;
  created_at: Date | string;
  answered_at: Date | string | null;
}

interface TaskInputResponseRow extends QueryResultRow {
  input_response_id: string;
  input_request_id: string;
  task_id: string;
  content_json: unknown;
  created_at: Date | string;
}

interface TaskExecutionAttemptRow extends QueryResultRow {
  attempt_id: string;
  task_id: string;
  context_id: string;
  reason: TaskExecutionAttempt['reason'];
  status: TaskExecutionAttempt['status'];
  input_request_id: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  error_code: string | null;
}

interface ProjectionRow extends QueryResultRow {
  protocol: 'a2a-v1';
  task_id: string;
  context_id: string;
  state: string;
  status_timestamp: Date | string | null;
  document_json: unknown;
  total_count?: string;
}

interface SkillDraftRow extends QueryResultRow {
  draft_id: string;
  task_id: string;
  context_id: string;
  requested_by: string;
  intent: 'create' | 'update';
  request_text: string;
  status: SkillDraft['status'];
  published_skill_id: string | null;
  published_skill_version: number | null;
  published_by: string | null;
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SkillRow extends QueryResultRow {
  skill_id: string;
  current_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SkillVersionRow extends QueryResultRow {
  skill_id: string;
  version: number;
  name: string;
  summary: string;
  description: string;
  capabilities_json: unknown;
  workflow_guidance: string;
  output_instruction: string;
  input_schema_json: unknown;
  output_schema_json: unknown;
  tool_policy_json: unknown;
  runtime_policy_json: unknown;
  status: SkillVersion['status'];
  source_kind: SkillVersion['sourceKind'];
  validation_passed: boolean;
  previous_version: number | null;
  created_at: Date | string;
}

interface SkillRelationRow extends QueryResultRow {
  relation_id: string;
  source_skill_id: string;
  target_skill_id: string;
  relation_type: SkillRelation['relationType'];
  metadata_json: Record<string, unknown>;
  created_at: Date | string;
}

interface SkillMetricsRow extends QueryResultRow {
  sample_count: number;
  success_rate: number;
  average_duration_ms: number;
  average_cost: number;
  failure_count: number;
  stability_score: number;
}

interface SkillQualityObservationRow extends QueryResultRow {
  observation_id: string;
  skill_id: string;
  skill_version: number;
  evaluation_ref: string;
  score: number;
  successful: boolean;
  created_at: Date | string;
}

interface SkillQualityWarningRow extends QueryResultRow {
  warning_id: string;
  skill_id: string;
  skill_version: number;
  kind: SkillQualityWarning['kind'];
  observation_ids_json: unknown;
  observed_value: number;
  threshold: number;
  summary: string;
  status: 'active';
  skill_status_at_creation: SkillQualityWarning['skillStatusAtCreation'];
  created_at: Date | string;
}

interface SkillSelectionRow extends QueryResultRow {
  selection_id: string;
  goal_contract_json: unknown;
  goal_description: string;
  candidates_json: unknown;
  selected_skill_id: string;
  selected_skill_version: number;
  decision_summary: string;
  created_at: Date | string;
}

interface TemporarySkillRow extends QueryResultRow {
  temporary_skill_id: string;
  task_id: string;
  context_id: string;
  name: string;
  description: string;
  tools_json: unknown;
  input_schema_json: unknown;
  output_schema_json: unknown;
  capability_fingerprint: string;
  status: TemporarySkill['status'];
  created_at: Date | string;
  expired_at: Date | string | null;
}

interface TemporaryExperienceRow extends QueryResultRow {
  experience_id: string;
  temporary_skill_id: string;
  task_id: string;
  context_id: string;
  capability_fingerprint: string;
  successful: boolean;
  outcome_summary: string;
  created_at: Date | string;
}

interface FormalizationCandidateRow extends QueryResultRow {
  candidate_id: string;
  capability_fingerprint: string;
  successful_experience_count: number;
  required_success_threshold: number;
  source_experience_ids_json: unknown;
  status: SkillFormalizationCandidate['status'];
  induction_report_json: unknown;
  validation_report_json: unknown;
  proposed_skill_json: unknown;
  published_skill_id: string | null;
  published_skill_version: number | null;
  created_at: Date | string;
  evaluated_at: Date | string | null;
}

interface SkillEvolutionCorrectionRow extends QueryResultRow {
  correction_id: string;
  candidate_id: string;
  capability_fingerprint: string;
  actor: string;
  summary: string;
  before_skill_json: unknown;
  after_skill_json: unknown;
  diff_json: unknown;
  validation_report_json: unknown;
  outcome: SkillEvolutionCorrectionExperience['outcome'];
  created_at: Date | string;
}

interface EvolutionExperienceRow extends QueryResultRow {
  experience_id: string;
  control_id: string;
  round_index: number;
  task_id: string | null;
  context_id: string;
  goal_json: unknown;
  workflow_json: unknown;
  instance_id: string;
  skill_versions_json: unknown;
  tools_json: unknown;
  input_json: unknown;
  result_json: unknown;
  errors_json: unknown;
  evaluation_json: unknown;
  successful: boolean;
  duration_ms: number;
  created_at: Date | string;
}

interface EvolutionTriggerRow extends QueryResultRow {
  trigger_id: string;
  capability_fingerprint: string;
  experience_id: string;
  successful_experience_count: number;
  configured_threshold: number;
  decision: EvolutionTriggerRecord['decision'];
  candidate_id: string | null;
  created_at: Date | string;
}

interface McpServerRow extends QueryResultRow {
  server_id: string;
  name: string;
  endpoint: string;
  transport: McpServer['transport'];
  status: McpServer['status'];
  tool_revision: number;
  encrypted_credential: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface McpToolRow extends QueryResultRow {
  server_id: string;
  tool_name: string;
  title: string | null;
  description: string | null;
  input_schema_json: unknown;
  enhancement_json: Record<string, unknown> | null;
  declared_execution_semantics_json: unknown;
  admin_execution_semantics_override_json: unknown;
  execution_semantics_json: unknown;
  task_execution_json?: unknown;
  discovered_at: Date | string;
}

interface McpWarningRow extends QueryResultRow {
  warning_id: string;
  server_id: string;
  tool_name: string;
  reason: McpDependencyWarning['reason'];
  skill_id: string;
  skill_version: number;
  tool_revision: number;
  created_at: Date | string;
  acknowledged_at: Date | string | null;
}

interface McpInvocationRow extends QueryResultRow {
  invocation_id: string;
  task_id: string | null;
  context_id: string | null;
  execution_mode: McpInvocation['executionMode'];
  simulation_id: string | null;
  server_id: string;
  tool_name: string;
  execution_semantics_json: unknown;
  arguments_json: Record<string, unknown>;
  result_json: unknown;
  status: McpInvocation['status'];
  error_code: string | null;
  error_message: string | null;
  started_at: Date | string;
  completed_at: Date | string;
  duration_ms: number;
}

interface McpManagementOperationRow extends QueryResultRow {
  operation_id: string;
  server_id: string;
  operation_type: McpManagementOperation['operationType'];
  actor: McpManagementOperation['actor'];
  target: string | null;
  summary_json: Record<string, unknown>;
  occurred_at: Date | string;
}

export class PostgresConversationContextRepository implements ConversationContextRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findById(contextId: string): Promise<ConversationContext | undefined> {
    const result = await this.#pool.query<ContextRow>(
      `SELECT context_id, user_id, created_at, updated_at
       FROM conversation_context
       WHERE context_id = $1`,
      [contextId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      contextId: row.context_id,
      userId: row.user_id,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
    };
  }

  async save(context: ConversationContext): Promise<void> {
    await this.#pool.query(
      `INSERT INTO conversation_context (context_id, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (context_id) DO UPDATE
       SET user_id = EXCLUDED.user_id, updated_at = EXCLUDED.updated_at`,
      [context.contextId, context.userId, context.createdAt, context.updatedAt],
    );
  }
}

export class PostgresRuntimeRecoveryRepository implements RuntimeRecoveryRepository {
  readonly #pool: Pool;
  readonly #onTaskStateCommitted: TaskStateCommitted | undefined;
  readonly #preserveRemoteWaits: boolean;

  constructor(
    pool: Pool,
    onTaskStateCommitted?: TaskStateCommitted,
    options: Readonly<{ preserveRemoteWaits?: boolean }> = {},
  ) {
    this.#pool = pool;
    this.#onTaskStateCommitted = onTaskStateCommitted;
    this.#preserveRemoteWaits = options.preserveRemoteWaits ?? false;
  }

  async failInterrupted(timestamp: string) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const tasks = await client.query<TaskRow>(
        `UPDATE agent_task task
         SET phase='failed', phase_message='Process stopped during execution; V1 does not recover or retry.',
             error_code='PROCESS_EXECUTION_LOST', updated_at=$1
         WHERE phase IN ('executing','paused','evaluating')
         ${
           this.#preserveRemoteWaits
             ? `AND NOT EXISTS (
           SELECT 1
           FROM workflow_continuation_snapshot snapshot
           JOIN workflow_continuation_wait_binding wait
             ON wait.snapshot_id=snapshot.snapshot_id
           JOIN remote_task_binding binding ON binding.binding_id=wait.binding_id
           JOIN workflow_instance instance
             ON instance.instance_id=snapshot.workflow_instance_id
           WHERE snapshot.agent_task_id=task.task_id
             AND snapshot.lifecycle='active'
             AND instance.status='waiting_external'
             AND binding.workflow_instance_id=instance.instance_id
             AND binding.invalidated_at IS NULL
             AND binding.local_state IN (
               'polling','cancel_observing','awaiting_input',
               'terminal_event_pending','terminal_event_claimed'
             )
         )`
             : ''
         }
         RETURNING *`,
        [timestamp],
      );
      const instances = await client.query(
        `UPDATE workflow_instance
         SET status='failed',
             errors_json=jsonb_set(errors_json,'{runtime}',
               '{"code":"PROCESS_EXECUTION_LOST","message":"Process stopped during execution; V1 does not recover or retry."}'::jsonb,true),
             pending_confirmation_json=NULL, completed_at=$1
         WHERE status IN ('running','paused')`,
        [timestamp],
      );
      const attempts = await client.query(
        `UPDATE task_execution_attempt
         SET status='failed', completed_at=$1, error_code='PROCESS_EXECUTION_LOST'
         WHERE status='running'
         ${
           this.#preserveRemoteWaits
             ? `AND NOT EXISTS (
           SELECT 1
           FROM agent_task task
           JOIN workflow_continuation_snapshot snapshot
             ON snapshot.agent_task_id=task.task_id
           JOIN workflow_continuation_wait_binding wait
             ON wait.snapshot_id=snapshot.snapshot_id
           JOIN remote_task_binding binding ON binding.binding_id=wait.binding_id
           JOIN workflow_instance instance
             ON instance.instance_id=snapshot.workflow_instance_id
           WHERE task.task_id=task_execution_attempt.task_id
             AND snapshot.lifecycle='active'
             AND instance.status='waiting_external'
             AND binding.workflow_instance_id=instance.instance_id
             AND binding.invalidated_at IS NULL
             AND binding.local_state IN (
               'polling','cancel_observing','awaiting_input',
               'terminal_event_pending','terminal_event_claimed'
             )
         )`
             : ''
         }`,
        [timestamp],
      );
      await client.query('COMMIT');
      for (const task of tasks.rows) this.#onTaskStateCommitted?.(mapTaskRow(task));
      return {
        tasks: tasks.rowCount ?? 0,
        workflowInstances: instances.rowCount ?? 0,
        taskAttempts: attempts.rowCount ?? 0,
      };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresGoalRepository implements GoalRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findById(goalId: string): Promise<Goal | undefined> {
    const result = await this.#pool.query<GoalRow>('SELECT * FROM goal WHERE goal_id=$1', [goalId]);
    return result.rows[0] === undefined ? undefined : mapGoalRow(result.rows[0]);
  }

  async findActiveByContextId(contextId: string): Promise<Goal | undefined> {
    const result = await this.#pool.query<GoalRow>(
      "SELECT * FROM goal WHERE context_id=$1 AND status='active'",
      [contextId],
    );
    return result.rows[0] === undefined ? undefined : mapGoalRow(result.rows[0]);
  }

  async findLatestByContextId(contextId: string): Promise<Goal | undefined> {
    const result = await this.#pool.query<GoalRow>(
      'SELECT * FROM goal WHERE context_id=$1 ORDER BY created_at DESC,goal_id DESC LIMIT 1',
      [contextId],
    );
    return result.rows[0] === undefined ? undefined : mapGoalRow(result.rows[0]);
  }

  async listByContextId(contextId: string): Promise<readonly Goal[]> {
    const result = await this.#pool.query<GoalRow>(
      'SELECT * FROM goal WHERE context_id=$1 ORDER BY created_at,goal_id',
      [contextId],
    );
    return result.rows.map(mapGoalRow);
  }

  async listTransitions(contextId: string): Promise<readonly GoalTransitionRecord[]> {
    const result = await this.#pool.query<{
      transition_id: string;
      context_id: string;
      from_goal_id: string;
      to_goal_id: string;
      relationship: GoalTransitionRecord['relationship'];
      decision_summary: string;
      request_text: string;
      created_at: Date | string;
    }>('SELECT * FROM goal_transition WHERE context_id=$1 ORDER BY created_at,transition_id', [
      contextId,
    ]);
    return result.rows.map((row) => ({
      transitionId: row.transition_id,
      contextId: row.context_id,
      fromGoalId: row.from_goal_id,
      toGoalId: row.to_goal_id,
      relationship: row.relationship,
      decisionSummary: row.decision_summary,
      requestText: row.request_text,
      createdAt: toIsoString(row.created_at),
    }));
  }

  async save(goal: Goal, transition?: GoalTransitionRecord): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const savedGoal = await client.query(
        `INSERT INTO goal(
         goal_id,context_id,version,title,description,constraints_json,success_criteria_json,
         status,previous_goal_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)
       ON CONFLICT(goal_id) DO UPDATE SET
         version=EXCLUDED.version,title=EXCLUDED.title,description=EXCLUDED.description,
         constraints_json=EXCLUDED.constraints_json,success_criteria_json=EXCLUDED.success_criteria_json,
         status=EXCLUDED.status,previous_goal_id=EXCLUDED.previous_goal_id,updated_at=EXCLUDED.updated_at
       WHERE goal.status='active'`,
        [
          goal.goalId,
          goal.contextId,
          goal.version,
          goal.title,
          goal.description,
          JSON.stringify(goal.constraints),
          JSON.stringify(goal.successCriteria),
          goal.status,
          goal.previousGoalId ?? null,
          goal.createdAt,
          goal.updatedAt,
        ],
      );
      if (savedGoal.rowCount !== 1) throw new Error('GOAL_TERMINAL_STATE_CONFLICT');
      if (transition !== undefined)
        await client.query(
          `INSERT INTO goal_transition(
             transition_id,context_id,from_goal_id,to_goal_id,relationship,
             decision_summary,request_text,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            transition.transitionId,
            transition.contextId,
            transition.fromGoalId,
            transition.toGoalId,
            transition.relationship,
            transition.decisionSummary,
            transition.requestText,
            transition.createdAt,
          ],
        );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

interface GoalPatchRow extends QueryResultRow {
  patch_id: string;
  goal_id: string;
  triggering_task_id: string | null;
  from_version: number;
  to_version: number;
  instruction: string;
  changes_json: unknown;
  decision_summary: string;
  compensation_warnings_json: unknown;
  invalidated_plan_ids_json: unknown;
  invalidated_instance_ids_json: unknown;
  new_plan_id: string;
  before_goal_json: unknown;
  after_goal_json: unknown;
  created_at: Date | string;
}

const GoalSnapshotSchema = z.object({
  goalId: z.string(),
  contextId: z.string(),
  version: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  constraints: z.array(z.string()),
  successCriteria: z.array(z.string()),
  status: z.enum(['active', 'achieved', 'canceled', 'unachievable', 'superseded']),
  previousGoalId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const GoalPatchChangesSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  successCriteria: z.array(z.string()).optional(),
});

export class PostgresGoalPatchRepository implements GoalPatchRepository {
  readonly #pool: Pool;
  readonly #onTaskStateCommitted: TaskStateCommitted | undefined;

  constructor(pool: Pool, onTaskStateCommitted?: TaskStateCommitted) {
    this.#pool = pool;
    this.#onTaskStateCommitted = onTaskStateCommitted;
  }

  async apply(
    record: Omit<GoalPatchRecord, 'invalidatedPlanIds' | 'invalidatedInstanceIds'>,
    triggeringTaskId?: string,
  ): Promise<GoalPatchRecord> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const goal = await client.query<GoalRow>('SELECT * FROM goal WHERE goal_id=$1 FOR UPDATE', [
        record.goalId,
      ]);
      const current = goal.rows[0];
      if (current?.version !== record.fromVersion || current.status !== 'active')
        throw new Error('GOAL_PATCH_VERSION_CONFLICT');
      await client.query(
        `UPDATE goal SET version=$2,title=$3,description=$4,constraints_json=$5::jsonb,
           success_criteria_json=$6::jsonb,updated_at=$7
         WHERE goal_id=$1`,
        [
          record.goalId,
          record.toVersion,
          record.afterGoal.title,
          record.afterGoal.description,
          JSON.stringify(record.afterGoal.constraints),
          JSON.stringify(record.afterGoal.successCriteria),
          record.createdAt,
        ],
      );
      const plans = await client.query<{ plan_id: string }>(
        `UPDATE workflow_plan SET confirmation_status='invalidated'
         WHERE goal_id=$1 AND goal_version=$2 AND confirmation_status<>'invalidated'
         RETURNING plan_id`,
        [record.goalId, record.fromVersion],
      );
      const instances = await client.query<{ instance_id: string }>(
        `UPDATE workflow_instance SET status='invalidated',completed_at=COALESCE(completed_at,$3),
           pending_confirmation_json=NULL,
           errors_json=jsonb_set(errors_json,'{goalPatch}',
             '{"code":"GOAL_PATCH_INVALIDATED","message":"Goal Patch invalidated this Workflow instance."}'::jsonb,true)
         WHERE goal_id=$1 AND goal_version=$2 AND status<>'invalidated'
         RETURNING instance_id`,
        [record.goalId, record.fromVersion, record.createdAt],
      );
      if (await relationExists(client, 'remote_task_binding')) {
        await client.query(
          `UPDATE remote_task_binding
           SET local_state='closed',invalidated_at=COALESCE(invalidated_at,$3),
               next_poll_at=NULL,updated_at=$3,version=version+1
           WHERE goal_id=$1 AND goal_version=$2 AND invalidated_at IS NULL`,
          [record.goalId, record.fromVersion, record.createdAt],
        );
      }
      if (await relationExists(client, 'workflow_continuation_snapshot')) {
        await client.query(
          `UPDATE workflow_continuation_snapshot
           SET lifecycle='invalidated',updated_at=$3
           WHERE goal_id=$1 AND goal_version=$2 AND lifecycle IN ('building','active')`,
          [record.goalId, record.fromVersion, record.createdAt],
        );
      }
      const tasks = await client.query<TaskRow>(
        `UPDATE agent_task SET
           phase=CASE WHEN task_id=$3 THEN 'planning' ELSE 'invalidated' END,
           phase_message='Goal Patch invalidated the old plan and intermediate result.',
           goal_version=$2,plan_id=NULL,skill_input_resolution_id=NULL,output_text=NULL,output_structured=NULL,
           error_code='GOAL_PATCH_INVALIDATED',updated_at=$4
         WHERE goal_id=$1 AND goal_version=$5
           AND phase NOT IN ('capability_gap','completed','canceled','failed','invalidated')
         RETURNING *`,
        [
          record.goalId,
          record.toVersion,
          triggeringTaskId ?? '',
          record.createdAt,
          record.fromVersion,
        ],
      );
      const completed: GoalPatchRecord = {
        ...record,
        ...(triggeringTaskId === undefined ? {} : { triggeringTaskId }),
        invalidatedPlanIds: plans.rows.map((row) => row.plan_id),
        invalidatedInstanceIds: instances.rows.map((row) => row.instance_id),
      };
      await client.query(
        `INSERT INTO goal_patch(
           patch_id,goal_id,triggering_task_id,from_version,to_version,instruction,changes_json,decision_summary,
           compensation_warnings_json,invalidated_plan_ids_json,invalidated_instance_ids_json,
           new_plan_id,before_goal_json,after_goal_json,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb,$14::jsonb,$15)`,
        [
          completed.patchId,
          completed.goalId,
          completed.triggeringTaskId ?? null,
          completed.fromVersion,
          completed.toVersion,
          completed.instruction,
          JSON.stringify(completed.changes),
          completed.decisionSummary,
          JSON.stringify(completed.compensationWarnings),
          JSON.stringify(completed.invalidatedPlanIds),
          JSON.stringify(completed.invalidatedInstanceIds),
          completed.newPlanId,
          JSON.stringify(completed.beforeGoal),
          JSON.stringify(completed.afterGoal),
          completed.createdAt,
        ],
      );
      await client.query('COMMIT');
      for (const task of tasks.rows) this.#onTaskStateCommitted?.(mapTaskRow(task));
      return completed;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async find(patchId: string): Promise<GoalPatchRecord | undefined> {
    const result = await this.#pool.query<GoalPatchRow>(
      'SELECT * FROM goal_patch WHERE patch_id=$1',
      [patchId],
    );
    return result.rows[0] === undefined ? undefined : mapGoalPatchRow(result.rows[0]);
  }

  async listByGoal(goalId: string): Promise<readonly GoalPatchRecord[]> {
    const result = await this.#pool.query<GoalPatchRow>(
      'SELECT * FROM goal_patch WHERE goal_id=$1 ORDER BY to_version',
      [goalId],
    );
    return result.rows.map(mapGoalPatchRow);
  }
}

interface GoalCancellationRow extends QueryResultRow {
  cancellation_id: string;
  goal_id: string;
  goal_version: number;
  reason: string;
  canceled_task_ids_json: unknown;
  invalidated_plan_ids_json: unknown;
  canceled_instance_ids_json: unknown;
  warnings_json: unknown;
  created_at: Date | string;
}

export class PostgresGoalCancellationRepository implements GoalCancellationRepository {
  readonly #pool: Pool;
  readonly #onTaskStateCommitted: TaskStateCommitted | undefined;

  constructor(pool: Pool, onTaskStateCommitted?: TaskStateCommitted) {
    this.#pool = pool;
    this.#onTaskStateCommitted = onTaskStateCommitted;
  }

  async cancel(
    input: Omit<
      GoalCancellationRecord,
      'canceledTaskIds' | 'invalidatedPlanIds' | 'canceledInstanceIds'
    >,
  ): Promise<GoalCancellationRecord> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const goal = await client.query<GoalRow>(
        "SELECT * FROM goal WHERE goal_id=$1 AND version=$2 AND status='active' FOR UPDATE",
        [input.goalId, input.goalVersion],
      );
      if (goal.rows[0] === undefined) throw new Error('GOAL_CANCELLATION_VERSION_CONFLICT');
      const controls = await client.query<{
        control_id: string;
        task_id: string | null;
        final_instance_id: string | null;
      }>(
        `SELECT control_id,task_id,final_instance_id FROM workflow_control
         WHERE goal_id=$1 AND goal_version=$2
           AND status IN ('running','awaiting_confirmation','awaiting_input')
         ORDER BY control_id FOR UPDATE`,
        [input.goalId, input.goalVersion],
      );
      await client.query("UPDATE goal SET status='canceled',updated_at=$2 WHERE goal_id=$1", [
        input.goalId,
        input.createdAt,
      ]);
      const tasks = await client.query<TaskRow>(
        `UPDATE agent_task SET phase='canceled',phase_message='Goal canceled by user.',
           error_code='GOAL_CANCELED',updated_at=$2
         WHERE (goal_id=$1 OR (
           goal_id IS NULL AND context_id=(SELECT context_id FROM goal WHERE goal_id=$1)
           AND created_at <= $2
         )) AND phase NOT IN ('capability_gap','completed','canceled','failed','invalidated')
         RETURNING *`,
        [input.goalId, input.createdAt],
      );
      const canceledTaskIds = new Set(tasks.rows.map((row) => row.task_id));
      if (canceledTaskIds.size > 0)
        await client.query(
          `UPDATE task_input_request SET status='canceled'
           WHERE task_id=ANY($1::text[]) AND status='waiting'`,
          [[...canceledTaskIds]],
        );
      for (const control of controls.rows) {
        if (control.task_id !== null && !canceledTaskIds.has(control.task_id))
          throw new Error('GOAL_CANCELLATION_CONTROL_TASK_CONFLICT');
        const outcomeId = `terminal-outcome-control-${control.control_id}`;
        await client.query(
          `INSERT INTO runtime_terminal_outcome(
             outcome_id,outcome_kind,task_id,goal_id,goal_version,control_id,control_status,
             round_index,final_instance_id,result_id,summary,enhancement_warnings_json,committed_at)
           VALUES($1,'canceled',$2,$3,$4,$5,'canceled',NULL,$6,NULL,$7,'[]'::jsonb,$8)`,
          [
            outcomeId,
            control.task_id,
            input.goalId,
            input.goalVersion,
            control.control_id,
            control.final_instance_id,
            input.reason,
            input.createdAt,
          ],
        );
        const updatedControl = await client.query(
          `UPDATE workflow_control SET status='canceled',terminal_outcome_id=$2,updated_at=$3
           WHERE control_id=$1
             AND status IN ('running','awaiting_confirmation','awaiting_input')`,
          [control.control_id, outcomeId, input.createdAt],
        );
        if (updatedControl.rowCount !== 1)
          throw new Error('GOAL_CANCELLATION_CONTROL_UPDATE_CONFLICT');
        if (control.task_id !== null)
          await client.query(
            `INSERT INTO runtime_event(
               event_id,task_id,context_id,event_type,event_timestamp,summary)
             VALUES($1,$2,$3,'task.phase_changed',$4,$5)`,
            [
              `event-terminal-control-${control.control_id}`,
              control.task_id,
              goal.rows[0].context_id,
              input.createdAt,
              input.reason,
            ],
          );
      }
      const plans = await client.query<{ plan_id: string }>(
        `UPDATE workflow_plan SET confirmation_status='invalidated'
         WHERE goal_id=$1 AND goal_version=$2
           AND confirmation_status IN ('awaiting_confirmation','confirmed') RETURNING plan_id`,
        [input.goalId, input.goalVersion],
      );
      await client.query(
        `UPDATE workflow_instance SET status='canceled',completed_at=COALESCE(completed_at,$3),
           pending_confirmation_json=NULL,
           errors_json=jsonb_set(errors_json,'{goalCancellation}',
             '{"code":"GOAL_CANCELED","message":"Goal cancellation terminated this Workflow instance without automatic compensation."}'::jsonb,true)
         WHERE goal_id=$1 AND goal_version=$2 AND status IN ('running','paused','waiting_external')`,
        [input.goalId, input.goalVersion, input.createdAt],
      );
      if (await relationExists(client, 'remote_task_binding')) {
        if (await relationExists(client, 'remote_task_cancel_request')) {
          await client.query(
            `INSERT INTO remote_task_cancel_request(
               cancel_request_id,binding_id,idempotency_key,source,reason_code,summary,
               delivery_status,attempt_count,requested_at,updated_at,version)
             SELECT 'remote-cancel-' || md5(binding_id || ':' || $1::text || ':' || $2::text),binding_id,
                    md5('goal:' || $1::text || ':' || $2::text || ':' || binding_id),'goal',
                    'local_goal_cancel',left($3,2048),'requested',0,$4,$4,1
             FROM remote_task_binding
             WHERE goal_id=$1 AND goal_version=$2::integer AND terminal_at IS NULL
               AND protocol_status IN ('working','input_required')
               AND local_state NOT IN ('closed','reentered','quarantined')
             ON CONFLICT(binding_id,idempotency_key) DO NOTHING`,
            [input.goalId, input.goalVersion, input.reason, input.createdAt],
          );
          await client.query(
            `UPDATE remote_task_binding
             SET local_state='cancel_observing',next_poll_at=$3,
                 poll_claim_token=NULL,poll_claimed_at=NULL,poll_claim_expires_at=NULL,
                 updated_at=$3,version=version+1
             WHERE goal_id=$1 AND goal_version=$2 AND terminal_at IS NULL
               AND protocol_status IN ('working','input_required')
               AND local_state NOT IN ('closed','reentered','quarantined','cancel_observing')`,
            [input.goalId, input.goalVersion, input.createdAt],
          );
        } else
          await client.query(
            `UPDATE remote_task_binding
             SET local_state='closed',invalidated_at=COALESCE(invalidated_at,$3),
                 next_poll_at=NULL,updated_at=$3,version=version+1
             WHERE goal_id=$1 AND goal_version=$2 AND invalidated_at IS NULL`,
            [input.goalId, input.goalVersion, input.createdAt],
          );
      }
      if (await relationExists(client, 'workflow_continuation_snapshot')) {
        await client.query(
          `UPDATE workflow_continuation_snapshot
           SET lifecycle='invalidated',updated_at=$3
           WHERE goal_id=$1 AND goal_version=$2 AND lifecycle IN ('building','active')`,
          [input.goalId, input.goalVersion, input.createdAt],
        );
      }
      const instances = await client.query<{ instance_id: string }>(
        `SELECT instance_id FROM workflow_instance
         WHERE goal_id=$1 AND goal_version=$2 AND status='canceled' ORDER BY instance_id`,
        [input.goalId, input.goalVersion],
      );
      const completed: GoalCancellationRecord = {
        ...input,
        canceledTaskIds: tasks.rows.map((row) => row.task_id),
        invalidatedPlanIds: plans.rows.map((row) => row.plan_id),
        canceledInstanceIds: instances.rows.map((row) => row.instance_id),
      };
      await client.query(
        `INSERT INTO goal_cancellation(
           cancellation_id,goal_id,goal_version,reason,canceled_task_ids_json,
           invalidated_plan_ids_json,canceled_instance_ids_json,warnings_json,created_at)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9)`,
        [
          completed.cancellationId,
          completed.goalId,
          completed.goalVersion,
          completed.reason,
          JSON.stringify(completed.canceledTaskIds),
          JSON.stringify(completed.invalidatedPlanIds),
          JSON.stringify(completed.canceledInstanceIds),
          JSON.stringify(completed.warnings),
          completed.createdAt,
        ],
      );
      await client.query('COMMIT');
      for (const task of tasks.rows) this.#onTaskStateCommitted?.(mapTaskRow(task));
      return completed;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async find(cancellationId: string): Promise<GoalCancellationRecord | undefined> {
    const result = await this.#pool.query<GoalCancellationRow>(
      'SELECT * FROM goal_cancellation WHERE cancellation_id=$1',
      [cancellationId],
    );
    return result.rows[0] === undefined ? undefined : mapGoalCancellationRow(result.rows[0]);
  }

  async listByGoal(goalId: string): Promise<readonly GoalCancellationRecord[]> {
    const result = await this.#pool.query<GoalCancellationRow>(
      'SELECT * FROM goal_cancellation WHERE goal_id=$1 ORDER BY created_at,cancellation_id',
      [goalId],
    );
    return result.rows.map(mapGoalCancellationRow);
  }
}

interface ProcessedResultRow extends QueryResultRow {
  result_id: string;
  task_id: string;
  skill_id: string;
  skill_version: number;
  normalized_json: unknown;
  output_json: unknown;
  facts_json: unknown;
  valuable: boolean;
  value_summary: string;
  memory_candidates_json: unknown;
  created_at: Date | string;
}

const NormalizedResultSchema = z.object({
  data: z.unknown(),
  errors: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
  originalSize: z.number().int().nonnegative(),
  contextValue: z.unknown(),
  contextTruncated: z.boolean(),
  summary: z.string(),
});
const TaskOutputSchema = z.object({ text: z.string(), structured: z.unknown() }).strict();
const ResultFactsSchema = z.array(
  z.object({ name: z.string(), value: z.unknown(), confidence: z.number() }).strict(),
);
const ResultMemoryCandidatesSchema = z.array(
  z
    .object({
      kind: z.enum(['fact', 'preference', 'procedure', 'outcome']),
      content: z.string(),
      confidence: z.number(),
    })
    .strict(),
);

export class PostgresProcessedResultRepository implements ProcessedResultRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async save(record: ProcessedResultRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO processed_result(
         result_id,task_id,skill_id,skill_version,normalized_json,output_json,
         facts_json,valuable,value_summary,memory_candidates_json,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11)`,
      [
        record.resultId,
        record.taskId,
        record.skillId,
        record.skillVersion,
        JSON.stringify(record.normalized),
        JSON.stringify(record.output),
        JSON.stringify(record.facts),
        record.valuable,
        record.valueSummary,
        JSON.stringify(record.memoryCandidates),
        record.createdAt,
      ],
    );
  }

  async find(resultId: string): Promise<ProcessedResultRecord | undefined> {
    const result = await this.#pool.query<ProcessedResultRow>(
      'SELECT * FROM processed_result WHERE result_id=$1',
      [resultId],
    );
    return result.rows[0] === undefined ? undefined : mapProcessedResultRow(result.rows[0]);
  }

  async listByTask(taskId: string): Promise<readonly ProcessedResultRecord[]> {
    const result = await this.#pool.query<ProcessedResultRow>(
      'SELECT * FROM processed_result WHERE task_id=$1 ORDER BY created_at,result_id',
      [taskId],
    );
    return result.rows.map(mapProcessedResultRow);
  }
}

interface SkillInputResolutionRow extends QueryResultRow {
  resolution_id: string;
  task_id: string;
  goal_id: string;
  goal_version: number;
  skill_id: string;
  skill_version: number;
  structured_input_json: unknown;
  unresolved_fields_json: unknown;
  source_refs_json: unknown;
  decision_summary: string;
  status: SkillInputResolutionRecord['status'];
  created_at: Date | string;
}

export class PostgresSkillInputResolutionRepository implements SkillInputResolutionRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async save(record: SkillInputResolutionRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_input_resolution(
         resolution_id,task_id,goal_id,goal_version,skill_id,skill_version,
         structured_input_json,unresolved_fields_json,source_refs_json,
         decision_summary,status,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)`,
      [
        record.resolutionId,
        record.taskId,
        record.goalId,
        record.goalVersion,
        record.skillId,
        record.skillVersion,
        record.structuredInput === undefined ? null : JSON.stringify(record.structuredInput),
        JSON.stringify(record.unresolvedFields),
        JSON.stringify(record.sourceRefs),
        record.decisionSummary,
        record.status,
        record.createdAt,
      ],
    );
  }

  async find(resolutionId: string): Promise<SkillInputResolutionRecord | undefined> {
    const result = await this.#pool.query<SkillInputResolutionRow>(
      'SELECT * FROM skill_input_resolution WHERE resolution_id=$1',
      [resolutionId],
    );
    return result.rows[0] === undefined ? undefined : mapSkillInputResolutionRow(result.rows[0]);
  }

  async findLatest(
    taskId: string,
    skillId: string,
    skillVersion: number,
    goalVersion: number,
  ): Promise<SkillInputResolutionRecord | undefined> {
    const result = await this.#pool.query<SkillInputResolutionRow>(
      `SELECT * FROM skill_input_resolution
       WHERE task_id=$1 AND skill_id=$2 AND skill_version=$3 AND goal_version=$4
       ORDER BY created_at DESC,resolution_id DESC LIMIT 1`,
      [taskId, skillId, skillVersion, goalVersion],
    );
    return result.rows[0] === undefined ? undefined : mapSkillInputResolutionRow(result.rows[0]);
  }

  async listByTask(taskId: string): Promise<readonly SkillInputResolutionRecord[]> {
    const result = await this.#pool.query<SkillInputResolutionRow>(
      `SELECT * FROM skill_input_resolution
       WHERE task_id=$1 ORDER BY created_at,resolution_id`,
      [taskId],
    );
    return result.rows.map(mapSkillInputResolutionRow);
  }

  async listProcessedDataByContext(
    contextId: string,
    excludeTaskId: string,
    limit: number,
  ): Promise<readonly Readonly<{ sourceRef: string; value: unknown }>[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new Error('SKILL_INPUT_CONTEXT_EVIDENCE_LIMIT_INVALID');
    const result = await this.#pool.query<{
      result_id: string;
      context_value: unknown;
    }>(
      `SELECT r.result_id,r.normalized_json->'contextValue' context_value
       FROM processed_result r
       JOIN agent_task t ON t.task_id=r.task_id
       WHERE t.context_id=$1 AND t.task_id<>$2 AND t.phase='completed'
       ORDER BY r.created_at DESC,r.result_id DESC LIMIT $3`,
      [contextId, excludeTaskId, limit],
    );
    return result.rows.map((row) => ({
      sourceRef: `processed-result:${row.result_id}`,
      value: row.context_value,
    }));
  }
}

function mapSkillInputResolutionRow(row: SkillInputResolutionRow): SkillInputResolutionRecord {
  return {
    resolutionId: row.resolution_id,
    taskId: row.task_id,
    goalId: row.goal_id,
    goalVersion: row.goal_version,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    ...(row.status === 'failed' ? {} : { structuredInput: row.structured_input_json }),
    unresolvedFields: StringArraySchema.parse(row.unresolved_fields_json),
    sourceRefs: StringArraySchema.parse(row.source_refs_json),
    decisionSummary: row.decision_summary,
    status: row.status,
    createdAt: toIsoString(row.created_at),
  };
}

interface RuntimeTerminalOutcomeRow extends QueryResultRow {
  outcome_id: string;
  outcome_kind: RuntimeTerminalOutcomeKind;
  task_id: string | null;
  goal_id: string;
  goal_version: number;
  control_id: string;
  control_status: RuntimeTerminalControlStatus;
  round_index: number | null;
  final_instance_id: string | null;
  result_id: string | null;
  summary: string;
  enhancement_warnings_json: unknown;
  committed_at: Date | string;
}

const RuntimeEnhancementWarningsSchema = z.array(
  z
    .object({
      source: z.enum([
        'result_memory',
        'task_quality',
        'evolution_experience',
        'evaluation_memory',
        'temporary_skill',
        'skill_evolution',
      ]),
      code: z.string(),
      message: z.string(),
      occurredAt: z.string(),
    })
    .strict(),
);

type RuntimeTerminalCommitInput =
  RuntimeAchievedOutcomeInput | RuntimeUnachievableOutcomeInput | RuntimeCanceledOutcomeInput;

export class PostgresRuntimeTerminalOutcomeRepository implements RuntimeTerminalOutcomeRepository {
  readonly #pool: Pool;
  readonly #onTaskStateCommitted: TaskStateCommitted | undefined;

  constructor(pool: Pool, onTaskStateCommitted?: TaskStateCommitted) {
    this.#pool = pool;
    this.#onTaskStateCommitted = onTaskStateCommitted;
  }

  commitAchieved(input: RuntimeAchievedOutcomeInput): Promise<RuntimeTerminalOutcomeRecord> {
    return this.#commit('achieved', 'achieved', input);
  }

  commitUnachievable(
    input: RuntimeUnachievableOutcomeInput,
  ): Promise<RuntimeTerminalOutcomeRecord> {
    return this.#commit('unachievable', input.controlStatus, input);
  }

  commitCanceled(input: RuntimeCanceledOutcomeInput): Promise<RuntimeTerminalOutcomeRecord> {
    return this.#commit('canceled', 'canceled', input);
  }

  async recordEnhancementWarning(
    outcomeId: string,
    warning: RuntimeEnhancementWarning,
  ): Promise<void> {
    const warningJson = JSON.stringify([warning]);
    const result = await this.#pool.query(
      `UPDATE runtime_terminal_outcome
       SET enhancement_warnings_json=enhancement_warnings_json || $2::jsonb
       WHERE outcome_id=$1 AND NOT enhancement_warnings_json @> $2::jsonb`,
      [outcomeId, warningJson],
    );
    if (result.rowCount === 0 && (await this.find(outcomeId)) === undefined)
      throw new Error('RUNTIME_TERMINAL_OUTCOME_NOT_FOUND');
  }

  async find(outcomeId: string): Promise<RuntimeTerminalOutcomeRecord | undefined> {
    const result = await this.#pool.query<RuntimeTerminalOutcomeRow>(
      'SELECT * FROM runtime_terminal_outcome WHERE outcome_id=$1',
      [outcomeId],
    );
    return result.rows[0] === undefined ? undefined : mapRuntimeTerminalOutcome(result.rows[0]);
  }

  async findByControl(controlId: string): Promise<RuntimeTerminalOutcomeRecord | undefined> {
    const result = await this.#pool.query<RuntimeTerminalOutcomeRow>(
      'SELECT * FROM runtime_terminal_outcome WHERE control_id=$1',
      [controlId],
    );
    return result.rows[0] === undefined ? undefined : mapRuntimeTerminalOutcome(result.rows[0]);
  }

  async #commit(
    kind: RuntimeTerminalOutcomeKind,
    controlStatus: RuntimeTerminalControlStatus,
    input: RuntimeTerminalCommitInput,
  ): Promise<RuntimeTerminalOutcomeRecord> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const task =
        input.taskId === undefined
          ? undefined
          : (
              await client.query<{
                task_id: string;
                context_id: string;
                phase: AgentTask['phase'];
                goal_id: string | null;
                goal_version: number | null;
              }>(
                `SELECT task_id,context_id,phase,goal_id,goal_version
                 FROM agent_task WHERE task_id=$1 FOR UPDATE`,
                [input.taskId],
              )
            ).rows[0];
      if (input.taskId !== undefined && task === undefined)
        throw new Error('RUNTIME_TERMINAL_TASK_NOT_FOUND');
      const goal = (
        await client.query<{
          goal_id: string;
          context_id: string;
          version: number;
          status: Goal['status'];
        }>('SELECT goal_id,context_id,version,status FROM goal WHERE goal_id=$1 FOR UPDATE', [
          input.goalId,
        ])
      ).rows[0];
      const control = (
        await client.query<{
          control_id: string;
          context_id: string;
          goal_id: string;
          goal_version: number;
          task_id: string | null;
          status: WorkflowControlRecord['status'];
          current_plan_id: string;
          final_instance_id: string | null;
          round_count: number;
        }>(
          `SELECT control_id,context_id,goal_id,goal_version,task_id,status,current_plan_id,
                  final_instance_id,round_count
           FROM workflow_control WHERE control_id=$1 FOR UPDATE`,
          [input.controlId],
        )
      ).rows[0];
      if (goal === undefined) throw new Error('RUNTIME_TERMINAL_GOAL_NOT_FOUND');
      if (control === undefined) throw new Error('RUNTIME_TERMINAL_CONTROL_NOT_FOUND');

      const existing = (
        await client.query<RuntimeTerminalOutcomeRow>(
          'SELECT * FROM runtime_terminal_outcome WHERE outcome_id=$1 OR control_id=$2 FOR UPDATE',
          [input.outcomeId, input.controlId],
        )
      ).rows[0];
      if (existing !== undefined) {
        const mapped = mapRuntimeTerminalOutcome(existing);
        if (matchesTerminalRetry(mapped, kind, controlStatus, input)) {
          await client.query('COMMIT');
          return mapped;
        }
        throw new Error('RUNTIME_TERMINAL_OUTCOME_CONFLICT');
      }

      const round = input.round;
      const roundIndex = round?.roundIndex;
      const finalInstanceId =
        kind === 'canceled'
          ? ((input as RuntimeCanceledOutcomeInput).finalInstanceId ?? round?.instanceId)
          : round?.instanceId;
      const processed =
        kind === 'achieved' ? (input as RuntimeAchievedOutcomeInput).processedResult : undefined;
      const terminalInstance =
        finalInstanceId === undefined
          ? undefined
          : (
              await client.query<{
                instance_id: string;
                plan_id: string;
                goal_id: string;
                goal_version: number;
              }>(
                `SELECT instance_id,plan_id,goal_id,goal_version
                 FROM workflow_instance WHERE instance_id=$1`,
                [finalInstanceId],
              )
            ).rows[0];
      if (
        goal.version !== input.goalVersion ||
        goal.status !== 'active' ||
        goal.context_id !== control.context_id ||
        control.goal_id !== input.goalId ||
        control.goal_version !== input.goalVersion ||
        !isExpectedTerminalControlStatus(control.status, kind) ||
        (round !== undefined &&
          (round.controlId !== input.controlId || round.planId !== control.current_plan_id)) ||
        (roundIndex !== undefined && control.round_count !== roundIndex) ||
        control.task_id !== (input.taskId ?? null) ||
        (task !== undefined &&
          (task.context_id !== control.context_id ||
            task.goal_id !== input.goalId ||
            task.goal_version !== input.goalVersion ||
            !isExpectedTerminalTaskPhase(task.phase, kind))) ||
        (finalInstanceId !== undefined &&
          (terminalInstance?.goal_id !== input.goalId ||
            terminalInstance.goal_version !== input.goalVersion ||
            (round !== undefined && terminalInstance.plan_id !== round.planId) ||
            (round === undefined &&
              finalInstanceId !== control.final_instance_id &&
              terminalInstance.plan_id !== control.current_plan_id)))
      )
        throw new Error('RUNTIME_TERMINAL_EXPECTED_STATE_CONFLICT');
      if (
        processed !== undefined &&
        (input.taskId === undefined || processed.taskId !== input.taskId)
      )
        throw new Error('RUNTIME_TERMINAL_RESULT_TASK_MISMATCH');
      if (input.taskId !== undefined && kind === 'achieved' && processed === undefined)
        throw new Error('RUNTIME_TERMINAL_RESULT_REQUIRED');
      if (
        (kind === 'achieved' && round?.evaluation.decision !== 'achieved') ||
        (kind === 'unachievable' &&
          controlStatus === 'unachievable' &&
          round?.evaluation.decision !== 'unachievable')
      )
        throw new Error('RUNTIME_TERMINAL_DECISION_MISMATCH');

      if (processed !== undefined) await insertProcessedResult(client, processed);
      await client.query(
        `INSERT INTO runtime_terminal_outcome(
           outcome_id,outcome_kind,task_id,goal_id,goal_version,control_id,control_status,
           round_index,final_instance_id,result_id,summary,enhancement_warnings_json,committed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'[]'::jsonb,$12)`,
        [
          input.outcomeId,
          kind,
          input.taskId ?? null,
          input.goalId,
          input.goalVersion,
          input.controlId,
          controlStatus,
          roundIndex ?? null,
          finalInstanceId ?? null,
          processed?.resultId ?? null,
          input.summary,
          input.committedAt,
        ],
      );
      let committedTask: AgentTask | undefined;
      if (task !== undefined) {
        const terminalTask = terminalTaskProjection(kind, input.summary, processed);
        const updated = await client.query<TaskRow>(
          `UPDATE agent_task SET phase=$2,phase_message=$3,output_text=$4,
             output_structured=$5::jsonb,error_code=$6,updated_at=$7
           WHERE task_id=$1 AND (
             ($8='canceled' AND phase NOT IN ('capability_gap','completed','canceled','failed','invalidated'))
             OR ($8<>'canceled' AND phase IN ('executing','evaluating'))
           )
           RETURNING *`,
          [
            task.task_id,
            terminalTask.phase,
            terminalTask.phaseMessage,
            terminalTask.output?.text ?? null,
            terminalTask.output === undefined
              ? null
              : JSON.stringify(terminalTask.output.structured),
            terminalTask.errorCode ?? null,
            input.committedAt,
            kind,
          ],
        );
        const committedTaskRow = updated.rows[0];
        if (updated.rowCount !== 1 || committedTaskRow === undefined)
          throw new Error('RUNTIME_TERMINAL_TASK_UPDATE_CONFLICT');
        committedTask = mapTaskRow(committedTaskRow);
      }
      const goalStatus =
        kind === 'achieved' ? 'achieved' : kind === 'canceled' ? 'canceled' : 'unachievable';
      const updatedGoal = await client.query(
        `UPDATE goal SET status=$3,updated_at=$4
         WHERE goal_id=$1 AND version=$2 AND status='active'`,
        [input.goalId, input.goalVersion, goalStatus, input.committedAt],
      );
      if (updatedGoal.rowCount !== 1) throw new Error('RUNTIME_TERMINAL_GOAL_UPDATE_CONFLICT');
      const updatedControl = await client.query(
        `UPDATE workflow_control SET status=$2,round_count=$3,final_instance_id=$4,
           terminal_outcome_id=$5,updated_at=$6
         WHERE control_id=$1
           AND status IN ('running','awaiting_confirmation','awaiting_input')
           AND round_count=$7`,
        [
          input.controlId,
          controlStatus,
          roundIndex === undefined ? control.round_count : roundIndex + 1,
          finalInstanceId ?? null,
          input.outcomeId,
          input.committedAt,
          control.round_count,
        ],
      );
      if (updatedControl.rowCount !== 1)
        throw new Error('RUNTIME_TERMINAL_CONTROL_UPDATE_CONFLICT');
      if (
        kind === 'canceled' &&
        (await relationExists(client, 'remote_task_cancel_request')) &&
        (await relationExists(client, 'remote_task_binding'))
      ) {
        await client.query(
          `INSERT INTO remote_task_cancel_request(
             cancel_request_id,binding_id,idempotency_key,source,reason_code,summary,
             delivery_status,attempt_count,requested_at,updated_at,version)
           SELECT 'remote-cancel-' || md5(binding_id || ':' || $1),binding_id,
                  md5('task:' || $1 || ':' || binding_id),'task','local_task_cancel',
                  left($2,2048),'requested',0,$3,$3,1
           FROM remote_task_binding
           WHERE agent_task_id=$1 AND goal_id=$4 AND goal_version=$5
             AND terminal_at IS NULL AND protocol_status IN ('working','input_required')
             AND local_state NOT IN ('closed','reentered','quarantined')
           ON CONFLICT(binding_id,idempotency_key) DO NOTHING`,
          [input.taskId ?? '', input.summary, input.committedAt, input.goalId, input.goalVersion],
        );
        await client.query(
          `UPDATE remote_task_binding
           SET local_state='cancel_observing',next_poll_at=$2,
               poll_claim_token=NULL,poll_claimed_at=NULL,poll_claim_expires_at=NULL,
               updated_at=$2,version=version+1
           WHERE agent_task_id=$1 AND goal_id=$3 AND goal_version=$4
             AND terminal_at IS NULL AND protocol_status IN ('working','input_required')
             AND local_state NOT IN ('closed','reentered','quarantined','cancel_observing')`,
          [input.taskId ?? '', input.committedAt, input.goalId, input.goalVersion],
        );
      }
      if (round !== undefined) await insertTerminalRound(client, round, input.outcomeId);
      if (task !== undefined) {
        if (kind === 'canceled')
          await client.query(
            `UPDATE task_input_request SET status='canceled'
             WHERE task_id=$1 AND status='waiting'`,
            [task.task_id],
          );
        await client.query(
          `INSERT INTO runtime_event(event_id,task_id,context_id,event_type,event_timestamp,summary)
           VALUES($1,$2,$3,'task.phase_changed',$4,$5)`,
          [
            input.eventId ?? `event-${input.outcomeId}`,
            task.task_id,
            task.context_id,
            input.committedAt,
            input.summary,
          ],
        );
      }
      await client.query('COMMIT');
      if (committedTask !== undefined) this.#onTaskStateCommitted?.(committedTask);
      return {
        outcomeId: input.outcomeId,
        kind,
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        goalId: input.goalId,
        goalVersion: input.goalVersion,
        controlId: input.controlId,
        controlStatus,
        ...(roundIndex === undefined ? {} : { roundIndex }),
        ...(finalInstanceId === undefined ? {} : { finalInstanceId }),
        ...(processed === undefined ? {} : { resultId: processed.resultId }),
        summary: input.summary,
        enhancementWarnings: [],
        committedAt: input.committedAt,
      };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertProcessedResult(
  client: PoolClient,
  record: ProcessedResultRecord,
): Promise<void> {
  await client.query(
    `INSERT INTO processed_result(
       result_id,task_id,skill_id,skill_version,normalized_json,output_json,
       facts_json,valuable,value_summary,memory_candidates_json,created_at)
     VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11)`,
    [
      record.resultId,
      record.taskId,
      record.skillId,
      record.skillVersion,
      JSON.stringify(record.normalized),
      JSON.stringify(record.output),
      JSON.stringify(record.facts),
      record.valuable,
      record.valueSummary,
      JSON.stringify(record.memoryCandidates),
      record.createdAt,
    ],
  );
}

async function insertTerminalRound(
  client: PoolClient,
  round: WorkflowControlRound,
  outcomeId: string,
): Promise<void> {
  const result = await client.query(
    `INSERT INTO workflow_control_round(
       control_id,round_index,plan_id,instance_id,workflow_version,evaluation_decision,
       evaluation_summary,evaluation_detail_json,terminal_outcome_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
     ON CONFLICT(control_id,round_index) DO UPDATE SET terminal_outcome_id=EXCLUDED.terminal_outcome_id
     WHERE workflow_control_round.plan_id=EXCLUDED.plan_id
       AND workflow_control_round.instance_id=EXCLUDED.instance_id
       AND workflow_control_round.workflow_version=EXCLUDED.workflow_version
       AND workflow_control_round.evaluation_detail_json=EXCLUDED.evaluation_detail_json
       AND workflow_control_round.terminal_outcome_id IS NULL`,
    [
      round.controlId,
      round.roundIndex,
      round.planId,
      round.instanceId,
      round.workflowVersion,
      round.evaluation.decision,
      round.evaluation.summary,
      JSON.stringify(round.evaluation),
      outcomeId,
      round.createdAt,
    ],
  );
  if (result.rowCount !== 1) throw new Error('RUNTIME_TERMINAL_ROUND_CONFLICT');
}

function terminalTaskProjection(
  kind: RuntimeTerminalOutcomeKind,
  summary: string,
  processed: ProcessedResultRecord | undefined,
): Readonly<{
  phase: Extract<AgentTask['phase'], 'completed' | 'failed' | 'canceled'>;
  phaseMessage: string;
  output?: ProcessedResultRecord['output'];
  errorCode?: string;
}> {
  if (kind === 'achieved') {
    if (processed === undefined) throw new Error('RUNTIME_TERMINAL_RESULT_REQUIRED');
    return { phase: 'completed', phaseMessage: 'Task completed.', output: processed.output };
  }
  if (kind === 'canceled')
    return { phase: 'canceled', phaseMessage: summary, errorCode: 'RUNTIME_CANCELED' };
  return { phase: 'failed', phaseMessage: summary, errorCode: 'GOAL_UNACHIEVABLE' };
}

function isExpectedTerminalTaskPhase(
  phase: AgentTask['phase'],
  kind: RuntimeTerminalOutcomeKind,
): boolean {
  if (kind !== 'canceled') return phase === 'executing' || phase === 'evaluating';
  return (
    phase !== 'capability_gap' &&
    phase !== 'completed' &&
    phase !== 'canceled' &&
    phase !== 'failed' &&
    phase !== 'invalidated'
  );
}

function isExpectedTerminalControlStatus(
  status: WorkflowControlRecord['status'],
  kind: RuntimeTerminalOutcomeKind,
): boolean {
  if (kind !== 'canceled') return status === 'running';
  return status === 'running' || status === 'awaiting_confirmation' || status === 'awaiting_input';
}

function matchesTerminalRetry(
  existing: RuntimeTerminalOutcomeRecord,
  kind: RuntimeTerminalOutcomeKind,
  controlStatus: RuntimeTerminalControlStatus,
  input: RuntimeTerminalCommitInput,
): boolean {
  const round = input.round;
  const processed =
    kind === 'achieved' ? (input as RuntimeAchievedOutcomeInput).processedResult : undefined;
  const finalInstanceId =
    kind === 'canceled'
      ? ((input as RuntimeCanceledOutcomeInput).finalInstanceId ?? round?.instanceId)
      : round?.instanceId;
  return (
    existing.outcomeId === input.outcomeId &&
    existing.kind === kind &&
    existing.taskId === input.taskId &&
    existing.goalId === input.goalId &&
    existing.goalVersion === input.goalVersion &&
    existing.controlId === input.controlId &&
    existing.controlStatus === controlStatus &&
    existing.roundIndex === round?.roundIndex &&
    existing.finalInstanceId === finalInstanceId &&
    existing.resultId === processed?.resultId &&
    existing.summary === input.summary
  );
}

function mapRuntimeTerminalOutcome(row: RuntimeTerminalOutcomeRow): RuntimeTerminalOutcomeRecord {
  return {
    outcomeId: row.outcome_id,
    kind: row.outcome_kind,
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    goalId: row.goal_id,
    goalVersion: row.goal_version,
    controlId: row.control_id,
    controlStatus: row.control_status,
    ...(row.round_index === null ? {} : { roundIndex: row.round_index }),
    ...(row.final_instance_id === null ? {} : { finalInstanceId: row.final_instance_id }),
    ...(row.result_id === null ? {} : { resultId: row.result_id }),
    summary: row.summary,
    enhancementWarnings: RuntimeEnhancementWarningsSchema.parse(row.enhancement_warnings_json),
    committedAt: toIsoString(row.committed_at),
  };
}

interface TaskQualityReportRow extends QueryResultRow {
  report_id: string;
  task_id: string;
  goal_id: string;
  goal_version: number;
  workflow_instance_id: string;
  processed_result_id: string;
  assessments_json: unknown;
  overall_score: number;
  status: TaskQualityReport['status'];
  created_at: Date | string;
}
const TaskQualityAssessmentsSchema = z.array(
  z
    .object({
      component: z.enum(['goal', 'workflow', 'skill', 'result_quality', 'tool_call']),
      score: z.number().min(0).max(1),
      summary: z.string().min(1),
      findings: z.array(z.string()),
      evidenceRefs: z.array(z.string()).min(1),
    })
    .strict(),
);
export class PostgresTaskQualityReportRepository implements TaskQualityReportRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }
  async save(report: TaskQualityReport): Promise<void> {
    await this.#pool.query(
      `INSERT INTO task_quality_report(
         report_id,task_id,goal_id,goal_version,workflow_instance_id,processed_result_id,
         assessments_json,overall_score,status,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
      [
        report.reportId,
        report.taskId,
        report.goalId,
        report.goalVersion,
        report.workflowInstanceId,
        report.processedResultId,
        JSON.stringify(report.assessments),
        report.overallScore,
        report.status,
        report.createdAt,
      ],
    );
  }
  async findByTask(taskId: string): Promise<TaskQualityReport | undefined> {
    const result = await this.#pool.query<TaskQualityReportRow>(
      'SELECT * FROM task_quality_report WHERE task_id=$1',
      [taskId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          reportId: row.report_id,
          taskId: row.task_id,
          goalId: row.goal_id,
          goalVersion: row.goal_version,
          workflowInstanceId: row.workflow_instance_id,
          processedResultId: row.processed_result_id,
          assessments: TaskQualityAssessmentsSchema.parse(row.assessments_json),
          overallScore: row.overall_score,
          status: row.status,
          createdAt: toIsoString(row.created_at),
        };
  }
}

interface EvaluationInfluenceRow extends QueryResultRow {
  influence_id: string;
  report_id: string;
  task_id: string;
  experience_id: string;
  skill_observation_id: string | null;
  workflow_disposition: EvaluationInfluenceRecord['workflowDisposition'];
  workflow_template_id: string | null;
  workflow_template_version: number | null;
  prompt_disposition: EvaluationInfluenceRecord['promptDisposition'];
  prompt_id: string | null;
  prompt_version: number | null;
  prompt_stage: ModelStage | null;
  created_at: Date | string;
}

export class PostgresEvaluationInfluenceRepository implements EvaluationInfluenceRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }
  async save(record: EvaluationInfluenceRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO evaluation_influence(
         influence_id,report_id,task_id,experience_id,skill_observation_id,
         workflow_disposition,workflow_template_id,workflow_template_version,
         prompt_disposition,prompt_id,prompt_version,prompt_stage,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        record.influenceId,
        record.reportId,
        record.taskId,
        record.experienceId,
        record.skillObservationId ?? null,
        record.workflowDisposition,
        record.workflowTemplateId ?? null,
        record.workflowTemplateVersion ?? null,
        record.promptDisposition,
        record.promptId ?? null,
        record.promptVersion ?? null,
        record.promptStage ?? null,
        record.createdAt,
      ],
    );
  }
  async findByReport(reportId: string): Promise<EvaluationInfluenceRecord | undefined> {
    const result = await this.#pool.query<EvaluationInfluenceRow>(
      'SELECT * FROM evaluation_influence WHERE report_id=$1',
      [reportId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      influenceId: row.influence_id,
      reportId: row.report_id,
      taskId: row.task_id,
      experienceId: row.experience_id,
      ...(row.skill_observation_id === null
        ? {}
        : { skillObservationId: row.skill_observation_id }),
      workflowDisposition: row.workflow_disposition,
      ...(row.workflow_template_id === null || row.workflow_template_version === null
        ? {}
        : {
            workflowTemplateId: row.workflow_template_id,
            workflowTemplateVersion: row.workflow_template_version,
          }),
      promptDisposition: row.prompt_disposition,
      ...(row.prompt_id === null || row.prompt_version === null || row.prompt_stage === null
        ? {}
        : {
            promptId: row.prompt_id,
            promptVersion: row.prompt_version,
            promptStage: row.prompt_stage,
          }),
      createdAt: toIsoString(row.created_at),
    };
  }
}

interface EvaluationAnalyticsRow extends QueryResultRow {
  experience_id: string;
  task_id: string | null;
  instance_id: string;
  skill_versions_json: unknown;
  tools_json: unknown;
  mcp_invocations_json: unknown;
  model_invocations_json: unknown;
  successful: boolean;
  duration_ms: number;
  budget_usage_json: unknown;
  errors_json: unknown;
  evaluation_decision: string;
  report_id: string | null;
  report_task_id: string | null;
  overall_score: number | null;
  quality_status: TaskQualityReport['status'] | null;
  quality_created_at: Date | string | null;
}

const AnalyticsSkillVersionsSchema = z.array(
  z.object({ skillId: z.string(), version: z.number().int().positive() }).strict(),
);
const AnalyticsToolsSchema = z.array(
  z.object({ serverId: z.string(), toolName: z.string() }).strict(),
);
const AnalyticsMcpInvocationsSchema = z.array(
  z
    .object({
      serverId: z.string(),
      toolName: z.string(),
      status: z.enum(['succeeded', 'failed', 'canceled']),
      durationMs: z.number().nonnegative(),
    })
    .strict(),
);
const AnalyticsModelInvocationsSchema = z.array(
  z
    .object({
      providerId: z.string(),
      model: z.string(),
      status: z.enum(['succeeded', 'failed']),
      durationMs: z.number().nonnegative(),
      inputTokens: z.number().nonnegative(),
      outputTokens: z.number().nonnegative(),
    })
    .strict(),
);
const AnalyticsBudgetSchema = z.looseObject({ cost: z.number().nonnegative() });
const AnalyticsErrorsSchema = z.record(
  z.string(),
  z.object({ code: z.string(), message: z.string() }).strict(),
);

export class PostgresEvaluationAnalyticsRepository implements EvaluationAnalyticsRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }
  async query(filters: EvaluationAnalyticsFilter): Promise<readonly EvaluationAnalyticsSample[]> {
    const result = await this.#pool.query<EvaluationAnalyticsRow>(
      `SELECT ee.experience_id,ee.task_id,ee.instance_id,ee.skill_versions_json,ee.tools_json,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'serverId',m.server_id,'toolName',m.tool_name,'status',m.status,'durationMs',m.duration_ms)
                ORDER BY m.started_at,m.invocation_id)
                FROM mcp_invocation m WHERE m.task_id=ee.task_id),'[]'::jsonb) mcp_invocations_json,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'providerId',mi.provider_id,'model',mi.model,'status',mi.status,'durationMs',mi.duration_ms,
                'inputTokens',COALESCE(mi.input_tokens,0),'outputTokens',COALESCE(mi.output_tokens,0))
                ORDER BY mi.created_at,mi.invocation_id)
                FROM model_invocation mi WHERE mi.task_id=ee.task_id),'[]'::jsonb) model_invocations_json,
              ee.successful,ee.duration_ms,wi.budget_usage_json,wi.errors_json,
              ee.evaluation_json->>'decision' evaluation_decision,
              qr.report_id,qr.task_id report_task_id,qr.overall_score,qr.status quality_status,
              qr.created_at quality_created_at
       FROM evolution_experience ee
       JOIN workflow_instance wi ON wi.instance_id=ee.instance_id
       LEFT JOIN task_quality_report qr ON qr.workflow_instance_id=ee.instance_id
       WHERE ($1::text IS NULL OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(ee.skill_versions_json) skill
         WHERE skill->>'skillId'=$1
           AND ($2::integer IS NULL OR (skill->>'version')::integer=$2)))
         AND (($3::text IS NULL AND $4::text IS NULL) OR EXISTS (
           SELECT 1 FROM model_invocation mi WHERE mi.task_id=ee.task_id
             AND ($3::text IS NULL OR mi.provider_id=$3)
             AND ($4::text IS NULL OR mi.model=$4)))
         AND ($5::text IS NULL OR ee.tools_json @> jsonb_build_array(
           CASE WHEN $6::text IS NULL THEN jsonb_build_object('serverId',$5::text)
                ELSE jsonb_build_object('serverId',$5::text,'toolName',$6::text) END))
       ORDER BY ee.created_at,ee.experience_id`,
      [
        filters.skillId ?? null,
        filters.skillVersion ?? null,
        filters.providerId ?? null,
        filters.model ?? null,
        filters.serverId ?? null,
        filters.toolName ?? null,
      ],
    );
    return result.rows.map((row) => {
      const errors = AnalyticsErrorsSchema.parse(row.errors_json);
      const failureCodes = Object.values(errors).map((error) => error.code);
      if (!row.successful && failureCodes.length === 0)
        failureCodes.push(`goal_evaluation:${row.evaluation_decision}`);
      return {
        experienceId: row.experience_id,
        ...(row.task_id === null ? {} : { taskId: row.task_id }),
        instanceId: row.instance_id,
        skillVersions: AnalyticsSkillVersionsSchema.parse(row.skill_versions_json),
        tools: AnalyticsToolsSchema.parse(row.tools_json),
        mcpInvocations: AnalyticsMcpInvocationsSchema.parse(row.mcp_invocations_json),
        modelInvocations: AnalyticsModelInvocationsSchema.parse(row.model_invocations_json),
        successful: row.successful,
        durationMs: row.duration_ms,
        cost: AnalyticsBudgetSchema.parse(row.budget_usage_json).cost,
        failureCodes,
        ...(row.report_id === null ||
        row.report_task_id === null ||
        row.overall_score === null ||
        row.quality_status === null ||
        row.quality_created_at === null
          ? {}
          : {
              qualityReport: {
                reportId: row.report_id,
                taskId: row.report_task_id,
                overallScore: row.overall_score,
                status: row.quality_status,
                createdAt: toIsoString(row.quality_created_at),
              },
            }),
      };
    });
  }
}

interface MemoryItemRow extends QueryResultRow {
  memory_id: string;
  type: MemoryItem['type'];
  content_json: unknown;
  summary: string;
  status: MemoryItem['status'];
  source_refs_json: unknown;
  supersedes_json: unknown;
  confidence: number;
  durability: MemoryItem['durability'];
  authority: MemoryItem['authority'];
  durability_reason: string;
  created_at: Date | string;
  score?: number;
}

interface MemoryStatusTransitionRow extends QueryResultRow {
  transition_id: string;
  memory_id: string;
  from_status: MemoryStatusTransition['fromStatus'];
  to_status: MemoryStatusTransition['toStatus'];
  replacement_memory_id: string | null;
  actor: string;
  reason: string;
  created_at: Date | string;
}

const MemoryContentSchema = z.record(z.string(), z.unknown());

export class PostgresMemoryRepository implements MemoryRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async save(
    item: MemoryItem,
    embedding: Readonly<{ providerId: string; vector: readonly number[] }>,
  ): Promise<void> {
    await this.#pool.query(
      `INSERT INTO memory_item(
         memory_id,type,content_json,summary,status,source_refs_json,supersedes_json,confidence,
         durability,authority,durability_reason,
         embedding_provider_id,embedding_dimensions,embedding,created_at)
       VALUES($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14::vector,$15)`,
      [
        item.memoryId,
        item.type,
        JSON.stringify(item.content),
        item.summary,
        item.status,
        JSON.stringify(item.sourceRefs),
        JSON.stringify(item.supersedes),
        item.confidence,
        item.durability,
        item.authority,
        item.durabilityReason,
        embedding.providerId,
        embedding.vector.length,
        vectorLiteral(embedding.vector),
        item.createdAt,
      ],
    );
  }

  async find(memoryId: string): Promise<MemoryItem | undefined> {
    const result = await this.#pool.query<MemoryItemRow>(
      'SELECT * FROM memory_item WHERE memory_id=$1',
      [memoryId],
    );
    return result.rows[0] === undefined ? undefined : mapMemoryItemRow(result.rows[0]);
  }

  async search(
    query: Readonly<{ providerId: string; vector: readonly number[]; limit: number }>,
  ): Promise<readonly MemorySearchHit[]> {
    const result = await this.#pool.query<MemoryItemRow>(
      `SELECT *,GREATEST(0,LEAST(1,(2-(embedding <=> $1::vector))/2))::double precision score
       FROM memory_item
       WHERE status='active' AND durability='durable'
         AND embedding_provider_id=$2 AND embedding_dimensions=$3
       ORDER BY embedding <=> $1::vector,created_at DESC,memory_id LIMIT $4`,
      [vectorLiteral(query.vector), query.providerId, query.vector.length, query.limit],
    );
    return result.rows.map((row) => ({ item: mapMemoryItemRow(row), score: row.score ?? 0 }));
  }

  async saveAndSupersede(
    replacement: MemoryItem,
    embedding: Readonly<{ providerId: string; vector: readonly number[] }>,
    transitions: readonly MemoryStatusTransition[],
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO memory_item(
           memory_id,type,content_json,summary,status,source_refs_json,supersedes_json,confidence,
           durability,authority,durability_reason,
           embedding_provider_id,embedding_dimensions,embedding,created_at)
         VALUES($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14::vector,$15)`,
        [
          replacement.memoryId,
          replacement.type,
          JSON.stringify(replacement.content),
          replacement.summary,
          replacement.status,
          JSON.stringify(replacement.sourceRefs),
          JSON.stringify(replacement.supersedes),
          replacement.confidence,
          replacement.durability,
          replacement.authority,
          replacement.durabilityReason,
          embedding.providerId,
          embedding.vector.length,
          vectorLiteral(embedding.vector),
          replacement.createdAt,
        ],
      );
      for (const transition of transitions) {
        const updated = await client.query(
          `UPDATE memory_item SET status='superseded'
           WHERE memory_id=$1 AND status=$2`,
          [transition.memoryId, transition.fromStatus],
        );
        if (updated.rowCount !== 1) throw new Error('MEMORY_STATUS_CONFLICT');
        await insertMemoryTransition(client, transition);
      }
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async invalidate(transition: MemoryStatusTransition): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE memory_item SET status='invalid'
         WHERE memory_id=$1 AND status=$2 AND status<>'invalid'`,
        [transition.memoryId, transition.fromStatus],
      );
      if (updated.rowCount !== 1) throw new Error('MEMORY_STATUS_CONFLICT');
      await insertMemoryTransition(client, transition);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listTransitions(memoryId: string): Promise<readonly MemoryStatusTransition[]> {
    const result = await this.#pool.query<MemoryStatusTransitionRow>(
      `SELECT * FROM memory_status_transition
       WHERE memory_id=$1 ORDER BY created_at,transition_id`,
      [memoryId],
    );
    return result.rows.map(mapMemoryStatusTransitionRow);
  }
}

interface MemoryRetentionPolicyRow extends QueryResultRow {
  review_after_days: number;
  archive_after_days: number | null;
  delete_after_days: number | null;
  automatic_archive_enabled: boolean;
  automatic_delete_enabled: boolean;
  updated_at: Date | string;
}

export class PostgresMemoryRetentionPolicyRepository implements MemoryRetentionPolicyRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }
  async get(): Promise<MemoryRetentionPolicy> {
    const result = await this.#pool.query<MemoryRetentionPolicyRow>(
      'SELECT * FROM memory_retention_policy WHERE singleton=true',
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('MEMORY_RETENTION_POLICY_MISSING');
    return mapMemoryRetentionPolicyRow(row);
  }
  async update(policy: MemoryRetentionPolicy): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE memory_retention_policy SET
         review_after_days=$1,archive_after_days=$2,delete_after_days=$3,
         automatic_archive_enabled=$4,automatic_delete_enabled=$5,updated_at=$6
       WHERE singleton=true`,
      [
        policy.reviewAfterDays,
        policy.archiveAfterDays,
        policy.deleteAfterDays,
        policy.automaticArchiveEnabled,
        policy.automaticDeleteEnabled,
        policy.updatedAt,
      ],
    );
    if (result.rowCount !== 1) throw new Error('MEMORY_RETENTION_POLICY_MISSING');
  }
}

function mapMemoryRetentionPolicyRow(row: MemoryRetentionPolicyRow): MemoryRetentionPolicy {
  return {
    reviewAfterDays: row.review_after_days,
    archiveAfterDays: row.archive_after_days,
    deleteAfterDays: row.delete_after_days,
    automaticArchiveEnabled: row.automatic_archive_enabled,
    automaticDeleteEnabled: row.automatic_delete_enabled,
    updatedAt: toIsoString(row.updated_at),
  };
}

interface GoalInputInferenceRow extends QueryResultRow {
  inference_id: string;
  task_id: string;
  context_id: string;
  outcome: GoalInputInferenceRecord['outcome'];
  decision_summary: string;
  used_sources_json: unknown;
  inferred_goal_json: unknown;
  clarification_question: string | null;
  created_at: Date | string;
}

const GoalInferenceSourceSchema = z
  .object({
    sourceId: z.string().min(1),
    kind: z.enum(['conversation_history', 'global_memory', 'existing_data']),
    summary: z.string(),
    content: z.unknown(),
  })
  .strict();
const InferredGoalSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    constraints: z.array(z.string()),
    successCriteria: z.array(z.string()),
  })
  .strict();

export class PostgresGoalInputInferenceRepository implements GoalInputInferenceRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async collect(contextId: string, excludeTaskId: string, limit: number) {
    const history = await this.#pool.query<{
      task_id: string;
      request_text: string;
      phase: string;
      output_text: string | null;
      output_structured: unknown;
    }>(
      `SELECT task_id,request_text,phase,output_text,output_structured FROM agent_task
       WHERE context_id=$1 AND task_id<>$2 ORDER BY created_at DESC,task_id DESC LIMIT $3`,
      [contextId, excludeTaskId, limit],
    );
    const data = await this.#pool.query<{
      result_id: string;
      value_summary: string;
      output_json: unknown;
      facts_json: unknown;
    }>(
      `SELECT result_id,value_summary,output_json,facts_json FROM processed_result result
       JOIN agent_task task ON task.task_id=result.task_id
       WHERE task.context_id=$1 AND task.task_id<>$2
       ORDER BY result.created_at DESC,result.result_id DESC LIMIT $3`,
      [contextId, excludeTaskId, limit],
    );
    return {
      conversationHistory: history.rows.map<GoalInferenceSource>((row) => ({
        sourceId: `task:${row.task_id}`,
        kind: 'conversation_history',
        summary: `${row.phase}: ${row.request_text}`,
        content: {
          requestText: row.request_text,
          ...(row.output_text === null
            ? {}
            : { output: { text: row.output_text, structured: row.output_structured } }),
        },
      })),
      existingData: data.rows.map<GoalInferenceSource>((row) => ({
        sourceId: `result:${row.result_id}`,
        kind: 'existing_data',
        summary: row.value_summary,
        content: { output: row.output_json, facts: row.facts_json },
      })),
    };
  }

  async save(record: GoalInputInferenceRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO goal_input_inference(
         inference_id,task_id,context_id,outcome,decision_summary,used_sources_json,
         inferred_goal_json,clarification_question,created_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
      [
        record.inferenceId,
        record.taskId,
        record.contextId,
        record.outcome,
        record.decisionSummary,
        JSON.stringify(record.usedSources),
        record.inferredGoal === undefined ? null : JSON.stringify(record.inferredGoal),
        record.clarificationQuestion ?? null,
        record.createdAt,
      ],
    );
  }

  async listByTask(taskId: string): Promise<readonly GoalInputInferenceRecord[]> {
    const result = await this.#pool.query<GoalInputInferenceRow>(
      'SELECT * FROM goal_input_inference WHERE task_id=$1 ORDER BY created_at,inference_id',
      [taskId],
    );
    return result.rows.map(mapGoalInputInferenceRow);
  }
}

function mapGoalInputInferenceRow(row: GoalInputInferenceRow): GoalInputInferenceRecord {
  return {
    inferenceId: row.inference_id,
    taskId: row.task_id,
    contextId: row.context_id,
    outcome: row.outcome,
    decisionSummary: row.decision_summary,
    usedSources: z.array(GoalInferenceSourceSchema).parse(row.used_sources_json),
    ...(row.inferred_goal_json === null
      ? {}
      : { inferredGoal: InferredGoalSchema.parse(row.inferred_goal_json) }),
    ...(row.clarification_question === null
      ? {}
      : { clarificationQuestion: row.clarification_question }),
    createdAt: toIsoString(row.created_at),
  };
}

function mapMemoryItemRow(row: MemoryItemRow): MemoryItem {
  return createMemoryItem({
    memoryId: row.memory_id,
    type: row.type,
    content: MemoryContentSchema.parse(row.content_json),
    summary: row.summary,
    status: row.status,
    sourceRefs: StringArraySchema.parse(row.source_refs_json),
    supersedes: StringArraySchema.parse(row.supersedes_json),
    confidence: row.confidence,
    durability: row.durability,
    authority: row.authority,
    durabilityReason: row.durability_reason,
    createdAt: toIsoString(row.created_at),
  });
}

async function insertMemoryTransition(
  client: PoolClient,
  transition: MemoryStatusTransition,
): Promise<void> {
  await client.query(
    `INSERT INTO memory_status_transition(
       transition_id,memory_id,from_status,to_status,replacement_memory_id,actor,reason,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      transition.transitionId,
      transition.memoryId,
      transition.fromStatus,
      transition.toStatus,
      transition.replacementMemoryId ?? null,
      transition.actor,
      transition.reason,
      transition.createdAt,
    ],
  );
}

function mapMemoryStatusTransitionRow(row: MemoryStatusTransitionRow): MemoryStatusTransition {
  return {
    transitionId: row.transition_id,
    memoryId: row.memory_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    ...(row.replacement_memory_id === null
      ? {}
      : { replacementMemoryId: row.replacement_memory_id }),
    actor: row.actor,
    reason: row.reason,
    createdAt: toIsoString(row.created_at),
  };
}

function mapProcessedResultRow(row: ProcessedResultRow): ProcessedResultRecord {
  return {
    resultId: row.result_id,
    taskId: row.task_id,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    normalized: NormalizedResultSchema.parse(row.normalized_json),
    output: TaskOutputSchema.parse(row.output_json),
    facts: ResultFactsSchema.parse(row.facts_json),
    valuable: row.valuable,
    valueSummary: row.value_summary,
    memoryCandidates: ResultMemoryCandidatesSchema.parse(row.memory_candidates_json),
    createdAt: toIsoString(row.created_at),
  };
}

function mapGoalCancellationRow(row: GoalCancellationRow): GoalCancellationRecord {
  return {
    cancellationId: row.cancellation_id,
    goalId: row.goal_id,
    goalVersion: row.goal_version,
    reason: row.reason,
    canceledTaskIds: StringArraySchema.parse(row.canceled_task_ids_json),
    invalidatedPlanIds: StringArraySchema.parse(row.invalidated_plan_ids_json),
    canceledInstanceIds: StringArraySchema.parse(row.canceled_instance_ids_json),
    warnings: StringArraySchema.parse(row.warnings_json),
    createdAt: toIsoString(row.created_at),
  };
}

function mapGoalPatchRow(row: GoalPatchRow): GoalPatchRecord {
  const changes = GoalPatchChangesSchema.parse(row.changes_json);
  const beforeGoal = exactGoalSnapshot(row.before_goal_json);
  const afterGoal = exactGoalSnapshot(row.after_goal_json);
  return {
    patchId: row.patch_id,
    goalId: row.goal_id,
    ...(row.triggering_task_id === null ? {} : { triggeringTaskId: row.triggering_task_id }),
    fromVersion: row.from_version,
    toVersion: row.to_version,
    instruction: row.instruction,
    changes: {
      ...(changes.title === undefined ? {} : { title: changes.title }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
      ...(changes.constraints === undefined ? {} : { constraints: changes.constraints }),
      ...(changes.successCriteria === undefined
        ? {}
        : { successCriteria: changes.successCriteria }),
    },
    decisionSummary: row.decision_summary,
    compensationWarnings: StringArraySchema.parse(row.compensation_warnings_json),
    invalidatedPlanIds: StringArraySchema.parse(row.invalidated_plan_ids_json),
    invalidatedInstanceIds: StringArraySchema.parse(row.invalidated_instance_ids_json),
    newPlanId: row.new_plan_id,
    beforeGoal,
    afterGoal,
    createdAt: toIsoString(row.created_at),
  };
}

function exactGoalSnapshot(value: unknown): Goal {
  const goal = GoalSnapshotSchema.parse(value);
  return {
    goalId: goal.goalId,
    contextId: goal.contextId,
    version: goal.version,
    title: goal.title,
    description: goal.description,
    constraints: goal.constraints,
    successCriteria: goal.successCriteria,
    status: goal.status,
    ...(goal.previousGoalId === undefined ? {} : { previousGoalId: goal.previousGoalId }),
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

export class PostgresAgentTaskRepository implements AgentTaskRepository {
  readonly #pool: Pool;
  readonly #onTaskStateCommitted: TaskStateCommitted | undefined;

  constructor(pool: Pool, onTaskStateCommitted?: TaskStateCommitted) {
    this.#pool = pool;
    this.#onTaskStateCommitted = onTaskStateCommitted;
  }

  async findById(taskId: string): Promise<AgentTask | undefined> {
    const result = await this.#pool.query<TaskRow>(
      `SELECT task_id, context_id, user_id, request_text, request_metadata,
              phase, phase_message, goal_id, goal_version, plan_id,selected_skill_id,selected_skill_version,skill_selection_id,skill_input_resolution_id,temporary_skill_id,
              output_text, output_structured, capability_gap_json, error_code, created_at, updated_at
       FROM agent_task
       WHERE task_id = $1`,
      [taskId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapTaskRow(row);
  }

  async findByPlanId(planId: string): Promise<AgentTask | undefined> {
    const result = await this.#pool.query<TaskRow>(
      `SELECT task_id, context_id, user_id, request_text, request_metadata,
              phase, phase_message, goal_id, goal_version, plan_id,selected_skill_id,selected_skill_version,skill_selection_id,skill_input_resolution_id,temporary_skill_id,
              output_text, output_structured, capability_gap_json, error_code, created_at, updated_at
       FROM agent_task WHERE plan_id=$1 ORDER BY updated_at DESC, task_id DESC LIMIT 1`,
      [planId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapTaskRow(row);
  }

  async list(
    query: Readonly<{
      contextId?: string;
      goalId?: string;
      planId?: string;
      skillId?: string;
      phase?: AgentTask['phase'];
      limit: number;
    }>,
  ): Promise<readonly AgentTask[]> {
    const result = await this.#pool.query<TaskRow>(
      `SELECT task_id, context_id, user_id, request_text, request_metadata,
              phase, phase_message, goal_id, goal_version, plan_id,selected_skill_id,selected_skill_version,skill_selection_id,skill_input_resolution_id,temporary_skill_id,
              output_text, output_structured, capability_gap_json, error_code, created_at, updated_at
       FROM agent_task
       WHERE ($1::text IS NULL OR context_id=$1)
         AND ($2::text IS NULL OR phase=$2)
         AND ($4::text IS NULL OR plan_id=$4)
         AND ($5::text IS NULL OR goal_id=$5)
         AND ($6::text IS NULL OR selected_skill_id=$6)
       ORDER BY updated_at DESC,task_id DESC
       LIMIT $3`,
      [
        query.contextId ?? null,
        query.phase ?? null,
        query.limit,
        query.planId ?? null,
        query.goalId ?? null,
        query.skillId ?? null,
      ],
    );
    return result.rows.map(mapTaskRow);
  }

  async save(task: AgentTask): Promise<void> {
    const result = await this.#pool.query(
      `INSERT INTO agent_task (
         task_id, context_id, user_id, request_text, request_metadata,
         phase, phase_message, goal_id, goal_version, plan_id,selected_skill_id,selected_skill_version,skill_selection_id,skill_input_resolution_id,temporary_skill_id,
         output_text, output_structured, capability_gap_json, error_code, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       ON CONFLICT (task_id) DO UPDATE SET
         request_text = EXCLUDED.request_text,
         request_metadata = EXCLUDED.request_metadata,
         phase = EXCLUDED.phase,
         phase_message = EXCLUDED.phase_message,
         goal_id = EXCLUDED.goal_id,
         goal_version = EXCLUDED.goal_version,
         plan_id = EXCLUDED.plan_id,
         selected_skill_id = EXCLUDED.selected_skill_id,
         selected_skill_version = EXCLUDED.selected_skill_version,
         skill_selection_id = EXCLUDED.skill_selection_id,
         skill_input_resolution_id = EXCLUDED.skill_input_resolution_id,
         temporary_skill_id = EXCLUDED.temporary_skill_id,
         output_text = EXCLUDED.output_text,
         output_structured = EXCLUDED.output_structured,
         capability_gap_json = EXCLUDED.capability_gap_json,
         error_code = EXCLUDED.error_code,
         updated_at = EXCLUDED.updated_at
       WHERE agent_task.phase NOT IN ('capability_gap','completed','canceled','failed','invalidated')`,
      [
        task.taskId,
        task.contextId,
        task.userId,
        task.requestText,
        task.requestMetadata,
        task.phase,
        task.phaseMessage,
        task.goalId ?? null,
        task.goalVersion ?? null,
        task.planId ?? null,
        task.selectedSkillId ?? null,
        task.selectedSkillVersion ?? null,
        task.skillSelectionId ?? null,
        task.skillInputResolutionId ?? null,
        task.temporarySkillId ?? null,
        task.output?.text ?? null,
        task.output?.structured ?? null,
        task.capabilityGap ?? null,
        task.errorCode ?? null,
        task.createdAt,
        task.updatedAt,
      ],
    );
    if (result.rowCount === 0) throw new Error('TASK_TERMINAL_MUTATION_FORBIDDEN');
    this.#onTaskStateCommitted?.(task);
  }
}

export class PostgresTaskInputRepository implements TaskInputRepository {
  readonly #pool: Pool;
  readonly #onTaskStateCommitted: TaskStateCommitted | undefined;

  constructor(pool: Pool, onTaskStateCommitted?: TaskStateCommitted) {
    this.#pool = pool;
    this.#onTaskStateCommitted = onTaskStateCommitted;
  }

  async createRequest(request: TaskInputRequest): Promise<void> {
    await this.#pool.query(
      `INSERT INTO task_input_request(
         input_request_id,task_id,context_id,source,question,status,control_id,
         control_round_index,created_at,answered_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        request.inputRequestId,
        request.taskId,
        request.contextId,
        request.source,
        request.question,
        request.status,
        request.controlId ?? null,
        request.controlRoundIndex ?? null,
        request.createdAt,
        request.answeredAt ?? null,
      ],
    );
  }

  async findRequest(inputRequestId: string): Promise<TaskInputRequest | undefined> {
    const result = await this.#pool.query<TaskInputRequestRow>(
      'SELECT * FROM task_input_request WHERE input_request_id=$1',
      [inputRequestId],
    );
    return result.rows[0] === undefined ? undefined : mapTaskInputRequestRow(result.rows[0]);
  }

  async findPendingByTask(taskId: string): Promise<TaskInputRequest | undefined> {
    const result = await this.#pool.query<TaskInputRequestRow>(
      `SELECT * FROM task_input_request
       WHERE task_id=$1 AND status='waiting' ORDER BY created_at DESC,input_request_id DESC LIMIT 1`,
      [taskId],
    );
    return result.rows[0] === undefined ? undefined : mapTaskInputRequestRow(result.rows[0]);
  }

  async cancelPending(taskId: string, status: 'expired' | 'canceled'): Promise<void> {
    await this.#pool.query(
      `UPDATE task_input_request SET status=$2
       WHERE task_id=$1 AND status='waiting'`,
      [taskId, status],
    );
  }

  async listResponses(taskId: string): Promise<readonly TaskInputResponse[]> {
    const result = await this.#pool.query<TaskInputResponseRow>(
      'SELECT * FROM task_input_response WHERE task_id=$1 ORDER BY created_at,input_response_id',
      [taskId],
    );
    return result.rows.map(mapTaskInputResponseRow);
  }

  async createInitialAttempt(attempt: TaskExecutionAttempt): Promise<void> {
    await this.#insertAttempt(this.#pool, attempt);
  }

  async answerAndCreateAttempt(
    input: Readonly<{
      inputRequestId: string;
      taskId: string;
      response: TaskInputResponse;
      attempt: TaskExecutionAttempt;
      answeredAt: string;
      continuationPhase: 'goal_deliberation' | 'planning' | 'executing';
      phaseMessage: string;
    }>,
  ): Promise<AgentTask> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<TaskInputRequestRow>(
        'SELECT * FROM task_input_request WHERE input_request_id=$1 FOR UPDATE',
        [input.inputRequestId],
      );
      const request = selected.rows[0];
      if (request === undefined)
        throw new DomainError(
          'TASK_INPUT_REQUEST_NOT_FOUND',
          'The supplementary input request was not found.',
        );
      if (request.task_id !== input.taskId)
        throw new DomainError(
          'TASK_INPUT_REQUEST_TASK_MISMATCH',
          'The supplementary input request belongs to another Task.',
        );
      if (request.status !== 'waiting')
        throw new DomainError(
          'TASK_INPUT_REQUEST_NOT_WAITING',
          `The supplementary input request is ${request.status}.`,
        );
      const continuedTask = await client.query<TaskRow>(
        `UPDATE agent_task
         SET phase=$2,phase_message=$3,updated_at=$4,error_code=NULL
         WHERE task_id=$1 AND phase='awaiting_user_input'
         RETURNING *`,
        [input.taskId, input.continuationPhase, input.phaseMessage, input.answeredAt],
      );
      const taskRow = continuedTask.rows[0];
      if (taskRow === undefined)
        throw new DomainError(
          'TASK_INPUT_REQUEST_NOT_WAITING',
          'The Task is no longer awaiting supplementary input.',
        );
      await client.query(
        `UPDATE task_input_request SET status='answered',answered_at=$2
         WHERE input_request_id=$1`,
        [input.inputRequestId, input.answeredAt],
      );
      if (request.source === 'remote_task') {
        const linked = await client.query(
          `UPDATE remote_task_input_link SET status='answered',updated_at=$2
           WHERE input_request_id=$1 AND status='waiting'`,
          [input.inputRequestId, input.answeredAt],
        );
        if (linked.rowCount !== 1)
          throw new DomainError(
            'TASK_INPUT_REQUEST_NOT_WAITING',
            'The remote Task input link is no longer waiting.',
          );
      }
      await client.query(
        `INSERT INTO task_input_response(
           input_response_id,input_request_id,task_id,content_json,created_at)
         VALUES($1,$2,$3,$4::jsonb,$5)`,
        [
          input.response.inputResponseId,
          input.response.inputRequestId,
          input.response.taskId,
          JSON.stringify(input.response.content),
          input.response.createdAt,
        ],
      );
      await this.#insertAttempt(client, input.attempt);
      await client.query('COMMIT');
      const task = mapTaskRow(taskRow);
      this.#onTaskStateCommitted?.(task);
      return task;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listQueuedAttempts(limit: number): Promise<readonly TaskExecutionAttempt[]> {
    const result = await this.#pool.query<TaskExecutionAttemptRow>(
      `SELECT * FROM task_execution_attempt
       WHERE status='queued'
       ORDER BY created_at,attempt_id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapTaskExecutionAttemptRow);
  }

  async findAttempt(attemptId: string): Promise<TaskExecutionAttempt | undefined> {
    const result = await this.#pool.query<TaskExecutionAttemptRow>(
      'SELECT * FROM task_execution_attempt WHERE attempt_id=$1',
      [attemptId],
    );
    return result.rows[0] === undefined ? undefined : mapTaskExecutionAttemptRow(result.rows[0]);
  }

  async findResponseForAttempt(attemptId: string) {
    const result = await this.#pool.query<TaskInputRequestRow & TaskInputResponseRow>(
      `SELECT request.*,response.input_response_id,response.content_json,response.created_at AS response_created_at
       FROM task_execution_attempt AS attempt
       JOIN task_input_request AS request ON request.input_request_id=attempt.input_request_id
       JOIN task_input_response AS response ON response.input_request_id=request.input_request_id
       WHERE attempt.attempt_id=$1`,
      [attemptId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      request: mapTaskInputRequestRow(row),
      response: {
        inputResponseId: row.input_response_id,
        inputRequestId: row.input_request_id,
        taskId: row.task_id,
        content: row.content_json,
        createdAt: toIsoString(
          (row as unknown as Readonly<{ response_created_at: Date | string }>).response_created_at,
        ),
      },
    };
  }

  async updateAttempt(
    attemptId: string,
    status: Exclude<TaskExecutionAttempt['status'], 'queued'>,
    timestamp: string,
    errorCode?: string,
  ): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE task_execution_attempt SET
         status=$2,
         started_at=CASE WHEN $2='running' THEN $3 ELSE COALESCE(started_at,$3) END,
         completed_at=CASE WHEN $2 IN ('completed','failed') THEN $3 ELSE NULL END,
         error_code=$4
       WHERE attempt_id=$1 AND (
         (status='queued' AND $2 IN ('running','failed')) OR
         (status='running' AND $2 IN ('completed','failed')) OR
         status=$2
       )`,
      [attemptId, status, timestamp, errorCode ?? null],
    );
    if (result.rowCount === 0) throw new Error('TASK_ATTEMPT_TRANSITION_INVALID');
  }

  async #insertAttempt(
    client: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    attempt: TaskExecutionAttempt,
  ) {
    await client.query(
      `INSERT INTO task_execution_attempt(
         attempt_id,task_id,context_id,reason,status,input_request_id,created_at,
         started_at,completed_at,error_code)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        attempt.attemptId,
        attempt.taskId,
        attempt.contextId,
        attempt.reason,
        attempt.status,
        attempt.inputRequestId ?? null,
        attempt.createdAt,
        attempt.startedAt ?? null,
        attempt.completedAt ?? null,
        attempt.errorCode ?? null,
      ],
    );
  }
}

function mapTaskInputRequestRow(row: TaskInputRequestRow): TaskInputRequest {
  return {
    inputRequestId: row.input_request_id,
    taskId: row.task_id,
    contextId: row.context_id,
    source: row.source,
    question: row.question,
    status: row.status,
    ...(row.control_id === null ? {} : { controlId: row.control_id }),
    ...(row.control_round_index === null ? {} : { controlRoundIndex: row.control_round_index }),
    createdAt: toIsoString(row.created_at),
    ...(row.answered_at === null ? {} : { answeredAt: toIsoString(row.answered_at) }),
  };
}

function mapTaskInputResponseRow(row: TaskInputResponseRow): TaskInputResponse {
  return {
    inputResponseId: row.input_response_id,
    inputRequestId: row.input_request_id,
    taskId: row.task_id,
    content: row.content_json,
    createdAt: toIsoString(row.created_at),
  };
}

function mapTaskExecutionAttemptRow(row: TaskExecutionAttemptRow): TaskExecutionAttempt {
  return {
    attemptId: row.attempt_id,
    taskId: row.task_id,
    contextId: row.context_id,
    reason: row.reason,
    status: row.status,
    ...(row.input_request_id === null ? {} : { inputRequestId: row.input_request_id }),
    createdAt: toIsoString(row.created_at),
    ...(row.started_at === null ? {} : { startedAt: toIsoString(row.started_at) }),
    ...(row.completed_at === null ? {} : { completedAt: toIsoString(row.completed_at) }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
  };
}

interface ImplicitFeedbackRow extends QueryResultRow {
  feedback_id: string;
  kind: ImplicitFeedbackRecord['kind'];
  source_task_id: string;
  trigger_task_id: string;
  context_id: string;
  confidence: number;
  evidence_summary: string;
  created_at: Date | string;
}

export class PostgresImplicitFeedbackRepository implements ImplicitFeedbackRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }
  async findPreviousTerminal(contextId: string, excludeTaskId: string) {
    const result = await this.#pool.query<TaskRow>(
      `SELECT * FROM agent_task
       WHERE context_id=$1 AND task_id<>$2
         AND phase IN ('capability_gap','completed','canceled','failed','invalidated')
       ORDER BY updated_at DESC,task_id DESC LIMIT 1`,
      [contextId, excludeTaskId],
    );
    return result.rows[0] === undefined ? undefined : mapTaskRow(result.rows[0]);
  }
  async save(record: ImplicitFeedbackRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO implicit_feedback(
         feedback_id,kind,source_task_id,trigger_task_id,context_id,confidence,evidence_summary,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        record.feedbackId,
        record.kind,
        record.sourceTaskId,
        record.triggerTaskId,
        record.contextId,
        record.confidence,
        record.evidenceSummary,
        record.createdAt,
      ],
    );
  }
  async listByTask(taskId: string): Promise<readonly ImplicitFeedbackRecord[]> {
    const result = await this.#pool.query<ImplicitFeedbackRow>(
      `SELECT * FROM implicit_feedback
       WHERE source_task_id=$1 OR trigger_task_id=$1 ORDER BY created_at,feedback_id`,
      [taskId],
    );
    return result.rows.map((row) => ({
      feedbackId: row.feedback_id,
      kind: row.kind,
      sourceTaskId: row.source_task_id,
      triggerTaskId: row.trigger_task_id,
      contextId: row.context_id,
      confidence: row.confidence,
      evidenceSummary: row.evidence_summary,
      createdAt: toIsoString(row.created_at),
    }));
  }
}

export class PostgresTaskWaitPolicyRepository implements TaskWaitPolicyRepository {
  readonly #pool: Pool;
  readonly #onTaskStateCommitted: TaskStateCommitted | undefined;

  constructor(pool: Pool, onTaskStateCommitted?: TaskStateCommitted) {
    this.#pool = pool;
    this.#onTaskStateCommitted = onTaskStateCommitted;
  }

  async get(): Promise<TaskWaitPolicy> {
    const result = await this.#pool.query<{ timeout_seconds: number; updated_at: Date | string }>(
      'SELECT timeout_seconds,updated_at FROM task_wait_policy WHERE singleton=true',
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('TASK_WAIT_POLICY_NOT_CONFIGURED');
    return { timeoutSeconds: row.timeout_seconds, updatedAt: toIsoString(row.updated_at) };
  }

  async update(policy: TaskWaitPolicy): Promise<void> {
    await this.#pool.query(
      `INSERT INTO task_wait_policy(singleton,timeout_seconds,updated_at) VALUES(true,$1,$2)
       ON CONFLICT(singleton) DO UPDATE SET timeout_seconds=EXCLUDED.timeout_seconds,updated_at=EXCLUDED.updated_at`,
      [policy.timeoutSeconds, policy.updatedAt],
    );
  }

  async expireWaiting(cutoff: string, timestamp: string): Promise<readonly AgentTask[]> {
    const result = await this.#pool.query<TaskRow>(
      `WITH expired AS (
         UPDATE agent_task SET phase='canceled',phase_message='Task canceled after the unified wait timeout.',
           error_code='TASK_WAIT_TIMEOUT',updated_at=$2
         WHERE phase IN ('awaiting_plan_confirmation','awaiting_user_input') AND updated_at <= $1
         RETURNING *
       ), input_requests AS (
         UPDATE task_input_request SET status='expired'
         WHERE task_id IN (SELECT task_id FROM expired) AND status='waiting'
       ), events AS (
         INSERT INTO runtime_event(event_id,task_id,context_id,event_type,event_timestamp,summary)
         SELECT concat('event-wait-timeout-',task_id,'-',extract(epoch from $2::timestamptz)::bigint),
           task_id,context_id,'task.phase_changed',$2,'Task canceled after the unified wait timeout.'
         FROM expired ON CONFLICT(event_id) DO NOTHING
       )
       SELECT task_id,context_id,user_id,request_text,request_metadata,phase,phase_message,
         goal_id,goal_version,plan_id,selected_skill_id,selected_skill_version,skill_selection_id,skill_input_resolution_id,temporary_skill_id,output_text,output_structured,capability_gap_json,error_code,created_at,updated_at
       FROM expired ORDER BY task_id`,
      [cutoff, timestamp],
    );
    const expired = result.rows.map(mapTaskRow);
    for (const task of expired) this.#onTaskStateCommitted?.(task);
    return expired;
  }
}

export class PostgresEvolutionPolicyRepository implements EvolutionPolicyRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async get(): Promise<EvolutionPolicy> {
    const result = await this.#pool.query<{
      success_threshold: number;
      updated_at: Date | string;
    }>('SELECT success_threshold,updated_at FROM evolution_policy WHERE singleton=true');
    const row = result.rows[0];
    if (row === undefined) throw new Error('EVOLUTION_POLICY_NOT_CONFIGURED');
    return { successThreshold: row.success_threshold, updatedAt: toIsoString(row.updated_at) };
  }

  async update(policy: EvolutionPolicy): Promise<void> {
    await this.#pool.query(
      `INSERT INTO evolution_policy(singleton,success_threshold,updated_at) VALUES(true,$1,$2)
       ON CONFLICT(singleton) DO UPDATE SET
         success_threshold=EXCLUDED.success_threshold,updated_at=EXCLUDED.updated_at`,
      [policy.successThreshold, policy.updatedAt],
    );
  }

  async saveTrigger(trigger: EvolutionTriggerRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO evolution_trigger
         (trigger_id,capability_fingerprint,experience_id,successful_experience_count,
          configured_threshold,decision,candidate_id,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        trigger.triggerId,
        trigger.capabilityFingerprint,
        trigger.experienceId,
        trigger.successfulExperienceCount,
        trigger.configuredThreshold,
        trigger.decision,
        trigger.candidateId ?? null,
        trigger.createdAt,
      ],
    );
  }

  async listTriggers(capabilityFingerprint?: string): Promise<readonly EvolutionTriggerRecord[]> {
    const result = await this.#pool.query<EvolutionTriggerRow>(
      `SELECT trigger_id,capability_fingerprint,experience_id,successful_experience_count,
              configured_threshold,decision,candidate_id,created_at
       FROM evolution_trigger
       WHERE $1::text IS NULL OR capability_fingerprint=$1
       ORDER BY created_at,trigger_id`,
      [capabilityFingerprint ?? null],
    );
    return result.rows.map((row) => ({
      triggerId: row.trigger_id,
      capabilityFingerprint: row.capability_fingerprint,
      experienceId: row.experience_id,
      successfulExperienceCount: row.successful_experience_count,
      configuredThreshold: row.configured_threshold,
      decision: row.decision,
      ...(row.candidate_id === null ? {} : { candidateId: row.candidate_id }),
      createdAt: toIsoString(row.created_at),
    }));
  }
}

export class PostgresRuntimeEventPublisher implements RuntimeEventPublisher {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async publish(event: RuntimeTaskEvent): Promise<void> {
    await this.#pool.query(
      `INSERT INTO runtime_event (
         event_id, task_id, context_id, event_type, event_timestamp, summary
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.eventId,
        event.taskId,
        event.contextId,
        event.eventType,
        event.timestamp,
        event.summary,
      ],
    );
  }

  async listByTask(taskId: string): Promise<readonly RuntimeTaskEvent[]> {
    const result = await this.#pool.query<{
      event_id: string;
      task_id: string;
      context_id: string;
      event_type: RuntimeTaskEvent['eventType'];
      event_timestamp: Date | string;
      summary: string;
    }>(
      `SELECT event_id, task_id, context_id, event_type, event_timestamp, summary
       FROM runtime_event WHERE task_id=$1 ORDER BY event_timestamp, event_id`,
      [taskId],
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      taskId: row.task_id,
      contextId: row.context_id,
      eventType: row.event_type,
      timestamp: toIsoString(row.event_timestamp),
      summary: row.summary,
    }));
  }
}

export class PostgresExternalTaskProjectionRepository implements ExternalTaskProjectionRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async find(
    protocol: ExternalTaskProjection['protocol'],
    taskId: string,
  ): Promise<ExternalTaskProjection | undefined> {
    const result = await this.#pool.query<ProjectionRow>(
      `SELECT protocol, task_id, context_id, state, status_timestamp, document_json
       FROM external_task_projection WHERE protocol = $1 AND task_id = $2`,
      [protocol, taskId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapProjectionRow(row);
  }

  async save(projection: ExternalTaskProjection): Promise<void> {
    await this.#pool.query(
      `INSERT INTO external_task_projection
         (protocol, task_id, context_id, state, status_timestamp, document_json)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (protocol, task_id) DO UPDATE SET
         context_id = EXCLUDED.context_id, state = EXCLUDED.state,
         status_timestamp = EXCLUDED.status_timestamp,
         document_json = EXCLUDED.document_json, updated_at = clock_timestamp()`,
      [
        projection.protocol,
        projection.taskId,
        projection.contextId,
        projection.state,
        projection.statusTimestamp ?? null,
        projection.document,
      ],
    );
  }

  async list(
    query: ExternalTaskProjectionQuery,
  ): Promise<Readonly<{ items: readonly ExternalTaskProjection[]; total: number }>> {
    const result = await this.#pool.query<ProjectionRow>(
      `SELECT protocol, task_id, context_id, state, status_timestamp, document_json,
              count(*) OVER()::text AS total_count
       FROM external_task_projection
       WHERE protocol = $1
         AND ($2::text IS NULL OR context_id = $2)
         AND ($3::text IS NULL OR state = $3)
         AND ($4::timestamptz IS NULL OR status_timestamp >= $4)
       ORDER BY status_timestamp DESC NULLS LAST, task_id
       OFFSET $5 LIMIT $6`,
      [
        query.protocol,
        query.contextId ?? null,
        query.state ?? null,
        query.statusTimestampAfter ?? null,
        query.offset,
        query.limit,
      ],
    );
    return {
      items: result.rows.map(mapProjectionRow),
      total: Number(result.rows[0]?.total_count ?? 0),
    };
  }
}

export class PostgresSkillRepository implements SkillRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async find(skillId: string): Promise<Skill | undefined> {
    const result = await this.#pool.query<SkillRow>(
      `SELECT skill_id, current_version, created_at, updated_at FROM skill WHERE skill_id = $1`,
      [skillId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          skillId: row.skill_id,
          currentVersion: row.current_version,
          createdAt: toIsoString(row.created_at),
          updatedAt: toIsoString(row.updated_at),
        };
  }

  async findCurrentVersion(skillId: string): Promise<SkillVersion | undefined> {
    const result = await this.#pool.query<SkillVersionRow>(
      `${skillVersionSelect}
       JOIN skill s ON s.skill_id = v.skill_id AND s.current_version = v.version
       WHERE v.skill_id = $1`,
      [skillId],
    );
    return result.rows[0] === undefined ? undefined : mapSkillVersionRow(result.rows[0]);
  }

  async findVersion(skillId: string, version: number): Promise<SkillVersion | undefined> {
    const result = await this.#pool.query<SkillVersionRow>(
      `${skillVersionSelect} WHERE v.skill_id = $1 AND v.version = $2`,
      [skillId, version],
    );
    return result.rows[0] === undefined ? undefined : mapSkillVersionRow(result.rows[0]);
  }

  async listVersions(skillId: string): Promise<readonly SkillVersion[]> {
    const result = await this.#pool.query<SkillVersionRow>(
      `${skillVersionSelect} WHERE v.skill_id = $1 ORDER BY v.version`,
      [skillId],
    );
    return result.rows.map(mapSkillVersionRow);
  }

  async listEnabledVersions(): Promise<readonly SkillVersion[]> {
    const result = await this.#pool.query<SkillVersionRow>(
      `${skillVersionSelect}
       JOIN skill s ON s.skill_id = v.skill_id AND s.current_version = v.version
       WHERE v.status = 'enabled' ORDER BY v.skill_id`,
    );
    return result.rows.map(mapSkillVersionRow);
  }

  async listCurrentVersions(): Promise<readonly SkillVersion[]> {
    const result = await this.#pool.query<SkillVersionRow>(
      `${skillVersionSelect}
       JOIN skill s ON s.skill_id = v.skill_id AND s.current_version = v.version
       ORDER BY v.skill_id`,
    );
    return result.rows.map(mapSkillVersionRow);
  }

  async saveVersionAndSetCurrent(version: SkillVersion, timestamp: string): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO skill (skill_id, current_version, created_at, updated_at)
         VALUES ($1, $2, $3, $3) ON CONFLICT (skill_id) DO NOTHING`,
        [version.skillId, version.version, timestamp],
      );
      await client.query(
        `INSERT INTO skill_version (
           skill_id, version, name, summary, description, capabilities_json,
           workflow_guidance, output_instruction, input_schema_json, output_schema_json,
           tool_policy_json, runtime_policy_json, status, source_kind,
           validation_passed, previous_version, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          version.skillId,
          version.version,
          version.name,
          version.summary,
          version.description,
          JSON.stringify(version.capabilities),
          version.workflowGuidance,
          version.outputInstruction,
          JSON.stringify(version.inputSchema),
          JSON.stringify(version.outputSchema),
          JSON.stringify(version.toolPolicy),
          JSON.stringify(version.runtimePolicy),
          version.status,
          version.sourceKind,
          version.validationPassed,
          version.previousVersion ?? null,
          version.createdAt,
        ],
      );
      await client.query(
        `UPDATE skill SET current_version = $2, updated_at = $3 WHERE skill_id = $1`,
        [version.skillId, version.version, timestamp],
      );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresSkillGraphRepository implements SkillGraphRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listRelations(): Promise<readonly SkillRelation[]> {
    const result = await this.#pool.query<SkillRelationRow>(
      `SELECT relation_id, source_skill_id, target_skill_id, relation_type,
              metadata_json, created_at
       FROM skill_relation ORDER BY relation_type, source_skill_id, target_skill_id`,
    );
    return result.rows.map((row) => ({
      relationId: row.relation_id,
      sourceSkillId: row.source_skill_id,
      targetSkillId: row.target_skill_id,
      relationType: row.relation_type,
      metadata: row.metadata_json,
      createdAt: toIsoString(row.created_at),
    }));
  }

  async listRelationsFrom(
    sourceSkillId: string,
    relationTypes: readonly SkillRelation['relationType'][],
    limit: number,
  ): Promise<readonly SkillRelation[]> {
    const result = await this.#pool.query<SkillRelationRow>(
      `SELECT relation_id, source_skill_id, target_skill_id, relation_type,
              metadata_json, created_at
       FROM skill_relation WHERE source_skill_id=$1 AND relation_type=ANY($2::text[])
       ORDER BY relation_type, target_skill_id, relation_id LIMIT $3`,
      [sourceSkillId, relationTypes, limit],
    );
    return result.rows.map((row) => ({
      relationId: row.relation_id,
      sourceSkillId: row.source_skill_id,
      targetSkillId: row.target_skill_id,
      relationType: row.relation_type,
      metadata: row.metadata_json,
      createdAt: toIsoString(row.created_at),
    }));
  }

  async saveRelation(relation: SkillRelation): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_relation
         (relation_id, source_skill_id, target_skill_id, relation_type, metadata_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        relation.relationId,
        relation.sourceSkillId,
        relation.targetSkillId,
        relation.relationType,
        JSON.stringify(relation.metadata),
        relation.createdAt,
      ],
    );
  }

  async deleteRelation(relationId: string): Promise<void> {
    await this.#pool.query('DELETE FROM skill_relation WHERE relation_id = $1', [relationId]);
  }
}

export class PostgresSkillQualityRepository implements SkillQualityRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async saveObservation(observation: SkillQualityObservation): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_quality_observation
         (observation_id,skill_id,skill_version,evaluation_ref,score,successful,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        observation.observationId,
        observation.skillId,
        observation.skillVersion,
        observation.evaluationRef,
        observation.score,
        observation.successful,
        observation.createdAt,
      ],
    );
  }

  async listRecentObservations(
    skillId: string,
    skillVersion: number,
    limit: number,
  ): Promise<readonly SkillQualityObservation[]> {
    const result = await this.#pool.query<SkillQualityObservationRow>(
      `SELECT observation_id,skill_id,skill_version,evaluation_ref,score,successful,created_at
       FROM skill_quality_observation WHERE skill_id=$1 AND skill_version=$2
       ORDER BY created_at DESC,observation_id DESC LIMIT $3`,
      [skillId, skillVersion, limit],
    );
    return result.rows.map(mapSkillQualityObservationRow);
  }

  async findActiveWarning(
    skillId: string,
    skillVersion: number,
    kind: SkillQualityWarning['kind'],
  ): Promise<SkillQualityWarning | undefined> {
    const result = await this.#pool.query<SkillQualityWarningRow>(
      `SELECT warning_id,skill_id,skill_version,kind,observation_ids_json,observed_value,
              threshold,summary,status,skill_status_at_creation,created_at
       FROM skill_quality_warning
       WHERE skill_id=$1 AND skill_version=$2 AND kind=$3 AND status='active'`,
      [skillId, skillVersion, kind],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapSkillQualityWarningRow(row);
  }

  async saveWarning(warning: SkillQualityWarning): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_quality_warning
         (warning_id,skill_id,skill_version,kind,observation_ids_json,observed_value,
          threshold,summary,status,skill_status_at_creation,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        warning.warningId,
        warning.skillId,
        warning.skillVersion,
        warning.kind,
        JSON.stringify(warning.observationIds),
        warning.observedValue,
        warning.threshold,
        warning.summary,
        warning.status,
        warning.skillStatusAtCreation,
        warning.createdAt,
      ],
    );
  }

  async listWarnings(skillId?: string): Promise<readonly SkillQualityWarning[]> {
    const result = await this.#pool.query<SkillQualityWarningRow>(
      `SELECT warning_id,skill_id,skill_version,kind,observation_ids_json,observed_value,
              threshold,summary,status,skill_status_at_creation,created_at
       FROM skill_quality_warning WHERE ($1::text IS NULL OR skill_id=$1)
       ORDER BY created_at DESC,warning_id DESC`,
      [skillId ?? null],
    );
    return result.rows.map(mapSkillQualityWarningRow);
  }
}

export class PostgresSkillSelectionRepository implements SkillSelectionRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findMetrics(skillId: string): Promise<SkillPerformanceMetrics | undefined> {
    const result = await this.#pool.query<SkillMetricsRow>(
      `SELECT sample_count, success_rate, average_duration_ms, average_cost,
              failure_count, stability_score
       FROM skill_performance_metrics WHERE skill_id = $1`,
      [skillId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          sampleCount: row.sample_count,
          successRate: row.success_rate,
          averageDurationMs: row.average_duration_ms,
          averageCost: row.average_cost,
          failureCount: row.failure_count,
          stabilityScore: row.stability_score,
        };
  }

  async saveMetrics(
    skillId: string,
    metrics: SkillPerformanceMetrics,
    updatedAt: string,
  ): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_performance_metrics
         (skill_id, sample_count, success_rate, average_duration_ms, average_cost,
          failure_count, stability_score, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (skill_id) DO UPDATE SET
         sample_count = EXCLUDED.sample_count, success_rate = EXCLUDED.success_rate,
         average_duration_ms = EXCLUDED.average_duration_ms,
         average_cost = EXCLUDED.average_cost, failure_count = EXCLUDED.failure_count,
         stability_score = EXCLUDED.stability_score, updated_at = EXCLUDED.updated_at`,
      [
        skillId,
        metrics.sampleCount,
        metrics.successRate,
        metrics.averageDurationMs,
        metrics.averageCost,
        metrics.failureCount,
        metrics.stabilityScore,
        updatedAt,
      ],
    );
  }

  async saveSelection(record: SkillSelectionRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_selection_record
         (selection_id, goal_contract_json, goal_description, candidates_json, selected_skill_id,
          selected_skill_version, decision_summary, created_at)
       VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8)`,
      [
        record.selectionId,
        JSON.stringify(record.goalContract),
        record.goalDescription,
        JSON.stringify(record.candidates),
        record.selectedSkillId,
        record.selectedSkillVersion,
        record.decisionSummary,
        record.createdAt,
      ],
    );
  }

  async findSelection(selectionId: string): Promise<SkillSelectionRecord | undefined> {
    const result = await this.#pool.query<SkillSelectionRow>(
      `SELECT selection_id, goal_contract_json, goal_description, candidates_json,
              selected_skill_id, selected_skill_version, decision_summary, created_at
       FROM skill_selection_record WHERE selection_id = $1`,
      [selectionId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapSkillSelectionRow(row);
  }

  async saveReplacementPlan(plan: SkillReplacementPlan): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_replacement_plan
         (replacement_plan_id, selection_id, goal_contract_json, failed_skill_id, candidates_json,
          replacement_skill_id, replacement_skill_version, decision_summary, status, created_at)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10)`,
      [
        plan.replacementPlanId,
        plan.selectionId,
        JSON.stringify(plan.goalContract),
        plan.failedSkillId,
        JSON.stringify(plan.candidates),
        plan.replacementSkillId,
        plan.replacementSkillVersion,
        plan.decisionSummary,
        plan.status,
        plan.createdAt,
      ],
    );
  }
}

interface ModelProviderRow extends QueryResultRow {
  provider_id: string;
  name: string;
  kind: 'openai_compatible' | 'local' | 'other_vendor';
  api_style: ModelProviderConfiguration['apiStyle'];
  base_url: string;
  model: string;
  enabled: boolean;
  timeout_ms: number;
  encrypted_credential: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ModelInvocationRow extends QueryResultRow {
  invocation_id: string;
  task_id: string | null;
  stage: ModelStage;
  provider_id: string;
  model: string;
  operation: ModelInvocationRecord['operation'];
  prompt_id: string | null;
  prompt_version: number | null;
  request_json: unknown;
  context_json: unknown;
  raw_response_json: unknown;
  structured_result_json: unknown;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number;
  status: ModelInvocationRecord['status'];
  error_code: string | null;
  error_message: string | null;
  created_at: Date | string;
}

interface StageModelRouteRow extends QueryResultRow {
  stage: ModelStage;
  provider_id: string;
  updated_at: Date | string;
}

export class PostgresModelRuntimeRepository implements ModelRuntimeRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findProvider(providerId: string): Promise<ModelProviderRecord | undefined> {
    const result = await this.#pool.query<ModelProviderRow>(
      'SELECT * FROM model_provider WHERE provider_id = $1',
      [providerId],
    );
    return result.rows[0] === undefined ? undefined : mapModelProviderRow(result.rows[0]);
  }

  async findProviderForStage(stage: ModelStage): Promise<ModelProviderRecord | undefined> {
    const result = await this.#pool.query<ModelProviderRow>(
      `SELECT p.* FROM stage_model_route r
       JOIN model_provider p ON p.provider_id = r.provider_id
       WHERE r.stage = $1`,
      [stage],
    );
    return result.rows[0] === undefined ? undefined : mapModelProviderRow(result.rows[0]);
  }

  async listProviders(): Promise<readonly ModelProviderConfiguration[]> {
    const result = await this.#pool.query<ModelProviderRow>(
      'SELECT * FROM model_provider ORDER BY provider_id',
    );
    return result.rows.map((row) => mapModelProviderRow(row).configuration);
  }

  async listStageRoutes(): Promise<readonly StageModelRoute[]> {
    const result = await this.#pool.query<StageModelRouteRow>(
      'SELECT stage,provider_id,updated_at FROM stage_model_route ORDER BY stage',
    );
    return result.rows.map((row) => ({
      stage: row.stage,
      providerId: row.provider_id,
      updatedAt: toIsoString(row.updated_at),
    }));
  }

  async saveProvider(record: ModelProviderRecord): Promise<void> {
    const value = record.configuration;
    await this.#pool.query(
      `INSERT INTO model_provider
       (provider_id,name,kind,api_style,base_url,model,enabled,timeout_ms,encrypted_credential,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (provider_id) DO UPDATE SET
         name=EXCLUDED.name, kind=EXCLUDED.kind, api_style=EXCLUDED.api_style, base_url=EXCLUDED.base_url,
         model=EXCLUDED.model, enabled=EXCLUDED.enabled, timeout_ms=EXCLUDED.timeout_ms,
         encrypted_credential=EXCLUDED.encrypted_credential, updated_at=EXCLUDED.updated_at`,
      [
        value.providerId,
        value.name,
        value.kind,
        value.apiStyle,
        value.baseUrl,
        value.model,
        value.enabled,
        value.timeoutMs,
        record.encryptedCredential,
        value.createdAt,
        value.updatedAt,
      ],
    );
  }

  async saveStageRoute(stage: ModelStage, providerId: string, updatedAt: string): Promise<void> {
    await this.#pool.query(
      `INSERT INTO stage_model_route(stage,provider_id,updated_at) VALUES ($1,$2,$3)
       ON CONFLICT(stage) DO UPDATE SET provider_id=EXCLUDED.provider_id, updated_at=EXCLUDED.updated_at`,
      [stage, providerId, updatedAt],
    );
  }

  async saveInvocation(invocation: ModelInvocationRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO model_invocation
       (invocation_id,task_id,stage,provider_id,model,operation,prompt_id,prompt_version,request_json,context_json,raw_response_json,
        structured_result_json,input_tokens,output_tokens,duration_ms,status,error_code,error_message,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19)`,
      [
        invocation.invocationId,
        invocation.taskId ?? null,
        invocation.stage,
        invocation.providerId,
        invocation.model,
        invocation.operation,
        invocation.promptId ?? null,
        invocation.promptVersion ?? null,
        JSON.stringify(invocation.request),
        JSON.stringify(invocation.context),
        invocation.rawResponse === undefined ? null : JSON.stringify(invocation.rawResponse),
        invocation.structuredResult === undefined
          ? null
          : JSON.stringify(invocation.structuredResult),
        invocation.inputTokens ?? null,
        invocation.outputTokens ?? null,
        invocation.durationMs,
        invocation.status,
        invocation.errorCode ?? null,
        invocation.errorMessage ?? null,
        invocation.createdAt,
      ],
    );
  }

  async listInvocations(stage?: ModelStage): Promise<readonly ModelInvocationRecord[]> {
    const result = await this.#pool.query<ModelInvocationRow>(
      `SELECT * FROM model_invocation WHERE ($1::text IS NULL OR stage = $1) ORDER BY created_at, invocation_id`,
      [stage ?? null],
    );
    return result.rows.map(mapModelInvocationRow);
  }

  async listInvocationsByTask(taskId: string): Promise<readonly ModelInvocationRecord[]> {
    const result = await this.#pool.query<ModelInvocationRow>(
      'SELECT * FROM model_invocation WHERE task_id=$1 ORDER BY created_at, invocation_id',
      [taskId],
    );
    return result.rows.map(mapModelInvocationRow);
  }

  async findActivePromptForStage(stage: ModelStage): Promise<PromptVersion | undefined> {
    return findActivePrompt(this.#pool, stage);
  }
}

interface PromptVersionRow extends QueryResultRow {
  prompt_id: string;
  stage: ModelStage;
  version: number;
  previous_version: number | null;
  content: string;
  status: PromptVersion['status'];
  source: PromptVersion['source'];
  created_at: Date | string;
}

export class PostgresPromptRepository implements PromptRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }
  findCurrent(stage: ModelStage): Promise<PromptVersion | undefined> {
    return findActivePrompt(this.#pool, stage);
  }
  async findVersion(promptId: string, version: number): Promise<PromptVersion | undefined> {
    const result = await this.#pool.query<PromptVersionRow>(
      'SELECT * FROM prompt_version WHERE prompt_id=$1 AND version=$2',
      [promptId, version],
    );
    return result.rows[0] === undefined ? undefined : mapPromptVersionRow(result.rows[0]);
  }
  async listVersions(promptId: string): Promise<readonly PromptVersion[]> {
    const result = await this.#pool.query<PromptVersionRow>(
      'SELECT * FROM prompt_version WHERE prompt_id=$1 ORDER BY version',
      [promptId],
    );
    return result.rows.map(mapPromptVersionRow);
  }
  async saveVersion(version: PromptVersion, setCurrent: boolean): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO prompt(prompt_id,stage,current_version,created_at,updated_at) VALUES($1,$2,NULL,$3,$3)
         ON CONFLICT(prompt_id) DO UPDATE SET updated_at=EXCLUDED.updated_at`,
        [version.promptId, version.stage, version.createdAt],
      );
      await client.query(
        `INSERT INTO prompt_version(prompt_id,stage,version,previous_version,content,status,source,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          version.promptId,
          version.stage,
          version.version,
          version.previousVersion ?? null,
          version.content,
          version.status,
          version.source,
          version.createdAt,
        ],
      );
      if (setCurrent)
        await client.query(
          'UPDATE prompt SET current_version=$2,updated_at=$3 WHERE prompt_id=$1',
          [version.promptId, version.version, version.createdAt],
        );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async effect(promptId: string, version: number): Promise<PromptEffectSummary> {
    const result = await this.#pool.query<{
      invocation_count: number;
      success_count: number;
      failure_count: number;
      average_duration_ms: number;
      total_input_tokens: number;
      total_output_tokens: number;
    }>(
      `SELECT COUNT(*)::int invocation_count, COUNT(*) FILTER(WHERE status='succeeded')::int success_count,
       COUNT(*) FILTER(WHERE status='failed')::int failure_count, COALESCE(AVG(duration_ms),0)::double precision average_duration_ms,
       COALESCE(SUM(input_tokens),0)::int total_input_tokens, COALESCE(SUM(output_tokens),0)::int total_output_tokens
       FROM model_invocation WHERE prompt_id=$1 AND prompt_version=$2`,
      [promptId, version],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('PROMPT_EFFECT_QUERY_FAILED');
    return {
      promptId,
      version,
      invocationCount: row.invocation_count,
      successCount: row.success_count,
      failureCount: row.failure_count,
      averageDurationMs: row.average_duration_ms,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
    };
  }
}

interface WorkflowTemplateOccurrenceRow extends QueryResultRow {
  experience_id: string;
  quality_report_id: string | null;
  goal_key: string;
  structure_key: string;
  workflow_json: unknown;
  duration_ms: number;
  created_at: Date | string;
}

interface WorkflowTemplateRow extends QueryResultRow {
  template_id: string;
  version: number;
  goal_key: string;
  structure_key: string;
  workflow_json: unknown;
  source_experience_ids_json: unknown;
  source_success_count: number;
  use_count: number;
  successful_use_count: number;
  average_use_duration_ms: number;
  status: 'enabled';
  created_at: Date | string;
}

interface WorkflowTemplateUseRow extends QueryResultRow {
  use_id: string;
  template_id: string;
  template_version: number;
  plan_id: string;
  workflow_definition_id: string;
  workflow_version: number;
  status: WorkflowTemplateUse['status'];
  duration_ms: number | null;
  created_at: Date | string;
  completed_at: Date | string | null;
}

interface WorkflowPlanRow extends QueryResultRow {
  plan_id: string;
  goal_id: string;
  goal_version: number;
  goal_contract_json: unknown;
  composition_context_json: unknown;
  capability_gap_skill_ids_json: unknown;
  tool_execution_semantics_json: unknown;
  definition_json: unknown;
  source_confirmed_plan_id: string | null;
  source_plan_id: string | null;
  revision_kind: NonNullable<WorkflowPlanRecord['revisionKind']> | null;
  confirmation_status: WorkflowPlanRecord['confirmationStatus'];
  confirmation_task_id: string | null;
  confirmed_at: Date | string | null;
  attempt_count: number;
  created_at: Date | string;
}

const StoredWorkflowDefinitionSchema = z
  .object({
    workflowDefinitionId: z.string(),
    version: z.number().int().positive(),
    goalId: z.string(),
    goalVersion: z.number().int().positive(),
    entryNodeId: z.string(),
    exitNodeIds: z.array(z.string()),
    nodes: z.array(z.unknown()),
    edges: z.array(z.unknown()),
  })
  .strict();

export class PostgresWorkflowTemplateRepository implements WorkflowTemplateRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async saveOccurrence(occurrence: WorkflowTemplateOccurrence): Promise<void> {
    await this.#pool.query(
      `INSERT INTO workflow_template_occurrence
         (experience_id,quality_report_id,goal_key,structure_key,workflow_json,duration_ms,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (experience_id) DO NOTHING`,
      [
        occurrence.experienceId,
        occurrence.qualityReportId ?? null,
        occurrence.goalKey,
        occurrence.structureKey,
        JSON.stringify(occurrence.workflow),
        occurrence.durationMs,
        occurrence.createdAt,
      ],
    );
  }

  async listOccurrences(goalKey: string, structureKey: string) {
    const result = await this.#pool.query<WorkflowTemplateOccurrenceRow>(
      `SELECT experience_id,quality_report_id,goal_key,structure_key,workflow_json,duration_ms,created_at
       FROM workflow_template_occurrence WHERE goal_key=$1 AND structure_key=$2
       ORDER BY created_at,experience_id`,
      [goalKey, structureKey],
    );
    return result.rows.map(mapWorkflowTemplateOccurrenceRow);
  }

  async findPreferred(goalKey: string): Promise<WorkflowTemplate | undefined> {
    const result = await this.#pool.query<WorkflowTemplateRow>(
      `SELECT * FROM workflow_template WHERE goal_key=$1 AND status='enabled'
       ORDER BY version DESC,created_at DESC LIMIT 1`,
      [goalKey],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapWorkflowTemplateRow(row);
  }

  async saveTemplate(template: WorkflowTemplate): Promise<void> {
    await this.#pool.query(
      `INSERT INTO workflow_template
         (template_id,version,goal_key,structure_key,workflow_json,source_experience_ids_json,
          source_success_count,use_count,successful_use_count,average_use_duration_ms,status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        template.templateId,
        template.version,
        template.goalKey,
        template.structureKey,
        JSON.stringify(template.workflow),
        JSON.stringify(template.sourceExperienceIds),
        template.sourceSuccessCount,
        template.useCount,
        template.successfulUseCount,
        template.averageUseDurationMs,
        template.status,
        template.createdAt,
      ],
    );
  }

  async saveUse(use: WorkflowTemplateUse): Promise<void> {
    await this.#pool.query(
      `INSERT INTO workflow_template_use
         (use_id,template_id,template_version,plan_id,workflow_definition_id,workflow_version,
          status,duration_ms,created_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        use.useId,
        use.templateId,
        use.templateVersion,
        use.planId,
        use.workflowDefinitionId,
        use.workflowVersion,
        use.status,
        use.durationMs ?? null,
        use.createdAt,
        use.completedAt ?? null,
      ],
    );
  }

  async findPlannedUse(workflowDefinitionId: string, workflowVersion: number) {
    const result = await this.#pool.query<WorkflowTemplateUseRow>(
      `SELECT * FROM workflow_template_use
       WHERE workflow_definition_id=$1 AND workflow_version=$2 AND status='planned'`,
      [workflowDefinitionId, workflowVersion],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapWorkflowTemplateUseRow(row);
  }

  async completeUse(use: WorkflowTemplateUse, template: WorkflowTemplate): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE workflow_template SET use_count=$3,successful_use_count=$4,
           average_use_duration_ms=$5 WHERE template_id=$1 AND version=$2`,
        [
          template.templateId,
          template.version,
          template.useCount,
          template.successfulUseCount,
          template.averageUseDurationMs,
        ],
      );
      await client.query(
        `UPDATE workflow_template_use SET status=$2,duration_ms=$3,completed_at=$4
         WHERE use_id=$1 AND status='planned'`,
        [use.useId, use.status, use.durationMs ?? null, use.completedAt ?? null],
      );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listTemplates() {
    const result = await this.#pool.query<WorkflowTemplateRow>(
      'SELECT * FROM workflow_template ORDER BY template_id,version',
    );
    return result.rows.map(mapWorkflowTemplateRow);
  }

  async listUses(templateId: string) {
    const result = await this.#pool.query<WorkflowTemplateUseRow>(
      'SELECT * FROM workflow_template_use WHERE template_id=$1 ORDER BY created_at,use_id',
      [templateId],
    );
    return result.rows.map(mapWorkflowTemplateUseRow);
  }
}

export class PostgresWorkflowPlanRepository implements WorkflowPlanRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }
  async findPlan(planId: string): Promise<WorkflowPlanRecord | undefined> {
    const result = await this.#pool.query<WorkflowPlanRow>(
      'SELECT * FROM workflow_plan WHERE plan_id=$1',
      [planId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      planId: row.plan_id,
      goalId: row.goal_id,
      goalVersion: row.goal_version,
      goalContract: GoalExecutionContractSchema.parse(row.goal_contract_json),
      ...mapWorkflowPlanCompositionAuthority(row),
      ...(row.definition_json === null
        ? {}
        : {
            definition: StoredWorkflowDefinitionSchema.parse(
              row.definition_json,
            ) as unknown as WorkflowDefinition,
          }),
      ...(row.source_confirmed_plan_id === null
        ? {}
        : { sourceConfirmedPlanId: row.source_confirmed_plan_id }),
      ...(row.source_plan_id === null ? {} : { sourcePlanId: row.source_plan_id }),
      ...(row.revision_kind === null ? {} : { revisionKind: row.revision_kind }),
      confirmationStatus: row.confirmation_status,
      ...(row.confirmation_task_id === null
        ? {}
        : { confirmationTaskId: row.confirmation_task_id }),
      ...(row.confirmed_at === null ? {} : { confirmedAt: toIsoString(row.confirmed_at) }),
      attemptCount: row.attempt_count,
      createdAt: toIsoString(row.created_at),
    };
  }
  async findConfirmedDefinition(
    workflowDefinitionId: string,
    workflowVersion: number,
  ): Promise<WorkflowPlanRecord | undefined> {
    const result = await this.#pool.query<WorkflowPlanRow>(
      `SELECT * FROM workflow_plan
       WHERE confirmation_status='confirmed'
         AND definition_json->>'workflowDefinitionId'=$1
         AND (definition_json->>'version')::integer=$2
       ORDER BY created_at DESC LIMIT 1`,
      [workflowDefinitionId, workflowVersion],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapWorkflowPlanRow(row);
  }
  async confirmPlan(
    planId: string,
    correlation: Readonly<{ taskId?: string; confirmedAt: string }>,
  ): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE workflow_plan SET confirmation_status='confirmed',confirmation_task_id=$2,confirmed_at=$3
       WHERE plan_id=$1 AND definition_json IS NOT NULL AND confirmation_status='awaiting_confirmation'`,
      [planId, correlation.taskId ?? null, correlation.confirmedAt],
    );
    if (result.rowCount !== 1) throw new Error('WORKFLOW_PLAN_CONFIRMATION_FAILED');
  }
  async saveAttempt(attempt: WorkflowPlanAttempt): Promise<void> {
    await this.#pool.query(
      `INSERT INTO workflow_plan_attempt
         (plan_id,goal_contract_json,composition_context_json,capability_gap_skill_ids_json,
          tool_execution_semantics_json,attempt,candidate_json,validation_errors_json,valid,created_at)
       VALUES($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9,$10)`,
      [
        attempt.planId,
        JSON.stringify(attempt.goalContract),
        attempt.compositionContext === undefined
          ? null
          : JSON.stringify(attempt.compositionContext),
        JSON.stringify(attempt.capabilityGapSkillIds ?? []),
        JSON.stringify(attempt.toolExecutionSemantics ?? []),
        attempt.attempt,
        JSON.stringify(attempt.candidate),
        JSON.stringify(attempt.validationErrors),
        attempt.valid,
        attempt.createdAt,
      ],
    );
  }
  async savePlan(plan: WorkflowPlanRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO workflow_plan
         (plan_id,goal_id,goal_version,goal_contract_json,composition_context_json,
          capability_gap_skill_ids_json,tool_execution_semantics_json,definition_json,source_confirmed_plan_id,source_plan_id,
          revision_kind,confirmation_status,attempt_count,created_at)
       VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14)`,
      [
        plan.planId,
        plan.goalId,
        plan.goalVersion,
        JSON.stringify(plan.goalContract),
        plan.compositionContext === undefined ? null : JSON.stringify(plan.compositionContext),
        JSON.stringify(plan.capabilityGapSkillIds ?? []),
        JSON.stringify(plan.toolExecutionSemantics ?? []),
        plan.definition === undefined ? null : JSON.stringify(plan.definition),
        plan.sourceConfirmedPlanId ?? null,
        plan.sourcePlanId ?? null,
        plan.revisionKind ?? null,
        plan.confirmationStatus,
        plan.attemptCount,
        plan.createdAt,
      ],
    );
  }
  async savePlanAndSupersede(plan: WorkflowPlanRecord, sourcePlanId: string): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const source = await client.query(
        `UPDATE workflow_plan SET confirmation_status='superseded'
         WHERE plan_id=$1 AND confirmation_status IN ('awaiting_confirmation','confirmed')`,
        [sourcePlanId],
      );
      if (source.rowCount !== 1) throw new Error('WORKFLOW_REVISION_SOURCE_NOT_ACTIVE');
      await client.query(
        `INSERT INTO workflow_plan
           (plan_id,goal_id,goal_version,goal_contract_json,composition_context_json,
            capability_gap_skill_ids_json,tool_execution_semantics_json,definition_json,source_confirmed_plan_id,source_plan_id,
            revision_kind,confirmation_status,attempt_count,created_at)
         VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14)`,
        [
          plan.planId,
          plan.goalId,
          plan.goalVersion,
          JSON.stringify(plan.goalContract),
          plan.compositionContext === undefined ? null : JSON.stringify(plan.compositionContext),
          JSON.stringify(plan.capabilityGapSkillIds ?? []),
          JSON.stringify(plan.toolExecutionSemantics ?? []),
          plan.definition === undefined ? null : JSON.stringify(plan.definition),
          plan.sourceConfirmedPlanId ?? null,
          plan.sourcePlanId ?? null,
          plan.revisionKind ?? null,
          plan.confirmationStatus,
          plan.attemptCount,
          plan.createdAt,
        ],
      );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

interface WorkflowInstanceRow extends QueryResultRow {
  instance_id: string;
  plan_id: string;
  workflow_definition_id: string;
  workflow_version: number;
  goal_id: string;
  goal_version: number;
  status: WorkflowInstance['status'];
  input_json: unknown;
  result_json: unknown;
  errors_json: unknown;
  started_at: Date | string;
  completed_at: Date | string | null;
  skill_versions_json: unknown;
  budget_limits_json: unknown;
  budget_usage_json: unknown;
  termination_reason: NonNullable<WorkflowInstance['terminationReason']> | null;
  pending_confirmation_json: unknown;
}

interface WorkflowNodeEventRow extends QueryResultRow {
  event_id: string;
  instance_id: string;
  sequence: number;
  node_id: string;
  event_type: WorkflowNodeEvent['eventType'];
  event_timestamp: Date | string;
  duration_ms: number | null;
  summary: string;
}

const WorkflowErrorsSchema = z.record(
  z.string(),
  z.object({ code: z.string(), message: z.string() }).strict(),
);
const WorkflowSkillVersionsSchema = z.array(
  z.object({ skillId: z.string(), version: z.number().int().positive() }).strict(),
);
const WorkflowBudgetLimitsSchema = z
  .object({
    maxReplans: z.number().int().nonnegative(),
    maxDurationSeconds: z.number().int().positive(),
    maxLlmCalls: z.number().int().nonnegative(),
    maxMcpCalls: z.number().int().nonnegative(),
    maxCost: z.number().nonnegative(),
  })
  .strict();
const WorkflowBudgetUsageSchema = z
  .object({
    replanCount: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
    llmCalls: z.number().int().nonnegative(),
    mcpCalls: z.number().int().nonnegative(),
    cost: z.number().nonnegative(),
  })
  .strict();
const PendingConfirmationSchema = z
  .object({
    nodeId: z.string().min(1),
    prompt: z.string().min(1),
    kind: z.enum(['human_confirmation', 'task_pause', 'skill_confirmation']).optional(),
    pausedAt: z.string().optional(),
    parentPlanId: z.string().min(1).optional(),
    childPlanId: z.string().min(1).optional(),
    childSkillId: z.string().min(1).optional(),
    childSkillVersion: z.number().int().positive().optional(),
  })
  .strict();

interface SkillCallWorkflowRow extends QueryResultRow {
  call_id: string;
  parent_plan_id: string;
  parent_instance_id: string;
  parent_node_id: string;
  child_instance_id: string | null;
  child_plan_id: string;
  skill_id: string;
  skill_version: number;
  confirmation_status: SkillCallWorkflowRecord['confirmationStatus'];
  status: SkillCallWorkflowRecord['status'];
  evaluation_summary: string;
  created_at: Date;
  completed_at: Date | null;
}

export class PostgresSkillCallWorkflowRepository implements SkillCallWorkflowRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async save(record: SkillCallWorkflowRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_call_workflow(
         call_id,parent_plan_id,parent_instance_id,parent_node_id,child_instance_id,child_plan_id,
         skill_id,skill_version,confirmation_status,status,evaluation_summary,created_at,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(call_id) DO UPDATE SET
         child_instance_id=COALESCE(skill_call_workflow.child_instance_id,EXCLUDED.child_instance_id),
         confirmation_status=EXCLUDED.confirmation_status,
         status=EXCLUDED.status,
         evaluation_summary=EXCLUDED.evaluation_summary,
         completed_at=EXCLUDED.completed_at`,
      [
        record.callId,
        record.parentPlanId,
        record.parentInstanceId,
        record.parentNodeId,
        record.childInstanceId ?? null,
        record.childPlanId,
        record.skillId,
        record.skillVersion,
        record.confirmationStatus,
        record.status,
        record.evaluationSummary,
        record.createdAt,
        record.completedAt ?? null,
      ],
    );
  }

  async find(parentInstanceId: string, parentNodeId: string) {
    const result = await this.#pool.query<SkillCallWorkflowRow>(
      `SELECT * FROM skill_call_workflow
       WHERE parent_instance_id=$1 AND parent_node_id=$2
       ORDER BY created_at DESC,completed_at DESC,call_id DESC LIMIT 1`,
      [parentInstanceId, parentNodeId],
    );
    return result.rows[0] === undefined ? undefined : mapSkillCallWorkflow(result.rows[0]);
  }

  async findByChildInstanceId(childInstanceId: string) {
    const result = await this.#pool.query<SkillCallWorkflowRow>(
      `SELECT * FROM skill_call_workflow
       WHERE child_instance_id=$1
       ORDER BY created_at DESC,call_id DESC LIMIT 1`,
      [childInstanceId],
    );
    return result.rows[0] === undefined ? undefined : mapSkillCallWorkflow(result.rows[0]);
  }

  async listByParent(parentInstanceId: string) {
    const result = await this.#pool.query<SkillCallWorkflowRow>(
      `SELECT * FROM skill_call_workflow
       WHERE parent_instance_id=$1 ORDER BY created_at,parent_node_id,call_id`,
      [parentInstanceId],
    );
    return result.rows.map(mapSkillCallWorkflow);
  }
}

function mapSkillCallWorkflow(row: SkillCallWorkflowRow): SkillCallWorkflowRecord {
  return {
    callId: row.call_id,
    parentPlanId: row.parent_plan_id,
    parentInstanceId: row.parent_instance_id,
    parentNodeId: row.parent_node_id,
    ...(row.child_instance_id === null ? {} : { childInstanceId: row.child_instance_id }),
    childPlanId: row.child_plan_id,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    confirmationStatus: row.confirmation_status,
    status: row.status,
    evaluationSummary: row.evaluation_summary,
    createdAt: row.created_at.toISOString(),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
  };
}

export class PostgresWorkflowExecutionRepository implements WorkflowExecutionRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }
  async countNodeEvents(instanceId: string): Promise<number> {
    const result = await this.#pool.query<{ count: number }>(
      'SELECT COUNT(*)::int count FROM workflow_node_event WHERE instance_id=$1',
      [instanceId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async listNodeEvents(instanceId: string): Promise<readonly WorkflowNodeEvent[]> {
    const result = await this.#pool.query<WorkflowNodeEventRow>(
      `SELECT event_id, instance_id, sequence, node_id, event_type, event_timestamp, duration_ms, summary
       FROM workflow_node_event WHERE instance_id=$1 ORDER BY sequence, event_id`,
      [instanceId],
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      instanceId: row.instance_id,
      sequence: row.sequence,
      nodeId: row.node_id,
      eventType: row.event_type,
      timestamp: toIsoString(row.event_timestamp),
      ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
      summary: row.summary,
    }));
  }

  async findInstance(instanceId: string): Promise<WorkflowInstance | undefined> {
    const result = await this.#pool.query<WorkflowInstanceRow>(
      'SELECT * FROM workflow_instance WHERE instance_id=$1',
      [instanceId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      instanceId: row.instance_id,
      planId: row.plan_id,
      workflowDefinitionId: row.workflow_definition_id,
      workflowVersion: row.workflow_version,
      goalId: row.goal_id,
      goalVersion: row.goal_version,
      skillVersions: WorkflowSkillVersionsSchema.parse(row.skill_versions_json),
      budgetLimits: WorkflowBudgetLimitsSchema.parse(row.budget_limits_json),
      budgetUsage: WorkflowBudgetUsageSchema.parse(row.budget_usage_json),
      status: row.status,
      input: row.input_json,
      ...(row.result_json === null ? {} : { result: row.result_json }),
      errors: WorkflowErrorsSchema.parse(row.errors_json),
      startedAt: toIsoString(row.started_at),
      ...(row.completed_at === null ? {} : { completedAt: toIsoString(row.completed_at) }),
      ...(row.termination_reason === null ? {} : { terminationReason: row.termination_reason }),
      ...(row.pending_confirmation_json === null
        ? {}
        : { pendingConfirmation: mapPendingConfirmation(row.pending_confirmation_json) }),
    };
  }

  async findActiveByPlanId(planId: string): Promise<WorkflowInstance | undefined> {
    const result = await this.#pool.query<{ instance_id: string }>(
      `SELECT instance_id FROM workflow_instance
       WHERE plan_id=$1 AND status IN ('running','paused','waiting_external') ORDER BY started_at DESC LIMIT 1`,
      [planId],
    );
    const instanceId = result.rows[0]?.instance_id;
    return instanceId === undefined ? undefined : this.findInstance(instanceId);
  }

  async findLatestByPlanId(planId: string): Promise<WorkflowInstance | undefined> {
    const result = await this.#pool.query<{ instance_id: string }>(
      `SELECT instance_id FROM workflow_instance
       WHERE plan_id=$1 ORDER BY started_at DESC, instance_id DESC LIMIT 1`,
      [planId],
    );
    const instanceId = result.rows[0]?.instance_id;
    return instanceId === undefined ? undefined : this.findInstance(instanceId);
  }

  async listActiveByGoalId(goalId: string): Promise<readonly WorkflowInstance[]> {
    const result = await this.#pool.query<{ instance_id: string }>(
      `SELECT instance_id FROM workflow_instance
       WHERE goal_id=$1 AND status IN ('running','paused','waiting_external') ORDER BY started_at,instance_id`,
      [goalId],
    );
    return Promise.all(result.rows.map((row) => this.findInstance(row.instance_id))).then(
      (instances) => instances.filter((value): value is WorkflowInstance => value !== undefined),
    );
  }

  async saveInstance(instance: WorkflowInstance): Promise<void> {
    await this.#pool.query(
      `INSERT INTO workflow_instance(
         instance_id,plan_id,workflow_definition_id,workflow_version,goal_id,goal_version,
         status,input_json,result_json,errors_json,started_at,completed_at,
         skill_versions_json,budget_limits_json,budget_usage_json,termination_reason,pending_confirmation_json)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17::jsonb)
       ON CONFLICT(instance_id) DO UPDATE SET
         status=EXCLUDED.status,
         result_json=EXCLUDED.result_json,
         errors_json=EXCLUDED.errors_json,
         completed_at=EXCLUDED.completed_at,
         budget_usage_json=EXCLUDED.budget_usage_json,
         termination_reason=EXCLUDED.termination_reason,
         pending_confirmation_json=EXCLUDED.pending_confirmation_json`,
      [
        instance.instanceId,
        instance.planId,
        instance.workflowDefinitionId,
        instance.workflowVersion,
        instance.goalId,
        instance.goalVersion,
        instance.status,
        JSON.stringify(instance.input),
        instance.result === undefined ? null : JSON.stringify(instance.result),
        JSON.stringify(instance.errors),
        instance.startedAt,
        instance.completedAt ?? null,
        JSON.stringify(instance.skillVersions),
        JSON.stringify(instance.budgetLimits),
        JSON.stringify(instance.budgetUsage),
        instance.terminationReason ?? null,
        instance.pendingConfirmation === undefined
          ? null
          : JSON.stringify(instance.pendingConfirmation),
      ],
    );
  }

  async saveNodeEvents(events: readonly WorkflowNodeEvent[]): Promise<void> {
    if (events.length === 0) return;
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      for (const event of events)
        await client.query(
          `INSERT INTO workflow_node_event(
             event_id,instance_id,sequence,node_id,event_type,event_timestamp,duration_ms,summary)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            event.eventId,
            event.instanceId,
            event.sequence,
            event.nodeId,
            event.eventType,
            event.timestamp,
            event.durationMs ?? null,
            event.summary,
          ],
        );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapPendingConfirmation(
  value: unknown,
): NonNullable<WorkflowInstance['pendingConfirmation']> {
  const pending = PendingConfirmationSchema.parse(value);
  return {
    nodeId: pending.nodeId,
    prompt: pending.prompt,
    ...(pending.kind === undefined ? {} : { kind: pending.kind }),
    ...(pending.pausedAt === undefined ? {} : { pausedAt: pending.pausedAt }),
    ...(pending.parentPlanId === undefined ? {} : { parentPlanId: pending.parentPlanId }),
    ...(pending.childPlanId === undefined ? {} : { childPlanId: pending.childPlanId }),
    ...(pending.childSkillId === undefined ? {} : { childSkillId: pending.childSkillId }),
    ...(pending.childSkillVersion === undefined
      ? {}
      : { childSkillVersion: pending.childSkillVersion }),
  };
}

interface WorkflowControlRow extends QueryResultRow {
  control_id: string;
  context_id: string;
  goal_id: string;
  goal_version: number;
  task_id: string | null;
  status: WorkflowControlRecord['status'];
  current_plan_id: string;
  input_json: unknown;
  skill_ids_json: unknown;
  planning_instruction: string;
  round_count: number;
  replan_count: number;
  final_instance_id: string | null;
  terminal_outcome_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WorkflowControlRoundRow extends QueryResultRow {
  control_id: string;
  round_index: number;
  plan_id: string;
  instance_id: string;
  workflow_version: number;
  evaluation_decision: WorkflowControlRound['evaluation']['decision'];
  evaluation_summary: string;
  evaluation_detail_json: unknown;
  terminal_outcome_id: string | null;
  created_at: Date | string;
}

export class PostgresWorkflowControlRepository implements WorkflowControlRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async find(controlId: string): Promise<WorkflowControlRecord | undefined> {
    const result = await this.#pool.query<WorkflowControlRow>(
      'SELECT * FROM workflow_control WHERE control_id=$1',
      [controlId],
    );
    return result.rows[0] === undefined ? undefined : mapWorkflowControlRow(result.rows[0]);
  }

  async save(control: WorkflowControlRecord): Promise<void> {
    const saved = await this.#pool.query(
      `INSERT INTO workflow_control(
         control_id,context_id,goal_id,goal_version,task_id,status,current_plan_id,input_json,
         skill_ids_json,planning_instruction,round_count,replan_count,final_instance_id,
         terminal_outcome_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT(control_id) DO UPDATE SET
         status=EXCLUDED.status,current_plan_id=EXCLUDED.current_plan_id,
         input_json=EXCLUDED.input_json,
         round_count=EXCLUDED.round_count,replan_count=EXCLUDED.replan_count,
         final_instance_id=EXCLUDED.final_instance_id,
         terminal_outcome_id=EXCLUDED.terminal_outcome_id,updated_at=EXCLUDED.updated_at
       WHERE workflow_control.status NOT IN (
         'capability_gap','achieved','unachievable','canceled','failed','replan_budget_exhausted'
       )`,
      [
        control.controlId,
        control.contextId,
        control.goalId,
        control.goalVersion,
        control.taskId ?? null,
        control.status,
        control.currentPlanId,
        JSON.stringify(control.input),
        JSON.stringify(control.skillIds),
        control.planningInstruction,
        control.roundCount,
        control.replanCount,
        control.finalInstanceId ?? null,
        control.terminalOutcomeId ?? null,
        control.createdAt,
        control.updatedAt,
      ],
    );
    if (saved.rowCount !== 1) throw new Error('WORKFLOW_CONTROL_TERMINAL_STATE_CONFLICT');
  }

  async saveRound(round: WorkflowControlRound): Promise<void> {
    const saved = await this.#pool.query(
      `WITH writable_control AS (
         SELECT control_id FROM workflow_control
         WHERE control_id=$1 AND status NOT IN (
           'capability_gap','achieved','unachievable','canceled','failed','replan_budget_exhausted'
         )
         FOR UPDATE
       )
       INSERT INTO workflow_control_round(
         control_id,round_index,plan_id,instance_id,workflow_version,evaluation_decision,
         evaluation_summary,evaluation_detail_json,terminal_outcome_id,created_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10 FROM writable_control`,
      [
        round.controlId,
        round.roundIndex,
        round.planId,
        round.instanceId,
        round.workflowVersion,
        round.evaluation.decision,
        round.evaluation.summary,
        JSON.stringify(round.evaluation),
        round.terminalOutcomeId ?? null,
        round.createdAt,
      ],
    );
    if (saved.rowCount !== 1) throw new Error('WORKFLOW_CONTROL_TERMINAL_STATE_CONFLICT');
  }

  async listRounds(controlId: string): Promise<readonly WorkflowControlRound[]> {
    const result = await this.#pool.query<WorkflowControlRoundRow>(
      'SELECT * FROM workflow_control_round WHERE control_id=$1 ORDER BY round_index',
      [controlId],
    );
    return result.rows.map(mapWorkflowControlRoundRow);
  }
}

function mapWorkflowControlRow(row: WorkflowControlRow): WorkflowControlRecord {
  return {
    controlId: row.control_id,
    contextId: row.context_id,
    goalId: row.goal_id,
    goalVersion: row.goal_version,
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    status: row.status,
    currentPlanId: row.current_plan_id,
    input: row.input_json,
    skillIds: StringArraySchema.parse(row.skill_ids_json),
    planningInstruction: row.planning_instruction,
    roundCount: row.round_count,
    replanCount: row.replan_count,
    ...(row.final_instance_id === null ? {} : { finalInstanceId: row.final_instance_id }),
    ...(row.terminal_outcome_id === null ? {} : { terminalOutcomeId: row.terminal_outcome_id }),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapWorkflowControlRoundRow(row: WorkflowControlRoundRow): WorkflowControlRound {
  return {
    controlId: row.control_id,
    roundIndex: row.round_index,
    planId: row.plan_id,
    instanceId: row.instance_id,
    workflowVersion: row.workflow_version,
    evaluation: mapWorkflowControlEvaluation(row.evaluation_detail_json),
    ...(row.terminal_outcome_id === null ? {} : { terminalOutcomeId: row.terminal_outcome_id }),
    createdAt: toIsoString(row.created_at),
  };
}

export class PostgresEvolutionExperienceRepository implements EvolutionExperienceRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async save(experience: EvolutionExperience): Promise<void> {
    await this.#pool.query(
      `INSERT INTO evolution_experience
         (experience_id,control_id,round_index,task_id,context_id,goal_id,goal_json,
          workflow_json,instance_id,skill_versions_json,tools_json,input_json,result_json,
          errors_json,evaluation_json,successful,duration_ms,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT(control_id,round_index) DO NOTHING`,
      [
        experience.experienceId,
        experience.controlId,
        experience.roundIndex,
        experience.taskId ?? null,
        experience.contextId,
        experience.goal.goalId,
        JSON.stringify(experience.goal),
        JSON.stringify(experience.workflow),
        experience.instanceId,
        JSON.stringify(experience.skillVersions),
        JSON.stringify(experience.tools),
        JSON.stringify(experience.input ?? null),
        experience.result === undefined ? null : JSON.stringify(experience.result),
        JSON.stringify(experience.errors),
        JSON.stringify(experience.evaluation),
        experience.successful,
        experience.durationMs,
        experience.createdAt,
      ],
    );
  }

  async find(experienceId: string): Promise<EvolutionExperience | undefined> {
    const result = await this.#pool.query<EvolutionExperienceRow>(
      'SELECT * FROM evolution_experience WHERE experience_id=$1',
      [experienceId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapEvolutionExperienceRow(row);
  }

  async findByInstance(instanceId: string): Promise<EvolutionExperience | undefined> {
    const result = await this.#pool.query<EvolutionExperienceRow>(
      'SELECT * FROM evolution_experience WHERE instance_id=$1',
      [instanceId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapEvolutionExperienceRow(row);
  }

  async listByGoal(goalId: string): Promise<readonly EvolutionExperience[]> {
    const result = await this.#pool.query<EvolutionExperienceRow>(
      'SELECT * FROM evolution_experience WHERE goal_id=$1 ORDER BY created_at,experience_id',
      [goalId],
    );
    return result.rows.map(mapEvolutionExperienceRow);
  }

  async listBySkill(skillId: string): Promise<readonly EvolutionExperience[]> {
    const result = await this.#pool.query<EvolutionExperienceRow>(
      `SELECT * FROM evolution_experience
       WHERE skill_versions_json @> $1::jsonb ORDER BY created_at,experience_id`,
      [JSON.stringify([{ skillId }])],
    );
    return result.rows.map(mapEvolutionExperienceRow);
  }

  async listByTool(reference: ToolReference): Promise<readonly EvolutionExperience[]> {
    const result = await this.#pool.query<EvolutionExperienceRow>(
      `SELECT * FROM evolution_experience
       WHERE tools_json @> $1::jsonb ORDER BY created_at,experience_id`,
      [JSON.stringify([reference])],
    );
    return result.rows.map(mapEvolutionExperienceRow);
  }
}

const WorkflowControlEvaluationSchema = z
  .object({
    decision: z.enum([
      'achieved',
      'request_input',
      'adjust_plan',
      'replace_skill',
      'invoke_additional_skill',
      'capability_gap',
      'unachievable',
    ]),
    summary: z.string().min(1),
    actionInstruction: z.string().min(1).optional(),
    question: z.string().min(1).optional(),
    missingCapability: z.string().min(1).optional(),
    suggestedToolContract: z
      .object({
        name: z.string().min(1),
        description: z.string().min(1),
        inputSchema: z.unknown(),
      })
      .strict()
      .optional(),
  })
  .strict();

function mapWorkflowControlEvaluation(value: unknown): WorkflowControlRound['evaluation'] {
  const result = WorkflowControlEvaluationSchema.parse(value);
  return {
    decision: result.decision,
    summary: result.summary,
    ...(result.actionInstruction === undefined
      ? {}
      : { actionInstruction: result.actionInstruction }),
    ...(result.question === undefined ? {} : { question: result.question }),
    ...(result.missingCapability === undefined
      ? {}
      : { missingCapability: result.missingCapability }),
    ...(result.suggestedToolContract === undefined
      ? {}
      : { suggestedToolContract: result.suggestedToolContract }),
  };
}

function mapEvolutionExperienceRow(row: EvolutionExperienceRow): EvolutionExperience {
  return {
    experienceId: row.experience_id,
    controlId: row.control_id,
    roundIndex: row.round_index,
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    contextId: row.context_id,
    goal: EvolutionGoalSchema.parse(row.goal_json),
    workflow: StoredWorkflowDefinitionSchema.parse(
      row.workflow_json,
    ) as unknown as WorkflowDefinition,
    instanceId: row.instance_id,
    skillVersions: WorkflowSkillVersionsSchema.parse(row.skill_versions_json),
    tools: ToolReferencesSchema.parse(row.tools_json),
    input: row.input_json,
    ...(row.result_json === null ? {} : { result: row.result_json }),
    errors: WorkflowErrorsSchema.parse(row.errors_json),
    evaluation: mapWorkflowControlEvaluation(row.evaluation_json),
    successful: row.successful,
    durationMs: row.duration_ms,
    createdAt: toIsoString(row.created_at),
  };
}

function mapWorkflowPlanRow(row: WorkflowPlanRow): WorkflowPlanRecord {
  return {
    planId: row.plan_id,
    goalId: row.goal_id,
    goalVersion: row.goal_version,
    goalContract: GoalExecutionContractSchema.parse(row.goal_contract_json),
    ...mapWorkflowPlanCompositionAuthority(row),
    ...(row.definition_json === null
      ? {}
      : {
          definition: StoredWorkflowDefinitionSchema.parse(
            row.definition_json,
          ) as unknown as WorkflowDefinition,
        }),
    ...(row.source_confirmed_plan_id === null
      ? {}
      : { sourceConfirmedPlanId: row.source_confirmed_plan_id }),
    ...(row.source_plan_id === null ? {} : { sourcePlanId: row.source_plan_id }),
    ...(row.revision_kind === null ? {} : { revisionKind: row.revision_kind }),
    confirmationStatus: row.confirmation_status,
    ...(row.confirmation_task_id === null ? {} : { confirmationTaskId: row.confirmation_task_id }),
    ...(row.confirmed_at === null ? {} : { confirmedAt: toIsoString(row.confirmed_at) }),
    attemptCount: row.attempt_count,
    createdAt: toIsoString(row.created_at),
  };
}

function mapWorkflowPlanCompositionAuthority(
  row: WorkflowPlanRow,
): Pick<
  WorkflowPlanRecord,
  'compositionContext' | 'capabilityGapSkillIds' | 'toolExecutionSemantics'
> {
  const capabilityGapSkillIds = StringArraySchema.parse(row.capability_gap_skill_ids_json);
  const toolExecutionSemantics = snapshotWorkflowToolExecutionSemantics(
    WorkflowToolExecutionSemanticsSchema.parse(row.tool_execution_semantics_json),
  );
  return {
    ...(row.composition_context_json === null
      ? {}
      : {
          compositionContext: snapshotSkillCompositionContext(
            SkillCompositionContextSchema.parse(
              row.composition_context_json,
            ) as SkillCompositionContext,
          ),
        }),
    ...(capabilityGapSkillIds.length === 0 ? {} : { capabilityGapSkillIds }),
    ...(toolExecutionSemantics.length === 0 ? {} : { toolExecutionSemantics }),
  };
}

async function findActivePrompt(pool: Pool, stage: ModelStage): Promise<PromptVersion | undefined> {
  const result = await pool.query<PromptVersionRow>(
    `SELECT v.* FROM prompt p JOIN prompt_version v ON v.prompt_id=p.prompt_id AND v.version=p.current_version
     WHERE p.stage=$1 AND v.status='enabled'`,
    [stage],
  );
  return result.rows[0] === undefined ? undefined : mapPromptVersionRow(result.rows[0]);
}

interface SkillEmbeddingScoreRow extends QueryResultRow {
  skill_id: string;
  semantic_score: number;
}

export class PostgresSkillEmbeddingRepository implements SkillEmbeddingRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async upsert(input: Parameters<SkillEmbeddingRepository['upsert']>[0]): Promise<void> {
    const vector = vectorLiteral(input.vector);
    await this.#pool.query(
      `INSERT INTO skill_embedding
        (skill_id, skill_version, provider_id, dimensions, searchable_text, embedding, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
       ON CONFLICT (skill_id) DO UPDATE SET
         skill_version = EXCLUDED.skill_version,
         provider_id = EXCLUDED.provider_id,
         dimensions = EXCLUDED.dimensions,
         searchable_text = EXCLUDED.searchable_text,
         embedding = EXCLUDED.embedding,
         updated_at = EXCLUDED.updated_at`,
      [
        input.skillId,
        input.skillVersion,
        input.providerId,
        input.vector.length,
        input.searchableText,
        vector,
        input.updatedAt,
      ],
    );
  }

  async cosineScores(
    input: Parameters<SkillEmbeddingRepository['cosineScores']>[0],
  ): Promise<Readonly<Record<string, number>>> {
    if (input.skillIds.length === 0) return {};
    const result = await this.#pool.query<SkillEmbeddingScoreRow>(
      `SELECT skill_id,
              GREATEST(0, LEAST(1, (2 - (embedding <=> $1::vector)) / 2))::double precision AS semantic_score
         FROM skill_embedding
        WHERE provider_id = $2
          AND dimensions = $3
          AND skill_id = ANY($4::text[])`,
      [vectorLiteral(input.vector), input.providerId, input.vector.length, [...input.skillIds]],
    );
    return Object.fromEntries(result.rows.map((row) => [row.skill_id, row.semantic_score]));
  }
}

export class PostgresTemporarySkillRepository implements TemporarySkillRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async find(temporarySkillId: string): Promise<TemporarySkill | undefined> {
    const result = await this.#pool.query<TemporarySkillRow>(
      `${temporarySkillSelect} WHERE temporary_skill_id = $1`,
      [temporarySkillId],
    );
    return result.rows[0] === undefined ? undefined : mapTemporarySkillRow(result.rows[0]);
  }

  async listByTask(taskId: string): Promise<readonly TemporarySkill[]> {
    const result = await this.#pool.query<TemporarySkillRow>(
      `${temporarySkillSelect} WHERE task_id = $1 ORDER BY created_at, temporary_skill_id`,
      [taskId],
    );
    return result.rows.map(mapTemporarySkillRow);
  }

  async save(skill: TemporarySkill): Promise<void> {
    await this.#pool.query(
      `INSERT INTO temporary_skill
         (temporary_skill_id, task_id, context_id, name, description, tools_json,
          input_schema_json, output_schema_json, capability_fingerprint, status,
          created_at, expired_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      temporarySkillParameters(skill),
    );
  }

  async expireAndSaveExperience(
    skill: TemporarySkill,
    experience: TemporarySkillExperience,
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE temporary_skill SET status = $2, expired_at = $3
         WHERE temporary_skill_id = $1 AND status = 'active'`,
        [skill.temporarySkillId, skill.status, skill.expiredAt ?? null],
      );
      if (updated.rowCount !== 1) throw new Error('TEMPORARY_SKILL_CONCURRENT_EXPIRY');
      await client.query(
        `INSERT INTO temporary_skill_experience
           (experience_id, temporary_skill_id, task_id, context_id,
            capability_fingerprint, successful, outcome_summary, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          experience.experienceId,
          experience.temporarySkillId,
          experience.taskId,
          experience.contextId,
          experience.capabilityFingerprint,
          experience.successful,
          experience.outcomeSummary,
          experience.createdAt,
        ],
      );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listSuccessfulExperiences(
    capabilityFingerprint: string,
  ): Promise<readonly TemporarySkillExperience[]> {
    const result = await this.#pool.query<TemporaryExperienceRow>(
      `SELECT experience_id, temporary_skill_id, task_id, context_id,
              capability_fingerprint, successful, outcome_summary, created_at
       FROM temporary_skill_experience
       WHERE capability_fingerprint = $1 AND successful = true
       ORDER BY created_at, experience_id`,
      [capabilityFingerprint],
    );
    return result.rows.map(mapTemporaryExperienceRow);
  }

  async findFormalizationCandidate(
    capabilityFingerprint: string,
  ): Promise<SkillFormalizationCandidate | undefined> {
    const result = await this.#pool.query<FormalizationCandidateRow>(
      `SELECT candidate_id, capability_fingerprint, successful_experience_count,
              required_success_threshold, source_experience_ids_json, status,
              induction_report_json, validation_report_json, proposed_skill_json,
              published_skill_id, published_skill_version, created_at, evaluated_at
       FROM skill_formalization_candidate WHERE capability_fingerprint = $1`,
      [capabilityFingerprint],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapFormalizationCandidateRow(row);
  }

  async findFormalizationCandidateById(
    candidateId: string,
  ): Promise<SkillFormalizationCandidate | undefined> {
    const result = await this.#pool.query<FormalizationCandidateRow>(
      `SELECT candidate_id, capability_fingerprint, successful_experience_count,
              required_success_threshold, source_experience_ids_json, status,
              induction_report_json, validation_report_json, proposed_skill_json,
              published_skill_id, published_skill_version, created_at, evaluated_at
       FROM skill_formalization_candidate WHERE candidate_id = $1`,
      [candidateId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapFormalizationCandidateRow(row);
  }

  async saveFormalizationCandidate(candidate: SkillFormalizationCandidate): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_formalization_candidate
         (candidate_id, capability_fingerprint, successful_experience_count,
          required_success_threshold, source_experience_ids_json, status,
          induction_report_json, validation_report_json, proposed_skill_json,
          published_skill_id, published_skill_version, created_at, evaluated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (capability_fingerprint) DO UPDATE SET
         successful_experience_count = EXCLUDED.successful_experience_count,
         source_experience_ids_json = EXCLUDED.source_experience_ids_json,
         status = EXCLUDED.status,
         induction_report_json = EXCLUDED.induction_report_json,
         validation_report_json = EXCLUDED.validation_report_json,
         proposed_skill_json = EXCLUDED.proposed_skill_json,
         published_skill_id = EXCLUDED.published_skill_id,
         published_skill_version = EXCLUDED.published_skill_version,
         evaluated_at = EXCLUDED.evaluated_at`,
      [
        candidate.candidateId,
        candidate.capabilityFingerprint,
        candidate.successfulExperienceCount,
        candidate.requiredSuccessThreshold,
        JSON.stringify(candidate.sourceExperienceIds),
        candidate.status,
        candidate.inductionReport === undefined ? null : JSON.stringify(candidate.inductionReport),
        candidate.validationReport === undefined
          ? null
          : JSON.stringify(candidate.validationReport),
        candidate.proposedSkill === undefined ? null : JSON.stringify(candidate.proposedSkill),
        candidate.publishedSkillId ?? null,
        candidate.publishedSkillVersion ?? null,
        candidate.createdAt,
        candidate.evaluatedAt ?? null,
      ],
    );
  }

  async saveCorrectionExperience(correction: SkillEvolutionCorrectionExperience): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_evolution_correction_experience
         (correction_id,candidate_id,capability_fingerprint,actor,summary,
          before_skill_json,after_skill_json,diff_json,validation_report_json,outcome,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        correction.correctionId,
        correction.candidateId,
        correction.capabilityFingerprint,
        correction.actor,
        correction.summary,
        JSON.stringify(correction.beforeSkill),
        JSON.stringify(correction.afterSkill),
        JSON.stringify(correction.diff),
        JSON.stringify(correction.validationReport),
        correction.outcome,
        correction.createdAt,
      ],
    );
  }

  async listCorrectionExperiences(
    candidateId: string,
  ): Promise<readonly SkillEvolutionCorrectionExperience[]> {
    const result = await this.#pool.query<SkillEvolutionCorrectionRow>(
      `SELECT correction_id,candidate_id,capability_fingerprint,actor,summary,
              before_skill_json,after_skill_json,diff_json,validation_report_json,outcome,created_at
       FROM skill_evolution_correction_experience
       WHERE candidate_id = $1 ORDER BY created_at,correction_id`,
      [candidateId],
    );
    return result.rows.map(mapSkillEvolutionCorrectionRow);
  }
}

const temporarySkillSelect = `SELECT temporary_skill_id, task_id, context_id, name,
  description, tools_json, input_schema_json, output_schema_json,
  capability_fingerprint, status, created_at, expired_at FROM temporary_skill`;

export class PostgresMcpRegistryRepository
  implements McpRegistryRepository, McpToolCatalog, McpTaskOperationCatalog
{
  readonly #pool: Pool;
  readonly #v11TaskMetadata: boolean;

  constructor(pool: Pool, options: Readonly<{ v11TaskMetadata?: boolean }> = {}) {
    this.#pool = pool;
    this.#v11TaskMetadata = options.v11TaskMetadata === true;
  }

  async findServer(serverId: string): Promise<McpServerRecord | undefined> {
    const result = await this.#pool.query<McpServerRow>(
      `SELECT server_id, name, endpoint, transport, status, tool_revision,
              encrypted_credential, created_at, updated_at
       FROM mcp_server WHERE server_id = $1`,
      [serverId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : { server: mapMcpServerRow(row), encryptedCredential: row.encrypted_credential };
  }

  async listServers(): Promise<readonly McpServer[]> {
    const result = await this.#pool.query<McpServerRow>(
      `SELECT server_id, name, endpoint, transport, status, tool_revision,
              encrypted_credential, created_at, updated_at
       FROM mcp_server ORDER BY server_id`,
    );
    return result.rows.map(mapMcpServerRow);
  }

  async listTools(serverId: string): Promise<readonly McpTool[]> {
    const result = await this.#pool.query<McpToolRow>(
      `SELECT server_id, tool_name, title, description, input_schema_json,
              enhancement_json, declared_execution_semantics_json,
              admin_execution_semantics_override_json, execution_semantics_json,
              discovered_at${this.#v11TaskMetadata ? ', task_execution_json' : ''}
       FROM mcp_tool WHERE server_id = $1 ORDER BY tool_name`,
      [serverId],
    );
    return result.rows.map(mapMcpToolRow);
  }

  async exists(reference: ToolReference): Promise<boolean> {
    const result = await this.#pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM mcp_tool t JOIN mcp_server s ON s.server_id = t.server_id
         WHERE t.server_id = $1 AND t.tool_name = $2 AND s.status = 'enabled'
       ) AS exists`,
      [reference.serverId, reference.toolName],
    );
    return result.rows[0]?.exists === true;
  }

  async getInputSchema(reference: ToolReference): Promise<unknown> {
    const result = await this.#pool.query<{ input_schema_json: unknown }>(
      `SELECT t.input_schema_json FROM mcp_tool t
       JOIN mcp_server s ON s.server_id=t.server_id
       WHERE t.server_id=$1 AND t.tool_name=$2 AND s.status='enabled'`,
      [reference.serverId, reference.toolName],
    );
    return result.rows[0]?.input_schema_json;
  }

  async getTaskOperationSemantics(
    reference: ToolReference,
  ): Promise<McpTaskOperationSemantics | undefined> {
    if (!this.#v11TaskMetadata) return undefined;
    const result = await this.#pool.query<{ task_execution_json: unknown }>(
      `SELECT t.task_execution_json FROM mcp_tool t
       JOIN mcp_server s ON s.server_id=t.server_id
       WHERE t.server_id=$1 AND t.tool_name=$2 AND s.status='enabled'`,
      [reference.serverId, reference.toolName],
    );
    const value = result.rows[0]?.task_execution_json;
    return value === undefined || value === null
      ? undefined
      : McpTaskOperationSemanticsSchema.parse(value);
  }

  async saveServerAndReplaceTools(
    record: McpServerRecord,
    tools: readonly McpTool[],
    changes: readonly McpToolDependencyChange[] = [],
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO mcp_server
           (server_id, name, endpoint, transport, status, tool_revision,
            encrypted_credential, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (server_id) DO UPDATE SET
           name = EXCLUDED.name, endpoint = EXCLUDED.endpoint,
           status = EXCLUDED.status, tool_revision = EXCLUDED.tool_revision,
           encrypted_credential = EXCLUDED.encrypted_credential,
           updated_at = EXCLUDED.updated_at`,
        [
          record.server.serverId,
          record.server.name,
          record.server.endpoint,
          record.server.transport,
          record.server.status,
          record.server.toolRevision,
          record.encryptedCredential,
          record.server.createdAt,
          record.server.updatedAt,
        ],
      );
      await client.query('DELETE FROM mcp_tool WHERE server_id = $1', [record.server.serverId]);
      for (const tool of tools) {
        await client.query(
          this.#v11TaskMetadata
            ? `INSERT INTO mcp_tool
                 (server_id,tool_name,title,description,input_schema_json,
                  enhancement_json,declared_execution_semantics_json,
                  admin_execution_semantics_override_json,execution_semantics_json,
                  discovered_at,task_execution_json)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`
            : `INSERT INTO mcp_tool
                 (server_id,tool_name,title,description,input_schema_json,
                  enhancement_json,declared_execution_semantics_json,
                  admin_execution_semantics_override_json,execution_semantics_json,discovered_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            tool.serverId,
            tool.toolName,
            tool.title ?? null,
            tool.description ?? null,
            JSON.stringify(tool.inputSchema),
            tool.enhancement === undefined ? null : JSON.stringify(tool.enhancement),
            tool.declaredExecutionSemantics === undefined
              ? null
              : JSON.stringify(tool.declaredExecutionSemantics),
            tool.adminExecutionSemanticsOverride === undefined
              ? null
              : JSON.stringify(tool.adminExecutionSemanticsOverride),
            JSON.stringify(tool.executionSemantics),
            tool.discoveredAt,
            ...(this.#v11TaskMetadata
              ? [tool.taskExecution === undefined ? null : JSON.stringify(tool.taskExecution)]
              : []),
          ],
        );
      }
      for (const change of changes) {
        await client.query(
          `INSERT INTO mcp_dependency_warning
             (warning_id, server_id, tool_name, reason, skill_id, skill_version,
              tool_revision, created_at)
           SELECT concat_ws(':', $1::text, $2::text, $3::text, s.skill_id, s.current_version::text, $4::text),
                  $1::text, $2::text, $3::text, s.skill_id, s.current_version, $4::integer, $5::timestamptz
           FROM skill s
           JOIN skill_version v ON v.skill_id = s.skill_id AND v.version = s.current_version
           WHERE v.status = 'enabled' AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(
               COALESCE(v.tool_policy_json->'required', '[]'::jsonb) ||
               COALESCE(v.tool_policy_json->'optional', '[]'::jsonb) ||
               COALESCE(v.tool_policy_json->'forbidden', '[]'::jsonb)
             ) reference
             WHERE reference->>'serverId' = $1::text AND reference->>'toolName' = $2::text
           )
           ON CONFLICT DO NOTHING`,
          [
            record.server.serverId,
            change.toolName,
            change.reason,
            record.server.toolRevision,
            record.server.updatedAt,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteServer(serverId: string): Promise<void> {
    await this.#pool.query('DELETE FROM mcp_server WHERE server_id = $1', [serverId]);
  }

  async saveInvocation(invocation: McpInvocation): Promise<void> {
    await this.#pool.query(
      `INSERT INTO mcp_invocation
         (invocation_id, task_id, context_id, execution_mode, simulation_id, server_id, tool_name, arguments_json,
          execution_semantics_json, result_json, status, error_code, error_message, started_at, completed_at, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        invocation.invocationId,
        invocation.taskId ?? null,
        invocation.contextId ?? null,
        invocation.executionMode,
        invocation.simulationId ?? null,
        invocation.serverId,
        invocation.toolName,
        JSON.stringify(invocation.arguments),
        JSON.stringify(invocation.executionSemantics),
        invocation.result === undefined ? null : JSON.stringify(invocation.result),
        invocation.status,
        invocation.errorCode ?? null,
        invocation.errorMessage ?? null,
        invocation.startedAt,
        invocation.completedAt,
        invocation.durationMs,
      ],
    );
  }

  async listInvocations(serverId: string): Promise<readonly McpInvocation[]> {
    const result = await this.#pool.query<McpInvocationRow>(
      `SELECT invocation_id, task_id, context_id, server_id, tool_name, arguments_json,
              execution_mode, simulation_id, execution_semantics_json, result_json, status, error_code, error_message, started_at, completed_at, duration_ms
       FROM mcp_invocation WHERE server_id = $1 ORDER BY started_at, invocation_id`,
      [serverId],
    );
    return result.rows.map(mapMcpInvocationRow);
  }

  async listInvocationsByTask(taskId: string): Promise<readonly McpInvocation[]> {
    const result = await this.#pool.query<McpInvocationRow>(
      `SELECT invocation_id, task_id, context_id, server_id, tool_name, arguments_json,
              execution_mode, simulation_id, execution_semantics_json, result_json, status, error_code, error_message, started_at, completed_at, duration_ms
       FROM mcp_invocation WHERE task_id = $1 ORDER BY started_at, invocation_id`,
      [taskId],
    );
    return result.rows.map(mapMcpInvocationRow);
  }

  async saveManagementOperation(operation: McpManagementOperation): Promise<void> {
    await this.#pool.query(
      `INSERT INTO mcp_management_operation
         (operation_id, server_id, operation_type, actor, target, summary_json, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        operation.operationId,
        operation.serverId,
        operation.operationType,
        operation.actor,
        operation.target ?? null,
        JSON.stringify(operation.summary),
        operation.occurredAt,
      ],
    );
  }

  async listManagementOperations(serverId: string): Promise<readonly McpManagementOperation[]> {
    const result = await this.#pool.query<McpManagementOperationRow>(
      `SELECT operation_id, server_id, operation_type, actor, target, summary_json, occurred_at
       FROM mcp_management_operation WHERE server_id = $1
       ORDER BY occurred_at, operation_id`,
      [serverId],
    );
    return result.rows.map(mapMcpManagementOperationRow);
  }

  async listDependencyWarnings(serverId: string): Promise<readonly McpDependencyWarning[]> {
    const result = await this.#pool.query<McpWarningRow>(
      `SELECT warning_id, server_id, tool_name, reason, skill_id, skill_version,
              tool_revision, created_at, acknowledged_at
       FROM mcp_dependency_warning WHERE server_id = $1 ORDER BY created_at, warning_id`,
      [serverId],
    );
    return result.rows.map(mapMcpWarningRow);
  }

  async updateToolEnhancement(
    serverId: string,
    toolName: string,
    enhancement: McpToolEnhancement,
  ): Promise<void> {
    await this.#pool.query(
      `UPDATE mcp_tool SET enhancement_json = $3
       WHERE server_id = $1 AND tool_name = $2`,
      [serverId, toolName, JSON.stringify(enhancement)],
    );
  }

  async updateToolExecutionSemantics(
    serverId: string,
    toolName: string,
    adminOverride: McpTool['executionSemantics'],
    effective: McpTool['executionSemantics'],
    operation: McpManagementOperation,
  ): Promise<boolean> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE mcp_tool
         SET admin_execution_semantics_override_json = $3,
             execution_semantics_json = $4
         WHERE server_id = $1 AND tool_name = $2`,
        [serverId, toolName, JSON.stringify(adminOverride), JSON.stringify(effective)],
      );
      if (updated.rowCount !== 1) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO mcp_management_operation
           (operation_id, server_id, operation_type, actor, target, summary_json, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          operation.operationId,
          operation.serverId,
          operation.operationType,
          operation.actor,
          operation.target ?? null,
          JSON.stringify(operation.summary),
          operation.occurredAt,
        ],
      );
      await client.query('COMMIT');
      return true;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const skillVersionSelect = `SELECT
  v.skill_id, v.version, v.name, v.summary, v.description, v.capabilities_json,
  v.workflow_guidance, v.output_instruction, v.input_schema_json, v.output_schema_json,
  v.tool_policy_json, v.runtime_policy_json, v.status, v.source_kind,
  v.validation_passed, v.previous_version, v.created_at
  FROM skill_version v`;

export class PostgresSkillDraftRepository implements SkillDraftRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findById(draftId: string): Promise<SkillDraft | undefined> {
    const result = await this.#pool.query<SkillDraftRow>(
      `SELECT draft_id, task_id, context_id, requested_by, intent, request_text,
              status, published_skill_id, published_skill_version, published_by, published_at,
              created_at, updated_at
       FROM skill_draft WHERE draft_id = $1`,
      [draftId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapSkillDraftRow(row);
  }

  async listByContextId(contextId: string): Promise<readonly SkillDraft[]> {
    const result = await this.#pool.query<SkillDraftRow>(
      `SELECT draft_id, task_id, context_id, requested_by, intent, request_text,
              status, published_skill_id, published_skill_version, published_by, published_at,
              created_at, updated_at
       FROM skill_draft WHERE context_id = $1 ORDER BY created_at, draft_id`,
      [contextId],
    );
    return result.rows.map(mapSkillDraftRow);
  }

  async save(draft: SkillDraft): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_draft
         (draft_id, task_id, context_id, requested_by, intent, request_text,
          status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (draft_id) DO UPDATE SET
         request_text = EXCLUDED.request_text, updated_at = EXCLUDED.updated_at`,
      [
        draft.draftId,
        draft.taskId,
        draft.contextId,
        draft.requestedBy,
        draft.intent,
        draft.requestText,
        draft.status,
        draft.createdAt,
        draft.updatedAt,
      ],
    );
  }

  async markPublished(
    draftId: string,
    publication: Readonly<{
      skillId: string;
      version: number;
      publishedBy: string;
      publishedAt: string;
    }>,
  ): Promise<SkillDraft> {
    const result = await this.#pool.query<SkillDraftRow>(
      `UPDATE skill_draft SET status='published', published_skill_id=$2,
         published_skill_version=$3, published_by=$4, published_at=$5, updated_at=$5
       WHERE draft_id=$1 AND status='draft'
       RETURNING draft_id,task_id,context_id,requested_by,intent,request_text,status,
         published_skill_id,published_skill_version,published_by,published_at,created_at,updated_at`,
      [
        draftId,
        publication.skillId,
        publication.version,
        publication.publishedBy,
        publication.publishedAt,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('SKILL_DRAFT_NOT_DRAFT');
    return mapSkillDraftRow(row);
  }
}

function mapSkillDraftRow(row: SkillDraftRow): SkillDraft {
  return {
    draftId: row.draft_id,
    taskId: row.task_id,
    contextId: row.context_id,
    requestedBy: row.requested_by,
    intent: row.intent,
    requestText: row.request_text,
    status: row.status,
    ...(row.published_skill_id === null ? {} : { publishedSkillId: row.published_skill_id }),
    ...(row.published_skill_version === null
      ? {}
      : { publishedSkillVersion: row.published_skill_version }),
    ...(row.published_by === null ? {} : { publishedBy: row.published_by }),
    ...(row.published_at === null ? {} : { publishedAt: toIsoString(row.published_at) }),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapSkillQualityObservationRow(row: SkillQualityObservationRow): SkillQualityObservation {
  return {
    observationId: row.observation_id,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    evaluationRef: row.evaluation_ref,
    score: row.score,
    successful: row.successful,
    createdAt: toIsoString(row.created_at),
  };
}

function mapSkillQualityWarningRow(row: SkillQualityWarningRow): SkillQualityWarning {
  return {
    warningId: row.warning_id,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    kind: row.kind,
    observationIds: z.array(z.string()).parse(row.observation_ids_json),
    observedValue: row.observed_value,
    threshold: row.threshold,
    summary: row.summary,
    status: row.status,
    skillStatusAtCreation: row.skill_status_at_creation,
    createdAt: toIsoString(row.created_at),
  };
}

function mapWorkflowTemplateOccurrenceRow(
  row: WorkflowTemplateOccurrenceRow,
): WorkflowTemplateOccurrence {
  return {
    experienceId: row.experience_id,
    ...(row.quality_report_id === null ? {} : { qualityReportId: row.quality_report_id }),
    goalKey: row.goal_key,
    structureKey: row.structure_key,
    workflow: StoredWorkflowDefinitionSchema.parse(row.workflow_json) as WorkflowDefinition,
    durationMs: row.duration_ms,
    createdAt: toIsoString(row.created_at),
  };
}

function mapWorkflowTemplateRow(row: WorkflowTemplateRow): WorkflowTemplate {
  return {
    templateId: row.template_id,
    version: row.version,
    goalKey: row.goal_key,
    structureKey: row.structure_key,
    workflow: StoredWorkflowDefinitionSchema.parse(row.workflow_json) as WorkflowDefinition,
    sourceExperienceIds: z.array(z.string()).parse(row.source_experience_ids_json),
    sourceSuccessCount: row.source_success_count,
    useCount: row.use_count,
    successfulUseCount: row.successful_use_count,
    averageUseDurationMs: row.average_use_duration_ms,
    status: row.status,
    createdAt: toIsoString(row.created_at),
  };
}

function mapWorkflowTemplateUseRow(row: WorkflowTemplateUseRow): WorkflowTemplateUse {
  return {
    useId: row.use_id,
    templateId: row.template_id,
    templateVersion: row.template_version,
    planId: row.plan_id,
    workflowDefinitionId: row.workflow_definition_id,
    workflowVersion: row.workflow_version,
    status: row.status,
    ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
    createdAt: toIsoString(row.created_at),
    ...(row.completed_at === null ? {} : { completedAt: toIsoString(row.completed_at) }),
  };
}

function mapSkillVersionRow(row: SkillVersionRow): SkillVersion {
  const toolPolicy = ToolPolicySchema.parse(row.tool_policy_json);
  const parsedRuntimePolicy = RuntimePolicySchema.parse(row.runtime_policy_json);
  const runtimePolicy: SkillRuntimePolicy = {
    autoConfirmPlan: parsedRuntimePolicy.autoConfirmPlan,
    ...(parsedRuntimePolicy.maxReplans === undefined
      ? {}
      : { maxReplans: parsedRuntimePolicy.maxReplans }),
    ...(parsedRuntimePolicy.maxDurationSeconds === undefined
      ? {}
      : { maxDurationSeconds: parsedRuntimePolicy.maxDurationSeconds }),
    ...(parsedRuntimePolicy.maxLlmCalls === undefined
      ? {}
      : { maxLlmCalls: parsedRuntimePolicy.maxLlmCalls }),
    ...(parsedRuntimePolicy.maxMcpCalls === undefined
      ? {}
      : { maxMcpCalls: parsedRuntimePolicy.maxMcpCalls }),
    ...(parsedRuntimePolicy.maxCost === undefined ? {} : { maxCost: parsedRuntimePolicy.maxCost }),
    ...(parsedRuntimePolicy.pauseReplanThresholdSeconds === undefined
      ? {}
      : { pauseReplanThresholdSeconds: parsedRuntimePolicy.pauseReplanThresholdSeconds }),
    ...(parsedRuntimePolicy.cancelStrategy === undefined
      ? {}
      : { cancelStrategy: parsedRuntimePolicy.cancelStrategy }),
    ...(parsedRuntimePolicy.compensationGuidance === undefined
      ? {}
      : { compensationGuidance: parsedRuntimePolicy.compensationGuidance }),
  };
  return {
    skillId: row.skill_id,
    version: row.version,
    name: row.name,
    summary: row.summary,
    description: row.description,
    capabilities: CapabilitiesSchema.parse(row.capabilities_json),
    workflowGuidance: row.workflow_guidance,
    outputInstruction: row.output_instruction,
    inputSchema: row.input_schema_json,
    outputSchema: row.output_schema_json,
    toolPolicy,
    runtimePolicy,
    status: row.status,
    sourceKind: row.source_kind,
    validationPassed: row.validation_passed,
    ...(row.previous_version === null ? {} : { previousVersion: row.previous_version }),
    createdAt: toIsoString(row.created_at),
  };
}

function mapSkillSelectionRow(row: SkillSelectionRow): SkillSelectionRecord {
  return {
    selectionId: row.selection_id,
    goalContract: GoalExecutionContractSchema.parse(row.goal_contract_json),
    goalDescription: row.goal_description,
    candidates: z
      .array(SkillCandidateSchema)
      .parse(row.candidates_json) as unknown as SkillSelectionRecord['candidates'],
    selectedSkillId: row.selected_skill_id,
    selectedSkillVersion: row.selected_skill_version,
    decisionSummary: row.decision_summary,
    createdAt: toIsoString(row.created_at),
  };
}

function temporarySkillParameters(skill: TemporarySkill): unknown[] {
  return [
    skill.temporarySkillId,
    skill.taskId,
    skill.contextId,
    skill.name,
    skill.description,
    JSON.stringify(skill.tools),
    JSON.stringify(skill.inputSchema),
    JSON.stringify(skill.outputSchema),
    skill.capabilityFingerprint,
    skill.status,
    skill.createdAt,
    skill.expiredAt ?? null,
  ];
}

function vectorLiteral(vector: readonly number[]): string {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error('SKILL_EMBEDDING_VECTOR_INVALID');
  }
  return `[${vector.join(',')}]`;
}

function mapTemporarySkillRow(row: TemporarySkillRow): TemporarySkill {
  return {
    temporarySkillId: row.temporary_skill_id,
    taskId: row.task_id,
    contextId: row.context_id,
    name: row.name,
    description: row.description,
    tools: ToolReferencesSchema.parse(row.tools_json),
    inputSchema: row.input_schema_json,
    outputSchema: row.output_schema_json,
    capabilityFingerprint: row.capability_fingerprint,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    ...(row.expired_at === null ? {} : { expiredAt: toIsoString(row.expired_at) }),
  };
}

function mapTemporaryExperienceRow(row: TemporaryExperienceRow): TemporarySkillExperience {
  return {
    experienceId: row.experience_id,
    temporarySkillId: row.temporary_skill_id,
    taskId: row.task_id,
    contextId: row.context_id,
    capabilityFingerprint: row.capability_fingerprint,
    successful: row.successful,
    outcomeSummary: row.outcome_summary,
    createdAt: toIsoString(row.created_at),
  };
}

function mapSkillEvolutionCorrectionRow(
  row: SkillEvolutionCorrectionRow,
): SkillEvolutionCorrectionExperience {
  return {
    correctionId: row.correction_id,
    candidateId: row.candidate_id,
    capabilityFingerprint: row.capability_fingerprint,
    actor: row.actor,
    summary: row.summary,
    beforeSkill: ProposedEvolutionSkillSchema.parse(row.before_skill_json),
    afterSkill: ProposedEvolutionSkillSchema.parse(row.after_skill_json),
    diff: z
      .array(z.object({ path: z.string(), before: z.unknown(), after: z.unknown() }))
      .parse(row.diff_json),
    validationReport: SkillSimulationReportSchema.parse(row.validation_report_json),
    outcome: row.outcome,
    createdAt: toIsoString(row.created_at),
  };
}

function mapFormalizationCandidateRow(row: FormalizationCandidateRow): SkillFormalizationCandidate {
  return {
    candidateId: row.candidate_id,
    capabilityFingerprint: row.capability_fingerprint,
    successfulExperienceCount: row.successful_experience_count,
    requiredSuccessThreshold: row.required_success_threshold,
    sourceExperienceIds: z.array(z.string()).parse(row.source_experience_ids_json),
    status: row.status,
    ...(row.induction_report_json === null
      ? {}
      : {
          inductionReport: SkillInductionReportSchema.parse(
            row.induction_report_json,
          ) as SkillInductionReport,
        }),
    ...(row.validation_report_json === null
      ? {}
      : { validationReport: SkillSimulationReportSchema.parse(row.validation_report_json) }),
    ...(row.proposed_skill_json === null
      ? {}
      : { proposedSkill: ProposedEvolutionSkillSchema.parse(row.proposed_skill_json) }),
    ...(row.published_skill_id === null ? {} : { publishedSkillId: row.published_skill_id }),
    ...(row.published_skill_version === null
      ? {}
      : { publishedSkillVersion: row.published_skill_version }),
    createdAt: toIsoString(row.created_at),
    ...(row.evaluated_at === null ? {} : { evaluatedAt: toIsoString(row.evaluated_at) }),
  };
}

function mapMcpServerRow(row: McpServerRow): McpServer {
  return {
    serverId: row.server_id,
    name: row.name,
    endpoint: row.endpoint,
    transport: row.transport,
    status: row.status,
    toolRevision: row.tool_revision,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapModelProviderRow(row: ModelProviderRow): ModelProviderRecord {
  return {
    configuration: {
      providerId: row.provider_id,
      name: row.name,
      kind: row.kind,
      apiStyle: row.api_style,
      baseUrl: row.base_url,
      model: row.model,
      enabled: row.enabled,
      timeoutMs: row.timeout_ms,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
    },
    encryptedCredential: row.encrypted_credential,
  };
}

function mapModelInvocationRow(row: ModelInvocationRow): ModelInvocationRecord {
  return {
    invocationId: row.invocation_id,
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    stage: row.stage,
    providerId: row.provider_id,
    model: row.model,
    operation: row.operation,
    ...(row.prompt_id === null ? {} : { promptId: row.prompt_id }),
    ...(row.prompt_version === null ? {} : { promptVersion: row.prompt_version }),
    request: row.request_json,
    context: row.context_json,
    ...(row.raw_response_json === null ? {} : { rawResponse: row.raw_response_json }),
    ...(row.structured_result_json === null
      ? {}
      : { structuredResult: row.structured_result_json }),
    ...(row.input_tokens === null ? {} : { inputTokens: row.input_tokens }),
    ...(row.output_tokens === null ? {} : { outputTokens: row.output_tokens }),
    durationMs: row.duration_ms,
    status: row.status,
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    createdAt: toIsoString(row.created_at),
  };
}

function mapPromptVersionRow(row: PromptVersionRow): PromptVersion {
  return {
    promptId: row.prompt_id,
    stage: row.stage,
    version: row.version,
    ...(row.previous_version === null ? {} : { previousVersion: row.previous_version }),
    content: row.content,
    status: row.status,
    source: row.source,
    createdAt: toIsoString(row.created_at),
  };
}

function mapMcpToolRow(row: McpToolRow): McpTool {
  return createMcpTool({
    serverId: row.server_id,
    toolName: row.tool_name,
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.description === null ? {} : { description: row.description }),
    inputSchema: row.input_schema_json,
    ...(row.enhancement_json === null
      ? {}
      : { enhancement: McpEnhancementSchema.parse(row.enhancement_json) }),
    ...(row.declared_execution_semantics_json === null
      ? {}
      : {
          declaredExecutionSemantics: parseMcpExecutionSemantics(
            row.declared_execution_semantics_json,
            'mcp_declared',
          ),
        }),
    ...(row.admin_execution_semantics_override_json === null
      ? {}
      : {
          adminExecutionSemanticsOverride: parseMcpExecutionSemantics(
            row.admin_execution_semantics_override_json,
            'admin_override',
          ),
        }),
    executionSemantics: parseMcpExecutionSemantics(row.execution_semantics_json),
    ...(row.task_execution_json === undefined || row.task_execution_json === null
      ? {}
      : { taskExecution: McpTaskOperationSemanticsSchema.parse(row.task_execution_json) }),
    discoveredAt: toIsoString(row.discovered_at),
  });
}

function mapMcpWarningRow(row: McpWarningRow): McpDependencyWarning {
  return {
    warningId: row.warning_id,
    serverId: row.server_id,
    toolName: row.tool_name,
    reason: row.reason,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    toolRevision: row.tool_revision,
    createdAt: toIsoString(row.created_at),
    ...(row.acknowledged_at === null ? {} : { acknowledgedAt: toIsoString(row.acknowledged_at) }),
  };
}

function mapMcpInvocationRow(row: McpInvocationRow): McpInvocation {
  return {
    invocationId: row.invocation_id,
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    ...(row.context_id === null ? {} : { contextId: row.context_id }),
    executionMode: row.execution_mode,
    ...(row.simulation_id === null ? {} : { simulationId: row.simulation_id }),
    serverId: row.server_id,
    toolName: row.tool_name,
    executionSemantics: parseMcpExecutionSemantics(row.execution_semantics_json),
    arguments: row.arguments_json,
    ...(row.result_json === null ? {} : { result: row.result_json }),
    status: row.status,
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
    durationMs: row.duration_ms,
  };
}

function parseMcpExecutionSemantics(
  value: unknown,
  expectedSource?: McpTool['executionSemantics']['source'],
): McpTool['executionSemantics'] {
  const parsed = McpExecutionSemanticsSchema.parse(value);
  if (expectedSource !== undefined && parsed.source !== expectedSource) {
    throw new DomainError(
      'MCP_TOOL_EXECUTION_SEMANTICS_INVALID',
      'Persisted MCP Tool execution semantics use an invalid authority source.',
    );
  }
  return createMcpToolExecutionSemantics(parsed, parsed.source);
}

function mapMcpManagementOperationRow(row: McpManagementOperationRow): McpManagementOperation {
  return {
    operationId: row.operation_id,
    serverId: row.server_id,
    operationType: row.operation_type,
    actor: row.actor,
    ...(row.target === null ? {} : { target: row.target }),
    summary: row.summary_json,
    occurredAt: toIsoString(row.occurred_at),
  };
}

function mapProjectionRow(row: ProjectionRow): ExternalTaskProjection {
  return {
    protocol: row.protocol,
    taskId: row.task_id,
    contextId: row.context_id,
    state: row.state,
    ...(row.status_timestamp === null
      ? {}
      : { statusTimestamp: toIsoString(row.status_timestamp) }),
    document: row.document_json,
  };
}

function mapTaskRow(row: TaskRow): AgentTask {
  const output =
    row.output_text === null
      ? {}
      : { output: { text: row.output_text, structured: row.output_structured } };
  const capabilityGap =
    row.capability_gap_json === null
      ? undefined
      : TaskCapabilityGapSchema.parse(row.capability_gap_json);
  if (
    row.phase === 'capability_gap' &&
    (capabilityGap === undefined || row.error_code !== 'CAPABILITY_GAP')
  )
    throw new Error('TASK_CAPABILITY_GAP_TERMINAL_EVIDENCE_INVALID');
  return {
    taskId: row.task_id,
    contextId: row.context_id,
    userId: row.user_id,
    requestText: row.request_text,
    requestMetadata: row.request_metadata,
    phase: row.phase,
    phaseMessage: row.phase_message,
    ...(row.goal_id === null ? {} : { goalId: row.goal_id }),
    ...(row.goal_version === null ? {} : { goalVersion: row.goal_version }),
    ...(row.plan_id === null ? {} : { planId: row.plan_id }),
    ...(row.selected_skill_id === null ? {} : { selectedSkillId: row.selected_skill_id }),
    ...(row.selected_skill_version === null
      ? {}
      : { selectedSkillVersion: row.selected_skill_version }),
    ...(row.skill_selection_id === null ? {} : { skillSelectionId: row.skill_selection_id }),
    ...(row.skill_input_resolution_id === null
      ? {}
      : { skillInputResolutionId: row.skill_input_resolution_id }),
    ...(row.temporary_skill_id === null ? {} : { temporarySkillId: row.temporary_skill_id }),
    ...output,
    ...(capabilityGap === undefined ? {} : { capabilityGap }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

const TaskCapabilityGapSchema = z
  .object({
    evaluationSummary: z.string().min(1),
    missingCapability: z.string().min(1),
    suggestedToolContract: z
      .object({
        name: z.string().min(1),
        description: z.string().min(1),
        inputSchema: z.unknown(),
      })
      .strict(),
  })
  .strict();

function mapGoalRow(row: GoalRow): Goal {
  return {
    goalId: row.goal_id,
    contextId: row.context_id,
    version: row.version,
    title: row.title,
    description: row.description,
    constraints: StringArraySchema.parse(row.constraints_json),
    successCriteria: StringArraySchema.parse(row.success_criteria_json),
    status: row.status,
    ...(row.previous_goal_id === null ? {} : { previousGoalId: row.previous_goal_id }),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error('POSTGRES_TIMESTAMP_INVALID');
  return date.toISOString();
}

async function relationExists(client: PoolClient, relationName: string): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [relationName],
  );
  return result.rows[0]?.present === true;
}
