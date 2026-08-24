import { describe, expect, it, vi } from 'vitest';

import { reconcileExpiredReadinessAgentCard } from '../src/readiness-agent-card-reconciler.js';

describe('expired readiness Agent Card reconciliation', () => {
  it('does not rebuild when no readiness authority expired', async () => {
    const rebuild = vi.fn().mockResolvedValue({ status: 'succeeded' });

    await expect(
      reconcileExpiredReadinessAgentCard(
        { evaluateExpired: () => Promise.resolve([]) },
        { rebuild },
      ),
    ).resolves.toEqual({ evaluatedCount: 0, cardRebuilt: false });
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('rebuilds once with an order-independent idempotency identity', async () => {
    const records = [readiness('capability-b', 2, 7, 'b'), readiness('capability-a', 1, 3, 'a')];
    const firstRebuild = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const secondRebuild = vi.fn().mockResolvedValue({ status: 'succeeded' });

    await expect(
      reconcileExpiredReadinessAgentCard(
        { evaluateExpired: () => Promise.resolve(records) },
        { rebuild: firstRebuild },
      ),
    ).resolves.toEqual({ evaluatedCount: 2, cardRebuilt: true });
    await reconcileExpiredReadinessAgentCard(
      { evaluateExpired: () => Promise.resolve([...records].reverse()) },
      { rebuild: secondRebuild },
    );

    expect(firstRebuild).toHaveBeenCalledOnce();
    expect(firstRebuild.mock.calls[0]?.[0]).toMatch(/^readiness-expiry-card-[a-f0-9]{64}$/u);
    expect(secondRebuild.mock.calls[0]?.[0]).toBe(firstRebuild.mock.calls[0]?.[0]);
    expect(firstRebuild.mock.calls[0]?.[1]).toBe(
      'Rebuild the managed Agent Card after Runtime readiness expiry reconciliation.',
    );
  });

  it('fails explicitly when the managed Card cannot be rebuilt', async () => {
    await expect(
      reconcileExpiredReadinessAgentCard(
        { evaluateExpired: () => Promise.resolve([readiness('capability-a', 1, 3, 'a')]) },
        { rebuild: () => Promise.resolve({ status: 'failed' }) },
      ),
    ).rejects.toThrow('READINESS_AGENT_CARD_REBUILD_FAILED');
  });
});

function readiness(
  capabilityId: string,
  capabilityVersion: number,
  snapshotVersion: number,
  hashCharacter: string,
) {
  return Object.freeze({
    snapshot: Object.freeze({ capabilityId, capabilityVersion, snapshotVersion }),
    snapshotHash: `sha256:${hashCharacter.repeat(64)}`,
  });
}
