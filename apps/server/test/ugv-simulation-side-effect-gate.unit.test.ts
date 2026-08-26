import { describe, expect, it } from 'vitest';

import { EnvironmentUgvProfileSideEffectGate } from '../src/ugv-simulation-side-effect-gate.js';

const RUN_ID = 'uap-p3-b02-20260821t130000z-a1b2c3d4';
const AUTHORITY = Object.freeze({
  taskId: 'task-uap-p3-b02',
  mode: 'simulation' as const,
  simulationId: RUN_ID,
  selectedSnapshotHash: `sha256:${'a'.repeat(64)}` as const,
});

describe('UGV server-side simulation side-effect gate', () => {
  it('requires the separate explicit development LIVE gate and rejects simulation identity', async () => {
    const env = {
      SDAR_UGV_EXECUTION_MODE: 'live',
      ALLOW_UGV_LIVE_SIDE_EFFECTS: 'YES',
      SDAR_CONTROL_ENVIRONMENT: 'development',
    };
    const live = {
      taskId: 'task-live',
      mode: 'live' as const,
      selectedSnapshotHash: AUTHORITY.selectedSnapshotHash,
    };
    await expect(
      new EnvironmentUgvProfileSideEffectGate(env).assertAuthorized(live),
    ).resolves.toBeUndefined();
    for (const denied of [
      { ...env, ALLOW_UGV_LIVE_SIDE_EFFECTS: 'NO' },
      { ...env, SDAR_CONTROL_ENVIRONMENT: 'production' },
      { ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'YES', UGV_SIMULATION_RUN_ID: RUN_ID },
    ])
      await expect(
        new EnvironmentUgvProfileSideEffectGate(denied).assertAuthorized(live),
      ).rejects.toBeInstanceOf(Error);
    await expect(
      new EnvironmentUgvProfileSideEffectGate(env).assertAuthorized({ ...live, simulationId: '' }),
    ).rejects.toBeInstanceOf(Error);
  });
  it('admits only an exact explicitly enabled run', async () => {
    const gate = new EnvironmentUgvProfileSideEffectGate({
      ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'YES',
      UGV_SIMULATION_RUN_ID: RUN_ID,
    });

    await expect(gate.assertAuthorized(AUTHORITY)).resolves.toBeUndefined();
  });

  it.each([
    {},
    { ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'yes', UGV_SIMULATION_RUN_ID: RUN_ID },
    { ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'YES' },
    { ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'YES', UGV_SIMULATION_RUN_ID: 'unsafe' },
  ])('is default-closed for incomplete or non-exact environment authority: %j', async (env) => {
    const gate = new EnvironmentUgvProfileSideEffectGate(env);

    await expect(gate.assertAuthorized(AUTHORITY)).rejects.toMatchObject({
      code: 'UGV_SIMULATION_SIDE_EFFECT_NOT_AUTHORIZED',
    });
  });

  it('rejects a different simulation run before confirmation consumption', async () => {
    const gate = new EnvironmentUgvProfileSideEffectGate({
      ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'YES',
      UGV_SIMULATION_RUN_ID: RUN_ID,
    });

    await expect(
      gate.assertAuthorized({ ...AUTHORITY, simulationId: `${RUN_ID}-other` }),
    ).rejects.toMatchObject({ code: 'UGV_SIMULATION_SIDE_EFFECT_NOT_AUTHORIZED' });
  });
});
