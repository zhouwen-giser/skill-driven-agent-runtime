import type {
  ExperienceJobQueuePort,
  ExperienceJobRepository,
  GoalExperienceEpisodeRepository,
} from './ports.js';

export class ExperienceManagementService {
  readonly #episodes: GoalExperienceEpisodeRepository;
  readonly #jobs: ExperienceJobRepository;
  readonly #queue: ExperienceJobQueuePort;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      episodes: GoalExperienceEpisodeRepository;
      jobs: ExperienceJobRepository;
      queue: ExperienceJobQueuePort;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#episodes = dependencies.episodes;
    this.#jobs = dependencies.jobs;
    this.#queue = dependencies.queue;
    this.#clock = dependencies.clock;
  }

  listEpisodes(goalId?: string, limit = 100) {
    return this.#episodes.list(limit, goalId);
  }

  listDeadLetters(limit = 100) {
    return this.#jobs.listDeadLetters(limit);
  }

  async replayDeadLetter(deadLetterId: string, actorId: string) {
    const job = await this.#jobs.replayDeadLetter(deadLetterId, actorId, this.#clock.now());
    await this.#queue.enqueue(job.jobId);
    return job;
  }
}
