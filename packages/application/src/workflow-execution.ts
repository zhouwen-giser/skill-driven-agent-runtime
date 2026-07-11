import type {
  WorkflowInstance,
  WorkflowNodeEvent,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import type {
  Clock,
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

  constructor(
    dependencies: Readonly<{
      plans: WorkflowPlanRepository;
      instances: WorkflowExecutionRepository;
      validator: WorkflowValidator;
      executor: WorkflowExecutor;
      clock: Clock;
      ids: Readonly<{ nextEventId(): string }>;
    }>,
  ) {
    this.#plans = dependencies.plans;
    this.#instances = dependencies.instances;
    this.#validator = dependencies.validator;
    this.#executor = dependencies.executor;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
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
    input: Readonly<{ instanceId: string; planId: string; input: unknown; signal?: AbortSignal }>,
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
    const startedAt = this.#clock.now();
    const running: WorkflowInstance = {
      instanceId: input.instanceId,
      planId: plan.planId,
      workflowDefinitionId: validation.definition.workflowDefinitionId,
      workflowVersion: validation.definition.version,
      goalId: plan.goalId,
      goalVersion: plan.goalVersion,
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
        input.signal,
      );
      await this.#instances.saveNodeEvents(this.#events(input.instanceId, outcome.events));
      const completed: WorkflowInstance = {
        ...running,
        status: outcome.status,
        ...(outcome.result === undefined ? {} : { result: outcome.result }),
        errors: outcome.errors,
        completedAt: this.#clock.now(),
      };
      await this.#instances.saveInstance(completed);
      return completed;
    } catch (error: unknown) {
      const failed: WorkflowInstance = {
        ...running,
        status: 'failed',
        errors: { runtime: normalizedError(error) },
        completedAt: this.#clock.now(),
      };
      await this.#instances.saveInstance(failed);
      throw error;
    }
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
  | 'WORKFLOW_PLAN_REVALIDATION_FAILED';
export class WorkflowExecutionError extends Error {
  readonly code: WorkflowExecutionErrorCode;
  constructor(code: WorkflowExecutionErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowExecutionError';
    this.code = code;
  }
}
