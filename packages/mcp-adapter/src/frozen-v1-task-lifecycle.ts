import { z } from 'zod';

import {
  compareRuntimeRevisions,
  validateRuntimeRevision,
  type FrozenDetailedRemoteTask,
  type FrozenRemoteTaskBase,
  type FrozenRemoteTaskCreated,
  type FrozenTaskInvocationOutcome,
  type FrozenTaskObservationMeta,
  type FrozenTaskOperationAck,
  type InternalToolResult,
  type McpTaskCallProfile,
} from '../../domain/src/index.js';

import type { FrozenMcpRequestInput, FrozenV1McpClient } from './frozen-v1-mcp-client.js';
import {
  validateFrozenToolOutput,
  type FrozenOutputSchemaValidator,
} from './frozen-v1-evidence.js';

const MAX_CONTENT_BLOCKS = 128;
const MAX_INPUT_KEYS = 128;
const MAX_JSON_BYTES = 1_048_576;
const timestampSchema = z.iso.datetime({ offset: true });
const taskIdSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[\u0021-\u007e]+$/u);
const ttlSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const pollIntervalSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional();
const taskStatusSchema = z.enum(['working', 'input_required', 'completed', 'cancelled', 'failed']);
const inputResponseSchema = z
  .object({ action: z.enum(['accept', 'decline', 'cancel']), content: z.unknown().optional() })
  .strict();
const inputResponsesSchema = z
  .record(z.string().min(1).max(256), inputResponseSchema)
  .refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= MAX_INPUT_KEYS);
const elicitationRequestSchema = z
  .object({
    method: z.literal('elicitation/create'),
    params: z.object({ mode: z.literal('form') }).catchall(z.unknown()),
  })
  .strict();
const inputRequestsSchema = z
  .record(z.string().min(1).max(256), elicitationRequestSchema)
  .refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= MAX_INPUT_KEYS);
const taskExecutionMetaSchema = z
  .object({
    profileVersion: z.literal('1.0'),
    runtimeRevision: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/u),
    providerRevision: z.string().min(1).max(256).optional(),
    eventId: z.string().min(1).max(256).optional(),
    observedAt: timestampSchema.optional(),
    substate: z
      .enum(['accepted', 'scheduled', 'queued', 'running', 'paused', 'resuming', 'stopping'])
      .optional(),
    progress: z
      .object({ percent: z.number().min(0).max(100) })
      .strict()
      .optional(),
  })
  .strict();
const taskMetaSchema = z
  .object({
    'io.sdar/taskExecution': taskExecutionMetaSchema,
    'io.sdar/providerIdentity': z
      .object({
        profileVersion: z.literal('1.0'),
        providerId: z.string().min(1).max(256),
        providerInstanceId: z.string().min(1).max(256),
      })
      .strict()
      .optional(),
  })
  .catchall(z.unknown());
const toolResultSchema = z
  .object({
    resultType: z.literal('complete'),
    content: z.array(z.unknown()).max(MAX_CONTENT_BLOCKS),
    structuredContent: z.unknown().optional(),
    isError: z.boolean(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const taskBaseShape = {
  taskId: taskIdSchema,
  status: taskStatusSchema,
  statusMessage: z.string().max(4096).optional(),
  createdAt: timestampSchema,
  lastUpdatedAt: timestampSchema,
  ttlMs: ttlSchema,
  pollIntervalMs: pollIntervalSchema,
  _meta: taskMetaSchema,
};
const createTaskSchema = z.object({ resultType: z.literal('task'), ...taskBaseShape }).strict();
const workingTaskSchema = z
  .object({ resultType: z.literal('complete'), ...taskBaseShape, status: z.literal('working') })
  .strict();
const inputRequiredTaskSchema = z
  .object({
    resultType: z.literal('complete'),
    ...taskBaseShape,
    status: z.literal('input_required'),
    inputRequests: inputRequestsSchema,
  })
  .strict();
const completedTaskSchema = z
  .object({
    resultType: z.literal('complete'),
    ...taskBaseShape,
    status: z.literal('completed'),
    result: toolResultSchema,
  })
  .strict();
const failedTaskSchema = z
  .object({
    resultType: z.literal('complete'),
    ...taskBaseShape,
    status: z.literal('failed'),
    error: z
      .object({
        code: z.number().int(),
        message: z.string().min(1).max(4096),
        data: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
const cancelledTaskSchema = z
  .object({ resultType: z.literal('complete'), ...taskBaseShape, status: z.literal('cancelled') })
  .strict();
const detailedTaskSchema = z.discriminatedUnion('status', [
  workingTaskSchema,
  inputRequiredTaskSchema,
  completedTaskSchema,
  failedTaskSchema,
  cancelledTaskSchema,
]);
const taskAckSchema = z
  .object({
    resultType: z.literal('complete'),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

type FrozenInputKeyState = Readonly<{
  fingerprint: string;
  state: 'open' | 'answered' | 'superseded';
}>;

export interface FrozenTaskLifecycleState {
  readonly observations: Readonly<
    Record<
      string,
      Readonly<{
        runtimeRevision: string;
        fingerprint: string;
        terminal: boolean;
        projection?: 'create' | 'detailed';
      }>
    >
  >;
  readonly inputKeys: Readonly<Record<string, Readonly<Record<string, FrozenInputKeyState>>>>;
  readonly completedSubmissionKeys: readonly string[];
}

export interface FrozenTaskLifecycleClientOptions {
  readonly client: FrozenV1McpClient;
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly now: () => string;
  readonly restoredState?: FrozenTaskLifecycleState;
}

export interface FrozenToolOutputValidation {
  readonly outputSchema: unknown;
  readonly validator: FrozenOutputSchemaValidator;
}

export class FrozenTaskLifecycleClient {
  readonly #client: FrozenV1McpClient;
  readonly #requestBase: Pick<FrozenMcpRequestInput, 'endpoint' | 'headers'>;
  readonly #now: () => string;
  readonly #observations = new Map<
    string,
    {
      runtimeRevision: string;
      fingerprint: string;
      terminal: boolean;
      projection: 'create' | 'detailed';
    }
  >();
  readonly #inputKeys = new Map<
    string,
    Map<string, { fingerprint: string; state: FrozenInputKeyState['state'] }>
  >();
  readonly #completedSubmissionKeys = new Set<string>();

  constructor(options: FrozenTaskLifecycleClientOptions) {
    this.#client = options.client;
    this.#requestBase = { endpoint: options.endpoint, headers: options.headers };
    this.#now = options.now;
    this.#restore(options.restoredState);
  }

  async callTool(
    input: Readonly<{
      name: string;
      arguments: unknown;
      taskCallProfile?: McpTaskCallProfile;
      outputValidation?: FrozenToolOutputValidation;
    }>,
  ): Promise<FrozenTaskInvocationOutcome> {
    const raw = await this.#client.request({
      ...this.#requestBase,
      method: 'tools/call',
      params: {
        name: input.name,
        arguments: input.arguments,
        ...(input.taskCallProfile === undefined
          ? {}
          : { _meta: { 'io.sdar/taskExecution': input.taskCallProfile } }),
      },
    });
    const immediate = toolResultSchema.safeParse(raw);
    if (immediate.success)
      return {
        kind: 'immediate',
        result: mapToolResult(immediate.data, input.outputValidation),
      };
    const created = parseCreatedTask(raw, this.#now());
    this.#admitObservation(created, 'create');
    const reconciled = await this.getTask(created.taskId, input.outputValidation);
    return { kind: 'remote_task', created, reconciled };
  }

  async getTask(
    taskId: string,
    outputValidation?: FrozenToolOutputValidation,
  ): Promise<FrozenDetailedRemoteTask> {
    return (await this.getTaskAdmission(taskId, outputValidation)).task;
  }

  async getTaskAdmission(
    taskId: string,
    outputValidation?: FrozenToolOutputValidation,
  ): Promise<
    Readonly<{
      task: FrozenDetailedRemoteTask;
      accepted: boolean;
    }>
  > {
    const raw = await this.#client.request({
      ...this.#requestBase,
      method: 'tasks/get',
      params: { taskId },
    });
    const task = parseDetailedTask(raw, this.#now(), outputValidation);
    if (task.taskId !== taskId)
      throw lifecycleError('FROZEN_TASK_ID_MISMATCH', 'tasks/get returned a different Task ID.');
    const accepted = this.#admitObservation(task, 'detailed');
    this.#reconcileInputKeys(task);
    return { task, accepted };
  }

  admitNotification(
    value: unknown,
    outputValidation?: FrozenToolOutputValidation,
  ): Readonly<{ task: FrozenDetailedRemoteTask; accepted: boolean }> {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw lifecycleError(
        'FROZEN_DETAILED_TASK_INVALID',
        'Task Notification params must be a DetailedTask object.',
      );
    const task = parseDetailedTask(
      { ...value, resultType: 'complete' },
      this.#now(),
      outputValidation,
    );
    const accepted = this.#admitObservation(task, 'detailed');
    this.#reconcileInputKeys(task);
    return { task, accepted };
  }

  async updateTask(
    input: Readonly<{
      taskId: string;
      submissionKey: string;
      inputResponses: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<
    Readonly<{
      sent: boolean;
      acceptedKeys: readonly string[];
      ignoredKeys: readonly string[];
      ack?: FrozenTaskOperationAck;
    }>
  > {
    const submissionIdentity = `${input.taskId}\u0000${input.submissionKey}`;
    const requestedKeys = Object.keys(input.inputResponses).sort();
    if (this.#completedSubmissionKeys.has(submissionIdentity))
      return { sent: false, acceptedKeys: [], ignoredKeys: requestedKeys };
    const taskKeys = this.#inputKeys.get(input.taskId);
    const accepted: Record<string, unknown> = {};
    const ignored: string[] = [];
    for (const key of requestedKeys) {
      const state = taskKeys?.get(key);
      if (state?.state === 'open') accepted[key] = input.inputResponses[key];
      else ignored.push(key);
    }
    const parsed = inputResponsesSchema.safeParse(accepted);
    if (!parsed.success) {
      if (Object.keys(accepted).length === 0)
        return { sent: false, acceptedKeys: [], ignoredKeys: requestedKeys };
      throw lifecycleError(
        'FROZEN_TASK_INPUT_RESPONSES_INVALID',
        'Accepted Task input responses violate the frozen elicitation response contract.',
      );
    }
    const raw = await this.#client.request({
      ...this.#requestBase,
      method: 'tasks/update',
      params: { taskId: input.taskId, inputResponses: parsed.data },
    });
    parseAck(raw);
    for (const key of Object.keys(parsed.data)) {
      const state = taskKeys?.get(key);
      if (state !== undefined) state.state = 'answered';
    }
    this.#completedSubmissionKeys.add(submissionIdentity);
    return {
      sent: true,
      acceptedKeys: Object.keys(parsed.data).sort(),
      ignoredKeys: ignored,
      ack: { resultType: 'complete', meaning: 'input_update_received' },
    };
  }

  async cancelTask(taskId: string): Promise<FrozenTaskOperationAck> {
    parseAck(
      await this.#client.request({
        ...this.#requestBase,
        method: 'tasks/cancel',
        params: { taskId },
      }),
    );
    return { resultType: 'complete', meaning: 'cancellation_intent_received' };
  }

  exportState(): FrozenTaskLifecycleState {
    return Object.freeze({
      observations: Object.freeze(Object.fromEntries(this.#observations)),
      inputKeys: Object.freeze(
        Object.fromEntries(
          [...this.#inputKeys].map(([taskId, keys]) => [
            taskId,
            Object.freeze(Object.fromEntries(keys)),
          ]),
        ),
      ),
      completedSubmissionKeys: Object.freeze([...this.#completedSubmissionKeys].sort()),
    });
  }

  #admitObservation(task: FrozenRemoteTaskBase, projection: 'create' | 'detailed'): boolean {
    const fingerprint = canonicalJson({ ...task, resultType: undefined });
    const baseFingerprint = canonicalJson({
      ...task,
      resultType: undefined,
      inputRequests: undefined,
      result: undefined,
      error: undefined,
    });
    const previous = this.#observations.get(task.taskId);
    if (previous !== undefined) {
      const order = compareRuntimeRevisions(
        task.observation.runtimeRevision,
        previous.runtimeRevision,
      );
      if (order < 0)
        throw lifecycleError('FROZEN_TASK_REVISION_REGRESSION', 'Task runtimeRevision regressed.');
      const isInitialDetailedProjection =
        order === 0 && previous.projection === 'create' && projection === 'detailed';
      if (isInitialDetailedProjection && baseFingerprint !== previous.fingerprint)
        throw lifecycleError(
          'FROZEN_TASK_REVISION_CONTENT_MISMATCH',
          'The same Task runtimeRevision represented different Task base content.',
        );
      if (order === 0 && fingerprint !== previous.fingerprint && !isInitialDetailedProjection)
        throw lifecycleError(
          'FROZEN_TASK_REVISION_CONTENT_MISMATCH',
          'The same Task runtimeRevision represented different Task content.',
        );
      if (previous.terminal && !isTerminal(task.status))
        throw lifecycleError(
          'FROZEN_TASK_TERMINAL_ROLLBACK',
          'A terminal Task returned to a non-terminal state.',
        );
      if (order === 0 && !isInitialDetailedProjection) return false;
    }
    this.#observations.set(task.taskId, {
      runtimeRevision: task.observation.runtimeRevision,
      fingerprint,
      terminal: isTerminal(task.status),
      projection,
    });
    return true;
  }

  #reconcileInputKeys(task: FrozenDetailedRemoteTask): void {
    const known =
      this.#inputKeys.get(task.taskId) ??
      new Map<string, { fingerprint: string; state: FrozenInputKeyState['state'] }>();
    const current = task.status === 'input_required' ? task.inputRequests : {};
    for (const [key, request] of Object.entries(current)) {
      const fingerprint = canonicalJson(request);
      const prior = known.get(key);
      if (prior !== undefined && prior.fingerprint !== fingerprint)
        throw lifecycleError(
          'FROZEN_TASK_INPUT_KEY_REUSED',
          'An input request key was reused for different request content.',
        );
      if (prior === undefined) known.set(key, { fingerprint, state: 'open' });
    }
    for (const [key, value] of known) {
      if (!(key in current) && value.state === 'open') value.state = 'superseded';
    }
    this.#inputKeys.set(task.taskId, known);
  }

  #restore(state: FrozenTaskLifecycleState | undefined): void {
    if (state === undefined) return;
    for (const [taskId, observation] of Object.entries(state.observations))
      this.#observations.set(taskId, {
        ...observation,
        projection: observation.projection ?? 'detailed',
      });
    for (const [taskId, keys] of Object.entries(state.inputKeys))
      this.#inputKeys.set(
        taskId,
        new Map(Object.entries(keys).map(([key, value]) => [key, { ...value }])),
      );
    for (const key of state.completedSubmissionKeys) this.#completedSubmissionKeys.add(key);
  }
}

export function parseCreatedTask(value: unknown, observedAt: string): FrozenRemoteTaskCreated {
  const parsed = createTaskSchema.safeParse(value);
  if (!parsed.success)
    throw lifecycleError(
      'FROZEN_CREATE_TASK_RESULT_INVALID',
      'tools/call returned neither a frozen CallToolResult nor a flat CreateTaskResult.',
    );
  return { resultType: 'task', ...mapTaskBase(parsed.data, observedAt) };
}

export function parseDetailedTask(
  value: unknown,
  observedAt: string,
  outputValidation?: FrozenToolOutputValidation,
): FrozenDetailedRemoteTask {
  const parsed = detailedTaskSchema.safeParse(value);
  if (!parsed.success)
    throw lifecycleError(
      'FROZEN_DETAILED_TASK_INVALID',
      'tasks/get returned an invalid frozen DetailedTask.',
    );
  const base = mapTaskBase(parsed.data, observedAt);
  switch (parsed.data.status) {
    case 'working':
      return { ...base, resultType: 'complete', status: 'working' };
    case 'input_required':
      return {
        ...base,
        resultType: 'complete',
        status: 'input_required',
        inputRequests: Object.freeze({ ...parsed.data.inputRequests }),
      };
    case 'completed':
      return {
        ...base,
        resultType: 'complete',
        status: 'completed',
        result: mapToolResult(parsed.data.result, outputValidation),
      };
    case 'failed':
      return { ...base, resultType: 'complete', status: 'failed', error: parsed.data.error };
    case 'cancelled':
      return { ...base, resultType: 'complete', status: 'cancelled' };
  }
}

function mapTaskBase(
  value: z.output<typeof createTaskSchema> | z.output<typeof detailedTaskSchema>,
  observedAt: string,
): FrozenRemoteTaskBase {
  assertBoundedJson(value);
  const createdAtMs = Date.parse(value.createdAt);
  const expiresAt =
    value.ttlMs === null ? undefined : new Date(createdAtMs + value.ttlMs).toISOString();
  if (expiresAt !== undefined && Date.parse(observedAt) > Date.parse(expiresAt))
    throw lifecycleError(
      'FROZEN_TASK_TTL_EXPIRED',
      'Task TTL expired before observation admission.',
    );
  const meta = value._meta['io.sdar/taskExecution'];
  const observation: FrozenTaskObservationMeta = {
    profileVersion: '1.0',
    runtimeRevision: validateRuntimeRevision(meta.runtimeRevision),
    ...(meta.providerRevision === undefined ? {} : { providerRevision: meta.providerRevision }),
    ...(meta.eventId === undefined ? {} : { eventId: meta.eventId }),
    ...(meta.observedAt === undefined ? {} : { observedAt: meta.observedAt }),
    ...(meta.substate === undefined ? {} : { substate: meta.substate }),
    ...(meta.progress === undefined ? {} : { progress: meta.progress }),
  };
  if (
    isTerminal(value.status) &&
    (observation.substate !== undefined || observation.progress !== undefined)
  )
    throw lifecycleError(
      'FROZEN_TASK_TERMINAL_METADATA_INVALID',
      'Terminal Tasks cannot retain mutable substate or progress metadata.',
    );
  return Object.freeze({
    protocolMode: 'frozen_v1',
    ...(value._meta['io.sdar/providerIdentity'] === undefined
      ? {}
      : {
          providerIdentity: Object.freeze(value._meta['io.sdar/providerIdentity']),
        }),
    taskId: value.taskId,
    status: value.status,
    ...(value.statusMessage === undefined ? {} : { statusMessage: value.statusMessage }),
    createdAt: value.createdAt,
    lastUpdatedAt: value.lastUpdatedAt,
    ttlMs: value.ttlMs,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(value.pollIntervalMs === undefined ? {} : { pollIntervalMs: value.pollIntervalMs }),
    observation: Object.freeze(observation),
  });
}

function mapToolResult(
  value: z.output<typeof toolResultSchema>,
  outputValidation?: FrozenToolOutputValidation,
): InternalToolResult {
  assertBoundedJson(value);
  return validateFrozenToolOutput(
    Object.freeze({
      content: Object.freeze([...value.content]),
      ...(value.structuredContent === undefined
        ? {}
        : { structuredContent: value.structuredContent }),
      isError: value.isError,
      ...(value._meta === undefined ? {} : { metadata: Object.freeze({ ...value._meta }) }),
    }),
    outputValidation,
  );
}

function parseAck(value: unknown): void {
  if (!taskAckSchema.safeParse(value).success)
    throw lifecycleError(
      'FROZEN_TASK_ACK_INVALID',
      'tasks/update and tasks/cancel must return an empty complete acknowledgement.',
    );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

function assertBoundedJson(value: unknown): void {
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > MAX_JSON_BYTES)
    throw lifecycleError('FROZEN_TASK_RESPONSE_TOO_LARGE', 'Frozen Task response exceeds one MiB.');
}

function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export type FrozenTaskLifecycleErrorCode =
  | 'FROZEN_CREATE_TASK_RESULT_INVALID'
  | 'FROZEN_DETAILED_TASK_INVALID'
  | 'FROZEN_TASK_ID_MISMATCH'
  | 'FROZEN_TASK_TTL_EXPIRED'
  | 'FROZEN_TASK_REVISION_REGRESSION'
  | 'FROZEN_TASK_REVISION_CONTENT_MISMATCH'
  | 'FROZEN_TASK_TERMINAL_ROLLBACK'
  | 'FROZEN_TASK_TERMINAL_METADATA_INVALID'
  | 'FROZEN_TASK_INPUT_KEY_REUSED'
  | 'FROZEN_TASK_INPUT_RESPONSES_INVALID'
  | 'FROZEN_TASK_ACK_INVALID'
  | 'FROZEN_TASK_RESPONSE_TOO_LARGE';

export class FrozenTaskLifecycleError extends Error {
  readonly code: FrozenTaskLifecycleErrorCode;
  constructor(code: FrozenTaskLifecycleErrorCode, message: string) {
    super(message);
    this.name = 'FrozenTaskLifecycleError';
    this.code = code;
  }
}

function lifecycleError(
  code: FrozenTaskLifecycleErrorCode,
  message: string,
): FrozenTaskLifecycleError {
  return new FrozenTaskLifecycleError(code, message);
}
