import type {
  AgentTaskRepository,
  ConversationContextRepository,
  ExternalTaskProjection,
  ExternalTaskProjectionQuery,
  ExternalTaskProjectionRepository,
  McpRegistryRepository,
  McpServerRecord,
  RuntimeEventPublisher,
  RuntimeTaskEvent,
  SkillDraftRepository,
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
  Skill,
  SkillDraft,
  SkillRuntimePolicy,
  SkillVersion,
  TaskPhase,
} from '../../domain/src/index.js';
import type { Pool, QueryResultRow } from 'pg';
import { z } from 'zod';

const ToolReferenceSchema = z.object({ serverId: z.string(), toolName: z.string() });
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

  async listEnabledVersions(): Promise<readonly SkillVersion[]> {
    const result = await this.#pool.query<SkillVersionRow>(
      `${skillVersionSelect}
       JOIN skill s ON s.skill_id = v.skill_id AND s.current_version = v.version
       WHERE v.status = 'enabled' ORDER BY v.skill_id`,
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

export class PostgresMcpRegistryRepository implements McpRegistryRepository {
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

  async listTools(serverId: string): Promise<readonly McpTool[]> {
    const result = await this.#pool.query<McpToolRow>(
      `SELECT server_id, tool_name, title, description, input_schema_json,
              enhancement_json, discovered_at
       FROM mcp_tool WHERE server_id = $1 ORDER BY tool_name`,
      [serverId],
    );
    return result.rows.map(mapMcpToolRow);
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
