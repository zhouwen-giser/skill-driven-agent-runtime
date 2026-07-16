import type {
  WorkflowBudgetLimits,
  WorkflowInstance,
  WorkflowNodeEvent,
  WorkflowPlanRecord,
  RuntimeExecutionContext,
  WorkflowExternalWaitResolution,
  WorkflowContinuationSnapshot,
} from '../../domain/src/index.js';
import {
  assertGoalExecutionContractIdentity,
  createWorkflowContinuationSnapshot,
  resolveWorkflowBudgetLimits,
} from '../../domain/src/index.js';
import type {
  Clock,
  SkillRepository,
  WorkflowExecutionRepository,
  WorkflowExecutor,
  WorkflowPlanRepository,
  WorkflowContinuationRepository,
} from './ports.js';
import type { WorkflowValidator } from './workflow-validator.js';
import { validateSkillToolPolicies } from './skill-tool-policy.js';
import { canonicalHash } from './mcp-task-readiness.js';

export class WorkflowExecutionService {
  readonly #plans: WorkflowPlanRepository;
  readonly #instances: WorkflowExecutionRepository;
  readonly #validator: WorkflowValidator;
  readonly #executor: WorkflowExecutor;
  readonly #clock: Clock;
  readonly #ids: Readonly<{ nextEventId(): string }>;
  readonly #skills: SkillRepository;
  readonly #systemBudgetDefaults: WorkflowBudgetLimits;
  readonly #continuations: WorkflowContinuationRepository;
  readonly #continuationIds: Readonly<{
    nextSnapshotId(): string;
    nextContinuationId(): string;
  }>;
  readonly #onContinuationActivationFailure:
    | ((
        input: Readonly<{
          snapshot: WorkflowContinuationSnapshot;
          error: unknown;
        }>,
      ) => Promise<void>)
    | undefined;

  constructor(
    dependencies: Readonly<{
      plans: WorkflowPlanRepository;
      instances: WorkflowExecutionRepository;
      validator: WorkflowValidator;
      executor: WorkflowExecutor;
      clock: Clock;
      ids: Readonly<{ nextEventId(): string }>;
      continuationIds: Readonly<{
        nextSnapshotId(): string;
        nextContinuationId(): string;
      }>;
      continuations: WorkflowContinuationRepository;
      onContinuationActivationFailure?: (
        input: Readonly<{
          snapshot: WorkflowContinuationSnapshot;
          error: unknown;
        }>,
      ) => Promise<void>;
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
    this.#continuations = dependencies.continuations;
    this.#continuationIds = dependencies.continuationIds;
    this.#onContinuationActivationFailure = dependencies.onContinuationActivationFailure;
  }

  async confirm(planId: string, taskId?: string): Promise<WorkflowPlanRecord> {
    const plan = await this.#requirePlan(planId);
    if (
      plan.definition === undefined ||
      (plan.confirmationStatus !== 'awaiting_confirmation' &&
        plan.confirmationStatus !== 'confirmed')
    )
      throw new WorkflowExecutionError(
        'WORKFLOW_PLAN_NOT_EXECUTABLE',
        'Only an active immutable plan with a definition can be confirmed.',
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

  findActiveByPlanId(planId: string): Promise<WorkflowInstance | undefined> {
    return this.#instances.findActiveByPlanId(planId);
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
      executionContext?: RuntimeExecutionContext;
      continuationAuthority?: Readonly<{
        agentTaskId: string;
        contextId: string;
        workflowControlId: string;
      }>;
      onStarted?: (instance: WorkflowInstance) => Promise<void>;
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
    const validation = await this.#validator.validate(
      plan.definition,
      compositionValidationContext(plan),
    );
    if (
      validation.errors.some((error) => error.code === 'WORKFLOW_SKILL_NOT_ALLOWED_BY_COMPOSITION')
    )
      throw new WorkflowExecutionError(
        'WORKFLOW_SKILL_NOT_ALLOWED_BY_COMPOSITION',
        'Persisted plan contains a Skill call outside its immutable composition authority.',
      );
    if (!validation.valid || validation.definition === undefined)
      throw new WorkflowExecutionError(
        'WORKFLOW_PLAN_REVALIDATION_FAILED',
        'Persisted plan no longer validates against current Tool and Skill catalogs.',
      );
    const { skillVersions, governingSkillVersions } = await this.#resolveSkillVersions(
      validation.definition,
      input.skillIds,
    );
    const toolPolicyViolations = validateSkillToolPolicies(
      validation.definition,
      governingSkillVersions,
    );
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
      await input.onStarted?.(running);
      const outcome =
        input.executionContext === undefined
          ? await this.#executor.execute(
              validation.definition,
              input.input,
              budgetLimits,
              input.signal,
              input.instanceId,
            )
          : await this.#executor.execute(
              validation.definition,
              input.input,
              budgetLimits,
              input.signal,
              input.instanceId,
              input.executionContext,
            );
      await this.#instances.saveNodeEvents(this.#events(input.instanceId, outcome.events, 1));
      if (outcome.status === 'waiting_external') {
        if (outcome.continuation === undefined || input.continuationAuthority === undefined)
          throw new WorkflowExecutionError(
            'WORKFLOW_CONTINUATION_AUTHORITY_REQUIRED',
            'External Workflow waits require persisted Task, Context and control authority.',
          );
        const snapshot = createWorkflowContinuationSnapshot({
          schemaVersion: '1.0',
          snapshotId: this.#continuationIds.nextSnapshotId(),
          continuationId: this.#continuationIds.nextContinuationId(),
          stateVersion: 1,
          lifecycle: 'active',
          agentTaskId: input.continuationAuthority.agentTaskId,
          contextId: input.continuationAuthority.contextId,
          workflowControlId: input.continuationAuthority.workflowControlId,
          goalId: plan.goalId,
          goalVersion: plan.goalVersion,
          workflowPlanId: plan.planId,
          workflowDefinitionId: validation.definition.workflowDefinitionId,
          workflowDefinitionVersion: validation.definition.version,
          workflowDefinitionHash: canonicalHash(validation.definition),
          inputHash: canonicalHash(input.input),
          workflowInstanceId: input.instanceId,
          ...outcome.continuation,
          budgetUsage: { ...outcome.continuation.budgetUsage, replanCount },
          createdAt: this.#clock.now(),
          updatedAt: this.#clock.now(),
        });
        try {
          await this.#continuations.saveSnapshot(snapshot);
        } catch (activationError: unknown) {
          try {
            await this.#onContinuationActivationFailure?.({
              snapshot,
              error: activationError,
            });
          } catch (compensationError: unknown) {
            throw new AggregateError(
              [activationError, compensationError],
              'Workflow continuation activation and remote Task compensation both failed.',
              { cause: compensationError },
            );
          }
          throw activationError;
        }
      }
      const completed: WorkflowInstance = {
        ...running,
        status: outcome.status,
        ...(outcome.result === undefined ? {} : { result: outcome.result }),
        errors: outcome.errors,
        budgetUsage: { ...outcome.budgetUsage, replanCount },
        ...(outcome.status === 'paused' || outcome.status === 'waiting_external'
          ? {}
          : { completedAt: this.#clock.now() }),
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
      continuationAuthority?: Readonly<{
        agentTaskId: string;
        contextId: string;
        workflowControlId: string;
      }>;
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
      if (outcome.status === 'waiting_external') {
        if (outcome.continuation === undefined || input.continuationAuthority === undefined)
          throw new WorkflowExecutionError(
            'WORKFLOW_CONTINUATION_AUTHORITY_REQUIRED',
            'External Workflow waits require persisted Task, Context and control authority.',
          );
        const snapshot = createWorkflowContinuationSnapshot({
          schemaVersion: '1.0',
          snapshotId: this.#continuationIds.nextSnapshotId(),
          continuationId: this.#continuationIds.nextContinuationId(),
          stateVersion: 1,
          lifecycle: 'active',
          agentTaskId: input.continuationAuthority.agentTaskId,
          contextId: input.continuationAuthority.contextId,
          workflowControlId: input.continuationAuthority.workflowControlId,
          goalId: plan.goalId,
          goalVersion: plan.goalVersion,
          workflowPlanId: plan.planId,
          workflowDefinitionId: plan.definition.workflowDefinitionId,
          workflowDefinitionVersion: plan.definition.version,
          workflowDefinitionHash: canonicalHash(plan.definition),
          inputHash: canonicalHash(instance.input),
          workflowInstanceId: instance.instanceId,
          ...outcome.continuation,
          budgetUsage: {
            ...outcome.continuation.budgetUsage,
            replanCount: instance.budgetUsage.replanCount,
          },
          createdAt: this.#clock.now(),
          updatedAt: this.#clock.now(),
        });
        try {
          await this.#continuations.saveSnapshot(snapshot);
        } catch (activationError: unknown) {
          try {
            await this.#onContinuationActivationFailure?.({
              snapshot,
              error: activationError,
            });
          } catch (compensationError: unknown) {
            throw new AggregateError(
              [activationError, compensationError],
              'Workflow continuation activation and remote Task compensation both failed.',
              { cause: compensationError },
            );
          }
          throw activationError;
        }
      }
      const resumed: WorkflowInstance = {
        ...instanceWithoutPending,
        status: outcome.status,
        ...(outcome.result === undefined ? {} : { result: outcome.result }),
        errors: outcome.errors,
        budgetUsage: { ...outcome.budgetUsage, replanCount: instance.budgetUsage.replanCount },
        ...(outcome.status === 'paused' || outcome.status === 'waiting_external'
          ? {}
          : { completedAt: this.#clock.now() }),
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

  async continueExternal(
    input: Readonly<{
      instanceId: string;
      resolution: WorkflowExternalWaitResolution;
      continuationAttemptId: string;
      signal?: AbortSignal;
    }>,
  ): Promise<WorkflowInstance> {
    const instance = await this.#instances.findInstance(input.instanceId);
    if (instance?.status !== 'waiting_external')
      throw new WorkflowExecutionError(
        'WORKFLOW_INSTANCE_NOT_WAITING_EXTERNAL',
        'Only a Workflow instance with an active external wait may continue.',
      );
    const snapshot = await this.#continuations.findCurrent(instance.instanceId);
    if (snapshot?.lifecycle !== 'active')
      throw new WorkflowExecutionError(
        'WORKFLOW_CONTINUATION_NOT_FOUND',
        'The active persisted Workflow continuation was not found.',
      );
    const wait = snapshot.waitingNodeRuns.find(
      (candidate) =>
        candidate.waitId === input.resolution.waitId &&
        candidate.nodeRunId === input.resolution.nodeRunId,
    );
    if (wait === undefined)
      throw new WorkflowExecutionError(
        'WORKFLOW_CONTINUATION_WAIT_STALE',
        'The remote Task event does not match an active Workflow node run.',
      );
    const plan = await this.#requirePlan(instance.planId);
    if (
      plan.confirmationStatus !== 'confirmed' ||
      plan.definition === undefined ||
      plan.goalId !== snapshot.goalId ||
      plan.goalVersion !== snapshot.goalVersion ||
      canonicalHash(plan.definition) !== snapshot.workflowDefinitionHash ||
      canonicalHash(instance.input) !== snapshot.inputHash
    )
      throw new WorkflowExecutionError(
        'WORKFLOW_CONTINUATION_AUTHORITY_STALE',
        'The persisted continuation no longer matches its immutable Goal, plan or input.',
      );
    if (this.#executor.continueExternal === undefined)
      throw new WorkflowExecutionError(
        'WORKFLOW_RESUME_UNAVAILABLE',
        'The Workflow runtime does not support external continuation.',
      );
    try {
      const outcome = await this.#executor.continueExternal(
        plan.definition,
        instance.instanceId,
        snapshot,
        input.resolution,
        input.continuationAttemptId,
        input.signal,
      );
      const eventCount = await this.#instances.countNodeEvents(instance.instanceId);
      await this.#instances.saveNodeEvents(
        this.#events(instance.instanceId, outcome.events, eventCount + 1),
      );
      const timestamp = this.#clock.now();
      if (outcome.status === 'waiting_external') {
        if (outcome.continuation === undefined)
          throw new WorkflowExecutionError(
            'WORKFLOW_CONTINUATION_STATE_REQUIRED',
            'The Workflow runtime omitted required external continuation state.',
          );
        await this.#continuations.saveSnapshot(
          createWorkflowContinuationSnapshot({
            ...snapshot,
            snapshotId: this.#continuationIds.nextSnapshotId(),
            stateVersion: snapshot.stateVersion + 1,
            predecessorSnapshotId: snapshot.snapshotId,
            lifecycle: 'active',
            ...outcome.continuation,
            budgetUsage: {
              ...outcome.continuation.budgetUsage,
              replanCount: instance.budgetUsage.replanCount,
            },
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        );
      } else {
        await this.#continuations.transitionLifecycle(
          snapshot.snapshotId,
          'active',
          'terminal',
          timestamp,
        );
      }
      const continued: WorkflowInstance = {
        ...withoutPendingConfirmation(instance),
        status: outcome.status,
        ...(outcome.result === undefined ? {} : { result: outcome.result }),
        errors: outcome.errors,
        budgetUsage: {
          ...outcome.budgetUsage,
          replanCount: instance.budgetUsage.replanCount,
        },
        ...(outcome.status === 'paused' || outcome.status === 'waiting_external'
          ? {}
          : { completedAt: timestamp }),
        ...(outcome.pendingConfirmation === undefined
          ? {}
          : { pendingConfirmation: outcome.pendingConfirmation }),
        ...(outcome.terminationReason === undefined
          ? {}
          : { terminationReason: outcome.terminationReason }),
      };
      await this.#instances.saveInstance(continued);
      return continued;
    } catch (error: unknown) {
      const timestamp = this.#clock.now();
      let lifecycleFailure: unknown;
      try {
        const activeSnapshot = await this.#continuations.findCurrent(instance.instanceId);
        if (activeSnapshot !== undefined)
          await this.#continuations.transitionLifecycle(
            activeSnapshot.snapshotId,
            'active',
            'terminal',
            timestamp,
          );
      } catch (transitionError: unknown) {
        lifecycleFailure = transitionError;
      }
      const failed: WorkflowInstance = {
        ...withoutPendingConfirmation(instance),
        status: 'failed',
        errors: { ...instance.errors, runtime: normalizedError(error) },
        completedAt: timestamp,
      };
      await this.#instances.saveInstance(failed);
      if (lifecycleFailure !== undefined)
        throw new AggregateError(
          [error, lifecycleFailure],
          'Workflow continuation failed and its active snapshot could not be closed.',
          { cause: error },
        );
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
    let canceled: WorkflowInstance;
    if (instance.status === 'waiting_external') {
      const snapshot = await this.#continuations.findCurrent(instance.instanceId);
      if (snapshot === undefined)
        throw new WorkflowExecutionError(
          'WORKFLOW_CONTINUATION_NOT_FOUND',
          'The active external wait cannot be invalidated without its continuation snapshot.',
        );
      const completedAt = this.#clock.now();
      await this.#continuations.transitionLifecycle(
        snapshot.snapshotId,
        'active',
        'invalidated',
        completedAt,
      );
      canceled = {
        ...withoutPendingConfirmation(instance),
        status: 'canceled',
        errors: {
          ...instance.errors,
          cancellation: {
            code: 'WORKFLOW_CANCELED',
            message:
              'Parent cancellation invalidated the persisted remote Task continuation; Provider cancellation is cooperative.',
          },
        },
        completedAt,
      };
      await this.#instances.saveInstance(canceled);
    } else {
      if (
        this.#executor.requestCancel?.(instance.instanceId, strategy === 'try_interrupt') !== true
      )
        throw new WorkflowExecutionError(
          'WORKFLOW_EXECUTION_CONTROL_UNAVAILABLE',
          'The in-memory Workflow execution is unavailable and cannot be canceled.',
        );
      canceled = await this.#waitFor(instance.instanceId, ['canceled', 'failed']);
    }
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
    continuationAuthority?: Readonly<{
      agentTaskId: string;
      contextId: string;
      workflowControlId: string;
    }>,
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
      ...(continuationAuthority === undefined ? {} : { continuationAuthority }),
    });
    return { disposition: 'resumed', instance: resumed };
  }

  async waitForPauseResolution(
    instanceId: string,
    expectedCheckpoint?: WorkflowInstance['pendingConfirmation'],
  ): Promise<WorkflowInstance> {
    const expectedCheckpointKey = confirmationCheckpointKey(expectedCheckpoint);
    for (;;) {
      const instance = await this.#instances.findInstance(instanceId);
      if (instance === undefined)
        throw new WorkflowExecutionError(
          'WORKFLOW_INSTANCE_NOT_FOUND',
          'Paused Workflow instance was not found.',
        );
      if (instance.status !== 'paused') return instance;
      if (
        expectedCheckpoint !== undefined &&
        confirmationCheckpointKey(instance.pendingConfirmation) !== expectedCheckpointKey
      )
        return instance;
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
    const governingIds = new Set(requestedSkillIds ?? []);
    const ids = new Set(governingIds);
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
    return {
      skillVersions: versions,
      governingSkillVersions: versions.filter((version) => governingIds.has(version.skillId)),
    };
  }

  async #requirePlan(planId: string): Promise<WorkflowPlanRecord> {
    const plan = await this.#plans.findPlan(planId);
    if (plan === undefined)
      throw new WorkflowExecutionError('WORKFLOW_PLAN_NOT_FOUND', 'Workflow plan was not found.');
    try {
      assertGoalExecutionContractIdentity(plan.goalContract, {
        goalId: plan.goalId,
        goalVersion: plan.goalVersion,
      });
    } catch {
      throw new WorkflowExecutionError(
        'WORKFLOW_GOAL_CONTRACT_MISMATCH',
        'Workflow plan Goal identity does not match its immutable execution contract.',
      );
    }
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

function confirmationCheckpointKey(checkpoint: WorkflowInstance['pendingConfirmation']): string {
  if (checkpoint === undefined) return '';
  return JSON.stringify({
    nodeId: checkpoint.nodeId,
    kind: checkpoint.kind,
    parentPlanId: checkpoint.parentPlanId,
    childPlanId: checkpoint.childPlanId,
    childSkillId: checkpoint.childSkillId,
    childSkillVersion: checkpoint.childSkillVersion,
    pausedAt: checkpoint.pausedAt,
  });
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
  | 'WORKFLOW_INSTANCE_NOT_WAITING_EXTERNAL'
  | 'WORKFLOW_INSTANCE_ALREADY_EXISTS'
  | 'WORKFLOW_PLAN_NOT_CONFIRMED'
  | 'WORKFLOW_PLAN_NOT_EXECUTABLE'
  | 'WORKFLOW_PLAN_NOT_FOUND'
  | 'WORKFLOW_PLAN_REVALIDATION_FAILED'
  | 'WORKFLOW_GOAL_CONTRACT_MISMATCH'
  | 'WORKFLOW_REPLAN_BUDGET_EXHAUSTED'
  | 'WORKFLOW_RESUME_UNAVAILABLE'
  | 'WORKFLOW_CONTINUATION_AUTHORITY_REQUIRED'
  | 'WORKFLOW_CONTINUATION_AUTHORITY_STALE'
  | 'WORKFLOW_CONTINUATION_NOT_FOUND'
  | 'WORKFLOW_CONTINUATION_WAIT_STALE'
  | 'WORKFLOW_CONTINUATION_STATE_REQUIRED'
  | 'WORKFLOW_EXECUTION_CONTROL_UNAVAILABLE'
  | 'WORKFLOW_EXECUTION_CONTROL_TIMEOUT'
  | 'WORKFLOW_SKILL_NOT_ENABLED'
  | 'WORKFLOW_SKILL_NOT_ALLOWED_BY_COMPOSITION'
  | 'WORKFLOW_SKILL_TOOL_POLICY_VIOLATION';
export class WorkflowExecutionError extends Error {
  readonly code: WorkflowExecutionErrorCode;
  constructor(code: WorkflowExecutionErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowExecutionError';
    this.code = code;
  }
}

function compositionValidationContext(plan: WorkflowPlanRecord) {
  return {
    enforceSkillComposition:
      plan.compositionContext !== undefined || plan.capabilityGapSkillIds !== undefined,
    allowedChildSkillIds: plan.compositionContext?.allowedChildSkillIds ?? [],
    capabilityGapSkillIds: plan.capabilityGapSkillIds ?? [],
  } as const;
}
