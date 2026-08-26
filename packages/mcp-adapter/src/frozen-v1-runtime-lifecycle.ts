import type { FrozenTaskLifecycleRuntimePort } from '../../application/src/index.js';
import type {
  FrozenDetailedRemoteTask,
  FrozenRemoteTaskBase,
  RemoteTaskCreated,
  RemoteTaskProviderSubstate,
  RemoteTaskSnapshot,
} from '../../domain/src/index.js';

import { FrozenTaskWireClient } from './frozen-v1-task-lifecycle.js';
import { FrozenV1McpClient } from './frozen-v1-mcp-client.js';

export class FrozenV1RuntimeLifecycleAdapter implements FrozenTaskLifecycleRuntimePort {
  readonly #transport: FrozenV1McpClient;
  readonly #now: () => string;

  constructor(input: Readonly<{ now?: () => string; client?: FrozenV1McpClient }> = {}) {
    this.#transport = input.client ?? new FrozenV1McpClient();
    this.#now = input.now ?? (() => new Date().toISOString());
  }

  async call(input: Parameters<FrozenTaskLifecycleRuntimePort['call']>[0]) {
    const outcome = await this.#client(input).callTool({
      name: input.toolName,
      arguments: input.arguments,
      ...(input.taskCallProfile === undefined ? {} : { taskCallProfile: input.taskCallProfile }),
      ...(input.outputSchema === undefined
        ? {}
        : {
            outputValidation: {
              outputSchema: input.outputSchema,
              validator: input.outputValidator,
            },
          }),
    });
    return outcome.kind === 'immediate'
      ? Object.freeze({ kind: 'immediate' as const, result: outcome.result })
      : Object.freeze({
          kind: 'remote_task' as const,
          task: mapCreated(outcome.created),
          reconciledTask: mapSnapshot(outcome.reconciled),
        });
  }

  async get(input: Parameters<FrozenTaskLifecycleRuntimePort['get']>[0]) {
    return mapSnapshot(
      await this.#client(input).getTask(
        input.remoteTaskId,
        input.outputSchema === undefined
          ? undefined
          : { outputSchema: input.outputSchema, validator: input.outputValidator },
      ),
    );
  }

  async update(input: Parameters<FrozenTaskLifecycleRuntimePort['update']>[0]) {
    await this.#client(input).updateTask({
      taskId: input.remoteTaskId,
      inputResponses: input.inputResponses,
    });
    return Object.freeze({ acknowledged: true as const, protocolRevision: '2026-07-28' });
  }

  async cancel(input: Parameters<FrozenTaskLifecycleRuntimePort['cancel']>[0]) {
    await this.#client(input).cancelTask(input.remoteTaskId);
    return Object.freeze({ acknowledged: true as const, protocolRevision: '2026-07-28' });
  }

  #client(input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>) {
    return new FrozenTaskWireClient({
      client: this.#transport,
      endpoint: input.endpoint,
      headers: input.headers,
      now: this.#now,
    });
  }
}

function mapCreated(task: FrozenRemoteTaskBase): RemoteTaskCreated {
  return {
    protocolMode: 'frozen_v1',
    ...(task.providerIdentity === undefined ? {} : { providerIdentity: task.providerIdentity }),
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
