import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { FROZEN_MCP_PROTOCOL_VERSION } from './frozen-v1-mcp-client.js';

const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';
const TASK_PROFILE = 'io.sdar/taskExecution';

export interface FrozenMcpTasksMockProviderHandle {
  readonly endpoint: URL;
  readonly requests: readonly Readonly<{
    method: string;
    params: Readonly<Record<string, unknown>>;
    headers: Readonly<Record<string, string>>;
  }>[];
  readonly toolCallCount: number;
  readonly notificationOverflowCount: number;
  close(): Promise<void>;
}

export interface FrozenMcpTasksMockProviderOptions {
  readonly outcome?: 'immediate_success' | 'task_success' | 'input_required' | 'cancelled';
  readonly availability?: 'available' | 'restricted' | 'disabled';
  readonly moveTo?: Readonly<{
    outcome:
      | 'immediate_success'
      | 'remote_success'
      | 'remote_notification_success'
      | 'remote_restart_success'
      | 'remote_missing_evidence'
      | 'remote_input_required'
      | 'remote_cancelled';
    availability?: 'available' | 'restricted' | 'disabled';
  }>;
  readonly areaPatrol?: Readonly<{
    outcome: 'remote_success' | 'remote_degraded' | 'remote_missing_evidence';
    availability?: 'available' | 'restricted' | 'disabled';
  }>;
  readonly notificationQueueLimit?: number;
  readonly notificationBurst?: number;
  readonly createdAt?: string;
}

interface FrozenMockState {
  revision: number;
  toolCalls: number;
  updated: boolean;
  cancelled: boolean;
  resourceId?: string;
  target?: Readonly<{ x: number; y: number; frame?: string }>;
  operationName?: string;
  includeEvidence: boolean;
  degraded: boolean;
  taskSequence: number;
  taskGetCalls: number;
  taskId: string;
  notificationOverflowCount: number;
  createdAt: string;
}

export async function startFrozenMcpTasksMockProvider(
  options: FrozenMcpTasksMockProviderOptions = {},
): Promise<FrozenMcpTasksMockProviderHandle> {
  const requests: {
    method: string;
    params: Readonly<Record<string, unknown>>;
    headers: Readonly<Record<string, string>>;
  }[] = [];
  const state: FrozenMockState = {
    revision: 1,
    toolCalls: 0,
    updated: false,
    cancelled: false,
    includeEvidence: true,
    degraded: false,
    taskSequence: 0,
    taskGetCalls: 0,
    taskId: 'frozen-task-1',
    notificationOverflowCount: 0,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
  const server = createServer((request, response) => {
    void handle(request, response, options, state, requests);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Frozen MCP Tasks Mock Provider did not bind a TCP port.');
  }
  return {
    endpoint: new URL(`http://127.0.0.1:${String(address.port)}/mcp`),
    requests,
    get toolCallCount() {
      return state.toolCalls;
    },
    get notificationOverflowCount() {
      return state.notificationOverflowCount;
    },
    close: () => closeServer(server),
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: FrozenMcpTasksMockProviderOptions,
  state: FrozenMockState,
  requests: {
    method: string;
    params: Readonly<Record<string, unknown>>;
    headers: Readonly<Record<string, string>>;
  }[],
): Promise<void> {
  const body = await readBody(request);
  const id = body['id'];
  const method = body['method'];
  const params = record(body['params']);
  if (
    request.method !== 'POST' ||
    request.headers['mcp-protocol-version'] !== FROZEN_MCP_PROTOCOL_VERSION ||
    typeof method !== 'string' ||
    request.headers['mcp-method'] !== method ||
    !validRequestMeta(params['_meta'])
  ) {
    send(response, {
      jsonrpc: '2.0',
      id,
      error: { code: -32001, message: 'Frozen header/meta mismatch' },
    });
    return;
  }
  requests.push({ method, params, headers: headers(request) });
  if (method === 'subscriptions/listen') {
    sendSubscription(response, id, params, state, options);
    return;
  }
  try {
    send(response, { jsonrpc: '2.0', id, result: result(method, params, options, state) });
  } catch (error: unknown) {
    send(response, {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: error instanceof Error ? error.message : 'unsupported' },
    });
  }
}

function result(
  method: string,
  params: Readonly<Record<string, unknown>>,
  options: FrozenMcpTasksMockProviderOptions,
  state: FrozenMockState,
): unknown {
  switch (method) {
    case 'server/discover':
      return {
        resultType: 'complete',
        supportedVersions: [FROZEN_MCP_PROTOCOL_VERSION],
        capabilities: {
          extensions: {
            [TASKS_EXTENSION]: {},
            [TASK_PROFILE]: { profileVersion: '1.0', taskNotifications: true },
          },
        },
        _meta: {
          'io.modelcontextprotocol/serverInfo': { name: 'sdar-frozen-mock', version: '1.0.0' },
        },
        ttlMs: 60_000,
      };
    case 'tools/list':
      return {
        tools: frozenTools(options),
      };
    case 'io.sdar/taskExecution/checkAvailability': {
      const checks = Array.isArray(params['checks']) ? params['checks'] : [];
      return {
        resultType: 'complete',
        profileVersion: '1.0',
        results: checks.map((check) => {
          const item = record(check);
          return {
            requestId: item['requestId'],
            operationName: item['operationName'],
            availability: operationAvailability(options, String(item['operationName'])),
            riskLevel:
              operationAvailability(options, String(item['operationName'])) === 'restricted'
                ? 'high'
                : 'low',
            reservationMode: 'none',
            ...(operationAvailability(options, String(item['operationName'])) === 'restricted'
              ? {
                  reasonCode: 'OPERATOR_APPROVAL_REQUIRED',
                  validUntil: timestampAfter(state.createdAt, 60 * 60 * 1_000),
                  earliestStartTime: timestampAfter(state.createdAt, 5 * 60 * 1_000),
                  nextAvailableWindows: [
                    {
                      startTime: timestampAfter(state.createdAt, 5 * 60 * 1_000),
                      endTime: timestampAfter(state.createdAt, 60 * 60 * 1_000),
                    },
                  ],
                  possibleEffects: ['start_rejection'],
                }
              : {}),
          };
        }),
      };
    }
    case 'tools/call': {
      state.toolCalls += 1;
      const operationName = String(params['name']);
      const arguments_ = record(params['arguments']);
      const target = record(arguments_['target']);
      if (typeof arguments_['resourceId'] === 'string') state.resourceId = arguments_['resourceId'];
      if (typeof target['x'] === 'number' && typeof target['y'] === 'number') {
        state.target = {
          x: target['x'],
          y: target['y'],
          ...(typeof target['frame'] === 'string' ? { frame: target['frame'] } : {}),
        };
      }
      state.operationName = operationName;
      state.updated = false;
      state.cancelled = false;
      const outcome = operationOutcome(options, operationName);
      state.includeEvidence = outcome !== 'remote_missing_evidence';
      state.degraded = outcome === 'remote_degraded';
      if (operationName === 'embodied.inspect_area') return inspectionResult();
      if (outcome === 'immediate_success') return toolResult(state);
      state.taskSequence += 1;
      state.taskGetCalls = 0;
      state.taskId = `frozen-task-${String(state.taskSequence)}`;
      return task('task', 'working', state);
    }
    case 'tasks/get': {
      state.taskGetCalls += 1;
      state.revision += 1;
      const outcome = operationOutcome(options, state.operationName ?? 'embodied.move');
      if (state.cancelled || outcome === 'remote_cancelled')
        return task('complete', 'cancelled', state);
      if (outcome === 'remote_input_required' && !state.updated)
        return task('complete', 'input_required', state);
      if (outcome === 'remote_notification_success') return task('complete', 'working', state);
      if (outcome === 'remote_restart_success' && state.taskGetCalls <= 2)
        return task('complete', 'working', state);
      return task('complete', 'completed', state);
    }
    case 'tasks/update':
      state.updated = true;
      state.revision += 1;
      return { resultType: 'complete' };
    case 'tasks/cancel':
      state.cancelled = true;
      state.revision += 1;
      return { resultType: 'complete' };
    default:
      throw new Error(`Unsupported Frozen Mock Provider method ${method}.`);
  }
}

function task(
  resultType: 'task' | 'complete',
  status: 'working' | 'input_required' | 'completed' | 'cancelled',
  state: FrozenMockState,
): Readonly<Record<string, unknown>> {
  return {
    resultType,
    taskId: state.taskId,
    status,
    createdAt: state.createdAt,
    lastUpdatedAt: observedAt(state),
    ttlMs: 3_600_000,
    pollIntervalMs: 250,
    _meta: {
      [TASK_PROFILE]: {
        profileVersion: '1.0',
        runtimeRevision: String(state.revision),
        providerRevision: `provider-${String(state.revision)}`,
        observedAt: observedAt(state),
      },
    },
    ...(status === 'input_required'
      ? {
          inputRequests: {
            approval: {
              method: 'elicitation/create',
              params: { mode: 'form', message: 'Approve?' },
            },
          },
        }
      : {}),
    ...(status === 'completed' ? { result: toolResult(state) } : {}),
  };
}

function toolResult(state: FrozenMockState) {
  if (state.operationName === 'embodied.area_patrol') return patrolResult(state);
  return {
    resultType: 'complete',
    content: [{ type: 'text', text: 'move completed' }],
    structuredContent: {
      resourceId: state.resourceId ?? 'UGV-001',
      status: 'completed',
      finalPosition: state.target ?? { x: 12, y: 8, frame: 'map' },
    },
    isError: false,
    ...(state.includeEvidence
      ? { _meta: evidenceMeta([['position.observation', '/finalPosition']], observedAt(state)) }
      : {}),
  };
}

function patrolResult(state: FrozenMockState) {
  return {
    resultType: 'complete',
    content: [{ type: 'text', text: 'area patrol completed' }],
    structuredContent: {
      status: state.degraded ? 'degraded' : 'completed',
      coveredSubregions: ['subregion-1'],
      missingSubregions: state.degraded ? ['subregion-2'] : [],
      trajectory: [
        { resourceId: state.resourceId ?? 'UGV-001', position: state.target ?? { x: 0, y: 0 } },
      ],
      anomalies: [],
      ...(state.degraded
        ? {
            missingEffects: ['subregion-2 inspection'],
            missingEvidence: ['subregion-2 coverage'],
          }
        : {}),
    },
    isError: false,
    ...(state.includeEvidence
      ? {
          _meta: evidenceMeta(
            [
              ['patrol.coverage', '/coveredSubregions'],
              ['patrol.trajectory', '/trajectory'],
              ['patrol.anomalies', '/anomalies'],
            ],
            observedAt(state),
          ),
        }
      : {}),
  };
}

function inspectionResult() {
  return {
    resultType: 'complete',
    content: [{ type: 'text', text: 'area inspection completed' }],
    structuredContent: { anomalies: [] },
    isError: false,
  };
}

function evidenceMeta(items: readonly (readonly [string, string])[], timestamp: string) {
  return {
    'io.sdar/evidence': {
      profileVersion: '1.0',
      items: items.map(([evidenceType, jsonPointer]) => ({
        evidenceId: evidenceRequirementId(evidenceType),
        evidenceType,
        observedAt: timestamp,
        producer: ['provider:sdar-frozen-mock'],
        payloadRef: { kind: 'structured_content', jsonPointer },
      })),
    },
  };
}

function observedAt(state: FrozenMockState): string {
  return timestampAfter(state.createdAt, state.revision * 1_000);
}

function timestampAfter(timestamp: string, offsetMs: number): string {
  return new Date(Date.parse(timestamp) + offsetMs).toISOString();
}

function evidenceRequirementId(evidenceType: string): string {
  return (
    {
      'position.observation': 'final-position',
      'patrol.coverage': 'coverage-report',
      'patrol.trajectory': 'trajectory',
      'patrol.anomalies': 'anomaly-report',
    }[evidenceType] ?? evidenceType
  );
}

function frozenTools(options: FrozenMcpTasksMockProviderOptions) {
  const taskProfile = {
    profileVersion: '1.0',
    taskBehavior: 'server_directed',
    availability: 'dynamic',
    supportsScheduling: true,
    supportsMaxElapsed: true,
    supportsObservations: true,
    supportsInputRequired: true,
    idempotency: 'client_request_key',
  };
  return [
    {
      name: 'embodied.move',
      description: 'Move one embodied resource.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['resourceId', 'target'],
        properties: {
          resourceId: { type: 'string' },
          target: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              frame: { type: 'string' },
            },
          },
        },
      },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['resourceId', 'status', 'finalPosition'],
        properties: {
          resourceId: { type: 'string' },
          status: { enum: ['completed', 'failed', 'cancelled', 'uncertain'] },
          finalPosition: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              frame: { type: 'string' },
            },
          },
        },
      },
      _meta: { [TASK_PROFILE]: taskProfile },
    },
    ...(options.areaPatrol === undefined
      ? []
      : [
          {
            name: 'embodied.area_patrol',
            description: 'Patrol an admitted area.',
            inputSchema: {
              type: 'object',
              required: ['resourceId', 'target', 'area', 'timeWindow'],
              properties: {
                resourceId: { type: 'string' },
                target: { type: 'object' },
                area: { type: 'object' },
                timeWindow: { type: 'object' },
              },
            },
            outputSchema: {
              type: 'object',
              required: [
                'status',
                'coveredSubregions',
                'missingSubregions',
                'trajectory',
                'anomalies',
              ],
              properties: {
                status: { enum: ['completed', 'degraded', 'failed', 'cancelled'] },
                coveredSubregions: { type: 'array', items: { type: 'string' } },
                missingSubregions: { type: 'array', items: { type: 'string' } },
                trajectory: { type: 'array', items: { type: 'object' } },
                anomalies: { type: 'array', items: { type: 'object' } },
                missingEffects: { type: 'array', items: { type: 'string' } },
                missingEvidence: { type: 'array', items: { type: 'string' } },
              },
            },
            _meta: { [TASK_PROFILE]: taskProfile },
          },
          {
            name: 'embodied.inspect_area',
            description: 'Inspect an admitted patrol area.',
            inputSchema: {
              type: 'object',
              required: ['area'],
              properties: { area: { type: 'object' } },
            },
            outputSchema: {
              type: 'object',
              required: ['anomalies'],
              properties: { anomalies: { type: 'array', items: { type: 'object' } } },
            },
            _meta: { [TASK_PROFILE]: taskProfile },
          },
        ]),
  ];
}

function operationAvailability(
  options: FrozenMcpTasksMockProviderOptions,
  operationName: string,
): 'available' | 'restricted' | 'disabled' {
  if (operationName === 'embodied.area_patrol')
    return options.areaPatrol?.availability ?? options.availability ?? 'available';
  return options.moveTo?.availability ?? options.availability ?? 'available';
}

function operationOutcome(
  options: FrozenMcpTasksMockProviderOptions,
  operationName: string,
):
  | 'immediate_success'
  | 'remote_success'
  | 'remote_notification_success'
  | 'remote_restart_success'
  | 'remote_degraded'
  | 'remote_missing_evidence'
  | 'remote_input_required'
  | 'remote_cancelled' {
  if (operationName === 'embodied.area_patrol')
    return options.areaPatrol?.outcome ?? 'remote_success';
  if (options.moveTo !== undefined) return options.moveTo.outcome;
  switch (options.outcome ?? 'task_success') {
    case 'immediate_success':
      return 'immediate_success';
    case 'input_required':
      return 'remote_input_required';
    case 'cancelled':
      return 'remote_cancelled';
    case 'task_success':
      return 'remote_success';
  }
}

function sendSubscription(
  response: ServerResponse,
  id: unknown,
  params: Readonly<Record<string, unknown>>,
  state: FrozenMockState,
  options: FrozenMcpTasksMockProviderOptions,
): void {
  const notifications = record(params['notifications']);
  const requested = Array.isArray(notifications['taskIds'])
    ? notifications['taskIds'].filter((value): value is string => typeof value === 'string')
    : [];
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write(
    `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged', params: { _meta: { 'io.modelcontextprotocol/subscriptionId': id }, notifications: { taskIds: requested } } })}\n\n`,
  );
  setTimeout(() => {
    if (response.destroyed) return;
    // Re-authorize at send time: a Task created after the Ack must never leak
    // into an earlier subscription, even if Provider state changed meanwhile.
    if (requested.includes(state.taskId)) {
      const outcome = operationOutcome(options, state.operationName ?? 'embodied.move');
      // Restart acceptance is intentionally poll-driven. An Ack-only stream proves the
      // subscription without allowing the local mock to complete the Task pre-restart.
      if (outcome === 'remote_restart_success') {
        response.end();
        return;
      }
      const pending: string[] = [];
      const queueLimit = boundedPositiveInteger(options.notificationQueueLimit, 256);
      const burst = boundedPositiveInteger(options.notificationBurst, 1);
      for (let index = 0; index < burst; index += 1) {
        if (pending.length >= queueLimit) {
          state.notificationOverflowCount += 1;
          response.destroy(new Error('FROZEN_MCP_NOTIFICATION_QUEUE_OVERFLOW'));
          return;
        }
        state.revision += 1;
        const status = state.cancelled
          ? 'cancelled'
          : outcome === 'remote_input_required' && !state.updated
            ? 'input_required'
            : 'completed';
        const snapshot = task('complete', status, state);
        pending.push(
          `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tasks', params: { ...snapshot, _meta: { ...record(snapshot['_meta']), 'io.modelcontextprotocol/subscriptionId': id } } })}\n\n`,
        );
      }
      for (const event of pending) response.write(event);
    }
    response.end();
  }, 25);
}

function boundedPositiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isSafeInteger(value) || value < 1 ? fallback : value;
}

function validRequestMeta(value: unknown): boolean {
  const meta = record(value);
  const info = record(meta['io.modelcontextprotocol/clientInfo']);
  const capabilities = record(meta['io.modelcontextprotocol/clientCapabilities']);
  const extensions = record(capabilities['extensions']);
  return (
    meta['io.modelcontextprotocol/protocolVersion'] === FROZEN_MCP_PROTOCOL_VERSION &&
    typeof info['name'] === 'string' &&
    Object.hasOwn(extensions, TASKS_EXTENSION)
  );
}

async function readBody(request: IncomingMessage): Promise<Readonly<Record<string, unknown>>> {
  let raw = '';
  for await (const chunk of request) raw += String(chunk);
  return record(JSON.parse(raw) as unknown);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function headers(request: IncomingMessage): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(request.headers).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, Array.isArray(value) ? value.join(',') : value]],
    ),
  );
}

function send(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
