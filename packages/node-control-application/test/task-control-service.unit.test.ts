import { describe, expect, it, vi } from 'vitest';

import {
  NodeControlTaskControlError,
  NodeControlTaskControlService,
  type NodeControlTaskControlOperationRepository,
} from '../src/task-control-service.js';
import {
  createManagementOperation,
  transitionManagementOperation,
  type ControlAuditEvent,
  type ManagementOperation,
} from '../../node-control-domain/src/index.js';

describe('NodeControlTaskControlService', () => {
  it('persists accepted intent before Runtime and completes the governed operation', async () => {
    const repository = new MemoryOperations();
    const execute = vi.fn(() => {
      repository.sequence.push('runtime');
      return Promise.resolve(runtimeOperation('task.pause'));
    });
    const service = new NodeControlTaskControlService({
      runtime: { execute },
      operations: repository,
      clock: sequentialClock(),
    });

    const result = await service.execute(
      'pause',
      'task-1',
      {
        reason: 'Operator pauses execution.',
        idempotencyKey: 'pause-task-1-key',
        correlationId: 'correlation-1',
      },
      { actorId: 'node-control:organization_service', role: 'organization_service' },
    );

    expect(result).toMatchObject({
      operationType: 'task.pause',
      status: 'succeeded',
      actorId: 'node-control:organization_service',
      reason: 'Operator pauses execution.',
      result: { runtimeOperationId: 'runtime-task.pause' },
    });
    expect(repository.sequence).toEqual([
      'record:accepted',
      'start:running',
      'runtime',
      'complete:succeeded',
    ]);
    expect(execute).toHaveBeenCalledWith(
      'pause',
      'task-1',
      expect.objectContaining({ correlationId: 'correlation-1' }),
    );
    expect(repository.audits.map((audit) => audit.resultCode)).toEqual([
      'ACCEPTED',
      'DISPATCH_STARTED',
      'SUCCEEDED',
    ]);
  });

  it('returns exact terminal replay without calling Runtime again', async () => {
    const repository = new MemoryOperations();
    const execute = vi.fn(() => Promise.resolve(runtimeOperation('task.cancel')));
    const service = new NodeControlTaskControlService({
      runtime: { execute },
      operations: repository,
      clock: sequentialClock(),
    });
    const command = {
      reason: 'Cancel safely.',
      idempotencyKey: 'cancel-task-key',
      correlationId: 'correlation-cancel',
    };
    const principal = { actorId: 'node-control:node_admin', role: 'node_admin' as const };

    const first = await service.execute('cancel', 'task-2', command, principal);
    const replay = await service.execute('cancel', 'task-2', command, principal);

    expect(replay).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects an idempotency key reused for different input', async () => {
    const repository = new MemoryOperations();
    const service = new NodeControlTaskControlService({
      runtime: { execute: () => Promise.resolve(runtimeOperation('task.resume')) },
      operations: repository,
      clock: sequentialClock(),
    });
    const principal = { actorId: 'node-control:node_admin', role: 'node_admin' as const };
    await service.execute(
      'resume',
      'task-3',
      { reason: 'Resume.', idempotencyKey: 'same-key', correlationId: 'one' },
      principal,
    );

    await expect(
      service.execute(
        'resume',
        'task-3',
        { reason: 'Different reason.', idempotencyKey: 'same-key', correlationId: 'two' },
        principal,
      ),
    ).rejects.toMatchObject({ code: 'TASK_CONTROL_IDEMPOTENCY_CONFLICT', status: 409 });
  });

  it('retries an accepted persisted intent after a process restart', async () => {
    const repository = new MemoryOperations();
    const clock = sequentialClock();
    const firstRuntime = vi.fn(() => Promise.resolve(runtimeOperation('task.goal_patch')));
    const first = new NodeControlTaskControlService({
      runtime: { execute: firstRuntime },
      operations: repository,
      clock,
    });
    repository.failStartBeforeMutation = true;
    await expect(
      first.execute(
        'goal_patch',
        'task-4',
        {
          reason: 'Clarify the Goal.',
          idempotencyKey: 'goal-patch-key',
          correlationId: 'patch-1',
          payload: { instruction: 'Keep confirmed evidence.' },
        },
        { actorId: 'node-control:node_admin', role: 'node_admin' },
      ),
    ).rejects.toBeDefined();
    repository.failStartBeforeMutation = false;
    const resumedRuntime = vi.fn(() => Promise.resolve(runtimeOperation('task.goal_patch')));
    const restarted = new NodeControlTaskControlService({
      runtime: { execute: resumedRuntime },
      operations: repository,
      clock,
    });

    const result = await restarted.execute(
      'goal_patch',
      'task-4',
      {
        reason: 'Clarify the Goal.',
        idempotencyKey: 'goal-patch-key',
        correlationId: 'patch-2',
        payload: { instruction: 'Keep confirmed evidence.' },
      },
      { actorId: 'node-control:node_admin', role: 'node_admin' },
    );

    expect(result.status).toBe('succeeded');
    expect(resumedRuntime).toHaveBeenCalledTimes(1);
    expect(firstRuntime).not.toHaveBeenCalled();
  });

  it('fails closed on a running replay after a post-dispatch process failure', async () => {
    const repository = new MemoryOperations();
    const clock = sequentialClock();
    const firstRuntime = vi.fn(() => Promise.resolve(runtimeOperation('task.pause')));
    repository.failCompletion = true;
    const command = {
      reason: 'Pause once only.',
      idempotencyKey: 'pause-once-running-key',
      correlationId: 'pause-running-1',
    };
    const principal = { actorId: 'node-control:node_admin', role: 'node_admin' as const };

    await expect(
      new NodeControlTaskControlService({
        runtime: { execute: firstRuntime },
        operations: repository,
        clock,
      }).execute('pause', 'task-running', command, principal),
    ).rejects.toBeDefined();
    repository.failCompletion = false;
    const replayRuntime = vi.fn(() => Promise.resolve(runtimeOperation('task.pause')));

    await expect(
      new NodeControlTaskControlService({
        runtime: { execute: replayRuntime },
        operations: repository,
        clock,
      }).execute('pause', 'task-running', command, principal),
    ).rejects.toMatchObject({ code: 'TASK_CONTROL_DISPATCH_UNCERTAIN', status: 409 });
    expect(firstRuntime).toHaveBeenCalledTimes(1);
    expect(replayRuntime).not.toHaveBeenCalled();
  });

  it('rejects non-control principals before persistence or Runtime access', async () => {
    const repository = new MemoryOperations();
    const execute = vi.fn(() => Promise.resolve(runtimeOperation('task.pause')));
    const service = new NodeControlTaskControlService({
      runtime: { execute },
      operations: repository,
      clock: sequentialClock(),
    });

    await expect(
      service.execute(
        'pause',
        'task-5',
        { reason: 'Pause.', idempotencyKey: 'pause-key', correlationId: 'five' },
        { actorId: 'node-control:node_viewer', role: 'node_viewer' },
      ),
    ).rejects.toBeInstanceOf(NodeControlTaskControlError);
    expect(repository.operations).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
  });
});

class MemoryOperations implements NodeControlTaskControlOperationRepository {
  readonly operations: ManagementOperation[] = [];
  readonly audits: ControlAuditEvent[] = [];
  readonly sequence: string[] = [];
  failCompletion = false;
  failStartBeforeMutation = false;

  findGovernanceOperationReplay(
    operationType: string,
    idempotencyKeyHash: string,
  ): Promise<ManagementOperation | undefined> {
    return Promise.resolve(
      this.operations.find(
        (item) =>
          item.operationType === operationType && item.idempotencyKeyHash === idempotencyKeyHash,
      ),
    );
  }

  recordGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation> {
    const existing = this.operations.find(
      (item) =>
        item.operationType === operation.operationType &&
        item.idempotencyKeyHash === operation.idempotencyKeyHash,
    );
    if (existing !== undefined) return Promise.resolve(existing);
    this.operations.push(operation);
    this.audits.push(audit);
    this.sequence.push(`record:${operation.status}`);
    return Promise.resolve(operation);
  }

  startGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation> {
    if (this.failStartBeforeMutation)
      return Promise.reject(new Error('PROCESS_CRASH_BEFORE_DISPATCH_CAS'));
    const index = this.operations.findIndex((item) => item.operationId === operation.operationId);
    const current = this.operations[index];
    if (index < 0 || current === undefined) return Promise.reject(new Error('OPERATION_NOT_FOUND'));
    if (current.status === 'running')
      return Promise.reject(
        Object.assign(new Error('Dispatch already started.'), {
          code: 'RUNTIME_GOVERNANCE_DISPATCH_ALREADY_STARTED',
          status: 409,
        }),
      );
    if (['succeeded', 'failed', 'canceled'].includes(current.status))
      return Promise.resolve(current);
    const running = transitionManagementOperation(current, 'running', audit.createdAt);
    this.operations[index] = running;
    this.audits.push(audit);
    this.sequence.push('start:running');
    return Promise.resolve(running);
  }

  completeGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation> {
    if (this.failCompletion) return Promise.reject(new Error('PROCESS_CRASH_BEFORE_COMPLETION'));
    const index = this.operations.findIndex((item) => item.operationId === operation.operationId);
    if (index < 0) return Promise.reject(new Error('OPERATION_NOT_FOUND'));
    this.operations[index] = operation;
    this.audits.push(audit);
    this.sequence.push(`complete:${operation.status}`);
    return Promise.resolve(operation);
  }
}

function runtimeOperation(operationType: string): ManagementOperation {
  const accepted = createManagementOperation(
    {
      operationId: `runtime-${operationType}`,
      operationType,
      target: { type: 'task', id: 'runtime-task' },
      actorId: 'sdar-runtime',
      reason: 'Runtime applied Task authority.',
      idempotencyKeyHash: 'a'.repeat(64),
      inputHash: 'b'.repeat(64),
    },
    '2026-08-13T02:00:00.000Z',
  );
  return transitionManagementOperation(
    transitionManagementOperation(accepted, 'running', '2026-08-13T02:00:00.001Z'),
    'succeeded',
    '2026-08-13T02:00:00.002Z',
    { result: { phase: 'applied' } },
  );
}

function sequentialClock(): Readonly<{ now(): string }> {
  let tick = 0;
  return {
    now() {
      tick += 1;
      return new Date(Date.parse('2026-08-13T02:00:00.000Z') + tick).toISOString();
    },
  };
}
