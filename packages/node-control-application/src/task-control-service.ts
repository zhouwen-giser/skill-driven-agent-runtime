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
    const target = Object.freeze({ type: 'task', id: requiredIdentifier(taskId) });
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
      if (isTerminalOperation(replay)) return replay;
      return this.#startDispatchAndComplete(replay, action, taskId, command);
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
    if (isTerminalOperation(persisted)) return persisted;
    return this.#startDispatchAndComplete(persisted, action, taskId, command);
  }

  async #startDispatchAndComplete(
    accepted: ManagementOperation,
    action: NodeControlTaskAction,
    taskId: string,
    command: RuntimeTaskControlCommand,
  ): Promise<ManagementOperation> {
    if (accepted.status === 'running')
      throw new NodeControlTaskControlError(
        'TASK_CONTROL_DISPATCH_UNCERTAIN',
        'Task control dispatch already started; replay is fail-closed to prevent a duplicate Runtime side effect.',
        409,
      );
    if (accepted.status !== 'accepted') return accepted;
    const running = await this.#operations.startGovernanceOperation(
      accepted,
      auditFor(accepted, 'DISPATCH_STARTED', this.#clock.now()),
    );
    if (running.status === 'canceled') return running;
    if (isTerminalOperation(running)) return running;
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
    try {
      const runtime = await this.#runtime.execute(action, taskId, command);
      const terminalStatus =
        runtime.status === 'failed'
          ? ('failed' as const)
          : runtime.status === 'canceled'
            ? ('canceled' as const)
            : ('succeeded' as const);
      const completed = transitionManagementOperation(
        running,
        terminalStatus,
        this.#clock.now(),
        runtime.status === 'failed'
          ? {
              errorCode: runtime.errorCode ?? 'RUNTIME_TASK_CONTROL_FAILED',
              result: { runtimeOperationId: runtime.operationId },
            }
          : {
              result: {
                runtimeOperationId: runtime.operationId,
                runtimeOperation: runtime,
              },
            },
      );
      return await this.#operations.completeGovernanceOperation(
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
    } catch (error) {
      const failed = transitionManagementOperation(running, 'failed', this.#clock.now(), {
        errorCode: taskControlErrorCode(error),
      });
      await this.#operations.completeGovernanceOperation(failed, auditFor(failed, 'FAILED'));
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof error.status === 'number' &&
        'code' in error &&
        typeof error.code === 'string'
      )
        throw error;
      throw new NodeControlTaskControlError(
        taskControlErrorCode(error),
        'The Runtime Task authority rejected or could not complete the command.',
        503,
      );
    }
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
