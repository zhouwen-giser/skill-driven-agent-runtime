import type {
  AgentTask,
  ConversationContext,
  Goal,
  McpServer,
  McpDependencyWarning,
  McpInvocation,
  McpTool,
  McpToolEnhancement,
  McpToolDependencyChange,
  Skill,
  SkillDraft,
  SkillVersion,
} from '../../domain/src/index.js';

export interface ConversationContextRepository {
  findById(contextId: string): Promise<ConversationContext | undefined>;
  save(context: ConversationContext): Promise<void>;
}

export interface GoalRepository {
  findActiveByContextId(contextId: string): Promise<Goal | undefined>;
  save(goal: Goal): Promise<void>;
}

export interface AgentTaskRepository {
  findById(taskId: string): Promise<AgentTask | undefined>;
  save(task: AgentTask): Promise<void>;
}

export interface SkillDraftRepository {
  findById(draftId: string): Promise<SkillDraft | undefined>;
  listByContextId(contextId: string): Promise<readonly SkillDraft[]>;
  save(draft: SkillDraft): Promise<void>;
}

export interface SkillRepository {
  find(skillId: string): Promise<Skill | undefined>;
  findCurrentVersion(skillId: string): Promise<SkillVersion | undefined>;
  findVersion(skillId: string, version: number): Promise<SkillVersion | undefined>;
  listEnabledVersions(): Promise<readonly SkillVersion[]>;
  saveVersionAndSetCurrent(version: SkillVersion, timestamp: string): Promise<void>;
}

export interface McpServerRecord {
  readonly server: McpServer;
  readonly encryptedCredential: string;
}

export interface McpRegistryRepository {
  findServer(serverId: string): Promise<McpServerRecord | undefined>;
  listTools(serverId: string): Promise<readonly McpTool[]>;
  saveServerAndReplaceTools(
    record: McpServerRecord,
    tools: readonly McpTool[],
    changes?: readonly McpToolDependencyChange[],
  ): Promise<void>;
  deleteServer(serverId: string): Promise<void>;
  saveInvocation(invocation: McpInvocation): Promise<void>;
  listInvocations(serverId: string): Promise<readonly McpInvocation[]>;
  listDependencyWarnings(serverId: string): Promise<readonly McpDependencyWarning[]>;
  updateToolEnhancement(
    serverId: string,
    toolName: string,
    enhancement: McpToolEnhancement,
  ): Promise<void>;
}

export interface SecretCipher {
  encrypt(secret: Readonly<Record<string, string>>): string;
  decrypt(encrypted: string): Readonly<Record<string, string>>;
}

export interface McpTransportAdapter {
  discover(
    input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>,
  ): Promise<
    readonly Readonly<{
      name: string;
      title?: string;
      description?: string;
      inputSchema: unknown;
    }>[]
  >;
  call(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
      toolName: string;
      arguments: Readonly<Record<string, unknown>>;
      signal?: AbortSignal;
    }>,
  ): Promise<unknown>;
  disconnect(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
    }>,
  ): Promise<void>;
}

/** Rebuildable protocol representation; AgentTask remains the system of record. */
export interface ExternalTaskProjection {
  readonly protocol: 'a2a-v1';
  readonly taskId: string;
  readonly contextId: string;
  readonly state: string;
  readonly statusTimestamp?: string;
  readonly document: unknown;
}

export interface ExternalTaskProjectionQuery {
  readonly protocol: ExternalTaskProjection['protocol'];
  readonly contextId?: string;
  readonly state?: string;
  readonly statusTimestampAfter?: string;
  readonly offset: number;
  readonly limit: number;
}

export interface ExternalTaskProjectionRepository {
  find(
    protocol: ExternalTaskProjection['protocol'],
    taskId: string,
  ): Promise<ExternalTaskProjection | undefined>;
  save(projection: ExternalTaskProjection): Promise<void>;
  list(
    query: ExternalTaskProjectionQuery,
  ): Promise<Readonly<{ items: readonly ExternalTaskProjection[]; total: number }>>;
}

export interface PublicSkillCapability {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
}

export interface EnabledSkillCapabilityProvider {
  listEnabled(): Promise<readonly PublicSkillCapability[]>;
}

export interface JsonSchemaValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface JsonSchemaValidator {
  checkSchema(schema: unknown): JsonSchemaValidationResult;
  validate(schema: unknown, value: unknown): JsonSchemaValidationResult;
}

export interface ContextTaskQueue {
  enqueue(input: Readonly<{ taskId: string; contextId: string }>): Promise<void>;
}

export interface RuntimeEventPublisher {
  publish(event: RuntimeTaskEvent): Promise<void>;
}

export interface RuntimeTaskEvent {
  readonly eventId: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly eventType: 'task.created' | 'task.phase_changed';
  readonly timestamp: string;
  readonly summary: string;
}

export interface Clock {
  now(): string;
}

export interface IdentifierGenerator {
  nextId(kind: 'context' | 'task' | 'event'): string;
}
