import { describe, expect, it } from 'vitest';

import { EvidenceBackgroundFairnessGate } from '../src/index.js';

describe('Evidence background fairness', () => {
  it('prioritizes foreground work while guaranteeing a bounded background slice', () => {
    const gate = new EvidenceBackgroundFairnessGate({
      idleSliceLimit: 8,
      busySliceLimit: 1,
      maximumDeferralMs: 10_000,
    });

    expect(gate.grant(false, 0)).toBe(8);
    expect(gate.grant(true, 1_000)).toBe(0);
    expect(gate.grant(true, 9_999)).toBe(0);
    expect(gate.grant(true, 10_000)).toBe(1);
    expect(gate.grant(true, 10_001)).toBe(0);
    expect(gate.grant(true, 20_000)).toBe(1);
    expect(gate.grant(false, 20_001)).toBe(8);
  });
});
