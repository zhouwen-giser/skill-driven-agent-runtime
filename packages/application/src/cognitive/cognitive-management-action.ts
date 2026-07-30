import { createHash } from 'node:crypto';

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
  | 'artifact_build_promotion_package';

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
}

export type CognitiveManagementActionClaimResult =
  | Readonly<{ disposition: 'claimed' }>
  | Readonly<{ disposition: 'completed'; result: unknown }>
  | Readonly<{ disposition: 'pending' | 'failed' | 'conflict'; errorCode?: string }>;

export interface CognitiveManagementActionRepository {
  claim(input: CognitiveManagementActionClaim): Promise<CognitiveManagementActionClaimResult>;
  complete(actionId: string, result: unknown, completedAt: string): Promise<void>;
  fail(actionId: string, errorCode: string, failedAt: string): Promise<void>;
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
}

export class CognitiveManagementActionGate {
  readonly #repository: CognitiveManagementActionRepository;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      repository: CognitiveManagementActionRepository;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
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
    action: () => Promise<T>,
  ): Promise<T> {
    const requestHash = hashRequest(input);
    const actionId = `cognitive-management-${requestHash.slice('sha256:'.length)}`;
    const claimed = await this.#repository.claim({
      actionId,
      ...input,
      requestHash,
      claimedAt: this.#clock.now(),
    });
    if (claimed.disposition === 'completed') return claimed.result as T;
    if (claimed.disposition !== 'claimed') {
      throw new CognitiveManagementActionError(
        claimed.disposition === 'conflict'
          ? 'COGNITIVE_MANAGEMENT_IDEMPOTENCY_CONFLICT'
          : claimed.disposition === 'failed'
            ? (claimed.errorCode ?? 'COGNITIVE_MANAGEMENT_PRIOR_ACTION_FAILED')
            : 'COGNITIVE_MANAGEMENT_ACTION_IN_PROGRESS',
      );
    }
    try {
      const result = await action();
      assertAuditResult(result);
      await this.#repository.complete(actionId, result, this.#clock.now());
      return result;
    } catch (error: unknown) {
      await this.#repository.fail(actionId, stableErrorCode(error), this.#clock.now());
      throw error;
    }
  }
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
