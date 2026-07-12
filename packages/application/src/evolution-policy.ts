import { createEvolutionPolicy, type EvolutionPolicy } from '../../domain/src/index.js';

import type { Clock, EvolutionPolicyRepository } from './ports.js';

export class EvolutionPolicyService {
  readonly #repository: EvolutionPolicyRepository;
  readonly #clock: Clock;

  constructor(dependencies: Readonly<{ repository: EvolutionPolicyRepository; clock: Clock }>) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
  }

  getPolicy(): Promise<EvolutionPolicy> {
    return this.#repository.get();
  }

  async updatePolicy(successThreshold: number): Promise<EvolutionPolicy> {
    const policy = createEvolutionPolicy(successThreshold, this.#clock.now());
    await this.#repository.update(policy);
    return policy;
  }

  listTriggers(capabilityFingerprint?: string) {
    return this.#repository.listTriggers(capabilityFingerprint);
  }
}
