import type { ExperienceJobQueuePort, ReflectionJobRepository } from './ports.js';

export class ReflectionJobReconciler {
  readonly #jobs: ReflectionJobRepository;
  readonly #queue: ExperienceJobQueuePort;

  constructor(
    dependencies: Readonly<{ jobs: ReflectionJobRepository; queue: ExperienceJobQueuePort }>,
  ) {
    this.#jobs = dependencies.jobs;
    this.#queue = dependencies.queue;
  }

  async requeue(now: string, limit = 100): Promise<number> {
    const jobs = await this.#jobs.listReflectionRequeueable(now, limit);
    for (const job of jobs) await this.#queue.enqueue(job.jobId);
    return jobs.length;
  }
}
