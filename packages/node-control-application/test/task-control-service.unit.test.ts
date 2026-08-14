import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  NodeControlTaskControlError,
  NodeControlTaskControlService,
  type NodeControlRuntimeTaskControlClient,
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
    const execute = vi.fn<NodeControlRuntimeTaskControlClient['execute']>(
      (_action, taskId, command) => {
        repository.sequence.push('runtime');
        return Promise.resolve(runtimeOperation('task.pause', taskId, command.idempotencyKey));
      },
    );
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
    const execute = vi.fn<NodeControlRuntimeTaskControlClient['execute']>(
      (_action, taskId, command) =>
        Promise.resolve(runtimeOperation('task.cancel', taskId, command.idempotencyKey)),
    );
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

  it('uses one canonical Task identifier for idempotency and Runtime dispatch', async () => {
    const repository = new MemoryOperations();
    const execute = vi.fn<NodeControlRuntimeTaskControlClient['execute']>(
      (_action, taskId, dispatched) =>
        Promise.resolve(runtimeOperation('task.pause', taskId, dispatched.idempotencyKey)),
    );
    const service = new NodeControlTaskControlService({
      runtime: { execute },
      operations: repository,
      clock: sequentialClock(),
    });
    const command = {
      reason: 'Pause the canonical Task.',
      idempotencyKey: 'canonical-task-id-key',
      correlationId: 'canonical-task-id-correlation',
    };
    const principal = { actorId: 'node-control:node_admin', role: 'node_admin' as const };

    const first = await service.execute('pause', '  task-canonical  ', command, principal);
    const replay = await service.execute('pause', 'task-canonical', command, principal);

    expect(replay).toEqual(first);
    expect(first.target.id).toBe('task-canonical');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('pause', 'task-canonical', command);
  });

  it('replays terminal Runtime failures with one stable public error and no redispatch', async () => {
    const failures = [
      {
        kind: 'rejected' as const,
        code: 'REVISION_CONFLICT',
        status: 412,
      },
      {
        kind: 'runtime-failed' as const,
        code: 'RUNTIME_TASK_REJECTED',
        status: 503,
      },
    ];
    for (const [index, failure] of failures.entries()) {
      const repository = new MemoryOperations();
      const taskId = `task-${String(index)}`;
      const idempotencyKey = `terminal-failure-${String(index)}`;
      const execute = vi.fn<NodeControlRuntimeTaskControlClient['execute']>(() =>
        failure.kind === 'rejected'
          ? Promise.reject(
              Object.assign(new Error('stale'), { code: 'REVISION_CONFLICT', status: 412 }),
            )
          : Promise.resolve(
              Object.freeze({
                ...runtimeOperation('task.pause', taskId, idempotencyKey),
                status: 'failed' as const,
                errorCode: 'RUNTIME_TASK_REJECTED',
              }),
            ),
      );
      const service = new NodeControlTaskControlService({
        runtime: { execute },
        operations: repository,
        clock: sequentialClock(),
      });
      const command = {
        reason: 'Apply exact Task control.',
        idempotencyKey,
        correlationId: `terminal-correlation-${String(index)}`,
      };
      const principal = { actorId: 'node-control:node_admin', role: 'node_admin' as const };
      const first = await rejectedTaskControlError(
        service.execute('pause', taskId, command, principal),
      );
      const replay = await rejectedTaskControlError(
        service.execute('pause', taskId, command, principal),
      );

      expect(publicErrorShape(first)).toEqual({
        name: 'NodeControlTaskControlError',
        code: failure.code,
        status: failure.status,
        message: 'The Runtime Task authority rejected or could not complete the command.',
      });
      expect(publicErrorShape(replay)).toEqual(publicErrorShape(first));
      expect(repository.operations[0]).toMatchObject({
        status: 'failed',
        errorCode: first.code,
        result: { failureStatus: first.status },
      });
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    [
      'HTTP 503',
      Object.assign(new Error('private upstream detail'), {
        code: 'RUNTIME_TASK_CONTROL_HTTP_503',
        status: 503,
      }),
    ],
    ['connection reset', new Error('ECONNRESET')],
    [
      'HTTP 408',
      Object.assign(new Error('request timeout'), {
        code: 'RUNTIME_TASK_CONTROL_HTTP_408',
        status: 408,
      }),
    ],
    [
      'HTTP 425',
      Object.assign(new Error('too early'), {
        code: 'RUNTIME_TASK_CONTROL_HTTP_425',
        status: 425,
      }),
    ],
    [
      'HTTP 429',
      Object.assign(new Error('rate limited'), {
        code: 'RUNTIME_TASK_CONTROL_HTTP_429',
        status: 429,
      }),
    ],
    [
      'unknown HTTP 400',
      Object.assign(new Error('unstructured rejection'), {
        code: 'RUNTIME_TASK_CONTROL_HTTP_400',
        status: 400,
      }),
    ],
  ])(
    'keeps ambiguous %s dispatch running and converges through the same Runtime key',
    async (_name, failure) => {
      const repository = new MemoryOperations();
      const execute = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(
          runtimeOperation(
            'task.pause',
            'task-ambiguous',
            `ambiguous-${_name.replaceAll(' ', '-').toLowerCase()}`,
          ),
        );
      const service = new NodeControlTaskControlService({
        runtime: { execute },
        operations: repository,
        clock: sequentialClock(),
      });
      const command = {
        reason: 'Pause through an idempotent Runtime command.',
        idempotencyKey: `ambiguous-${_name.replaceAll(' ', '-').toLowerCase()}`,
        correlationId: 'ambiguous-correlation',
      };
      const principal = { actorId: 'node-control:node_admin', role: 'node_admin' as const };

      await expect(
        service.execute('pause', 'task-ambiguous', command, principal),
      ).rejects.toMatchObject({
        code: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
        status: 503,
      });
      expect(repository.operations[0]).toMatchObject({
        status: 'running',
        errorCode: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
        result: { runtimeReconciliationPending: true, failureStatus: 503 },
      });
      await expect(
        service.execute('pause', 'task-ambiguous', command, principal),
      ).resolves.toMatchObject({
        status: 'succeeded',
      });
      expect(execute).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['accepted', 'running'] as const)(
    'does not project a nonterminal Runtime %s receipt as success',
    async (status) => {
      const repository = new MemoryOperations();
      const accepted = createManagementOperation(
        {
          operationId: `runtime-nonterminal-${status}`,
          operationType: 'task.resume',
          target: { type: 'task', id: 'runtime-task' },
          actorId: 'sdar-runtime',
          reason: 'Runtime command is not terminal yet.',
          idempotencyKeyHash: 'c'.repeat(64),
          inputHash: 'd'.repeat(64),
        },
        '2026-08-13T02:01:00.000Z',
      );
      const nonterminal =
        status === 'accepted'
          ? accepted
          : transitionManagementOperation(accepted, 'running', '2026-08-13T02:01:00.001Z');
      const execute = vi
        .fn()
        .mockResolvedValueOnce(nonterminal)
        .mockResolvedValueOnce(
          runtimeOperation('task.resume', 'task-nonterminal', `nonterminal-${status}`),
        );
      const service = new NodeControlTaskControlService({
        runtime: { execute },
        operations: repository,
        clock: sequentialClock(),
      });
      const command = {
        reason: 'Resume only after Runtime terminal authority.',
        idempotencyKey: `nonterminal-${status}`,
        correlationId: `nonterminal-${status}-correlation`,
      };
      const principal = { actorId: 'node-control:node_admin', role: 'node_admin' as const };

      await expect(
        service.execute('resume', 'task-nonterminal', command, principal),
      ).rejects.toMatchObject({
        code: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
        status: 503,
      });
      await expect(
        service.execute('resume', 'task-nonterminal', command, principal),
      ).resolves.toMatchObject({ status: 'succeeded' });
      expect(execute).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['operation', { operationType: 'task.resume' }],
    ['target', { target: { type: 'task', id: 'different-task' } }],
    ['idempotency key', { idempotencyKeyHash: 'f'.repeat(64) }],
  ] as const)(
    'keeps a terminal Runtime receipt with mismatched %s pending',
    async (_case, mismatch) => {
      const repository = new MemoryOperations();
      const command = {
        reason: 'Accept only the exact Runtime receipt.',
        idempotencyKey: `receipt-mismatch-${_case.replaceAll(' ', '-')}`,
        correlationId: 'receipt-mismatch-correlation',
      };
      const receipt = Object.freeze({
        ...runtimeOperation('task.pause', 'task-receipt', command.idempotencyKey),
        ...mismatch,
      });
      const execute = vi.fn(() => Promise.resolve(receipt));
      const service = new NodeControlTaskControlService({
        runtime: { execute },
        operations: repository,
        clock: sequentialClock(),
      });

      await expect(
        service.execute('pause', 'task-receipt', command, {
          actorId: 'node-control:node_admin',
          role: 'node_admin',
        }),
      ).rejects.toMatchObject({
        code: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
        status: 503,
      });
      expect(repository.operations[0]).toMatchObject({ status: 'running' });
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it('persists reconciliation pending, rejects changed input, and converges on replay', async () => {
    const repository = new MemoryOperations();
    const execute = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('Runtime Task command requires reconciliation.'), {
          code: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
          status: 503,
        }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('Cognitive action is still reconciling.'), {
          code: 'COGNITIVE_MANAGEMENT_ACTION_RECONCILIATION_PENDING',
          status: 409,
        }),
      )
      .mockResolvedValueOnce(
        runtimeOperation('task.cancel', 'task-reconciliation', 'cancel-reconciliation-key'),
      );
    const service = new NodeControlTaskControlService({
      runtime: { execute },
      operations: repository,
      clock: sequentialClock(),
    });
    const command = {
      reason: 'Cancel once through the durable Runtime command.',
      idempotencyKey: 'cancel-reconciliation-key',
      correlationId: 'correlation-reconciliation',
      expectedRevision: 8,
    };
    const principal = { actorId: 'node-control:node_admin', role: 'node_admin' as const };

    const firstError = await rejectedTaskControlError(
      service.execute('cancel', 'task-reconciliation', command, principal),
    );

    expect(publicErrorShape(firstError)).toEqual({
      name: 'NodeControlTaskControlError',
      code: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
      status: 503,
      message: 'The Runtime Task authority rejected or could not complete the command.',
    });
    expect(repository.operations).toEqual([
      expect.objectContaining({
        status: 'running',
        errorCode: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
        result: { runtimeReconciliationPending: true, failureStatus: 503 },
      }),
    ]);
    await expect(
      service.execute(
        'cancel',
        'task-reconciliation',
        { ...command, reason: 'A conflicting reason must not replay.' },
        principal,
      ),
    ).rejects.toMatchObject({ code: 'TASK_CONTROL_IDEMPOTENCY_CONFLICT', status: 409 });
    expect(execute).toHaveBeenCalledTimes(1);

    const secondError = await rejectedTaskControlError(
      service.execute('cancel', 'task-reconciliation', command, principal),
    );
    expect(publicErrorShape(secondError)).toEqual(publicErrorShape(firstError));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(repository.operations[0]).toMatchObject({
      status: 'running',
      errorCode: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
      result: { runtimeReconciliationPending: true, failureStatus: 503 },
    });

    const replay = await service.execute('cancel', 'task-reconciliation', command, principal);
    expect(replay.status).toBe('succeeded');
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('fails closed with 503 when replaying a legacy failed operation without failure status', async () => {
    const repository = new MemoryOperations();
    const principal = { actorId: 'node-control:node_admin', role: 'node_admin' as const };
    const execute = vi.fn(() =>
      Promise.reject(Object.assign(new Error('stale'), { code: 'REVISION_CONFLICT', status: 412 })),
    );
    const service = new NodeControlTaskControlService({
      runtime: { execute },
      operations: repository,
      clock: sequentialClock(),
    });
    const command = {
      reason: 'Pause safely.',
      idempotencyKey: 'legacy-failed-key',
      correlationId: 'correlation-legacy-failed',
    };

    await rejectedTaskControlError(
      service.execute('pause', 'task-legacy-failed', command, principal),
    );
    const [persisted] = repository.operations;
    if (persisted === undefined) throw new Error('Expected a persisted failed operation.');
    repository.operations[0] = Object.freeze({ ...persisted, result: undefined });
    execute.mockClear();

    await expect(
      service.execute('pause', 'task-legacy-failed', command, principal),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT', status: 503 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused for different input', async () => {
    const repository = new MemoryOperations();
    const service = new NodeControlTaskControlService({
      runtime: {
        execute: (_action, taskId, command) =>
          Promise.resolve(runtimeOperation('task.resume', taskId, command.idempotencyKey)),
      },
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
    const firstRuntime = vi.fn<NodeControlRuntimeTaskControlClient['execute']>(
      (_action, taskId, command) =>
        Promise.resolve(runtimeOperation('task.goal_patch', taskId, command.idempotencyKey)),
    );
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
    const resumedRuntime = vi.fn<NodeControlRuntimeTaskControlClient['execute']>(
      (_action, taskId, command) =>
        Promise.resolve(runtimeOperation('task.goal_patch', taskId, command.idempotencyKey)),
    );
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

  it('recovers a Runtime terminal result after the outer completion write fails', async () => {
    const repository = new MemoryOperations();
    const clock = sequentialClock();
    const firstRuntime = vi.fn<NodeControlRuntimeTaskControlClient['execute']>(
      (_action, taskId, dispatched) =>
        Promise.resolve(runtimeOperation('task.pause', taskId, dispatched.idempotencyKey)),
    );
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
    ).rejects.toMatchObject({
      code: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
      status: 503,
    });
    repository.failCompletion = false;
    const replayRuntime = vi.fn<NodeControlRuntimeTaskControlClient['execute']>(
      (_action, taskId, dispatched) =>
        Promise.resolve(runtimeOperation('task.pause', taskId, dispatched.idempotencyKey)),
    );

    await expect(
      new NodeControlTaskControlService({
        runtime: { execute: replayRuntime },
        operations: repository,
        clock,
      }).execute('pause', 'task-running', command, principal),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(firstRuntime).toHaveBeenCalledTimes(1);
    expect(replayRuntime).toHaveBeenCalledTimes(1);
  });

  it('does not redispatch a running operation with a malformed reconciliation marker', async () => {
    const repository = new MemoryOperations();
    const command = {
      reason: 'Pause with a strictly validated reconciliation marker.',
      idempotencyKey: 'malformed-marker-key',
      correlationId: 'malformed-marker-correlation',
    };
    const principal = { actorId: 'node-control:node_admin', role: 'node_admin' as const };
    const firstRuntime = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error('pending'), {
          code: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
          status: 503,
        }),
      ),
    );
    const service = new NodeControlTaskControlService({
      runtime: { execute: firstRuntime },
      operations: repository,
      clock: sequentialClock(),
    });
    await rejectedTaskControlError(service.execute('pause', 'task-marker', command, principal));
    const persisted = repository.operations[0];
    if (persisted === undefined) throw new Error('Expected a persisted reconciliation marker.');
    repository.operations[0] = Object.freeze({
      ...persisted,
      result: { runtimeReconciliationPending: true, failureStatus: '503' },
    });
    const replayRuntime = vi.fn<NodeControlRuntimeTaskControlClient['execute']>(
      (_action, taskId, dispatched) =>
        Promise.resolve(runtimeOperation('task.pause', taskId, dispatched.idempotencyKey)),
    );

    await expect(
      new NodeControlTaskControlService({
        runtime: { execute: replayRuntime },
        operations: repository,
        clock: sequentialClock(),
      }).execute('pause', 'task-marker', command, principal),
    ).rejects.toMatchObject({ code: 'TASK_CONTROL_DISPATCH_UNCERTAIN', status: 409 });
    expect(replayRuntime).not.toHaveBeenCalled();
  });

  it('rejects non-control principals before persistence or Runtime access', async () => {
    const repository = new MemoryOperations();
    const execute = vi.fn<NodeControlRuntimeTaskControlClient['execute']>(
      (_action, taskId, command) =>
        Promise.resolve(runtimeOperation('task.pause', taskId, command.idempotencyKey)),
    );
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

  markGovernanceOperationReconciliationPending(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation> {
    const index = this.operations.findIndex((item) => item.operationId === operation.operationId);
    const current = this.operations[index];
    if (index < 0 || current === undefined) return Promise.reject(new Error('OPERATION_NOT_FOUND'));
    if (['succeeded', 'failed', 'canceled'].includes(current.status))
      return Promise.resolve(current);
    if (current.status !== 'running' || operation.status !== 'running')
      return Promise.reject(new Error('OPERATION_NOT_RUNNING'));
    this.operations[index] = operation;
    this.audits.push(audit);
    this.sequence.push('mark:reconciliation_pending');
    return Promise.resolve(operation);
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

function runtimeOperation(
  operationType: string,
  taskId = 'runtime-task',
  idempotencyKey = 'runtime-default-key',
): ManagementOperation {
  const accepted = createManagementOperation(
    {
      operationId: `runtime-${operationType}`,
      operationType,
      target: { type: 'task', id: taskId },
      actorId: 'sdar-runtime',
      reason: 'Runtime applied Task authority.',
      idempotencyKeyHash: sha256(idempotencyKey),
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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

async function rejectedTaskControlError(
  operation: Promise<ManagementOperation>,
): Promise<NodeControlTaskControlError> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof NodeControlTaskControlError) return error;
    throw error;
  }
  throw new Error('Expected Runtime Task control to reject.');
}

function publicErrorShape(error: NodeControlTaskControlError) {
  return Object.freeze({
    name: error.name,
    code: error.code,
    status: error.status,
    message: error.message,
  });
}
