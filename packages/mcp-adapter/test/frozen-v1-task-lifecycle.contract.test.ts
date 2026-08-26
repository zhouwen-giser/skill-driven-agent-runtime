import { describe, expect, it } from 'vitest';

import {
  FrozenTaskLifecycleClient,
  FrozenTaskLifecycleError,
  FrozenV1McpClient,
  FrozenV1RuntimeLifecycleAdapter,
  parseCreatedTask,
  parseDetailedTask,
} from '../src/index.js';

const endpoint = 'https://provider.example.test/mcp';
const now = '2026-07-18T03:10:00.000Z';

describe('Frozen V1 Task lifecycle', () => {
  it('accepts a 300 KB detailed result under the existing one MiB Task wire bound', () => {
    const wire = task('completed', '5', {
      result: { ...toolResult(), structuredContent: { detail: 'x'.repeat(300_000) } },
    });
    expect(parseDetailedTask(wire, now)).toMatchObject({
      status: 'completed',
      result: { isError: false },
    });
    expect(() =>
      parseDetailedTask(
        {
          ...wire,
          result: { ...toolResult(), structuredContent: { detail: 'x'.repeat(1_048_576) } },
        },
        now,
      ),
    ).toThrow(expect.objectContaining({ code: 'FROZEN_TASK_RESPONSE_TOO_LARGE' }));
  });
  it('sends persisted Runtime input responses after client restart and rejects empty maps without a fake Ack', async () => {
    const methods: unknown[] = [];
    const client = new FrozenV1McpClient((_url, init) => {
      const body = parseRequestBody(init);
      methods.push(body['method']);
      return Promise.resolve(
        Response.json({ jsonrpc: '2.0', id: body['id'], result: { resultType: 'complete' } }),
      );
    });
    const adapter = new FrozenV1RuntimeLifecycleAdapter({ client, now: () => now });
    const input = { endpoint, headers: {}, remoteTaskId: 'task-1' };
    await expect(adapter.update({ ...input, inputResponses: {} })).rejects.toMatchObject({
      code: 'FROZEN_TASK_INPUT_RESPONSES_INVALID',
    });
    expect(methods).toEqual([]);
    await expect(
      adapter.update({
        ...input,
        inputResponses: { approval: { action: 'accept', content: { approved: true } } },
      }),
    ).resolves.toMatchObject({ acknowledged: true });
    expect(methods).toEqual(['tasks/update']);
  });
  it.each(['working', 'completed', 'input_required'] as const)(
    'does not retain an unaccepted %s observation in the Runtime transport client',
    async (wrongStatus) => {
      const wire = (instance: string, revision: string, status: typeof wrongStatus) =>
        task(status, revision, {
          ttlMs: null,
          _meta: {
            'io.sdar/taskExecution': { profileVersion: '1.0', runtimeRevision: revision },
            'io.sdar/providerIdentity': {
              profileVersion: '1.0',
              providerId: 'provider-1',
              providerInstanceId: instance,
            },
          },
          ...(status === 'completed' ? { result: toolResult() } : {}),
          ...(status === 'input_required' ? { inputRequests: inputRequests(instance) } : {}),
        });
      const responses = [
        wire('A', '5', 'working'),
        wire('B', '100', wrongStatus),
        wire('A', '6', 'working'),
      ];
      const client = new FrozenV1McpClient((_url, init) => {
        const body = parseRequestBody(init);
        return Promise.resolve(
          Response.json({ jsonrpc: '2.0', id: body['id'], result: requiredShift(responses) }),
        );
      });
      const adapter = new FrozenV1RuntimeLifecycleAdapter({ client, now: () => now });
      const input = {
        endpoint,
        headers: {},
        remoteTaskId: 'task-1',
        outputValidator: {
          checkSchema: () => ({ valid: true, errors: [] }),
          validate: () => ({ valid: true, errors: [] }),
        },
      };
      expect((await adapter.get(input)).runtimeRevision).toBe('5');
      // A downstream authoritative repository can reject this parsed Provider B observation.
      expect((await adapter.get(input)).providerIdentity?.providerInstanceId).toBe('B');
      await expect(adapter.get(input)).resolves.toMatchObject({
        runtimeRevision: '6',
        providerIdentity: { providerInstanceId: 'A' },
      });
    },
  );
  it('strictly propagates Provider-local identity through admission, reads and Task notifications', async () => {
    const identity = {
      profileVersion: '1.0',
      providerId: 'provider-1',
      providerInstanceId: 'instance-distinct-from-server',
    };
    const wire = task('working', '1', {
      _meta: {
        'io.sdar/taskExecution': { profileVersion: '1.0', runtimeRevision: '1' },
        'io.sdar/providerIdentity': identity,
        'unrelated/trace': { value: 'not-authority' },
      },
    });
    const lifecycle = createLifecycle((request) =>
      request['method'] === 'tools/call' ? { ...wire, resultType: 'task' } : wire,
    );
    const outcome = await lifecycle.callTool({ name: 'navigate', arguments: {} });
    expect(outcome).toMatchObject({
      kind: 'remote_task',
      created: { providerIdentity: identity },
      reconciled: { providerIdentity: identity },
    });
    expect(lifecycle.admitNotification(wire)).toMatchObject({
      accepted: false,
      task: { providerIdentity: identity },
    });
    const invalid = {
      ...wire,
      _meta: {
        'io.sdar/taskExecution': { profileVersion: '1.0', runtimeRevision: '1' },
        'io.sdar/providerIdentity': { ...identity, episodeId: 'forbidden-extra' },
      },
    };
    expect(() => parseDetailedTask(invalid, now)).toThrow(FrozenTaskLifecycleError);
    expect(() => parseCreatedTask({ ...invalid, resultType: 'task' }, now)).toThrow(
      FrozenTaskLifecycleError,
    );
  });
  it('enforces the discovered Tool output schema on the actual lifecycle result path', async () => {
    const lifecycle = createLifecycle(() => ({
      resultType: 'complete',
      content: [],
      structuredContent: { position: 'invalid' },
      isError: false,
    }));

    await expect(
      lifecycle.callTool({
        name: 'embodied.move',
        arguments: {},
        outputValidation: {
          outputSchema: { type: 'object' },
          validator: { validate: () => ({ valid: false, errors: ['/position must be object'] }) },
        },
      }),
    ).rejects.toMatchObject({ code: 'FROZEN_OUTPUT_SCHEMA_MISMATCH' });
  });

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

  it('maps the complete protocol-neutral Task call profile to exact tools/call metadata', async () => {
    const requests: Record<string, unknown>[] = [];
    const lifecycle = createLifecycle((body) => {
      requests.push(body);
      return toolResult();
    });

    await lifecycle.callTool({
      name: 'vehicle_navigate',
      arguments: { resourceId: 'vehicle:ugv1' },
      taskCallProfile: {
        profileVersion: '1.0',
        idempotencyKey: 'invocation-navigate-1',
        timing: {
          start: {
            mode: 'scheduled',
            scheduledAt: '2026-08-11T01:10:00.000Z',
            startToleranceMs: 2_500,
          },
          maxElapsedMs: 60_000,
        },
        reservationRef: 'reservation-navigate-1',
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.['params']).toEqual({
      name: 'vehicle_navigate',
      arguments: { resourceId: 'vehicle:ugv1' },
      _meta: {
        'io.sdar/taskExecution': {
          profileVersion: '1.0',
          idempotencyKey: 'invocation-navigate-1',
          timing: {
            start: {
              mode: 'scheduled',
              scheduledAt: '2026-08-11T01:10:00.000Z',
              startToleranceMs: 2_500,
            },
            maxElapsedMs: 60_000,
          },
          reservationRef: 'reservation-navigate-1',
        },
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'sdar', version: '1.2.1' },
        'io.modelcontextprotocol/clientCapabilities': {
          extensions: { 'io.modelcontextprotocol/tasks': {} },
        },
      },
    });
  });

  it('does not add Task execution metadata when a lifecycle call has no profile', async () => {
    const requests: Record<string, unknown>[] = [];
    const lifecycle = createLifecycle((body) => {
      requests.push(body);
      return toolResult();
    });

    await lifecycle.callTool({ name: 'vehicle_get_state', arguments: {} });

    const params = requests[0]?.['params'] as Record<string, unknown>;
    const meta = params['_meta'] as Record<string, unknown>;
    expect(meta).not.toHaveProperty('io.sdar/taskExecution');
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

  it('admits the Provider accepted substate on CreateTaskResult before reconciliation', async () => {
    const lifecycle = createLifecycle((body) =>
      body['method'] === 'tools/call'
        ? task('working', '1', {
            resultType: 'task',
            _meta: {
              'io.sdar/taskExecution': {
                profileVersion: '1.0',
                runtimeRevision: '1',
                substate: 'accepted',
              },
            },
          })
        : task('working', '2', {
            _meta: {
              'io.sdar/taskExecution': {
                profileVersion: '1.0',
                runtimeRevision: '2',
                substate: 'running',
              },
            },
          }),
    );

    await expect(
      lifecycle.callTool({ name: 'vehicle_navigate', arguments: {} }),
    ).resolves.toMatchObject({
      kind: 'remote_task',
      created: { observation: { runtimeRevision: '1', substate: 'accepted' } },
      reconciled: { observation: { runtimeRevision: '2', substate: 'running' } },
    });
  });

  it('upgrades a base-only CreateTaskResult to its first DetailedTask at the same revision', async () => {
    const lifecycle = createLifecycle((body) =>
      body['method'] === 'tools/call'
        ? task('input_required', '1', { resultType: 'task', inputRequests: undefined })
        : task('input_required', '1', { inputRequests: inputRequests() }),
    );

    await expect(
      lifecycle.callTool({ name: 'embodied.move', arguments: {} }),
    ).resolves.toMatchObject({
      kind: 'remote_task',
      created: { status: 'input_required', observation: { runtimeRevision: '1' } },
      reconciled: {
        status: 'input_required',
        observation: { runtimeRevision: '1' },
        inputRequests: { approval: expect.any(Object) },
      },
    });

    expect(() =>
      lifecycle.admitNotification(
        task('input_required', '1', {
          resultType: undefined,
          inputRequests: inputRequests('Changed at the same revision'),
        }),
      ),
    ).toThrow('same Task runtimeRevision represented different Task content');
  });

  it('rejects changed Task base content during a same-revision projection upgrade', async () => {
    const lifecycle = createLifecycle((body) =>
      body['method'] === 'tools/call'
        ? task('input_required', '1', { resultType: 'task', inputRequests: undefined })
        : task('input_required', '1', {
            statusMessage: 'Changed without a Runtime Revision',
            inputRequests: inputRequests(),
          }),
    );

    await expect(
      lifecycle.callTool({ name: 'embodied.move', arguments: {} }),
    ).rejects.toMatchObject({ code: 'FROZEN_TASK_REVISION_CONTENT_MISMATCH' });
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
