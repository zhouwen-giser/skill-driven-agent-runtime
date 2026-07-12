import { once } from 'node:events';
import { createServer, type Server as HttpServer } from 'node:http';

import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import type {
  McpRegistryService,
  ModelRuntimeService,
  PromptService,
  SkillAuthoringService,
  SkillSelectionService,
  RegisterSkillVersionInput,
  SkillRegistryService,
  SkillGraphService,
  TemporarySkillService,
  WorkflowValidator,
  WorkflowPlannerService,
  WorkflowExecutionService,
  WorkflowControllerService,
  GoalService,
  GoalPatchService,
  GoalCancellationService,
  WorkflowRevisionService,
  TaskService,
  TaskWaitTimeoutService,
} from '../../application/src/index.js';

const TaskWaitPolicySchema = z.object({ timeoutSeconds: z.number().int().positive() });
const CancelGoalSchema = z.object({ reason: z.string().min(1) });

const JsonSchema = z.union([z.boolean(), z.record(z.string(), z.unknown())]);
const RegisterMcpServerSchema = z.object({
  serverId: z.string().min(1),
  name: z.string().min(1),
  endpoint: z.url(),
  credentialHeaders: z.record(z.string(), z.string()),
});
const CredentialHeadersSchema = z.object({
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
});
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
});
const SelectSkillSchema = z.object({ goalDescription: z.string().min(1) });
const ModelStageSchema = z.enum([
  'intent',
  'goal',
  'skill_authoring',
  'skill_selection',
  'workflow_planning',
  'execution_decision',
  'goal_evaluation',
  'evaluation',
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
  planningInstruction: z.string().min(1),
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

export interface ManagementOperations {
  readonly goals: Pick<GoalService, 'create' | 'get' | 'history'>;
  readonly goalPatches: Pick<GoalPatchService, 'apply' | 'get' | 'list'>;
  readonly goalCancellations: Pick<GoalCancellationService, 'cancel' | 'get' | 'list'>;
  readonly tasks: Pick<TaskService, 'attachPlan' | 'get'>;
  readonly taskWaitTimeouts: Pick<TaskWaitTimeoutService, 'getPolicy' | 'updatePolicy'>;
  readonly graph: Pick<SkillGraphService, 'create' | 'delete' | 'list'>;
  readonly mcp: Pick<
    McpRegistryService,
    | 'delete'
    | 'checkHealth'
    | 'listDependencyWarnings'
    | 'listInvocations'
    | 'listServers'
    | 'listTools'
    | 'refresh'
    | 'register'
    | 'updateToolEnhancement'
    | 'updateCredentials'
  >;
  readonly skills: Pick<
    SkillRegistryService,
    'diff' | 'listCurrentVersions' | 'listVersions' | 'register' | 'rollback' | 'setEnabled'
  >;
  readonly temporarySkills: Pick<TemporarySkillService, 'complete' | 'create' | 'listByTask'>;
  readonly skillAuthoring?: Pick<SkillAuthoringService, 'authorAndRegister'>;
  readonly skillSelection?: Pick<SkillSelectionService, 'select'>;
  readonly models: Pick<ModelRuntimeService, 'configureProvider' | 'listInvocations' | 'route'>;
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
    >;
  readonly workflowControls: Pick<
    WorkflowControllerService,
    'continueAfterConfirmation' | 'get' | 'listRounds' | 'start'
  >;
  readonly workflowRevisions: Pick<WorkflowRevisionService, 'get' | 'reviseAdmin'>;
}

export interface ManagementHttpEndpointHandle {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export async function startManagementHttpEndpoint(
  options: Readonly<{
    operations: ManagementOperations;
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
    response.json({ status: 'ok', authentication: 'none', deployment: 'trusted-intranet-only' });
  });
  app.get(
    '/api/v1/system/task-wait-policy',
    asyncRoute(async (_request, response) => {
      response.json(await options.operations.taskWaitTimeouts.getPolicy());
    }),
  );
  app.put(
    '/api/v1/system/task-wait-policy',
    asyncRoute(async (request, response) => {
      const input = TaskWaitPolicySchema.parse(request.body);
      response.json(await options.operations.taskWaitTimeouts.updatePolicy(input.timeoutSeconds));
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
      response.status(201).json(await options.operations.workflowControls.start(input));
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
    '/api/v1/tasks/:taskId',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.tasks.get(pathValue(request, 'taskId')));
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
          planningInstruction: input.planningInstruction,
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
    '/api/v1/models/invocations',
    asyncRoute(async (request, response) => {
      const stage =
        request.query['stage'] === undefined
          ? undefined
          : ModelStageSchema.parse(request.query['stage']);
      response.json({ items: await options.operations.models.listInvocations(stage) });
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
    response.json({ items: await options.operations.mcp.listServers() });
  });
  app.post(
    '/api/v1/mcp/servers',
    asyncRoute(async (request, response) => {
      const result = await options.operations.mcp.register(
        RegisterMcpServerSchema.parse(request.body),
      );
      response.status(201).json(result);
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
      response.json(await options.operations.mcp.refresh(pathValue(request, 'serverId')));
    }),
  );
  app.post(
    '/api/v1/mcp/servers/:serverId/health',
    asyncRoute(async (request, response) => {
      response.json(await options.operations.mcp.checkHealth(pathValue(request, 'serverId')));
    }),
  );
  app.put(
    '/api/v1/mcp/servers/:serverId/credentials',
    asyncRoute(async (request, response) => {
      const input = CredentialHeadersSchema.parse(request.body);
      await options.operations.mcp.updateCredentials(
        pathValue(request, 'serverId'),
        input.credentialHeaders,
      );
      response.status(204).end();
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
  app.delete(
    '/api/v1/mcp/servers/:serverId',
    asyncRoute(async (request, response) => {
      await options.operations.mcp.delete(pathValue(request, 'serverId'));
      response.status(204).end();
    }),
  );
  app.get('/api/v1/skills', async (_request, response) => {
    response.json({ items: await options.operations.skills.listCurrentVersions() });
  });
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
      const input = skillRegistrationInput(RegisterSkillSchema.parse(request.body));
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
      response.status(201).json(
        await options.operations.skillAuthoring.authorAndRegister({
          ...parsed,
          runtimePolicy: compactRuntimePolicy(parsed.runtimePolicy),
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
      response
        .status(201)
        .json(await options.operations.skillSelection.select(input.goalDescription));
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

function skillRegistrationInput(
  parsed: z.infer<typeof RegisterSkillSchema>,
): RegisterSkillVersionInput {
  const policy = parsed.runtimePolicy;
  return {
    ...parsed,
    runtimePolicy: compactRuntimePolicy(policy),
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
