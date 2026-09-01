import { Message, Task, TaskState } from '@a2a-js/sdk';
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from '@a2a-js/sdk/server';
import { z } from 'zod';

import type { TaskService, TaskStateNotifier } from '../../application/src/index.js';
import type { AgentTask } from '../../domain/src/index.js';
import { governedControlPrincipalForA2AUser } from './authenticated-confirm-user.js';
import { buildStatusUpdate } from './compatibility.js';
import {
  taskPhaseToA2AState,
  toA2ATask,
  toSubmitTaskCommand,
  toTaskFollowUp,
} from './task-mapping.js';

export interface TaskServiceAgentExecutorOptions {
  readonly tasks: Pick<TaskService, 'submit' | 'get' | 'followUp' | 'cancel'>;
  readonly notifier: TaskStateNotifier;
  readonly safetyPollIntervalMs?: number;
  readonly waitTimeoutMs?: number;
  readonly interaction?: (taskId: string) => Promise<Readonly<Record<string, unknown>> | undefined>;
}

export const MIN_A2A_SAFETY_POLL_INTERVAL_MS = 100;

export class TaskServiceAgentExecutor implements AgentExecutor {
  readonly #tasks: Pick<TaskService, 'submit' | 'get' | 'followUp' | 'cancel'>;
  readonly #notifier: TaskStateNotifier;
  readonly #safetyPollIntervalMs: number;
  readonly #waitTimeoutMs: number;
  readonly #interaction:
    ((taskId: string) => Promise<Readonly<Record<string, unknown>> | undefined>) | undefined;
  #closed = false;

  constructor(options: TaskServiceAgentExecutorOptions) {
    this.#tasks = options.tasks;
    this.#notifier = options.notifier;
    this.#safetyPollIntervalMs = options.safetyPollIntervalMs ?? 1_000;
    this.#waitTimeoutMs = options.waitTimeoutMs ?? 30_000;
    this.#interaction = options.interaction;
    if (
      !Number.isFinite(this.#safetyPollIntervalMs) ||
      this.#safetyPollIntervalMs < MIN_A2A_SAFETY_POLL_INTERVAL_MS ||
      !Number.isFinite(this.#waitTimeoutMs) ||
      this.#waitTimeoutMs <= 0
    )
      throw new TaskServiceAgentExecutorError(
        'A2A_TASK_WAIT_CONFIGURATION_INVALID',
        `A2A wait timeout must be positive and safety polling must be at least ${String(MIN_A2A_SAFETY_POLL_INTERVAL_MS)} ms.`,
      );
  }

  async execute(request: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    if (this.#isClosed())
      throw new TaskServiceAgentExecutorError(
        'A2A_TASK_EXECUTOR_CLOSED',
        'The A2A Task executor is closed.',
      );
    if (request.task !== undefined) {
      const followUp = toTaskFollowUp(request.userMessage);
      const confirmationPrincipal =
        followUp.action === 'confirm_plan' || followUp.action === 'confirm_weapon_action'
          ? governedControlPrincipalForA2AUser(request.context.user)
          : undefined;
      const updated = await this.#tasks.followUp({
        taskId: request.taskId,
        ...followUp,
        ...(confirmationPrincipal === undefined
          ? {}
          : {
              confirmationAuthority: Object.freeze({ principal: confirmationPrincipal }),
            }),
      });
      eventBus.publish(
        AgentEvent.task(
          withUserHistory(await this.#project(updated), request.userMessage, request.task),
        ),
      );
      eventBus.publish(AgentEvent.statusUpdate(toStatusUpdate(updated)));
      eventBus.finished();
      return;
    }
    const command = toSubmitTaskCommand(request.userMessage, request.taskId, request.contextId);
    let submitted: Awaited<ReturnType<TaskService['submit']>>;
    try {
      submitted = await this.#tasks.submit(command);
    } catch (error: unknown) {
      if (!isInitialAdmissionConflict(error)) throw error;
      eventBus.publish(
        AgentEvent.message(
          Message.fromJSON({
            messageId: `${request.userMessage.messageId}:idempotency-conflict`,
            role: 'ROLE_AGENT',
            parts: [
              {
                text: 'The idempotency key is already bound to a different initial request.',
                mediaType: 'text/plain',
              },
            ],
            metadata: {
              'io.sdar/error': {
                code: 'TASK_INITIAL_ADMISSION_IDEMPOTENCY_CONFLICT',
                retryable: false,
              },
            },
          }),
        ),
      );
      eventBus.finished();
      return;
    }
    const initial = withUserHistory(await this.#project(submitted.task), request.userMessage);
    eventBus.publish(AgentEvent.task(initial));

    let current = submitted.task;
    const deadline = Date.now() + this.#waitTimeoutMs;
    for (;;) {
      if (isA2AResponseBoundary(current)) {
        eventBus.finished();
        return;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        current = await this.#tasks.get(submitted.task.taskId);
        eventBus.publish(AgentEvent.statusUpdate(toStatusUpdate(current)));
        eventBus.finished();
        return;
      }
      const previous = current;
      await this.#notifier.waitForChange(
        current.taskId,
        current.updatedAt,
        Math.min(this.#safetyPollIntervalMs, remainingMs),
      );
      if (this.#isClosed()) {
        eventBus.finished();
        return;
      }
      current = await this.#tasks.get(submitted.task.taskId);
      if (this.#isClosed()) {
        eventBus.finished();
        return;
      }
      const changed = taskProjectionChanged(previous, current);
      if (changed) eventBus.publish(AgentEvent.statusUpdate(toStatusUpdate(current)));
      if (isA2AResponseBoundary(current)) {
        eventBus.finished();
        return;
      }
      if (Date.now() >= deadline) {
        if (!changed) eventBus.publish(AgentEvent.statusUpdate(toStatusUpdate(current)));
        eventBus.finished();
        return;
      }
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    const canceled = await this.#tasks.cancel(taskId);
    eventBus.publish(AgentEvent.statusUpdate(toStatusUpdate(canceled)));
    eventBus.finished();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#notifier.close();
  }

  async #project(task: AgentTask): Promise<Task> {
    return toA2ATask(task, await this.#interaction?.(task.taskId));
  }

  #isClosed(): boolean {
    return this.#closed;
  }
}

function withUserHistory(task: Task, message: Message, previous?: Task): Task {
  const document = z.record(z.string(), z.unknown()).parse(Task.toJSON(task));
  const normalizedMessage = withTaskIdentity(message, task.id, task.contextId);
  return Task.fromJSON({
    ...document,
    history: [
      ...(previous?.history ?? []).map((item) =>
        Message.toJSON(withoutMetadata(withTaskIdentity(item, task.id, task.contextId))),
      ),
      Message.toJSON(withoutMetadata(normalizedMessage)),
    ],
  });
}

function withTaskIdentity(message: Message, taskId: string, contextId: string): Message {
  const document = z.record(z.string(), z.unknown()).parse(Message.toJSON(message));
  return Message.fromJSON({ ...document, taskId, contextId });
}

function withoutMetadata(message: Message): Message {
  const document = z.record(z.string(), z.unknown()).parse(Message.toJSON(message));
  return Message.fromJSON({ ...document, metadata: {} });
}

function toStatusUpdate(task: AgentTask) {
  return buildStatusUpdate(
    task.taskId,
    task.contextId,
    taskPhaseToA2AState(task.phase),
    task.updatedAt,
    task.phaseMessage,
  );
}

function isA2AResponseBoundary(task: AgentTask): boolean {
  const state = taskPhaseToA2AState(task.phase);
  return (
    state === TaskState.TASK_STATE_INPUT_REQUIRED ||
    state === TaskState.TASK_STATE_COMPLETED ||
    state === TaskState.TASK_STATE_CANCELED ||
    state === TaskState.TASK_STATE_FAILED
  );
}

function taskProjectionChanged(previous: AgentTask, current: AgentTask): boolean {
  return (
    previous.phase !== current.phase ||
    previous.updatedAt !== current.updatedAt ||
    previous.phaseMessage !== current.phaseMessage
  );
}

function isInitialAdmissionConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'TASK_INITIAL_ADMISSION_IDEMPOTENCY_CONFLICT'
  );
}

export type TaskServiceAgentExecutorErrorCode =
  'A2A_TASK_WAIT_CONFIGURATION_INVALID' | 'A2A_TASK_EXECUTOR_CLOSED';

export class TaskServiceAgentExecutorError extends Error {
  readonly code: TaskServiceAgentExecutorErrorCode;

  constructor(code: TaskServiceAgentExecutorErrorCode, message: string) {
    super(message);
    this.name = 'TaskServiceAgentExecutorError';
    this.code = code;
  }
}
