import { createHash } from 'node:crypto';

import type { FrozenTaskLifecycleRuntimePort } from '../../application/src/index.js';
import type {
  FrozenDetailedRemoteTask,
  FrozenRemoteTaskBase,
  RemoteTaskCreated,
  RemoteTaskProviderSubstate,
  RemoteTaskSnapshot,
} from '../../domain/src/index.js';

import { FrozenTaskLifecycleClient } from './frozen-v1-task-lifecycle.js';
import { FrozenV1McpClient } from './frozen-v1-mcp-client.js';

export class FrozenV1RuntimeLifecycleAdapter implements FrozenTaskLifecycleRuntimePort {
  readonly #transport: FrozenV1McpClient;
  readonly #clients = new Map<string, FrozenTaskLifecycleClient>();
  readonly #now: () => string;

  constructor(input: Readonly<{ now?: () => string }> = {}) {
    this.#transport = new FrozenV1McpClient();
    this.#now = input.now ?? (() => new Date().toISOString());
  }

  disconnect(
    input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>,
  ): void {
    this.#clients.delete(clientKey(input));
  }

  async call(input: Parameters<FrozenTaskLifecycleRuntimePort['call']>[0]) {
    const outcome = await this.#client(input).callTool({
      name: input.toolName,
      arguments: input.arguments,
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
      submissionKey: createHash('sha256')
        .update(stableStringify(input.inputResponses))
        .digest('hex'),
      inputResponses: input.inputResponses,
    });
    return Object.freeze({ acknowledged: true as const, protocolRevision: '2026-07-28' });
  }

  async cancel(input: Parameters<FrozenTaskLifecycleRuntimePort['cancel']>[0]) {
    await this.#client(input).cancelTask(input.remoteTaskId);
    return Object.freeze({ acknowledged: true as const, protocolRevision: '2026-07-28' });
  }

  #client(input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>) {
    const key = clientKey(input);
    const existing = this.#clients.get(key);
    if (existing !== undefined) return existing;
    const client = new FrozenTaskLifecycleClient({
      client: this.#transport,
      endpoint: input.endpoint,
      headers: input.headers,
      now: this.#now,
    });
    this.#clients.set(key, client);
    return client;
  }
}

function clientKey(
  input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>,
) {
  return `${input.endpoint}\u0000${stableStringify(input.headers)}`;
}

function mapCreated(task: FrozenRemoteTaskBase): RemoteTaskCreated {
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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
