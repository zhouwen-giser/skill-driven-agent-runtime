import {
  createRemoteTaskInputLink,
  createTaskInputRequest,
  normalizeRemoteTaskInputResponses,
  type AgentTask,
  type RemoteTaskBinding,
  type RemoteTaskControlEvent,
} from '../../domain/src/index.js';

import type {
  AgentTaskRepository,
  Clock,
  ContextSerialGate,
  JsonSchemaValidator,
  RemoteTaskContinuationJob,
  RemoteTaskInputAttempt,
  RemoteTaskInputAttemptStatus,
  RemoteTaskInputRepository,
  RemoteTaskInputSender,
  RemoteTaskPollQueue,
  RemoteTaskRepository,
  RuntimeEventPublisher,
  WorkflowContinuationRepository,
} from './ports.js';

export class RemoteTaskInputService {
  readonly #continuations: Pick<WorkflowContinuationRepository, 'claimControl'>;
  readonly #remoteTasks: Pick<RemoteTaskRepository, 'findById'>;
  readonly #inputs: RemoteTaskInputRepository;
  readonly #tasks: Pick<AgentTaskRepository, 'findById'>;
  readonly #events: RuntimeEventPublisher;
  readonly #sender: RemoteTaskInputSender;
  readonly #pollQueue: RemoteTaskPollQueue;
  readonly #schemas: JsonSchemaValidator;
  readonly #serial: ContextSerialGate;
  readonly #clock: Clock;
  readonly #ids: Readonly<{
    nextInputRequestId(): string;
    nextClaimToken(): string;
    nextProtocolAttemptId(): string;
    nextEventId(): string;
  }>;
  readonly #claimLeaseMs: number;
  readonly #onTaskChanged: ((task: AgentTask) => void) | undefined;

  constructor(
    dependencies: Readonly<{
      continuations: Pick<WorkflowContinuationRepository, 'claimControl'>;
      remoteTasks: Pick<RemoteTaskRepository, 'findById'>;
      inputs: RemoteTaskInputRepository;
      tasks: Pick<AgentTaskRepository, 'findById'>;
      events: RuntimeEventPublisher;
      sender: RemoteTaskInputSender;
      pollQueue: RemoteTaskPollQueue;
      schemas: JsonSchemaValidator;
      serial: ContextSerialGate;
      clock: Clock;
      ids: Readonly<{
        nextInputRequestId(): string;
        nextClaimToken(): string;
        nextProtocolAttemptId(): string;
        nextEventId(): string;
      }>;
      claimLeaseMs?: number;
      onTaskChanged?: (task: AgentTask) => void;
    }>,
  ) {
    this.#continuations = dependencies.continuations;
    this.#remoteTasks = dependencies.remoteTasks;
    this.#inputs = dependencies.inputs;
    this.#tasks = dependencies.tasks;
    this.#events = dependencies.events;
    this.#sender = dependencies.sender;
    this.#pollQueue = dependencies.pollQueue;
    this.#schemas = dependencies.schemas;
    this.#serial = dependencies.serial;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#claimLeaseMs = dependencies.claimLeaseMs ?? 30_000;
    this.#onTaskChanged = dependencies.onTaskChanged;
  }

  async process(
    event: RemoteTaskContinuationJob,
  ): Promise<'activated' | 'deferred' | 'not_claimed'> {
    if (event.eventType !== 'task.input_required') return 'not_claimed';
    const binding = await this.#remoteTasks.findById(event.bindingId);
    if (binding === undefined) return 'not_claimed';
    return this.#serial.run(binding.contextId, () => this.#activate(event, binding));
  }

  async prepareResponse(inputRequestId: string, inputContent: unknown) {
    const link = await this.#inputs.findLink(inputRequestId);
    if (link?.status !== 'waiting')
      throw new RemoteTaskInputError(
        'REMOTE_TASK_INPUT_LINK_NOT_WAITING',
        'The remote Task input link is no longer waiting.',
      );
    const normalized = normalizeRemoteTaskInputResponses(link.inputRequests, inputContent);
    const responses: Record<string, unknown> = {};
    for (const [key, rawResponse] of Object.entries(normalized)) {
      const request = requiredRecord(link.inputRequests[key], 'REMOTE_TASK_INPUT_REQUEST_INVALID');
      const params = requiredRecord(request['params'], 'REMOTE_TASK_INPUT_REQUEST_INVALID');
      const schema = params['requestedSchema'];
      const response =
        typeof rawResponse === 'string'
          ? textElicitationResponse(schema, rawResponse, this.#schemas)
          : validateElicitationResponse(schema, rawResponse, this.#schemas);
      responses[key] = response;
    }
    return Object.freeze(responses);
  }

  async submitAnswer(inputRequestId: string, inputResponses: unknown): Promise<void> {
    const link = await this.#inputs.findLink(inputRequestId);
    if (link?.status !== 'answered')
      throw new RemoteTaskInputError(
        'REMOTE_TASK_INPUT_LINK_NOT_ANSWERED',
        'The remote Task input link is not ready for tasks/update.',
      );
    const binding = await this.#remoteTasks.findById(link.bindingId);
    if (binding?.localState !== 'awaiting_input')
      throw new RemoteTaskInputError(
        'REMOTE_TASK_INPUT_BINDING_STALE',
        'The remote Task input binding is no longer awaiting this answer.',
      );
    const responses = normalizeRemoteTaskInputResponses(link.inputRequests, inputResponses);
    const startedAt = this.#clock.now();
    let status: RemoteTaskInputAttemptStatus = 'acknowledged';
    let protocolRevision: string | undefined;
    let errorCode: string | undefined;
    try {
      const ack = await this.#sender.updateRemoteTask({
        serverId: binding.serverId,
        remoteTaskId: binding.remoteTaskId,
        inputResponses: responses,
        executionContext: binding.executionContext,
      });
      protocolRevision = ack.protocolRevision;
    } catch (error: unknown) {
      ({ status, errorCode } = classifyUpdateFailure(error));
    }
    const completedAt = this.#clock.now();
    const attempt: RemoteTaskInputAttempt = {
      attemptId: this.#ids.nextProtocolAttemptId(),
      inputRequestId,
      bindingId: binding.bindingId,
      expectedBindingVersion: binding.version,
      status,
      ...(protocolRevision === undefined ? {} : { protocolRevision }),
      ...(errorCode === undefined ? {} : { errorCode }),
      startedAt,
      completedAt,
      durationMs: duration(startedAt, completedAt),
    };
    const recorded = await this.#inputs.recordUpdateOutcome({
      inputRequestId,
      expectedBindingVersion: binding.version,
      attempt,
      status: status === 'acknowledged' ? 'update_acknowledged' : 'update_uncertain',
      observedAt: completedAt,
    });
    if (!recorded.applied)
      throw new RemoteTaskInputError(
        'REMOTE_TASK_INPUT_BINDING_STALE',
        'The remote Task input outcome lost its authoritative binding race.',
      );
    const refreshed = await this.#remoteTasks.findById(binding.bindingId);
    if (refreshed?.nextPollAt !== undefined)
      try {
        await this.#pollQueue.enqueue(
          { bindingId: refreshed.bindingId, expectedVersion: refreshed.version },
          refreshed.nextPollAt,
        );
      } catch {
        // PostgreSQL polling reconciliation repairs the explicit enqueue gap.
      }
  }

  async #activate(
    event: RemoteTaskContinuationJob,
    binding: RemoteTaskBinding,
  ): Promise<'activated' | 'deferred' | 'not_claimed'> {
    const claimedAt = this.#clock.now();
    const claimToken = this.#ids.nextClaimToken();
    const control = await this.#continuations.claimControl({
      eventId: event.eventId,
      claimToken,
      claimedAt,
      expiresAt: addMilliseconds(claimedAt, this.#claimLeaseMs),
    });
    if (control === undefined) return 'not_claimed';
    const snapshot = inputRequiredSnapshot(control);
    const inputRequestId = this.#ids.nextInputRequestId();
    const request = createTaskInputRequest({
      inputRequestId,
      taskId: binding.agentTaskId,
      contextId: binding.contextId,
      source: 'remote_task',
      question: inputQuestion(snapshot.inputRequests),
      createdAt: claimedAt,
    });
    const link = createRemoteTaskInputLink({
      inputRequestId,
      controlEventId: control.eventId,
      bindingId: binding.bindingId,
      remoteTaskId: binding.remoteTaskId,
      workflowInstanceId: binding.workflowInstanceId,
      workflowNodeId: binding.workflowNodeId,
      workflowNodeRunId: binding.workflowNodeRunId,
      remoteRevision: control.remoteRevision ?? binding.remoteRevision ?? binding.protocolRevision,
      resultHash: control.resultHash,
      inputRequests: snapshot.inputRequests,
      createdAt: claimedAt,
    });
    const phaseMessage = 'Remote MCP Task requires supplementary input.';
    const activated = await this.#inputs.activate({
      request,
      link,
      claimToken,
      processedAt: claimedAt,
      phaseMessage,
    });
    if (!activated) return 'deferred';
    const task = await this.#tasks.findById(binding.agentTaskId);
    if (task !== undefined) this.#onTaskChanged?.(task);
    await this.#events.publish({
      eventId: this.#ids.nextEventId(),
      taskId: binding.agentTaskId,
      contextId: binding.contextId,
      eventType: 'task.phase_changed',
      timestamp: claimedAt,
      summary: phaseMessage,
    });
    return 'activated';
  }
}

function inputRequiredSnapshot(event: RemoteTaskControlEvent): Readonly<{
  inputRequests: Readonly<Record<string, unknown>>;
}> {
  const payload = requiredRecord(event.payload, 'REMOTE_TASK_INPUT_CONTROL_INVALID');
  if (event.type !== 'task.input_required' || payload['status'] !== 'input_required')
    throw new RemoteTaskInputError(
      'REMOTE_TASK_INPUT_CONTROL_INVALID',
      'The remote Task control is not input_required evidence.',
    );
  return {
    inputRequests: requiredRecord(payload['inputRequests'], 'REMOTE_TASK_INPUT_CONTROL_INVALID'),
  };
}

function inputQuestion(requests: Readonly<Record<string, unknown>>): string {
  return Object.entries(requests)
    .map(([key, request]) => {
      const params = requiredRecord(
        requiredRecord(request, 'REMOTE_TASK_INPUT_REQUEST_INVALID')['params'],
        'REMOTE_TASK_INPUT_REQUEST_INVALID',
      );
      return `${key}: ${String(params['message'])}`;
    })
    .join('\n');
}

function textElicitationResponse(
  schema: unknown,
  text: string,
  validator: JsonSchemaValidator,
): Readonly<{ action: 'accept'; content: Readonly<Record<string, unknown>> }> {
  const schemaRecord = requiredRecord(schema, 'REMOTE_TASK_INPUT_REQUEST_INVALID');
  const properties = requiredRecord(schemaRecord['properties'], 'REMOTE_TASK_INPUT_TEXT_AMBIGUOUS');
  const keys = Object.keys(properties);
  const key = keys[0];
  if (keys.length !== 1 || key === undefined)
    throw new RemoteTaskInputError(
      'REMOTE_TASK_INPUT_TEXT_AMBIGUOUS',
      'Text input requires an elicitation schema with exactly one property.',
    );
  const content = { [key]: text };
  assertSchemaValue(validator, schema, content);
  return Object.freeze({ action: 'accept', content: Object.freeze(content) });
}

function validateElicitationResponse(
  schema: unknown,
  value: unknown,
  validator: JsonSchemaValidator,
): Readonly<Record<string, unknown>> {
  const response = requiredRecord(value, 'REMOTE_TASK_INPUT_RESPONSE_INVALID');
  const action = response['action'];
  if (action !== 'accept' && action !== 'decline' && action !== 'cancel')
    throw new RemoteTaskInputError(
      'REMOTE_TASK_INPUT_RESPONSE_INVALID',
      'Elicitation response action must be accept, decline or cancel.',
    );
  if (action === 'accept') {
    if (!('content' in response))
      throw new RemoteTaskInputError(
        'REMOTE_TASK_INPUT_RESPONSE_INVALID',
        'Accepted elicitation response requires content.',
      );
    assertSchemaValue(validator, schema, response['content']);
  } else if ('content' in response)
    throw new RemoteTaskInputError(
      'REMOTE_TASK_INPUT_RESPONSE_INVALID',
      'Declined or canceled elicitation response must not contain content.',
    );
  return response;
}

function assertSchemaValue(validator: JsonSchemaValidator, schema: unknown, value: unknown): void {
  const checked = validator.checkSchema(schema);
  const validated = checked.valid ? validator.validate(schema, value) : checked;
  if (!validated.valid)
    throw new RemoteTaskInputError(
      'REMOTE_TASK_INPUT_SCHEMA_MISMATCH',
      `Remote Task input does not match requestedSchema: ${validated.errors.join('; ')}`,
    );
}

function requiredRecord(value: unknown, code: RemoteTaskInputErrorCode) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new RemoteTaskInputError(code, 'Remote Task input evidence must be a JSON object.');
  return value as Readonly<Record<string, unknown>>;
}

function classifyUpdateFailure(error: unknown): Readonly<{
  status: Exclude<RemoteTaskInputAttemptStatus, 'acknowledged'>;
  errorCode: string;
}> {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'MCP_TASK_UPDATE_PROVIDER_UNREACHABLE';
  if (code === 'MCP_TASK_RESPONSE_INVALID' || code === 'MCP_TASK_RESPONSE_TOO_LARGE')
    return { status: 'contract_invalid', errorCode: code };
  if (
    code === 'MCP_TASK_CAPABILITY_REQUIRED' ||
    code === 'MCP_TASK_PROTOCOL_REVISION_UNSUPPORTED' ||
    code === 'MCP_SERVER_NOT_FOUND'
  )
    return { status: 'provider_protocol', errorCode: code };
  return { status: 'provider_unreachable', errorCode: 'MCP_TASK_UPDATE_PROVIDER_UNREACHABLE' };
}

function duration(startedAt: string, completedAt: string): number {
  const value = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) throw new Error('REMOTE_TASK_INPUT_CLOCK_INVALID');
  return new Date(parsed + milliseconds).toISOString();
}

export type RemoteTaskInputErrorCode =
  | 'REMOTE_TASK_INPUT_CONTROL_INVALID'
  | 'REMOTE_TASK_INPUT_REQUEST_INVALID'
  | 'REMOTE_TASK_INPUT_RESPONSE_INVALID'
  | 'REMOTE_TASK_INPUT_SCHEMA_MISMATCH'
  | 'REMOTE_TASK_INPUT_TEXT_AMBIGUOUS'
  | 'REMOTE_TASK_INPUT_LINK_NOT_WAITING'
  | 'REMOTE_TASK_INPUT_LINK_NOT_ANSWERED'
  | 'REMOTE_TASK_INPUT_BINDING_STALE';

export class RemoteTaskInputError extends Error {
  readonly code: RemoteTaskInputErrorCode;

  constructor(code: RemoteTaskInputErrorCode, message: string) {
    super(message);
    this.name = 'RemoteTaskInputError';
    this.code = code;
  }
}
