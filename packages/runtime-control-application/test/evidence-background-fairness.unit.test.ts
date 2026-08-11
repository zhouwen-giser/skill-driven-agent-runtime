import { describe, expect, it } from 'vitest';

import {
  EvidenceBackgroundFairnessGate,
  ForegroundActivityTracker,
  runEvidenceBackgroundSlices,
} from '../src/index.js';

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

  it('stops an admitted idle batch when foreground work appears before the next slice', async () => {
    const gate = new EvidenceBackgroundFairnessGate({
      idleSliceLimit: 8,
      busySliceLimit: 1,
      maximumDeferralMs: 10_000,
    });
    const busyStates = [false, true];
    const slices: { foregroundBusy: boolean; itemLimit: number }[] = [];

    await expect(
      runEvidenceBackgroundSlices({
        gate,
        maximumSlices: 8,
        idleItemLimit: 16,
        busyItemLimit: 1,
        foregroundBusy: () => Promise.resolve(busyStates.shift() ?? true),
        now: () => 0,
        runSlice: (input) => {
          slices.push(input);
          return Promise.resolve(true);
        },
      }),
    ).resolves.toBe(1);
    expect(slices).toEqual([{ foregroundBusy: false, itemLimit: 16 }]);
  });

  it('keeps the ten-second busy liveness grant to one item and one slice', async () => {
    const gate = new EvidenceBackgroundFairnessGate({
      idleSliceLimit: 8,
      busySliceLimit: 1,
      maximumDeferralMs: 10_000,
    });
    let nowMs = 0;
    const itemLimits: number[] = [];
    const run = () =>
      runEvidenceBackgroundSlices({
        gate,
        maximumSlices: 8,
        idleItemLimit: 16,
        busyItemLimit: 1,
        foregroundBusy: () => Promise.resolve(true),
        now: () => nowMs,
        runSlice: ({ itemLimit }) => {
          itemLimits.push(itemLimit);
          return Promise.resolve(true);
        },
      });

    await expect(run()).resolves.toBe(1);
    nowMs = 9_999;
    await expect(run()).resolves.toBe(0);
    nowMs = 10_000;
    await expect(run()).resolves.toBe(1);
    expect(itemLimits).toEqual([1, 1]);
  });

  it('tracks concurrent foreground work until every operation settles', async () => {
    const tracker = new ForegroundActivityTracker();
    const releases: (() => void)[] = [];
    const run = (): Promise<void> =>
      tracker.run(
        () =>
          new Promise<void>((resolve) => {
            releases.push(resolve);
          }),
      );

    const first = run();
    const second = run();
    expect(tracker.isBusy()).toBe(true);
    releases[0]?.();
    await first;
    expect(tracker.isBusy()).toBe(true);
    releases[1]?.();
    await second;
    expect(tracker.isBusy()).toBe(false);
  });

  it('clears the foreground hint when work rejects', async () => {
    const tracker = new ForegroundActivityTracker();
    await expect(tracker.run(() => Promise.reject(new Error('foreground failed')))).rejects.toThrow(
      'foreground failed',
    );
    expect(tracker.isBusy()).toBe(false);
  });
});
