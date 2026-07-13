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
import { validateSkillToolPolicies } from './skill-tool-policy.js';

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

  async confirm(planId: string, taskId?: string): Promise<WorkflowPlanRecord> {
    const plan = await this.#requirePlan(planId);
    if (plan.definition === undefined || plan.confirmationStatus === 'failed')
      throw new WorkflowExecutionError(
        'WORKFLOW_PLAN_NOT_EXECUTABLE',
        'Failed or definition-less plan cannot be confirmed.',
      );
    if (plan.confirmationStatus === 'confirmed') return plan;
    const confirmedAt = this.#clock.now();
    await this.#plans.confirmPlan(planId, {
      confirmedAt,
      ...(taskId === undefined ? {} : { taskId }),
    });
    return {
      ...plan,
      confirmationStatus: 'confirmed',
      confirmedAt,
      ...(taskId === undefined ? {} : { confirmationTaskId: taskId }),
    };
  }

  get(instanceId: string): Promise<WorkflowInstance | undefined> {
    return this.#instances.findInstance(instanceId);
  }

  async trace(
    instanceId: string,
  ): Promise<Readonly<{ instance: WorkflowInstance; events: readonly WorkflowNodeEvent[] }>> {
    const instance = await this.#instances.findInstance(instanceId);
    if (instance === undefined)
      throw new WorkflowExecutionError(
        'WORKFLOW_INSTANCE_NOT_FOUND',
        'Workflow instance was not found.',
      );
    return { instance, events: await this.#instances.listNodeEvents(instanceId) };
  }

  async traceForPlan(
    planId: string,
  ): Promise<Readonly<{ instance: WorkflowInstance; events: readonly WorkflowNodeEvent[] }>> {
    const instance = await this.#instances.findLatestByPlanId(planId);
    if (instance === undefined)
      throw new WorkflowExecutionError(
        'WORKFLOW_INSTANCE_NOT_FOUND',
        'Workflow instance was not found for the plan.',
      );
    return this.trace(instance.instanceId);
  }

  async execute(
    input: Readonly<{
      instanceId: string;
      planId: string;
      input: unknown;
      skillIds?: readonly string[];
      replanCount?: number;
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
    const toolPolicyViolations = validateSkillToolPolicies(validation.definition, skillVersions);
    if (toolPolicyViolations.length > 0)
      throw new WorkflowExecutionError(
        'WORKFLOW_SKILL_TOOL_POLICY_VIOLATION',
        `Workflow violates Skill Tool policy: ${JSON.stringify(toolPolicyViolations)}`,
      );
    const budgetLimits = resolveWorkflowBudgetLimits(
      this.#systemBudgetDefaults,
      skillVersions.map((skill) => skill.runtimePolicy),
    );
    const startedAt = this.#clock.now();
    const replanCount = input.replanCount ?? 0;
    if (!Number.isInteger(replanCount) || replanCount < 0 || replanCount > budgetLimits.maxReplans)
      throw new WorkflowExecutionError(
        'WORKFLOW_REPLAN_BUDGET_EXHAUSTED',
        'Workflow replan count exceeds the resolved budget.',
      );
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
      budgetUsage: emptyUsage(replanCount),
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
        input.instanceId,
      );
      await this.#instances.saveNodeEvents(this.#events(input.instanceId, outcome.events, 1));
      const completed: WorkflowInstance = {
        ...running,
        status: outcome.status,
        ...(outcome.result === undefined ? {} : { result: outcome.result }),
        errors: outcome.errors,
        budgetUsage: { ...outcome.budgetUsage, replanCount },
        ...(outcome.status === 'paused' ? {} : { completedAt: this.#clock.now() }),
        ...(outcome.pendingConfirmation === undefined
          ? {}
          : { pendingConfirmation: outcome.pendingConfirmation }),
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

  async resumeHumanConfirmation(
    input: Readonly<{
      instanceId: string;
      confirmed: boolean;
      signal?: AbortSignal;
      resumeTaskPause?: boolean;
    }>,
  ): Promise<WorkflowInstance> {
    const instance = await this.#instances.findInstance(input.instanceId);
    if (instance?.status !== 'paused' || instance.pendingConfirmation === undefined)
      throw new WorkflowExecutionError(
        'WORKFLOW_INSTANCE_NOT_PAUSED',
        'Only a paused Workflow instance can resume human confirmation.',
      );
    if (instance.pendingConfirmation.kind === 'task_pause' && input.resumeTaskPause !== true)
      throw new WorkflowExecutionError(
        'WORKFLOW_INSTANCE_NOT_PAUSED',
        'Task-pause checkpoints must resume through the lifecycle control path.',
      );
    const plan = await this.#requirePlan(instance.planId);
    if (plan.confirmationStatus !== 'confirmed' || plan.definition === undefined)
      throw new WorkflowExecutionError(
        'WORKFLOW_PLAN_NOT_CONFIRMED',
        'The immutable plan is no longer confirmed and cannot resume.',
      );
    if (this.#executor.resumeHumanConfirmation === undefined)
      throw new WorkflowExecutionError(
        'WORKFLOW_RESUME_UNAVAILABLE',
        'The Workflow runtime does not support confirmation resume.',
      );
    const instanceWithoutPending = withoutPendingConfirmation(instance);
    try {
      const outcome = await this.#executor.resumeHumanConfirmation(
        instance.instanceId,
        input.confirmed,
        input.signal,
      );
      const eventCount = await this.#instances.countNodeEvents(instance.instanceId);
      await this.#instances.saveNodeEvents(
        this.#events(instance.instanceId, outcome.events, eventCount + 1),
      );
      const resumed: WorkflowInstance = {
        ...instanceWithoutPending,
        status: outcome.status,
        ...(outcome.result === undefined ? {} : { result: outcome.result }),
        errors: outcome.errors,
        budgetUsage: { ...outcome.budgetUsage, replanCount: instance.budgetUsage.replanCount },
        ...(outcome.status === 'paused' ? {} : { completedAt: this.#clock.now() }),
        ...(outcome.pendingConfirmation === undefined
          ? {}
          : { pendingConfirmation: outcome.pendingConfirmation }),
        ...(outcome.terminationReason === undefined
          ? {}
          : { terminationReason: outcome.terminationReason }),
      };
      await this.#instances.saveInstance(resumed);
      return resumed;
    } catch (error: unknown) {
      const failed: WorkflowInstance = {
        ...instanceWithoutPending,
        status: 'failed',
        errors: { runtime: normalizedError(error) },
        completedAt: this.#clock.now(),
      };
      await this.#instances.saveInstance(failed);
      throw error;
    }
  }

  async pauseForPlan(planId: string): Promise<WorkflowInstance> {
    const instance = await this.#instances.findActiveByPlanId(planId);
    if (instance?.status !== 'running')
      throw new WorkflowExecutionError(
        'WORKFLOW_INSTANCE_NOT_RUNNING',
        'No running Workflow instance exists for this plan.',
      );
    if (this.#executor.requestPause?.(instance.instanceId) !== true)
      throw new WorkflowExecutionError(
        'WORKFLOW_EXECUTION_CONTROL_UNAVAILABLE',
        'The in-memory Workflow execution is unavailable and cannot be paused.',
      );
    return this.#waitFor(instance.instanceId, ['paused']);
  }

  async cancelForPlan(planId: string): Promise<WorkflowInstance> {
    const instance = await this.#instances.findActiveByPlanId(planId);
    if (instance === undefined)
      throw new WorkflowExecutionError(
        'WORKFLOW_INSTANCE_NOT_RUNNING',
        'No active Workflow instance exists for this plan.',
      );
    const policies = await Promise.all(
      instance.skillVersions.map(({ skillId, version }) =>
        this.#skills.findVersion(skillId, version),
      ),
    );
    const strategies = policies
      .map((skill) => skill?.runtimePolicy.cancelStrategy)
      .filter((value): value is NonNullable<typeof value> => value !== undefined);
    const strategy = strategies.includes('cleanup_workflow')
      ? 'cleanup_workflow'
      : strategies.includes('wait_current')
        ? 'wait_current'
        : 'try_interrupt';
    if (this.#executor.requestCancel?.(instance.instanceId, strategy === 'try_interrupt') !== true)
      throw new WorkflowExecutionError(
        'WORKFLOW_EXECUTION_CONTROL_UNAVAILABLE',
        'The in-memory Workflow execution is unavailable and cannot be canceled.',
      );
    const canceled = await this.#waitFor(instance.instanceId, ['canceled', 'failed']);
    const audited: WorkflowInstance = {
      ...canceled,
      errors: {
        ...canceled.errors,
        cancellationPolicy: {
          code: `CANCEL_STRATEGY_${strategy.toUpperCase()}`,
          message: `Applied Skill cancellation strategy ${strategy}; no automatic compensation ran.`,
        },
      },
    };
    await this.#instances.saveInstance(audited);
    return audited;
  }

  async resumePauseForPlan(
    planId: string,
    defaultThresholdSeconds = 300,
  ): Promise<Readonly<{ disposition: 'resumed' | 'replan_required'; instance: WorkflowInstance }>> {
    const instance = await this.#instances.findActiveByPlanId(planId);
    if (
      instance?.status !== 'paused' ||
      instance.pendingConfirmation?.kind !== 'task_pause' ||
      instance.pendingConfirmation.pausedAt === undefined
    )
      throw new WorkflowExecutionError(
        'WORKFLOW_INSTANCE_NOT_PAUSED',
        'No Task-pause checkpoint exists for this plan.',
      );
    const policies = await Promise.all(
      instance.skillVersions.map(({ skillId, version }) =>
        this.#skills.findVersion(skillId, version),
      ),
    );
    const thresholds = policies
      .map((skill) => skill?.runtimePolicy.pauseReplanThresholdSeconds)
      .filter((value): value is number => value !== undefined);
    const threshold = thresholds.length === 0 ? defaultThresholdSeconds : Math.min(...thresholds);
    const pausedSeconds = Math.max(
      0,
      (Date.parse(this.#clock.now()) - Date.parse(instance.pendingConfirmation.pausedAt)) / 1000,
    );
    if (pausedSeconds > threshold) return { disposition: 'replan_required', instance };
    const resumed = await this.resumeHumanConfirmation({
      instanceId: instance.instanceId,
      confirmed: true,
      resumeTaskPause: true,
    });
    return { disposition: 'resumed', instance: resumed };
  }

  async waitForPauseResolution(instanceId: string): Promise<WorkflowInstance> {
    for (;;) {
      const instance = await this.#instances.findInstance(instanceId);
      if (instance === undefined)
        throw new WorkflowExecutionError(
          'WORKFLOW_INSTANCE_NOT_FOUND',
          'Paused Workflow instance was not found.',
        );
      if (instance.status !== 'paused') return instance;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
  }

  async #waitFor(
    instanceId: string,
    statuses: readonly WorkflowInstance['status'][],
  ): Promise<WorkflowInstance> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const instance = await this.#instances.findInstance(instanceId);
      if (instance !== undefined && statuses.includes(instance.status)) return instance;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    }
    throw new WorkflowExecutionError(
      'WORKFLOW_EXECUTION_CONTROL_TIMEOUT',
      'Workflow execution did not reach the requested controlled state.',
    );
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
      durationMs?: number;
      summary: string;
    }>[],
    startingSequence: number,
  ): readonly WorkflowNodeEvent[] {
    return events.map((event, index) => ({
      eventId: this.#ids.nextEventId(),
      instanceId,
      sequence: startingSequence + index,
      nodeId: event.nodeId,
      eventType: event.type,
      timestamp: event.timestamp,
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      summary: event.summary,
    }));
  }
}

function emptyUsage(replanCount: number) {
  return { replanCount, durationMs: 0, llmCalls: 0, mcpCalls: 0, cost: 0 } as const;
}

function withoutPendingConfirmation(
  instance: WorkflowInstance,
): Omit<WorkflowInstance, 'pendingConfirmation'> {
  const { pendingConfirmation, ...remaining } = instance;
  void pendingConfirmation;
  return remaining;
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
  | 'WORKFLOW_INSTANCE_NOT_FOUND'
  | 'WORKFLOW_INSTANCE_NOT_PAUSED'
  | 'WORKFLOW_INSTANCE_NOT_RUNNING'
  | 'WORKFLOW_INSTANCE_ALREADY_EXISTS'
  | 'WORKFLOW_PLAN_NOT_CONFIRMED'
  | 'WORKFLOW_PLAN_NOT_EXECUTABLE'
  | 'WORKFLOW_PLAN_NOT_FOUND'
  | 'WORKFLOW_PLAN_REVALIDATION_FAILED'
  | 'WORKFLOW_REPLAN_BUDGET_EXHAUSTED'
  | 'WORKFLOW_RESUME_UNAVAILABLE'
  | 'WORKFLOW_EXECUTION_CONTROL_UNAVAILABLE'
  | 'WORKFLOW_EXECUTION_CONTROL_TIMEOUT'
  | 'WORKFLOW_SKILL_NOT_ENABLED'
  | 'WORKFLOW_SKILL_TOOL_POLICY_VIOLATION';
export class WorkflowExecutionError extends Error {
  readonly code: WorkflowExecutionErrorCode;
  constructor(code: WorkflowExecutionErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowExecutionError';
    this.code = code;
  }
}
