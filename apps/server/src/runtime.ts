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
  RuntimeRecoveryService,
  McpRegistryService,
  ModelRuntimeService,
  PromptService,
  SkillGraphService,
  SkillAuthoringService,
  SkillSelectionService,
  SkillQualityService,
  SkillCallWorkflowService,
  validateSkillToolPolicies,
  PersistedSkillSemanticRetriever,
  SkillRegistryService,
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
  PostgresMemoryRepository,
  PostgresGoalInputInferenceRepository,
  PostgresTaskWaitPolicyRepository,
  PostgresEvolutionExperienceRepository,
  PostgresEvolutionPolicyRepository,
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
  const evolutionPolicyRepository = new PostgresEvolutionPolicyRepository(pool);
  const evolutionExperienceRepository = new PostgresEvolutionExperienceRepository(pool);
  const queueName = options.queueName ?? 'sdar-context-tasks';
  const queue = new BullMqContextTaskQueue({ connection: options.redis, queueName });
  const ids = { nextId: (kind: 'context' | 'task' | 'event') => `${kind}-${randomUUID()}` };
  const clock = { now: () => new Date().toISOString() };
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
    templates: workflowTemplates,
  });
  const memories = new MemoryService({
    repository: new PostgresMemoryRepository(pool),
    embeddings: { embed: (text) => modelRuntime.embed('goal', text) },
    clock,
    nextId: () => `memory-${randomUUID()}`,
    model: modelRuntime,
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
  const goalInputInference = new GoalInputInferenceService({
    repository: new PostgresGoalInputInferenceRepository(pool),
    memories,
    model: modelRuntime,
    clock,
    nextId: () => `goal-input-inference-${randomUUID()}`,
  });
  const skillRegistry = new SkillRegistryService({ skills, validator: schemaValidator, clock });
  const skillQuality = new SkillQualityService({
    repository: new PostgresSkillQualityRepository(pool),
    skills,
    clock,
    ids: {
      nextObservationId: () => `skill-quality-observation-${randomUUID()}`,
      nextWarningId: () => `skill-quality-warning-${randomUUID()}`,
    },
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
  const skillCallWorkflows = new PostgresSkillCallWorkflowRepository(pool);
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
    async executeSkill({ skillId, input, parentExecutionId, parentNodeId, signal }) {
      const parent = await workflowInstances.findInstance(parentExecutionId);
      if (parent === undefined) throw new Error('WORKFLOW_PARENT_INSTANCE_NOT_FOUND');
      return skillCallWorkflowService.execute({
        skillId,
        value: input,
        parentInstanceId: parentExecutionId,
        parentNodeId,
        parentGoalId: parent.goalId,
        parentGoalVersion: parent.goalVersion,
        ...(signal === undefined ? {} : { signal }),
      });
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
  const workflowInstances = new PostgresWorkflowExecutionRepository(pool);
  const workflowExecution = new WorkflowExecutionService({
    plans: workflowPlans,
    instances: workflowInstances,
    validator: workflowValidator,
    executor: langGraphExecutor,
    clock,
    ids: { nextEventId: () => `workflow-event-${randomUUID()}` },
    skills,
    systemBudgetDefaults: workflowBudgetDefaults,
  });
  const skillCallWorkflowService = new SkillCallWorkflowService({
    skills,
    plans: workflowPlans,
    execution: workflowExecution,
    records: skillCallWorkflows,
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
    repository: new PostgresGoalCancellationRepository(pool),
    clock,
    nextId: () => `goal-cancellation-${randomUUID()}`,
  });
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
      async confirm(task) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        await workflowExecution.confirm(task.planId);
      },
      executeConfirmed(task) {
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
        void (async () => {
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
            input: { requestText: task.requestText },
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
      async cancel(task) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        await workflowExecution.cancelForPlan(task.planId);
      },
      async resume(task) {
        if (task.planId === undefined) throw new Error('TASK_PLAN_NOT_ATTACHED');
        return (await workflowExecution.resumePauseForPlan(task.planId)).disposition;
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
    skills,
    planner: workflowPlanner,
    execution: workflowExecution,
    evaluator: new StructuredGoalEvaluator(modelRuntime),
    experiences: evolutionExperiences,
    taskOutcomes: {
      reportCapabilityGap: (taskId, evaluation) => service.reportCapabilityGap(taskId, evaluation),
      requestInput: (taskId, question) => service.requestInput(taskId, question),
      reportUnachievable: (taskId, summary) => service.fail(taskId, 'GOAL_UNACHIEVABLE', summary),
      async prepareSkillReplacement(taskId) {
        if (skillSelection === undefined) throw new Error('SKILL_SELECTION_RUNTIME_NOT_CONFIGURED');
        const task = await service.get(taskId);
        if (task.skillSelectionId === undefined || task.selectedSkillId === undefined)
          throw new Error('TASK_SKILL_SELECTION_NOT_BOUND');
        const replacement = await skillSelection.planReplacement(
          task.skillSelectionId,
          task.selectedSkillId,
        );
        return {
          skillId: replacement.replacementSkillId,
          skillVersion: replacement.replacementSkillVersion,
          decisionSummary: replacement.decisionSummary,
        };
      },
      reportReplacementPlan: (taskId, input) => service.awaitReplacementConfirmation(taskId, input),
      async reportAchieved(taskId, instance) {
        const task = await service.get(taskId);
        if (task.temporarySkillId !== undefined) {
          const temporary = await temporarySkillRepository.find(task.temporarySkillId);
          if (temporary?.status !== 'active') throw new Error('TEMPORARY_SKILL_NOT_ACTIVE');
          await service.recordResult(
            taskId,
            {
              text: `Temporary Skill ${temporary.name} completed.`,
              structured: instance.result,
              outputSchema: temporary.outputSchema,
            },
            resultProcessor,
          );
          const completed = await temporarySkills.complete(
            temporary.temporarySkillId,
            true,
            'Temporary Skill Workflow completed and its output Schema passed.',
          );
          if (completed.formalizationCandidate !== undefined)
            await skillEvolution.evaluateAndPublish(completed.formalizationCandidate.candidateId);
          return;
        }
        const selected = instance.skillVersions[0];
        if (selected === undefined) throw new Error('TASK_SKILL_VERSION_REQUIRED');
        const skill = await skills.findVersion(selected.skillId, selected.version);
        if (skill?.status !== 'enabled') throw new Error('TASK_SKILL_VERSION_NOT_ENABLED');
        const processed = await resultProcessing.process({
          taskId,
          skillId: skill.skillId,
          skillVersion: skill.version,
          outputInstruction: skill.outputInstruction,
          outputSchema: skill.outputSchema,
          rawResult: instance.result,
        });
        await service.recordResult(
          taskId,
          { ...processed.output, outputSchema: skill.outputSchema },
          resultProcessor,
        );
      },
    },
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
      async run({ proposedSkill, case_ }) {
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
      async replay({ experience }) {
        try {
          const outcome = await langGraphExecutor.execute(
            experience.workflow,
            experience.input,
            workflowBudgetDefaults,
            undefined,
            `evolution-replay-${experience.experienceId}-${randomUUID()}`,
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
    decisions: new StructuredTaskDecisionService(modelRuntime),
    goals: goalService,
    skillSelection: {
      async select(goalDescription, task) {
        if (!goalDescription.includes('TEMPORARY_SKILL_GOAL') && skillSelection !== undefined) {
          try {
            return await skillSelection.select(goalDescription);
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
        const resolved = await temporarySkillResolver.resolve(goalDescription, task);
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
        const planId = `plan-task-${input.task.taskId}-${randomUUID()}`;
        const plan = await workflowPlanner.plan({
          planId,
          workflowDefinitionId: `workflow-task-${input.task.taskId}`,
          workflowVersion: 1,
          goalId: input.goalId,
          goalVersion: input.goalVersion,
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
                    workflowGuidance: skill.workflowGuidance,
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
        if (skill?.runtimePolicy.autoConfirmPlan === true)
          await workflowExecution.confirm(plan.planId);
        return {
          planId: plan.planId,
          autoConfirmed: skill?.runtimePolicy.autoConfirmPlan === true,
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
          input: { requestText: task.requestText },
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
        goalCancellations,
        tasks: service,
        taskWaitTimeouts,
        resultProcessing,
        memories,
        goalInputInference,
        mcp: mcpRegistry,
        skills: skillRegistry,
        skillAuthoring,
        models: modelRuntime,
        prompts,
        ...(skillSelection === undefined ? {} : { skillSelection }),
        skillQuality,
        workflowTemplates,
        temporarySkills: temporarySkillOperations,
        skillEvolution,
        evolutionExperiences,
        evolutionPolicy,
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
      callMcpTool(serverId, toolName, arguments_, signal, context) {
        return mcpRegistry.call(serverId, toolName, arguments_, signal, context);
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
  ]) {
    const migration = await readFile(
      resolve(process.cwd(), 'infra', 'postgres', 'migrations', name),
      'utf8',
    );
    await pool.query(migration);
  }
}
