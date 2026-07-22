import { randomBytes } from 'node:crypto';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import type { McpTransportAdapter } from '../../application/src/index.js';
import type {
  McpInvocationOutcome,
  McpProtocolCapabilities,
  McpToolExecutionSemanticsValues,
  RemoteTaskOperationAck,
  RemoteTaskSnapshot,
  TaskAvailabilityCheckResult,
} from '../../domain/src/index.js';
import { DomainError } from '../../domain/src/index.js';
import {
  MCP_TASKS_EXTENSION_ID,
  MCP_TASKS_METHOD_ALIASES,
  MCP_TASKS_SCHEMA_REVISION,
  MCP_TASKS_TESTED_PROTOCOL_REVISION,
  McpTasksAdapterError,
  assertValidInputResponses,
  assertValidRemoteTaskId,
  createMcpToolCallResultSchema,
  mcpTaskAckResultSchema,
  mcpTaskSnapshotResultSchema,
  toMcpInvocationOutcome,
  toRemoteTaskSnapshot,
} from './mcp-tasks-contract.js';
import {
  MCP_TASK_AVAILABILITY_SCHEMA_REVISION,
  parseTaskOperationSemantics,
  taskAvailabilityResponseSchema,
  taskExecutionCallMetadata,
  toTaskAvailabilityResults,
  validateAvailabilityRequests,
} from './mcp-task-availability-contract.js';
import {
  McpTasksTransportBridge,
  createMcpTasksRoutingFetch,
} from './mcp-tasks-transport-bridge.js';

interface ClientSession {
  readonly client: Client;
  readonly capabilities: McpProtocolCapabilities;
  readonly bridgeNonce: string;
}

const SDAR_EXECUTION_SEMANTICS_META_KEY = 'io.sdar/tool-execution-semantics';

export class StreamableHttpMcpAdapter implements McpTransportAdapter {
  readonly #clients = new Map<string, Promise<ClientSession>>();

  async discover(input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>) {
    return this.#withSession(input, async (session) => {
      const { client } = session;
      const response = await client.listTools();
      return response.tools.map((tool) => {
        const semantics = declaredExecutionSemantics(tool);
        const taskExecution = parseTaskOperationSemantics(tool._meta);
        if (taskExecution?.execution === 'task_required') this.#requireTasksCapability(session);
        return {
          name: tool.name,
          ...(tool.title === undefined ? {} : { title: tool.title }),
          ...(tool.description === undefined ? {} : { description: tool.description }),
          inputSchema: tool.inputSchema,
          ...(semantics === undefined ? {} : { declaredExecutionSemantics: semantics }),
          ...(taskExecution === undefined ? {} : { taskExecution }),
        };
      });
    });
  }

  capabilities(
    input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>,
  ): Promise<McpProtocolCapabilities> {
    return this.#withSession(input, ({ capabilities }) => Promise.resolve(capabilities));
  }

  async call(input: Parameters<McpTransportAdapter['call']>[0]): Promise<McpInvocationOutcome> {
    return this.#withSession(input, async (session) => {
      try {
        if (input.taskExecution !== undefined) this.#requireTasksCapability(session);
        const value = await session.client.request(
          {
            method: MCP_TASKS_METHOD_ALIASES.callTool,
            params: {
              name: input.toolName,
              arguments: input.arguments,
              ...(input.taskExecution === undefined
                ? {}
                : { _meta: taskExecutionCallMetadata(input.taskExecution) }),
            },
          },
          createMcpToolCallResultSchema(session.bridgeNonce),
          input.signal === undefined ? undefined : { signal: input.signal },
        );
        const outcome = toMcpInvocationOutcome(value, session.capabilities.protocolRevision);
        if (outcome.kind === 'remote_task') this.#requireTasksCapability(session);
        if (
          input.taskExecution?.protocolMode !== 'frozen_v1' &&
          input.taskExecution?.mode === 'require_task' &&
          outcome.kind === 'immediate'
        )
          throw new McpTasksAdapterError(
            'MCP_TASK_REQUIRED_RESULT_MISMATCH',
            'Provider returned a synchronous result for require_task execution.',
          );
        return outcome;
      } catch (error: unknown) {
        throw normalizeTasksProtocolError(error);
      }
    });
  }

  checkTaskAvailability(
    input: Parameters<NonNullable<McpTransportAdapter['checkTaskAvailability']>>[0],
  ): Promise<
    Readonly<{
      protocolRevision: string;
      availabilitySchemaRevision: string;
      results: readonly TaskAvailabilityCheckResult[];
    }>
  > {
    return this.#withSession(input, async (session) => {
      this.#requireTasksCapability(session);
      const requests = validateAvailabilityRequests(input.requests);
      try {
        const value = await session.client.request(
          {
            method: MCP_TASKS_METHOD_ALIASES.availability,
            params: { revision: MCP_TASK_AVAILABILITY_SCHEMA_REVISION, requests },
          },
          taskAvailabilityResponseSchema,
          input.signal === undefined ? undefined : { signal: input.signal },
        );
        return {
          protocolRevision: session.capabilities.protocolRevision,
          availabilitySchemaRevision: MCP_TASK_AVAILABILITY_SCHEMA_REVISION,
          results: toTaskAvailabilityResults(value, requests),
        };
      } catch (error: unknown) {
        throw normalizeTasksProtocolError(error);
      }
    });
  }

  getTask(input: Parameters<McpTransportAdapter['getTask']>[0]): Promise<RemoteTaskSnapshot> {
    return this.#withSession(input, async (session) => {
      this.#requireTasksCapability(session);
      const remoteTaskId = assertValidRemoteTaskId(input.remoteTaskId);
      try {
        const value = await session.client.request(
          { method: MCP_TASKS_METHOD_ALIASES.get, params: { taskId: remoteTaskId } },
          mcpTaskSnapshotResultSchema,
          input.signal === undefined ? undefined : { signal: input.signal },
        );
        if (value.taskId !== remoteTaskId) {
          throw new McpTasksAdapterError(
            'MCP_TASK_RESPONSE_INVALID',
            'Provider returned a Task ID different from the requested Task.',
          );
        }
        return toRemoteTaskSnapshot(value, session.capabilities.protocolRevision);
      } catch (error: unknown) {
        throw normalizeTasksProtocolError(error);
      }
    });
  }

  updateTask(
    input: Parameters<McpTransportAdapter['updateTask']>[0],
  ): Promise<RemoteTaskOperationAck> {
    return this.#withSession(input, async (session) => {
      this.#requireTasksCapability(session);
      const remoteTaskId = assertValidRemoteTaskId(input.remoteTaskId);
      const inputResponses = assertValidInputResponses(input.inputResponses);
      try {
        await session.client.request(
          {
            method: MCP_TASKS_METHOD_ALIASES.update,
            params: { taskId: remoteTaskId, inputResponses },
          },
          mcpTaskAckResultSchema,
          input.signal === undefined ? undefined : { signal: input.signal },
        );
        return {
          acknowledged: true,
          protocolRevision: session.capabilities.protocolRevision,
        };
      } catch (error: unknown) {
        throw normalizeTasksProtocolError(error);
      }
    });
  }

  cancelTask(
    input: Parameters<McpTransportAdapter['cancelTask']>[0],
  ): Promise<RemoteTaskOperationAck> {
    return this.#withSession(input, async (session) => {
      this.#requireTasksCapability(session);
      const remoteTaskId = assertValidRemoteTaskId(input.remoteTaskId);
      try {
        await session.client.request(
          { method: MCP_TASKS_METHOD_ALIASES.cancel, params: { taskId: remoteTaskId } },
          mcpTaskAckResultSchema,
          input.signal === undefined ? undefined : { signal: input.signal },
        );
        return {
          acknowledged: true,
          protocolRevision: session.capabilities.protocolRevision,
        };
      } catch (error: unknown) {
        throw normalizeTasksProtocolError(error);
      }
    });
  }

  async #withSession<T>(
    input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>,
    operation: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.#getSession(input);
    return operation(session);
  }

  async close(): Promise<void> {
    const sessions = await Promise.allSettled(this.#clients.values());
    this.#clients.clear();
    await Promise.all(
      sessions.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value.client.close()] : [],
      ),
    );
  }

  async disconnect(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
    }>,
  ): Promise<void> {
    const key = clientKey(input);
    const session = this.#clients.get(key);
    this.#clients.delete(key);
    if (session !== undefined) await (await session).client.close();
  }

  async ping(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
    }>,
  ): Promise<void> {
    const session = await this.#getSession(input);
    await session.client.ping();
  }

  #getSession(input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>) {
    const key = clientKey(input);
    const existing = this.#clients.get(key);
    if (existing !== undefined) return existing;
    const connecting = this.#connect(input).catch((error: unknown) => {
      this.#clients.delete(key);
      throw error;
    });
    this.#clients.set(key, connecting);
    return connecting;
  }

  async #connect(input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>) {
    const bridgeNonce = randomBytes(32).toString('hex');
    const transport = new StreamableHTTPClientTransport(new URL(input.endpoint), {
      requestInit: { headers: { ...input.headers } },
      fetch: createMcpTasksRoutingFetch(),
    });
    const bridge = new McpTasksTransportBridge(transport, bridgeNonce);
    const client = new Client(
      { name: 'sdar-runtime', version: '1.1.0' },
      {
        capabilities: { extensions: { [MCP_TASKS_EXTENSION_ID]: {} } },
        versionNegotiation: { mode: 'auto' },
      },
    );
    await client.connect(bridge);
    const protocolRevision = client.getNegotiatedProtocolVersion();
    const protocolEra = client.getProtocolEra();
    if (protocolRevision === undefined || protocolEra === undefined) {
      await client.close();
      throw new McpTasksAdapterError(
        'MCP_TASK_PROTOCOL_REVISION_UNSUPPORTED',
        'MCP connection did not report a negotiated protocol revision.',
      );
    }
    const serverExtensions = client.getServerCapabilities()?.extensions;
    const declared =
      serverExtensions !== undefined &&
      Object.prototype.hasOwnProperty.call(serverExtensions, MCP_TASKS_EXTENSION_ID);
    const tasksExtension =
      protocolEra === 'modern' &&
      protocolRevision === MCP_TASKS_TESTED_PROTOCOL_REVISION &&
      declared;
    return {
      client,
      bridgeNonce,
      capabilities: {
        protocolEra,
        protocolRevision,
        tasksExtension,
        tasksSchemaRevision: MCP_TASKS_SCHEMA_REVISION,
      },
    } satisfies ClientSession;
  }

  #requireTasksCapability(session: ClientSession): void {
    if (
      session.capabilities.protocolEra !== 'modern' ||
      session.capabilities.protocolRevision !== MCP_TASKS_TESTED_PROTOCOL_REVISION
    ) {
      throw new McpTasksAdapterError(
        'MCP_TASK_PROTOCOL_REVISION_UNSUPPORTED',
        `MCP Tasks requires tested protocol revision ${MCP_TASKS_TESTED_PROTOCOL_REVISION}.`,
      );
    }
    if (!session.capabilities.tasksExtension) {
      throw new McpTasksAdapterError(
        'MCP_TASK_CAPABILITY_REQUIRED',
        `Provider did not declare ${MCP_TASKS_EXTENSION_ID}.`,
      );
    }
  }
}

interface SdkToolSemanticsInput {
  readonly annotations?:
    | Readonly<{
        readonly readOnlyHint?: boolean | undefined;
        readonly destructiveHint?: boolean | undefined;
      }>
    | undefined;
  readonly execution?:
    | Readonly<{
        readonly taskSupport?: 'optional' | 'required' | 'forbidden' | undefined;
      }>
    | undefined;
  readonly _meta?: Readonly<Record<string, unknown>> | undefined;
}

function declaredExecutionSemantics(
  tool: SdkToolSemanticsInput,
): McpToolExecutionSemanticsValues | undefined {
  const hasExactDeclaration =
    tool._meta !== undefined &&
    Object.prototype.hasOwnProperty.call(tool._meta, SDAR_EXECUTION_SEMANTICS_META_KEY);
  const exact = parseExactSemantics(tool._meta?.[SDAR_EXECUTION_SEMANTICS_META_KEY]);
  if (hasExactDeclaration && exact === undefined) {
    throw new DomainError(
      'MCP_TOOL_EXECUTION_SEMANTICS_DECLARATION_INVALID',
      'MCP Tool execution semantics declaration is malformed.',
    );
  }
  const effect =
    exact?.effect ??
    (tool.annotations?.readOnlyHint === true
      ? 'read_only'
      : tool.annotations?.readOnlyHint === false || tool.annotations?.destructiveHint === true
        ? 'side_effecting'
        : 'unknown');
  const execution =
    exact?.execution ??
    (tool.execution?.taskSupport === 'forbidden'
      ? 'synchronous'
      : tool.execution?.taskSupport === 'optional'
        ? 'task_capable'
        : tool.execution?.taskSupport === 'required'
          ? 'task_required'
          : 'unknown');
  const hasDeclaration = exact !== undefined || effect !== 'unknown' || execution !== 'unknown';
  if (!hasDeclaration) return undefined;
  return {
    effect,
    execution,
    cancellation: exact?.cancellation ?? 'unknown',
    idempotency: exact?.idempotency ?? 'unknown',
    replay: exact?.replay ?? 'unknown',
  };
}

function parseExactSemantics(value: unknown): McpToolExecutionSemanticsValues | undefined {
  if (!isRecord(value)) return undefined;
  const effect = enumValue(value['effect'], ['read_only', 'side_effecting', 'unknown']);
  const execution = enumValue(value['execution'], [
    'synchronous',
    'task_capable',
    'task_required',
    'unknown',
  ]);
  const cancellation = enumValue(value['cancellation'], [
    'unsupported',
    'cooperative',
    'task_cancel',
    'unknown',
  ]);
  const idempotency = enumValue(value['idempotency'], [
    'none',
    'client_request_key',
    'server_managed',
    'unknown',
  ]);
  const replay = enumValue(value['replay'], ['allowed', 'simulation_only', 'forbidden', 'unknown']);
  if (
    effect === undefined ||
    execution === undefined ||
    cancellation === undefined ||
    idempotency === undefined ||
    replay === undefined
  )
    return undefined;
  return { effect, execution, cancellation, idempotency, replay };
}

function enumValue<const T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clientKey(
  input: Readonly<{
    endpoint: string;
    headers: Readonly<Record<string, string>>;
  }>,
): string {
  return JSON.stringify([input.endpoint, Object.entries(input.headers).sort()]);
}

function normalizeTasksProtocolError(error: unknown): Error {
  if (error instanceof McpTasksAdapterError) return error;
  if (isRecord(error)) {
    const code = error['code'];
    if (code === 'INVALID_RESULT' || code === 'UNSUPPORTED_RESULT_TYPE') {
      return new McpTasksAdapterError(
        'MCP_TASK_RESPONSE_INVALID',
        'MCP Provider returned a response that violates the frozen Tasks contract.',
        { cause: error },
      );
    }
  }
  return error instanceof Error ? error : new Error('Unknown MCP transport failure.');
}
