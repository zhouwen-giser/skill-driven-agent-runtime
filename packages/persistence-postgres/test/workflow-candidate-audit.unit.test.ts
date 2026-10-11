import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import type { WorkflowPlanAttempt } from '../../domain/src/index.js';
import { PostgresWorkflowPlanRepository } from '../src/index.js';

it('defers candidate auditing under GOWM device scope without querying or creating a formal root', async () => {
  const pool = new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });
  const query = vi.spyOn(pool, 'query');
  const connect = vi.spyOn(pool, 'connect');
  try {
    const repository = new PostgresWorkflowPlanRepository(pool, undefined, {
      allowedDeviceIds: ['device-a'],
      sdarServiceKey: 'sdar-a',
      includeNonDevice: false,
    });
    const attempt: WorkflowPlanAttempt = {
      planId: 'candidate-plan',
      executionTaskId: 'device-task',
      goalContract: {
        goalId: 'goal-a',
        version: 1,
        title: 'Inspect',
        description: 'Inspect the device.',
        constraints: [],
        successCriteria: ['Observed'],
      },
      attempt: 1,
      candidate: {},
      validationErrors: [],
      valid: false,
      createdAt: '2026-10-11T00:00:00.000Z',
    };
    await expect(repository.saveCandidateAttempt(attempt)).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  } finally {
    await pool.end();
    query.mockRestore();
    connect.mockRestore();
  }
});
