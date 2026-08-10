export interface EvidenceBackgroundFairnessOptions {
  readonly idleSliceLimit: number;
  readonly busySliceLimit: number;
  readonly maximumDeferralMs: number;
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
