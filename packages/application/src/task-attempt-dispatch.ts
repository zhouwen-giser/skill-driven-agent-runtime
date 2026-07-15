import type { ContextTaskQueue, TaskInputRepository } from './ports.js';

export class TaskAttemptDispatchService {
  readonly #attempts: Pick<TaskInputRepository, 'listQueuedAttempts'>;
  readonly #queue: ContextTaskQueue;

  constructor(
    dependencies: Readonly<{
      attempts: Pick<TaskInputRepository, 'listQueuedAttempts'>;
      queue: ContextTaskQueue;
    }>,
  ) {
    this.#attempts = dependencies.attempts;
    this.#queue = dependencies.queue;
  }

  async dispatchQueued(limit = 100): Promise<number> {
    const attempts = await this.#attempts.listQueuedAttempts(limit);
    for (const attempt of attempts)
      await this.#queue.enqueue({
        taskId: attempt.taskId,
        contextId: attempt.contextId,
        attemptId: attempt.attemptId,
        mode: attempt.reason === 'initial' ? 'initial' : 'continue_after_input',
      });
    return attempts.length;
  }
}
