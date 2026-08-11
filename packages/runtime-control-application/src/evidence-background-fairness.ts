export interface EvidenceBackgroundFairnessOptions {
  readonly idleSliceLimit: number;
  readonly busySliceLimit: number;
  readonly maximumDeferralMs: number;
}

export interface EvidenceBackgroundSliceRunnerOptions {
  readonly gate: EvidenceBackgroundFairnessGate;
  readonly maximumSlices: number;
  readonly idleItemLimit: number;
  readonly busyItemLimit: number;
  readonly foregroundBusy: () => Promise<boolean>;
  readonly now: () => number;
  readonly runSlice: (input: {
    readonly foregroundBusy: boolean;
    readonly itemLimit: number;
  }) => Promise<boolean>;
}

/**
 * Process-local early hint for foreground work that has entered the Runtime but has not yet
 * committed its durable Task row. Database authority remains required for cross-process work;
 * this tracker only closes the request-start-to-row-visible race in the composing process.
 */
export class ForegroundActivityTracker {
  #activeOperations = 0;

  isBusy(): boolean {
    return this.#activeOperations > 0;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.#activeOperations += 1;
    try {
      return await operation();
    } finally {
      this.#activeOperations -= 1;
    }
  }
}

export class EvidenceBackgroundFairnessGate {
  readonly #options: EvidenceBackgroundFairnessOptions;
  #lastGrantedAtMs: number | undefined;

  constructor(options: EvidenceBackgroundFairnessOptions) {
    for (const [field, value] of Object.entries(options)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`EVIDENCE_BACKGROUND_FAIRNESS_${field.toUpperCase()}_INVALID`);
      }
    }
    this.#options = options;
  }

  grant(foregroundBusy: boolean, nowMs: number): number {
    if (!Number.isFinite(nowMs) || nowMs < 0) {
      throw new Error('EVIDENCE_BACKGROUND_FAIRNESS_CLOCK_INVALID');
    }
    if (
      foregroundBusy &&
      this.#lastGrantedAtMs !== undefined &&
      nowMs - this.#lastGrantedAtMs < this.#options.maximumDeferralMs
    ) {
      return 0;
    }
    this.#lastGrantedAtMs = nowMs;
    return foregroundBusy ? this.#options.busySliceLimit : this.#options.idleSliceLimit;
  }
}

/**
 * Runs a bounded background batch while re-checking foreground authority before every slice.
 *
 * A task can begin after an idle timer tick was admitted. Re-evaluating the gate for each
 * partition/round bounds that race to one slice instead of consuming the entire idle budget.
 * The gate still grants one busy slice after its configured maximum deferral, so background
 * cursors retain bounded liveness.
 */
export async function runEvidenceBackgroundSlices(
  options: EvidenceBackgroundSliceRunnerOptions,
): Promise<number> {
  for (const [field, value] of Object.entries({
    maximumSlices: options.maximumSlices,
    idleItemLimit: options.idleItemLimit,
    busyItemLimit: options.busyItemLimit,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`EVIDENCE_BACKGROUND_SLICE_${field.toUpperCase()}_INVALID`);
    }
  }

  let completedSlices = 0;
  while (completedSlices < options.maximumSlices) {
    const foregroundBusy = await options.foregroundBusy();
    if (options.gate.grant(foregroundBusy, options.now()) === 0) break;
    const shouldContinue = await options.runSlice({
      foregroundBusy,
      itemLimit: foregroundBusy ? options.busyItemLimit : options.idleItemLimit,
    });
    completedSlices += 1;
    if (!shouldContinue) break;
  }
  return completedSlices;
}
