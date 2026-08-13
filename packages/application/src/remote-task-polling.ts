import {
  createRemoteTaskBinding,
  isRemoteTaskObservationActive,
  type RemoteTaskAdmission,
  type RemoteTaskBinding,
  type RemoteTaskProtocolAttempt,
} from '../../domain/src/index.js';

import type {
  Clock,
  ContextSerialGate,
  RemoteTaskPollQueue,
  RemoteTaskPollJob,
  RemoteTaskRepository,
  RemoteTaskSnapshotReader,
} from './ports.js';

export interface RemoteTaskPollingIds {
  nextObservationId(): string;
  nextControlEventId(): string;
  nextClaimToken(): string;
  nextProtocolAttemptId(): string;
}

export interface RemoteTaskPollingOptions {
  readonly minimumPollIntervalMs?: number;
  readonly maximumPollIntervalMs?: number;
  readonly providerFailureBackoffBaseMs?: number;
  readonly providerFailureBackoffMaximumMs?: number;
  readonly claimLeaseMs?: number;
}

export class RemoteTaskAdmissionService {
  readonly #repository: RemoteTaskRepository;
  readonly #queue: RemoteTaskPollQueue;
  readonly #nextObservationId: () => string;

  constructor(
    dependencies: Readonly<{
      repository: RemoteTaskRepository;
      queue: RemoteTaskPollQueue;
      nextObservationId(): string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#queue = dependencies.queue;
    this.#nextObservationId = dependencies.nextObservationId;
  }

  async admit(input: RemoteTaskAdmission): Promise<
    Readonly<{
      binding: RemoteTaskBinding;
      created: boolean;
      pollScheduled: boolean;
    }>
  > {
    const candidate = createRemoteTaskBinding(input);
    const admitted = await this.#repository.admit(candidate, this.#nextObservationId());
    let pollScheduled = false;
    if (
      admitted.binding.localState === 'polling' ||
      admitted.binding.localState === 'cancel_observing'
    ) {
      const job = pollJobFor(admitted.binding);
      try {
        await this.#queue.enqueue(job, admitted.binding.nextPollAt ?? admitted.binding.updatedAt);
        pollScheduled = true;
      } catch {
        // PostgreSQL admission remains authoritative. The reconciler repairs this explicit gap.
        pollScheduled = false;
      }
    }
    return { ...admitted, pollScheduled };
  }
}

export type RemoteTaskPollProcessResult =
  | 'missing'
  | 'stale'
  | 'closed'
  | 'working'
  | 'cancel_observing'
  | 'control_pending'
  | 'provider_unreachable'
  | 'stale_provider_snapshot'
  | 'expired'
  | 'quarantined';

export class RemoteTaskPollingService {
  readonly #repository: RemoteTaskRepository;
  readonly #queue: RemoteTaskPollQueue;
  readonly #reader: RemoteTaskSnapshotReader;
  readonly #serial: ContextSerialGate;
  readonly #clock: Clock;
  readonly #ids: RemoteTaskPollingIds;
  readonly #hash: (value: unknown) => string;
  readonly #minimumPollIntervalMs: number;
  readonly #maximumPollIntervalMs: number;
  readonly #providerFailureBackoffBaseMs: number;
  readonly #providerFailureBackoffMaximumMs: number;
  readonly #claimLeaseMs: number;

  constructor(
    dependencies: Readonly<{
      repository: RemoteTaskRepository;
      queue: RemoteTaskPollQueue;
      reader: RemoteTaskSnapshotReader;
      serial: ContextSerialGate;
      clock: Clock;
      ids: RemoteTaskPollingIds;
      hash(value: unknown): string;
      options?: RemoteTaskPollingOptions;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#queue = dependencies.queue;
    this.#reader = dependencies.reader;
    this.#serial = dependencies.serial;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#hash = dependencies.hash;
    this.#minimumPollIntervalMs = dependencies.options?.minimumPollIntervalMs ?? 100;
    this.#maximumPollIntervalMs = dependencies.options?.maximumPollIntervalMs ?? 60_000;
    this.#providerFailureBackoffBaseMs =
      dependencies.options?.providerFailureBackoffBaseMs ?? 1_000;
    this.#providerFailureBackoffMaximumMs =
      dependencies.options?.providerFailureBackoffMaximumMs ?? 60_000;
    this.#claimLeaseMs = dependencies.options?.claimLeaseMs ?? 30_000;
  }

  async process(job: RemoteTaskPollJob): Promise<RemoteTaskPollProcessResult> {
    const initial = await this.#repository.findById(job.bindingId);
    if (initial === undefined) return 'missing';
    return this.#serial.run(initial.contextId, async () => {
      const current = await this.#repository.findById(job.bindingId);
      if (current === undefined) return 'missing';
      if (current.version !== job.expectedVersion) return 'stale';
      if (!isRemoteTaskObservationActive(current)) return 'closed';
      const claimedAt = this.#clock.now();
      const claimToken = this.#ids.nextClaimToken();
      const claim = await this.#repository.claimPoll({
        bindingId: current.bindingId,
        expectedVersion: current.version,
        claimToken,
        claimedAt,
        expiresAt: addMilliseconds(claimedAt, this.#claimLeaseMs),
      });
      if (!claim.claimed) {
        if (claim.reason === 'missing') return 'missing';
        if (claim.reason === 'closed') return 'closed';
        return 'stale';
      }
      const binding = claim.binding;

      if (
        binding.taskExpiresAt !== undefined &&
        Date.parse(claimedAt) >= Date.parse(binding.taskExpiresAt)
      )
        return this.#closeUncertain(
          binding,
          claimToken,
          'MCP_REMOTE_TASK_TTL_EXPIRED',
          'The remote MCP Task exceeded its persisted TTL before a terminal observation.',
          claimedAt,
          'expired',
        );

      const protocolStartedAt = this.#clock.now();
      const read = await this.#reader.readRemoteTask({
        serverId: binding.serverId,
        operationName: binding.operationName,
        remoteTaskId: binding.remoteTaskId,
        executionContext: binding.executionContext,
      });
      const observedAt = this.#clock.now();
      if (read.kind === 'provider_unreachable') {
        const nextPollAt = addMilliseconds(
          observedAt,
          providerBackoff(
            binding.providerFailureCount + 1,
            this.#providerFailureBackoffBaseMs,
            this.#providerFailureBackoffMaximumMs,
          ),
        );
        const mutation = await this.#repository.recordProviderFailure({
          bindingId: binding.bindingId,
          expectedVersion: binding.version,
          claimToken,
          observationId: this.#ids.nextObservationId(),
          errorCode: read.errorCode,
          observedAt,
          nextPollAt,
          protocolAttempt: protocolAttempt({
            attemptId: this.#ids.nextProtocolAttemptId(),
            binding,
            status: 'provider_unreachable',
            errorCode: read.errorCode,
            startedAt: protocolStartedAt,
            completedAt: observedAt,
          }),
        });
        if (!mutation.applied) return mutation.reason;
        const nextJob = pollJobFor(mutation.binding);
        await this.#queue.enqueue(
          nextJob,
          mutation.binding.nextPollAt ?? mutation.binding.updatedAt,
        );
        return 'provider_unreachable';
      }
      if (read.kind === 'contract_invalid' || read.kind === 'provider_protocol') {
        return this.#closeUncertain(
          binding,
          claimToken,
          read.errorCode,
          'The remote MCP Task could not be observed under its frozen protocol contract.',
          observedAt,
          'quarantined',
          protocolStartedAt,
        );
      }

      const snapshot = read.snapshot;
      if (
        snapshot.protocolRevision !== binding.protocolRevision ||
        snapshot.tasksSchemaRevision !== binding.tasksSchemaRevision ||
        (binding.runtimeRevision !== undefined && snapshot.runtimeRevision === undefined)
      ) {
        return this.#closeUncertain(
          binding,
          claimToken,
          'MCP_TASK_SESSION_REVISION_CHANGED',
          'The remote MCP Task session authority changed while the Task was in flight.',
          observedAt,
          'quarantined',
          protocolStartedAt,
        );
      }
      const keepObserving =
        snapshot.status === 'working' ||
        (binding.localState === 'cancel_observing' &&
          snapshot.status !== 'completed' &&
          snapshot.status !== 'failed' &&
          snapshot.status !== 'cancelled');
      const nextPollAt = keepObserving
        ? addMilliseconds(
            observedAt,
            boundedPollInterval(
              snapshot.pollIntervalMs ?? binding.pollIntervalMs,
              this.#minimumPollIntervalMs,
              this.#maximumPollIntervalMs,
            ),
          )
        : undefined;
      const resultHash = this.#hash(snapshot);
      const mutation = await this.#repository.recordSnapshot({
        bindingId: binding.bindingId,
        expectedVersion: binding.version,
        claimToken,
        snapshot,
        observationId: this.#ids.nextObservationId(),
        ...(snapshot.status === 'working'
          ? {}
          : { controlEventId: this.#ids.nextControlEventId(), resultHash }),
        observedAt,
        ...(nextPollAt === undefined ? {} : { nextPollAt }),
        protocolAttempt: protocolAttempt({
          attemptId: this.#ids.nextProtocolAttemptId(),
          binding,
          status: 'succeeded',
          startedAt: protocolStartedAt,
          completedAt: observedAt,
        }),
      });
      if (!mutation.applied) return mutation.reason;
      if (mutation.snapshotAccepted === false) {
        const retryJob = pollJobFor(mutation.binding);
        await this.#queue.enqueue(
          retryJob,
          mutation.binding.nextPollAt ?? mutation.binding.updatedAt,
        );
        return 'stale_provider_snapshot';
      }
      if (
        mutation.binding.localState !== 'polling' &&
        mutation.binding.localState !== 'cancel_observing'
      )
        return 'control_pending';
      const nextJob = pollJobFor(mutation.binding);
      await this.#queue.enqueue(nextJob, mutation.binding.nextPollAt ?? mutation.binding.updatedAt);
      return mutation.binding.localState === 'cancel_observing' ? 'cancel_observing' : 'working';
    });
  }

  async #closeUncertain(
    binding: RemoteTaskBinding,
    claimToken: string,
    errorCode: string,
    summary: string,
    observedAt: string,
    disposition: 'expired' | 'quarantined',
    startedAt = observedAt,
  ): Promise<RemoteTaskPollProcessResult> {
    const mutation = await this.#repository.closeUncertain({
      bindingId: binding.bindingId,
      expectedVersion: binding.version,
      claimToken,
      observationId: this.#ids.nextObservationId(),
      controlEventId: this.#ids.nextControlEventId(),
      errorCode,
      summary,
      observedAt,
      resultHash: this.#hash({ bindingId: binding.bindingId, errorCode, observedAt }),
      protocolAttempt: protocolAttempt({
        attemptId: this.#ids.nextProtocolAttemptId(),
        binding,
        status: 'provider_protocol',
        errorCode,
        startedAt,
        completedAt: observedAt,
      }),
    });
    return mutation.applied ? disposition : mutation.reason;
  }
}

export interface RemoteTaskReconciliationResult {
  readonly examined: number;
  readonly scheduled: number;
  readonly alreadyScheduled: number;
  readonly active: number;
  readonly deadLetters: number;
}

export class RemoteTaskReconciler {
  readonly #repository: RemoteTaskRepository;
  readonly #queue: RemoteTaskPollQueue;
  readonly #clock: Clock;

  constructor(
    dependencies: Readonly<{
      repository: RemoteTaskRepository;
      queue: RemoteTaskPollQueue;
      clock: Clock;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#queue = dependencies.queue;
    this.#clock = dependencies.clock;
  }

  async reconcile(limit = 100): Promise<RemoteTaskReconciliationResult> {
    const now = this.#clock.now();
    const bindings = await this.#repository.listRequiringPoll(now, limit);
    let scheduled = 0;
    let alreadyScheduled = 0;
    let active = 0;
    let deadLetters = 0;
    for (const binding of bindings) {
      const state = await this.#queue.state(binding.bindingId, binding.version);
      if (state === 'failed') {
        deadLetters += 1;
      }
      if (state === 'scheduled') {
        alreadyScheduled += 1;
        continue;
      }
      if (state === 'active') {
        active += 1;
        continue;
      }
      await this.#queue.enqueue(pollJobFor(binding), binding.nextPollAt ?? binding.updatedAt);
      scheduled += 1;
    }
    return { examined: bindings.length, scheduled, alreadyScheduled, active, deadLetters };
  }
}

function pollJobFor(binding: RemoteTaskBinding): RemoteTaskPollJob {
  return {
    bindingId: binding.bindingId,
    expectedVersion: binding.version,
  };
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) throw new Error('REMOTE_TASK_CLOCK_INVALID');
  return new Date(value + milliseconds).toISOString();
}

function boundedPollInterval(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function providerBackoff(attempt: number, base: number, maximum: number): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 20);
  return Math.min(maximum, base * 2 ** exponent);
}

function protocolAttempt(
  input: Readonly<{
    attemptId: string;
    binding: RemoteTaskBinding;
    status: RemoteTaskProtocolAttempt['status'];
    errorCode?: string;
    startedAt: string;
    completedAt: string;
  }>,
): RemoteTaskProtocolAttempt {
  const durationMs = Date.parse(input.completedAt) - Date.parse(input.startedAt);
  return {
    attemptId: input.attemptId,
    bindingId: input.binding.bindingId,
    method: 'tasks/get',
    expectedBindingVersion: input.binding.version,
    protocolRevision: input.binding.protocolRevision,
    status: input.status,
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0,
  };
}
