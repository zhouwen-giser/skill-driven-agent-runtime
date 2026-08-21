import { z } from 'zod';

import type {
  FrozenTaskAvailabilityCheckRequest,
  FrozenTaskAvailabilityResult,
  McpTaskExecutionProfile,
} from '../../domain/src/index.js';

import type { FrozenV1McpClient } from './frozen-v1-mcp-client.js';

export const FROZEN_TASK_AVAILABILITY_METHOD = 'io.sdar/taskExecution/checkAvailability';
export const FROZEN_TASK_AVAILABILITY_PROFILE_VERSION = '1.0';

const timestampSchema = z.iso.datetime({ offset: true });
const safeMillisecondsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timingSchema = z
  .object({
    start: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('immediate'), startToleranceMs: safeMillisecondsSchema }).strict(),
      z
        .object({
          mode: z.literal('scheduled'),
          scheduledAt: timestampSchema,
          startToleranceMs: safeMillisecondsSchema,
        })
        .strict(),
    ]),
    maxElapsedMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  })
  .strict();
const jsonPointerSchema = z
  .string()
  .max(512)
  .refine((value) => value === '' || /^(?:\/(?:[^~/]|~0|~1)*)+$/u.test(value));
const argumentsSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('complete'), value: z.unknown() }).strict(),
  z
    .object({
      state: z.literal('partial'),
      knownValue: z.unknown(),
      unresolvedPaths: z.array(jsonPointerSchema).min(1).max(128),
    })
    .strict(),
]);
const checkSchema = z
  .object({
    requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u),
    operationName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$/u),
    arguments: argumentsSchema,
    timing: timingSchema,
  })
  .strict();
const windowSchema = z.object({ startTime: timestampSchema, endTime: timestampSchema }).strict();
const possibleEffectSchema = z.enum([
  'task_preemption',
  'task_pause',
  'start_rejection',
  'start_window_missed',
  'deadline_reached',
  'partial_completion',
]);
const resultSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    operationName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$/u),
    availability: z.enum(['available', 'restricted', 'disabled', 'unknown']),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    reasonCode: z.string().max(128).optional(),
    description: z.string().max(2048).optional(),
    validUntil: timestampSchema.optional(),
    earliestStartTime: timestampSchema.optional(),
    nextAvailableWindows: z.array(windowSchema).max(32).optional(),
    estimatedDelayMs: safeMillisecondsSchema.optional(),
    reservationMode: z.enum(['none', 'best_effort', 'guaranteed']),
    reservationRef: z.string().min(1).max(256).optional(),
    possibleEffects: z.array(possibleEffectSchema).max(6).optional(),
  })
  .strict();
const responseSchema = z
  .object({
    resultType: z.literal('complete'),
    profileVersion: z.literal(FROZEN_TASK_AVAILABILITY_PROFILE_VERSION),
    results: z.array(resultSchema).min(1).max(64),
  })
  .strict();
const taskExecutionProfileSchema = z
  .object({
    profileVersion: z.literal('1.0'),
    taskBehavior: z.enum(['synchronous_only', 'server_directed', 'task_required']),
    availability: z.enum(['not_supported', 'dynamic']),
    supportsScheduling: z.boolean(),
    supportsMaxElapsed: z.boolean(),
    supportsCancellation: z.boolean().optional(),
    supportsPauseResume: z.boolean().optional(),
    supportsObservations: z.boolean(),
    supportsInputRequired: z.boolean(),
    idempotency: z.enum(['none', 'client_request_key', 'server_managed', 'unknown']),
  })
  .strict();

export class FrozenTaskAvailabilityClient {
  readonly #client: FrozenV1McpClient;
  readonly #endpoint: string;
  readonly #headers: Readonly<Record<string, string>>;

  constructor(
    input: Readonly<{
      client: FrozenV1McpClient;
      endpoint: string;
      headers: Readonly<Record<string, string>>;
    }>,
  ) {
    this.#client = input.client;
    this.#endpoint = input.endpoint;
    this.#headers = input.headers;
  }

  async check(
    checks: readonly FrozenTaskAvailabilityCheckRequest[],
  ): Promise<readonly FrozenTaskAvailabilityResult[]> {
    const parsedChecks = z.array(checkSchema).min(1).max(64).safeParse(checks);
    if (!parsedChecks.success)
      throw availabilityError(
        'FROZEN_AVAILABILITY_REQUEST_INVALID',
        'Frozen Availability checks violate profile 1.0.',
      );
    assertUniqueRequests(parsedChecks.data);
    const parsed = responseSchema.safeParse(
      await this.#client.request({
        endpoint: this.#endpoint,
        headers: this.#headers,
        method: FROZEN_TASK_AVAILABILITY_METHOD,
        params: {
          profileVersion: FROZEN_TASK_AVAILABILITY_PROFILE_VERSION,
          checks: parsedChecks.data,
        },
      }),
    );
    if (!parsed.success)
      throw availabilityError(
        'FROZEN_AVAILABILITY_RESPONSE_INVALID',
        'Frozen Availability response violates profile 1.0.',
      );
    return correlateResults(parsed.data.results, parsedChecks.data);
  }
}

export function parseFrozenTaskExecutionProfile(metadata: unknown): McpTaskExecutionProfile {
  if (!isRecord(metadata))
    throw availabilityError(
      'FROZEN_TASK_EXECUTION_PROFILE_INVALID',
      'Frozen Tool metadata must be an object.',
    );
  const parsed = taskExecutionProfileSchema.safeParse(metadata['io.sdar/taskExecution']);
  if (!parsed.success)
    throw availabilityError(
      'FROZEN_TASK_EXECUTION_PROFILE_INVALID',
      'Frozen Tool task execution metadata violates profile 1.0.',
    );
  return Object.freeze(parsed.data);
}

function correlateResults(
  results: readonly z.output<typeof resultSchema>[],
  checks: readonly z.output<typeof checkSchema>[],
): readonly FrozenTaskAvailabilityResult[] {
  if (results.length !== checks.length)
    throw availabilityError(
      'FROZEN_AVAILABILITY_CORRELATION_INVALID',
      'Availability result count does not match checks.',
    );
  const expected = new Set(checks.map((check) => correlationKey(check)));
  const seen = new Set<string>();
  return Object.freeze(
    results.map((result) => {
      const key = correlationKey(result);
      if (!expected.has(key) || seen.has(key))
        throw availabilityError(
          'FROZEN_AVAILABILITY_CORRELATION_INVALID',
          'Availability result correlation is missing, duplicated or unexpected.',
        );
      seen.add(key);
      validateResultPolicy(result);
      return Object.freeze({
        requestId: result.requestId,
        operationName: result.operationName,
        availability: result.availability,
        riskLevel: result.riskLevel,
        ...(result.reasonCode === undefined ? {} : { reasonCode: result.reasonCode }),
        ...(result.description === undefined ? {} : { description: result.description }),
        ...(result.validUntil === undefined ? {} : { validUntil: result.validUntil }),
        ...(result.earliestStartTime === undefined
          ? {}
          : { earliestStartTime: result.earliestStartTime }),
        nextAvailableWindows: Object.freeze([...(result.nextAvailableWindows ?? [])]),
        ...(result.estimatedDelayMs === undefined
          ? {}
          : { estimatedDelayMs: result.estimatedDelayMs }),
        reservationMode: result.reservationMode,
        ...(result.reservationRef === undefined ? {} : { reservationRef: result.reservationRef }),
        possibleEffects: Object.freeze([...(result.possibleEffects ?? [])]),
      });
    }),
  );
}

function validateResultPolicy(result: z.output<typeof resultSchema>): void {
  const windows = result.nextAvailableWindows ?? [];
  let priorEnd = Number.NEGATIVE_INFINITY;
  for (const window of windows) {
    const start = Date.parse(window.startTime);
    const end = Date.parse(window.endTime);
    if (start >= end || start < priorEnd)
      throw availabilityError(
        'FROZEN_AVAILABILITY_RESPONSE_INVALID',
        'Availability windows must be ordered and non-overlapping.',
      );
    priorEnd = end;
  }
  if (
    result.availability === 'restricted' &&
    (result.validUntil === undefined ||
      (result.earliestStartTime === undefined && windows.length === 0))
  )
    throw availabilityError(
      'FROZEN_AVAILABILITY_RESPONSE_INVALID',
      'Restricted availability requires a validity and usable future window.',
    );
  if ((result.reservationMode === 'guaranteed') !== (result.reservationRef !== undefined))
    throw availabilityError(
      'FROZEN_AVAILABILITY_RESPONSE_INVALID',
      'Only guaranteed reservations carry reservationRef.',
    );
}

function assertUniqueRequests(checks: readonly z.output<typeof checkSchema>[]): void {
  const keys = new Set<string>();
  for (const check of checks) {
    const key = correlationKey(check);
    if (keys.has(key))
      throw availabilityError(
        'FROZEN_AVAILABILITY_REQUEST_INVALID',
        'Availability requestId and operationName pairs must be unique.',
      );
    keys.add(key);
  }
}

function correlationKey(value: Readonly<{ requestId: string; operationName: string }>): string {
  return `${value.requestId}\u0000${value.operationName}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type FrozenTaskAvailabilityErrorCode =
  | 'FROZEN_TASK_EXECUTION_PROFILE_INVALID'
  | 'FROZEN_AVAILABILITY_REQUEST_INVALID'
  | 'FROZEN_AVAILABILITY_RESPONSE_INVALID'
  | 'FROZEN_AVAILABILITY_CORRELATION_INVALID';

export class FrozenTaskAvailabilityError extends Error {
  readonly code: FrozenTaskAvailabilityErrorCode;
  constructor(code: FrozenTaskAvailabilityErrorCode, message: string) {
    super(message);
    this.name = 'FrozenTaskAvailabilityError';
    this.code = code;
  }
}

function availabilityError(
  code: FrozenTaskAvailabilityErrorCode,
  message: string,
): FrozenTaskAvailabilityError {
  return new FrozenTaskAvailabilityError(code, message);
}
