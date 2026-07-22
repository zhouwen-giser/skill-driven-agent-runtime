import { afterEach, describe, expect, it } from 'vitest';

import type { McpServer } from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  FrozenRemoteTaskSubscriptionManager,
  FrozenTaskAvailabilityClient,
  FrozenTaskLifecycleClient,
  FrozenV1McpClient,
  FrozenV1RegistryAdapter,
  startFrozenMcpTasksMockProvider,
  type FrozenMcpTasksMockProviderHandle,
} from '../src/index.js';

const now = '2026-07-19T04:00:10.000Z';

describe('Frozen MCP local component conformance', () => {
  let frozen: FrozenMcpTasksMockProviderHandle | undefined;

  afterEach(async () => {
    await frozen?.close();
    frozen = undefined;
  });

  it('certifies discovery, Tool profile/output schema, Availability, Task, revisions and Evidence A', async () => {
    frozen = await startFrozenMcpTasksMockProvider();
    const client = new FrozenV1McpClient();
    const server = provider(frozen.endpoint);
    const discovery = await new FrozenV1RegistryAdapter(client).discover({
      server,
      headers: {},
      snapshotId: 'snapshot-1',
      baselineSha256: 'a'.repeat(64),
      discoveredAt: now,
    });
    expect(discovery).toMatchObject({
      snapshot: { taskNotifications: true },
      tools: [
        {
          toolName: 'embodied.move',
          outputSchema: expect.any(Object),
          taskExecutionProfile: { taskBehavior: 'server_directed' },
        },
      ],
    });

    const availability = new FrozenTaskAvailabilityClient({
      client,
      endpoint: frozen.endpoint.href,
      headers: {},
    });
    await expect(availability.check([availabilityCheck])).resolves.toMatchObject([
      { availability: 'available', operationName: 'embodied.move' },
    ]);

    const lifecycle = lifecycleClient(client, frozen.endpoint);
    const outcome = await lifecycle.callTool({
      name: 'embodied.move',
      arguments: { resourceId: 'UGV-001', target: { x: 1, y: 2 } },
      outputValidation: {
        outputSchema: discovery.tools[0]?.outputSchema,
        validator: new AjvJsonSchemaValidator(),
      },
    });
    expect(outcome).toMatchObject({
      kind: 'remote_task',
      created: { observation: { runtimeRevision: '1' } },
      reconciled: {
        status: 'completed',
        observation: { runtimeRevision: '2', providerRevision: 'provider-2' },
        result: { evidence: [{ evidenceType: 'position.observation' }] },
      },
    });
    expect(frozen.toolCallCount).toBe(1);
  });

  it('discovers the complete Frozen area-patrol catalog', async () => {
    frozen = await startFrozenMcpTasksMockProvider({
      moveTo: { outcome: 'remote_success' },
      areaPatrol: { outcome: 'remote_success' },
    });
    const client = new FrozenV1McpClient();
    const discovery = await new FrozenV1RegistryAdapter(client).discover({
      server: provider(frozen.endpoint),
      headers: {},
      snapshotId: 'snapshot-area',
      baselineSha256: 'b'.repeat(64),
      discoveredAt: now,
    });
    expect(discovery.tools.map((tool) => tool.toolName)).toEqual([
      'embodied.move',
      'embodied.area_patrol',
      'embodied.inspect_area',
    ]);
  });

  it('handles MRTR input, cooperative cancel and Notification reconciliation without duplicate Tool calls', async () => {
    frozen = await startFrozenMcpTasksMockProvider({ outcome: 'input_required' });
    const client = new FrozenV1McpClient();
    const lifecycle = lifecycleClient(client, frozen.endpoint);
    const outcome = await lifecycle.callTool({ name: 'embodied.move', arguments: {} });
    expect(outcome).toMatchObject({
      kind: 'remote_task',
      reconciled: { status: 'input_required' },
    });
    await expect(
      lifecycle.updateTask({
        taskId: 'frozen-task-1',
        submissionKey: 'message-1',
        inputResponses: { approval: { action: 'accept', content: { approved: true } } },
      }),
    ).resolves.toMatchObject({ sent: true, acceptedKeys: ['approval'] });
    await expect(lifecycle.cancelTask('frozen-task-1')).resolves.toMatchObject({
      meaning: 'cancellation_intent_received',
    });
    await expect(lifecycle.getTask('frozen-task-1')).resolves.toMatchObject({
      status: 'cancelled',
    });

    const observed: string[] = [];
    const subscriptions = new FrozenRemoteTaskSubscriptionManager({
      transport: client,
      lifecycle,
      endpoint: frozen.endpoint.href,
      headers: {},
    });
    await expect(
      subscriptions.run({
        taskIds: ['frozen-task-1'],
        reconnecting: false,
        onObservation: (task, source) => {
          observed.push(`${source}:${task.observation.runtimeRevision}`);
          return Promise.resolve();
        },
      }),
    ).resolves.toMatchObject({ acceptedTaskIds: ['frozen-task-1'], notifications: 1 });
    expect(frozen.toolCallCount).toBe(1);
    expect(observed.some((value) => value.startsWith('notification:'))).toBe(true);
  });

  it('returns a policy-complete restricted Availability result', async () => {
    frozen = await startFrozenMcpTasksMockProvider({
      availability: 'restricted',
      createdAt: '2026-07-19T04:00:00.000Z',
    });
    await expect(
      new FrozenTaskAvailabilityClient({
        client: new FrozenV1McpClient(),
        endpoint: frozen.endpoint.href,
        headers: {},
      }).check([availabilityCheck]),
    ).resolves.toMatchObject([
      {
        availability: 'restricted',
        reasonCode: 'OPERATOR_APPROVAL_REQUIRED',
        earliestStartTime: '2026-07-19T04:05:00.000Z',
      },
    ]);
  });

  it('re-authorizes subscription interests at Notification send time', async () => {
    frozen = await startFrozenMcpTasksMockProvider({
      moveTo: { outcome: 'remote_notification_success' },
    });
    const client = new FrozenV1McpClient();
    const lifecycle = lifecycleClient(client, frozen.endpoint);
    await lifecycle.callTool({ name: 'embodied.move', arguments: { resourceId: 'first' } });
    const subscriptions = new FrozenRemoteTaskSubscriptionManager({
      transport: client,
      lifecycle,
      endpoint: frozen.endpoint.href,
      headers: {},
    });
    const running = subscriptions.run({
      taskIds: ['frozen-task-1'],
      reconnecting: false,
      onObservation: () => Promise.resolve(),
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
    await lifecycle.callTool({ name: 'embodied.move', arguments: { resourceId: 'second' } });
    await expect(running).resolves.toMatchObject({
      acceptedTaskIds: ['frozen-task-1'],
      notifications: 0,
    });
    expect(frozen.toolCallCount).toBe(2);
  });

  it('keeps restart acceptance poll-driven after an Ack-only subscription', async () => {
    const providerStartedAfter = Date.now();
    frozen = await startFrozenMcpTasksMockProvider({
      moveTo: { outcome: 'remote_restart_success' },
    });
    const client = new FrozenV1McpClient();
    const lifecycle = lifecycleClient(client, frozen.endpoint);
    const outcome = await lifecycle.callTool({
      name: 'embodied.move',
      arguments: { resourceId: 'restart' },
    });
    expect(outcome).toMatchObject({
      kind: 'remote_task',
      reconciled: { status: 'working' },
    });
    if (outcome.kind !== 'remote_task') throw new Error('FROZEN_RESTART_TASK_EXPECTED');
    expect(Date.parse(outcome.created.createdAt)).toBeGreaterThanOrEqual(providerStartedAfter);
    const subscriptions = new FrozenRemoteTaskSubscriptionManager({
      transport: client,
      lifecycle,
      endpoint: frozen.endpoint.href,
      headers: {},
    });
    await expect(
      subscriptions.run({
        taskIds: ['frozen-task-1'],
        reconnecting: false,
        onObservation: () => Promise.resolve(),
      }),
    ).resolves.toMatchObject({
      acceptedTaskIds: ['frozen-task-1'],
      notifications: 0,
    });
    await expect(lifecycle.getTask('frozen-task-1')).resolves.toMatchObject({ status: 'working' });
    await expect(lifecycle.getTask('frozen-task-1')).resolves.toMatchObject({
      status: 'completed',
    });
    expect(frozen.toolCallCount).toBe(1);
  });

  it('fails closed when the local Provider notification producer queue overflows', async () => {
    frozen = await startFrozenMcpTasksMockProvider({
      moveTo: { outcome: 'remote_notification_success' },
      notificationQueueLimit: 1,
      notificationBurst: 2,
    });
    const client = new FrozenV1McpClient();
    const lifecycle = lifecycleClient(client, frozen.endpoint);
    await lifecycle.callTool({ name: 'embodied.move', arguments: { resourceId: 'overflow' } });
    const subscriptions = new FrozenRemoteTaskSubscriptionManager({
      transport: client,
      lifecycle,
      endpoint: frozen.endpoint.href,
      headers: {},
    });
    await expect(
      subscriptions.run({
        taskIds: ['frozen-task-1'],
        reconnecting: false,
        onObservation: () => Promise.resolve(),
      }),
    ).rejects.toBeDefined();
    expect(frozen.notificationOverflowCount).toBe(1);
  });
});

function provider(endpoint: URL): McpServer {
  return {
    serverId: 'frozen-provider-1',
    name: 'Frozen Provider',
    endpoint: endpoint.href,
    transport: 'streamable_http',
    status: 'enabled',
    toolRevision: 1,
    protocolMode: 'frozen_v1',
    createdAt: now,
    updatedAt: now,
  };
}

function lifecycleClient(client: FrozenV1McpClient, endpoint: URL) {
  return new FrozenTaskLifecycleClient({
    client,
    endpoint: endpoint.href,
    headers: {},
    now: () => now,
  });
}

const availabilityCheck = {
  requestId: 'move-node-1',
  operationName: 'embodied.move',
  arguments: { state: 'complete' as const, value: { resourceId: 'UGV-001' } },
  timing: {
    start: { mode: 'immediate' as const, startToleranceMs: 1_000 },
    maxElapsedMs: 60_000,
  },
};
