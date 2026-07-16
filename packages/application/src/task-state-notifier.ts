import type { AgentTask } from '../../domain/src/index.js';

export interface TaskStateNotifier {
  publish(task: AgentTask): void;
  waitForChange(
    taskId: string,
    knownUpdatedAt: string,
    timeoutMs: number,
  ): Promise<AgentTask | undefined>;
  close(): void;
}

interface TaskStateWaiter {
  readonly knownUpdatedAt: string;
  readonly resolve: (task: AgentTask | undefined) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class InMemoryTaskStateNotifier implements TaskStateNotifier {
  readonly #latestByTask = new Map<string, AgentTask>();
  readonly #waitersByTask = new Map<string, Set<TaskStateWaiter>>();
  readonly #maxRememberedTasks: number;
  #closed = false;

  constructor(maxRememberedTasks = 1_024) {
    if (!Number.isInteger(maxRememberedTasks) || maxRememberedTasks < 1)
      throw new TaskStateNotifierError(
        'TASK_STATE_NOTIFIER_CAPACITY_INVALID',
        'Task state notification capacity must be a positive integer.',
      );
    this.#maxRememberedTasks = maxRememberedTasks;
  }

  publish(task: AgentTask): void {
    if (this.#closed) return;
    this.#remember(task);
    const waiters = this.#waitersByTask.get(task.taskId);
    if (waiters === undefined) return;
    for (const waiter of [...waiters]) this.#finish(task.taskId, waiter, task);
  }

  waitForChange(
    taskId: string,
    knownUpdatedAt: string,
    timeoutMs: number,
  ): Promise<AgentTask | undefined> {
    const normalizedTaskId = taskId.trim();
    if (
      normalizedTaskId === '' ||
      knownUpdatedAt.trim() === '' ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs < 0
    )
      throw new TaskStateNotifierError(
        'TASK_STATE_WAIT_INVALID',
        'Task state wait requires a Task ID, known timestamp, and non-negative finite timeout.',
      );
    if (this.#closed || timeoutMs === 0) return Promise.resolve(undefined);
    const latest = this.#latestByTask.get(normalizedTaskId);
    if (latest !== undefined && isTimestampAfter(latest.updatedAt, knownUpdatedAt))
      return Promise.resolve(latest);

    return new Promise<AgentTask | undefined>((resolve) => {
      const waiter: TaskStateWaiter = { knownUpdatedAt, resolve };
      const waiters = this.#waitersByTask.get(normalizedTaskId) ?? new Set<TaskStateWaiter>();
      waiters.add(waiter);
      this.#waitersByTask.set(normalizedTaskId, waiters);
      waiter.timer = setTimeout(() => {
        this.#finish(normalizedTaskId, waiter, undefined);
      }, timeoutMs);
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const [taskId, waiters] of this.#waitersByTask)
      for (const waiter of [...waiters]) this.#finish(taskId, waiter, undefined);
    this.#latestByTask.clear();
  }

  #remember(task: AgentTask): void {
    this.#latestByTask.delete(task.taskId);
    this.#latestByTask.set(task.taskId, task);
    while (this.#latestByTask.size > this.#maxRememberedTasks) {
      const oldestTaskId = this.#latestByTask.keys().next().value;
      if (oldestTaskId === undefined) break;
      this.#latestByTask.delete(oldestTaskId);
    }
  }

  #finish(taskId: string, waiter: TaskStateWaiter, task: AgentTask | undefined): void {
    const waiters = this.#waitersByTask.get(taskId);
    if (waiters?.delete(waiter) !== true) return;
    if (waiter.timer !== undefined) clearTimeout(waiter.timer);
    if (waiters.size === 0) this.#waitersByTask.delete(taskId);
    waiter.resolve(task);
  }
}

function isTimestampAfter(candidate: string, known: string): boolean {
  return Date.parse(candidate) > Date.parse(known);
}

export type TaskStateNotifierErrorCode =
  'TASK_STATE_NOTIFIER_CAPACITY_INVALID' | 'TASK_STATE_WAIT_INVALID';

export class TaskStateNotifierError extends Error {
  readonly code: TaskStateNotifierErrorCode;

  constructor(code: TaskStateNotifierErrorCode, message: string) {
    super(message);
    this.name = 'TaskStateNotifierError';
    this.code = code;
  }
}
