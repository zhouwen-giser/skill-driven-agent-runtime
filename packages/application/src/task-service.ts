import {
  ANONYMOUS_USER_ID,
  bindTaskPlan,
  bindTaskReplacement,
  createAgentTask,
  createConversationContext,
  createSkillDraft,
  completeTask,
  failTask,
  isTerminalTaskPhase,
  normalizeUserId,
  recordTaskCapabilityGap,
  transitionTask,
  createTaskExecutionAttempt,
  createTaskInputRequest,
  type AgentTask,
  type ConversationContext,
  type GoalEvaluationResult,
} from '../../domain/src/index.js';

import type {
  AgentTaskRepository,
  Clock,
  ContextTaskQueue,
  ConversationContextRepository,
  IdentifierGenerator,
  RuntimeEventPublisher,
  SkillDraftRepository,
  SkillInputResolutionRepository,
  TaskInputRepository,
} from './ports.js';
import type { ResultCandidate, ResultProcessor } from './result-processor.js';
import type { MemoryService } from './memory-service.js';
import type { ImplicitFeedbackService } from './implicit-feedback.js';
import type { RuntimeTaskCapabilityService } from './task-capability.js';

export interface SubmitTaskCommand {
  readonly taskId?: string;
  readonly contextId?: string;
  readonly userId?: string;
  readonly messageText: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly capabilityInput?: unknown;
  readonly skillDraftIntent?: 'create' | 'update';
}

export interface SubmitTaskResult {
  readonly task: AgentTask;
  readonly context: ConversationContext;
  readonly createdContext: boolean;
}

export type TaskFollowUpAction =
  | 'confirm_plan'
  | 'reject_plan'
  | 'revise_plan'
  | 'patch_goal'
  | 'cancel_goal'
  | 'provide_input'
  | 'pause'
  | 'resume';

export interface TaskFollowUpCommand {
  readonly taskId: string;
  readonly action: TaskFollowUpAction;
  readonly messageText: string;
  readonly inputRequestId?: string;
  /** Protocol-neutral structured supplementary input supplied by an adapter. */
  readonly inputContent?: unknown;
}

export const MAX_TASK_INPUT_RESPONSE_CHARACTERS = 64_000;

export type TaskPlanConfirmationTarget = 'task_plan' | 'nested_skill_plan';

export interface TaskServiceDependencies {
  readonly contexts: ConversationContextRepository;
  readonly tasks: AgentTaskRepository;
  readonly queue: ContextTaskQueue;
  readonly events: RuntimeEventPublisher;
  readonly skillDrafts: SkillDraftRepository;
  readonly taskInputs: TaskInputRepository;
  readonly taskCapabilities?: RuntimeTaskCapabilityService;
  readonly remoteTaskInputs?: Readonly<{
    prepareResponse(inputRequestId: string, inputContent: unknown): Promise<unknown>;
  }>;
  readonly skillInputs?: Pick<SkillInputResolutionRepository, 'find'>;
  readonly clock: Clock;
  readonly ids: IdentifierGenerator;
  readonly memories?: Pick<MemoryService, 'recordEvolution'>;
  readonly feedback?: Pick<
    ImplicitFeedbackService,
    'observeSubmission' | 'observeRevision' | 'observeSkillSwitch'
  >;
  readonly planActions?: Readonly<{
    confirm(task: AgentTask): Promise<TaskPlanConfirmationTarget>;
    reject(task: AgentTask): Promise<void>;
    executeConfirmed(task: AgentTask, target: TaskPlanConfirmationTarget): Promise<void>;
    reviseNaturalLanguage(
      task: AgentTask,
      instruction: string,
    ): Promise<Readonly<{ planId: string; goalId: string; goalVersion: number }>>;
    patchGoal(task: AgentTask, instruction: string): Promise<void>;
    pause(task: AgentTask): Promise<void>;
    commitRuntimeCancellation?(task: AgentTask, reason: string): Promise<boolean>;
    cancel(task: AgentTask): Promise<void>;
    resume(task: AgentTask): Promise<'resumed' | 'replan_required'>;
    cancelGoal(task: AgentTask, reason: string): Promise<void>;
  }>;
}

export class TaskService {
  readonly #dependencies: TaskServiceDependencies;
  readonly #taskDecisionLocks = new Map<string, Promise<void>>();

  constructor(dependencies: TaskServiceDependencies) {
    this.#dependencies = dependencies;
  }

  async submit(command: SubmitTaskCommand): Promise<SubmitTaskResult> {
    const timestamp = this.#dependencies.clock.now();
    const requestedContextId = command.contextId?.trim();
    const contextId =
      requestedContextId === undefined || requestedContextId === ''
        ? this.#dependencies.ids.nextId('context')
        : requestedContextId;
    const requestedUserId = normalizeUserId(command.userId);
    const existing = await this.#dependencies.contexts.findById(contextId);
    const context =
      existing ??
      createConversationContext({
        contextId,
        userId: requestedUserId,
        timestamp,
      });
    const task = createAgentTask({
      taskId:
        command.taskId === undefined || command.taskId.trim() === ''
          ? this.#dependencies.ids.nextId('task')
          : command.taskId.trim(),
      contextId: context.contextId,
      userId: existing?.userId ?? requestedUserId,
      requestText: command.messageText,
      requestMetadata: command.metadata,
      timestamp,
    });

    const attempt = createTaskExecutionAttempt({
      attemptId: this.#dependencies.ids.nextId('attempt'),
      taskId: task.taskId,
      contextId: task.contextId,
      reason: 'initial',
      createdAt: timestamp,
    });
    const createdEvent = {
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: task.taskId,
      contextId: task.contextId,
      eventType: 'task.created' as const,
      timestamp,
      summary: summarizeMessage(command.messageText),
    };
    if (
      command.metadata['io.sdar/requestedCapability'] !== undefined &&
      this.#dependencies.taskCapabilities === undefined
    )
      throw Object.assign(new Error('Explicit Capability admission is unavailable.'), {
        code: 'TASK_CAPABILITY_RUNTIME_NOT_COMPOSED' as const,
      });
    const capabilityAcceptance = await this.#dependencies.taskCapabilities?.prepareAcceptance({
      task,
      metadata: command.metadata,
      capabilityInput: command.capabilityInput ?? { messageText: command.messageText },
      inputAttempt: attempt,
      bindingId: `binding-${task.taskId}`,
      capabilityAttemptId: `capability-attempt-${task.taskId}-1`,
      event: createdEvent,
    });
    if (existing === undefined) await this.#dependencies.contexts.save(context);
    if (capabilityAcceptance === undefined) {
      await this.#dependencies.tasks.save(task);
      await this.#dependencies.taskInputs.createInitialAttempt(attempt);
      await this.#dependencies.events.publish(createdEvent);
    } else {
      await this.#dependencies.taskCapabilities?.accept(capabilityAcceptance);
    }
    await this.#dependencies.feedback?.observeSubmission(task);
    if (command.skillDraftIntent !== undefined) {
      await this.#dependencies.skillDrafts.save(
        createSkillDraft({
          draftId: `draft-${task.taskId}`,
          taskId: task.taskId,
          contextId: task.contextId,
          requestedBy: task.userId,
          intent: command.skillDraftIntent,
          requestText: command.messageText,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    }
    await this.#dependencies.queue.enqueue({
      taskId: task.taskId,
      contextId: task.contextId,
      attemptId: attempt.attemptId,
      mode: 'initial',
    });

    return { task, context, createdContext: existing === undefined };
  }

  async cancel(taskId: string): Promise<AgentTask> {
    return this.#withTaskDecisionLock(taskId, () => this.#cancel(taskId));
  }

  async #cancel(taskId: string): Promise<AgentTask> {
    const task = await this.#dependencies.tasks.findById(taskId);
    if (task === undefined)
      throw new TaskApplicationError('TASK_NOT_FOUND', `Task ${taskId} was not found.`);
    if (isTerminalTaskPhase(task.phase)) return task;
    const timestamp = this.#dependencies.clock.now();
    if (
      this.#dependencies.planActions !== undefined &&
      (await this.#dependencies.planActions.commitRuntimeCancellation?.(
        task,
        'Task canceled by user.',
      )) === true
    ) {
      const committed = await this.#dependencies.tasks.findById(task.taskId);
      if (committed === undefined || !isTerminalTaskPhase(committed.phase))
        throw new TaskApplicationError(
          'TASK_RUNTIME_CANCELLATION_INCOMPLETE',
          'Runtime cancellation did not project a canceled Task.',
        );
      return committed;
    }
    const canceled = transitionTask(task, 'canceled', 'Task canceled by user.', timestamp);
    await this.#dependencies.tasks.save(canceled);
    await this.#dependencies.taskInputs.cancelPending(task.taskId, 'canceled');
    await this.#dependencies.events.publish({
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: canceled.taskId,
      contextId: canceled.contextId,
      eventType: 'task.phase_changed',
      timestamp,
      summary: 'Task canceled by user.',
    });
    if (
      (task.phase === 'executing' ||
        task.phase === 'paused' ||
        task.phase === 'awaiting_plan_confirmation') &&
      task.planId !== undefined &&
      this.#dependencies.planActions !== undefined
    )
      await this.#dependencies.planActions.cancel(task);
    return canceled;
  }

  async releaseTimedOutWait(taskId: string): Promise<void> {
    await this.#withTaskDecisionLock(taskId, async () => {
      const task = await this.get(taskId);
      if (task.phase !== 'canceled' || task.errorCode !== 'TASK_WAIT_TIMEOUT') return;
      if (task.planId !== undefined && this.#dependencies.planActions !== undefined)
        await this.#dependencies.planActions.cancel(task);
    });
  }

  async get(taskId: string): Promise<AgentTask> {
    const task = await this.#dependencies.tasks.findById(taskId);
    if (task === undefined)
      throw new TaskApplicationError('TASK_NOT_FOUND', `Task ${taskId} was not found.`);
    return task;
  }

  list(
    query: Readonly<{
      contextId?: string;
      goalId?: string;
      planId?: string;
      skillId?: string;
      phase?: AgentTask['phase'];
      limit: number;
    }>,
  ) {
    return this.#dependencies.tasks.list(query);
  }

  async followUp(command: TaskFollowUpCommand): Promise<AgentTask> {
    if (command.action === 'confirm_plan' || command.action === 'reject_plan')
      return this.#withTaskDecisionLock(command.taskId, () => this.#followUp(command));
    return this.#followUp(command);
  }

  async #followUp(command: TaskFollowUpCommand): Promise<AgentTask> {
    let task = await this.get(command.taskId);
    if (
      (command.action === 'confirm_plan' || command.action === 'reject_plan') &&
      task.phase !== 'awaiting_plan_confirmation'
    )
      throw new TaskApplicationError(
        'TASK_PLAN_DECISION_NOT_AWAITING',
        `Task ${task.taskId} is ${task.phase}; only an awaiting plan may receive a confirmation decision.`,
      );
    if (isTerminalTaskPhase(task.phase))
      throw new TaskApplicationError(
        'TASK_TERMINAL_FOLLOW_UP_FORBIDDEN',
        `Task ${task.taskId} is terminal in phase ${task.phase}; submit a new Task instead.`,
      );
    let confirmationTarget: TaskPlanConfirmationTarget | undefined;
    if (command.action === 'provide_input') return this.#provideInput(task, command);
    if (command.action === 'cancel_goal') {
      if (task.goalId === undefined || this.#dependencies.planActions === undefined)
        throw new TaskApplicationError(
          'TASK_PLAN_ACTIONS_UNAVAILABLE',
          'Task Goal cancellation is unavailable.',
        );
      await this.#dependencies.planActions.cancelGoal(task, command.messageText);
      return this.get(task.taskId);
    }
    if (command.action === 'pause') {
      if (task.planId === undefined || this.#dependencies.planActions === undefined)
        throw new TaskApplicationError(
          'TASK_PLAN_ACTIONS_UNAVAILABLE',
          'Task execution pause is unavailable.',
        );
      await this.#dependencies.planActions.pause(task);
    }
    if (command.action === 'resume') {
      if (task.planId === undefined || this.#dependencies.planActions === undefined)
        throw new TaskApplicationError(
          'TASK_PLAN_ACTIONS_UNAVAILABLE',
          'Task execution resume is unavailable.',
        );
      task = await this.#saveTransition(task, 'executing', 'Task resumed by user.');
      const disposition = await this.#dependencies.planActions.resume(task);
      if (disposition === 'replan_required') {
        task = await this.#saveTransition(
          task,
          'planning',
          'Pause threshold exceeded; a new plan and confirmation are required.',
        );
        const revised = await this.#dependencies.planActions.reviseNaturalLanguage(
          task,
          'Replan from persisted results after a long pause. Do not reuse the old confirmation.',
        );
        task = bindTaskPlan(task, {
          planId: revised.planId,
          goalId: revised.goalId,
          goalVersion: revised.goalVersion,
          timestamp: this.#dependencies.clock.now(),
        });
        await this.#dependencies.tasks.save(task);
        await this.#dependencies.taskCapabilities?.appendAttempt(task.taskId, {
          attemptId: `capability-attempt-${this.#dependencies.ids.nextId('attempt')}`,
          reason: 'recovery',
          planId: revised.planId,
        });
        return this.#saveTransition(
          task,
          'awaiting_plan_confirmation',
          'Long-pause replanned Workflow requires fresh confirmation.',
        );
      }
    }
    if (command.action === 'patch_goal') {
      if (
        task.goalId === undefined ||
        task.goalVersion === undefined ||
        task.planId === undefined ||
        this.#dependencies.planActions === undefined
      )
        throw new TaskApplicationError(
          'TASK_PLAN_NOT_ATTACHED',
          'Task has no Goal/plan that can be patched.',
        );
      await this.#dependencies.planActions.patchGoal(task, command.messageText);
      task = await this.get(task.taskId);
      await this.#dependencies.events.publish({
        eventId: this.#dependencies.ids.nextId('event'),
        taskId: task.taskId,
        contextId: task.contextId,
        eventType: 'task.phase_changed',
        timestamp: this.#dependencies.clock.now(),
        summary: 'Goal Patch invalidated the old plan; new plan confirmation is required.',
      });
      return task;
    }
    if (command.action === 'revise_plan') {
      if (task.planId === undefined || this.#dependencies.planActions === undefined)
        throw new TaskApplicationError(
          'TASK_PLAN_NOT_ATTACHED',
          'Task has no revisable Workflow plan.',
        );
      const revised = await this.#dependencies.planActions.reviseNaturalLanguage(
        task,
        command.messageText,
      );
      task = bindTaskPlan(task, {
        planId: revised.planId,
        goalId: revised.goalId,
        goalVersion: revised.goalVersion,
        timestamp: this.#dependencies.clock.now(),
      });
      await this.#dependencies.tasks.save(task);
      await this.#dependencies.feedback?.observeRevision(task, command.messageText);
    }
    if (command.action === 'confirm_plan') {
      if (task.planId === undefined)
        throw new TaskApplicationError(
          'TASK_PLAN_NOT_ATTACHED',
          'Task has no confirmable Workflow plan.',
        );
      if (this.#dependencies.planActions === undefined)
        throw new TaskApplicationError(
          'TASK_PLAN_ACTIONS_UNAVAILABLE',
          'Task plan confirmation is unavailable.',
        );
      confirmationTarget = await this.#dependencies.planActions.confirm(task);
    }
    if (command.action === 'reject_plan' && this.#dependencies.planActions !== undefined)
      await this.#dependencies.planActions.reject(task);
    const transitions = command.action === 'resume' ? [] : followUpTransitions(command.action);
    for (const transition of transitions) {
      const timestamp = this.#dependencies.clock.now();
      task = transitionTask(task, transition.phase, transition.message, timestamp);
      await this.#dependencies.tasks.save(task);
      await this.#dependencies.events.publish({
        eventId: this.#dependencies.ids.nextId('event'),
        taskId: task.taskId,
        contextId: task.contextId,
        eventType: 'task.phase_changed',
        timestamp,
        summary: `${transition.message} ${summarizeMessage(command.messageText)}`,
      });
    }
    if (command.action === 'confirm_plan' && this.#dependencies.planActions !== undefined) {
      if (confirmationTarget === undefined) throw new Error('TASK_CONFIRMATION_TARGET_MISSING');
      await this.#dependencies.planActions.executeConfirmed(task, confirmationTarget);
      return this.get(task.taskId);
    }
    return task;
  }

  async #withTaskDecisionLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#taskDecisionLocks.get(taskId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const queued = previous.then(() => gate);
    this.#taskDecisionLocks.set(taskId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#taskDecisionLocks.get(taskId) === queued) this.#taskDecisionLocks.delete(taskId);
    }
  }

  async attachPlan(
    taskId: string,
    input: Readonly<{ planId: string; goalId: string; goalVersion: number }>,
  ): Promise<AgentTask> {
    const task = bindTaskPlan(await this.get(taskId), {
      ...input,
      timestamp: this.#dependencies.clock.now(),
    });
    await this.#dependencies.tasks.save(task);
    return task;
  }

  async requestInput(
    taskId: string,
    reason: string,
    origin: Readonly<{
      source: 'goal_deliberation' | 'skill_input_resolution' | 'goal_evaluation' | 'workflow';
      controlId?: string;
      controlRoundIndex?: number;
    }> = { source: 'workflow' },
  ): Promise<AgentTask> {
    const task = await this.get(taskId);
    const timestamp = this.#dependencies.clock.now();
    const request = createTaskInputRequest({
      inputRequestId: this.#dependencies.ids.nextId('input-request'),
      taskId: task.taskId,
      contextId: task.contextId,
      source: origin.source,
      question: reason,
      ...(origin.controlId === undefined ? {} : { controlId: origin.controlId }),
      ...(origin.controlRoundIndex === undefined
        ? {}
        : { controlRoundIndex: origin.controlRoundIndex }),
      createdAt: timestamp,
    });
    await this.#dependencies.taskInputs.createRequest(request);
    const waiting = transitionTask(task, 'awaiting_user_input', reason, timestamp);
    await this.#dependencies.tasks.save(waiting);
    await this.#dependencies.events.publish({
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: waiting.taskId,
      contextId: waiting.contextId,
      eventType: 'task.phase_changed',
      timestamp,
      summary: reason,
    });
    return waiting;
  }

  async requestNestedSkillConfirmation(
    taskId: string,
    input: Readonly<{
      childPlanId: string;
      childSkillId: string;
      childSkillVersion: number;
    }>,
  ): Promise<AgentTask> {
    const task = await this.get(taskId);
    if (task.phase === 'awaiting_plan_confirmation') return task;
    const waiting = transitionTask(
      task,
      'awaiting_plan_confirmation',
      `Child Skill ${input.childSkillId}@${String(input.childSkillVersion)} plan ${input.childPlanId} requires independent confirmation.`,
      this.#dependencies.clock.now(),
    );
    await this.#dependencies.tasks.save(waiting);
    await this.#dependencies.events.publish({
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: waiting.taskId,
      contextId: waiting.contextId,
      eventType: 'task.phase_changed',
      timestamp: waiting.updatedAt,
      summary: waiting.phaseMessage,
    });
    return waiting;
  }

  async executionInput(taskId: string): Promise<unknown> {
    const task = await this.get(taskId);
    if (task.selectedSkillId !== undefined) {
      if (
        task.selectedSkillVersion === undefined ||
        task.goalVersion === undefined ||
        task.skillInputResolutionId === undefined ||
        this.#dependencies.skillInputs === undefined
      )
        throw new TaskApplicationError(
          'TASK_SKILL_INPUT_NOT_RESOLVED',
          'Task has no configured top-level Skill input authority.',
        );
      const resolution = await this.#dependencies.skillInputs.find(task.skillInputResolutionId);
      if (
        resolution?.status !== 'resolved' ||
        resolution.structuredInput === undefined ||
        resolution.taskId !== task.taskId ||
        resolution.goalVersion !== task.goalVersion ||
        resolution.skillId !== task.selectedSkillId ||
        resolution.skillVersion !== task.selectedSkillVersion
      )
        throw new TaskApplicationError(
          'TASK_SKILL_INPUT_NOT_RESOLVED',
          'Task has no schema-validated top-level Skill input for its current Goal version.',
        );
      return resolution.structuredInput;
    }
    const responses = await this.#dependencies.taskInputs.listResponses(taskId);
    return {
      requestText: task.requestText,
      supplementaryInputs: responses.map((response) => ({
        inputRequestId: response.inputRequestId,
        content: response.content,
      })),
    };
  }

  async awaitInputContinuationConfirmation(
    taskId: string,
    input: Readonly<{ planId: string; goalId: string; goalVersion: number; summary: string }>,
  ): Promise<AgentTask> {
    let task = await this.get(taskId);
    if (task.phase !== 'planning')
      task = await this.#saveTransition(task, 'planning', input.summary);
    task = bindTaskPlan(task, {
      planId: input.planId,
      goalId: input.goalId,
      goalVersion: input.goalVersion,
      timestamp: this.#dependencies.clock.now(),
    });
    await this.#dependencies.tasks.save(task);
    await this.#dependencies.taskCapabilities?.appendAttempt(task.taskId, {
      attemptId: `capability-attempt-${this.#dependencies.ids.nextId('attempt')}`,
      reason: 'replan',
      planId: input.planId,
    });
    return this.#saveTransition(
      task,
      'awaiting_plan_confirmation',
      'Supplementary input produced a new plan that requires confirmation.',
    );
  }

  async reportCapabilityGap(taskId: string, evaluation: GoalEvaluationResult): Promise<AgentTask> {
    if (
      evaluation.decision !== 'capability_gap' ||
      evaluation.missingCapability === undefined ||
      evaluation.suggestedToolContract === undefined
    )
      throw new TaskApplicationError(
        'TASK_CAPABILITY_GAP_EVIDENCE_INVALID',
        'Capability-gap Task projection requires complete structured evidence.',
      );
    const task = await this.get(taskId);
    const timestamp = this.#dependencies.clock.now();
    const waiting = recordTaskCapabilityGap(
      task,
      {
        evaluationSummary: evaluation.summary,
        missingCapability: evaluation.missingCapability,
        suggestedToolContract: evaluation.suggestedToolContract,
      },
      timestamp,
    );
    await this.#dependencies.tasks.save(waiting);
    await this.#dependencies.events.publish({
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: waiting.taskId,
      contextId: waiting.contextId,
      eventType: 'task.phase_changed',
      timestamp,
      summary: `Capability gap: ${evaluation.summary}`,
    });
    return waiting;
  }

  async awaitReplacementConfirmation(
    taskId: string,
    input: Readonly<{ planId: string; skillId: string; skillVersion: number; summary: string }>,
  ): Promise<AgentTask> {
    let task = await this.get(taskId);
    const previousSkillId = task.selectedSkillId;
    task = await this.#saveTransition(task, 'planning', input.summary);
    task = bindTaskReplacement(task, { ...input, timestamp: this.#dependencies.clock.now() });
    await this.#dependencies.tasks.save(task);
    if (previousSkillId !== undefined && previousSkillId !== input.skillId)
      await this.#dependencies.feedback?.observeSkillSwitch(task, previousSkillId, input.skillId);
    await this.#dependencies.taskCapabilities?.appendAttempt(task.taskId, {
      attemptId: `capability-attempt-${this.#dependencies.ids.nextId('attempt')}`,
      reason: 'manual_change',
      planId: input.planId,
      skillVersionRefs: [`skill:${input.skillId}:${String(input.skillVersion)}`],
    });
    return this.#saveTransition(
      task,
      'awaiting_plan_confirmation',
      'Replacement Skill plan requires fresh confirmation.',
    );
  }

  async fail(taskId: string, errorCode: string, message: string): Promise<AgentTask> {
    const task = await this.get(taskId);
    if (isTerminalTaskPhase(task.phase)) return task;
    const timestamp = this.#dependencies.clock.now();
    const failed = { ...failTask(task, errorCode, timestamp), phaseMessage: message };
    await this.#dependencies.tasks.save(failed);
    await this.#dependencies.taskCapabilities?.markLatestAttempt(taskId, 'failed', timestamp);
    await this.#dependencies.taskInputs.cancelPending(task.taskId, 'canceled');
    await this.#dependencies.events.publish({
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: failed.taskId,
      contextId: failed.contextId,
      eventType: 'task.phase_changed',
      timestamp,
      summary: message,
    });
    await this.#dependencies.memories?.recordEvolution({
      kind: 'failure_reason',
      sourceRef: `task:${failed.taskId}`,
      summary: message,
      content: {
        taskId: failed.taskId,
        contextId: failed.contextId,
        errorCode,
        phase: failed.phase,
      },
      confidence: 1,
      successful: false,
    });
    return failed;
  }

  async recordResult(
    taskId: string,
    candidate: ResultCandidate,
    processor: ResultProcessor,
  ): Promise<AgentTask> {
    const output = processor.process(candidate);
    await this.#dependencies.taskCapabilities?.assertTerminalSuccess(taskId, output.structured);
    let task = await this.get(taskId);
    if (task.phase === 'executing') {
      task = await this.#saveTransition(task, 'evaluating', 'Result validation completed.');
    }
    const timestamp = this.#dependencies.clock.now();
    const completed = completeTask(task, output, timestamp);
    await this.#dependencies.tasks.save(completed);
    await this.#dependencies.taskCapabilities?.markLatestAttempt(taskId, 'succeeded', timestamp);
    await this.#dependencies.events.publish({
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: completed.taskId,
      contextId: completed.contextId,
      eventType: 'task.phase_changed',
      timestamp,
      summary: 'Task completed with schema-validated result.',
    });
    return completed;
  }

  async #saveTransition(
    task: AgentTask,
    phase: Parameters<typeof transitionTask>[1],
    message: string,
  ): Promise<AgentTask> {
    const timestamp = this.#dependencies.clock.now();
    const next = transitionTask(task, phase, message, timestamp);
    await this.#dependencies.tasks.save(next);
    await this.#dependencies.events.publish({
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: next.taskId,
      contextId: next.contextId,
      eventType: 'task.phase_changed',
      timestamp,
      summary: message,
    });
    return next;
  }

  async #provideInput(task: AgentTask, command: TaskFollowUpCommand): Promise<AgentTask> {
    if (task.phase !== 'awaiting_user_input')
      throw new TaskApplicationError(
        'TASK_INPUT_NOT_PENDING',
        'Task is not waiting for supplementary input.',
      );
    if (command.messageText.length > MAX_TASK_INPUT_RESPONSE_CHARACTERS)
      throw new TaskApplicationError(
        'TASK_INPUT_RESPONSE_TOO_LARGE',
        `Supplementary input exceeds ${String(MAX_TASK_INPUT_RESPONSE_CHARACTERS)} characters.`,
      );
    const pending =
      command.inputRequestId === undefined
        ? await this.#dependencies.taskInputs.findPendingByTask(task.taskId)
        : await this.#dependencies.taskInputs.findRequest(command.inputRequestId);
    if (pending === undefined)
      throw new TaskApplicationError(
        'TASK_INPUT_NOT_PENDING',
        'Task has no pending supplementary input request.',
      );
    if (pending.taskId !== task.taskId)
      throw new TaskApplicationError(
        'TASK_INPUT_TASK_MISMATCH',
        'Supplementary input request belongs to another Task.',
      );
    if (pending.status !== 'waiting')
      throw new TaskApplicationError(
        'TASK_INPUT_ALREADY_RESOLVED',
        `Supplementary input request is ${pending.status}.`,
      );
    const responseContent =
      pending.source === 'remote_task'
        ? await this.#prepareRemoteTaskInput(
            pending.inputRequestId,
            command.inputContent ?? command.messageText,
          )
        : (command.inputContent ?? command.messageText);
    const timestamp = this.#dependencies.clock.now();
    const attempt = createTaskExecutionAttempt({
      attemptId: this.#dependencies.ids.nextId('attempt'),
      taskId: task.taskId,
      contextId: task.contextId,
      reason: 'input_response',
      inputRequestId: pending.inputRequestId,
      createdAt: timestamp,
    });
    const phaseMessage = 'Supplementary input saved; continuation queued.';
    task = await this.#dependencies.taskInputs.answerAndCreateAttempt({
      inputRequestId: pending.inputRequestId,
      taskId: task.taskId,
      response: {
        inputResponseId: this.#dependencies.ids.nextId('input-response'),
        inputRequestId: pending.inputRequestId,
        taskId: task.taskId,
        content: responseContent,
        createdAt: timestamp,
      },
      attempt,
      answeredAt: timestamp,
      continuationPhase:
        pending.source === 'remote_task'
          ? 'executing'
          : pending.source === 'goal_deliberation'
            ? 'goal_deliberation'
            : 'planning',
      phaseMessage,
    });
    await this.#dependencies.events.publish({
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: task.taskId,
      contextId: task.contextId,
      eventType: 'task.phase_changed',
      timestamp,
      summary: phaseMessage,
    });
    try {
      await this.#dependencies.queue.enqueue({
        taskId: task.taskId,
        contextId: task.contextId,
        attemptId: attempt.attemptId,
        mode: 'continue_after_input',
      });
    } catch {
      // The durable queued attempt is reconciled by TaskAttemptDispatchService.
    }
    return task;
  }

  async #prepareRemoteTaskInput(inputRequestId: string, inputContent: unknown): Promise<unknown> {
    if (this.#dependencies.remoteTaskInputs === undefined)
      throw new TaskApplicationError(
        'TASK_REMOTE_INPUT_UNAVAILABLE',
        'Remote Task supplementary input is unavailable.',
      );
    return this.#dependencies.remoteTaskInputs.prepareResponse(inputRequestId, inputContent);
  }
}

export type TaskApplicationErrorCode =
  | 'GATEWAY_DENIED'
  | 'GATEWAY_FORMAL_HANDOFF_INCOMPLETE'
  | 'TASK_CAPABILITY_GAP_EVIDENCE_INVALID'
  | 'TASK_TERMINAL_FOLLOW_UP_FORBIDDEN'
  | 'TASK_NOT_FOUND'
  | 'TASK_SKILL_INPUT_NOT_RESOLVED'
  | 'TASK_INPUT_NOT_PENDING'
  | 'TASK_INPUT_TASK_MISMATCH'
  | 'TASK_INPUT_ALREADY_RESOLVED'
  | 'TASK_INPUT_RESPONSE_TOO_LARGE'
  | 'TASK_REMOTE_INPUT_UNAVAILABLE'
  | 'TASK_PLAN_ACTIONS_UNAVAILABLE'
  | 'TASK_PLAN_NOT_ATTACHED'
  | 'TASK_RUNTIME_CANCELLATION_INCOMPLETE'
  | 'TASK_PLAN_DECISION_NOT_AWAITING';

export class TaskApplicationError extends Error {
  readonly code: TaskApplicationErrorCode;

  constructor(code: TaskApplicationErrorCode, message: string) {
    super(message);
    this.name = 'TaskApplicationError';
    this.code = code;
  }
}

function summarizeMessage(messageText: string): string {
  const normalized = messageText.trim();
  if (normalized === '') return 'Task created.';
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
}

function followUpTransitions(
  action: TaskFollowUpAction,
): readonly Readonly<{ phase: Parameters<typeof transitionTask>[1]; message: string }>[] {
  if (action === 'confirm_plan') return [{ phase: 'executing', message: 'Plan confirmed.' }];
  if (action === 'reject_plan') return [{ phase: 'canceled', message: 'Plan rejected.' }];
  if (action === 'revise_plan')
    return [
      { phase: 'planning', message: 'Plan revision requested.' },
      { phase: 'awaiting_plan_confirmation', message: 'Revised plan confirmation required.' },
    ];
  if (action === 'patch_goal') return [];
  if (action === 'cancel_goal') return [];
  if (action === 'provide_input')
    return [{ phase: 'goal_deliberation', message: 'Supplementary input received.' }];
  if (action === 'pause') return [{ phase: 'paused', message: 'Task paused by user.' }];
  return [{ phase: 'executing', message: 'Task resumed by user.' }];
}

export { ANONYMOUS_USER_ID };
