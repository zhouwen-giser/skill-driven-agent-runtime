import { describe, expect, it } from 'vitest';

import type { AgentTask, TaskWaitPolicy } from '../../domain/src/index.js';
import { TaskWaitTimeoutService } from '../src/index.js';

describe('TaskWaitTimeoutService', () => {
  it('uses one managed timeout for confirmation and input waits', async () => {
    let policy: TaskWaitPolicy = {
      timeoutSeconds: 300,
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    let cutoff = '';
    const expired: AgentTask[] = [];
    const service = new TaskWaitTimeoutService({
      repository: {
        get: () => Promise.resolve(policy),
        update: (next) => {
          policy = next;
          return Promise.resolve();
        },
        expireWaiting: (value) => {
          cutoff = value;
          return Promise.resolve(expired);
        },
      },
      clock: { now: () => '2026-07-12T00:10:00.000Z' },
    });

    await expect(service.updatePolicy(60)).resolves.toEqual({
      timeoutSeconds: 60,
      updatedAt: '2026-07-12T00:10:00.000Z',
    });
    await expect(service.sweep()).resolves.toBe(expired);
    expect(cutoff).toBe('2026-07-12T00:09:00.000Z');
    await expect(service.updatePolicy(0)).rejects.toMatchObject({
      code: 'TASK_WAIT_TIMEOUT_INVALID',
    });
  });
});
