import type { UgvProfileSideEffectGate } from '../../../packages/application/src/index.js';

const ENABLED_VALUE = 'YES';
const RUN_ID = /^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u;

/** Deployment-owned, default-closed half of the UGV side-effect authority. */
export class EnvironmentUgvProfileSideEffectGate implements UgvProfileSideEffectGate {
  readonly #enabled: boolean;
  readonly #liveEnabled: boolean;
  readonly #runId: string | undefined;

  constructor(environment: NodeJS.ProcessEnv) {
    this.#liveEnabled =
      environment['SDAR_UGV_EXECUTION_MODE'] === 'live' &&
      environment['ALLOW_UGV_LIVE_SIDE_EFFECTS'] === ENABLED_VALUE &&
      environment['SDAR_CONTROL_ENVIRONMENT'] === 'development';
    this.#enabled = environment['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'] === ENABLED_VALUE;
    const runId = environment['UGV_SIMULATION_RUN_ID'];
    this.#runId = runId === undefined || !RUN_ID.test(runId) ? undefined : runId;
  }

  assertAuthorized(
    input: Readonly<{
      taskId: string;
      mode: 'live' | 'simulation';
      simulationId?: string;
      selectedSnapshotHash: `sha256:${string}`;
    }>,
  ): Promise<void> {
    if (
      (input.mode === 'live'
        ? !this.#liveEnabled || 'simulationId' in input
        : !this.#enabled || this.#runId === undefined || input.simulationId !== this.#runId) ||
      input.taskId.trim() === '' ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.selectedSnapshotHash)
    )
      return Promise.reject(
        new UgvProfileSideEffectGateError(
          'UGV_SIMULATION_SIDE_EFFECT_NOT_AUTHORIZED',
          'UGV side effects are disabled for this execution context.',
        ),
      );
    return Promise.resolve();
  }
}

export class UgvProfileSideEffectGateError extends Error {
  readonly code = 'UGV_SIMULATION_SIDE_EFFECT_NOT_AUTHORIZED';

  constructor(_code: 'UGV_SIMULATION_SIDE_EFFECT_NOT_AUTHORIZED', message: string) {
    super(message);
    this.name = 'UgvProfileSideEffectGateError';
  }
}
