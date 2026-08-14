import { describe, expect, it } from 'vitest';

import type {
  ControlAuditEvent,
  ManagementOperation,
  NodeProfile,
} from '../../node-control-domain/src/index.js';
import {
  createManagementOperation,
  transitionManagementOperation,
} from '../../node-control-domain/src/index.js';
import {
  NodeControlFoundationService,
  type ConfigurationMutationContext,
  type NodeControlFoundationRepository,
} from '../src/index.js';

class MemoryFoundationRepository implements NodeControlFoundationRepository {
  profile: NodeProfile | undefined;
  audits: ControlAuditEvent[] = [];
  operations: ManagementOperation[] = [];
  ready = true;

  migrate(): Promise<void> {
    return Promise.resolve();
  }
  probe(): Promise<boolean> {
    return Promise.resolve(this.ready);
  }
  findNodeProfile(): Promise<NodeProfile | undefined> {
    return Promise.resolve(this.profile);
  }
  bootstrapNodeProfile(profile: NodeProfile, audit: ControlAuditEvent): Promise<boolean> {
    if (this.profile !== undefined) return Promise.resolve(false);
    this.profile = profile;
    this.audits.push(audit);
    return Promise.resolve(true);
  }
  createNodeProfileDraft(
    profile: NodeProfile,
    _expectedRevision: number,
    _context: ConfigurationMutationContext,
  ): Promise<NodeProfile> {
    void _expectedRevision;
    void _context;
    return Promise.resolve(profile);
  }
  validateNodeProfileDraft(
    _revision: number,
    _expectedRevision: number,
    _context: ConfigurationMutationContext,
  ): Promise<NodeProfile> {
    void _revision;
    void _expectedRevision;
    void _context;
    if (this.profile === undefined) return Promise.reject(new Error('NODE_PROFILE_NOT_FOUND'));
    return Promise.resolve(this.profile);
  }
  publishNodeProfileDraft(
    _revision: number,
    _expectedRevision: number,
    operation: ManagementOperation,
    audit: ControlAuditEvent,
    _context: ConfigurationMutationContext,
  ): Promise<ManagementOperation> {
    void _revision;
    void _expectedRevision;
    void _context;
    this.audits.push(audit);
    return Promise.resolve(operation);
  }
  listManagementOperations(): Promise<readonly ManagementOperation[]> {
    return Promise.resolve(this.operations);
  }
  findManagementOperation(operationId: string): Promise<ManagementOperation | undefined> {
    return Promise.resolve(
      this.operations.find((operation) => operation.operationId === operationId),
    );
  }
  cancelGovernanceOperation(
    operationId: string,
    audit: ControlAuditEvent,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation | undefined> {
    const index = this.operations.findIndex((operation) => operation.operationId === operationId);
    const current = this.operations[index];
    if (current === undefined) return Promise.resolve(undefined);
    if (current.status === 'canceled') {
      const cancellation = (
        current.result as
          | {
              cancellation?: {
                idempotencyKeyHash?: string;
                requestHash?: string;
                actorId?: string;
              };
            }
          | undefined
      )?.cancellation;
      if (
        cancellation?.idempotencyKeyHash !== context.idempotencyKeyHash ||
        cancellation.requestHash !== context.requestHash ||
        cancellation.actorId !== context.actorId
      )
        return Promise.reject(
          Object.assign(new Error('conflict'), {
            code: 'MANAGEMENT_OPERATION_CANCEL_IDEMPOTENCY_CONFLICT',
          }),
        );
      return Promise.resolve(current);
    }
    if (current.status !== 'accepted')
      return Promise.reject(
        Object.assign(new Error('not cancellable'), {
          code: 'MANAGEMENT_OPERATION_NOT_CANCELLABLE',
        }),
      );
    const canceled = transitionManagementOperation(current, 'canceled', audit.createdAt, {
      result: {
        canceledBeforeDispatch: true,
        cancellation: {
          actorId: context.actorId,
          idempotencyKeyHash: context.idempotencyKeyHash,
          requestHash: context.requestHash,
        },
      },
    });
    this.operations[index] = canceled;
    this.audits.push(audit);
    return Promise.resolve(canceled);
  }
  listAuditEvents(): Promise<readonly ControlAuditEvent[]> {
    return Promise.resolve(this.audits);
  }
}

describe('NodeControlFoundationService', () => {
  it('bootstraps one stable Node identity and records an audit event', async () => {
    const repository = new MemoryFoundationRepository();
    const service = serviceFor(repository);
    const input = {
      nodeId: 'node-1',
      nodeType: 'sdar-runtime',
      displayName: 'Node One',
      environment: 'test',
      runtimeEndpointRef: 'http://127.0.0.1:9998',
    };
    await expect(service.bootstrapNodeProfile(input)).resolves.toMatchObject({ nodeId: 'node-1' });
    await service.bootstrapNodeProfile(input);
    expect(repository.audits).toHaveLength(1);
  });

  it('reports not-ready without a profile and degraded health before P02 runtime control', async () => {
    const repository = new MemoryFoundationRepository();
    const service = serviceFor(repository);
    await expect(service.getReadiness()).resolves.toMatchObject({ status: 'not_ready' });
    await service.bootstrapNodeProfile({
      nodeId: 'node-1',
      nodeType: 'sdar-runtime',
      displayName: 'Node One',
      environment: 'test',
      runtimeEndpointRef: 'http://127.0.0.1:9998',
    });
    await expect(service.getNodeHealth()).resolves.toMatchObject({
      status: 'degraded',
      components: expect.arrayContaining([
        expect.objectContaining({
          component: 'runtime_control',
          status: 'disabled',
          reasonCode: 'RUNTIME_CONTROL_NOT_CONFIGURED',
        }),
      ]),
    });
  });

  it('cancels only an accepted pre-dispatch Management Operation and replays cancellation', async () => {
    const repository = new MemoryFoundationRepository();
    const accepted = managementOperation('operation-cancel-accepted');
    repository.operations.push(accepted);
    const service = serviceFor(repository);

    const canceled = await service.cancelManagementOperation(
      accepted.operationId,
      'cancel-operation-key',
      { reason: 'Stop before Runtime dispatch.' },
      'node-control:node_admin',
    );
    const replay = await service.cancelManagementOperation(
      accepted.operationId,
      'cancel-operation-key',
      { reason: 'Stop before Runtime dispatch.' },
      'node-control:node_admin',
    );

    expect(canceled).toMatchObject({
      status: 'canceled',
      result: { canceledBeforeDispatch: true },
    });
    expect(replay).toEqual(canceled);
    expect(repository.audits).toEqual([
      expect.objectContaining({
        actorId: 'node-control:node_admin',
        resultCode: 'MANAGEMENT_OPERATION_CANCELED_BEFORE_DISPATCH',
      }),
    ]);
  });

  it('fails closed when cancellation races after dispatch start or terminal completion', async () => {
    const repository = new MemoryFoundationRepository();
    const accepted = managementOperation('operation-cancel-running');
    repository.operations.push(
      transitionManagementOperation(accepted, 'running', '2026-08-01T17:00:01.000Z'),
    );
    const service = serviceFor(repository);

    await expect(
      service.cancelManagementOperation(
        accepted.operationId,
        'cancel-running-key',
        { reason: 'Too late.' },
        'node-control:node_admin',
      ),
    ).rejects.toMatchObject({ code: 'MANAGEMENT_OPERATION_NOT_CANCELLABLE', status: 409 });
  });
});

function serviceFor(repository: MemoryFoundationRepository): NodeControlFoundationService {
  return new NodeControlFoundationService({
    repository,
    clock: { now: () => '2026-08-01T17:00:00.000Z' },
    ids: { next: () => 'audit-1' },
  });
}

function managementOperation(operationId: string): ManagementOperation {
  return createManagementOperation(
    {
      operationId,
      operationType: 'task.pause',
      target: { type: 'task', id: 'task-cancel' },
      actorId: 'node-control:node_admin',
      reason: 'Pause task.',
      idempotencyKeyHash: 'a'.repeat(64),
      inputHash: 'b'.repeat(64),
    },
    '2026-08-01T17:00:00.000Z',
  );
}
