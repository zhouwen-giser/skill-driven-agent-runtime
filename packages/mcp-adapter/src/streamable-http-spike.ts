import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';

import { FROZEN_MCP_PROTOCOL_VERSION } from './frozen-v1-mcp-client.js';

export interface McpSpikeHandle {
  readonly client: Client;
  readonly endpoint: URL;
  readonly cancellationObserved: Promise<boolean>;
  close(): Promise<void>;
}

export interface McpLoopbackServerHandle {
  readonly endpoint: URL;
  readonly cancellationObserved: Promise<boolean>;
  readonly receivedHeaders: readonly Readonly<IncomingHttpHeaders>[];
  close(): Promise<void>;
}

export interface McpLoopbackServerOptions {
  readonly deviceExecutionSemantics?: unknown;
}

export async function startMcpStreamableHttpSpike(): Promise<McpSpikeHandle> {
  const server = await startMcpLoopbackServer();
  const clientTransport = new StreamableHTTPClientTransport(server.endpoint);
  const client = new Client({ name: 'sdar-mcp-spike-client', version: '0.0.0' });
  await client.connect(asSdkTransport(clientTransport));
  return {
    client,
    endpoint: server.endpoint,
    cancellationObserved: server.cancellationObserved,
    async close(): Promise<void> {
      await client.close();
      await server.close();
    },
  };
}

export async function startMcpLoopbackServer(
  options: McpLoopbackServerOptions = {},
): Promise<McpLoopbackServerHandle> {
  const receivedHeaders: Readonly<IncomingHttpHeaders>[] = [];
  let reportCancellation: (observed: boolean) => void = () => undefined;
  const cancellationObserved = new Promise<boolean>((resolve) => {
    reportCancellation = resolve;
  });
  const sessions = new Map<
    string,
    Readonly<{ server: McpServer; transport: StreamableHTTPServerTransport }>
  >();
  const servers = new Set<McpServer>();
  const createMcpServer = () => {
    const mcpServer = new McpServer({ name: 'sdar-mock-mcp', version: '0.0.0' });
    servers.add(mcpServer);
    registerTools(mcpServer, reportCancellation, options);
    return mcpServer;
  };

  const httpServer = createServer((request, response) => {
    receivedHeaders.push({ ...request.headers });
    void (async () => {
      if (typeof request.headers['mcp-method'] === 'string') {
        await handleFrozenRequest(request, response, options);
        return;
      }
      const sessionId = request.headers['mcp-session-id'];
      const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
      if (existing !== undefined) {
        await existing.transport.handleRequest(request, response);
        return;
      }
      if (sessionId !== undefined) {
        response.statusCode = 400;
        response.end('Unknown MCP session');
        return;
      }
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (initializedSessionId) => {
          sessions.set(initializedSessionId, { server, transport });
        },
      });
      await server.connect(asSdkTransport(transport));
      await transport.handleRequest(request, response);
    })().catch((error: unknown) => {
      if (response.headersSent) return;
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : 'Unknown MCP transport error');
    });
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');

  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    await closeHttpServer(httpServer);
    throw new Error('MCP_SPIKE_ADDRESS_UNAVAILABLE');
  }

  const endpoint = new URL(`http://127.0.0.1:${String(address.port)}/mcp`);
  return {
    endpoint,
    cancellationObserved,
    receivedHeaders,
    async close(): Promise<void> {
      await Promise.allSettled([...servers].map((server) => server.close()));
      sessions.clear();
      servers.clear();
      await closeHttpServer(httpServer);
    },
  };
}

async function handleFrozenRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: McpLoopbackServerOptions,
): Promise<void> {
  let raw = '';
  for await (const chunk of request) raw += String(chunk);
  const body = JSON.parse(raw) as Readonly<Record<string, unknown>>;
  const method = body['method'];
  const params = record(body['params']);
  const id = body['id'];
  const taskProfile = {
    profileVersion: '1.0',
    taskBehavior: 'server_directed',
    availability: 'dynamic',
    supportsScheduling: false,
    supportsMaxElapsed: true,
    supportsObservations: true,
    supportsInputRequired: false,
    idempotency: 'client_request_key',
  };
  const result =
    method === 'server/discover'
      ? {
          resultType: 'complete',
          supportedVersions: [FROZEN_MCP_PROTOCOL_VERSION],
          capabilities: {
            extensions: {
              'io.modelcontextprotocol/tasks': {},
              'io.sdar/taskExecution': { profileVersion: '1.0', taskNotifications: true },
            },
          },
          _meta: {
            'io.modelcontextprotocol/serverInfo': { name: 'sdar-loopback', version: '1.0.0' },
          },
        }
      : method === 'tools/list'
        ? {
            tools: [
              frozenLoopbackTool('device_status', taskProfile, options.deviceExecutionSemantics),
              frozenLoopbackTool('slow_probe', taskProfile),
            ],
          }
        : method === 'io.sdar/taskExecution/checkAvailability'
          ? {
              resultType: 'complete',
              profileVersion: '1.0',
              results: (Array.isArray(params['checks']) ? params['checks'] : []).map((check) => ({
                ...record(check),
                availability: 'available',
                riskLevel: 'low',
                reservationMode: 'none',
                possibleEffects: [],
              })),
            }
          : method === 'tools/call'
            ? await frozenLoopbackCall(params)
            : undefined;
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify(
      result === undefined
        ? { jsonrpc: '2.0', id, error: { code: -32601, message: 'Unsupported method' } }
        : { jsonrpc: '2.0', id, result },
    ),
  );
}

function frozenLoopbackTool(name: string, profile: unknown, semantics?: unknown) {
  return {
    name,
    description: name === 'device_status' ? 'Returns deterministic device status.' : 'Slow probe.',
    inputSchema:
      name === 'device_status'
        ? {
            type: 'object',
            required: ['deviceId'],
            properties: { deviceId: { type: 'string' }, delayMs: { type: 'number' } },
          }
        : { type: 'object' },
    outputSchema:
      name === 'device_status'
        ? {
            type: 'object',
            required: ['deviceId', 'status'],
            properties: { deviceId: { type: 'string' }, status: { type: 'string' } },
          }
        : { type: 'object' },
    _meta: {
      'io.sdar/taskExecution': profile,
      ...(semantics === undefined ? {} : { 'io.sdar/tool-execution-semantics': semantics }),
    },
  };
}

async function frozenLoopbackCall(params: Readonly<Record<string, unknown>>) {
  const arguments_ = record(params['arguments']);
  const delayMs = arguments_['delayMs'];
  if (typeof delayMs === 'number' && Number.isFinite(delayMs) && delayMs > 0)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(delayMs, 2_000)));
  const structuredContent = {
    deviceId: typeof arguments_['deviceId'] === 'string' ? arguments_['deviceId'] : 'device-1',
    status: 'online',
  };
  return {
    resultType: 'complete',
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: false,
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function registerTools(
  mcpServer: McpServer,
  reportCancellation: (observed: boolean) => void,
  options: McpLoopbackServerOptions,
): void {
  const deviceExecutionSemantics = options.deviceExecutionSemantics ?? {
    effect: 'read_only',
    execution: 'synchronous',
    cancellation: 'cooperative',
    idempotency: 'client_request_key',
    replay: 'allowed',
  };
  mcpServer.registerTool(
    'device_status',
    {
      description: 'Returns deterministic read-only device status.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      _meta: {
        'io.sdar/tool-execution-semantics': deviceExecutionSemantics,
      },
      inputSchema: {
        deviceId: z.string().min(1),
        delayMs: z.number().int().nonnegative().optional(),
      },
    },
    async ({ deviceId, delayMs }) => {
      if (delayMs !== undefined)
        await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
      return {
        content: [{ type: 'text', text: JSON.stringify({ deviceId, status: 'online' }) }],
        structuredContent: { deviceId, status: 'online' },
      };
    },
  );
  mcpServer.registerTool(
    'slow_probe',
    {
      description: 'Waits until the client cancels, for transport cancellation verification.',
      inputSchema: {},
    },
    async (_input, extra) => {
      await new Promise<void>((resolve) => {
        if (extra.signal.aborted) {
          reportCancellation(true);
          resolve();
          return;
        }
        extra.signal.addEventListener(
          'abort',
          () => {
            reportCancellation(true);
            resolve();
          },
          { once: true },
        );
      });
      return { content: [{ type: 'text', text: 'canceled' }], isError: true };
    },
  );
}

// SDK 1.29.0's concrete transports declare optional callback properties as `T | undefined`,
// while its Transport interface declares them as exact optional properties. Runtime behavior is
// verified by the loopback contract tests; keep this compatibility cast inside the adapter only.
function asSdkTransport(transport: unknown): Transport {
  return transport as Transport;
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}
