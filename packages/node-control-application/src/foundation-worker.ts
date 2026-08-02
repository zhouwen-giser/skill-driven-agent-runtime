import type { NodeControlClock, NodeControlFoundationRepository } from './ports.js';
import type { NodeControlSmppRegistryService } from './smpp-registry-service.js';

export interface NodeControlWorkerCycle {
  readonly status: 'idle';
  readonly observedAt: string;
  readonly smppSourcesAttempted: number;
  readonly smppSourcesFailed: number;
}

export class NodeControlFoundationWorker {
  readonly #repository: NodeControlFoundationRepository;
  readonly #clock: NodeControlClock;
  readonly #smppRegistry: NodeControlSmppRegistryService | undefined;

  constructor(
    dependencies: Readonly<{
      repository: NodeControlFoundationRepository;
      clock: NodeControlClock;
      smppRegistry?: NodeControlSmppRegistryService;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
    this.#smppRegistry = dependencies.smppRegistry;
  }

  async runOnce(): Promise<NodeControlWorkerCycle> {
    if (!(await this.#repository.probe())) throw new Error('CONTROL_DATABASE_UNAVAILABLE');
    const smpp = (await this.#smppRegistry?.synchronizeScheduled()) ?? { attempted: 0, failed: 0 };
    return Object.freeze({
      status: 'idle',
      observedAt: this.#clock.now(),
      smppSourcesAttempted: smpp.attempted,
      smppSourcesFailed: smpp.failed,
    });
  }
}
