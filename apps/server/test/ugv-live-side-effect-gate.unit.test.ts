import { describe, expect, it } from 'vitest';

import { EnvironmentUgvLiveSideEffectGate } from '../src/ugv-live-side-effect-gate.js';

const AUTHORITY = Object.freeze({
  taskId: 'task-live-ugv-1',
  selectedSnapshotHash: `sha256:${'a'.repeat(64)}` as const,
});

describe('EnvironmentUgvLiveSideEffectGate', () => {
  it('is default closed and accepts only the exact explicit enable value', async () => {
    await expect(
      new EnvironmentUgvLiveSideEffectGate({}).assertAuthorized(AUTHORITY),
    ).rejects.toMatchObject({ code: 'UGV_LIVE_SIDE_EFFECT_NOT_AUTHORIZED' });
    await expect(
      new EnvironmentUgvLiveSideEffectGate({ ALLOW_UGV_LIVE_SIDE_EFFECTS: 'yes' }).assertAuthorized(
        AUTHORITY,
      ),
    ).rejects.toMatchObject({ code: 'UGV_LIVE_SIDE_EFFECT_NOT_AUTHORIZED' });
    await expect(
      new EnvironmentUgvLiveSideEffectGate({ ALLOW_UGV_LIVE_SIDE_EFFECTS: 'YES' }).assertAuthorized(
        AUTHORITY,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects malformed task or selected-operation authority', async () => {
    const gate = new EnvironmentUgvLiveSideEffectGate({ ALLOW_UGV_LIVE_SIDE_EFFECTS: 'YES' });
    await expect(gate.assertAuthorized({ ...AUTHORITY, taskId: ' ' })).rejects.toMatchObject({
      code: 'UGV_LIVE_SIDE_EFFECT_NOT_AUTHORIZED',
    });
    await expect(
      gate.assertAuthorized({ ...AUTHORITY, selectedSnapshotHash: 'sha256:bad' }),
    ).rejects.toMatchObject({ code: 'UGV_LIVE_SIDE_EFFECT_NOT_AUTHORIZED' });
  });
});
