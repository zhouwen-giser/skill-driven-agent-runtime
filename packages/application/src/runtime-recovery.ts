import type { Clock, RuntimeRecoveryRepository } from './ports.js';

export class RuntimeRecoveryService {
  readonly #repository: RuntimeRecoveryRepository;
  readonly #clock: Clock;
  constructor(dependencies: Readonly<{ repository: RuntimeRecoveryRepository; clock: Clock }>) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
  }

  failInterruptedExecutions() {
    return this.#repository.failInterrupted(this.#clock.now());
  }
}
