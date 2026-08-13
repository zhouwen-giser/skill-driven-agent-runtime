import { z } from 'zod';

import type { McpProtocolDiscoverySnapshot } from '../../domain/src/index.js';

export const FROZEN_MCP_PROTOCOL_VERSION = '2026-07-28' as const;
export const FROZEN_MCP_TASKS_EXTENSION = 'io.modelcontextprotocol/tasks' as const;
const MAX_SSE_PENDING_BYTES = 1_048_576;

export type FrozenMcpMethod =
  | 'server/discover'
  | 'tools/list'
  | 'tools/call'
  | 'tasks/get'
  | 'tasks/update'
  | 'tasks/cancel'
  | 'io.sdar/taskExecution/checkAvailability'
  | 'subscriptions/listen';

export interface FrozenMcpRequestInput {
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: FrozenMcpMethod;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal | undefined;
}

type FrozenFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const JsonRpcEnvelopeSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]),
    result: z.unknown().optional(),
    error: z
      .object({ code: z.number().int(), message: z.string(), data: z.unknown().optional() })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => (value.result === undefined) !== (value.error === undefined));

const DiscoverySchema = z
  .object({
    resultType: z.literal('complete'),
    supportedVersions: z.array(z.string()).min(1),
    capabilities: z
      .object({
        extensions: z
          .object({
            [FROZEN_MCP_TASKS_EXTENSION]: z.record(z.string(), z.unknown()),
            'io.sdar/taskExecution': z
              .object({ profileVersion: z.literal('1.0'), taskNotifications: z.literal(true) })
              .strict(),
          })
          .catchall(z.unknown()),
      })
      .catchall(z.unknown()),
    _meta: z
      .object({
        'io.modelcontextprotocol/serverInfo': z
          .object({ name: z.string().min(1).max(128), version: z.string().min(1).max(128) })
          .strict(),
      })
      .catchall(z.unknown()),
    instructions: z.string().max(8192).optional(),
    ttlMs: z.number().int().nonnegative().optional(),
    cacheScope: z.string().optional(),
  })
  .strict();

export class FrozenV1McpClient {
  readonly #fetch: FrozenFetch;
  #requestSequence = 0;

  constructor(fetchImplementation: FrozenFetch = globalThis.fetch) {
    this.#fetch = fetchImplementation;
  }

  async request(input: FrozenMcpRequestInput): Promise<unknown> {
    const id = ++this.#requestSequence;
    const name = routingName(input.method, input.params);
    const headers = {
      ...input.headers,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': FROZEN_MCP_PROTOCOL_VERSION,
      'Mcp-Method': input.method,
      ...(name === undefined ? {} : { 'Mcp-Name': name }),
    };
    const priorMeta = isRecord(input.params?.['_meta']) ? input.params['_meta'] : {};
    const body = {
      jsonrpc: '2.0',
      id,
      method: input.method,
      params: {
        ...(input.params ?? {}),
        _meta: {
          ...priorMeta,
          'io.modelcontextprotocol/protocolVersion': FROZEN_MCP_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'sdar', version: '1.2.1' },
          'io.modelcontextprotocol/clientCapabilities': {
            extensions: { [FROZEN_MCP_TASKS_EXTENSION]: {} },
          },
        },
      },
    };
    let response: Response;
    try {
      response = await this.#fetch(input.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        redirect: 'manual',
      });
    } catch (error: unknown) {
      throw new FrozenMcpProtocolError(
        'FROZEN_MCP_TRANSPORT_FAILED',
        'Frozen MCP request failed before a protocol response was received.',
        { cause: error },
      );
    }
    if (!response.ok)
      throw new FrozenMcpProtocolError(
        'FROZEN_MCP_HTTP_STATUS_INVALID',
        `Frozen MCP endpoint returned HTTP ${String(response.status)}.`,
      );
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const raw = contentType.includes('text/event-stream')
      ? parseFirstSseMessage(await response.text())
      : contentType.includes('application/json')
        ? await response.json()
        : invalidResponse('Frozen MCP response Content-Type is unsupported.');
    const parsed = JsonRpcEnvelopeSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== id)
      throw new FrozenMcpProtocolError(
        'FROZEN_MCP_RESPONSE_INVALID',
        'Frozen MCP response violates the JSON-RPC envelope or request correlation.',
      );
    if (parsed.data.error !== undefined) throw normalizeFrozenRpcError(parsed.data.error);
    return parsed.data.result;
  }

  async listenToTaskNotifications(
    input: Omit<FrozenMcpRequestInput, 'method' | 'params'> &
      Readonly<{ taskIds: readonly string[] }>,
  ): Promise<Readonly<{ requestId: number; messages: AsyncIterable<unknown> }>> {
    const uniqueTaskIds = [...new Set(input.taskIds)].sort();
    if (uniqueTaskIds.length > 256 || uniqueTaskIds.some((value) => value.trim() === ''))
      throw new FrozenMcpProtocolError(
        'FROZEN_MCP_PARAMS_INVALID',
        'Task Notification subscription requires at most 256 non-empty unique Task IDs.',
        { rpcCode: -32602 },
      );
    const id = ++this.#requestSequence;
    const body = {
      jsonrpc: '2.0',
      id,
      method: 'subscriptions/listen',
      params: {
        notifications: { taskIds: uniqueTaskIds },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': FROZEN_MCP_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'sdar', version: '1.2.1' },
          'io.modelcontextprotocol/clientCapabilities': {
            extensions: { [FROZEN_MCP_TASKS_EXTENSION]: {} },
          },
        },
      },
    };
    let response: Response;
    try {
      response = await this.#fetch(input.endpoint, {
        method: 'POST',
        headers: {
          ...input.headers,
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': FROZEN_MCP_PROTOCOL_VERSION,
          'Mcp-Method': 'subscriptions/listen',
        },
        body: JSON.stringify(body),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        redirect: 'manual',
      });
    } catch (error: unknown) {
      throw new FrozenMcpProtocolError(
        'FROZEN_MCP_TRANSPORT_FAILED',
        'Frozen Task Notification stream failed to open.',
        { cause: error },
      );
    }
    if (
      !response.ok ||
      !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')
    )
      throw new FrozenMcpProtocolError(
        'FROZEN_MCP_RESPONSE_INVALID',
        'Frozen Task Notification response must be a successful SSE stream.',
      );
    if (response.body === null)
      throw new FrozenMcpProtocolError(
        'FROZEN_MCP_RESPONSE_INVALID',
        'Frozen Task Notification SSE response has no body.',
      );
    return Object.freeze({ requestId: id, messages: parseSseMessages(response.body) });
  }

  async discover(
    input: Omit<FrozenMcpRequestInput, 'method' | 'params'>,
  ): Promise<z.output<typeof DiscoverySchema>> {
    const parsed = DiscoverySchema.safeParse(
      await this.request({ ...input, method: 'server/discover', params: {} }),
    );
    if (!parsed.success || !parsed.data.supportedVersions.includes(FROZEN_MCP_PROTOCOL_VERSION))
      throw new FrozenMcpProtocolError(
        'FROZEN_MCP_DISCOVERY_INVALID',
        'Frozen MCP discovery is missing required version, capabilities or Server metadata.',
      );
    return parsed.data;
  }

  async discoverSnapshot(
    input: Omit<FrozenMcpRequestInput, 'method' | 'params'> &
      Readonly<{
        snapshotId: string;
        serverId: string;
        baselineSha256: string;
        discoveredAt: string;
        toolRevision: number;
      }>,
  ): Promise<McpProtocolDiscoverySnapshot> {
    const discovery = await this.discover(input);
    const taskProfile = discovery.capabilities.extensions['io.sdar/taskExecution'];
    return Object.freeze({
      snapshotId: input.snapshotId,
      serverId: input.serverId,
      protocolMode: 'frozen_v1',
      protocolVersion: FROZEN_MCP_PROTOCOL_VERSION,
      baselineSha256: input.baselineSha256,
      supportedVersions: Object.freeze([...discovery.supportedVersions]),
      capabilities: Object.freeze({ ...discovery.capabilities }),
      serverInfo: Object.freeze({
        ...discovery._meta['io.modelcontextprotocol/serverInfo'],
      }),
      taskNotifications: taskProfile.taskNotifications,
      discoveredAt: input.discoveredAt,
      ...(discovery.ttlMs === undefined
        ? {}
        : { validUntil: new Date(Date.parse(input.discoveredAt) + discovery.ttlMs).toISOString() }),
      toolRevision: input.toolRevision,
    });
  }
}

export type FrozenMcpProtocolErrorCode =
  | 'FROZEN_MCP_TRANSPORT_FAILED'
  | 'FROZEN_MCP_HTTP_STATUS_INVALID'
  | 'FROZEN_MCP_RESPONSE_INVALID'
  | 'FROZEN_MCP_DISCOVERY_INVALID'
  | 'FROZEN_MCP_HEADER_MISMATCH'
  | 'FROZEN_MCP_CAPABILITY_REQUIRED'
  | 'FROZEN_MCP_VERSION_UNSUPPORTED'
  | 'FROZEN_MCP_METHOD_NOT_FOUND'
  | 'FROZEN_MCP_PARAMS_INVALID'
  | 'FROZEN_MCP_SSE_BUFFER_OVERFLOW'
  | 'FROZEN_MCP_PROVIDER_ERROR';

export class FrozenMcpProtocolError extends Error {
  readonly code: FrozenMcpProtocolErrorCode;
  readonly rpcCode?: number | undefined;
  constructor(
    code: FrozenMcpProtocolErrorCode,
    message: string,
    options: ErrorOptions & Readonly<{ rpcCode?: number }> = {},
  ) {
    super(message, options);
    this.name = 'FrozenMcpProtocolError';
    this.code = code;
    this.rpcCode = options.rpcCode;
  }
}

function routingName(
  method: FrozenMcpMethod,
  params: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const field =
    method === 'tools/call' ? 'name' : method.startsWith('tasks/') ? 'taskId' : undefined;
  if (field === undefined) return undefined;
  const value = params?.[field];
  if (typeof value !== 'string' || value.trim() === '')
    throw new FrozenMcpProtocolError(
      'FROZEN_MCP_PARAMS_INVALID',
      `${method} requires a non-empty ${field}.`,
      { rpcCode: -32602 },
    );
  return value;
}

function parseFirstSseMessage(value: string): unknown {
  for (const event of value.split(/\r?\n\r?\n/u)) {
    const data = event
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data === '') continue;
    try {
      return JSON.parse(data) as unknown;
    } catch {
      break;
    }
  }
  return invalidResponse('Frozen MCP SSE response contains no valid JSON-RPC message.');
}

async function* parseSseMessages(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > MAX_SSE_PENDING_BYTES)
        throw new FrozenMcpProtocolError(
          'FROZEN_MCP_SSE_BUFFER_OVERFLOW',
          'Frozen Task Notification SSE event exceeded the bounded receive buffer.',
        );
      const events = pending.split(/\r?\n\r?\n/u);
      pending = events.pop() ?? '';
      for (const event of events) yield parseFirstSseMessage(`${event}\n\n`);
    }
    pending += decoder.decode();
    if (pending.trim() !== '') yield parseFirstSseMessage(`${pending}\n\n`);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function invalidResponse(message: string): never {
  throw new FrozenMcpProtocolError('FROZEN_MCP_RESPONSE_INVALID', message);
}

function normalizeFrozenRpcError(error: Readonly<{ code: number; message: string }>): Error {
  const code =
    error.code === -32001
      ? 'FROZEN_MCP_HEADER_MISMATCH'
      : error.code === -32003
        ? 'FROZEN_MCP_CAPABILITY_REQUIRED'
        : error.code === -32004
          ? 'FROZEN_MCP_VERSION_UNSUPPORTED'
          : error.code === -32601
            ? 'FROZEN_MCP_METHOD_NOT_FOUND'
            : error.code === -32602
              ? 'FROZEN_MCP_PARAMS_INVALID'
              : 'FROZEN_MCP_PROVIDER_ERROR';
  return new FrozenMcpProtocolError(code, error.message, { rpcCode: error.code });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
