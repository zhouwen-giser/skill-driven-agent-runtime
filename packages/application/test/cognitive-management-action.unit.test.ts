import { describe, expect, it, vi } from 'vitest';

import {
  CognitiveManagementActionGate,
  type CognitiveManagementActionClaim,
  type CognitiveManagementActionClaimResult,
  type CognitiveManagementActionLease,
  type CognitiveManagementActionRepository,
} from '../src/index.js';

describe('CognitiveManagementActionGate', () => {
  it('returns the durable completed result for an idempotent retry without repeating the write', async () => {
    const repository = new InMemoryManagementActions();
    const gate = new CognitiveManagementActionGate({
      repository,
      clock: { now: () => '2026-07-26T10:00:00.000Z' },
    });
    const action = vi.fn().mockResolvedValue({ revision: 2 });
    const request = {
      operation: 'knowledge_promote' as const,
      subjectId: 'planning_heuristic:heuristic-1',
      expectedVersion: 1,
      idempotencyKey: 'review-1',
      actorId: 'operator-1',
      reason: 'Reviewed evidence passed.',
    };

    await expect(gate.execute(request, action)).resolves.toEqual({ revision: 2 });
    await expect(gate.execute(request, action)).resolves.toEqual({ revision: 2 });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('fails closed when one idempotency key is reused with a different request', async () => {
    const repository = new InMemoryManagementActions();
    const gate = new CognitiveManagementActionGate({
      repository,
      clock: { now: () => '2026-07-26T10:00:00.000Z' },
    });
    const request = {
      operation: 'capability_rebuild' as const,
      subjectId: 'runtime-capability-summary',
      expectedVersion: 1,
      idempotencyKey: 'rebuild-1',
      actorId: 'operator-1',
      reason: 'Reviewed catalog.',
    };
    await gate.execute(request, () => Promise.resolve({ revision: 2 }));
    await expect(
      gate.execute({ ...request, reason: 'Different request.' }, () =>
        Promise.resolve({ revision: 3 }),
      ),
    ).rejects.toMatchObject({ code: 'COGNITIVE_MANAGEMENT_IDEMPOTENCY_CONFLICT' });
  });

  it('includes the deterministic Capability request fingerprint in replay identity', async () => {
    const repository = new InMemoryManagementActions();
    const gate = new CognitiveManagementActionGate({
      repository,
      clock: { now: () => '2026-08-11T00:00:00.000Z' },
    });
    const request = {
      operation: 'deterministic_capability_execution' as const,
      subjectId: 'deterministic-capability-execution',
      expectedVersion: 1,
      idempotencyKey: 'task-home-lab-read-1',
      actorId: 'sdar-deterministic-capability-execution',
      reason: 'Execute the exact admitted deterministic Capability contract.',
      requestFingerprint: `sha256:${'a'.repeat(64)}`,
    };
    const action = vi.fn().mockResolvedValue({ status: 'succeeded' });

    await expect(gate.execute(request, action)).resolves.toEqual({ status: 'succeeded' });
    await expect(gate.execute(request, action)).resolves.toEqual({ status: 'succeeded' });
    expect(action).toHaveBeenCalledTimes(1);

    await expect(
      gate.execute({ ...request, requestFingerprint: `sha256:${'b'.repeat(64)}` }, action),
    ).rejects.toMatchObject({ code: 'COGNITIVE_MANAGEMENT_IDEMPOTENCY_CONFLICT' });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('keeps an active lease in progress and never starts a concurrent action', async () => {
    const repository = new InMemoryManagementActions();
    const gate = new CognitiveManagementActionGate({
      repository,
      clock: { now: () => '2026-08-11T00:00:00.000Z' },
    });
    const pending = deferred<{ status: 'succeeded' }>();
    const request = deterministicRequest();
    const first = gate.execute(request, () => pending.promise);
    await vi.waitFor(() => {
      expect(repository.pendingPhase()).toBe('execution_started');
    });

    const concurrent = vi.fn().mockResolvedValue({ status: 'duplicate' });
    await expect(gate.execute(request, concurrent)).rejects.toMatchObject({
      code: 'COGNITIVE_MANAGEMENT_ACTION_IN_PROGRESS',
    });
    expect(concurrent).not.toHaveBeenCalled();
    pending.resolve({ status: 'succeeded' });
    await expect(first).resolves.toEqual({ status: 'succeeded' });
  });

  it('never executes an action after an expired lease is recovered', async () => {
    const repository = new InMemoryManagementActions();
    const gate = new CognitiveManagementActionGate({
      repository,
      clock: { now: () => '2026-08-11T00:00:00.000Z' },
    });
    const pending = deferred<{ status: 'succeeded' }>();
    const request = deterministicRequest();
    const first = gate.execute(request, () => pending.promise);
    await vi.waitFor(() => {
      expect(repository.pendingPhase()).toBe('execution_started');
    });
    repository.expirePending();

    const replayAction = vi.fn().mockResolvedValue({ status: 'duplicate' });
    await expect(
      gate.execute(request, replayAction, () =>
        Promise.resolve({
          disposition: 'orphaned',
          errorCode: 'DETERMINISTIC_RECOVERY_INTERRUPTED_BEFORE_EXECUTION',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'DETERMINISTIC_RECOVERY_INTERRUPTED_BEFORE_EXECUTION',
    });
    expect(replayAction).not.toHaveBeenCalled();

    pending.resolve({ status: 'succeeded' });
    await expect(first).rejects.toMatchObject({
      code: 'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST',
    });
  });

  it('keeps a post-dispatch failure pending for durable reconciliation', async () => {
    const repository = new InMemoryManagementActions();
    const gate = new CognitiveManagementActionGate({
      repository,
      clock: { now: () => '2026-08-11T00:00:00.000Z' },
    });
    await expect(
      gate.execute(deterministicRequest(), async (lease) => {
        await lease.enterProviderDispatch({
          dispatchId: 'mcp-invocation-deterministic-1',
          dispatchHash: `sha256:${'a'.repeat(64)}`,
        });
        throw new Error('PROVIDER_CONNECTION_LOST');
      }),
    ).rejects.toMatchObject({
      code: 'COGNITIVE_MANAGEMENT_ACTION_RECONCILIATION_PENDING',
    });
    expect(repository.pendingPhase()).toBe('provider_dispatch');
    expect(repository.pendingStatus()).toBe('pending');
  });

  it('serializes heartbeat renewal with the provider-dispatch phase transition', async () => {
    const repository = new BlockingRenewManagementActions();
    const gate = new CognitiveManagementActionGate({
      repository,
      clock: { now: () => '2026-08-11T00:00:00.000Z' },
      leaseDurationMs: 1_000,
      leaseRenewIntervalMs: 5,
    });

    await expect(
      gate.execute(deterministicRequest(), async (lease) => {
        await repository.renewStarted.promise;
        const dispatch = lease.enterProviderDispatch({
          dispatchId: 'mcp-invocation-deterministic-race',
          dispatchHash: `sha256:${'b'.repeat(64)}`,
        });
        await Promise.resolve();
        expect(repository.operationOrder).not.toContain('provider-dispatch');
        repository.allowRenew.resolve(undefined);
        await dispatch;
        throw new Error('PROVIDER_CONNECTION_LOST');
      }),
    ).rejects.toMatchObject({
      code: 'COGNITIVE_MANAGEMENT_ACTION_RECONCILIATION_PENDING',
    });

    expect(repository.operationOrder.slice(0, 4)).toEqual([
      'execution-started',
      'renew-started',
      'renew-finished',
      'provider-dispatch',
    ]);
    expect(repository.pendingPhase()).toBe('provider_dispatch');
    expect(repository.failCalls).toBe(0);
  });

  it('aborts a stale owner without writing a terminal failure projection', async () => {
    const repository = new InMemoryManagementActions();
    const gate = new CognitiveManagementActionGate({
      repository,
      clock: { now: () => '2026-08-11T00:00:00.000Z' },
    });

    await expect(
      gate.execute(deterministicRequest(), async (lease) => {
        repository.expirePending();
        await lease.assertCurrent();
        return { status: 'must-not-complete' };
      }),
    ).rejects.toMatchObject({ code: 'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST' });

    expect(repository.pendingStatus()).toBe('pending');
    expect(repository.failCalls).toBe(0);
  });

  it('fences a second provider-dispatch transition by the same owner and keeps the action pending', async () => {
    const repository = new InMemoryManagementActions();
    const gate = new CognitiveManagementActionGate({
      repository,
      clock: { now: () => '2026-08-11T00:00:00.000Z' },
    });

    await expect(
      gate.execute(deterministicRequest(), async (lease) => {
        await lease.enterProviderDispatch({
          dispatchId: 'mcp-invocation-deterministic-once',
          dispatchHash: `sha256:${'c'.repeat(64)}`,
        });
        await lease.enterProviderDispatch({
          dispatchId: 'mcp-invocation-deterministic-twice',
          dispatchHash: `sha256:${'d'.repeat(64)}`,
        });
        return { status: 'must-not-complete' };
      }),
    ).rejects.toMatchObject({ code: 'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST' });

    expect(repository.pendingPhase()).toBe('provider_dispatch');
    expect(repository.failCalls).toBe(0);
  });

  it('refuses to persist private model reasoning in management audit results', async () => {
    const gate = new CognitiveManagementActionGate({
      repository: new InMemoryManagementActions(),
      clock: { now: () => '2026-07-26T10:00:00.000Z' },
    });
    await expect(
      gate.execute(
        {
          operation: 'knowledge_reject',
          subjectId: 'planning_heuristic:heuristic-1',
          expectedVersion: 1,
          idempotencyKey: 'reject-1',
          actorId: 'operator-1',
          reason: 'Reject invalid candidate.',
        },
        () => Promise.resolve({ chainOfThought: 'forbidden' }),
      ),
    ).rejects.toMatchObject({ code: 'COGNITIVE_MANAGEMENT_PRIVATE_REASONING_FORBIDDEN' });
  });
});

class InMemoryManagementActions implements CognitiveManagementActionRepository {
  failCalls = 0;
  readonly #items = new Map<
    string,
    Readonly<{
      claim: CognitiveManagementActionClaim;
      status: 'pending' | 'completed' | 'failed';
      lease?: CognitiveManagementActionLease;
      result?: unknown;
      errorCode?: string;
      expired?: boolean;
    }>
  >();

  claim(input: CognitiveManagementActionClaim): Promise<CognitiveManagementActionClaimResult> {
    const key = `${input.operation}:${input.subjectId}:${input.idempotencyKey}`;
    const existing = this.#items.get(key);
    if (existing === undefined) {
      const lease = leaseFrom(input, 1, 'claimed');
      this.#items.set(key, { claim: input, status: 'pending', lease });
      return Promise.resolve({ disposition: 'claimed' as const, lease });
    }
    if (existing.claim.requestHash !== input.requestHash) {
      return Promise.resolve({ disposition: 'conflict' as const });
    }
    if (existing.status === 'completed') {
      return Promise.resolve({ disposition: 'completed', result: existing.result });
    }
    if (existing.status === 'failed') {
      return Promise.resolve({
        disposition: 'failed',
        ...(existing.errorCode === undefined ? {} : { errorCode: existing.errorCode }),
      });
    }
    if (existing.expired === true) {
      const lease = leaseFrom(
        input,
        (existing.lease?.attempt ?? 0) + 1,
        existing.lease?.executionPhase ?? 'claimed',
        existing.lease,
      );
      this.#items.set(key, { ...existing, claim: input, lease, expired: false });
      return Promise.resolve({ disposition: 'recovered', lease });
    }
    return Promise.resolve({ disposition: 'pending' });
  }

  renewLease(lease: CognitiveManagementActionLease) {
    const item = this.#current(lease);
    const renewed = { ...item.lease, expiresAt: '2099-01-01T00:00:00.000Z' };
    this.#replace(lease.actionId, { ...item, lease: renewed });
    return Promise.resolve(renewed);
  }

  assertCurrentLease(lease: CognitiveManagementActionLease) {
    this.#current(lease);
    return Promise.resolve();
  }

  runFencedProjection<T>(lease: CognitiveManagementActionLease, projection: () => Promise<T>) {
    this.#current(lease);
    return projection();
  }

  startExecution(lease: CognitiveManagementActionLease) {
    const item = this.#current(lease);
    if (item.lease.executionPhase !== 'claimed') return Promise.reject(new Error('LEASE_CONFLICT'));
    const next = { ...item.lease, executionPhase: 'execution_started' as const };
    this.#replace(lease.actionId, { ...item, lease: next });
    return Promise.resolve(next);
  }

  enterProviderDispatch(
    lease: CognitiveManagementActionLease,
    input: Readonly<{ dispatchId: string; dispatchHash: string }>,
  ) {
    const item = this.#current(lease);
    if (item.lease.executionPhase !== 'execution_started')
      return Promise.reject(new Error('LEASE_CONFLICT'));
    const next = {
      ...item.lease,
      executionPhase: 'provider_dispatch' as const,
      providerDispatchId: input.dispatchId,
      providerDispatchHash: input.dispatchHash,
    };
    this.#replace(lease.actionId, { ...item, lease: next });
    return Promise.resolve(next);
  }

  complete(lease: CognitiveManagementActionLease, result: unknown) {
    this.#current(lease);
    for (const [key, item] of this.#items) {
      if (item.claim.actionId === lease.actionId) {
        this.#items.set(key, { claim: item.claim, status: 'completed', result });
        return Promise.resolve();
      }
    }
    return Promise.reject(new Error('COGNITIVE_MANAGEMENT_ACTION_NOT_FOUND'));
  }

  fail(lease: CognitiveManagementActionLease, errorCode: string) {
    this.failCalls += 1;
    this.#current(lease);
    for (const [key, item] of this.#items) {
      if (item.claim.actionId === lease.actionId) {
        this.#items.set(key, { claim: item.claim, status: 'failed', errorCode });
        return Promise.resolve();
      }
    }
    return Promise.reject(new Error('COGNITIVE_MANAGEMENT_ACTION_NOT_FOUND'));
  }

  list() {
    return Promise.resolve([]);
  }

  expirePending(): void {
    for (const [key, item] of this.#items)
      if (item.status === 'pending') this.#items.set(key, { ...item, expired: true });
  }

  pendingPhase(): CognitiveManagementActionLease['executionPhase'] | undefined {
    return [...this.#items.values()].find((item) => item.status === 'pending')?.lease
      ?.executionPhase;
  }

  pendingStatus(): 'pending' | undefined {
    return [...this.#items.values()].some((item) => item.status === 'pending')
      ? 'pending'
      : undefined;
  }

  #current(lease: CognitiveManagementActionLease) {
    const item = [...this.#items.values()].find(
      (candidate) => candidate.claim.actionId === lease.actionId,
    );
    if (
      item?.status !== 'pending' ||
      item.lease?.owner !== lease.owner ||
      item.lease.attempt !== lease.attempt ||
      item.lease.token !== lease.token ||
      item.expired === true
    )
      throw new Error('LEASE_CONFLICT');
    return item as typeof item & { lease: CognitiveManagementActionLease };
  }

  #replace(
    actionId: string,
    next: Readonly<{
      claim: CognitiveManagementActionClaim;
      status: 'pending' | 'completed' | 'failed';
      lease?: CognitiveManagementActionLease;
      result?: unknown;
      errorCode?: string;
      expired?: boolean;
    }>,
  ): void {
    for (const [key, item] of this.#items)
      if (item.claim.actionId === actionId) {
        this.#items.set(key, next);
        return;
      }
    throw new Error('LEASE_NOT_FOUND');
  }
}

class BlockingRenewManagementActions extends InMemoryManagementActions {
  readonly renewStarted = deferred<undefined>();
  readonly allowRenew = deferred<undefined>();
  readonly operationOrder: string[] = [];

  override async renewLease(lease: CognitiveManagementActionLease) {
    this.operationOrder.push('renew-started');
    this.renewStarted.resolve(undefined);
    await this.allowRenew.promise;
    const renewed = await super.renewLease(lease);
    this.operationOrder.push('renew-finished');
    return renewed;
  }

  override async startExecution(lease: CognitiveManagementActionLease) {
    const started = await super.startExecution(lease);
    this.operationOrder.push('execution-started');
    return started;
  }

  override async enterProviderDispatch(
    lease: CognitiveManagementActionLease,
    input: Readonly<{ dispatchId: string; dispatchHash: string }>,
  ) {
    const dispatched = await super.enterProviderDispatch(lease, input);
    this.operationOrder.push('provider-dispatch');
    return dispatched;
  }
}

function deterministicRequest() {
  return {
    operation: 'deterministic_capability_execution' as const,
    subjectId: 'deterministic-capability-execution',
    expectedVersion: 1,
    idempotencyKey: 'task-home-lab-read-recovery',
    actorId: 'sdar-deterministic-capability-execution',
    reason: 'Execute the exact admitted deterministic Capability contract.',
    requestFingerprint: `sha256:${'a'.repeat(64)}`,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function leaseFrom(
  input: CognitiveManagementActionClaim,
  attempt: number,
  executionPhase: CognitiveManagementActionLease['executionPhase'],
  previous?: CognitiveManagementActionLease,
): CognitiveManagementActionLease {
  return Object.freeze({
    actionId: input.actionId,
    owner: input.leaseOwner,
    attempt,
    token: input.leaseToken,
    expiresAt: '2099-01-01T00:00:00.000Z',
    executionPhase,
    ...(previous?.providerDispatchId === undefined
      ? {}
      : {
          providerDispatchId: previous.providerDispatchId,
          providerDispatchHash: previous.providerDispatchHash,
        }),
  });
}
