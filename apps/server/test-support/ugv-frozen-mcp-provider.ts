import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { FROZEN_MCP_PROTOCOL_VERSION } from '../../../packages/mcp-adapter/src/index.js';

const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';
const TASK_PROFILE = 'io.sdar/taskExecution';
const PROVIDER_CATALOG = 'io.sdar/providerCatalog';
const EXECUTION_SEMANTICS = 'io.sdar/tool-execution-semantics';

const PROVIDER_ID = 'isr.vehicle.ugv.ugv1';
const RESOURCE_ID = 'vehicle:ugv1';
export const UGV_FROZEN_INITIAL_POSITION = Object.freeze({
  longitude: 106.813_980_425_914_1,
  latitude: 29.720_4,
});

export interface UgvFrozenMcpProviderHandle {
  readonly endpoint: URL;
  readonly navigateCallCount: number;
  readonly getStateCallCount: number;
  readonly taskGetCallCount: number;
  readonly navigateArguments: Readonly<Record<string, unknown>> | undefined;
  releaseNavigation(): void;
  close(): Promise<void>;
}

interface ProviderState {
  released: boolean;
  navigateCallCount: number;
  getStateCallCount: number;
  taskGetCallCount: number;
  runtimeRevision: number;
  taskSequence: number;
  taskId: string;
  createdAt: string;
  navigateArguments?: Readonly<Record<string, unknown>>;
}

/**
 * Exact loopback Frozen MCP provider used only by the UGV composition integration test.
 * It deliberately keeps the navigation Task working until the test restarts the Runtime.
 */
export async function startUgvFrozenMcpProvider(): Promise<UgvFrozenMcpProviderHandle> {
  const state: ProviderState = {
    released: false,
    navigateCallCount: 0,
    getStateCallCount: 0,
    taskGetCallCount: 0,
    runtimeRevision: 1,
    taskSequence: 0,
    taskId: 'ugv-frozen-task-0',
    createdAt: new Date().toISOString(),
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response, state);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('UGV_FROZEN_PROVIDER_ADDRESS_UNAVAILABLE');
  }
  return Object.freeze({
    endpoint: new URL(`http://127.0.0.1:${String(address.port)}/mcp`),
    get navigateCallCount() {
      return state.navigateCallCount;
    },
    get getStateCallCount() {
      return state.getStateCallCount;
    },
    get taskGetCallCount() {
      return state.taskGetCallCount;
    },
    get navigateArguments() {
      return state.navigateArguments;
    },
    releaseNavigation() {
      state.released = true;
    },
    close: () => closeServer(server),
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: ProviderState,
): Promise<void> {
  let body: Readonly<Record<string, unknown>>;
  try {
    body = await readBody(request);
  } catch {
    send(response, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Invalid JSON.' },
    });
    return;
  }
  const id = body['id'];
  const method = body['method'];
  const params = record(body['params']);
  if (
    request.method !== 'POST' ||
    request.headers['mcp-protocol-version'] !== FROZEN_MCP_PROTOCOL_VERSION ||
    typeof method !== 'string' ||
    request.headers['mcp-method'] !== method ||
    !validRequestMetadata(params['_meta'])
  ) {
    send(response, {
      jsonrpc: '2.0',
      id,
      error: { code: -32001, message: 'Frozen header or metadata mismatch.' },
    });
    return;
  }
  try {
    send(response, { jsonrpc: '2.0', id, result: resultFor(method, params, state) });
  } catch (error: unknown) {
    send(response, {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: error instanceof Error ? error.message : 'Unsupported.' },
    });
  }
}

function resultFor(
  method: string,
  params: Readonly<Record<string, unknown>>,
  state: ProviderState,
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
            [PROVIDER_CATALOG]: {
              providerId: PROVIDER_ID,
              providerType: 'isr.vehicle.ugv',
              providerVersion: '1.0.0',
              manifestHash: 'b'.repeat(64),
            },
          },
        },
        _meta: {
          'io.modelcontextprotocol/serverInfo': {
            name: 'ugv-smpp-composition-fixture',
            version: '1.0.0',
          },
        },
        ttlMs: 15 * 60 * 1_000,
      };
    case 'tools/list':
      return { tools: tools() };
    case 'io.sdar/taskExecution/checkAvailability': {
      const checks = Array.isArray(params['checks']) ? params['checks'] : [];
      return {
        resultType: 'complete',
        profileVersion: '1.0',
        results: checks.map((raw) => {
          const check = record(raw);
          const operationName = String(check['operationName']);
          return {
            requestId: check['requestId'],
            operationName,
            availability: 'available',
            riskLevel: operationName === 'vehicle_navigate' ? 'high' : 'low',
            validUntil: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
            nextAvailableWindows: [],
            reservationMode: 'none',
            possibleEffects:
              operationName === 'vehicle_navigate' ? ['task_pause', 'partial_completion'] : [],
          };
        }),
      };
    }
    case 'tools/call': {
      const name = params['name'];
      const arguments_ = record(params['arguments']);
      if (name === 'vehicle_get_state') {
        state.getStateCallCount += 1;
        return toolResult(vehicleState(state));
      }
      if (name !== 'vehicle_navigate') throw new Error('Unknown Tool.');
      state.navigateCallCount += 1;
      state.taskSequence += 1;
      state.taskId = `ugv-frozen-task-${String(state.taskSequence)}`;
      state.createdAt = new Date().toISOString();
      state.runtimeRevision = 1;
      state.navigateArguments = Object.freeze(structuredClone(arguments_));
      return remoteTask(state, 'task', 'working');
    }
    case 'tasks/get':
      state.taskGetCallCount += 1;
      state.runtimeRevision += 1;
      return state.released
        ? remoteTask(state, 'complete', 'completed')
        : remoteTask(state, 'complete', 'working');
    case 'tasks/cancel':
    case 'tasks/update':
      return { resultType: 'complete' };
    default:
      throw new Error(`Unsupported method ${method}.`);
  }
}

function remoteTask(
  state: ProviderState,
  resultType: 'task' | 'complete',
  status: 'working' | 'completed',
): Readonly<Record<string, unknown>> {
  const observedAt = new Date().toISOString();
  const base = {
    resultType,
    taskId: state.taskId,
    status,
    createdAt: state.createdAt,
    lastUpdatedAt: observedAt,
    ttlMs: 10 * 60 * 1_000,
    pollIntervalMs: 100,
    _meta: {
      [TASK_PROFILE]: {
        profileVersion: '1.0',
        runtimeRevision: String(state.runtimeRevision),
        providerRevision: `ugv-sim-${String(state.runtimeRevision)}`,
        observedAt,
        ...(status === 'working'
          ? { substate: 'running', progress: { percent: Math.min(90, state.runtimeRevision) } }
          : {}),
      },
    },
  };
  return status === 'completed'
    ? Object.freeze({ ...base, result: toolResult(navigationResult(observedAt)) })
    : Object.freeze(base);
}

function navigationResult(observedAt: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    resourceId: RESOURCE_ID,
    status: 'completed',
    observedAt,
    positionAuthority: Object.freeze({
      field: 'chassis.position.geodetic',
      topic: '/ugv/gnss',
      observedAt,
      timeAuthority: 'source',
      cursor: observationCursor(observedAt, 101),
    }),
    snapshotRevision: 'ugv-provider-terminal-snapshot-101',
    correlationStrength: 'STRICT_CORRELATED',
    observationAuthority: 'post_dispatch',
  });
}

function vehicleState(state: ProviderState): Readonly<Record<string, unknown>> {
  const observedAt = new Date().toISOString();
  const target = record(record(state.navigateArguments?.['mission'])['target']);
  const atTarget = state.released && typeof target['longitude'] === 'number';
  const position = atTarget
    ? { longitude: target['longitude'], latitude: target['latitude'] }
    : UGV_FROZEN_INITIAL_POSITION;
  const cursor = state.released ? 102 : state.getStateCallCount === 1 ? 90 : 100;
  return Object.freeze({
    identity: Object.freeze({
      providerId: PROVIDER_ID,
      resourceId: RESOURCE_ID,
      vehicleType: 'ugv',
      executionMode: 'simulation',
    }),
    connectivity: Object.freeze({
      mqttConnected: true,
      deviceMcpConnected: true,
      deviceAvailable: true,
      packetLossRate: 0,
      averageRoundTripTimeMs: 1,
    }),
    freshness: Object.freeze({
      chassisObservedAt: observedAt,
      healthObservedAt: observedAt,
      missionObservedAt: observedAt,
    }),
    chassis: Object.freeze({
      position: Object.freeze(position),
      speedKmh: 0,
      mission: Object.freeze({ state: 4 }),
    }),
    health: Object.freeze({
      chassisErrorCodes: Object.freeze([]),
      payloadErrorCodes: Object.freeze([]),
      components: Object.freeze({
        communications: 'normal',
        gnss: 'normal',
        navigation: 'normal',
      }),
    }),
    revision: cursor === 90 ? '9'.repeat(64) : cursor === 100 ? 'a'.repeat(64) : 'c'.repeat(64),
    observedAt,
    mqttIngressSequence: cursor,
  });
}

function toolResult(structuredContent: unknown): Readonly<Record<string, unknown>> {
  return Object.freeze({
    resultType: 'complete',
    content: Object.freeze([]),
    structuredContent,
    isError: false,
  });
}

function tools(): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze([
    Object.freeze({
      name: 'vehicle_navigate',
      title: 'Navigate simulated UGV',
      description: 'Starts one governed point-navigation Task.',
      inputSchema: navigateInputSchema(),
      outputSchema: navigateOutputSchema(),
      _meta: {
        [TASK_PROFILE]: {
          profileVersion: '1.0',
          taskBehavior: 'task_required',
          availability: 'dynamic',
          supportsScheduling: true,
          supportsMaxElapsed: true,
          supportsCancellation: true,
          supportsPauseResume: true,
          supportsObservations: true,
          supportsInputRequired: false,
          idempotency: 'server_managed',
        },
        [EXECUTION_SEMANTICS]: {
          effect: 'side_effecting',
          execution: 'task_required',
          cancellation: 'task_cancel',
          idempotency: 'server_managed',
          replay: 'simulation_only',
        },
      },
    }),
    Object.freeze({
      name: 'vehicle_get_state',
      title: 'Read simulated UGV state',
      description: 'Reads authoritative simulated UGV state.',
      inputSchema: stateInputSchema(),
      outputSchema: stateOutputSchema(),
      _meta: {
        [TASK_PROFILE]: {
          profileVersion: '1.0',
          taskBehavior: 'synchronous_only',
          availability: 'dynamic',
          supportsScheduling: false,
          supportsMaxElapsed: false,
          supportsCancellation: false,
          supportsPauseResume: false,
          supportsObservations: false,
          supportsInputRequired: false,
          idempotency: 'server_managed',
        },
        [EXECUTION_SEMANTICS]: {
          effect: 'read_only',
          execution: 'synchronous',
          cancellation: 'unsupported',
          idempotency: 'server_managed',
          replay: 'allowed',
        },
      },
    }),
  ]);
}

function navigateInputSchema(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['resourceId', 'mission', 'stopOnObstacle'],
    properties: {
      resourceId: { const: RESOURCE_ID },
      mission: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target'],
            properties: {
              type: { const: 'point' },
              target: {
                type: 'object',
                additionalProperties: false,
                required: ['longitude', 'latitude'],
                properties: {
                  longitude: { type: 'number', minimum: -180, maximum: 180 },
                  latitude: { type: 'number', minimum: -90, maximum: 90 },
                },
              },
            },
          },
        ],
      },
      stopOnObstacle: { type: 'boolean' },
    },
  });
}

function navigateOutputSchema(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['resourceId', 'status', 'observedAt'],
    properties: {
      resourceId: { const: RESOURCE_ID },
      status: { type: 'string', enum: ['completed', 'failed', 'cancelled', 'timeout'] },
      observedAt: { type: 'string', format: 'date-time' },
      positionAuthority: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'topic', 'observedAt', 'timeAuthority', 'cursor'],
        properties: {
          field: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          topic: { type: 'string' },
          observedAt: { type: 'string', format: 'date-time' },
          timeAuthority: { type: 'string', enum: ['source', 'ingest'] },
          cursor: { type: 'string' },
        },
      },
      snapshotRevision: { type: 'string' },
      correlationStrength: {
        type: 'string',
        enum: ['STRICT_CORRELATED', 'WEAK_UNCORRELATED', 'MISMATCH', 'UNKNOWN'],
      },
      observationAuthority: { type: 'string' },
    },
  });
}

function stateInputSchema(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['resourceId'],
    properties: {
      resourceId: { const: RESOURCE_ID },
      include: {
        type: 'array',
        items: { enum: ['chassis', 'health'] },
        uniqueItems: true,
      },
    },
  });
}

function stateOutputSchema(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: [
      'identity',
      'connectivity',
      'freshness',
      'chassis',
      'health',
      'revision',
      'observedAt',
      'mqttIngressSequence',
    ],
    properties: {
      identity: {
        type: 'object',
        additionalProperties: false,
        required: ['providerId', 'resourceId', 'vehicleType', 'executionMode'],
        properties: {
          providerId: { type: 'string', minLength: 1 },
          resourceId: { const: RESOURCE_ID },
          vehicleType: { type: 'string', minLength: 1 },
          executionMode: { type: 'string', enum: ['simulation', 'live'] },
        },
      },
      connectivity: {
        type: 'object',
        additionalProperties: false,
        required: [
          'mqttConnected',
          'deviceMcpConnected',
          'deviceAvailable',
          'packetLossRate',
          'averageRoundTripTimeMs',
        ],
        properties: {
          mqttConnected: { type: 'boolean' },
          deviceMcpConnected: { type: 'boolean' },
          deviceAvailable: { type: 'boolean' },
          packetLossRate: { type: 'number', minimum: 0 },
          averageRoundTripTimeMs: { type: 'number', minimum: 0 },
        },
      },
      freshness: {
        type: 'object',
        additionalProperties: false,
        required: ['chassisObservedAt', 'healthObservedAt', 'missionObservedAt'],
        properties: {
          chassisObservedAt: { type: 'string', format: 'date-time' },
          healthObservedAt: { type: 'string', format: 'date-time' },
          missionObservedAt: { type: 'string', format: 'date-time' },
        },
      },
      chassis: { type: 'object', additionalProperties: true },
      health: { type: 'object', additionalProperties: true },
      revision: { type: 'string', minLength: 1 },
      observedAt: { type: 'string', format: 'date-time' },
      mqttIngressSequence: { type: 'integer', minimum: 0 },
    },
  });
}

function observationCursor(observedAt: string, ingestSequence: number): string {
  return `oc1.${Buffer.from(
    JSON.stringify({
      version: 1,
      kind: 'field',
      field: 'chassis.position.geodetic',
      topic: '/ugv/gnss',
      observedAt,
      timeAuthority: 'source',
      ingestSequence,
      payloadHash: 'e'.repeat(64),
    }),
    'utf8',
  ).toString('base64url')}`;
}

function validRequestMetadata(value: unknown): boolean {
  const metadata = record(value);
  const protocolVersion = metadata['io.modelcontextprotocol/protocolVersion'];
  const clientInfo = record(metadata['io.modelcontextprotocol/clientInfo']);
  return (
    protocolVersion === FROZEN_MCP_PROTOCOL_VERSION &&
    clientInfo['name'] === 'sdar' &&
    typeof clientInfo['version'] === 'string'
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : Object.freeze({});
}

async function readBody(request: IncomingMessage): Promise<Readonly<Record<string, unknown>>> {
  let raw = '';
  for await (const chunk of request) raw += String(chunk);
  return record(JSON.parse(raw) as unknown);
}

function send(response: ServerResponse, body: unknown): void {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.close();
  server.closeAllConnections();
  await once(server, 'close');
}
