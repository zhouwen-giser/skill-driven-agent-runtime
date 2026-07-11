import { createHash, randomUUID } from 'node:crypto';
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
  McpRegistryService,
  ModelRuntimeService,
  SkillGraphService,
  SkillAuthoringService,
  SkillSelectionService,
  PersistedSkillSemanticRetriever,
  SkillRegistryService,
  TemporarySkillService,
  TaskService,
  type RegisterSkillVersionInput,
  type StructuredModelProvider,
  type SkillSelectionDecider,
  type TextEmbeddingProvider,
} from '../../../packages/application/src/index.js';
import type { SkillVersion } from '../../../packages/domain/src/index.js';
import { Aes256GcmSecretCipher } from '../../../packages/crypto-adapter/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { StreamableHttpMcpAdapter } from '../../../packages/mcp-adapter/src/index.js';
import { OpenAiCompatibleModelAdapter } from '../../../packages/model-provider-adapter/src/index.js';
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
  PostgresRuntimeEventPublisher,
  PostgresSkillDraftRepository,
  PostgresSkillEmbeddingRepository,
  PostgresSkillGraphRepository,
  PostgresSkillRepository,
  PostgresSkillSelectionRepository,
  PostgresTemporarySkillRepository,
} from '../../../packages/persistence-postgres/src/index.js';
import {
  BullMqContextTaskQueue,
  BullMqContextWorker,
  type RedisConnectionConfig,
} from '../../../packages/runtime-redis/src/index.js';

export interface ServerRuntimeOptions {
  readonly postgresUrl: string;
  readonly redis: RedisConnectionConfig;
  readonly mcpMasterKeyBase64: string;
  readonly queueName?: string;
  readonly applyMigrations?: boolean;
  readonly a2aHost?: string;
  readonly a2aPort?: number;
  readonly managementHost?: string;
  readonly managementPort?: number;
  readonly skillAuthoringModel?: StructuredModelProvider;
  readonly skillSelection?: Readonly<{
    embeddings: TextEmbeddingProvider;
    decider: SkillSelectionDecider;
  }>;
}

export interface ServerRuntimeHandle {
  readonly a2a: A2AHttpEndpointHandle;
  readonly management: ManagementHttpEndpointHandle;
  requestInput(taskId: string, reason: string): Promise<void>;
  listSkillDrafts(contextId: string): ReturnType<PostgresSkillDraftRepository['listByContextId']>;
  registerSkill(input: RegisterSkillVersionInput): Promise<SkillVersion>;
  setSkillEnabled(skillId: string, enabled: boolean): Promise<SkillVersion>;
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
  if (options.applyMigrations === true) await applyRuntimeMigrations(pool);
  const contexts = new PostgresConversationContextRepository(pool);
  const tasks = new PostgresAgentTaskRepository(pool);
  const events = new PostgresRuntimeEventPublisher(pool);
  const skillDrafts = new PostgresSkillDraftRepository(pool);
  const skills = new PostgresSkillRepository(pool);
  const skillGraphRepository = new PostgresSkillGraphRepository(pool);
  const skillSelectionRepository = new PostgresSkillSelectionRepository(pool);
  const mcpRepository = new PostgresMcpRegistryRepository(pool);
  const temporarySkillRepository = new PostgresTemporarySkillRepository(pool);
  const queueName = options.queueName ?? 'sdar-context-tasks';
  const queue = new BullMqContextTaskQueue({ connection: options.redis, queueName });
  const ids = { nextId: (kind: 'context' | 'task' | 'event') => `${kind}-${randomUUID()}` };
  const clock = { now: () => new Date().toISOString() };
  const modelRuntime = new ModelRuntimeService({
    repository: new PostgresModelRuntimeRepository(pool),
    transport: new OpenAiCompatibleModelAdapter(),
    cipher: new Aes256GcmSecretCipher(options.mcpMasterKeyBase64),
    clock,
    ids: { nextInvocationId: () => `model-invocation-${randomUUID()}` },
  });
  const service = new TaskService({ contexts, tasks, events, skillDrafts, queue, clock, ids });
  const schemaValidator = new AjvJsonSchemaValidator();
  const resultProcessor = new ResultProcessor(schemaValidator);
  const skillRegistry = new SkillRegistryService({ skills, validator: schemaValidator, clock });
  const skillAuthoring = new SkillAuthoringService({
    model: options.skillAuthoringModel ?? modelRuntime,
    schemas: schemaValidator,
    registry: skillRegistry,
    maxAttempts: 2,
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
          decider: options.skillSelection.decider,
          clock,
          ids: {
            nextSelectionId: () => `skill-selection-${randomUUID()}`,
            nextReplacementPlanId: () => `skill-replacement-${randomUUID()}`,
          },
        });
  const mcpTransport = new StreamableHttpMcpAdapter();
  const mcpRegistry = new McpRegistryService({
    repository: mcpRepository,
    transport: mcpTransport,
    cipher: new Aes256GcmSecretCipher(options.mcpMasterKeyBase64),
    schemas: schemaValidator,
    clock,
    ids: { nextInvocationId: () => `mcp-invocation-${randomUUID()}` },
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
    },
    fingerprint: (canonical) => createHash('sha256').update(canonical).digest('hex'),
    successThreshold: 2,
  });
  const processor = new PlanPreparationProcessor({ tasks, events, clock, ids });
  const worker = new BullMqContextWorker({ connection: options.redis, queueName, processor });
  worker.start();
  let management: ManagementHttpEndpointHandle | undefined;
  try {
    const startedManagement = await startManagementHttpEndpoint({
      operations: {
        graph: skillGraph,
        mcp: mcpRegistry,
        skills: skillRegistry,
        skillAuthoring,
        models: modelRuntime,
        ...(skillSelection === undefined ? {} : { skillSelection }),
        temporarySkills,
      },
      ...(options.managementHost === undefined ? {} : { host: options.managementHost }),
      ...(options.managementPort === undefined ? {} : { port: options.managementPort }),
    });
    management = startedManagement;
    const a2a = await startA2AHttpEndpoint({
      executor: new TaskServiceAgentExecutor({ tasks: service }),
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
      async recordResultForSkill(taskId, skillId, candidate): Promise<void> {
        const outputSchema = await skillRegistry.getOutputSchema(skillId);
        await service.recordResult(taskId, { ...candidate, outputSchema }, resultProcessor);
      },
      registerMcpServer(input) {
        return mcpRegistry.register(input);
      },
      refreshMcpServer(serverId) {
        return mcpRegistry.refresh(serverId);
      },
      callMcpTool(serverId, toolName, arguments_, signal, context) {
        return mcpRegistry.call(serverId, toolName, arguments_, signal, context);
      },
      deleteMcpServer(serverId) {
        return mcpRegistry.delete(serverId);
      },
      listMcpInvocations(serverId) {
        return mcpRegistry.listInvocations(serverId);
      },
      listMcpDependencyWarnings(serverId) {
        return mcpRegistry.listDependencyWarnings(serverId);
      },
      updateMcpToolEnhancement(serverId, toolName, enhancement) {
        return mcpRegistry.updateToolEnhancement(serverId, toolName, enhancement);
      },
      async close(): Promise<void> {
        await a2a.close();
        await startedManagement.close();
        await mcpTransport.close();
        await worker.close();
        await queue.close();
        await pool.end();
      },
    };
  } catch (error: unknown) {
    await management?.close();
    await mcpTransport.close();
    await worker.close();
    await queue.close();
    await pool.end();
    throw error;
  }
}

async function applyRuntimeMigrations(pool: Pool): Promise<void> {
  for (const name of [
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
  ]) {
    const migration = await readFile(
      resolve(process.cwd(), 'infra', 'postgres', 'migrations', name),
      'utf8',
    );
    await pool.query(migration);
  }
}
