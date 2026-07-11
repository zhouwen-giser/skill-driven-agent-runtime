import type {
  AgentTaskRepository,
  ConversationContextRepository,
  ExternalTaskProjection,
  ExternalTaskProjectionQuery,
  ExternalTaskProjectionRepository,
  McpRegistryRepository,
  McpToolCatalog,
  McpServerRecord,
  ModelProviderRecord,
  ModelRuntimeRepository,
  PromptRepository,
  WorkflowPlanRepository,
  WorkflowExecutionRepository,
  RuntimeEventPublisher,
  RuntimeTaskEvent,
  SkillDraftRepository,
  SkillGraphRepository,
  SkillEmbeddingRepository,
  SkillSelectionRepository,
  TemporarySkillRepository,
  SkillRepository,
} from '../../application/src/index.js';
import type {
  AgentTask,
  ConversationContext,
  McpDependencyWarning,
  McpInvocation,
  McpServer,
  McpTool,
  McpToolDependencyChange,
  McpToolEnhancement,
  ModelInvocationRecord,
  ModelStage,
  PromptEffectSummary,
  PromptVersion,
  WorkflowDefinition,
  WorkflowPlanAttempt,
  WorkflowPlanRecord,
  WorkflowInstance,
  WorkflowNodeEvent,
  Skill,
  SkillRelation,
  SkillPerformanceMetrics,
  SkillReplacementPlan,
  SkillSelectionRecord,
  SkillFormalizationCandidate,
  TemporarySkill,
  TemporarySkillExperience,
  ToolReference,
  SkillDraft,
  SkillRuntimePolicy,
  SkillVersion,
  TaskPhase,
} from '../../domain/src/index.js';
import type { Pool, QueryResultRow } from 'pg';
import { z } from 'zod';

const ToolReferenceSchema = z.object({ serverId: z.string(), toolName: z.string() });
const ToolReferencesSchema = z.array(ToolReferenceSchema);
const CapabilitiesSchema = z.array(z.string());
const ToolPolicySchema = z.object({
  required: z.array(ToolReferenceSchema),
  optional: z.array(ToolReferenceSchema),
  forbidden: z.array(ToolReferenceSchema),
});
const RuntimePolicySchema = z.object({
  autoConfirmPlan: z.boolean(),
  maxReplans: z.number().int().optional(),
  maxDurationSeconds: z.number().int().optional(),
  maxLlmCalls: z.number().int().optional(),
  maxMcpCalls: z.number().int().optional(),
  maxCost: z.number().optional(),
  pauseReplanThresholdSeconds: z.number().int().optional(),
  cancelStrategy: z.enum(['wait_current', 'try_interrupt', 'cleanup_workflow']).optional(),
  compensationGuidance: z.string().optional(),
});
const StringArraySchema = z.array(z.string());
const McpEnhancementSchema = z.object({
  purpose: z.string(),
  scenarios: StringArraySchema,
  constraints: StringArraySchema,
  returnDescription: z.string(),
  commonErrors: StringArraySchema,
  tags: StringArraySchema,
});
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
  semanticScore: z.number().min(0).max(1),
  metrics: SkillMetricsSchema,
});

interface ContextRow extends QueryResultRow {
  context_id: string;
  user_id: string;
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
  output_text: string | null;
  output_structured: unknown;
  error_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
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
  status: 'draft';
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

interface SkillSelectionRow extends QueryResultRow {
  selection_id: string;
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
  server_id: string;
  tool_name: string;
  arguments_json: Record<string, unknown>;
  result_json: unknown;
  status: McpInvocation['status'];
  error_code: string | null;
  error_message: string | null;
  started_at: Date | string;
  completed_at: Date | string;
  duration_ms: number;
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

export class PostgresAgentTaskRepository implements AgentTaskRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findById(taskId: string): Promise<AgentTask | undefined> {
    const result = await this.#pool.query<TaskRow>(
      `SELECT task_id, context_id, user_id, request_text, request_metadata,
              phase, phase_message, goal_id, goal_version,
              output_text, output_structured, error_code, created_at, updated_at
       FROM agent_task
       WHERE task_id = $1`,
      [taskId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapTaskRow(row);
  }

  async save(task: AgentTask): Promise<void> {
    await this.#pool.query(
      `INSERT INTO agent_task (
         task_id, context_id, user_id, request_text, request_metadata,
         phase, phase_message, goal_id, goal_version,
         output_text, output_structured, error_code, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (task_id) DO UPDATE SET
         request_text = EXCLUDED.request_text,
         request_metadata = EXCLUDED.request_metadata,
         phase = EXCLUDED.phase,
         phase_message = EXCLUDED.phase_message,
         goal_id = EXCLUDED.goal_id,
         goal_version = EXCLUDED.goal_version,
         output_text = EXCLUDED.output_text,
         output_structured = EXCLUDED.output_structured,
         error_code = EXCLUDED.error_code,
         updated_at = EXCLUDED.updated_at`,
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
        task.output?.text ?? null,
        task.output?.structured ?? null,
        task.errorCode ?? null,
        task.createdAt,
        task.updatedAt,
      ],
    );
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
         (selection_id, goal_description, candidates_json, selected_skill_id,
          selected_skill_version, decision_summary, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        record.selectionId,
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
      `SELECT selection_id, goal_description, candidates_json, selected_skill_id,
              selected_skill_version, decision_summary, created_at
       FROM skill_selection_record WHERE selection_id = $1`,
      [selectionId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapSkillSelectionRow(row);
  }

  async saveReplacementPlan(plan: SkillReplacementPlan): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_replacement_plan
         (replacement_plan_id, selection_id, failed_skill_id, candidates_json,
          replacement_skill_id, replacement_skill_version, decision_summary, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        plan.replacementPlanId,
        plan.selectionId,
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

  async saveProvider(record: ModelProviderRecord): Promise<void> {
    const value = record.configuration;
    await this.#pool.query(
      `INSERT INTO model_provider
       (provider_id,name,kind,base_url,model,enabled,timeout_ms,encrypted_credential,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (provider_id) DO UPDATE SET
         name=EXCLUDED.name, kind=EXCLUDED.kind, base_url=EXCLUDED.base_url,
         model=EXCLUDED.model, enabled=EXCLUDED.enabled, timeout_ms=EXCLUDED.timeout_ms,
         encrypted_credential=EXCLUDED.encrypted_credential, updated_at=EXCLUDED.updated_at`,
      [
        value.providerId,
        value.name,
        value.kind,
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
       (invocation_id,stage,provider_id,model,operation,prompt_id,prompt_version,request_json,context_json,raw_response_json,
        structured_result_json,input_tokens,output_tokens,duration_ms,status,error_code,error_message,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18)`,
      [
        invocation.invocationId,
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

interface WorkflowPlanRow extends QueryResultRow {
  plan_id: string;
  goal_id: string;
  goal_version: number;
  definition_json: unknown;
  source_confirmed_plan_id: string | null;
  confirmation_status: WorkflowPlanRecord['confirmationStatus'];
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
      confirmationStatus: row.confirmation_status,
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
  async confirmPlan(planId: string): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE workflow_plan SET confirmation_status='confirmed'
       WHERE plan_id=$1 AND definition_json IS NOT NULL AND confirmation_status='awaiting_confirmation'`,
      [planId],
    );
    if (result.rowCount !== 1) throw new Error('WORKFLOW_PLAN_CONFIRMATION_FAILED');
  }
  async saveAttempt(attempt: WorkflowPlanAttempt): Promise<void> {
    await this.#pool.query(
      `INSERT INTO workflow_plan_attempt(plan_id,attempt,candidate_json,validation_errors_json,valid,created_at)
       VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6)`,
      [
        attempt.planId,
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
      `INSERT INTO workflow_plan(plan_id,goal_id,goal_version,definition_json,source_confirmed_plan_id,confirmation_status,attempt_count,created_at)
       VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)`,
      [
        plan.planId,
        plan.goalId,
        plan.goalVersion,
        plan.definition === undefined ? null : JSON.stringify(plan.definition),
        plan.sourceConfirmedPlanId ?? null,
        plan.confirmationStatus,
        plan.attemptCount,
        plan.createdAt,
      ],
    );
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

export class PostgresWorkflowExecutionRepository implements WorkflowExecutionRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
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
    };
  }

  async saveInstance(instance: WorkflowInstance): Promise<void> {
    await this.#pool.query(
      `INSERT INTO workflow_instance(
         instance_id,plan_id,workflow_definition_id,workflow_version,goal_id,goal_version,
         status,input_json,result_json,errors_json,started_at,completed_at,
         skill_versions_json,budget_limits_json,budget_usage_json,termination_reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16)
       ON CONFLICT(instance_id) DO UPDATE SET
         status=EXCLUDED.status,
         result_json=EXCLUDED.result_json,
         errors_json=EXCLUDED.errors_json,
         completed_at=EXCLUDED.completed_at,
         budget_usage_json=EXCLUDED.budget_usage_json,
         termination_reason=EXCLUDED.termination_reason`,
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
             event_id,instance_id,sequence,node_id,event_type,event_timestamp,summary)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            event.eventId,
            event.instanceId,
            event.sequence,
            event.nodeId,
            event.eventType,
            event.timestamp,
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

function mapWorkflowPlanRow(row: WorkflowPlanRow): WorkflowPlanRecord {
  return {
    planId: row.plan_id,
    goalId: row.goal_id,
    goalVersion: row.goal_version,
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
    confirmationStatus: row.confirmation_status,
    attemptCount: row.attempt_count,
    createdAt: toIsoString(row.created_at),
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
              required_success_threshold, source_experience_ids_json, status, created_at
       FROM skill_formalization_candidate WHERE capability_fingerprint = $1`,
      [capabilityFingerprint],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapFormalizationCandidateRow(row);
  }

  async saveFormalizationCandidate(candidate: SkillFormalizationCandidate): Promise<void> {
    await this.#pool.query(
      `INSERT INTO skill_formalization_candidate
         (candidate_id, capability_fingerprint, successful_experience_count,
          required_success_threshold, source_experience_ids_json, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (capability_fingerprint) DO NOTHING`,
      [
        candidate.candidateId,
        candidate.capabilityFingerprint,
        candidate.successfulExperienceCount,
        candidate.requiredSuccessThreshold,
        JSON.stringify(candidate.sourceExperienceIds),
        candidate.status,
        candidate.createdAt,
      ],
    );
  }
}

const temporarySkillSelect = `SELECT temporary_skill_id, task_id, context_id, name,
  description, tools_json, input_schema_json, output_schema_json,
  capability_fingerprint, status, created_at, expired_at FROM temporary_skill`;

export class PostgresMcpRegistryRepository implements McpRegistryRepository, McpToolCatalog {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
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
              enhancement_json, discovered_at
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
          `INSERT INTO mcp_tool
             (server_id, tool_name, title, description, input_schema_json,
              enhancement_json, discovered_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            tool.serverId,
            tool.toolName,
            tool.title ?? null,
            tool.description ?? null,
            JSON.stringify(tool.inputSchema),
            tool.enhancement === undefined ? null : JSON.stringify(tool.enhancement),
            tool.discoveredAt,
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
         (invocation_id, task_id, context_id, server_id, tool_name, arguments_json,
          result_json, status, error_code, error_message, started_at, completed_at, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        invocation.invocationId,
        invocation.taskId ?? null,
        invocation.contextId ?? null,
        invocation.serverId,
        invocation.toolName,
        JSON.stringify(invocation.arguments),
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
              result_json, status, error_code, error_message, started_at, completed_at, duration_ms
       FROM mcp_invocation WHERE server_id = $1 ORDER BY started_at, invocation_id`,
      [serverId],
    );
    return result.rows.map(mapMcpInvocationRow);
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
              status, created_at, updated_at
       FROM skill_draft WHERE draft_id = $1`,
      [draftId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapSkillDraftRow(row);
  }

  async listByContextId(contextId: string): Promise<readonly SkillDraft[]> {
    const result = await this.#pool.query<SkillDraftRow>(
      `SELECT draft_id, task_id, context_id, requested_by, intent, request_text,
              status, created_at, updated_at
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
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
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
    goalDescription: row.goal_description,
    candidates: z.array(SkillCandidateSchema).parse(row.candidates_json),
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

function mapFormalizationCandidateRow(row: FormalizationCandidateRow): SkillFormalizationCandidate {
  return {
    candidateId: row.candidate_id,
    capabilityFingerprint: row.capability_fingerprint,
    successfulExperienceCount: row.successful_experience_count,
    requiredSuccessThreshold: row.required_success_threshold,
    sourceExperienceIds: z.array(z.string()).parse(row.source_experience_ids_json),
    status: row.status,
    createdAt: toIsoString(row.created_at),
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
  return {
    serverId: row.server_id,
    toolName: row.tool_name,
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.description === null ? {} : { description: row.description }),
    inputSchema: row.input_schema_json,
    ...(row.enhancement_json === null
      ? {}
      : { enhancement: McpEnhancementSchema.parse(row.enhancement_json) }),
    discoveredAt: toIsoString(row.discovered_at),
  };
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
    serverId: row.server_id,
    toolName: row.tool_name,
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
    ...output,
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error('POSTGRES_TIMESTAMP_INVALID');
  return date.toISOString();
}
