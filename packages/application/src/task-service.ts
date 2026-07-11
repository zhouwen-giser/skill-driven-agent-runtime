import {
  ANONYMOUS_USER_ID,
  createAgentTask,
  createConversationContext,
  createSkillDraft,
  completeTask,
  normalizeUserId,
  transitionTask,
  type AgentTask,
  type ConversationContext,
} from '../../domain/src/index.js';

import type {
  AgentTaskRepository,
  Clock,
  ContextTaskQueue,
  ConversationContextRepository,
  IdentifierGenerator,
  RuntimeEventPublisher,
  SkillDraftRepository,
} from './ports.js';
import type { ResultCandidate, ResultProcessor } from './result-processor.js';

export interface SubmitTaskCommand {
  readonly taskId?: string;
  readonly contextId?: string;
  readonly userId?: string;
  readonly messageText: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly skillDraftIntent?: 'create' | 'update';
}

export interface SubmitTaskResult {
  readonly task: AgentTask;
  readonly context: ConversationContext;
  readonly createdContext: boolean;
}

export type TaskFollowUpAction =
  'confirm_plan' | 'reject_plan' | 'revise_plan' | 'provide_input' | 'pause' | 'resume';

export interface TaskFollowUpCommand {
  readonly taskId: string;
  readonly action: TaskFollowUpAction;
  readonly messageText: string;
}

export interface TaskServiceDependencies {
  readonly contexts: ConversationContextRepository;
  readonly tasks: AgentTaskRepository;
  readonly queue: ContextTaskQueue;
  readonly events: RuntimeEventPublisher;
  readonly skillDrafts: SkillDraftRepository;
  readonly clock: Clock;
  readonly ids: IdentifierGenerator;
}

export class TaskService {
  readonly #dependencies: TaskServiceDependencies;

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

    if (existing === undefined) await this.#dependencies.contexts.save(context);
    await this.#dependencies.tasks.save(task);
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
    await this.#dependencies.events.publish({
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: task.taskId,
      contextId: task.contextId,
      eventType: 'task.created',
      timestamp,
      summary: summarizeMessage(command.messageText),
    });
    await this.#dependencies.queue.enqueue({ taskId: task.taskId, contextId: task.contextId });

    return { task, context, createdContext: existing === undefined };
  }

  async cancel(taskId: string): Promise<AgentTask> {
    const task = await this.#dependencies.tasks.findById(taskId);
    if (task === undefined)
      throw new TaskApplicationError('TASK_NOT_FOUND', `Task ${taskId} was not found.`);
    const timestamp = this.#dependencies.clock.now();
    const canceled = transitionTask(task, 'canceled', 'Task canceled by user.', timestamp);
    await this.#dependencies.tasks.save(canceled);
    await this.#dependencies.events.publish({
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: canceled.taskId,
      contextId: canceled.contextId,
      eventType: 'task.phase_changed',
      timestamp,
      summary: 'Task canceled by user.',
    });
    return canceled;
  }

  async get(taskId: string): Promise<AgentTask> {
    const task = await this.#dependencies.tasks.findById(taskId);
    if (task === undefined)
      throw new TaskApplicationError('TASK_NOT_FOUND', `Task ${taskId} was not found.`);
    return task;
  }

  async followUp(command: TaskFollowUpCommand): Promise<AgentTask> {
    let task = await this.get(command.taskId);
    const transitions = followUpTransitions(command.action);
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
    return task;
  }

  async requestInput(taskId: string, reason: string): Promise<AgentTask> {
    const task = await this.get(taskId);
    const timestamp = this.#dependencies.clock.now();
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

  async recordResult(
    taskId: string,
    candidate: ResultCandidate,
    processor: ResultProcessor,
  ): Promise<AgentTask> {
    const output = processor.process(candidate);
    let task = await this.get(taskId);
    if (task.phase === 'executing') {
      task = await this.#saveTransition(task, 'evaluating', 'Result validation completed.');
    }
    const timestamp = this.#dependencies.clock.now();
    const completed = completeTask(task, output, timestamp);
    await this.#dependencies.tasks.save(completed);
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
}

export type TaskApplicationErrorCode = 'TASK_NOT_FOUND';

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
  if (action === 'provide_input')
    return [{ phase: 'goal_deliberation', message: 'Supplementary input received.' }];
  if (action === 'pause') return [{ phase: 'paused', message: 'Task paused by user.' }];
  return [{ phase: 'executing', message: 'Task resumed by user.' }];
}

export { ANONYMOUS_USER_ID };
