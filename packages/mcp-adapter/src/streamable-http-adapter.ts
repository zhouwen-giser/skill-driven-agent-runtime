import { randomBytes } from 'node:crypto';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import type { McpTransportAdapter } from '../../application/src/index.js';
import type {
  McpInvocationOutcome,
  McpProtocolCapabilities,
  RemoteTaskOperationAck,
  RemoteTaskSnapshot,
} from '../../domain/src/index.js';
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
  McpTasksTransportBridge,
  createMcpTasksRoutingFetch,
} from './mcp-tasks-transport-bridge.js';

interface ClientSession {
  readonly client: Client;
  readonly capabilities: McpProtocolCapabilities;
  readonly bridgeNonce: string;
}

export class StreamableHttpMcpAdapter implements McpTransportAdapter {
  readonly #clients = new Map<string, Promise<ClientSession>>();

  async discover(input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>) {
    return this.#withSession(input, async ({ client }) => {
      const response = await client.listTools();
      return response.tools.map((tool) => ({
        name: tool.name,
        ...(tool.title === undefined ? {} : { title: tool.title }),
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema,
      }));
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
        const value = await session.client.request(
          {
            method: MCP_TASKS_METHOD_ALIASES.callTool,
            params: { name: input.toolName, arguments: input.arguments },
          },
          createMcpToolCallResultSchema(session.bridgeNonce),
          input.signal === undefined ? undefined : { signal: input.signal },
        );
        const outcome = toMcpInvocationOutcome(value);
        if (outcome.kind === 'remote_task') this.#requireTasksCapability(session);
        return outcome;
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
