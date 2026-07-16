/*
 * Protocol shapes adapted from modelcontextprotocol/ext-tasks
 * commit 8966bea9c4f4e6d71060cc8284a539086e9e234f,
 * schema/draft/schema.ts blob 2634c47c2b25ac8fafe7fadaa7dd3f3b732c0abc.
 * Licensed Apache-2.0. Modified by zhouwen for bounded, fail-closed SDAR
 * client-side validation and protocol-neutral DTO mapping.
 */
import { z } from 'zod';

import type {
  InternalToolResult,
  McpInvocationOutcome,
  RemoteTaskCreated,
  RemoteTaskProviderObservation,
  RemoteTaskSnapshot,
} from '../../domain/src/index.js';

export const MCP_TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';
export const MCP_TASKS_SCHEMA_REVISION =
  'ext-tasks@8966bea9c4f4e6d71060cc8284a539086e9e234f/schema.ts@2634c47c2b25ac8fafe7fadaa7dd3f3b732c0abc';
export const MCP_TASKS_TESTED_PROTOCOL_REVISION = '2026-07-28';

export const MCP_TASKS_METHOD_ALIASES = Object.freeze({
  callTool: 'io.sdar.mcp-tasks-bridge/tools/call',
  get: 'io.sdar.mcp-tasks-bridge/tasks/get',
  update: 'io.sdar.mcp-tasks-bridge/tasks/update',
  cancel: 'io.sdar.mcp-tasks-bridge/tasks/cancel',
});

export const MCP_TASKS_WIRE_METHODS = Object.freeze({
  [MCP_TASKS_METHOD_ALIASES.callTool]: 'tools/call',
  [MCP_TASKS_METHOD_ALIASES.get]: 'tasks/get',
  [MCP_TASKS_METHOD_ALIASES.update]: 'tasks/update',
  [MCP_TASKS_METHOD_ALIASES.cancel]: 'tasks/cancel',
} as const);

const MAX_TASK_ID_LENGTH = 512;
const MAX_STATUS_MESSAGE_LENGTH = 4_096;
const MAX_INPUT_ENTRIES = 128;
const MAX_CONTENT_BLOCKS = 128;
const MAX_JSON_BYTES = 1_048_576;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_ENTRIES = 1_024;
const MAX_JSON_STRING_LENGTH = 131_072;

const taskIdSchema = z
  .string()
  .min(1)
  .max(MAX_TASK_ID_LENGTH)
  .regex(/^[\u0021-\u007e]+$/u, 'Task ID must be a visible ASCII HTTP Header value.');
const timestampSchema = z.iso.datetime({ offset: true });
const boundedMillisecondsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const metadataSchema = z.record(z.string().min(1).max(256), z.unknown());
const providerObservationSchema = z.strictObject({
  revision: z.literal('1.0'),
  remoteRevision: z.string().min(1).max(256).optional(),
  substate: z.enum(['scheduled', 'queued', 'running', 'paused', 'resuming', 'stopping']).optional(),
  eventId: z.string().min(1).max(256).optional(),
  observedAt: timestampSchema.optional(),
  progress: z.strictObject({ percent: z.number().min(0).max(100) }).optional(),
});
const taskStatusSchema = z.enum(['working', 'input_required', 'completed', 'failed', 'cancelled']);
const MCP_TASK_EXECUTION_METADATA_KEY = 'io.sdar/taskExecution';

const taskBaseShape = {
  taskId: taskIdSchema,
  status: taskStatusSchema,
  statusMessage: z.string().max(MAX_STATUS_MESSAGE_LENGTH).optional(),
  createdAt: timestampSchema,
  lastUpdatedAt: timestampSchema,
  ttlMs: boundedMillisecondsSchema.nullable(),
  pollIntervalMs: boundedMillisecondsSchema.positive().optional(),
  _meta: metadataSchema.optional(),
};

const wireToolResultSchema = z.strictObject({
  content: z.array(z.unknown()).max(MAX_CONTENT_BLOCKS),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
  _meta: metadataSchema.optional(),
});

const wireCreatedTaskSchema = z.strictObject({
  resultType: z.literal('task'),
  ...taskBaseShape,
});

const workingTaskSchema = z.strictObject({
  ...taskBaseShape,
  status: z.literal('working'),
});
const inputRequiredTaskSchema = z.strictObject({
  ...taskBaseShape,
  status: z.literal('input_required'),
  inputRequests: z.record(z.string().min(1).max(256), z.unknown()),
});
const completedTaskSchema = z.strictObject({
  ...taskBaseShape,
  status: z.literal('completed'),
  result: wireToolResultSchema,
});
const failedTaskSchema = z.strictObject({
  ...taskBaseShape,
  status: z.literal('failed'),
  error: z.strictObject({
    code: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    message: z.string().min(1).max(MAX_STATUS_MESSAGE_LENGTH),
    data: z.unknown().optional(),
  }),
});
const cancelledTaskSchema = z.strictObject({
  ...taskBaseShape,
  status: z.literal('cancelled'),
});

export const mcpTaskSnapshotResultSchema = z.discriminatedUnion('status', [
  workingTaskSchema,
  inputRequiredTaskSchema,
  completedTaskSchema,
  failedTaskSchema,
  cancelledTaskSchema,
]);

export const mcpTaskAckResultSchema = z.strictObject({
  _meta: metadataSchema.optional(),
});

export function createMcpToolCallResultSchema(bridgeNonce: string) {
  const bridgedTaskSchema = z
    .strictObject({
      __sdarBridgeNonce: z.literal(bridgeNonce),
      __sdarExtensionTask: wireCreatedTaskSchema,
    })
    .transform((value) => value.__sdarExtensionTask);
  return z.union([wireToolResultSchema, bridgedTaskSchema]);
}

export function toMcpInvocationOutcome(
  value: z.output<ReturnType<typeof createMcpToolCallResultSchema>>,
  protocolRevision: string,
): McpInvocationOutcome {
  assertBoundedJson(value, 'MCP_TASK_RESPONSE_TOO_LARGE');
  if ('resultType' in value) {
    return { kind: 'remote_task', task: toRemoteTaskCreated(value, protocolRevision) };
  }
  return { kind: 'immediate', result: toInternalToolResult(value) };
}

export function toRemoteTaskSnapshot(
  value: z.output<typeof mcpTaskSnapshotResultSchema>,
  protocolRevision: string,
): RemoteTaskSnapshot {
  assertBoundedJson(value, 'MCP_TASK_RESPONSE_TOO_LARGE');
  const base = {
    remoteTaskId: value.taskId,
    ...(value.statusMessage === undefined ? {} : { statusMessage: value.statusMessage }),
    createdAt: value.createdAt,
    lastUpdatedAt: value.lastUpdatedAt,
    ttlMs: value.ttlMs,
    ...(value.pollIntervalMs === undefined ? {} : { pollIntervalMs: value.pollIntervalMs }),
    protocolRevision,
    tasksSchemaRevision: MCP_TASKS_SCHEMA_REVISION,
    ...providerObservationFields(value._meta, value.status === 'input_required'),
  };
  switch (value.status) {
    case 'working':
      return { ...base, status: 'working' };
    case 'input_required':
      return { ...base, status: 'input_required', inputRequests: value.inputRequests };
    case 'completed':
      return { ...base, status: 'completed', result: toInternalToolResult(value.result) };
    case 'failed':
      return { ...base, status: 'failed', error: value.error };
    case 'cancelled':
      return { ...base, status: 'cancelled' };
  }
}

export function assertValidRemoteTaskId(remoteTaskId: string): string {
  const parsed = taskIdSchema.safeParse(remoteTaskId);
  if (!parsed.success) {
    throw new McpTasksAdapterError('MCP_TASK_ID_INVALID', 'Remote Task ID is malformed.');
  }
  return parsed.data;
}

export function assertValidInputResponses(
  inputResponses: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const parsed = z
    .record(z.string().min(1).max(256), z.unknown())
    .refine((value) => Object.keys(value).length <= MAX_INPUT_ENTRIES)
    .safeParse(inputResponses);
  if (!parsed.success) {
    throw new McpTasksAdapterError(
      'MCP_TASK_INPUT_RESPONSES_INVALID',
      'Task input responses are malformed or exceed the entry limit.',
    );
  }
  assertBoundedJson(parsed.data, 'MCP_TASK_INPUT_RESPONSES_INVALID');
  return parsed.data;
}

function toRemoteTaskCreated(
  value: z.output<typeof wireCreatedTaskSchema>,
  protocolRevision: string,
): RemoteTaskCreated {
  return {
    remoteTaskId: value.taskId,
    status: value.status,
    ...(value.statusMessage === undefined ? {} : { statusMessage: value.statusMessage }),
    createdAt: value.createdAt,
    lastUpdatedAt: value.lastUpdatedAt,
    ttlMs: value.ttlMs,
    ...(value.pollIntervalMs === undefined ? {} : { pollIntervalMs: value.pollIntervalMs }),
    protocolRevision,
    tasksSchemaRevision: MCP_TASKS_SCHEMA_REVISION,
    ...providerObservationFields(value._meta, false),
  };
}

function providerObservationFields(
  metadata: Readonly<Record<string, unknown>> | undefined,
  requireRemoteRevision: boolean,
): Readonly<{ providerObservation?: RemoteTaskProviderObservation }> {
  const raw = metadata?.[MCP_TASK_EXECUTION_METADATA_KEY];
  if (raw === undefined) {
    if (requireRemoteRevision) {
      throw new McpTasksAdapterError(
        'MCP_TASK_RESPONSE_INVALID',
        'input_required Task snapshot must carry a stable remote revision.',
      );
    }
    return {};
  }
  const parsed = providerObservationSchema.safeParse(raw);
  if (!parsed.success || (requireRemoteRevision && parsed.data.remoteRevision === undefined)) {
    throw new McpTasksAdapterError(
      'MCP_TASK_RESPONSE_INVALID',
      'Provider Task observation metadata is malformed.',
    );
  }
  return {
    providerObservation: {
      revision: parsed.data.revision,
      ...(parsed.data.remoteRevision === undefined
        ? {}
        : { remoteRevision: parsed.data.remoteRevision }),
      ...(parsed.data.substate === undefined ? {} : { substate: parsed.data.substate }),
      ...(parsed.data.eventId === undefined ? {} : { eventId: parsed.data.eventId }),
      ...(parsed.data.observedAt === undefined ? {} : { observedAt: parsed.data.observedAt }),
      ...(parsed.data.progress === undefined ? {} : { progress: parsed.data.progress }),
    },
  };
}

function toInternalToolResult(value: z.output<typeof wireToolResultSchema>): InternalToolResult {
  assertBoundedJson(value, 'MCP_TOOL_RESULT_TOO_LARGE');
  return {
    content: value.content,
    ...(value.structuredContent === undefined
      ? {}
      : { structuredContent: value.structuredContent }),
    isError: value.isError ?? false,
    ...(value._meta === undefined ? {} : { metadata: value._meta }),
  };
}

function assertBoundedJson(value: unknown, code: McpTasksAdapterErrorCode): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new McpTasksAdapterError(code, 'MCP payload must be serializable JSON.');
  }
  if (encoded.length > MAX_JSON_BYTES) {
    throw new McpTasksAdapterError(code, 'MCP payload exceeds the byte limit.');
  }
  const pending: Readonly<{ value: unknown; depth: number }>[] = [{ value, depth: 0 }];
  let entries = 0;
  const work = [...pending];
  while (work.length > 0) {
    const current = work.pop();
    if (current === undefined) break;
    if (current.depth > MAX_JSON_DEPTH) {
      throw new McpTasksAdapterError(code, 'MCP payload exceeds the nesting limit.');
    }
    if (typeof current.value === 'string' && current.value.length > MAX_JSON_STRING_LENGTH) {
      throw new McpTasksAdapterError(code, 'MCP payload contains an oversized string.');
    }
    if (Array.isArray(current.value)) {
      entries += current.value.length;
      for (const item of current.value) work.push({ value: item, depth: current.depth + 1 });
    } else if (isRecord(current.value)) {
      const values = Object.values(current.value);
      entries += values.length;
      for (const item of values) work.push({ value: item, depth: current.depth + 1 });
    }
    if (entries > MAX_JSON_ENTRIES) {
      throw new McpTasksAdapterError(code, 'MCP payload exceeds the entry limit.');
    }
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type McpTasksAdapterErrorCode =
  | 'MCP_TASK_CAPABILITY_REQUIRED'
  | 'MCP_TASK_ID_INVALID'
  | 'MCP_TASK_INPUT_RESPONSES_INVALID'
  | 'MCP_TASK_PROTOCOL_REVISION_UNSUPPORTED'
  | 'MCP_TASK_RESPONSE_INVALID'
  | 'MCP_TASK_RESPONSE_TOO_LARGE'
  | 'MCP_TOOL_RESULT_TOO_LARGE';

export class McpTasksAdapterError extends Error {
  readonly code: McpTasksAdapterErrorCode;

  constructor(code: McpTasksAdapterErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'McpTasksAdapterError';
    this.code = code;
  }
}
