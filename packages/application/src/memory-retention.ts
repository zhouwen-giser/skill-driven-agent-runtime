import { createMemoryRetentionPolicy, type MemoryRetentionPolicy } from '../../domain/src/index.js';
import type { Clock, MemoryRetentionPolicyRepository } from './ports.js';

export class MemoryRetentionPolicyService {
  readonly #repository: MemoryRetentionPolicyRepository;
  readonly #clock: Clock;
  constructor(
    dependencies: Readonly<{ repository: MemoryRetentionPolicyRepository; clock: Clock }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
  }

  getPolicy(): Promise<MemoryRetentionPolicy> {
    return this.#repository.get();
  }

  async updatePolicy(
    input: Omit<MemoryRetentionPolicy, 'updatedAt'>,
  ): Promise<MemoryRetentionPolicy> {
    const policy = createMemoryRetentionPolicy(input, this.#clock.now());
    await this.#repository.update(policy);
    return policy;
  }
}
