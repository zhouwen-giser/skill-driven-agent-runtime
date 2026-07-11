import { Message, Task, TaskState } from '@a2a-js/sdk';
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from '@a2a-js/sdk/server';
import { z } from 'zod';

import type { TaskService } from '../../application/src/index.js';
import type { AgentTask } from '../../domain/src/index.js';
import { buildStatusUpdate } from './compatibility.js';
import {
  taskPhaseToA2AState,
  toA2ATask,
  toSubmitTaskCommand,
  toTaskFollowUp,
} from './task-mapping.js';

export interface TaskServiceAgentExecutorOptions {
  readonly tasks: TaskService;
  readonly pollIntervalMs?: number;
  readonly waitTimeoutMs?: number;
}

export class TaskServiceAgentExecutor implements AgentExecutor {
  readonly #tasks: TaskService;
  readonly #pollIntervalMs: number;
  readonly #waitTimeoutMs: number;

  constructor(options: TaskServiceAgentExecutorOptions) {
    this.#tasks = options.tasks;
    this.#pollIntervalMs = options.pollIntervalMs ?? 10;
    this.#waitTimeoutMs = options.waitTimeoutMs ?? 30_000;
  }

  async execute(request: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    if (request.task !== undefined) {
      const followUp = toTaskFollowUp(request.userMessage);
      const updated = await this.#tasks.followUp({ taskId: request.taskId, ...followUp });
      eventBus.publish(
        AgentEvent.task(withUserHistory(toA2ATask(updated), request.userMessage, request.task)),
      );
      eventBus.publish(AgentEvent.statusUpdate(toStatusUpdate(updated)));
      eventBus.finished();
      return;
    }
    const command = toSubmitTaskCommand(request.userMessage, request.taskId, request.contextId);
    const submitted = await this.#tasks.submit(command);
    const initial = withUserHistory(toA2ATask(submitted.task), request.userMessage);
    eventBus.publish(AgentEvent.task(initial));

    let previousPhase = submitted.task.phase;
    const deadline = Date.now() + this.#waitTimeoutMs;
    while (Date.now() <= deadline) {
      const current = await this.#tasks.get(submitted.task.taskId);
      if (current.phase !== previousPhase) {
        eventBus.publish(AgentEvent.statusUpdate(toStatusUpdate(current)));
        previousPhase = current.phase;
      }
      if (isA2AResponseBoundary(current)) {
        eventBus.finished();
        return;
      }
      await delay(this.#pollIntervalMs);
    }
    throw new Error('A2A_TASK_WAIT_TIMEOUT');
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    const canceled = await this.#tasks.cancel(taskId);
    eventBus.publish(AgentEvent.statusUpdate(toStatusUpdate(canceled)));
    eventBus.finished();
  }
}

function withUserHistory(task: Task, message: Message, previous?: Task): Task {
  const document = z.record(z.string(), z.unknown()).parse(Task.toJSON(task));
  return Task.fromJSON({
    ...document,
    history: [
      ...(previous?.history ?? []).map((item) => Message.toJSON(withoutMetadata(item))),
      Message.toJSON(withoutMetadata(message)),
    ],
  });
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

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
