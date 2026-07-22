import type { CognitiveOutboxRepository, ExperienceJobQueuePort } from './ports.js';

export class ExperienceOutboxDispatcher {
  readonly #outbox: CognitiveOutboxRepository;
  readonly #queue: ExperienceJobQueuePort;

  constructor(
    dependencies: Readonly<{
      outbox: CognitiveOutboxRepository;
      queue: ExperienceJobQueuePort;
    }>,
  ) {
    this.#outbox = dependencies.outbox;
    this.#queue = dependencies.queue;
  }

  async dispatch(limit = 100): Promise<number> {
    const jobs = await this.#outbox.dispatchTerminalEvents(limit);
    for (const job of jobs) await this.#queue.enqueue(job.jobId);
    return jobs.length;
  }
}
