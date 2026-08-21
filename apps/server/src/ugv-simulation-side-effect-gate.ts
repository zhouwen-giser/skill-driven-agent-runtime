import type { UgvSimulationSideEffectGate } from '../../../packages/application/src/index.js';

const ENABLED_VALUE = 'YES';
const RUN_ID = /^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u;

/** Deployment-owned, default-closed half of the UGV side-effect authority. */
export class EnvironmentUgvSimulationSideEffectGate implements UgvSimulationSideEffectGate {
  readonly #enabled: boolean;
  readonly #runId: string | undefined;

  constructor(environment: NodeJS.ProcessEnv) {
    this.#enabled = environment['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'] === ENABLED_VALUE;
    const runId = environment['UGV_SIMULATION_RUN_ID'];
    this.#runId = runId === undefined || !RUN_ID.test(runId) ? undefined : runId;
  }

  assertAuthorized(
    input: Readonly<{
      taskId: string;
      simulationId: string;
      selectedSnapshotHash: `sha256:${string}`;
    }>,
  ): Promise<void> {
    if (
      !this.#enabled ||
      this.#runId === undefined ||
      input.simulationId !== this.#runId ||
      input.taskId.trim() === '' ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.selectedSnapshotHash)
    )
      return Promise.reject(
        new UgvSimulationSideEffectGateError(
          'UGV_SIMULATION_SIDE_EFFECT_NOT_AUTHORIZED',
          'UGV simulation side effects are disabled or bound to a different immutable run.',
        ),
      );
    return Promise.resolve();
  }
}

export class UgvSimulationSideEffectGateError extends Error {
  readonly code = 'UGV_SIMULATION_SIDE_EFFECT_NOT_AUTHORIZED';

  constructor(_code: 'UGV_SIMULATION_SIDE_EFFECT_NOT_AUTHORIZED', message: string) {
    super(message);
    this.name = 'UgvSimulationSideEffectGateError';
  }
}
