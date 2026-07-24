import type {
  ExperienceJobQueuePort,
  ExperienceJobRepository,
  GoalExperienceEpisodeRepository,
  ObservationRepository,
  ReflectionRepository,
} from './ports.js';

export class ExperienceManagementService {
  readonly #episodes: GoalExperienceEpisodeRepository;
  readonly #jobs: ExperienceJobRepository;
  readonly #queue: ExperienceJobQueuePort;
  readonly #observations: ObservationRepository | undefined;
  readonly #reflections: ReflectionRepository | undefined;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      episodes: GoalExperienceEpisodeRepository;
      jobs: ExperienceJobRepository;
      queue: ExperienceJobQueuePort;
      observations?: ObservationRepository;
      reflections?: ReflectionRepository;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#episodes = dependencies.episodes;
    this.#jobs = dependencies.jobs;
    this.#queue = dependencies.queue;
    this.#observations = dependencies.observations;
    this.#reflections = dependencies.reflections;
    this.#clock = dependencies.clock;
  }

  listEpisodes(goalId?: string, limit = 100) {
    return this.#episodes.list(limit, goalId);
  }

  listDeadLetters(limit = 100) {
    return this.#jobs.listDeadLetters(limit);
  }

  listObservations(goalId?: string, limit = 100) {
    return this.#observations?.list(limit, goalId) ?? Promise.resolve([]);
  }

  listReflections(limit = 100) {
    return this.#reflections?.list(limit) ?? Promise.resolve([]);
  }

  async replayDeadLetter(deadLetterId: string, actorId: string) {
    const job = await this.#jobs.replayDeadLetter(deadLetterId, actorId, this.#clock.now());
    await this.#queue.enqueue(job.jobId);
    return job;
  }
}
