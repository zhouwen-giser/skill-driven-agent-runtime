import { createHash, randomUUID } from 'node:crypto';

export type CognitiveManagementOperation =
  | 'goal_session_action'
  | 'planning_session_action'
  | 'capability_rebuild'
  | 'capability_card_rebuild'
  | 'experience_dead_letter_replay'
  | 'knowledge_promote'
  | 'knowledge_reject'
  | 'knowledge_revalidate'
  | 'knowledge_deprecate'
  | 'artifact_request_validation'
  | 'artifact_record_approval'
  | 'artifact_activate'
  | 'artifact_request_revalidation'
  | 'artifact_deprecate'
  | 'artifact_rollback'
  | 'artifact_kill_switch'
  | 'artifact_build_promotion_package'
  | 'deterministic_capability_execution';

export interface CognitiveManagementActionClaim {
  readonly actionId: string;
  readonly operation: CognitiveManagementOperation;
  readonly subjectId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly reason: string;
  readonly requestHash: string;
  readonly claimedAt: string;
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly leaseDurationMs: number;
}

export type CognitiveManagementActionExecutionPhase =
  'claimed' | 'execution_started' | 'provider_dispatch' | 'terminal';

export interface CognitiveManagementActionLease {
  readonly actionId: string;
  readonly owner: string;
  readonly attempt: number;
  readonly token: string;
  readonly expiresAt: string;
  readonly executionPhase: Exclude<CognitiveManagementActionExecutionPhase, 'terminal'>;
  readonly providerDispatchId?: string;
  readonly providerDispatchHash?: string;
}

export type CognitiveManagementActionClaimResult =
  | Readonly<{
      disposition: 'claimed' | 'recovered';
      lease: CognitiveManagementActionLease;
    }>
  | Readonly<{ disposition: 'completed'; result: unknown }>
  | Readonly<{ disposition: 'pending' | 'failed' | 'conflict'; errorCode?: string }>;

export interface CognitiveManagementActionLeaseGuard {
  assertCurrent(): Promise<void>;
  runFencedProjection<T>(projection: () => Promise<T>): Promise<T>;
  enterProviderDispatch(
    input: Readonly<{ dispatchId: string; dispatchHash: string }>,
  ): Promise<void>;
  executionPhase(): CognitiveManagementActionLease['executionPhase'];
  providerDispatchIdentity(): Readonly<{ dispatchId: string; dispatchHash: string }> | undefined;
  readonly signal: AbortSignal;
}

export type CognitiveManagementActionRecoveryResult<T> =
  | Readonly<{ disposition: 'completed'; result: T }>
  | Readonly<{ disposition: 'orphaned' | 'indeterminate'; errorCode: string }>;

export interface CognitiveManagementActionRepository {
  claim(input: CognitiveManagementActionClaim): Promise<CognitiveManagementActionClaimResult>;
  renewLease(
    lease: CognitiveManagementActionLease,
    leaseDurationMs: number,
  ): Promise<CognitiveManagementActionLease>;
  assertCurrentLease(lease: CognitiveManagementActionLease): Promise<void>;
  runFencedProjection<T>(
    lease: CognitiveManagementActionLease,
    projection: () => Promise<T>,
  ): Promise<T>;
  startExecution(lease: CognitiveManagementActionLease): Promise<CognitiveManagementActionLease>;
  enterProviderDispatch(
    lease: CognitiveManagementActionLease,
    input: Readonly<{ dispatchId: string; dispatchHash: string }>,
  ): Promise<CognitiveManagementActionLease>;
  complete(
    lease: CognitiveManagementActionLease,
    result: unknown,
    completedAt: string,
  ): Promise<void>;
  fail(lease: CognitiveManagementActionLease, errorCode: string, failedAt: string): Promise<void>;
  list(limit?: number): Promise<readonly CognitiveManagementActionRecord[]>;
}

export interface CognitiveManagementActionRecord {
  readonly actionId: string;
  readonly operation: CognitiveManagementOperation;
  readonly subjectId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly reason: string;
  readonly requestHash: string;
  readonly status: 'pending' | 'completed' | 'failed';
  readonly result?: unknown;
  readonly errorCode?: string;
  readonly claimedAt: string;
  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly updatedAt: string;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: string;
  readonly leaseAttempt: number;
  readonly executionPhase: CognitiveManagementActionExecutionPhase;
  readonly providerDispatchId?: string;
  readonly providerDispatchHash?: string;
}

export class CognitiveManagementActionGate {
  readonly #repository: CognitiveManagementActionRepository;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #ownerId: string;
  readonly #nextLeaseToken: () => string;
  readonly #leaseDurationMs: number;
  readonly #leaseRenewIntervalMs: number;

  constructor(
    dependencies: Readonly<{
      repository: CognitiveManagementActionRepository;
      clock: Readonly<{ now(): string }>;
      ownerId?: string;
      nextLeaseToken?: () => string;
      leaseDurationMs?: number;
      leaseRenewIntervalMs?: number;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
    this.#ownerId = dependencies.ownerId ?? `cognitive-management-${randomUUID()}`;
    this.#nextLeaseToken = dependencies.nextLeaseToken ?? randomUUID;
    this.#leaseDurationMs = dependencies.leaseDurationMs ?? 60_000;
    this.#leaseRenewIntervalMs = dependencies.leaseRenewIntervalMs ?? 20_000;
    if (
      !Number.isSafeInteger(this.#leaseDurationMs) ||
      this.#leaseDurationMs < 1 ||
      !Number.isSafeInteger(this.#leaseRenewIntervalMs) ||
      this.#leaseRenewIntervalMs < 1 ||
      this.#leaseRenewIntervalMs >= this.#leaseDurationMs
    )
      throw new CognitiveManagementActionError('COGNITIVE_MANAGEMENT_LEASE_CONFIGURATION_INVALID');
  }

  async execute<T>(
    input: Readonly<{
      operation: CognitiveManagementOperation;
      subjectId: string;
      expectedVersion: number;
      idempotencyKey: string;
      actorId: string;
      reason: string;
      requestFingerprint?: string;
    }>,
    action: (lease: CognitiveManagementActionLeaseGuard) => Promise<T>,
    recover?: (
      lease: CognitiveManagementActionLeaseGuard,
    ) => Promise<CognitiveManagementActionRecoveryResult<T>>,
  ): Promise<T> {
    const requestHash = hashRequest(input);
    const actionId = `cognitive-management-${requestHash.slice('sha256:'.length)}`;
    const claimed = await this.#repository.claim({
      actionId,
      ...input,
      requestHash,
      claimedAt: this.#clock.now(),
      leaseOwner: this.#ownerId,
      leaseToken: this.#nextLeaseToken(),
      leaseDurationMs: this.#leaseDurationMs,
    });
    if (claimed.disposition === 'completed') return claimed.result as T;
    if (claimed.disposition !== 'claimed' && claimed.disposition !== 'recovered') {
      throw new CognitiveManagementActionError(
        claimed.disposition === 'conflict'
          ? 'COGNITIVE_MANAGEMENT_IDEMPOTENCY_CONFLICT'
          : claimed.disposition === 'failed'
            ? (claimed.errorCode ?? 'COGNITIVE_MANAGEMENT_PRIOR_ACTION_FAILED')
            : 'COGNITIVE_MANAGEMENT_ACTION_IN_PROGRESS',
      );
    }
    return this.#withLease(claimed.lease, async (lease) => {
      if (claimed.disposition === 'recovered') {
        const recovery =
          recover === undefined
            ? ({
                disposition: 'orphaned',
                errorCode: 'COGNITIVE_MANAGEMENT_RECOVERY_UNAVAILABLE',
              } as const)
            : await recover(lease.guard);
        if (recovery.disposition === 'completed') {
          assertAuditResult(recovery.result);
          await lease.guard.assertCurrent();
          await lease.run((current) =>
            this.#repository.complete(current, recovery.result, this.#clock.now()),
          );
          return recovery.result;
        }
        if (recovery.disposition === 'indeterminate') {
          await lease.guard.assertCurrent();
          throw new CognitiveManagementActionError(recovery.errorCode);
        }
        await lease.guard.assertCurrent();
        await lease.run((current) =>
          this.#repository.fail(current, recovery.errorCode, this.#clock.now()),
        );
        throw new CognitiveManagementActionError(recovery.errorCode);
      }
      try {
        try {
          await lease.update((current) => this.#repository.startExecution(current));
        } catch {
          throw leaseLost();
        }
        const result = await action(lease.guard);
        assertAuditResult(result);
        await lease.guard.assertCurrent();
        await lease.run((current) => this.#repository.complete(current, result, this.#clock.now()));
        return result;
      } catch (error: unknown) {
        if (isLeaseLost(error)) throw error;
        if (lease.current().executionPhase === 'provider_dispatch') {
          await lease.guard.assertCurrent();
          throw new CognitiveManagementActionError(
            'COGNITIVE_MANAGEMENT_ACTION_RECONCILIATION_PENDING',
          );
        }
        try {
          await lease.run((current) =>
            this.#repository.fail(current, stableErrorCode(error), this.#clock.now()),
          );
        } catch {
          throw leaseLost();
        }
        throw error;
      }
    });
  }

  async #withLease<T>(
    initial: CognitiveManagementActionLease,
    operation: (
      lease: Readonly<{
        guard: CognitiveManagementActionLeaseGuard;
        current(): CognitiveManagementActionLease;
        run<U>(operation: (current: CognitiveManagementActionLease) => Promise<U>): Promise<U>;
        update(
          operation: (
            current: CognitiveManagementActionLease,
          ) => Promise<CognitiveManagementActionLease>,
        ): Promise<void>;
      }>,
    ) => Promise<T>,
  ): Promise<T> {
    let current = initial;
    let stopped = false;
    let lost = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    let leaseTail = Promise.resolve();
    const exclusive = async <U>(leaseOperation: () => Promise<U>): Promise<U> => {
      const previous = leaseTail;
      let release: (() => void) | undefined;
      leaseTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await leaseOperation();
      } finally {
        release?.();
      }
    };
    const assertCurrent = async (): Promise<void> => {
      if (lost || abort.signal.aborted) throw leaseLost();
      try {
        await exclusive(() => this.#repository.assertCurrentLease(current));
      } catch {
        lost = true;
        abort.abort(leaseLost());
        throw leaseLost();
      }
    };
    const guard: CognitiveManagementActionLeaseGuard = Object.freeze({
      assertCurrent,
      runFencedProjection: async <U>(projection: () => Promise<U>): Promise<U> => {
        if (lost || abort.signal.aborted) throw leaseLost();
        try {
          return await exclusive(() => this.#repository.runFencedProjection(current, projection));
        } catch (error: unknown) {
          if (!isRepositoryLeaseConflict(error)) throw error;
          lost = true;
          abort.abort(leaseLost());
          throw leaseLost();
        }
      },
      signal: abort.signal,
      executionPhase: () => current.executionPhase,
      providerDispatchIdentity: () =>
        current.providerDispatchId === undefined || current.providerDispatchHash === undefined
          ? undefined
          : Object.freeze({
              dispatchId: current.providerDispatchId,
              dispatchHash: current.providerDispatchHash,
            }),
      enterProviderDispatch: async (
        input: Readonly<{ dispatchId: string; dispatchHash: string }>,
      ) => {
        if (lost || abort.signal.aborted) throw leaseLost();
        try {
          await exclusive(async () => {
            current = await this.#repository.enterProviderDispatch(current, input);
          });
        } catch {
          lost = true;
          abort.abort(leaseLost());
          throw leaseLost();
        }
      },
    });
    const schedule = (): void => {
      if (stopped || lost) return;
      timer = setTimeout(() => {
        void renew();
      }, this.#leaseRenewIntervalMs);
      timer.unref();
    };
    const renew = async (): Promise<void> => {
      if (stopped || lost) return;
      try {
        await exclusive(async () => {
          const renewed = await this.#repository.renewLease(current, this.#leaseDurationMs);
          if (!stopped) current = renewed;
        });
      } catch {
        lost = true;
        abort.abort(leaseLost());
      }
      schedule();
    };
    schedule();
    try {
      return await operation(
        Object.freeze({
          guard,
          current: () => current,
          run: (leaseOperation) => exclusive(() => leaseOperation(current)),
          update: async (leaseOperation) => {
            await exclusive(async () => {
              current = await leaseOperation(current);
            });
          },
        }),
      );
    } finally {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      if (!abort.signal.aborted) abort.abort();
    }
  }
}

function leaseLost(): CognitiveManagementActionError {
  return new CognitiveManagementActionError('COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST');
}

function isLeaseLost(error: unknown): boolean {
  return (
    error instanceof CognitiveManagementActionError &&
    error.code === 'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST'
  );
}

function isRepositoryLeaseConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('code' in error && error.code === 'COGNITIVE_MANAGEMENT_ACTION_LEASE_CONFLICT') ||
      ('message' in error && error.message === 'COGNITIVE_MANAGEMENT_ACTION_LEASE_CONFLICT'))
  );
}

function assertAuditResult(value: unknown, depth = 0): void {
  if (depth > 32) throw new CognitiveManagementActionError('COGNITIVE_MANAGEMENT_AUDIT_TOO_DEEP');
  if (Array.isArray(value)) {
    for (const item of value) assertAuditResult(item, depth + 1);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (
      /^(?:chainOfThought|chain_of_thought|privateReasoning|private_reasoning|cot)$/iu.test(key)
    ) {
      throw new CognitiveManagementActionError('COGNITIVE_MANAGEMENT_PRIVATE_REASONING_FORBIDDEN');
    }
    assertAuditResult(item, depth + 1);
  }
}

export class CognitiveManagementActionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'CognitiveManagementActionError';
    this.code = code;
  }
}

function hashRequest(
  input: Readonly<{
    operation: CognitiveManagementOperation;
    subjectId: string;
    expectedVersion: number;
    idempotencyKey: string;
    actorId: string;
    reason: string;
    requestFingerprint?: string;
  }>,
): string {
  const canonical = JSON.stringify([
    input.operation,
    input.subjectId,
    input.expectedVersion,
    input.idempotencyKey,
    input.actorId,
    input.reason,
    input.requestFingerprint ?? null,
  ]);
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function stableErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return error instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
    ? error.message
    : 'COGNITIVE_MANAGEMENT_ACTION_FAILED';
}
