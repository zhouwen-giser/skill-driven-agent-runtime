import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { once } from 'node:events';

import {
  MCP_TASKS_EXTENSION_ID,
  MCP_TASKS_TESTED_PROTOCOL_REVISION,
} from './mcp-tasks-contract.js';

const FIXED_CREATED_AT = '2026-07-16T00:00:00.000Z';
const FIXED_COMPLETED_AT = '2026-07-16T00:01:00.000Z';
const REMOTE_TASK_ID = 'remote-task-0000000000000001';
const MAX_REQUEST_BYTES = 1_048_576;

export interface McpTasksMockRequest {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string>>;
}

export interface McpTasksMockProviderHandle {
  readonly endpoint: URL;
  readonly requests: readonly McpTasksMockRequest[];
  close(): Promise<void>;
}

export async function startMcpTasksMockProvider(
  options: Readonly<{ declareTasks?: boolean }> = {},
): Promise<McpTasksMockProviderHandle> {
  const requests: McpTasksMockRequest[] = [];
  const declareTasks = options.declareTasks ?? true;
  const server = createServer((request, response) => {
    void handleProviderRequest(request, response, requests, declareTasks);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('MCP Tasks Mock Provider did not bind a TCP port.');
  }
  return {
    endpoint: new URL(`http://127.0.0.1:${String(address.port)}/mcp`),
    requests,
    close: () => closeServer(server),
  };
}

async function handleProviderRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: McpTasksMockRequest[],
  declareTasks: boolean,
): Promise<void> {
  try {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    const body = await readJsonBody(request, MAX_REQUEST_BYTES);
    const id = body['id'];
    const method = body['method'];
    const params = isRecord(body['params']) ? body['params'] : {};
    if (typeof method !== 'string') {
      sendJson(response, {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid request' },
      });
      return;
    }
    requests.push({ method, params, headers: normalizeHeaders(request.headers) });
    const result = resultForRequest(method, params, declareTasks);
    sendJson(response, { jsonrpc: '2.0', id, result });
  } catch (error: unknown) {
    sendJson(
      response,
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Mock Provider failure',
        },
      },
      500,
    );
  }
}

function resultForRequest(
  method: string,
  params: Readonly<Record<string, unknown>>,
  declareTasks: boolean,
): Readonly<Record<string, unknown>> {
  switch (method) {
    case 'server/discover':
      return {
        resultType: 'complete',
        ttlMs: 0,
        cacheScope: 'private',
        supportedVersions: [MCP_TASKS_TESTED_PROTOCOL_REVISION],
        capabilities: {
          tools: {},
          extensions: declareTasks ? { [MCP_TASKS_EXTENSION_ID]: {} } : {},
        },
        serverInfo: { name: 'sdar-mcp-tasks-mock', version: '1.0.0' },
      };
    case 'tools/list':
      return {
        resultType: 'complete',
        ttlMs: 0,
        cacheScope: 'private',
        tools: [
          'sync_success',
          'async_success',
          'rejected_without_task',
          'malformed_task_id',
          'unknown_task_status',
          'unknown_task_field',
          'malformed_task_metadata',
        ].map((name) => ({
          name,
          inputSchema: { type: 'object', additionalProperties: false },
          ...(name === 'async_success'
            ? {
                _meta: {
                  'io.sdar/taskExecution': {
                    execution: 'task_required',
                    availability: 'dynamic',
                    supportsScheduling: true,
                    supportsMaxElapsed: true,
                    supportsObservations: true,
                    cancellation: 'task_cancel',
                    revision: '1.0',
                  },
                },
              }
            : {}),
        })),
      };
    case 'io.sdar/tasks/checkAvailability':
      return availabilityResult(params);
    case 'tools/call':
      return toolCallResult(params);
    case 'tasks/get':
      return {
        resultType: 'complete',
        taskId: stringParam(params, 'taskId'),
        status: 'completed',
        createdAt: FIXED_CREATED_AT,
        lastUpdatedAt: FIXED_COMPLETED_AT,
        ttlMs: 3_600_000,
        pollIntervalMs: 50,
        _meta: {
          'io.sdar/taskExecution': {
            revision: '1.0',
            remoteRevision: 'provider-revision-2',
            substate: 'stopping',
            eventId: 'provider-event-2',
            observedAt: FIXED_COMPLETED_AT,
            progress: { percent: 100 },
          },
        },
        result: {
          content: [{ type: 'text', text: 'remote complete' }],
          structuredContent: { status: 'remote_complete' },
          isError: false,
        },
      };
    case 'tasks/update':
    case 'tasks/cancel':
      return { resultType: 'complete' };
    default:
      throw new Error(`Unsupported Mock Provider method ${method}.`);
  }
}

function availabilityResult(
  params: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (params['revision'] !== '1.0' || !Array.isArray(params['requests']))
    throw new Error('Invalid availability request.');
  return {
    resultType: 'complete',
    revision: '1.0',
    results: params['requests'].map((request: unknown) => {
      if (!isRecord(request)) throw new Error('Invalid availability item.');
      return {
        nodeId: stringParam(request, 'nodeId'),
        operationName: stringParam(request, 'operationName'),
        availability: 'available',
        riskLevel: 'low',
        reservationMode: 'none',
        possibleEffects: [],
      };
    }),
  };
}

function toolCallResult(
  params: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const name = stringParam(params, 'name');
  if (name === 'sync_success') {
    return {
      resultType: 'complete',
      content: [{ type: 'text', text: 'sync complete' }],
      structuredContent: { status: 'sync_complete' },
      isError: false,
    };
  }
  if (name === 'rejected_without_task') {
    return {
      resultType: 'complete',
      content: [{ type: 'text', text: 'resource unavailable' }],
      structuredContent: {
        outcome: 'admission_rejected',
        reasonCode: 'RESOURCE_UNAVAILABLE',
        retryable: true,
      },
      isError: true,
    };
  }
  const task = {
    resultType: 'task',
    taskId: name === 'malformed_task_id' ? 'bad task id\r\nforged' : REMOTE_TASK_ID,
    status: name === 'unknown_task_status' ? 'paused' : 'working',
    createdAt: FIXED_CREATED_AT,
    lastUpdatedAt: FIXED_CREATED_AT,
    ttlMs: 3_600_000,
    pollIntervalMs: 50,
    _meta: {
      'io.sdar/taskExecution':
        name === 'malformed_task_metadata'
          ? { revision: '2.0', unexpected: true }
          : {
              revision: '1.0',
              remoteRevision: 'provider-revision-1',
              substate: 'queued',
              eventId: 'provider-event-1',
              observedAt: FIXED_CREATED_AT,
              progress: { percent: 0 },
            },
    },
    ...(name === 'unknown_task_field' ? { unexpectedExecutableField: 'reject-me' } : {}),
  };
  return task;
}

async function readJsonBody(
  request: NodeJS.ReadableStream,
  limit: number,
): Promise<Readonly<Record<string, unknown>>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error('Mock Provider request exceeds the byte limit.');
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!isRecord(parsed)) throw new Error('Mock Provider request must be a JSON object.');
  return parsed;
}

function normalizeHeaders(headers: IncomingHttpHeaders): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) => {
      if (value === undefined) return [];
      return [[name, Array.isArray(value) ? value.join(', ') : value]];
    }),
  );
}

function stringParam(params: Readonly<Record<string, unknown>>, name: string): string {
  const value = params[name];
  if (typeof value !== 'string') throw new Error(`Mock Provider parameter ${name} is required.`);
  return value;
}

function sendJson(
  response: ServerResponse,
  body: Readonly<Record<string, unknown>>,
  status = 200,
): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
