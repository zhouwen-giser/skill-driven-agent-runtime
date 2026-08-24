import { createHash } from 'node:crypto';

import { snapshotRemoteTaskInputValue, type ConversationContext } from '../../domain/src/index.js';

import type { TaskCapabilityAcceptance } from './task-capability.js';

export const INITIAL_TASK_ADMISSION_IDEMPOTENCY_METADATA_KEY = 'idempotency_key';
export const MAX_INITIAL_TASK_ADMISSION_IDEMPOTENCY_KEY_CHARACTERS = 256;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const REQUEST_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export interface InitialTaskAdmissionCommand {
  readonly idempotencyKey: string;
}

export interface InitialTaskAdmissionRecord {
  readonly idempotencyKey: string;
  readonly requestHash: `sha256:${string}`;
  readonly taskId: string;
  readonly contextId: string;
  readonly capabilityBindingId: string;
  readonly capabilityAttemptId: string;
  readonly createdContext: boolean;
  readonly acceptedAt: string;
}

export type InitialTaskAdmissionAcceptResult =
  | Readonly<{
      status: 'accepted';
      record: InitialTaskAdmissionRecord;
      /** Context row selected under the same transaction as the acceptance. */
      context: ConversationContext;
    }>
  | Readonly<{ status: 'replayed'; record: InitialTaskAdmissionRecord }>
  | Readonly<{ status: 'conflict'; record: InitialTaskAdmissionRecord }>;

/**
 * Protocol-neutral durable authority for accepting an initial Task exactly once.
 * Implementations must serialize and atomically commit the Context, Task and
 * explicit Capability acceptance with the admission record.
 */
export interface InitialTaskAdmissionStore {
  findByIdempotencyKey(idempotencyKey: string): Promise<InitialTaskAdmissionRecord | undefined>;
  acceptInitial(
    input: Readonly<{
      idempotencyKey: string;
      requestHash: `sha256:${string}`;
      context: ConversationContext;
      capabilityAcceptance: TaskCapabilityAcceptance;
      acceptedAt: string;
    }>,
  ): Promise<InitialTaskAdmissionAcceptResult>;
}

export type InitialTaskAdmissionErrorCode =
  'TASK_INITIAL_ADMISSION_IDEMPOTENCY_KEY_INVALID' | 'TASK_INITIAL_ADMISSION_REQUEST_HASH_INVALID';

export class InitialTaskAdmissionError extends Error {
  readonly code: InitialTaskAdmissionErrorCode;

  constructor(code: InitialTaskAdmissionErrorCode, message: string) {
    super(message);
    this.name = 'InitialTaskAdmissionError';
    this.code = code;
  }
}

export function normalizeInitialTaskAdmissionIdempotencyKey(value: string): string {
  if (
    value.length > MAX_INITIAL_TASK_ADMISSION_IDEMPOTENCY_KEY_CHARACTERS ||
    !IDEMPOTENCY_KEY_PATTERN.test(value)
  )
    throw new InitialTaskAdmissionError(
      'TASK_INITIAL_ADMISSION_IDEMPOTENCY_KEY_INVALID',
      'Initial Task admission idempotency_key must be a 1..256 character ASCII token.',
    );
  return value;
}

/**
 * Hashes only protocol-neutral request semantics. Adapter/SDK correlation IDs
 * (messageId, generated taskId and generated contextId) are deliberately absent,
 * so a transport retry can be replayed onto the originally accepted Task.
 */
export function initialTaskAdmissionRequestHash(
  input: Readonly<{
    messageText: string;
    userId: string;
    metadata: Readonly<Record<string, unknown>>;
    capabilityInput: unknown;
  }>,
): `sha256:${string}` {
  const snapshot = snapshotRemoteTaskInputValue({
    schemaVersion: '1.0',
    messageText: input.messageText,
    userId: input.userId,
    metadata: input.metadata,
    capabilityInput: input.capabilityInput,
  });
  return `sha256:${createHash('sha256').update(canonicalJson(snapshot)).digest('hex')}`;
}

export function isInitialTaskAdmissionRequestHash(value: string): value is `sha256:${string}` {
  return REQUEST_HASH_PATTERN.test(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort(compareUtf16CodeUnits)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  throw new InitialTaskAdmissionError(
    'TASK_INITIAL_ADMISSION_REQUEST_HASH_INVALID',
    'Initial Task admission request hashing accepts bounded JSON values only.',
  );
}

function compareUtf16CodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
