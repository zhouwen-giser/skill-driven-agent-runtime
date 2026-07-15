import { describe, expect, it } from 'vitest';

import type { TaskExecutionAttempt } from '../../domain/src/index.js';
import { TaskAttemptDispatchService } from '../src/index.js';

describe('TaskAttemptDispatchService', () => {
  it('dispatches only durable queued attempts with the matching continuation mode', async () => {
    const attempts: readonly TaskExecutionAttempt[] = [
      {
        attemptId: 'attempt-initial',
        taskId: 'task-1',
        contextId: 'context-1',
        reason: 'initial',
        status: 'queued',
        createdAt: '2026-07-15T00:00:00.000Z',
      },
      {
        attemptId: 'attempt-input',
        taskId: 'task-2',
        contextId: 'context-2',
        reason: 'input_response',
        status: 'queued',
        inputRequestId: 'input-request-1',
        createdAt: '2026-07-15T00:00:01.000Z',
      },
    ];
    const jobs: unknown[] = [];
    const dispatcher = new TaskAttemptDispatchService({
      attempts: { listQueuedAttempts: () => Promise.resolve(attempts) },
      queue: {
        enqueue: (job) => {
          jobs.push(job);
          return Promise.resolve();
        },
      },
    });

    await expect(dispatcher.dispatchQueued(20)).resolves.toBe(2);
    expect(jobs).toEqual([
      {
        taskId: 'task-1',
        contextId: 'context-1',
        attemptId: 'attempt-initial',
        mode: 'initial',
      },
      {
        taskId: 'task-2',
        contextId: 'context-2',
        attemptId: 'attempt-input',
        mode: 'continue_after_input',
      },
    ]);
  });
});
