import type { NodeControlClock, NodeControlFoundationRepository } from './ports.js';

export interface NodeControlWorkerCycle {
  readonly status: 'idle';
  readonly observedAt: string;
}

export class NodeControlFoundationWorker {
  readonly #repository: NodeControlFoundationRepository;
  readonly #clock: NodeControlClock;

  constructor(
    dependencies: Readonly<{
      repository: NodeControlFoundationRepository;
      clock: NodeControlClock;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
  }

  async runOnce(): Promise<NodeControlWorkerCycle> {
    if (!(await this.#repository.probe())) throw new Error('CONTROL_DATABASE_UNAVAILABLE');
    return Object.freeze({ status: 'idle', observedAt: this.#clock.now() });
  }
}
