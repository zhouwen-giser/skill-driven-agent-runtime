import { describe, expect, it, vi } from 'vitest';

import {
  CognitiveManagementActionGate,
  type CognitiveManagementActionClaim,
  type CognitiveManagementActionClaimResult,
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
  readonly #items = new Map<
    string,
    Readonly<{
      claim: CognitiveManagementActionClaim;
      status: 'pending' | 'completed' | 'failed';
      result?: unknown;
      errorCode?: string;
    }>
  >();

  claim(input: CognitiveManagementActionClaim): Promise<CognitiveManagementActionClaimResult> {
    const key = `${input.operation}:${input.subjectId}:${input.idempotencyKey}`;
    const existing = this.#items.get(key);
    if (existing === undefined) {
      this.#items.set(key, { claim: input, status: 'pending' });
      return Promise.resolve({ disposition: 'claimed' as const });
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
    return Promise.resolve({ disposition: 'pending' });
  }

  complete(actionId: string, result: unknown) {
    for (const [key, item] of this.#items) {
      if (item.claim.actionId === actionId) {
        this.#items.set(key, { ...item, status: 'completed', result });
        return Promise.resolve();
      }
    }
    return Promise.reject(new Error('COGNITIVE_MANAGEMENT_ACTION_NOT_FOUND'));
  }

  fail(actionId: string, errorCode: string) {
    for (const [key, item] of this.#items) {
      if (item.claim.actionId === actionId) {
        this.#items.set(key, { ...item, status: 'failed', errorCode });
        return Promise.resolve();
      }
    }
    return Promise.reject(new Error('COGNITIVE_MANAGEMENT_ACTION_NOT_FOUND'));
  }

  list() {
    return Promise.resolve([]);
  }
}
