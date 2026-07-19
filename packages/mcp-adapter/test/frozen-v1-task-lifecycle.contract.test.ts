import { describe, expect, it } from 'vitest';

import {
  FrozenTaskLifecycleClient,
  FrozenTaskLifecycleError,
  FrozenV1McpClient,
  parseCreatedTask,
  parseDetailedTask,
} from '../src/index.js';

const endpoint = 'https://provider.example.test/mcp';
const now = '2026-07-18T03:10:00.000Z';

describe('Frozen V1 Task lifecycle', () => {
  it('parses a synchronous business-error result without creating a Task', async () => {
    const methods: string[] = [];
    const lifecycle = createLifecycle((body) => {
      methods.push(String(body['method']));
      return {
        resultType: 'complete',
        content: [{ type: 'text', text: 'rejected by business policy' }],
        structuredContent: { code: 'FORBIDDEN_AREA' },
        isError: true,
      };
    });

    await expect(
      lifecycle.callTool({ name: 'embodied.move', arguments: {} }),
    ).resolves.toMatchObject({ kind: 'immediate', result: { isError: true } });
    expect(methods).toEqual(['tools/call']);
  });

  it('accepts a flat CreateTaskResult then immediately reconciles exactly once', async () => {
    const methods: string[] = [];
    const lifecycle = createLifecycle((body) => {
      const method = String(body['method']);
      methods.push(method);
      return method === 'tools/call'
        ? task('working', '1', { resultType: 'task' })
        : task('working', '2');
    });

    await expect(
      lifecycle.callTool({ name: 'embodied.move', arguments: {} }),
    ).resolves.toMatchObject({
      kind: 'remote_task',
      created: { taskId: 'task-1', resultType: 'task', observation: { runtimeRevision: '1' } },
      reconciled: { resultType: 'complete', observation: { runtimeRevision: '2' } },
    });
    expect(methods).toEqual(['tools/call', 'tasks/get']);
  });

  it('rejects Legacy nested Tasks and missing result discriminators', () => {
    expect(() => parseCreatedTask({ resultType: 'task', task: task('working', '1') }, now)).toThrow(
      FrozenTaskLifecycleError,
    );
    expect(() =>
      parseDetailedTask({ ...task('working', '1'), resultType: undefined }, now),
    ).toThrow('invalid frozen DetailedTask');
  });

  it('derives TTL from createdAt, supports null and dynamic renewal, and rejects expiry', () => {
    expect(parseDetailedTask(task('working', '1', { ttlMs: 900_000 }), now)).toMatchObject({
      expiresAt: '2026-07-18T03:15:00.000Z',
    });
    expect(parseDetailedTask(task('working', '1', { ttlMs: null }), now)).not.toHaveProperty(
      'expiresAt',
    );
    expect(
      parseDetailedTask(task('working', '2', { ttlMs: 1_800_000, pollIntervalMs: 2500 }), now),
    ).toMatchObject({ expiresAt: '2026-07-18T03:30:00.000Z', pollIntervalMs: 2500 });
    expect(() =>
      parseDetailedTask(task('completed', '3', { ttlMs: 1, result: toolResult() }), now),
    ).toThrow('TTL expired');
  });

  it('enforces numeric runtimeRevision order and identical content for duplicate revisions', async () => {
    const results = [task('working', '10'), task('working', '9')];
    const lifecycle = createLifecycle(() => requiredShift(results));
    await lifecycle.getTask('task-1');
    await expect(lifecycle.getTask('task-1')).rejects.toMatchObject({
      code: 'FROZEN_TASK_REVISION_REGRESSION',
    });

    const mismatch = createLifecycle(() =>
      task('working', '4', { statusMessage: mismatchCalls++ === 0 ? 'one' : 'two' }),
    );
    let mismatchCalls = 0;
    await mismatch.getTask('task-1');
    await expect(mismatch.getTask('task-1')).rejects.toMatchObject({
      code: 'FROZEN_TASK_REVISION_CONTENT_MISMATCH',
    });
  });

  it('rejects terminal rollback after restoring persisted lifecycle state', async () => {
    const terminal = createLifecycle(() => task('completed', '7', { result: toolResult() }));
    await terminal.getTask('task-1');
    const restarted = createLifecycle(() => task('working', '8'), terminal.exportState());
    await expect(restarted.getTask('task-1')).rejects.toMatchObject({
      code: 'FROZEN_TASK_TERMINAL_ROLLBACK',
    });
  });

  it('submits partial MRTR maps, ignores unknown keys, and treats Ack as eventually consistent', async () => {
    const requests: Record<string, unknown>[] = [];
    let revision = 1;
    const lifecycle = createLifecycle((body) => {
      requests.push(body);
      const method = String(body['method']);
      if (method === 'tasks/update') return { resultType: 'complete' };
      return task('input_required', String(revision++), { inputRequests: inputRequests() });
    });
    await lifecycle.getTask('task-1');
    await expect(
      lifecycle.updateTask({
        taskId: 'task-1',
        submissionKey: 'a2a-message-1',
        inputResponses: {
          approval: { action: 'accept', content: { approved: true } },
          unknown: { action: 'decline' },
        },
      }),
    ).resolves.toEqual({
      sent: true,
      acceptedKeys: ['approval'],
      ignoredKeys: ['unknown'],
      ack: { resultType: 'complete', meaning: 'input_update_received' },
    });
    await expect(lifecycle.getTask('task-1')).resolves.toMatchObject({ status: 'input_required' });
    expect(requests.filter((request) => request['method'] === 'tasks/update')).toHaveLength(1);
  });

  it('does not repeat an A2A input update after restart', async () => {
    const requests: Record<string, unknown>[] = [];
    const lifecycle = createLifecycle((body) => {
      requests.push(body);
      return body['method'] === 'tasks/update'
        ? { resultType: 'complete' }
        : task('input_required', '1', { inputRequests: inputRequests() });
    });
    await lifecycle.getTask('task-1');
    await lifecycle.updateTask({
      taskId: 'task-1',
      submissionKey: 'a2a-message-1',
      inputResponses: { approval: { action: 'accept', content: { approved: true } } },
    });
    const restarted = createLifecycle((body) => {
      requests.push(body);
      return { resultType: 'complete' };
    }, lifecycle.exportState());
    await expect(
      restarted.updateTask({
        taskId: 'task-1',
        submissionKey: 'a2a-message-1',
        inputResponses: { approval: { action: 'accept', content: { approved: true } } },
      }),
    ).resolves.toMatchObject({ sent: false });
    expect(requests.filter((request) => request['method'] === 'tasks/update')).toHaveLength(1);
  });

  it('rejects input request key reuse with different request content', async () => {
    let call = 0;
    const lifecycle = createLifecycle(() =>
      task('input_required', String(++call), {
        inputRequests: inputRequests(call === 1 ? 'Approve?' : 'Different request'),
      }),
    );
    await lifecycle.getTask('task-1');
    await expect(lifecycle.getTask('task-1')).rejects.toMatchObject({
      code: 'FROZEN_TASK_INPUT_KEY_REUSED',
    });
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'treats cancel Ack as intent and admits a later %s outcome',
    async (status) => {
      const methods: string[] = [];
      const lifecycle = createLifecycle((body) => {
        methods.push(String(body['method']));
        return body['method'] === 'tasks/cancel'
          ? { resultType: 'complete' }
          : task(
              status,
              '2',
              status === 'completed'
                ? { result: toolResult() }
                : status === 'failed'
                  ? { error: { code: -32603, message: 'Provider failed.' } }
                  : {},
            );
      });
      await expect(lifecycle.cancelTask('task-1')).resolves.toEqual({
        resultType: 'complete',
        meaning: 'cancellation_intent_received',
      });
      await expect(lifecycle.getTask('task-1')).resolves.toMatchObject({ status });
      expect(methods).toEqual(['tasks/cancel', 'tasks/get']);
    },
  );
});

function createLifecycle(
  responder: (body: Record<string, unknown>) => unknown,
  restoredState?: ReturnType<FrozenTaskLifecycleClient['exportState']>,
): FrozenTaskLifecycleClient {
  const client = new FrozenV1McpClient((_url, init) => {
    const body = parseRequestBody(init);
    return Promise.resolve(
      Response.json({ jsonrpc: '2.0', id: body['id'], result: responder(body) }),
    );
  });
  return new FrozenTaskLifecycleClient({
    client,
    endpoint,
    headers: {},
    now: () => now,
    ...(restoredState === undefined ? {} : { restoredState }),
  });
}

function task(
  status: 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled',
  runtimeRevision: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    resultType: 'complete',
    taskId: 'task-1',
    status,
    createdAt: '2026-07-18T03:00:00.000Z',
    lastUpdatedAt: '2026-07-18T03:05:00.000Z',
    ttlMs: 3_600_000,
    pollIntervalMs: 1000,
    _meta: {
      'io.sdar/taskExecution': { profileVersion: '1.0', runtimeRevision },
    },
    ...overrides,
  };
}

function inputRequests(message = 'Approve?'): Record<string, unknown> {
  return {
    approval: {
      method: 'elicitation/create',
      params: {
        mode: 'form',
        message,
        requestedSchema: { type: 'object', properties: { approved: { type: 'boolean' } } },
      },
    },
    destination: {
      method: 'elicitation/create',
      params: { mode: 'form', message: 'Destination?', requestedSchema: { type: 'object' } },
    },
  };
}

function toolResult(): Record<string, unknown> {
  return { resultType: 'complete', content: [], structuredContent: {}, isError: false };
}

function parseRequestBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new TypeError('Expected JSON request body');
  return JSON.parse(init.body) as Record<string, unknown>;
}

function requiredShift(values: Record<string, unknown>[]): Record<string, unknown> {
  const value = values.shift();
  if (value === undefined) throw new Error('Unexpected request');
  return value;
}
