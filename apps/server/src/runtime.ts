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
  RuntimeRecoveryService,
  McpRegistryService,
  ModelRuntimeService,
  PromptService,
  SkillGraphService,
  SkillAuthoringService,
  SkillSelectionService,
  PersistedSkillSemanticRetriever,
  SkillRegistryService,
  TemporarySkillService,
  WorkflowValidator,
  WorkflowPlannerService,
  WorkflowExecutionService,
  WorkflowControllerService,
  StructuredGoalEvaluator,
  StructuredSkillSelectionDecider,
  StructuredTaskDecisionService,
  StructuredExecutionExceptionDecider,
  GoalService,
  GoalPatchService,
  WorkflowRevisionService,
  TaskService,
  TaskWaitTimeoutService,
  type RegisterSkillVersionInput,
  type StructuredModelProvider,
  type SkillSelectionDecider,
  type TextEmbeddingProvider,
} from '../../../packages/application/src/index.js';
import type { SkillVersion, WorkflowBudgetLimits } from '../../../packages/domain/src/index.js';
import { Aes256GcmSecretCipher } from '../../../packages/crypto-adapter/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { StreamableHttpMcpAdapter } from '../../../packages/mcp-adapter/src/index.js';
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
  PostgresTemporarySkillRepository,
  PostgresWorkflowPlanRepository,
  PostgresWorkflowExecutionRepository,
  PostgresWorkflowControlRepository,
  PostgresGoalRepository,
  PostgresGoalPatchRepository,
  PostgresTaskWaitPolicyRepository,
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
    decider?: SkillSelectionDecider;
  }>;
  readonly workflowBudgetDefaults?: WorkflowBudgetLimits;
  readonly workflowCallCosts?: WorkflowCallCosts;
  readonly taskWaitSweepIntervalMs?: number;
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
  const goals = new PostgresGoalRepository(pool);
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
  const taskWaitTimeouts = new TaskWaitTimeoutService({
    repository: new PostgresTaskWaitPolicyRepository(pool),
    clock,
  });
  await new RuntimeRecoveryService({
    repository: new PostgresRuntimeRecoveryRepository(pool),
    clock,
  }).failInterruptedExecutions();
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
    cipher: new Aes256GcmSecretCipher(options.mcpMasterKeyBase64),
    clock,
    ids: { nextInvocationId: () => `model-invocation-${randomUUID()}` },
  });
  const prompts = new PromptService({ repository: new PostgresPromptRepository(pool), clock });
  const schemaValidator = new AjvJsonSchemaValidator();
  const workflowValidator = new WorkflowValidator({
    tools: mcpRepository,
    skills,
    schemas: schemaValidator,
  });
  const workflowSchema = JSON.parse(
    await readFile(resolve(process.cwd(), 'schemas', 'workflow-dsl.schema.json'), 'utf8'),
  ) as unknown;
  const workflowPlanner = new WorkflowPlannerService({
    model: modelRuntime,
    validator: workflowValidator,
    repository: new PostgresWorkflowPlanRepository(pool),
    workflowSchema,
    clock,
    maxAttempts: 3,
  });
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
          decider:
            options.skillSelection.decider ?? new StructuredSkillSelectionDecider(modelRuntime),
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
  const workflowPlans = new PostgresWorkflowPlanRepository(pool);
  const executionExceptionDecider = new StructuredExecutionExceptionDecider(modelRuntime);
  const workflowAncestry = new AsyncLocalStorage<readonly string[]>();
  const workflowPorts: WorkflowRuntimePorts = {
    executeLlm: ({ instruction, responseSchema }) =>
      modelRuntime.generateStructured({
        stage: 'execution_decision',
        instruction,
        responseSchema,
        correctionErrors: [],
      }),
    async callMcpTool({ tool, arguments: arguments_, signal }) {
      if (!isRecord(arguments_)) throw new Error('WORKFLOW_MCP_ARGUMENTS_NOT_OBJECT');
      return mcpRegistry.call(tool.serverId, tool.toolName, arguments_, signal);
    },
    async executeSkill({ skillId, input }) {
      const skill = await skills.findCurrentVersion(skillId);
      if (skill?.status !== 'enabled') throw new Error('WORKFLOW_SKILL_NOT_ENABLED');
      const result = await modelRuntime.generateStructured({
        stage: 'execution_decision',
        instruction: `${skill.workflowGuidance}\nInput: ${JSON.stringify(input)}`,
        responseSchema: skill.outputSchema,
        correctionErrors: [],
      });
      const validation = schemaValidator.validate(skill.outputSchema, result);
      if (!validation.valid) throw new Error('WORKFLOW_SKILL_OUTPUT_INVALID');
      return result;
    },
    async executeSubworkflow({ workflowDefinitionId, workflowVersion, parentInput, signal }) {
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
        ).execute(definition, parentInput, workflowBudgetDefaults, signal);
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
  const workflowExecution = new WorkflowExecutionService({
    plans: workflowPlans,
    instances: new PostgresWorkflowExecutionRepository(pool),
    validator: workflowValidator,
    executor: langGraphExecutor,
    clock,
    ids: { nextEventId: () => `workflow-event-${randomUUID()}` },
    skills,
    systemBudgetDefaults: workflowBudgetDefaults,
  });
  const workflowRevision = new WorkflowRevisionService({
    plans: workflowPlans,
    planner: workflowPlanner,
    validator: workflowValidator,
    clock,
  });
  const goalService = new GoalService({ goals, contexts, clock });
  const goalPatches = new GoalPatchService({
    goals,
    patches: new PostgresGoalPatchRepository(pool),
    plans: workflowPlans,
    planner: workflowPlanner,
    skills,
    model: modelRuntime,
    clock,
    ids: {
      nextPatchId: () => `goal-patch-${randomUUID()}`,
      nextPlanId: () => `plan-goal-patch-${randomUUID()}`,
    },
  });
  const service = new TaskService({
    contexts,
    tasks,
    events,
    skillDrafts,
    queue,
    clock,
    ids,
    planActions: {
      async confirm(planId) {
        await workflowExecution.confirm(planId);
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
      async cancel(task) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        await workflowExecution.cancelForPlan(task.planId);
      },
      async resume(task) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        return (await workflowExecution.resumePauseForPlan(task.planId)).disposition;
      },
    },
  });
  const workflowController = new WorkflowControllerService({
    controls: new PostgresWorkflowControlRepository(pool),
    plans: workflowPlans,
    goals,
    skills,
    planner: workflowPlanner,
    execution: workflowExecution,
    evaluator: new StructuredGoalEvaluator(modelRuntime),
    clock,
    ids: {
      nextPlanId: (controlId, replanCount) =>
        `plan-${controlId}-${String(replanCount)}-${randomUUID()}`,
      nextInstanceId: (controlId, roundIndex) =>
        `instance-${controlId}-${String(roundIndex)}-${randomUUID()}`,
    },
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
  const processor = new PlanPreparationProcessor({
    tasks,
    events,
    clock,
    ids,
    decisions: new StructuredTaskDecisionService(modelRuntime),
    goals: goalService,
    skillSelection: skillSelection ?? {
      select: () => Promise.reject(new Error('SKILL_SELECTION_RUNTIME_NOT_CONFIGURED')),
    },
    nextGoalId: () => `goal-${randomUUID()}`,
  });
  const waitSweepTimer = setInterval(() => {
    void taskWaitTimeouts.sweep().catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({ event: 'task_wait_sweep.failed', error: error instanceof Error ? error.message : String(error) })}\n`,
      );
    });
  }, options.taskWaitSweepIntervalMs ?? 1000);
  waitSweepTimer.unref();
  const worker = new BullMqContextWorker({ connection: options.redis, queueName, processor });
  worker.start();
  let management: ManagementHttpEndpointHandle | undefined;
  try {
    const startedManagement = await startManagementHttpEndpoint({
      operations: {
        graph: skillGraph,
        goals: goalService,
        goalPatches,
        tasks: service,
        taskWaitTimeouts,
        mcp: mcpRegistry,
        skills: skillRegistry,
        skillAuthoring,
        models: modelRuntime,
        prompts,
        ...(skillSelection === undefined ? {} : { skillSelection }),
        temporarySkills,
        workflows: {
          validate: (raw) => workflowValidator.validate(raw),
          plan: (input) => workflowPlanner.plan(input),
          confirm: (planId) => workflowExecution.confirm(planId),
          execute: (input) => workflowExecution.execute(input),
          resumeHumanConfirmation: (input) => workflowExecution.resumeHumanConfirmation(input),
          pauseForPlan: (planId) => workflowExecution.pauseForPlan(planId),
          resumePauseForPlan: (planId) => workflowExecution.resumePauseForPlan(planId),
          cancelForPlan: (planId) => workflowExecution.cancelForPlan(planId),
        },
        workflowControls: workflowController,
        workflowRevisions: workflowRevision,
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
        clearInterval(waitSweepTimer);
        await a2a.close();
        await startedManagement.close();
        await mcpTransport.close();
        await worker.close();
        await queue.close();
        await pool.end();
      },
    };
  } catch (error: unknown) {
    clearInterval(waitSweepTimer);
    await management?.close();
    await mcpTransport.close();
    await worker.close();
    await queue.close();
    await pool.end();
    throw error;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  ]) {
    const migration = await readFile(
      resolve(process.cwd(), 'infra', 'postgres', 'migrations', name),
      'utf8',
    );
    await pool.query(migration);
  }
}
