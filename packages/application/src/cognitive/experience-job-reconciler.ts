import type { ExperienceJobQueuePort, ExperienceJobRepository } from './ports.js';

export class ExperienceJobReconciler {
  readonly #jobs: ExperienceJobRepository;
  readonly #queue: ExperienceJobQueuePort;

  constructor(
    dependencies: Readonly<{ jobs: ExperienceJobRepository; queue: ExperienceJobQueuePort }>,
  ) {
    this.#jobs = dependencies.jobs;
    this.#queue = dependencies.queue;
  }

  async requeue(now: string, limit = 100): Promise<number> {
    const jobs = await this.#jobs.listRequeueable(now, limit);
    for (const job of jobs) await this.#queue.enqueue(job.jobId);
    return jobs.length;
  }
}
