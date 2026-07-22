import { describe, expect, it, vi } from 'vitest';

import {
  createRemoteTaskBinding,
  type RemoteTaskBinding,
  type RemoteTaskControlEvent,
  type RemoteTaskObservation,
  type RemoteTaskProtocolAttempt,
  type RemoteTaskSnapshot,
} from '../../domain/src/index.js';
import {
  RemoteTaskAdmissionService,
  RemoteTaskPollingService,
  RemoteTaskReconciler,
} from '../src/index.js';
import type {
  RemoteTaskMutationResult,
  RemoteTaskPollJob,
  RemoteTaskPollJobState,
  RemoteTaskPollQueue,
  RemoteTaskRepository,
  RemoteTaskSnapshotReader,
} from '../src/ports.js';

const timestamp = '2026-07-16T08:00:00.000Z';
const laterTimestamp = '2026-07-16T08:00:01.000Z';

describe('RemoteTaskAdmissionService', () => {
  it('persists a binding before scheduling its versioned poll job and converges duplicates', async () => {
    const repository = new InMemoryRemoteTaskRepository();
    const queue = new RecordingPollQueue();
    let observation = 0;
    const service = new RemoteTaskAdmissionService({
      repository,
      queue,
      nextObservationId: () => `observation-${String(++observation)}`,
    });

    const first = await service.admit(admission());
    const duplicate = await service.admit(admission({ bindingId: 'ignored-duplicate-id' }));

    expect(first.created).toBe(true);
    expect(first.pollScheduled).toBe(true);
    expect(duplicate).toEqual({ binding: first.binding, created: false, pollScheduled: true });
    expect(repository.observations).toHaveLength(1);
    expect(queue.enqueued).toEqual([
      { job: { bindingId: 'binding-1', expectedVersion: 1 }, runAt: timestamp },
      { job: { bindingId: 'binding-1', expectedVersion: 1 }, runAt: timestamp },
    ]);
  });

  it('keeps an admitted binding authoritative when initial Redis scheduling fails', async () => {
    const repository = new InMemoryRemoteTaskRepository();
    const queue = new RecordingPollQueue();
    queue.enqueueFailure = new Error('queue backend unavailable');
    const service = new RemoteTaskAdmissionService({
      repository,
      queue,
      nextObservationId: () => 'observation-1',
    });

    await expect(service.admit(admission())).resolves.toMatchObject({
      created: true,
      pollScheduled: false,
      binding: { bindingId: 'binding-1', localState: 'polling' },
    });
    expect(repository.binding.bindingId).toBe('binding-1');
  });
});

describe('RemoteTaskPollingService', () => {
  it.each([
    ['working', 'polling'],
    ['input_required', 'polling'],
    ['completed', 'polling'],
    ['failed', 'polling'],
    ['cancelled', 'polling'],
  ] as const)(
    'requires an authoritative initial poll for Provider status %s',
    (protocolStatus, localState) => {
      expect(createRemoteTaskBinding(admission({ protocolStatus }))).toMatchObject({
        protocolStatus,
        localState,
        nextPollAt: timestamp,
      });
    },
  );

  it('rejects a stale job before any Provider request', async () => {
    const harness = pollingHarness();
    harness.repository.binding = { ...harness.repository.binding, version: 2 };

    await expect(
      harness.service.process({ bindingId: 'binding-1', expectedVersion: 1 }),
    ).resolves.toBe('stale');
    expect(harness.reader.readRemoteTask).not.toHaveBeenCalled();
  });

  it('claims once, preserves replay context, records working and schedules the next version', async () => {
    const harness = pollingHarness({
      executionContext: { mode: 'historical-replay', simulationId: 'replay-1' },
    });
    harness.readerResult = { kind: 'snapshot', snapshot: workingSnapshot() };

    await expect(harness.service.process(job())).resolves.toBe('working');

    expect(harness.reader.readRemoteTask).toHaveBeenCalledWith({
      serverId: 'server-1',
      remoteTaskId: 'remote-1',
      operationName: 'long-tool',
      executionContext: { mode: 'historical-replay', simulationId: 'replay-1' },
    });
    expect(harness.repository.binding.version).toBe(3);
    expect(harness.repository.binding.pollAttempt).toBe(1);
    expect(harness.repository.binding.protocolStatus).toBe('working');
    expect(harness.queue.enqueued.at(-1)).toEqual({
      job: { bindingId: 'binding-1', expectedVersion: 3 },
      runAt: '2026-07-16T08:00:01.200Z',
    });
  });

  it('creates one input control and stops ordinary polling', async () => {
    const harness = pollingHarness();
    harness.readerResult = { kind: 'snapshot', snapshot: inputRequiredSnapshot() };

    await expect(harness.service.process(job())).resolves.toBe('control_pending');

    expect(harness.repository.binding.localState).toBe('awaiting_input');
    expect(harness.repository.binding.nextPollAt).toBeUndefined();
    expect(harness.repository.controls).toHaveLength(1);
    expect(harness.repository.controls[0]?.type).toBe('task.input_required');
    expect(harness.queue.enqueued).toHaveLength(0);
  });

  it('keeps observing input_required after local cancellation without reviving the Workflow', async () => {
    const harness = pollingHarness({
      localState: 'cancel_observing',
      invalidatedAt: timestamp,
    });
    harness.readerResult = { kind: 'snapshot', snapshot: inputRequiredSnapshot() };

    await expect(harness.service.process(job())).resolves.toBe('cancel_observing');

    expect(harness.repository.binding.localState).toBe('cancel_observing');
    expect(harness.repository.binding.invalidatedAt).toBe(timestamp);
    expect(harness.repository.binding.nextPollAt).toBe('2026-07-16T08:00:01.200Z');
    expect(harness.queue.enqueued).toEqual([
      {
        job: { bindingId: 'binding-1', expectedVersion: 3 },
        runAt: '2026-07-16T08:00:01.200Z',
      },
    ]);
  });

  it('backs off an unreachable Provider without changing remote status and then recovers', async () => {
    const harness = pollingHarness();
    harness.readerResult = {
      kind: 'provider_unreachable',
      errorCode: 'MCP_TASK_PROVIDER_UNREACHABLE',
    };

    await expect(harness.service.process(job())).resolves.toBe('provider_unreachable');
    expect(harness.repository.binding.protocolStatus).toBe('working');
    expect(harness.repository.binding.providerFailureCount).toBe(1);
    expect(harness.repository.binding.nextPollAt).toBe('2026-07-16T08:00:02.000Z');
    expect(harness.repository.controls).toHaveLength(0);

    harness.now = '2026-07-16T08:00:02.000Z';
    harness.readerResult = { kind: 'snapshot', snapshot: workingSnapshot() };
    await expect(
      harness.service.process({ bindingId: 'binding-1', expectedVersion: 3 }),
    ).resolves.toBe('working');
    expect(harness.repository.binding.providerFailureCount).toBe(0);
  });

  it('quarantines invalid contracts without a retry or fabricated terminal state', async () => {
    const harness = pollingHarness();
    harness.readerResult = { kind: 'contract_invalid', errorCode: 'MCP_TASK_RESPONSE_INVALID' };

    await expect(harness.service.process(job())).resolves.toBe('quarantined');
    expect(harness.repository.binding.localState).toBe('quarantined');
    expect(harness.repository.binding.protocolStatus).toBe('working');
    expect(harness.repository.binding.terminalAt).toBeUndefined();
    expect(harness.queue.enqueued).toHaveLength(0);
  });

  it('audits an older Provider snapshot without rolling state backward or creating control', async () => {
    const harness = pollingHarness({ lastProviderUpdatedAt: laterTimestamp });
    harness.readerResult = { kind: 'snapshot', snapshot: completedSnapshot(timestamp) };

    await expect(harness.service.process(job())).resolves.toBe('stale_provider_snapshot');
    expect(harness.repository.binding.protocolStatus).toBe('working');
    expect(harness.repository.controls).toHaveLength(0);
    expect(harness.repository.observations.at(-1)).toMatchObject({
      accepted: false,
      rejectionReason: 'stale_provider_revision',
    });
  });
});

describe('RemoteTaskReconciler', () => {
  it('repairs missing/completed jobs and leaves current failed jobs as dead letters', async () => {
    const repository = new InMemoryRemoteTaskRepository();
    const queue = new RecordingPollQueue();
    const bindings = [
      createRemoteTaskBinding(admission({ bindingId: 'missing' })),
      createRemoteTaskBinding(admission({ bindingId: 'completed', remoteTaskId: 'remote-2' })),
      createRemoteTaskBinding(admission({ bindingId: 'failed', remoteTaskId: 'remote-3' })),
      createRemoteTaskBinding(admission({ bindingId: 'scheduled', remoteTaskId: 'remote-4' })),
    ];
    repository.pollable = bindings;
    queue.states.set('completed~1', 'completed');
    queue.states.set('failed~1', 'failed');
    queue.states.set('scheduled~1', 'scheduled');
    const reconciler = new RemoteTaskReconciler({
      repository,
      queue,
      clock: { now: () => timestamp },
    });

    await expect(reconciler.reconcile()).resolves.toEqual({
      examined: 4,
      scheduled: 2,
      alreadyScheduled: 1,
      active: 0,
      deadLetters: 1,
    });
    expect(queue.enqueued.map(({ job: queued }) => queued.bindingId)).toEqual([
      'missing',
      'completed',
    ]);
  });
});

function pollingHarness(overrides: Partial<RemoteTaskBinding> = {}) {
  const repository = new InMemoryRemoteTaskRepository();
  repository.binding = { ...repository.binding, ...overrides };
  const queue = new RecordingPollQueue();
  const harness: {
    now: string;
    readerResult: Awaited<ReturnType<RemoteTaskSnapshotReader['readRemoteTask']>>;
    readonly reader: {
      readRemoteTask: ReturnType<typeof vi.fn<RemoteTaskSnapshotReader['readRemoteTask']>>;
    };
    readonly repository: InMemoryRemoteTaskRepository;
    readonly queue: RecordingPollQueue;
    service: RemoteTaskPollingService;
  } = {
    now: laterTimestamp,
    readerResult: { kind: 'snapshot', snapshot: workingSnapshot() },
    reader: { readRemoteTask: vi.fn<RemoteTaskSnapshotReader['readRemoteTask']>() },
    repository,
    queue,
    service: undefined as never,
  };
  harness.reader.readRemoteTask.mockImplementation(() => Promise.resolve(harness.readerResult));
  let id = 0;
  harness.service = new RemoteTaskPollingService({
    repository,
    queue,
    reader: harness.reader,
    serial: { run: (_contextId, operation) => operation() },
    clock: { now: () => harness.now },
    ids: {
      nextObservationId: () => `observation-${String(++id)}`,
      nextControlEventId: () => `control-${String(++id)}`,
      nextClaimToken: () => `claim-${String(++id)}`,
      nextProtocolAttemptId: () => `attempt-${String(++id)}`,
    },
    hash: () => 'a'.repeat(64),
    options: {
      minimumPollIntervalMs: 100,
      maximumPollIntervalMs: 10_000,
      providerFailureBackoffBaseMs: 1_000,
      providerFailureBackoffMaximumMs: 8_000,
      claimLeaseMs: 5_000,
    },
  });
  return harness;
}

class RecordingPollQueue implements RemoteTaskPollQueue {
  readonly enqueued: { job: RemoteTaskPollJob; runAt: string }[] = [];
  readonly states = new Map<string, RemoteTaskPollJobState>();
  enqueueFailure: Error | undefined;

  enqueue(job: RemoteTaskPollJob, runAt: string): Promise<void> {
    if (this.enqueueFailure !== undefined) return Promise.reject(this.enqueueFailure);
    this.enqueued.push({ job, runAt });
    return Promise.resolve();
  }

  state(bindingId: string, expectedVersion: number): Promise<RemoteTaskPollJobState> {
    return Promise.resolve(this.states.get(`${bindingId}~${String(expectedVersion)}`) ?? 'missing');
  }

  listDeadLetters() {
    return Promise.resolve([]);
  }

  retryDeadLetter() {
    return Promise.resolve();
  }
}

class InMemoryRemoteTaskRepository implements RemoteTaskRepository {
  binding = createRemoteTaskBinding(admission());
  readonly observations: RemoteTaskObservation[] = [];
  readonly controls: RemoteTaskControlEvent[] = [];
  readonly attempts: RemoteTaskProtocolAttempt[] = [];
  pollable: readonly RemoteTaskBinding[] | undefined;

  admit(binding: RemoteTaskBinding, acceptedObservationId: string) {
    if (this.observations.length > 0)
      return Promise.resolve({ binding: this.binding, created: false });
    this.binding = binding;
    this.observations.push({
      observationId: acceptedObservationId,
      bindingId: binding.bindingId,
      sequence: 1,
      type: 'task.accepted',
      source: 'admission',
      payload: {},
      accepted: true,
      observedAt: binding.createdAt,
    });
    return Promise.resolve({ binding, created: true });
  }

  findById(bindingId: string) {
    return Promise.resolve(bindingId === this.binding.bindingId ? this.binding : undefined);
  }

  findByRemoteIdentity(serverId: string, remoteTaskId: string) {
    return Promise.resolve(
      serverId === this.binding.serverId && remoteTaskId === this.binding.remoteTaskId
        ? this.binding
        : undefined,
    );
  }

  listRequiringPoll() {
    return Promise.resolve(this.pollable ?? [this.binding]);
  }

  listActiveByServer(serverId: string) {
    return Promise.resolve(serverId === this.binding.serverId ? [this.binding] : []);
  }

  claimPoll(input: Parameters<RemoteTaskRepository['claimPoll']>[0]) {
    if (input.expectedVersion !== this.binding.version) {
      return Promise.resolve({ claimed: false as const, reason: 'stale' as const });
    }
    this.binding = {
      ...this.binding,
      version: this.binding.version + 1,
      pollAttempt: this.binding.pollAttempt + 1,
      pollClaimToken: input.claimToken,
      pollClaimedAt: input.claimedAt,
      pollClaimExpiresAt: input.expiresAt,
    };
    return Promise.resolve({ claimed: true as const, binding: this.binding });
  }

  recordSnapshot(input: Parameters<RemoteTaskRepository['recordSnapshot']>[0]) {
    this.attempts.push(input.protocolAttempt);
    if (!this.matches(input.expectedVersion, input.claimToken)) return Promise.resolve(stale());
    const accepted =
      Date.parse(input.snapshot.lastUpdatedAt) >= Date.parse(this.binding.lastProviderUpdatedAt);
    this.observations.push({
      observationId: input.observationId,
      bindingId: this.binding.bindingId,
      sequence: this.observations.length + 1,
      type: 'task.snapshot',
      source: 'poll',
      payload: input.snapshot,
      accepted,
      ...(accepted ? {} : { rejectionReason: 'stale_provider_revision' as const }),
      observedAt: input.observedAt,
    });
    if (!accepted) {
      this.binding = clearClaim({
        ...this.binding,
        version: this.binding.version + 1,
        nextPollAt: new Date(
          Date.parse(input.observedAt) + this.binding.pollIntervalMs,
        ).toISOString(),
      });
      return Promise.resolve({
        applied: true as const,
        binding: this.binding,
        snapshotAccepted: false,
      });
    }
    const working = input.snapshot.status === 'working';
    const cancellationObservationContinues =
      this.binding.localState === 'cancel_observing' &&
      input.snapshot.status !== 'completed' &&
      input.snapshot.status !== 'failed' &&
      input.snapshot.status !== 'cancelled';
    const localState = cancellationObservationContinues
      ? ('cancel_observing' as const)
      : working
        ? ('polling' as const)
        : input.snapshot.status === 'input_required'
          ? ('awaiting_input' as const)
          : ('terminal_event_pending' as const);
    const updatedBinding: RemoteTaskBinding = {
      ...this.binding,
      protocolStatus: input.snapshot.status,
      localState,
      lastProviderUpdatedAt: input.snapshot.lastUpdatedAt,
      providerFailureCount: 0,
      ...(input.nextPollAt === undefined ? {} : { nextPollAt: input.nextPollAt }),
      ...(input.snapshot.status === 'completed' ||
      input.snapshot.status === 'failed' ||
      input.snapshot.status === 'cancelled'
        ? { terminalAt: input.observedAt }
        : {}),
      version: this.binding.version + 1,
    };
    this.binding = clearClaim(
      input.nextPollAt === undefined ? withoutNextPoll(updatedBinding) : updatedBinding,
    );
    let controlEvent: RemoteTaskControlEvent | undefined;
    if (!working) {
      controlEvent = {
        eventId: input.controlEventId ?? 'missing-control',
        bindingId: this.binding.bindingId,
        type:
          input.snapshot.status === 'input_required'
            ? 'task.input_required'
            : input.snapshot.status === 'completed'
              ? 'task.completed'
              : input.snapshot.status === 'failed'
                ? 'task.failed'
                : 'task.cancelled',
        remoteRevision:
          input.snapshot.providerObservation?.remoteRevision ?? input.snapshot.lastUpdatedAt,
        resultHash: input.resultHash ?? '0'.repeat(64),
        payload: input.snapshot,
        status: 'pending',
        createdAt: input.observedAt,
      };
      this.controls.push(controlEvent);
    }
    return Promise.resolve({
      applied: true as const,
      binding: this.binding,
      snapshotAccepted: true,
      ...(controlEvent === undefined ? {} : { controlEvent }),
    });
  }

  recordProviderFailure(input: Parameters<RemoteTaskRepository['recordProviderFailure']>[0]) {
    this.attempts.push(input.protocolAttempt);
    if (!this.matches(input.expectedVersion, input.claimToken)) return Promise.resolve(stale());
    this.observations.push({
      observationId: input.observationId,
      bindingId: this.binding.bindingId,
      sequence: this.observations.length + 1,
      type: 'provider_unreachable',
      source: 'poll',
      payload: { errorCode: input.errorCode },
      accepted: true,
      observedAt: input.observedAt,
    });
    this.binding = clearClaim({
      ...this.binding,
      providerFailureCount: this.binding.providerFailureCount + 1,
      nextPollAt: input.nextPollAt,
      version: this.binding.version + 1,
    });
    return Promise.resolve({ applied: true as const, binding: this.binding });
  }

  recordExternalSnapshot() {
    return Promise.resolve({ applied: false as const, reason: 'missing' as const });
  }

  quarantine(input: Parameters<RemoteTaskRepository['quarantine']>[0]) {
    this.attempts.push(input.protocolAttempt);
    if (!this.matches(input.expectedVersion, input.claimToken)) return Promise.resolve(stale());
    this.binding = clearClaim(
      withoutNextPoll({
        ...this.binding,
        localState: 'quarantined',
        version: this.binding.version + 1,
      }),
    );
    return Promise.resolve({ applied: true as const, binding: this.binding });
  }

  listObservations() {
    return Promise.resolve(this.observations);
  }

  listControlEvents() {
    return Promise.resolve(this.controls);
  }

  listProtocolAttempts() {
    return Promise.resolve(this.attempts);
  }

  private matches(expectedVersion: number, claimToken: string) {
    return this.binding.version === expectedVersion && this.binding.pollClaimToken === claimToken;
  }
}

function admission(overrides: Partial<Parameters<typeof createRemoteTaskBinding>[0]> = {}) {
  return {
    bindingId: 'binding-1',
    serverId: 'server-1',
    operationName: 'long-tool',
    remoteTaskId: 'remote-1',
    agentTaskId: 'task-1',
    contextId: 'context-1',
    goalId: 'goal-1',
    goalVersion: 1,
    workflowPlanId: 'plan-1',
    workflowDefinitionId: 'workflow-1',
    workflowDefinitionVersion: 1,
    workflowInstanceId: 'instance-1',
    workflowNodeId: 'node-1',
    workflowNodeRunId: 'instance-1~node-1~1',
    mcpInvocationId: 'invocation-1',
    protocolStatus: 'working' as const,
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'schema-1',
    protocolContract: {
      mode: 'frozen_v1' as const,
      protocolVersion: '2026-07-28',
      baselineSha256: 'a'.repeat(64),
    },
    taskBehavior: 'server_directed' as const,
    runtimeRevision: '1',
    lastProviderUpdatedAt: timestamp,
    executionContext: { mode: 'live' as const },
    credentialRevision: 'credential-sha256-1',
    sessionRevision: '2026-07-28/schema-1',
    pollIntervalMs: 200,
    createdAt: timestamp,
    ...overrides,
  };
}

function workingSnapshot(): RemoteTaskSnapshot {
  return {
    remoteTaskId: 'remote-1',
    status: 'working',
    createdAt: timestamp,
    lastUpdatedAt: laterTimestamp,
    ttlMs: null,
    pollIntervalMs: 200,
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'schema-1',
  };
}

function inputRequiredSnapshot(): RemoteTaskSnapshot {
  return {
    ...workingSnapshot(),
    status: 'input_required',
    inputRequests: { approval: { type: 'boolean' } },
    providerObservation: { revision: '1.0', remoteRevision: '2' },
  };
}

function completedSnapshot(lastUpdatedAt = laterTimestamp): RemoteTaskSnapshot {
  return {
    ...workingSnapshot(),
    status: 'completed',
    lastUpdatedAt,
    result: { content: [{ type: 'text', text: 'done' }], isError: false },
  };
}

function job(): RemoteTaskPollJob {
  return { bindingId: 'binding-1', expectedVersion: 1 };
}

function stale(): RemoteTaskMutationResult {
  return { applied: false, reason: 'stale' };
}

function clearClaim(binding: RemoteTaskBinding): RemoteTaskBinding {
  const cleared = { ...binding };
  delete cleared.pollClaimToken;
  delete cleared.pollClaimedAt;
  delete cleared.pollClaimExpiresAt;
  return cleared;
}

function withoutNextPoll(binding: RemoteTaskBinding): RemoteTaskBinding {
  const cleared = { ...binding };
  delete cleared.nextPollAt;
  return cleared;
}
