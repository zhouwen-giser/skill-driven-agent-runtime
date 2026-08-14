import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpRuntimeTaskControlClient } from '../src/http-runtime-task-control-client.js';
import type { RuntimeTaskControlHttpError } from '../src/http-runtime-task-control-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpRuntimeTaskControlClient', () => {
  it.each([
    ['pause', 'pause'],
    ['resume', 'resume'],
    ['cancel', 'cancel'],
    ['goal_patch', 'goal-patches'],
  ] as const)('maps %s to the frozen Runtime command route', async (action, suffix) => {
    const fetch = vi.fn((...args: Parameters<typeof globalThis.fetch>) => {
      void args;
      return Promise.resolve(
        new Response(JSON.stringify(operation(`task.${action}`)), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);
    const client = new HttpRuntimeTaskControlClient({
      baseUrl: 'http://127.0.0.1:29998/',
      serviceToken: 'runtime-service-token',
    });

    await client.execute(action, 'task/a', {
      reason: 'Governed command.',
      idempotencyKey: 'idempotency-key',
      correlationId: 'correlation-id',
      payload: { instruction: 'bounded' },
      expectedRevision: 4,
    });

    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:29998/internal/v1/tasks/task%2Fa/${suffix}`,
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        headers: expect.objectContaining({
          authorization: 'Bearer runtime-service-token',
          'idempotency-key': 'idempotency-key',
          'x-correlation-id': 'correlation-id',
        }),
      }),
    );
    const options = fetch.mock.calls[0]?.[1];
    if (typeof options?.body !== 'string') throw new Error('TEST_REQUEST_BODY_MISSING');
    expect(JSON.parse(options.body)).toEqual({
      reason: 'Governed command.',
      payload: { instruction: 'bounded' },
      expectedRevision: 4,
    });
  });

  it('preserves stable Runtime Problem Details code and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ code: 'TASK_TERMINAL_FOLLOW_UP_FORBIDDEN' }), {
            status: 409,
            headers: { 'content-type': 'application/problem+json' },
          }),
        ),
      ),
    );
    const client = new HttpRuntimeTaskControlClient({
      baseUrl: 'http://127.0.0.1:29998',
      serviceToken: 'runtime-service-token',
    });

    await expect(
      client.execute('pause', 'terminal-task', {
        reason: 'Pause.',
        idempotencyKey: 'pause-terminal',
        correlationId: 'correlation',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeTaskControlHttpError>>({
        code: 'TASK_TERMINAL_FOLLOW_UP_FORBIDDEN',
        status: 409,
      }),
    );
  });
});

function operation(operationType: string) {
  return {
    operationId: `runtime-${operationType}`,
    operationType,
    target: { type: 'task', id: 'task-a' },
    status: 'succeeded',
    actorId: 'sdar-runtime',
    reason: 'Governed command.',
    idempotencyKeyHash: 'a'.repeat(64),
    inputHash: 'b'.repeat(64),
    result: { phase: 'applied' },
    createdAt: '2026-08-13T02:00:00.000Z',
    startedAt: '2026-08-13T02:00:00.001Z',
    completedAt: '2026-08-13T02:00:00.002Z',
  };
}
