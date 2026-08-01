import { NodeControlDomainError } from './errors.js';

export type ManagementOperationStatus =
  'accepted' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface ResourceRef {
  readonly type: string;
  readonly id: string;
  readonly version?: string;
  readonly revision?: number;
}

export interface ManagementOperation {
  readonly operationId: string;
  readonly operationType: string;
  readonly target: ResourceRef;
  readonly status: ManagementOperationStatus;
  readonly actorId: string;
  readonly reason: string;
  readonly idempotencyKeyHash: string;
  readonly inputHash: string;
  readonly result?: unknown;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface ControlAuditEvent {
  readonly auditId: string;
  readonly actorId: string;
  readonly action: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly expectedRevision?: number;
  readonly resultRevision?: number;
  readonly reason: string;
  readonly requestHash: string;
  readonly resultCode: string;
  readonly createdAt: string;
}

export function createManagementOperation(
  input: Omit<ManagementOperation, 'status' | 'createdAt'>,
  createdAt: string,
): ManagementOperation {
  validateOperationField(input.operationId, 'operationId');
  validateOperationField(input.operationType, 'operationType');
  validateOperationField(input.actorId, 'actorId');
  validateOperationField(input.reason, 'reason');
  validateOperationField(input.target.type, 'target.type');
  validateOperationField(input.target.id, 'target.id');
  validateHash(input.idempotencyKeyHash, 'idempotencyKeyHash');
  validateHash(input.inputHash, 'inputHash');
  assertTimestamp(createdAt);
  return Object.freeze({ ...input, status: 'accepted', createdAt });
}

export function transitionManagementOperation(
  operation: ManagementOperation,
  targetStatus: Exclude<ManagementOperationStatus, 'accepted'>,
  occurredAt: string,
  outcome: Readonly<{ result?: unknown; errorCode?: string }> = {},
): ManagementOperation {
  const allowed: Readonly<Record<ManagementOperationStatus, readonly ManagementOperationStatus[]>> =
    {
      accepted: ['running', 'canceled'],
      running: ['succeeded', 'failed', 'canceled'],
      succeeded: [],
      failed: [],
      canceled: [],
    };
  if (!allowed[operation.status].includes(targetStatus)) {
    throw new NodeControlDomainError(
      'MANAGEMENT_OPERATION_TRANSITION_INVALID',
      `Cannot transition ManagementOperation from ${operation.status} to ${targetStatus}.`,
    );
  }
  assertTimestamp(occurredAt);
  if (targetStatus === 'failed' && (outcome.errorCode ?? '').trim() === '') {
    throw new NodeControlDomainError(
      'MANAGEMENT_OPERATION_INVALID',
      'A failed ManagementOperation requires errorCode.',
    );
  }
  return Object.freeze({
    ...operation,
    status: targetStatus,
    ...(operation.startedAt === undefined && targetStatus === 'running'
      ? { startedAt: occurredAt }
      : {}),
    ...(outcome.result === undefined ? {} : { result: outcome.result }),
    ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }),
    ...(['succeeded', 'failed', 'canceled'].includes(targetStatus)
      ? { completedAt: occurredAt }
      : {}),
  });
}

function validateOperationField(value: string, field: string): void {
  if (value.trim() === '') invalid(`${field} is required.`);
}

function validateHash(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) invalid(`${field} must be a lowercase SHA-256 digest.`);
}

function assertTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) invalid('timestamp must be ISO 8601.');
}

function invalid(message: string): never {
  throw new NodeControlDomainError('MANAGEMENT_OPERATION_INVALID', message);
}
