import type { CapabilityPatternRepository } from './ports.js';

export class CapabilityPatternInvalidator {
  readonly #repository: CapabilityPatternRepository;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      repository: CapabilityPatternRepository;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
  }

  invalidateByCatalog(input: Readonly<{ catalogHash: string; policyVersion: string }>) {
    return this.#repository.invalidateByCatalog({
      ...input,
      occurredAt: this.#clock.now(),
    });
  }
}
