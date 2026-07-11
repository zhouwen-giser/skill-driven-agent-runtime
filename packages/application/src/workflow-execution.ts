import type {
  WorkflowBudgetLimits,
  WorkflowInstance,
  WorkflowNodeEvent,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import { resolveWorkflowBudgetLimits } from '../../domain/src/index.js';
import type {
  Clock,
  SkillRepository,
  WorkflowExecutionRepository,
  WorkflowExecutor,
  WorkflowPlanRepository,
} from './ports.js';
import type { WorkflowValidator } from './workflow-validator.js';

export class WorkflowExecutionService {
  readonly #plans: WorkflowPlanRepository;
  readonly #instances: WorkflowExecutionRepository;
  readonly #validator: WorkflowValidator;
  readonly #executor: WorkflowExecutor;
  readonly #clock: Clock;
  readonly #ids: Readonly<{ nextEventId(): string }>;
  readonly #skills: SkillRepository;
  readonly #systemBudgetDefaults: WorkflowBudgetLimits;

  constructor(
    dependencies: Readonly<{
      plans: WorkflowPlanRepository;
      instances: WorkflowExecutionRepository;
      validator: WorkflowValidator;
      executor: WorkflowExecutor;
      clock: Clock;
      ids: Readonly<{ nextEventId(): string }>;
      skills: SkillRepository;
      systemBudgetDefaults: WorkflowBudgetLimits;
    }>,
  ) {
    this.#plans = dependencies.plans;
    this.#instances = dependencies.instances;
    this.#validator = dependencies.validator;
    this.#executor = dependencies.executor;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#skills = dependencies.skills;
    this.#systemBudgetDefaults = resolveWorkflowBudgetLimits(dependencies.systemBudgetDefaults, []);
  }

  async confirm(planId: string): Promise<WorkflowPlanRecord> {
    const plan = await this.#requirePlan(planId);
    if (plan.definition === undefined || plan.confirmationStatus === 'failed')
      throw new WorkflowExecutionError(
        'WORKFLOW_PLAN_NOT_EXECUTABLE',
        'Failed or definition-less plan cannot be confirmed.',
      );
    if (plan.confirmationStatus === 'confirmed') return plan;
    await this.#plans.confirmPlan(planId);
    return { ...plan, confirmationStatus: 'confirmed' };
  }

  async execute(
    input: Readonly<{
      instanceId: string;
      planId: string;
      input: unknown;
      skillIds?: readonly string[];
      signal?: AbortSignal;
    }>,
  ): Promise<WorkflowInstance> {
    if ((await this.#instances.findInstance(input.instanceId)) !== undefined)
      throw new WorkflowExecutionError(
        'WORKFLOW_INSTANCE_ALREADY_EXISTS',
        'Workflow instance already exists.',
      );
    const plan = await this.#requirePlan(input.planId);
    if (plan.confirmationStatus !== 'confirmed' || plan.definition === undefined)
      throw new WorkflowExecutionError(
        'WORKFLOW_PLAN_NOT_CONFIRMED',
        'Only a confirmed plan with a validated definition may execute.',
      );
    const validation = await this.#validator.validate(plan.definition);
    if (!validation.valid || validation.definition === undefined)
      throw new WorkflowExecutionError(
        'WORKFLOW_PLAN_REVALIDATION_FAILED',
        'Persisted plan no longer validates against current Tool and Skill catalogs.',
      );
    const skillVersions = await this.#resolveSkillVersions(validation.definition, input.skillIds);
    const budgetLimits = resolveWorkflowBudgetLimits(
      this.#systemBudgetDefaults,
      skillVersions.map((skill) => skill.runtimePolicy),
    );
    const startedAt = this.#clock.now();
    const running: WorkflowInstance = {
      instanceId: input.instanceId,
      planId: plan.planId,
      workflowDefinitionId: validation.definition.workflowDefinitionId,
      workflowVersion: validation.definition.version,
      goalId: plan.goalId,
      goalVersion: plan.goalVersion,
      skillVersions: skillVersions.map((skill) => ({
        skillId: skill.skillId,
        version: skill.version,
      })),
      budgetLimits,
      budgetUsage: emptyUsage(),
      status: 'running',
      input: input.input,
      errors: {},
      startedAt,
    };
    await this.#instances.saveInstance(running);
    try {
      const outcome = await this.#executor.execute(
        validation.definition,
        input.input,
        budgetLimits,
        input.signal,
      );
      await this.#instances.saveNodeEvents(this.#events(input.instanceId, outcome.events));
      const completed: WorkflowInstance = {
        ...running,
        status: outcome.status,
        ...(outcome.result === undefined ? {} : { result: outcome.result }),
        errors: outcome.errors,
        budgetUsage: outcome.budgetUsage,
        completedAt: this.#clock.now(),
        ...(outcome.terminationReason === undefined
          ? {}
          : { terminationReason: outcome.terminationReason }),
      };
      await this.#instances.saveInstance(completed);
      return completed;
    } catch (error: unknown) {
      const completedAt = this.#clock.now();
      const failed: WorkflowInstance = {
        ...running,
        status: 'failed',
        errors: { runtime: normalizedError(error) },
        budgetUsage: {
          ...running.budgetUsage,
          durationMs: elapsedMilliseconds(startedAt, completedAt),
        },
        completedAt,
      };
      await this.#instances.saveInstance(failed);
      throw error;
    }
  }

  async #resolveSkillVersions(
    definition: NonNullable<WorkflowPlanRecord['definition']>,
    requestedSkillIds: readonly string[] | undefined,
  ) {
    const ids = new Set(requestedSkillIds ?? []);
    for (const node of definition.nodes) if (node.type === 'skill_call') ids.add(node.skillId);
    const versions = [];
    for (const skillId of ids) {
      const version = await this.#skills.findCurrentVersion(skillId);
      if (version?.status !== 'enabled')
        throw new WorkflowExecutionError(
          'WORKFLOW_SKILL_NOT_ENABLED',
          `Enabled Skill ${skillId} was not found for budget resolution.`,
        );
      versions.push(version);
    }
    return versions;
  }

  async #requirePlan(planId: string): Promise<WorkflowPlanRecord> {
    const plan = await this.#plans.findPlan(planId);
    if (plan === undefined)
      throw new WorkflowExecutionError('WORKFLOW_PLAN_NOT_FOUND', 'Workflow plan was not found.');
    return plan;
  }

  #events(
    instanceId: string,
    events: readonly Readonly<{
      nodeId: string;
      type: WorkflowNodeEvent['eventType'];
      timestamp: string;
      summary: string;
    }>[],
  ): readonly WorkflowNodeEvent[] {
    return events.map((event, index) => ({
      eventId: this.#ids.nextEventId(),
      instanceId,
      sequence: index + 1,
      nodeId: event.nodeId,
      eventType: event.type,
      timestamp: event.timestamp,
      summary: event.summary,
    }));
  }
}

function emptyUsage() {
  return { replanCount: 0, durationMs: 0, llmCalls: 0, mcpCalls: 0, cost: 0 } as const;
}

function elapsedMilliseconds(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

function normalizedError(error: unknown): Readonly<{ code: string; message: string }> {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'WORKFLOW_EXECUTION_FAILED';
  return { code, message: error instanceof Error ? error.message : 'Unknown Workflow failure.' };
}

export type WorkflowExecutionErrorCode =
  | 'WORKFLOW_INSTANCE_ALREADY_EXISTS'
  | 'WORKFLOW_PLAN_NOT_CONFIRMED'
  | 'WORKFLOW_PLAN_NOT_EXECUTABLE'
  | 'WORKFLOW_PLAN_NOT_FOUND'
  | 'WORKFLOW_PLAN_REVALIDATION_FAILED'
  | 'WORKFLOW_SKILL_NOT_ENABLED';
export class WorkflowExecutionError extends Error {
  readonly code: WorkflowExecutionErrorCode;
  constructor(code: WorkflowExecutionErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowExecutionError';
    this.code = code;
  }
}
