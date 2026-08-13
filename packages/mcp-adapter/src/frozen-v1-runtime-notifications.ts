import type { FrozenTaskNotificationRuntimePort } from '../../application/src/index.js';
import type {
  FrozenDetailedRemoteTask,
  RemoteTaskCreated,
  RemoteTaskProviderSubstate,
  RemoteTaskSnapshot,
} from '../../domain/src/index.js';

import { FrozenV1McpClient } from './frozen-v1-mcp-client.js';
import { FrozenTaskLifecycleClient } from './frozen-v1-task-lifecycle.js';
import { FrozenRemoteTaskSubscriptionManager } from './frozen-v1-task-subscriptions.js';

export class FrozenV1RuntimeNotificationAdapter implements FrozenTaskNotificationRuntimePort {
  readonly #now: () => string;
  readonly #client: FrozenV1McpClient;

  constructor(input: Readonly<{ now?: () => string; client?: FrozenV1McpClient }> = {}) {
    this.#now = input.now ?? (() => new Date().toISOString());
    this.#client = input.client ?? new FrozenV1McpClient();
  }

  async run(input: Parameters<FrozenTaskNotificationRuntimePort['run']>[0]): Promise<void> {
    const transport = this.#client;
    const lifecycle = new FrozenTaskLifecycleClient({
      client: transport,
      endpoint: input.endpoint,
      headers: input.headers,
      now: this.#now,
    });
    const manager = new FrozenRemoteTaskSubscriptionManager({
      transport,
      lifecycle,
      endpoint: input.endpoint,
      headers: input.headers,
    });
    const outputValidationByTaskId = new Map(
      Object.entries(input.outputSchemas).map(([taskId, outputSchema]) => [
        taskId,
        { outputSchema, validator: input.outputValidator },
      ]),
    );
    await manager.run({
      taskIds: input.taskIds,
      reconnecting: input.reconnecting,
      signal: input.signal,
      outputValidationByTaskId,
      onObservation: (task, source, subscriptionId) =>
        input.onObservation(
          mapSnapshot(task),
          source === 'notification' ? 'notification' : 'reconciliation',
          String(subscriptionId),
        ),
    });
  }
}

function mapCreated(task: FrozenDetailedRemoteTask): RemoteTaskCreated {
  return {
    protocolMode: 'frozen_v1',
    remoteTaskId: task.taskId,
    status: task.status,
    ...(task.statusMessage === undefined ? {} : { statusMessage: task.statusMessage }),
    createdAt: task.createdAt,
    lastUpdatedAt: task.lastUpdatedAt,
    ttlMs: task.ttlMs,
    ...(task.expiresAt === undefined ? {} : { expiresAt: task.expiresAt }),
    ...(task.pollIntervalMs === undefined ? {} : { pollIntervalMs: task.pollIntervalMs }),
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'frozen-1.0',
    runtimeRevision: task.observation.runtimeRevision,
    ...(task.observation.providerRevision === undefined
      ? {}
      : { providerRevision: task.observation.providerRevision }),
    providerObservation: {
      revision: '1.0',
      remoteRevision: task.observation.runtimeRevision,
      ...(task.observation.substate === undefined
        ? {}
        : { substate: task.observation.substate as RemoteTaskProviderSubstate }),
      ...(task.observation.eventId === undefined ? {} : { eventId: task.observation.eventId }),
      ...(task.observation.observedAt === undefined
        ? {}
        : { observedAt: task.observation.observedAt }),
      ...(task.observation.progress === undefined ? {} : { progress: task.observation.progress }),
    },
  };
}

function mapSnapshot(task: FrozenDetailedRemoteTask): RemoteTaskSnapshot {
  const base = mapCreated(task);
  if (task.status === 'completed') return { ...base, status: 'completed', result: task.result };
  if (task.status === 'failed') return { ...base, status: 'failed', error: task.error };
  if (task.status === 'cancelled') return { ...base, status: 'cancelled' };
  if (task.status === 'input_required')
    return { ...base, status: 'input_required', inputRequests: task.inputRequests };
  return { ...base, status: 'working' };
}
