import type { UgvLiveSideEffectGate } from '../../../packages/application/src/index.js';

const ENABLED_VALUE = 'YES';

/** Deployment-owned, default-closed gate for live UGV physical side effects. */
export class EnvironmentUgvLiveSideEffectGate implements UgvLiveSideEffectGate {
  readonly #enabled: boolean;

  constructor(environment: NodeJS.ProcessEnv) {
    this.#enabled = environment['ALLOW_UGV_LIVE_SIDE_EFFECTS'] === ENABLED_VALUE;
  }

  assertAuthorized(
    input: Readonly<{
      taskId: string;
      selectedSnapshotHash: `sha256:${string}`;
    }>,
  ): Promise<void> {
    if (
      !this.#enabled ||
      input.taskId.trim() === '' ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.selectedSnapshotHash)
    )
      return Promise.reject(
        new UgvLiveSideEffectGateError(
          'UGV_LIVE_SIDE_EFFECT_NOT_AUTHORIZED',
          'UGV live physical side effects are disabled for this Runtime deployment.',
        ),
      );
    return Promise.resolve();
  }
}

export class UgvLiveSideEffectGateError extends Error {
  readonly code = 'UGV_LIVE_SIDE_EFFECT_NOT_AUTHORIZED';

  constructor(_code: 'UGV_LIVE_SIDE_EFFECT_NOT_AUTHORIZED', message: string) {
    super(message);
    this.name = 'UgvLiveSideEffectGateError';
  }
}
