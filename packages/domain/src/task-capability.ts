import { createHash } from 'node:crypto';

import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';

export interface TaskCapabilityBinding {
  readonly bindingId: string;
  readonly taskId: string;
  readonly requestedCapabilityId: string;
  readonly capabilityVersion: number;
  readonly exposureId?: string;
  readonly exposureVersion?: number;
  readonly inputSnapshot: unknown;
  readonly successCriteriaSnapshot: readonly Readonly<Record<string, unknown>>[];
  readonly evidenceRequirementSnapshot: readonly Readonly<Record<string, unknown>>[];
  readonly constraintSnapshot: readonly Readonly<Record<string, unknown>>[];
  readonly initialImplementationRefs: readonly string[];
  readonly providerPolicySnapshot?: unknown;
  readonly bindingHash: string;
  readonly boundAt: string;
}

export type TaskCapabilityAttemptReason =
  'initial' | 'replan' | 'provider_failover' | 'recovery' | 'manual_change';
export type TaskCapabilityAttemptStatus =
  'prepared' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled' | 'superseded';

const attemptReasons = new Set<TaskCapabilityAttemptReason>([
  'initial',
  'replan',
  'provider_failover',
  'recovery',
  'manual_change',
]);
const attemptStatuses = new Set<TaskCapabilityAttemptStatus>([
  'prepared',
  'running',
  'waiting',
  'succeeded',
  'failed',
  'canceled',
  'superseded',
]);

export interface TaskCapabilityExecutionAttempt {
  readonly attemptId: string;
  readonly taskId: string;
  readonly capabilityBindingId: string;
  readonly attemptNo: number;
  readonly planId?: string;
  readonly planTemplateRef?: string;
  readonly skillVersionRefs: readonly string[];
  readonly providerBindingRefs: readonly string[];
  readonly reason: TaskCapabilityAttemptReason;
  readonly status: TaskCapabilityAttemptStatus;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export function createTaskCapabilityBinding(
  input: Omit<TaskCapabilityBinding, 'bindingHash'> & Readonly<{ bindingHash?: string }>,
): TaskCapabilityBinding {
  if ((input.exposureId === undefined) !== (input.exposureVersion === undefined))
    invalid('Exposure identity requires both id and version.');
  if (!Number.isSafeInteger(input.capabilityVersion) || input.capabilityVersion < 1)
    invalid('Capability version must be positive.');
  if (
    input.exposureVersion !== undefined &&
    (!Number.isSafeInteger(input.exposureVersion) || input.exposureVersion < 1)
  )
    invalid('Exposure version must be positive.');
  if (input.successCriteriaSnapshot.length === 0)
    invalid('At least one success criterion is required.');
  if (input.initialImplementationRefs.length === 0)
    invalid('At least one initial implementation is required.');
  const normalized = Object.freeze({
    bindingId: requireIdentifier(input.bindingId, 'TASK_CAPABILITY_BINDING_ID_REQUIRED'),
    taskId: requireIdentifier(input.taskId, 'TASK_ID_REQUIRED'),
    requestedCapabilityId: requireIdentifier(
      input.requestedCapabilityId,
      'TASK_CAPABILITY_ID_REQUIRED',
    ),
    capabilityVersion: input.capabilityVersion,
    ...(input.exposureId === undefined
      ? {}
      : {
          exposureId: requireIdentifier(input.exposureId, 'TASK_EXPOSURE_ID_REQUIRED'),
          exposureVersion: input.exposureVersion,
        }),
    inputSnapshot: snapshot(input.inputSnapshot),
    successCriteriaSnapshot: records(input.successCriteriaSnapshot),
    evidenceRequirementSnapshot: records(input.evidenceRequirementSnapshot),
    constraintSnapshot: records(input.constraintSnapshot),
    initialImplementationRefs: identifiers(input.initialImplementationRefs),
    ...(input.providerPolicySnapshot === undefined
      ? {}
      : { providerPolicySnapshot: snapshot(input.providerPolicySnapshot) }),
    boundAt: timestamp(input.boundAt),
  });
  const bindingHash = createHash('sha256').update(canonical(normalized)).digest('hex');
  if (input.bindingHash !== undefined && input.bindingHash !== bindingHash)
    invalid('Binding hash does not match immutable content.');
  return Object.freeze({ ...normalized, bindingHash });
}

export function createTaskCapabilityExecutionAttempt(
  input: TaskCapabilityExecutionAttempt,
): TaskCapabilityExecutionAttempt {
  if (!attemptReasons.has(input.reason) || !attemptStatuses.has(input.status))
    invalid('Capability attempt reason or status is invalid.');
  if (!Number.isSafeInteger(input.attemptNo) || input.attemptNo < 1)
    invalid('Capability attempt number must be positive.');
  if (
    input.status === 'prepared' &&
    (input.startedAt !== undefined || input.completedAt !== undefined)
  )
    invalid('A prepared attempt cannot have execution timestamps.');
  if (
    (input.status === 'running' || input.status === 'waiting') &&
    (input.startedAt === undefined || input.completedAt !== undefined)
  )
    invalid('A running or waiting attempt requires startedAt and cannot be completed.');
  if (
    ['succeeded', 'failed', 'canceled', 'superseded'].includes(input.status) &&
    input.completedAt === undefined
  )
    invalid('A terminal attempt requires completedAt.');
  return Object.freeze({
    attemptId: requireIdentifier(input.attemptId, 'TASK_CAPABILITY_ATTEMPT_ID_REQUIRED'),
    taskId: requireIdentifier(input.taskId, 'TASK_ID_REQUIRED'),
    capabilityBindingId: requireIdentifier(
      input.capabilityBindingId,
      'TASK_CAPABILITY_BINDING_ID_REQUIRED',
    ),
    attemptNo: input.attemptNo,
    ...(input.planId === undefined
      ? {}
      : { planId: requireIdentifier(input.planId, 'PLAN_ID_REQUIRED') }),
    ...(input.planTemplateRef === undefined
      ? {}
      : {
          planTemplateRef: requireIdentifier(input.planTemplateRef, 'PLAN_TEMPLATE_REF_REQUIRED'),
        }),
    skillVersionRefs: identifiers(input.skillVersionRefs),
    providerBindingRefs: identifiers(input.providerBindingRefs),
    reason: input.reason,
    status: input.status,
    ...(input.startedAt === undefined ? {} : { startedAt: timestamp(input.startedAt) }),
    ...(input.completedAt === undefined ? {} : { completedAt: timestamp(input.completedAt) }),
  });
}

function records(values: readonly Readonly<Record<string, unknown>>[]) {
  return Object.freeze(values.map((value) => snapshot(value)));
}

function identifiers(values: readonly string[]) {
  const result = values.map((value) => requireIdentifier(value, 'TASK_CAPABILITY_REF_REQUIRED'));
  if (new Set(result).size !== result.length) invalid('Capability references must be unique.');
  return Object.freeze(result);
}

function timestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) invalid('Timestamp is invalid.');
  return value;
}

function snapshot<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T, seen = new WeakSet()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Readonly<Record<string, unknown>>))
    deepFreeze(child, seen);
  return Object.freeze(value);
}

function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

function invalid(message: string): never {
  throw new DomainError('TASK_CAPABILITY_INVALID', message);
}
