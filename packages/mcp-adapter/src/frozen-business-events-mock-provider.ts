import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { FROZEN_MCP_PROTOCOL_VERSION } from './frozen-v1-mcp-client.js';
import {
  BUSINESS_EVENTS_EXTENSION,
  BUSINESS_EVENTS_LISTEN_METHOD,
  BUSINESS_EVENTS_RELATION_METHOD,
} from './business-events-client.js';

const STREAM_ONE = '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001';
const STREAM_TWO = '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0002';
const EVENT_ID = 'nZ_hzhW-zrueWt69x9wP5gq-T_rLs_WgSgyTE7jER_o';
const PROJECTION_TOKEN = 'gBPxViIkwV7OC0RjF7VKaw';

export interface FrozenBusinessEventsMockOptions {
  readonly scenario?:
    | 'empty'
    | 'task_event'
    | 'resource_event'
    | 'closed_drain'
    | 'continuity'
    | 'stream_reset'
    | 'invalid_ack'
    | 'duplicate_event';
  readonly relationTaskIds?: readonly string[];
  readonly relationError?:
    | 'BUSINESS_EVENT_RELATION_CURSOR_EXPIRED'
    | 'BUSINESS_EVENT_AUTHORIZATION_MISMATCH'
    | 'BUSINESS_EVENT_STREAM_RESET'
    | 'BUSINESS_EVENT_NOT_FOUND'
    | 'BUSINESS_EVENT_RELATION_PROJECTION_STALE'
    | 'BUSINESS_EVENT_RETENTION_AUTHORITY_INVALID'
    | 'BUSINESS_EVENT_RELATION_CURSOR_INVALID';
}

export interface FrozenBusinessEventsMockHandle {
  readonly endpoint: URL;
  readonly requests: readonly Readonly<{
    method: string;
    headers: Readonly<Record<string, string>>;
    params: Readonly<Record<string, unknown>>;
  }>[];
  close(): Promise<void>;
}

export async function startFrozenBusinessEventsMockProvider(
  options: FrozenBusinessEventsMockOptions = {},
): Promise<FrozenBusinessEventsMockHandle> {
  const requests: {
    method: string;
    headers: Readonly<Record<string, string>>;
    params: Readonly<Record<string, unknown>>;
  }[] = [];
  const server = createServer((request, response) => {
    void handle(request, response, requests, options).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'unknown' }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('BUSINESS_EVENTS_MOCK_ADDRESS_UNAVAILABLE');
  }
  return {
    endpoint: new URL(`http://127.0.0.1:${String(address.port)}/mcp`),
    requests,
    close: () => closeServer(server),
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  requests: {
    method: string;
    headers: Readonly<Record<string, string>>;
    params: Readonly<Record<string, unknown>>;
  }[],
  options: FrozenBusinessEventsMockOptions,
): Promise<void> {
  const body = await readBody(request);
  const id = body['id'];
  const method = body['method'];
  const params = record(body['params']);
  const routingName = request.headers['mcp-name'];
  const headersValid =
    request.method === 'POST' &&
    request.headers['content-type']?.startsWith('application/json') === true &&
    request.headers.accept === 'application/json, text/event-stream' &&
    request.headers['mcp-protocol-version'] === FROZEN_MCP_PROTOCOL_VERSION &&
    typeof method === 'string' &&
    request.headers['mcp-method'] === method &&
    (method === BUSINESS_EVENTS_RELATION_METHOD
      ? routingName === params['eventId']
      : routingName === undefined);
  const businessMethod =
    method === BUSINESS_EVENTS_LISTEN_METHOD || method === BUSINESS_EVENTS_RELATION_METHOD;
  if (!headersValid || (businessMethod && !hasBusinessEventsCapability(params))) {
    sendError(
      response,
      id,
      -32001,
      'Frozen header/meta mismatch',
      {
        reasonCode: 'BUSINESS_EVENT_HEADER_MISMATCH',
        retryable: false,
        recoveryAction: 'Correct the frozen routing headers and client capability.',
      },
      400,
    );
    return;
  }
  requests.push({ method, headers: requestHeaders(request), params });
  if (method === 'server/discover') {
    sendResult(response, id, discovery());
    return;
  }
  if (method === 'tools/list') {
    sendResult(response, id, { tools: [] });
    return;
  }
  if (method === BUSINESS_EVENTS_LISTEN_METHOD) {
    if (options.scenario === 'stream_reset') {
      sendError(
        response,
        id,
        -32072,
        'Requested stream has rotated.',
        {
          reasonCode: 'BUSINESS_EVENT_STREAM_RESET',
          retryable: true,
          recoveryAction: 'Reconnect to currentStreamId with earliest_available.',
          currentStreamId: STREAM_TWO,
        },
        409,
      );
      return;
    }
    await sendStream(response, id, params, options.scenario ?? 'empty');
    return;
  }
  if (method === BUSINESS_EVENTS_RELATION_METHOD) {
    if (options.relationError !== undefined) {
      sendError(
        response,
        id,
        -32073,
        'Relation projection is unavailable.',
        {
          reasonCode: options.relationError,
          retryable: options.relationError === 'BUSINESS_EVENT_STREAM_RESET',
          recoveryAction: 'Reconcile the stream and fetch a new immutable projection.',
        },
        409,
      );
      return;
    }
    sendResult(response, id, relationPage(params, options.relationTaskIds ?? ['task-001']));
    return;
  }
  sendError(
    response,
    id,
    -32601,
    'Unsupported method',
    {
      reasonCode: 'BUSINESS_EVENT_METHOD_NOT_FOUND',
      retryable: false,
      recoveryAction: 'Use the frozen Business Events methods.',
    },
    404,
  );
}

function discovery(): unknown {
  return {
    resultType: 'complete',
    supportedVersions: [FROZEN_MCP_PROTOCOL_VERSION],
    capabilities: {
      extensions: {
        'io.modelcontextprotocol/tasks': {},
        'io.sdar/taskExecution': { profileVersion: '1.0', taskNotifications: true },
        [BUSINESS_EVENTS_EXTENSION]: {
          profileVersion: '1.0',
          delivery: 'post_sse',
          scopes: ['task', 'resource'],
          resumeMode: 'stream_sequence',
          maxRelatedTaskIds: 256,
          retentionMs: 604_800_000,
          authorizationModel: 'subscription_snapshot_projection',
          relationOverflow: 'paged_query',
          streamCancellation: 'connection_close',
          continuityClass: 'all_durable',
          sources: [{ sourceId: 'adapter.vehicle', deliverySemantics: 'durable_at_least_once' }],
        },
      },
    },
    _meta: {
      'io.modelcontextprotocol/serverInfo': {
        name: 'sdar-frozen-business-events-mock',
        version: '1.0.0',
      },
    },
  };
}

async function sendStream(
  response: ServerResponse,
  requestId: unknown,
  params: Readonly<Record<string, unknown>>,
  scenario: NonNullable<FrozenBusinessEventsMockOptions['scenario']>,
): Promise<void> {
  const cursor = record(params['cursor']);
  const afterSequence = typeof cursor['afterSequence'] === 'string' ? cursor['afterSequence'] : '0';
  const closed = scenario === 'closed_drain' || scenario === 'continuity';
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'close',
  });
  if (scenario === 'invalid_ack') {
    await writeSse(response, { jsonrpc: '2.0', id: requestId, result: {} });
    response.end();
    return;
  }
  await writeSse(response, {
    jsonrpc: '2.0',
    method: 'notifications/io.sdar/businessEvents/acknowledged',
    params: {
      profileVersion: '1.0',
      streamId: STREAM_ONE,
      generationStatus: closed ? 'replayable_closed' : 'current',
      acceptedAfterSequence: afterSequence,
      earliestAvailableSequence: '1',
      currentSequence: scenario === 'empty' ? '0' : scenario === 'duplicate_event' ? '2' : '1',
      sourceContinuity: {
        continuityClass: 'all_durable',
        status: 'continuous',
        continuousSinceSequence: '1',
        degradedSourceIds: closed ? ['adapter.vehicle'] : [],
      },
      _meta: { 'io.modelcontextprotocol/subscriptionId': requestId },
    },
  });
  if (scenario === 'task_event' || scenario === 'closed_drain' || scenario === 'duplicate_event') {
    await writeSse(response, taskEvent(requestId, '1'));
    if (scenario === 'duplicate_event') await writeSse(response, taskEvent(requestId, '1'));
  }
  if (scenario === 'resource_event') await writeSse(response, resourceEvent(requestId));
  if (scenario === 'continuity') {
    await writeSse(response, taskEvent(requestId, '1'));
    await writeSse(response, {
      jsonrpc: '2.0',
      method: 'notifications/io.sdar/businessEvents/continuity',
      params: {
        profileVersion: '1.0',
        previousStreamId: STREAM_ONE,
        newStreamId: STREAM_TWO,
        reasonCode: 'SOURCE_CURSOR_EXPIRED',
        affectedSourceIds: ['adapter.vehicle'],
        gapDetectedAt: '2026-07-22T01:00:00Z',
        lastReplayableSequence: '1',
        lastContinuousSequence: '1',
        _meta: { 'io.modelcontextprotocol/subscriptionId': requestId },
      },
    });
  }
  response.end();
}

function taskEvent(subscription: unknown, eventSequence: string): unknown {
  return {
    jsonrpc: '2.0',
    method: 'notifications/io.sdar/businessEvents',
    params: {
      streamId: STREAM_ONE,
      eventId: EVENT_ID,
      sequence: eventSequence,
      sourceId: 'adapter.vehicle',
      eventType: 'vehicle.connectivity.lost',
      occurredAt: '2026-07-22T01:00:00Z',
      scope: 'task',
      description: 'Vehicle connection was lost.',
      taskId: 'task-42',
      _meta: {
        'io.modelcontextprotocol/subscriptionId': subscription,
        [BUSINESS_EVENTS_EXTENSION]: { profileVersion: '1.0' },
      },
    },
  };
}

function resourceEvent(subscription: unknown): unknown {
  return {
    jsonrpc: '2.0',
    method: 'notifications/io.sdar/businessEvents',
    params: {
      streamId: STREAM_ONE,
      eventId: EVENT_ID,
      sequence: '1',
      sourceId: 'adapter.vehicle',
      eventType: 'vehicle.battery.low',
      occurredAt: '2026-07-22T01:00:00Z',
      scope: 'resource',
      description: 'Battery is low.',
      resourceRef: 'vehicle:42',
      relatedTaskIds: ['task-1'],
      relatedTaskCount: 300,
      relationTruncated: true,
      _meta: {
        'io.modelcontextprotocol/subscriptionId': subscription,
        [BUSINESS_EVENTS_EXTENSION]: { profileVersion: '1.0' },
      },
    },
  };
}

function relationPage(
  params: Readonly<Record<string, unknown>>,
  allIds: readonly string[],
): unknown {
  const sorted = [...new Set(allIds)].sort();
  const after = params['afterTaskId'];
  const start = typeof after === 'string' ? sorted.findIndex((item) => item === after) + 1 : 0;
  const limit =
    typeof params['limit'] === 'number' ? Math.max(1, Math.min(256, params['limit'])) : 256;
  const items = sorted.slice(start, start + limit);
  const last = items.at(-1);
  const more = start + items.length < sorted.length;
  return {
    resultType: 'complete',
    streamId: params['streamId'],
    eventId: params['eventId'],
    projectionToken: PROJECTION_TOKEN,
    items,
    total: sorted.length,
    ...(more && last !== undefined ? { nextAfterTaskId: last } : {}),
  };
}

function hasBusinessEventsCapability(params: Readonly<Record<string, unknown>>): boolean {
  const meta = record(params['_meta']);
  const capabilities = record(meta['io.modelcontextprotocol/clientCapabilities']);
  const extensions = record(capabilities['extensions']);
  return record(extensions[BUSINESS_EVENTS_EXTENSION])['profileVersion'] === '1.0';
}

async function readBody(request: IncomingMessage): Promise<Readonly<Record<string, unknown>>> {
  let raw = '';
  for await (const chunk of request) raw += String(chunk);
  return record(JSON.parse(raw) as unknown);
}

async function writeSse(response: ServerResponse, message: unknown): Promise<void> {
  if (!response.write(`data: ${JSON.stringify(message)}\n\n`)) await once(response, 'drain');
}

function sendResult(response: ServerResponse, id: unknown, result: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function sendError(
  response: ServerResponse,
  id: unknown,
  code: number,
  message: string,
  data: Readonly<Record<string, unknown>>,
  statusCode: number,
): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, data } }));
}

function requestHeaders(request: IncomingMessage): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(request.headers).flatMap(([name, value]) =>
        typeof value === 'string' ? [[name, value]] : [],
      ),
    ),
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}
