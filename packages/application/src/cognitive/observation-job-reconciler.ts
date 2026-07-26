import type { ExperienceJobQueuePort, ObservationJobRepository } from './ports.js';

export class ObservationJobReconciler {
  readonly #jobs: ObservationJobRepository;
  readonly #queue: ExperienceJobQueuePort;

  constructor(
    dependencies: Readonly<{ jobs: ObservationJobRepository; queue: ExperienceJobQueuePort }>,
  ) {
    this.#jobs = dependencies.jobs;
    this.#queue = dependencies.queue;
  }

  async requeue(now: string, limit = 100): Promise<number> {
    const jobs = await this.#jobs.listObservationRequeueable(now, limit);
    for (const job of jobs) await this.#queue.enqueue(job.jobId);
    return jobs.length;
  }
}
