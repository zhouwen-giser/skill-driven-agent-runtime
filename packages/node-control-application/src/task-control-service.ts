import { createHash } from 'node:crypto';

import {
  createManagementOperation,
  transitionManagementOperation,
  type ControlAuditEvent,
  type ManagementOperation,
} from '../../node-control-domain/src/index.js';

export type NodeControlTaskAction = 'pause' | 'resume' | 'cancel' | 'goal_patch';

export interface NodeControlTaskControlPrincipal {
  readonly actorId: string;
  readonly role:
    'node_admin' | 'security_admin' | 'node_operator' | 'node_viewer' | 'organization_service';
}

export interface RuntimeTaskControlCommand {
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly payload?: unknown;
  readonly expectedRevision?: number;
}

export interface NodeControlRuntimeTaskControlClient {
  execute(
    action: NodeControlTaskAction,
    taskId: string,
    command: RuntimeTaskControlCommand,
  ): Promise<ManagementOperation>;
}

export interface NodeControlTaskControlOperationRepository {
  findGovernanceOperationReplay(
    operationType: string,
    idempotencyKeyHash: string,
  ): Promise<ManagementOperation | undefined>;
  recordGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation>;
  startGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation>;
  markGovernanceOperationReconciliationPending(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation>;
  completeGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation>;
}

export class NodeControlTaskControlService {
  readonly #runtime: NodeControlRuntimeTaskControlClient;
  readonly #operations: NodeControlTaskControlOperationRepository;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      runtime: NodeControlRuntimeTaskControlClient;
      operations: NodeControlTaskControlOperationRepository;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#runtime = dependencies.runtime;
    this.#operations = dependencies.operations;
    this.#clock = dependencies.clock;
  }

  async execute(
    action: NodeControlTaskAction,
    taskId: string,
    command: RuntimeTaskControlCommand,
    principal: NodeControlTaskControlPrincipal,
  ): Promise<ManagementOperation> {
    assertTaskControlPrincipal(principal);
    const operationType = `task.${action}`;
    const normalizedTaskId = requiredIdentifier(taskId);
    const target = Object.freeze({ type: 'task', id: normalizedTaskId });
    const idempotencyKeyHash = sha256(command.idempotencyKey);
    const inputHash = sha256Json({
      operationType,
      target,
      actorId: principal.actorId,
      reason: command.reason,
      ...(command.payload === undefined ? {} : { payload: command.payload }),
      ...(command.expectedRevision === undefined
        ? {}
        : { expectedRevision: command.expectedRevision }),
    });
    const replay = await this.#operations.findGovernanceOperationReplay(
      operationType,
      idempotencyKeyHash,
    );
    if (replay !== undefined) {
      if (replay.inputHash !== inputHash)
        throw new NodeControlTaskControlError(
          'TASK_CONTROL_IDEMPOTENCY_CONFLICT',
          'The idempotency key was already used for a different Task command.',
          409,
        );
      if (isTerminalOperation(replay)) return terminalTaskControlReplay(replay);
      return this.#startDispatchAndComplete(replay, action, normalizedTaskId, command);
    }

    const occurredAt = this.#clock.now();
    const accepted = createManagementOperation(
      {
        operationId: `control-task-${sha256(`${operationType}:${idempotencyKeyHash}`).slice(0, 40)}`,
        operationType,
        target,
        actorId: principal.actorId,
        reason: command.reason,
        idempotencyKeyHash,
        inputHash,
      },
      occurredAt,
    );
    const persisted = await this.#operations.recordGovernanceOperation(
      accepted,
      auditFor(accepted, 'ACCEPTED'),
    );
    if (persisted.inputHash !== inputHash)
      throw new NodeControlTaskControlError(
        'TASK_CONTROL_IDEMPOTENCY_CONFLICT',
        'The idempotency key was concurrently used for a different Task command.',
        409,
      );
    if (isTerminalOperation(persisted)) return terminalTaskControlReplay(persisted);
    return this.#startDispatchAndComplete(persisted, action, normalizedTaskId, command);
  }

  async #startDispatchAndComplete(
    accepted: ManagementOperation,
    action: NodeControlTaskAction,
    taskId: string,
    command: RuntimeTaskControlCommand,
  ): Promise<ManagementOperation> {
    if (accepted.status === 'running') {
      if (isRuntimeReconciliationPending(accepted))
        return this.#invokeAndComplete(accepted, action, taskId, command);
      throw new NodeControlTaskControlError(
        'TASK_CONTROL_DISPATCH_UNCERTAIN',
        'Task control dispatch already started; replay is fail-closed to prevent a duplicate Runtime side effect.',
        409,
      );
    }
    if (accepted.status !== 'accepted') return accepted;
    const running = await this.#operations.startGovernanceOperation(
      accepted,
      auditFor(accepted, 'DISPATCH_STARTED', this.#clock.now()),
    );
    if (running.status === 'canceled') return running;
    if (isTerminalOperation(running)) return terminalTaskControlReplay(running);
    if (running.status !== 'running')
      throw new NodeControlTaskControlError(
        'TASK_CONTROL_DISPATCH_NOT_STARTED',
        'Task control dispatch could not acquire the persisted pre-dispatch authority.',
        409,
      );
    return this.#invokeAndComplete(running, action, taskId, command);
  }

  async #invokeAndComplete(
    running: ManagementOperation,
    action: NodeControlTaskAction,
    taskId: string,
    command: RuntimeTaskControlCommand,
  ): Promise<ManagementOperation> {
    let runtime: ManagementOperation;
    try {
      runtime = await this.#runtime.execute(action, taskId, command);
    } catch (error) {
      const errorCode = taskControlErrorCode(error);
      if (isRuntimeReconciliationPendingCode(errorCode)) {
        return this.#persistReconciliationPending(
          running,
          errorCode,
          reconciliationFailureStatus(errorCode),
        );
      }
      if (!isDefinitiveRuntimeRejection(error))
        return this.#persistReconciliationPending(
          running,
          'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
          503,
        );
      return this.#persistTerminalRuntimeFailure(
        running,
        errorCode,
        taskControlFailureStatus(error),
      );
    }

    if (runtime.status === 'accepted' || runtime.status === 'running')
      return this.#persistReconciliationPending(
        running,
        'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
        503,
      );

    if (!matchesRuntimeTaskControlReceipt(runtime, action, taskId, command.idempotencyKey))
      return this.#persistReconciliationPending(
        running,
        'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
        503,
      );

    const completionBase = withoutRuntimeReconciliationMarker(running);
    const completed = transitionManagementOperation(
      completionBase,
      runtime.status,
      this.#clock.now(),
      runtime.status === 'failed'
        ? {
            errorCode: runtime.errorCode ?? 'RUNTIME_TASK_CONTROL_FAILED',
            result: {
              runtimeOperationId: runtime.operationId,
              failureStatus: persistedTaskControlFailureStatus(runtime.result) ?? 503,
            },
          }
        : {
            result: {
              runtimeOperationId: runtime.operationId,
              runtimeOperation: runtime,
            },
          },
    );
    let persisted: ManagementOperation;
    try {
      persisted = await this.#operations.completeGovernanceOperation(
        completed,
        auditFor(
          completed,
          completed.status === 'succeeded'
            ? 'SUCCEEDED'
            : completed.status === 'canceled'
              ? 'CANCELED'
              : 'FAILED',
        ),
      );
    } catch {
      return this.#persistReconciliationPending(
        running,
        'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
        503,
      );
    }
    return terminalTaskControlReplay(persisted);
  }

  async #persistTerminalRuntimeFailure(
    running: ManagementOperation,
    errorCode: string,
    failureStatus = 503,
  ): Promise<ManagementOperation> {
    const completionBase = withoutRuntimeReconciliationMarker(running);
    const failed = transitionManagementOperation(completionBase, 'failed', this.#clock.now(), {
      errorCode,
      result: { failureStatus },
    });
    let persistedFailure: ManagementOperation;
    try {
      persistedFailure = await this.#operations.completeGovernanceOperation(
        failed,
        auditFor(failed, 'FAILED'),
      );
    } catch {
      return this.#persistReconciliationPending(
        running,
        'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
        503,
      );
    }
    return terminalTaskControlReplay(persistedFailure);
  }

  async #persistReconciliationPending(
    running: ManagementOperation,
    errorCode: RuntimeReconciliationCode,
    failureStatus: 409 | 503,
  ): Promise<ManagementOperation> {
    if (isRuntimeReconciliationPending(running)) throw persistedTaskControlError(running);
    const pending = Object.freeze({
      ...running,
      result: Object.freeze({ runtimeReconciliationPending: true, failureStatus }),
      errorCode,
    });
    const persistedPending = await this.#operations.markGovernanceOperationReconciliationPending(
      pending,
      auditFor(pending, 'RECONCILIATION_PENDING', this.#clock.now()),
    );
    if (isTerminalOperation(persistedPending)) return terminalTaskControlReplay(persistedPending);
    if (!isRuntimeReconciliationPending(persistedPending))
      throw new NodeControlTaskControlError(
        'TASK_CONTROL_DISPATCH_UNCERTAIN',
        'Task control dispatch already started without a valid Runtime reconciliation marker.',
        409,
      );
    throw persistedTaskControlError(persistedPending);
  }
}

function assertTaskControlPrincipal(principal: NodeControlTaskControlPrincipal): void {
  if (!['node_admin', 'organization_service'].includes(principal.role))
    throw new NodeControlTaskControlError(
      'TASK_CONTROL_ROLE_FORBIDDEN',
      'Task control requires node_admin or an enabled organization_service profile.',
      403,
    );
}

function requiredIdentifier(value: string): string {
  const normalized = value.trim();
  if (normalized === '' || normalized.length > 512)
    throw new NodeControlTaskControlError(
      'TASK_CONTROL_TASK_ID_INVALID',
      'Task command requires a bounded Task identifier.',
      400,
    );
  return normalized;
}

function auditFor(
  operation: ManagementOperation,
  resultCode: string,
  createdAt = operation.completedAt ?? operation.createdAt,
): ControlAuditEvent {
  return Object.freeze({
    auditId: `audit-${operation.operationId}-${resultCode.toLowerCase()}`,
    actorId: operation.actorId,
    action: operation.operationType,
    aggregateType: operation.target.type,
    aggregateId: operation.target.id,
    reason: operation.reason,
    requestHash: operation.inputHash,
    resultCode,
    createdAt,
  });
}

function isTerminalOperation(operation: ManagementOperation): boolean {
  return ['succeeded', 'failed', 'canceled'].includes(operation.status);
}

function terminalTaskControlReplay(operation: ManagementOperation): ManagementOperation {
  if (operation.status === 'failed') throw persistedTaskControlError(operation);
  return operation;
}

function persistedTaskControlError(operation: ManagementOperation): NodeControlTaskControlError {
  return new NodeControlTaskControlError(
    operation.errorCode ?? 'RUNTIME_TASK_CONTROL_FAILED',
    'The Runtime Task authority rejected or could not complete the command.',
    persistedTaskControlFailureStatus(operation.result) ?? 503,
  );
}

function isRuntimeReconciliationPending(operation: ManagementOperation): boolean {
  return (
    isRuntimeReconciliationPendingCode(operation.errorCode) &&
    runtimeReconciliationMarkerStatus(operation.result) !== undefined
  );
}

function runtimeReconciliationMarkerStatus(result: unknown): number | undefined {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('runtimeReconciliationPending' in result) ||
    result.runtimeReconciliationPending !== true
  )
    return undefined;
  return persistedTaskControlFailureStatus(result);
}

function isRuntimeReconciliationPendingCode(code: unknown): code is RuntimeReconciliationCode {
  return (
    typeof code === 'string' &&
    runtimeReconciliationCodes.includes(code as RuntimeReconciliationCode)
  );
}

type RuntimeReconciliationCode = (typeof runtimeReconciliationCodes)[number];

const runtimeReconciliationCodes = Object.freeze([
  'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
  'COGNITIVE_MANAGEMENT_ACTION_RECONCILIATION_PENDING',
  'COGNITIVE_MANAGEMENT_ACTION_IN_PROGRESS',
  'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST',
  'RUNTIME_TASK_COMMAND_RECOVERY_INDETERMINATE',
] as const);

function reconciliationFailureStatus(code: RuntimeReconciliationCode): 409 | 503 {
  return code === 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING' ||
    code === 'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST'
    ? 503
    : 409;
}

function withoutRuntimeReconciliationMarker(operation: ManagementOperation): ManagementOperation {
  if (!isRuntimeReconciliationPending(operation)) return operation;
  const base = { ...operation };
  delete base.result;
  delete base.errorCode;
  return Object.freeze(base);
}

function persistedTaskControlFailureStatus(result: unknown): number | undefined {
  if (typeof result !== 'object' || result === null || !('failureStatus' in result))
    return undefined;
  const status = result.failureStatus;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : undefined;
}

function taskControlFailureStatus(error: unknown): number | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('status' in error) ||
    typeof error.status !== 'number'
  )
    return undefined;
  return Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : undefined;
}

function isDefinitiveRuntimeRejection(error: unknown): boolean {
  const status = taskControlFailureStatus(error);
  const code = taskControlErrorCode(error);
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    ![408, 425, 429].includes(status) &&
    !code.startsWith('RUNTIME_TASK_CONTROL_HTTP_')
  );
}

function matchesRuntimeTaskControlReceipt(
  operation: ManagementOperation,
  action: NodeControlTaskAction,
  taskId: string,
  idempotencyKey: string,
): boolean {
  return (
    operation.operationType === `task.${action}` &&
    operation.target.type === 'task' &&
    operation.target.id === taskId &&
    operation.idempotencyKeyHash === sha256(idempotencyKey)
  );
}

function taskControlErrorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'RUNTIME_TASK_CONTROL_UNAVAILABLE';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export class NodeControlTaskControlError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'NodeControlTaskControlError';
    this.code = code;
    this.status = status;
  }
}
