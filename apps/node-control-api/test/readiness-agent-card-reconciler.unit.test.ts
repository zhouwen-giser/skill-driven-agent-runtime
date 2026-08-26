import { describe, expect, it, vi } from 'vitest';

import { reconcileExpiredReadiness } from '../src/readiness-agent-card-reconciler.js';

describe('expired execution readiness reconciliation', () => {
  it('reports no work when no readiness authority expired', async () => {
    await expect(
      reconcileExpiredReadiness({ evaluateExpired: () => Promise.resolve([]) }),
    ).resolves.toEqual({ evaluatedCount: 0 });
  });

  it('refreshes expired execution gates without an Agent Card deployment dependency', async () => {
    const records = [readiness('capability-b', 2, 7, 'b'), readiness('capability-a', 1, 3, 'a')];
    const evaluateExpired = vi.fn(() => Promise.resolve(records));

    await expect(reconcileExpiredReadiness({ evaluateExpired })).resolves.toEqual({
      evaluatedCount: 2,
    });
    expect(evaluateExpired).toHaveBeenCalledOnce();
  });

  it('preserves execution readiness evaluation failures', async () => {
    await expect(
      reconcileExpiredReadiness({
        evaluateExpired: () => Promise.reject(new Error('READINESS_PROVIDER_READ_FAILED')),
      }),
    ).rejects.toThrow('READINESS_PROVIDER_READ_FAILED');
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
