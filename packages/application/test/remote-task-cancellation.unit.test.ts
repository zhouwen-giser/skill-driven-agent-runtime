import { describe, expect, it, vi } from 'vitest';

import {
  createRemoteTaskBinding,
  type RemoteTaskBinding,
  type RemoteTaskCancellationAttempt,
  type RemoteTaskCancellationProviderTerminalStatus,
  type RemoteTaskCancellationRequest,
} from '../../domain/src/index.js';
import {
  RemoteTaskCancellationReconciler,
  RemoteTaskCancellationService,
  RemoteTaskCancellationWorker,
} from '../src/index.js';
import type {
  RemoteTaskCancellationClaimResult,
  RemoteTaskCancellationJob,
  RemoteTaskCancellationMutationResult,
  RemoteTaskCancellationQueue,
  RemoteTaskCancellationRepository,
  RemoteTaskCancellationRequestResult,
  ContextSerialGate,
  RemoteTaskPollJobState,
} from '../src/ports.js';

const timestamp = '2026-07-17T08:00:00.000Z';

describe('RemoteTaskCancellationService', () => {
  it('persists requested separately from Provider status and schedules after the durable write', async () => {
    const harness = createHarness();

    await expect(
      harness.service.request({
        bindingId: 'binding-1',
        idempotencyKey: 'cancel-task-1',
        source: 'task',
        reasonCode: 'TASK_CANCELED',
        summary: 'Task canceled by user.',
      }),
    ).resolves.toMatchObject({
      disposition: 'requested',
      deliveryScheduled: true,
      request: { deliveryStatus: 'requested' },
    });

    expect(harness.operations).toEqual(['postgres.request', 'queue.enqueue']);
    expect(harness.remoteTasks.binding.protocolStatus).toBe('working');
    expect(harness.cancellations.request?.deliveryStatus).toBe('requested');
    expect(harness.cancellations.request?.providerTerminalStatus).toBeUndefined();
  });

  it('keeps PostgreSQL authoritative when enqueue fails and converges an exact idempotent retry', async () => {
    const harness = createHarness();
    harness.queue.enqueueError = new Error('Redis unavailable');
    const input = {
      bindingId: 'binding-1',
      idempotencyKey: 'cancel-task-1',
      source: 'task' as const,
      reasonCode: 'TASK_CANCELED',
      summary: 'Task canceled by user.',
    };

    const first = await harness.service.request(input);
    harness.queue.enqueueError = undefined;
    const duplicate = await harness.service.request(input);

    expect(first).toMatchObject({ disposition: 'requested', deliveryScheduled: false });
    expect(duplicate).toMatchObject({
      disposition: 'requested',
      deliveryScheduled: true,
      request: { requestId: first.request?.requestId },
    });
    expect(harness.cancellations.createdCount).toBe(1);
  });

  it('does not create a request or wire job for Provider-terminal evidence', async () => {
    const harness = createHarness({ binding: binding({ protocolStatus: 'cancelled' }) });

    await expect(
      harness.service.request({
        bindingId: 'binding-1',
        idempotencyKey: 'late-cancel',
        source: 'management',
        reasonCode: 'OPERATOR_CANCEL',
        summary: 'Operator requested cancellation.',
      }),
    ).resolves.toEqual({ disposition: 'terminal', deliveryScheduled: false });
    expect(harness.cancellations.request).toBeUndefined();
    expect(harness.queue.enqueued).toEqual([]);
  });
});

describe('RemoteTaskCancellationWorker', () => {
  it('records protocol acknowledgement without fabricating Provider cancelled', async () => {
    const harness = createHarness();
    await requestCancellation(harness);

    await expect(harness.worker.process(firstJob(harness.queue))).resolves.toBe('acknowledged');

    expect(harness.cancellations.request).toMatchObject({
      deliveryStatus: 'acknowledged',
      protocolRevision: 'tasks-protocol-1',
    });
    expect(harness.cancellations.request?.providerTerminalStatus).toBeUndefined();
    expect(harness.remoteTasks.binding.protocolStatus).toBe('working');
    expect(harness.cancellations.attempts).toEqual([
      expect.objectContaining({ status: 'acknowledged', protocolRevision: 'tasks-protocol-1' }),
    ]);
  });

  it('records cancel uncertainty and a safe attempt when Provider is unreachable', async () => {
    const harness = createHarness();
    harness.sender.mockRejectedValueOnce(new Error('socket details must not persist'));
    await requestCancellation(harness);

    await expect(harness.worker.process(firstJob(harness.queue))).resolves.toBe('uncertain');

    expect(harness.cancellations.request).toMatchObject({
      deliveryStatus: 'uncertain',
      lastSafeErrorCode: 'MCP_TASK_CANCEL_PROVIDER_UNREACHABLE',
    });
    expect(harness.cancellations.request?.providerTerminalStatus).toBeUndefined();
    expect(harness.cancellations.attempts[0]).toMatchObject({
      status: 'provider_unreachable',
      errorCode: 'MCP_TASK_CANCEL_PROVIDER_UNREACHABLE',
    });
    expect(JSON.stringify(harness.cancellations.request)).not.toContain('socket details');
    expect(harness.remoteTasks.binding.protocolStatus).toBe('working');
  });

  it('does not send after Provider terminal resolution wins the race', async () => {
    const harness = createHarness();
    await requestCancellation(harness);
    await harness.cancellations.resolveCancellationFromProvider(
      'binding-1',
      'completed',
      timestamp,
    );

    await expect(harness.worker.process(firstJob(harness.queue))).resolves.toBe('stale');
    expect(harness.sender).not.toHaveBeenCalled();
    expect(harness.cancellations.request?.providerTerminalStatus).toBe('completed');
  });

  it('serializes the protocol call through the binding context authority', async () => {
    const harness = createHarness();
    await requestCancellation(harness);

    await harness.worker.process(firstJob(harness.queue));

    expect(harness.serial.contextIds).toEqual(['context-1']);
    expect(harness.sender).toHaveBeenCalledWith({
      serverId: 'server-1',
      remoteTaskId: 'provider-task-1',
      executionContext: { mode: 'live' },
    });
  });
});

describe('RemoteTaskCancellationReconciler', () => {
  it('rebuilds a missing requested delivery job but does not auto-retry uncertainty', async () => {
    const harness = createHarness();
    await requestCancellation(harness);
    harness.queue.enqueued.length = 0;
    const reconciler = new RemoteTaskCancellationReconciler({
      cancellations: harness.cancellations,
      queue: harness.queue,
      clock: harness.clock,
    });

    await expect(reconciler.reconcile()).resolves.toEqual({ examined: 1, scheduled: 1 });
    harness.cancellations.request = {
      ...requiredRequest(harness.cancellations.request),
      deliveryStatus: 'uncertain',
    };
    harness.queue.enqueued.length = 0;
    await expect(reconciler.reconcile()).resolves.toEqual({ examined: 0, scheduled: 0 });
  });
});

async function requestCancellation(harness: ReturnType<typeof createHarness>) {
  await harness.service.request({
    bindingId: 'binding-1',
    idempotencyKey: 'cancel-task-1',
    source: 'task',
    reasonCode: 'TASK_CANCELED',
    summary: 'Task canceled by user.',
  });
}

function createHarness(overrides: Readonly<{ binding?: RemoteTaskBinding }> = {}) {
  const operations: string[] = [];
  const remoteTasks = { binding: overrides.binding ?? binding() };
  const cancellations = new InMemoryCancellationRepository(remoteTasks, operations);
  const queue = new RecordingCancellationQueue(operations);
  let nowOrdinal = 0;
  const clock = {
    now: () => new Date(Date.parse(timestamp) + nowOrdinal++ * 10).toISOString(),
  };
  let requestId = 0;
  let attemptId = 0;
  let claimId = 0;
  const ids = {
    nextRequestId: () => `cancel-request-${String(++requestId)}`,
    nextAttemptId: () => `cancel-attempt-${String(++attemptId)}`,
    nextClaimToken: () => `cancel-claim-${String(++claimId)}`,
  };
  const serial = new RecordingSerialGate();
  const sender = vi.fn().mockResolvedValue({
    acknowledged: true as const,
    protocolRevision: 'tasks-protocol-1',
  });
  const service = new RemoteTaskCancellationService({
    remoteTasks: {
      findById: (bindingId) =>
        Promise.resolve(bindingId === 'binding-1' ? remoteTasks.binding : undefined),
    },
    cancellations,
    queue,
    clock,
    ids,
  });
  const worker = new RemoteTaskCancellationWorker({
    remoteTasks: {
      findById: (bindingId) =>
        Promise.resolve(bindingId === 'binding-1' ? remoteTasks.binding : undefined),
    },
    cancellations,
    sender: { cancelRemoteTask: sender },
    serial,
    clock,
    ids,
  });
  return {
    operations,
    remoteTasks,
    cancellations,
    queue,
    clock,
    serial,
    sender,
    service,
    worker,
  };
}

class RecordingCancellationQueue implements RemoteTaskCancellationQueue {
  readonly enqueued: RemoteTaskCancellationJob[] = [];
  readonly operations: string[];
  enqueueError: Error | undefined;

  constructor(operations: string[]) {
    this.operations = operations;
  }

  enqueue(input: RemoteTaskCancellationJob): Promise<void> {
    this.operations.push('queue.enqueue');
    if (this.enqueueError !== undefined) return Promise.reject(this.enqueueError);
    this.enqueued.push(input);
    return Promise.resolve();
  }

  state(): Promise<RemoteTaskPollJobState> {
    return Promise.resolve('missing');
  }
}

class RecordingSerialGate implements ContextSerialGate {
  readonly contextIds: string[] = [];

  run<T>(contextId: string, operation: () => Promise<T>): Promise<T> {
    this.contextIds.push(contextId);
    return operation();
  }
}

class InMemoryCancellationRepository implements RemoteTaskCancellationRepository {
  request: RemoteTaskCancellationRequest | undefined;
  readonly attempts: RemoteTaskCancellationAttempt[] = [];
  readonly remoteTasks: { binding: RemoteTaskBinding };
  readonly operations: string[];
  createdCount = 0;

  constructor(remoteTasks: { binding: RemoteTaskBinding }, operations: string[]) {
    this.remoteTasks = remoteTasks;
    this.operations = operations;
  }

  requestCancellation(
    request: RemoteTaskCancellationRequest,
    expectedBindingVersion: number,
  ): Promise<RemoteTaskCancellationRequestResult> {
    this.operations.push('postgres.request');
    if (this.request !== undefined)
      return Promise.resolve({ requested: true, request: this.request, created: false });
    if (this.remoteTasks.binding.version !== expectedBindingVersion)
      return Promise.resolve({ requested: false, reason: 'stale' });
    this.request = request;
    this.createdCount += 1;
    this.remoteTasks.binding = {
      ...this.remoteTasks.binding,
      localState: 'cancel_observing',
      version: this.remoteTasks.binding.version + 1,
    };
    return Promise.resolve({ requested: true, request, created: true });
  }

  findCancellation(requestId: string): Promise<RemoteTaskCancellationRequest | undefined> {
    return Promise.resolve(this.request?.requestId === requestId ? this.request : undefined);
  }

  listRequiringDelivery(): Promise<readonly RemoteTaskCancellationRequest[]> {
    return Promise.resolve(
      this.request?.deliveryStatus === 'requested' &&
        this.request.providerTerminalStatus === undefined
        ? [this.request]
        : [],
    );
  }

  claimCancellation(
    input: Readonly<{
      requestId: string;
      expectedVersion: number;
      claimToken: string;
      claimedAt: string;
      expiresAt: string;
    }>,
  ): Promise<RemoteTaskCancellationClaimResult> {
    if (this.request === undefined) return Promise.resolve({ claimed: false, reason: 'missing' });
    if (this.request.providerTerminalStatus !== undefined)
      return Promise.resolve({ claimed: false, reason: 'resolved' });
    if (this.request.version !== input.expectedVersion)
      return Promise.resolve({ claimed: false, reason: 'stale' });
    this.request = {
      ...this.request,
      claimToken: input.claimToken,
      claimedAt: input.claimedAt,
      claimExpiresAt: input.expiresAt,
      attemptCount: this.request.attemptCount + 1,
      updatedAt: input.claimedAt,
      version: this.request.version + 1,
    };
    return Promise.resolve({ claimed: true, request: this.request });
  }

  recordCancellationAcknowledged(
    input: Readonly<{
      requestId: string;
      expectedVersion: number;
      claimToken: string;
      attempt: RemoteTaskCancellationAttempt;
      acknowledgedAt: string;
      protocolRevision: string;
    }>,
  ): Promise<RemoteTaskCancellationMutationResult> {
    const current = this.request;
    this.attempts.push(input.attempt);
    if (current === undefined) return Promise.resolve({ applied: false, reason: 'missing' });
    if (current.providerTerminalStatus !== undefined)
      return Promise.resolve({ applied: false, reason: 'resolved' });
    if (current.version !== input.expectedVersion || current.claimToken !== input.claimToken)
      return Promise.resolve({ applied: false, reason: 'stale' });
    this.request = {
      ...withoutClaim(current),
      deliveryStatus: 'acknowledged',
      protocolRevision: input.protocolRevision,
      acknowledgedAt: input.acknowledgedAt,
      updatedAt: input.acknowledgedAt,
      version: current.version + 1,
    };
    return Promise.resolve({ applied: true, request: this.request });
  }

  recordCancellationUncertain(
    input: Readonly<{
      requestId: string;
      expectedVersion: number;
      claimToken: string;
      attempt: RemoteTaskCancellationAttempt;
      errorCode: string;
      observedAt: string;
    }>,
  ): Promise<RemoteTaskCancellationMutationResult> {
    const current = this.request;
    this.attempts.push(input.attempt);
    if (current === undefined) return Promise.resolve({ applied: false, reason: 'missing' });
    if (current.providerTerminalStatus !== undefined)
      return Promise.resolve({ applied: false, reason: 'resolved' });
    if (current.version !== input.expectedVersion || current.claimToken !== input.claimToken)
      return Promise.resolve({ applied: false, reason: 'stale' });
    this.request = {
      ...withoutClaim(current),
      deliveryStatus: 'uncertain',
      lastSafeErrorCode: input.errorCode,
      updatedAt: input.observedAt,
      version: current.version + 1,
    };
    return Promise.resolve({ applied: true, request: this.request });
  }

  resolveCancellationFromProvider(
    bindingId: string,
    status: RemoteTaskCancellationProviderTerminalStatus,
    resolvedAt: string,
  ): Promise<readonly RemoteTaskCancellationRequest[]> {
    if (this.request?.bindingId !== bindingId || this.request.providerTerminalStatus !== undefined)
      return Promise.resolve([]);
    this.request = {
      ...withoutClaim(this.request),
      providerTerminalStatus: status,
      resolvedAt,
      updatedAt: resolvedAt,
      version: this.request.version + 1,
    };
    return Promise.resolve([this.request]);
  }

  listCancellationAttempts(): Promise<readonly RemoteTaskCancellationAttempt[]> {
    return Promise.resolve(this.attempts);
  }
}

function binding(overrides: Partial<RemoteTaskBinding> = {}): RemoteTaskBinding {
  return {
    ...createRemoteTaskBinding({
      bindingId: 'binding-1',
      serverId: 'server-1',
      operationName: 'long_operation',
      remoteTaskId: 'provider-task-1',
      agentTaskId: 'task-1',
      contextId: 'context-1',
      goalId: 'goal-1',
      goalVersion: 1,
      workflowPlanId: 'plan-1',
      workflowDefinitionId: 'workflow-1',
      workflowDefinitionVersion: 1,
      workflowInstanceId: 'instance-1',
      workflowNodeId: 'remote-node',
      workflowNodeRunId: 'instance-1~remote-node~1',
      mcpInvocationId: 'invocation-1',
      protocolStatus: 'working',
      protocolRevision: 'tasks-protocol-1',
      tasksSchemaRevision: 'tasks-schema-1',
      protocolContract: {
        mode: 'frozen_v1',
        protocolVersion: 'tasks-protocol-1',
        baselineSha256: 'a'.repeat(64),
      },
      taskBehavior: 'server_directed',
      runtimeRevision: '1',
      executionContext: { mode: 'live' },
      credentialRevision: 'credential-1',
      sessionRevision: 'session-1',
      lastProviderUpdatedAt: timestamp,
      pollIntervalMs: 100,
      createdAt: timestamp,
    }),
    ...overrides,
  };
}

function withoutClaim(request: RemoteTaskCancellationRequest): RemoteTaskCancellationRequest {
  const copy = { ...request };
  delete copy.claimToken;
  delete copy.claimedAt;
  delete copy.claimExpiresAt;
  return copy;
}

function requiredRequest(
  request: RemoteTaskCancellationRequest | undefined,
): RemoteTaskCancellationRequest {
  if (request === undefined) throw new Error('TEST_CANCELLATION_REQUEST_MISSING');
  return request;
}

function firstJob(queue: RecordingCancellationQueue): RemoteTaskCancellationJob {
  const job = queue.enqueued[0];
  if (job === undefined) throw new Error('TEST_CANCELLATION_JOB_MISSING');
  return job;
}
