import { describe, expect, it } from 'vitest';

import {
  FrozenRemoteTaskSubscriptionManager,
  FrozenTaskLifecycleClient,
  FrozenV1McpClient,
} from '../src/index.js';

const endpoint = 'https://provider.example.test/mcp';

describe('Frozen V1 Task subscriptions', () => {
  it('requires Ack first, hides unaccepted Tasks, and deduplicates full Task Notifications', async () => {
    let request: Record<string, unknown> | undefined;
    const client = new FrozenV1McpClient((_url, init) => {
      request = parseBody(init);
      const id = request['id'];
      return Promise.resolve(
        sse([
          ack(id, ['task-1']),
          notification(id, detailedTask('working', '1')),
          notification(id, detailedTask('working', '1')),
          notification(id, detailedTask('completed', '2', { result: toolResult() })),
        ]),
      );
    });
    const observations: string[] = [];
    const result = await manager(client).run({
      taskIds: ['hidden-task', 'task-1', 'task-1'],
      reconnecting: false,
      onObservation(task, source) {
        observations.push(`${source}:${task.status}:${task.observation.runtimeRevision}`);
        return Promise.resolve();
      },
    });
    expect(result).toMatchObject({ acceptedTaskIds: ['task-1'], notifications: 2, reconciled: 0 });
    expect(observations).toEqual(['notification:working:1', 'notification:completed:2']);
    expect(request?.['params']).toMatchObject({
      notifications: { taskIds: ['hidden-task', 'task-1'] },
    });
  });

  it('uses POST SSE routing headers without Last-Event-ID', async () => {
    let init: RequestInit | undefined;
    const client = new FrozenV1McpClient((_url, requestInit) => {
      init = requestInit;
      const id = parseBody(requestInit)['id'];
      return Promise.resolve(sse([ack(id, [])]));
    });
    await manager(client).run({
      taskIds: [],
      reconnecting: false,
      onObservation: () => Promise.resolve(),
    });
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe('POST');
    expect(headers.get('mcp-method')).toBe('subscriptions/listen');
    expect(headers.has('mcp-name')).toBe(false);
    expect(headers.has('last-event-id')).toBe(false);
  });

  it('reconciles every accepted Task after reconnect', async () => {
    let call = 0;
    const client = new FrozenV1McpClient((_url, init) => {
      const body = parseBody(init);
      call += 1;
      if (call === 1) return Promise.resolve(sse([ack(body['id'], ['task-1'])]));
      return Promise.resolve(
        json(body['id'], { resultType: 'complete', ...detailedTask('working', '5') }),
      );
    });
    const sources: string[] = [];
    await expect(
      manager(client).run({
        taskIds: ['task-1'],
        reconnecting: true,
        onObservation(_task, source) {
          sources.push(source);
          return Promise.resolve();
        },
      }),
    ).resolves.toMatchObject({ reconciled: 1 });
    expect(sources).toEqual(['reconciliation']);
  });

  it('fails closed when Ack is missing or not first', async () => {
    const client = streamClient((id) => [notification(id, detailedTask('working', '1'))]);
    await expect(
      manager(client).run({
        taskIds: ['task-1'],
        reconnecting: false,
        onObservation: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ code: 'FROZEN_TASK_SUBSCRIPTION_ACK_MISSING' });
  });

  it('rejects notifications outside the acknowledged authorized subset', async () => {
    const client = streamClient((id) => [
      ack(id, ['task-1']),
      notification(id, detailedTask('working', '1', { taskId: 'task-2' })),
    ]);
    await expect(
      manager(client).run({
        taskIds: ['task-1', 'task-2'],
        reconnecting: false,
        onObservation: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ code: 'FROZEN_TASK_NOTIFICATION_UNAUTHORIZED' });
  });

  it('rejects mismatched Ack IDs and unstable Ack ordering', async () => {
    for (const messages of [[ack('wrong', ['task-1'])], [ack(1, ['task-2', 'task-1'])]]) {
      const client = streamClient(() => messages);
      await expect(
        manager(client).run({
          taskIds: ['task-1', 'task-2'],
          reconnecting: false,
          onObservation: () => Promise.resolve(),
        }),
      ).rejects.toMatchObject({ code: 'FROZEN_TASK_SUBSCRIPTION_ACK_INVALID' });
    }
  });

  it('rejects more than 256 Task interests before transport', async () => {
    let calls = 0;
    const client = new FrozenV1McpClient(() => {
      calls += 1;
      return Promise.reject(new Error('not expected'));
    });
    await expect(
      manager(client).run({
        taskIds: Array.from({ length: 257 }, (_, index) => `task-${String(index)}`),
        reconnecting: false,
        onObservation: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ code: 'FROZEN_TASK_SUBSCRIPTION_REQUEST_INVALID' });
    expect(calls).toBe(0);
  });

  it('fails closed when one incomplete SSE event overflows the bounded receive buffer', async () => {
    const client = new FrozenV1McpClient(() =>
      Promise.resolve(
        new Response(`data: ${'x'.repeat(1_048_577)}`, {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );
    const stream = await client.listenToTaskNotifications({
      endpoint,
      headers: {},
      taskIds: ['task-1'],
    });
    await expect(async () => {
      for await (const message of stream.messages) {
        // The oversized incomplete event must fail before yielding.
        void message;
      }
    }).rejects.toMatchObject({ code: 'FROZEN_MCP_SSE_BUFFER_OVERFLOW' });
  });
});

function manager(client: FrozenV1McpClient): FrozenRemoteTaskSubscriptionManager {
  const lifecycle = new FrozenTaskLifecycleClient({
    client,
    endpoint,
    headers: {},
    now: () => '2026-07-18T03:10:00.000Z',
  });
  return new FrozenRemoteTaskSubscriptionManager({
    transport: client,
    lifecycle,
    endpoint,
    headers: {},
  });
}

function streamClient(messages: (id: unknown) => readonly unknown[]): FrozenV1McpClient {
  return new FrozenV1McpClient((_url, init) => {
    const id = parseBody(init)['id'];
    return Promise.resolve(sse(messages(id)));
  });
}

function ack(id: unknown, taskIds: readonly string[]) {
  return {
    jsonrpc: '2.0',
    method: 'notifications/subscriptions/acknowledged',
    params: {
      _meta: { 'io.modelcontextprotocol/subscriptionId': id },
      notifications: { taskIds },
    },
  };
}

function notification(id: unknown, params: Record<string, unknown>) {
  const metadata = params['_meta'] as Record<string, unknown>;
  return {
    jsonrpc: '2.0',
    method: 'notifications/tasks',
    params: {
      ...params,
      _meta: { ...metadata, 'io.modelcontextprotocol/subscriptionId': id },
    },
  };
}

function detailedTask(
  status: string,
  runtimeRevision: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    taskId: 'task-1',
    status,
    createdAt: '2026-07-18T03:00:00.000Z',
    lastUpdatedAt: '2026-07-18T03:05:00.000Z',
    ttlMs: 3_600_000,
    _meta: { 'io.sdar/taskExecution': { profileVersion: '1.0', runtimeRevision } },
    ...overrides,
  };
}

function toolResult() {
  return { resultType: 'complete', content: [], structuredContent: {}, isError: false };
}

function sse(messages: readonly unknown[]): Response {
  return new Response(messages.map((message) => `data: ${JSON.stringify(message)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function json(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result });
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new TypeError('Expected JSON request body');
  return JSON.parse(init.body) as Record<string, unknown>;
}
