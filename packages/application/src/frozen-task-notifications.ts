import type { RemoteTaskSnapshot } from '../../domain/src/index.js';

import type {
  Clock,
  ContextSerialGate,
  JsonSchemaValidator,
  McpRegistryRepository,
  RemoteTaskRepository,
  SecretCipher,
} from './ports.js';

export interface FrozenTaskNotificationRuntimePort {
  run(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
      taskIds: readonly string[];
      reconnecting: boolean;
      outputSchemas: Readonly<Record<string, unknown>>;
      outputValidator: JsonSchemaValidator;
      signal: AbortSignal;
      onObservation(
        task: RemoteTaskSnapshot,
        source: 'notification' | 'reconciliation',
        subscriptionId: string,
      ): Promise<void>;
    }>,
  ): Promise<void>;
}

export interface FrozenTaskNotificationReconnectResult {
  readonly serverId: string;
  readonly disposition: 'started' | 'already_running' | 'no_active_tasks';
  readonly taskIds: readonly string[];
}

export class FrozenRemoteTaskNotificationService {
  readonly #registry: Pick<McpRegistryRepository, 'findServer' | 'listTools'>;
  readonly #remoteTasks: RemoteTaskRepository;
  readonly #cipher: SecretCipher;
  readonly #runtime: FrozenTaskNotificationRuntimePort;
  readonly #schemas: JsonSchemaValidator;
  readonly #serial: ContextSerialGate;
  readonly #clock: Clock;
  readonly #nextObservationId: () => string;
  readonly #nextControlEventId: () => string;
  readonly #hash: (value: unknown) => string;
  readonly #onError: (serverId: string, error: unknown) => void;
  readonly #active = new Map<
    string,
    Readonly<{ controller: AbortController; taskIds: readonly string[] }>
  >();

  constructor(
    input: Readonly<{
      registry: Pick<McpRegistryRepository, 'findServer' | 'listTools'>;
      remoteTasks: RemoteTaskRepository;
      cipher: SecretCipher;
      runtime: FrozenTaskNotificationRuntimePort;
      schemas: JsonSchemaValidator;
      serial: ContextSerialGate;
      clock: Clock;
      nextObservationId(): string;
      nextControlEventId(): string;
      hash(value: unknown): string;
      onError?(serverId: string, error: unknown): void;
    }>,
  ) {
    this.#registry = input.registry;
    this.#remoteTasks = input.remoteTasks;
    this.#cipher = input.cipher;
    this.#runtime = input.runtime;
    this.#schemas = input.schemas;
    this.#serial = input.serial;
    this.#clock = input.clock;
    this.#nextObservationId = input.nextObservationId;
    this.#nextControlEventId = input.nextControlEventId;
    this.#hash = input.hash;
    this.#onError = input.onError ?? (() => undefined);
  }

  async reconnect(serverId: string): Promise<FrozenTaskNotificationReconnectResult> {
    const existing = this.#active.get(serverId);
    if (existing !== undefined)
      return { serverId, disposition: 'already_running', taskIds: existing.taskIds };
    const record = await this.#registry.findServer(serverId);
    if (record === undefined)
      throw notificationError('FROZEN_MCP_SERVER_NOT_FOUND', 'Frozen MCP Server was not found.');
    if (record.server.protocolMode !== 'frozen_v1')
      throw notificationError(
        'FROZEN_MCP_SERVER_MODE_REQUIRED',
        'Task Notification reconnect requires a Frozen MCP Server.',
      );
    const bindings = await this.#remoteTasks.listActiveByServer(serverId, 256);
    const tools = await this.#registry.listTools(serverId);
    const taskIds = Object.freeze(bindings.map((binding) => binding.remoteTaskId));
    if (taskIds.length === 0) return { serverId, disposition: 'no_active_tasks', taskIds };

    const controller = new AbortController();
    const outputSchemas = Object.freeze(
      Object.fromEntries(
        bindings.flatMap((binding) => {
          const schema = tools.find(
            (tool) => tool.toolName === binding.operationName,
          )?.outputSchema;
          return schema === undefined ? [] : [[binding.remoteTaskId, schema]];
        }),
      ),
    );
    this.#active.set(serverId, { controller, taskIds });
    void this.#runtime
      .run({
        endpoint: record.server.endpoint,
        headers: this.#cipher.decrypt(record.encryptedCredential),
        taskIds,
        reconnecting: true,
        outputSchemas,
        outputValidator: this.#schemas,
        signal: controller.signal,
        onObservation: (snapshot, source, subscriptionId) =>
          this.#admitObservation(serverId, snapshot, source, subscriptionId),
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) this.#onError(serverId, error);
      })
      .finally(() => {
        if (this.#active.get(serverId)?.controller === controller) this.#active.delete(serverId);
      });
    return { serverId, disposition: 'started', taskIds };
  }

  close(): void {
    for (const active of this.#active.values()) active.controller.abort();
    this.#active.clear();
  }

  async #admitObservation(
    serverId: string,
    snapshot: RemoteTaskSnapshot,
    source: 'notification' | 'reconciliation',
    subscriptionId: string,
  ): Promise<void> {
    const initial = await this.#remoteTasks.findByRemoteIdentity(serverId, snapshot.remoteTaskId);
    if (initial === undefined) return;
    await this.#serial.run(initial.contextId, async () => {
      const binding = await this.#remoteTasks.findById(initial.bindingId);
      if (binding === undefined) return;
      const terminal = snapshot.status !== 'working';
      await this.#remoteTasks.recordExternalSnapshot({
        bindingId: binding.bindingId,
        expectedVersion: binding.version,
        snapshot,
        observationId: this.#nextObservationId(),
        source,
        subscriptionId,
        ...(terminal
          ? { controlEventId: this.#nextControlEventId(), resultHash: this.#hash(snapshot) }
          : {}),
        observedAt: this.#clock.now(),
      });
    });
  }
}

export type FrozenTaskNotificationErrorCode =
  'FROZEN_MCP_SERVER_NOT_FOUND' | 'FROZEN_MCP_SERVER_MODE_REQUIRED';

export class FrozenTaskNotificationError extends Error {
  readonly code: FrozenTaskNotificationErrorCode;
  constructor(code: FrozenTaskNotificationErrorCode, message: string) {
    super(message);
    this.name = 'FrozenTaskNotificationError';
    this.code = code;
  }
}

function notificationError(
  code: FrozenTaskNotificationErrorCode,
  message: string,
): FrozenTaskNotificationError {
  return new FrozenTaskNotificationError(code, message);
}
