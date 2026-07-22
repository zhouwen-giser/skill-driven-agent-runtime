import { z } from 'zod';

import type {
  McpTaskOperationSemantics,
  ResolvedMcpTaskExecution,
  TaskAvailabilityCheckRequest,
  TaskAvailabilityCheckResult,
} from '../../domain/src/index.js';
import { McpTasksAdapterError } from './mcp-tasks-contract.js';

export const MCP_TASK_AVAILABILITY_METHOD = 'io.sdar/tasks/checkAvailability';
export const MCP_TASK_AVAILABILITY_SCHEMA_REVISION = '1.0';
export const MCP_TASK_EXECUTION_METADATA_KEY = 'io.sdar/taskExecution';
export const MAX_TASK_AVAILABILITY_BATCH = 128;

const timestamp = z.iso.datetime({ offset: true });
const safeMilliseconds = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timingSchema = z.strictObject({
  start: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('immediate'), startToleranceMs: safeMilliseconds }),
    z.strictObject({
      mode: z.literal('scheduled'),
      scheduledAt: timestamp,
      startToleranceMs: safeMilliseconds,
    }),
  ]),
  maxElapsedMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
});
const argumentsSchema = z.discriminatedUnion('unresolved', [
  z.strictObject({ unresolved: z.literal(false), value: z.record(z.string(), z.unknown()) }),
  z.strictObject({
    unresolved: z.literal(true),
    knownArguments: z.record(z.string(), z.unknown()),
    unresolvedPaths: z.array(z.string().min(1).max(1_024)).min(1).max(1_024),
  }),
]);
const requestSchema = z.strictObject({
  nodeId: z.string().min(1).max(256),
  operationName: z.string().min(1).max(512),
  arguments: argumentsSchema,
  timing: timingSchema.optional(),
});
const windowSchema = z.strictObject({ startTime: timestamp, endTime: timestamp });
const resultSchema = z.strictObject({
  nodeId: z.string().min(1).max(256),
  operationName: z.string().min(1).max(512),
  availability: z.enum(['available', 'restricted', 'disabled', 'unknown']),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  reasonCode: z.string().min(1).max(256).optional(),
  description: z.string().min(1).max(4_096).optional(),
  validUntil: timestamp.optional(),
  earliestStartTime: timestamp.optional(),
  nextAvailableWindows: z.array(windowSchema).max(128).optional(),
  estimatedDelayMs: safeMilliseconds.optional(),
  reservationMode: z.enum(['none', 'best_effort', 'guaranteed']),
  reservationRef: z.string().min(1).max(512).optional(),
  possibleEffects: z
    .array(
      z.enum([
        'task_preemption',
        'task_pause',
        'start_rejection',
        'start_window_missed',
        'deadline_reached',
        'partial_completion',
      ]),
    )
    .max(32)
    .optional(),
});

export const taskAvailabilityResponseSchema = z.strictObject({
  revision: z.literal(MCP_TASK_AVAILABILITY_SCHEMA_REVISION),
  results: z.array(resultSchema).max(MAX_TASK_AVAILABILITY_BATCH),
});

const taskOperationSemanticsSchema = z.strictObject({
  execution: z.enum(['synchronous', 'task_capable', 'task_required', 'unknown']),
  availability: z.enum(['not_supported', 'dynamic']),
  supportsScheduling: z.boolean(),
  supportsMaxElapsed: z.boolean(),
  supportsObservations: z.boolean(),
  cancellation: z.enum(['unsupported', 'cooperative', 'task_cancel', 'unknown']),
  revision: z.literal('1.0'),
});

export function parseTaskOperationSemantics(
  metadata: unknown,
): McpTaskOperationSemantics | undefined {
  if (metadata === undefined) return undefined;
  if (!isRecord(metadata)) throw invalid('Tool _meta must be an object when present.');
  const value = metadata[MCP_TASK_EXECUTION_METADATA_KEY];
  if (value === undefined) return undefined;
  const parsed = taskOperationSemanticsSchema.safeParse(value);
  if (!parsed.success) throw invalid('Tool task execution metadata violates revision 1.0.');
  return parsed.data;
}

export function validateAvailabilityRequests(
  requests: readonly TaskAvailabilityCheckRequest[],
): readonly TaskAvailabilityCheckRequest[] {
  const parsed = z.array(requestSchema).min(1).max(MAX_TASK_AVAILABILITY_BATCH).safeParse(requests);
  if (!parsed.success)
    throw invalid('Availability request violates the bounded revision 1.0 contract.');
  assertBoundedJson(parsed.data);
  const keys = new Set<string>();
  for (const request of parsed.data) {
    const key = correlationKey(request.nodeId, request.operationName);
    if (keys.has(key)) throw invalid('Availability request correlation keys must be unique.');
    keys.add(key);
  }
  return parsed.data;
}

export function toTaskAvailabilityResults(
  wire: z.output<typeof taskAvailabilityResponseSchema>,
  requests: readonly TaskAvailabilityCheckRequest[],
): readonly TaskAvailabilityCheckResult[] {
  assertBoundedJson(wire);
  if (wire.results.length !== requests.length)
    throw invalid('Availability response count does not match the request count.');
  const expected = new Set(
    requests.map((request) => correlationKey(request.nodeId, request.operationName)),
  );
  const seen = new Set<string>();
  return wire.results.map((result) => {
    const key = correlationKey(result.nodeId, result.operationName);
    if (!expected.has(key) || seen.has(key))
      throw invalid('Availability response correlation is missing, duplicated, or unexpected.');
    seen.add(key);
    const windows = result.nextAvailableWindows ?? [];
    validateWindows(windows);
    if (result.reservationMode === 'guaranteed' && result.reservationRef === undefined)
      throw new McpTasksAdapterError(
        'MCP_TASK_AVAILABILITY_RESERVATION_INVALID',
        'Guaranteed availability requires a reservationRef.',
      );
    return {
      nodeId: result.nodeId,
      operationName: result.operationName,
      availability: result.availability,
      riskLevel: result.riskLevel,
      ...(result.reasonCode === undefined ? {} : { reasonCode: result.reasonCode }),
      ...(result.description === undefined ? {} : { description: result.description }),
      ...(result.validUntil === undefined ? {} : { validUntil: result.validUntil }),
      ...(result.earliestStartTime === undefined
        ? {}
        : { earliestStartTime: result.earliestStartTime }),
      nextAvailableWindows: windows,
      ...(result.estimatedDelayMs === undefined
        ? {}
        : { estimatedDelayMs: result.estimatedDelayMs }),
      reservationMode: result.reservationMode,
      ...(result.reservationRef === undefined ? {} : { reservationRef: result.reservationRef }),
      possibleEffects: result.possibleEffects ?? [],
    };
  });
}

export function taskExecutionCallMetadata(
  execution: ResolvedMcpTaskExecution,
): Readonly<Record<string, unknown>> {
  if (execution.protocolMode === 'frozen_v1')
    throw invalid('Frozen task execution must use the Frozen V1 adapter.');
  return {
    [MCP_TASK_EXECUTION_METADATA_KEY]: {
      revision: '1.0',
      mode: execution.mode,
      ...(execution.timing === undefined ? {} : { timing: execution.timing }),
      ...(execution.reservationRef === undefined
        ? {}
        : { reservationRef: execution.reservationRef }),
    },
  };
}

function validateWindows(windows: readonly z.output<typeof windowSchema>[]): void {
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const window of windows) {
    const start = Date.parse(window.startTime);
    const end = Date.parse(window.endTime);
    if (start >= end || start < previousEnd)
      throw invalid('Availability windows must be sorted, non-overlapping, and have start < end.');
    previousEnd = end;
  }
}

function assertBoundedJson(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > 1_048_576)
    throw new McpTasksAdapterError(
      'MCP_TASK_AVAILABILITY_RESPONSE_TOO_LARGE',
      'Availability payload exceeds one MiB.',
    );
}

function correlationKey(nodeId: string, operationName: string): string {
  return JSON.stringify([nodeId, operationName]);
}

function invalid(message: string): McpTasksAdapterError {
  return new McpTasksAdapterError('MCP_TASK_AVAILABILITY_RESPONSE_INVALID', message);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
