import { once } from 'node:events';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import {
  MCP_TASKS_EXTENSION_ID,
  MCP_TASKS_TESTED_PROTOCOL_REVISION,
} from './mcp-tasks-contract.js';

const LEGACY_CREATED_AT = '2026-07-16T00:00:00.000Z';
const LEGACY_OBSERVED_AT = [
  LEGACY_CREATED_AT,
  '2026-07-16T00:00:20.000Z',
  '2026-07-16T00:00:40.000Z',
  '2026-07-16T00:01:00.000Z',
] as const;
const LEGACY_REMOTE_TASK_ID = 'remote-task-0000000000000001';
const MAX_REQUEST_BYTES = 1_048_576;

const PHASE_SIX_SCENARIOS = [
  'sync_success',
  'task_success',
  'task_business_failure',
  'task_protocol_failure',
  'task_cancelled',
  'task_input_required',
  'task_multi_input',
  'task_restricted_accept',
  'task_restricted_reject',
  'task_scheduled_success',
  'task_start_window_missed',
  'task_deadline_reached',
  'task_pause_resume_observation',
  'task_provider_unreachable',
  'task_malformed_response',
  'task_duplicate_terminal',
] as const;

type PhaseSixScenario = (typeof PHASE_SIX_SCENARIOS)[number];
type TaskScenario = Exclude<PhaseSixScenario, 'sync_success' | 'task_restricted_reject'>;

const LEGACY_SCENARIOS = [
  'async_success',
  'rejected_without_task',
  'malformed_task_id',
  'unknown_task_status',
  'unknown_task_field',
  'malformed_task_metadata',
] as const;

interface MockTaskState {
  readonly scenario: TaskScenario | 'async_success';
  readonly taskId: string;
  readonly timeline: readonly [string, string, string, string];
  getCount: number;
  updateCount: number;
  cancelAcknowledged: boolean;
  readonly moveResult?: Readonly<{
    resourceId: string;
    target: Readonly<{ x: number; y: number; frame?: string }>;
    includeEvidence: boolean;
  }>;
  readonly patrolResult?: Readonly<{
    resourceId: string;
    target: Readonly<{ x: number; y: number; frame?: string }>;
    degraded: boolean;
    includeEvidence: boolean;
  }>;
}

interface MockProviderState {
  readonly tasks: Map<string, MockTaskState>;
  readonly phaseSixTimeline: readonly [string, string, string, string];
  readonly phaseSixValidUntil: string;
  readonly moveTo?: McpTasksMockMoveToOptions;
  readonly areaPatrol?: McpTasksMockAreaPatrolOptions;
  nextMoveTask: number;
  nextPatrolTask: number;
}

class MockTransportOutage extends Error {}

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

export interface McpTasksMockMoveToOptions {
  readonly outcome:
    | 'immediate_success'
    | 'remote_success'
    | 'remote_missing_evidence'
    | 'remote_input_required'
    | 'remote_cancelled';
  readonly availability?: 'available' | 'restricted' | 'disabled';
}

export interface McpTasksMockAreaPatrolOptions {
  readonly outcome: 'remote_success' | 'remote_degraded' | 'remote_missing_evidence';
  readonly availability?: 'available' | 'restricted' | 'disabled';
}

export async function startMcpTasksMockProvider(
  options: Readonly<{
    declareTasks?: boolean;
    moveTo?: McpTasksMockMoveToOptions;
    areaPatrol?: McpTasksMockAreaPatrolOptions;
  }> = {},
): Promise<McpTasksMockProviderHandle> {
  const requests: McpTasksMockRequest[] = [];
  const startedAt = Date.now();
  const state: MockProviderState = {
    tasks: new Map(),
    phaseSixTimeline: timelineFrom(startedAt),
    phaseSixValidUntil: new Date(startedAt + 86_400_000).toISOString(),
    ...(options.moveTo === undefined ? {} : { moveTo: options.moveTo }),
    ...(options.areaPatrol === undefined ? {} : { areaPatrol: options.areaPatrol }),
    nextMoveTask: 0,
    nextPatrolTask: 0,
  };
  const declareTasks = options.declareTasks ?? true;
  const server = createServer((request, response) => {
    void handleProviderRequest(request, response, requests, state, declareTasks);
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
  state: MockProviderState,
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
    const result = resultForRequest(method, params, state, declareTasks);
    sendJson(response, { jsonrpc: '2.0', id, result });
  } catch (error: unknown) {
    if (error instanceof MockTransportOutage) {
      response.destroy(error);
      return;
    }
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
  state: MockProviderState,
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
        serverInfo: { name: 'sdar-mcp-tasks-mock', version: '1.1.0' },
      };
    case 'tools/list':
      return toolListResult(state);
    case 'io.sdar/tasks/checkAvailability':
      return availabilityResult(params, state);
    case 'tools/call':
      return toolCallResult(params, state);
    case 'tasks/get':
      return taskGetResult(params, state);
    case 'tasks/update':
      return taskUpdateResult(params, state);
    case 'tasks/cancel':
      return taskCancelResult(params, state);
    default:
      throw new Error(`Unsupported Mock Provider method ${method}.`);
  }
}

function toolListResult(state?: MockProviderState): Readonly<Record<string, unknown>> {
  const names = [...PHASE_SIX_SCENARIOS, ...LEGACY_SCENARIOS];
  return {
    resultType: 'complete',
    ttlMs: 0,
    cacheScope: 'private',
    tools: [
      ...names.map((name) => ({
        name,
        description: `Deterministic MCP Tasks acceptance scenario: ${name}.`,
        inputSchema: { type: 'object', additionalProperties: false },
        ...(isTaskCapableName(name)
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
      ...(state?.moveTo === undefined
        ? []
        : [
            {
              name: 'embodied.move',
              description: 'Move one resource and return authoritative final-position evidence.',
              inputSchema: {
                type: 'object',
                additionalProperties: false,
                required: ['resourceId', 'target'],
                properties: {
                  resourceId: { type: 'string', minLength: 1 },
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
              _meta: {
                'io.sdar/taskExecution': {
                  execution: 'task_capable',
                  availability: 'dynamic',
                  supportsScheduling: true,
                  supportsMaxElapsed: true,
                  supportsObservations: true,
                  cancellation: 'task_cancel',
                  revision: '1.0',
                },
              },
            },
          ]),
      ...(state?.areaPatrol === undefined ? [] : areaPatrolTools()),
    ],
  };
}

function availabilityResult(
  params: Readonly<Record<string, unknown>>,
  state: MockProviderState,
): Readonly<Record<string, unknown>> {
  if (params['revision'] !== '1.0' || !Array.isArray(params['requests']))
    throw new Error('Invalid availability request.');
  return {
    resultType: 'complete',
    revision: '1.0',
    results: params['requests'].map((request: unknown) => {
      if (!isRecord(request)) throw new Error('Invalid availability item.');
      const operationName = stringParam(request, 'operationName');
      const common = {
        nodeId: stringParam(request, 'nodeId'),
        operationName,
      };
      if (operationName === 'embodied.move') {
        const availability = state.moveTo?.availability ?? 'available';
        if (availability === 'restricted')
          return {
            ...common,
            availability,
            riskLevel: 'high',
            reasonCode: 'MOVE_WINDOW_RESTRICTED',
            description: 'Movement must be rescheduled into the declared Provider window.',
            validUntil: state.phaseSixValidUntil,
            earliestStartTime: state.phaseSixTimeline[1],
            nextAvailableWindows: [
              { startTime: state.phaseSixTimeline[1], endTime: state.phaseSixTimeline[3] },
            ],
            reservationMode: 'best_effort',
            possibleEffects: ['start_rejection'],
          };
        if (availability === 'disabled')
          return {
            ...common,
            availability,
            riskLevel: 'high',
            reasonCode: 'MOVE_PROVIDER_DISABLED',
            reservationMode: 'none',
            possibleEffects: [],
          };
        return {
          ...common,
          availability,
          riskLevel: 'low',
          reservationMode: 'none',
          possibleEffects: [],
        };
      }
      if (operationName === 'embodied.area_patrol') {
        const availability = state.areaPatrol?.availability ?? 'available';
        if (availability === 'restricted')
          return {
            ...common,
            availability,
            riskLevel: 'high',
            reasonCode: 'PATROL_WINDOW_RESTRICTED',
            description: 'Patrol must start inside the declared Provider window.',
            validUntil: state.phaseSixValidUntil,
            earliestStartTime: state.phaseSixTimeline[1],
            nextAvailableWindows: [
              { startTime: state.phaseSixTimeline[1], endTime: state.phaseSixTimeline[3] },
            ],
            reservationMode: 'best_effort',
            possibleEffects: ['start_rejection'],
          };
        return {
          ...common,
          availability,
          riskLevel: availability === 'disabled' ? 'high' : 'low',
          ...(availability === 'disabled' ? { reasonCode: 'PATROL_PROVIDER_DISABLED' } : {}),
          reservationMode: 'none',
          possibleEffects: [],
        };
      }
      if (
        operationName === 'task_restricted_accept' ||
        operationName === 'task_restricted_reject'
      ) {
        return {
          ...common,
          availability: 'restricted',
          riskLevel: 'high',
          reasonCode: 'OPERATOR_CONFIRMATION_REQUIRED',
          description: 'The deterministic scenario requires explicit operator confirmation.',
          validUntil: state.phaseSixValidUntil,
          reservationMode: 'best_effort',
          possibleEffects: ['task_preemption', 'start_rejection'],
        };
      }
      if (operationName === 'task_scheduled_success') {
        const window = scheduledWindow(request, state.phaseSixTimeline[0]);
        return {
          ...common,
          availability: 'available',
          riskLevel: 'low',
          earliestStartTime: window.startTime,
          nextAvailableWindows: [window],
          reservationMode: 'guaranteed',
          reservationRef: 'mock-reservation-scheduled-success',
          possibleEffects: ['start_window_missed'],
        };
      }
      return {
        ...common,
        availability: 'available',
        riskLevel: 'low',
        reservationMode: 'none',
        possibleEffects: [],
      };
    }),
  };
}

function scheduledWindow(
  request: Readonly<Record<string, unknown>>,
  providerStartedAt: string,
): Readonly<{ startTime: string; endTime: string }> {
  const timing = request['timing'];
  const start = isRecord(timing) ? timing['start'] : undefined;
  const requested =
    isRecord(start) && start['mode'] === 'scheduled' && typeof start['scheduledAt'] === 'string'
      ? start['scheduledAt']
      : new Date(Date.parse(providerStartedAt) + 300_000).toISOString();
  const parsed = Date.parse(requested);
  const startTime = Number.isFinite(parsed) ? new Date(parsed).toISOString() : providerStartedAt;
  return {
    startTime,
    endTime: new Date(Date.parse(startTime) + 3_600_000).toISOString(),
  };
}

function toolCallResult(
  params: Readonly<Record<string, unknown>>,
  state: MockProviderState,
): Readonly<Record<string, unknown>> {
  const name = stringParam(params, 'name');
  if (name === 'embodied.move') return moveToolCallResult(params, state);
  if (name === 'embodied.area_patrol') return patrolToolCallResult(params, state);
  if (name === 'embodied.inspect_area') return inspectionToolCallResult(params);
  if (name === 'sync_success')
    return { resultType: 'complete', ...successfulToolResult('sync_complete', 'sync complete') };
  if (name === 'rejected_without_task' || name === 'task_restricted_reject') {
    return {
      resultType: 'complete',
      ...businessToolResult('admission_rejected', 'RESOURCE_UNAVAILABLE', true),
    };
  }

  if (name === 'malformed_task_id') return malformedCreatedTask(name, 'taskId');
  if (name === 'unknown_task_status') return malformedCreatedTask(name, 'status');
  if (name === 'unknown_task_field') return malformedCreatedTask(name, 'field');
  if (name === 'malformed_task_metadata') return malformedCreatedTask(name, 'metadata');
  if (!isTaskScenario(name) && name !== 'async_success')
    throw new Error(`Unknown Mock Provider scenario ${name}.`);

  const taskId = name === 'async_success' ? LEGACY_REMOTE_TASK_ID : `remote-task-${name}`;
  const task: MockTaskState = {
    scenario: name,
    taskId,
    timeline: name === 'async_success' ? LEGACY_OBSERVED_AT : state.phaseSixTimeline,
    getCount: 0,
    updateCount: 0,
    cancelAcknowledged: false,
  };
  state.tasks.set(taskId, task);
  return createdTask(task);
}

function moveToolCallResult(
  params: Readonly<Record<string, unknown>>,
  state: MockProviderState,
): Readonly<Record<string, unknown>> {
  const options = state.moveTo;
  if (options === undefined) throw new Error('Move-to scenario is not enabled.');
  const arguments_ = params['arguments'];
  if (!isRecord(arguments_)) throw new Error('embodied.move requires arguments.');
  const resourceId = stringParam(arguments_, 'resourceId');
  const targetValue = arguments_['target'];
  if (!isRecord(targetValue)) throw new Error('embodied.move target is required.');
  const x = numberParam(targetValue, 'x');
  const y = numberParam(targetValue, 'y');
  const frame = targetValue['frame'];
  if (frame !== undefined && typeof frame !== 'string')
    throw new Error('embodied.move target frame must be a string.');
  const target = { x, y, ...(frame === undefined ? {} : { frame }) };
  if (options.outcome === 'immediate_success')
    return {
      resultType: 'complete',
      ...successfulMoveResult(resourceId, target, true),
    };
  const scenario: TaskScenario =
    options.outcome === 'remote_input_required'
      ? 'task_input_required'
      : options.outcome === 'remote_cancelled'
        ? 'task_cancelled'
        : 'task_success';
  state.nextMoveTask += 1;
  const task: MockTaskState = {
    scenario,
    taskId: `remote-task-embodied-move-${String(state.nextMoveTask)}`,
    timeline: state.phaseSixTimeline,
    getCount: 0,
    updateCount: 0,
    cancelAcknowledged: false,
    moveResult: {
      resourceId,
      target,
      includeEvidence: options.outcome !== 'remote_missing_evidence',
    },
  };
  state.tasks.set(task.taskId, task);
  return createdTask(task);
}

function patrolToolCallResult(
  params: Readonly<Record<string, unknown>>,
  state: MockProviderState,
): Readonly<Record<string, unknown>> {
  const options = state.areaPatrol;
  if (options === undefined) throw new Error('Area-patrol scenario is not enabled.');
  const arguments_ = params['arguments'];
  if (!isRecord(arguments_)) throw new Error('embodied.area_patrol requires arguments.');
  const resourceId = stringParam(arguments_, 'resourceId');
  const targetValue = arguments_['target'];
  if (!isRecord(targetValue)) throw new Error('embodied.area_patrol target is required.');
  const x = numberParam(targetValue, 'x');
  const y = numberParam(targetValue, 'y');
  const frame = targetValue['frame'];
  if (frame !== undefined && typeof frame !== 'string')
    throw new Error('embodied.area_patrol target frame must be a string.');
  if (!isRecord(arguments_['area']) || !isRecord(arguments_['timeWindow']))
    throw new Error('embodied.area_patrol area and timeWindow are required.');
  state.nextPatrolTask += 1;
  const task: MockTaskState = {
    scenario: 'task_success',
    taskId: `remote-task-embodied-area-patrol-${String(state.nextPatrolTask)}`,
    timeline: state.phaseSixTimeline,
    getCount: 0,
    updateCount: 0,
    cancelAcknowledged: false,
    patrolResult: {
      resourceId,
      target: { x, y, ...(frame === undefined ? {} : { frame }) },
      degraded: options.outcome === 'remote_degraded',
      includeEvidence: options.outcome !== 'remote_missing_evidence',
    },
  };
  state.tasks.set(task.taskId, task);
  return createdTask(task);
}

function inspectionToolCallResult(
  params: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const arguments_ = params['arguments'];
  if (!isRecord(arguments_) || !isRecord(arguments_['area']))
    throw new Error('embodied.inspect_area requires area.');
  return {
    resultType: 'complete',
    content: [{ type: 'text', text: 'Inspected the admitted patrol area.' }],
    structuredContent: { anomalies: [] },
    isError: false,
  };
}

function taskGetResult(
  params: Readonly<Record<string, unknown>>,
  state: MockProviderState,
): Readonly<Record<string, unknown>> {
  const task = requiredTask(params, state);
  const observation = task.getCount;
  task.getCount += 1;
  switch (task.scenario) {
    case 'async_success':
      return legacyCompletedTask(task);
    case 'task_success':
    case 'task_restricted_accept':
      return observation === 0
        ? workingTask(task, 'running', 50, 1)
        : completedTask(task, 'remote_complete', 'remote complete', 3);
    case 'task_scheduled_success':
      return observation === 0
        ? workingTask(task, 'scheduled', 0, 1)
        : completedTask(task, 'scheduled_complete', 'scheduled task complete', 3);
    case 'task_business_failure':
      return completedBusinessTask(task, 'business_failure', 'BUSINESS_RULE_REJECTED', false);
    case 'task_start_window_missed':
      return completedBusinessTask(task, 'start_window_missed', 'START_WINDOW_MISSED', true);
    case 'task_deadline_reached':
      return completedBusinessTask(task, 'deadline_reached', 'MAX_ELAPSED_TIME_REACHED', true);
    case 'task_protocol_failure':
      return failedTask(task);
    case 'task_cancelled':
      return task.cancelAcknowledged ? cancelledTask(task) : workingTask(task, 'stopping', 25, 1);
    case 'task_input_required':
      return task.updateCount === 0
        ? inputRequiredTask(task, 'approval', approvalRequest(), 1)
        : completedTask(task, 'input_complete', 'input accepted', 3);
    case 'task_multi_input':
      if (task.updateCount === 0) return inputRequiredTask(task, 'approval', approvalRequest(), 1);
      if (task.updateCount === 1) return inputRequiredTask(task, 'details', detailsRequest(), 2);
      return completedTask(task, 'multi_input_complete', 'all input accepted', 3);
    case 'task_pause_resume_observation':
      if (observation === 0) return workingTask(task, 'paused', 25, 1);
      if (observation === 1) return workingTask(task, 'resuming', 50, 2);
      return completedTask(task, 'resumed_complete', 'resumed task complete', 3);
    case 'task_provider_unreachable':
      if (observation === 0)
        throw new MockTransportOutage(
          'Deterministic Provider transport outage; retry observation.',
        );
      return completedTask(task, 'recovered_complete', 'provider recovered', 3);
    case 'task_malformed_response':
      return { ...workingTask(task, 'running', 50, 1), unexpectedExecutableField: 'reject-me' };
    case 'task_duplicate_terminal':
      return completedTask(task, 'duplicate_terminal_complete', 'terminal result', 3);
  }
}

function taskUpdateResult(
  params: Readonly<Record<string, unknown>>,
  state: MockProviderState,
): Readonly<Record<string, unknown>> {
  const task = requiredTask(params, state);
  if (task.scenario === 'async_success') return { resultType: 'complete' };
  if (task.scenario !== 'task_input_required' && task.scenario !== 'task_multi_input')
    throw new Error('This Mock Provider Task has no outstanding input request.');
  const responses = params['inputResponses'];
  if (!isRecord(responses)) throw new Error('tasks/update requires inputResponses.');
  const expectedKey = task.updateCount === 0 ? 'approval' : 'details';
  if (Object.keys(responses).length !== 1 || !(expectedKey in responses))
    throw new Error(`tasks/update must answer exactly ${expectedKey}.`);
  task.updateCount += 1;
  return { resultType: 'complete' };
}

function taskCancelResult(
  params: Readonly<Record<string, unknown>>,
  state: MockProviderState,
): Readonly<Record<string, unknown>> {
  const task = requiredTask(params, state);
  if (task.scenario === 'async_success') return { resultType: 'complete' };
  if (task.scenario !== 'task_cancelled')
    throw new Error('This Mock Provider Task does not accept deterministic cancellation.');
  task.cancelAcknowledged = true;
  return { resultType: 'complete' };
}

function createdTask(task: MockTaskState): Readonly<Record<string, unknown>> {
  return {
    resultType: 'task',
    taskId: task.taskId,
    status: 'working',
    createdAt: task.timeline[0],
    lastUpdatedAt: task.timeline[0],
    ttlMs: 3_600_000,
    pollIntervalMs: 50,
    _meta: observationMetadata(
      task.scenario === 'task_scheduled_success' ? 'scheduled' : 'queued',
      0,
      0,
      task.timeline[0],
    ),
  };
}

function workingTask(
  task: MockTaskState,
  substate: 'scheduled' | 'running' | 'paused' | 'resuming' | 'stopping',
  percent: number,
  sequence: number,
): Readonly<Record<string, unknown>> {
  return {
    resultType: 'complete',
    ...taskBase(task, sequence),
    status: 'working',
    _meta: observationMetadata(substate, percent, sequence, taskObservedAt(task, sequence)),
  };
}

function inputRequiredTask(
  task: MockTaskState,
  key: string,
  request: Readonly<Record<string, unknown>>,
  sequence: number,
): Readonly<Record<string, unknown>> {
  return {
    resultType: 'complete',
    ...taskBase(task, sequence),
    status: 'input_required',
    inputRequests: { [key]: request },
    _meta: observationMetadata('paused', 50, sequence, taskObservedAt(task, sequence)),
  };
}

function completedTask(
  task: MockTaskState,
  status: string,
  text: string,
  sequence: number,
): Readonly<Record<string, unknown>> {
  return {
    resultType: 'complete',
    ...taskBase(task, sequence),
    status: 'completed',
    _meta: observationMetadata('stopping', 100, sequence, taskObservedAt(task, sequence)),
    result:
      task.moveResult !== undefined
        ? successfulMoveResult(
            task.moveResult.resourceId,
            task.moveResult.target,
            task.moveResult.includeEvidence,
          )
        : task.patrolResult !== undefined
          ? successfulPatrolResult(task.patrolResult)
          : successfulToolResult(status, text),
  };
}

function legacyCompletedTask(task: MockTaskState): Readonly<Record<string, unknown>> {
  return {
    resultType: 'complete',
    ...taskBase(task, 3),
    status: 'completed',
    _meta: {
      'io.sdar/taskExecution': {
        revision: '1.0',
        remoteRevision: 'provider-revision-2',
        substate: 'stopping',
        eventId: 'provider-event-2',
        observedAt: LEGACY_OBSERVED_AT[3],
        progress: { percent: 100 },
      },
    },
    result: successfulToolResult('remote_complete', 'remote complete'),
  };
}

function completedBusinessTask(
  task: MockTaskState,
  outcome: 'business_failure' | 'start_window_missed' | 'deadline_reached',
  reasonCode: string,
  retryable: boolean,
): Readonly<Record<string, unknown>> {
  return {
    resultType: 'complete',
    ...taskBase(task, 3),
    status: 'completed',
    _meta: observationMetadata('stopping', 100, 3, taskObservedAt(task, 3)),
    result: businessToolResult(outcome, reasonCode, retryable),
  };
}

function failedTask(task: MockTaskState): Readonly<Record<string, unknown>> {
  return {
    resultType: 'complete',
    ...taskBase(task, 3),
    status: 'failed',
    _meta: observationMetadata('stopping', 100, 3, taskObservedAt(task, 3)),
    error: {
      code: -32_603,
      message: 'Deterministic remote protocol operation failure.',
      data: { reasonCode: 'REMOTE_PROTOCOL_OPERATION_FAILED' },
    },
  };
}

function cancelledTask(task: MockTaskState): Readonly<Record<string, unknown>> {
  return {
    resultType: 'complete',
    ...taskBase(task, 3),
    status: 'cancelled',
    statusMessage: 'Provider confirmed cooperative cancellation.',
    _meta: observationMetadata('stopping', 100, 3, taskObservedAt(task, 3)),
  };
}

function taskBase(task: MockTaskState, sequence: number): Readonly<Record<string, unknown>> {
  return {
    taskId: task.taskId,
    createdAt: task.timeline[0],
    lastUpdatedAt: taskObservedAt(task, sequence),
    ttlMs: 3_600_000,
    pollIntervalMs: 50,
  };
}

function observationMetadata(
  substate: 'scheduled' | 'queued' | 'running' | 'paused' | 'resuming' | 'stopping',
  percent: number,
  sequence: number,
  observedAt: string,
): Readonly<Record<string, unknown>> {
  return {
    'io.sdar/taskExecution': {
      revision: '1.0',
      remoteRevision: `provider-revision-${String(sequence + 1)}`,
      substate,
      eventId: `provider-event-${String(sequence + 1)}`,
      observedAt,
      progress: { percent },
    },
  };
}

function taskObservedAt(task: MockTaskState, sequence: number): string {
  return task.timeline[Math.min(sequence, task.timeline.length - 1)] ?? task.timeline[0];
}

function successfulToolResult(status: string, text: string): Readonly<Record<string, unknown>> {
  return {
    content: [{ type: 'text', text }],
    structuredContent: { status },
    isError: false,
  };
}

function successfulMoveResult(
  resourceId: string,
  target: Readonly<{ x: number; y: number; frame?: string }>,
  includeEvidence: boolean,
): Readonly<Record<string, unknown>> {
  return {
    content: [{ type: 'text', text: `Moved ${resourceId} to the permitted target.` }],
    structuredContent: {
      resourceId,
      status: 'completed',
      finalPosition: target,
    },
    isError: false,
    ...(includeEvidence ? { _meta: { 'io.sdar/evidence': { 'final-position': true } } } : {}),
  };
}

function successfulPatrolResult(
  result: NonNullable<MockTaskState['patrolResult']>,
): Readonly<Record<string, unknown>> {
  return {
    content: [
      {
        type: 'text',
        text: result.degraded
          ? `Patrol for ${result.resourceId} completed with one missing subregion.`
          : `Patrol for ${result.resourceId} completed with full evidence.`,
      },
    ],
    structuredContent: {
      status: result.degraded ? 'degraded' : 'completed',
      coveredSubregions: ['subregion-1'],
      missingSubregions: result.degraded ? ['subregion-2'] : [],
      trajectory: [{ resourceId: result.resourceId, position: result.target }],
      anomalies: [],
      ...(result.degraded
        ? {
            missingEffects: ['subregion-2 inspection'],
            missingEvidence: ['subregion-2 coverage'],
          }
        : {}),
    },
    isError: false,
    ...(result.includeEvidence
      ? {
          _meta: {
            'io.sdar/evidence': {
              'coverage-report': true,
              trajectory: true,
              'anomaly-report': true,
            },
          },
        }
      : {}),
  };
}

function areaPatrolTools(): readonly Readonly<Record<string, unknown>>[] {
  const taskExecution = {
    execution: 'task_capable',
    availability: 'dynamic',
    supportsScheduling: true,
    supportsMaxElapsed: true,
    supportsObservations: true,
    cancellation: 'task_cancel',
    revision: '1.0',
  };
  return [
    {
      name: 'embodied.area_patrol',
      description: 'Patrol one admitted area and return coverage, trajectory and anomaly evidence.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['resourceId', 'target', 'area', 'timeWindow'],
        properties: {
          resourceId: { type: 'string', minLength: 1 },
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
          area: { type: 'object' },
          timeWindow: { type: 'object' },
        },
      },
      _meta: { 'io.sdar/taskExecution': taskExecution },
    },
    {
      name: 'embodied.inspect_area',
      description: 'Inspect an admitted patrol area and return anomaly evidence.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['area'],
        properties: { area: { type: 'object' } },
      },
    },
  ];
}

function businessToolResult(
  outcome: string,
  reasonCode: string,
  retryable: boolean,
): Readonly<Record<string, unknown>> {
  return {
    content: [{ type: 'text', text: `${outcome}: ${reasonCode}` }],
    structuredContent: { outcome, reasonCode, retryable },
    isError: true,
  };
}

function approvalRequest(): Readonly<Record<string, unknown>> {
  return {
    method: 'elicitation/create',
    params: {
      mode: 'form',
      message: 'Approve the deterministic remote operation?',
      requestedSchema: {
        type: 'object',
        properties: { approved: { type: 'boolean' } },
        required: ['approved'],
        additionalProperties: false,
      },
    },
  };
}

function detailsRequest(): Readonly<Record<string, unknown>> {
  return {
    method: 'elicitation/create',
    params: {
      mode: 'form',
      message: 'Provide the deterministic execution note.',
      requestedSchema: {
        type: 'object',
        properties: { note: { type: 'string', minLength: 1, maxLength: 128 } },
        required: ['note'],
        additionalProperties: false,
      },
    },
  };
}

function malformedCreatedTask(
  name: string,
  malformed: 'taskId' | 'status' | 'field' | 'metadata',
): Readonly<Record<string, unknown>> {
  const task = {
    resultType: 'task',
    taskId: malformed === 'taskId' ? 'bad task id\r\nforged' : LEGACY_REMOTE_TASK_ID,
    status: malformed === 'status' ? 'paused' : 'working',
    createdAt: LEGACY_CREATED_AT,
    lastUpdatedAt: LEGACY_CREATED_AT,
    ttlMs: 3_600_000,
    pollIntervalMs: 50,
    _meta: {
      'io.sdar/taskExecution':
        malformed === 'metadata'
          ? { revision: '2.0', unexpected: true }
          : {
              revision: '1.0',
              remoteRevision: 'provider-revision-1',
              substate: 'queued',
              eventId: 'provider-event-1',
              observedAt: LEGACY_CREATED_AT,
              progress: { percent: 0 },
            },
    },
    ...(malformed === 'field' ? { unexpectedExecutableField: `reject-${name}` } : {}),
  };
  return task;
}

function timelineFrom(startedAt: number): readonly [string, string, string, string] {
  return [
    new Date(startedAt).toISOString(),
    new Date(startedAt + 20_000).toISOString(),
    new Date(startedAt + 40_000).toISOString(),
    new Date(startedAt + 60_000).toISOString(),
  ];
}

function requiredTask(
  params: Readonly<Record<string, unknown>>,
  state: MockProviderState,
): MockTaskState {
  const taskId = stringParam(params, 'taskId');
  const task = state.tasks.get(taskId);
  if (task === undefined) throw new Error(`Unknown Mock Provider Task ${taskId}.`);
  return task;
}

function isTaskCapableName(name: string): boolean {
  return name !== 'sync_success' && name !== 'rejected_without_task';
}

function isTaskScenario(name: string): name is TaskScenario {
  return (
    (PHASE_SIX_SCENARIOS as readonly string[]).includes(name) &&
    name !== 'sync_success' &&
    name !== 'task_restricted_reject'
  );
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

function numberParam(params: Readonly<Record<string, unknown>>, name: string): number {
  const value = params[name];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Mock Provider numeric parameter ${name} is required.`);
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
