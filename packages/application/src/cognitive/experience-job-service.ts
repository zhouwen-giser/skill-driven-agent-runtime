import type { ExperienceJob } from '../../../domain/src/index.js';
import type {
  ExperienceJobRepository,
  GoalExperienceEpisodeBuilderPort,
  GoalExperienceEpisodeRepository,
} from './ports.js';

export class ExperienceJobService {
  readonly #jobs: ExperienceJobRepository;
  readonly #episodes: GoalExperienceEpisodeRepository;
  readonly #builder: GoalExperienceEpisodeBuilderPort;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #retryPolicy: Readonly<{
    maxAttempts: number;
    baseBackoffMs: number;
    maxBackoffMs: number;
  }>;

  constructor(
    dependencies: Readonly<{
      jobs: ExperienceJobRepository;
      episodes: GoalExperienceEpisodeRepository;
      builder: GoalExperienceEpisodeBuilderPort;
      clock: Readonly<{ now(): string }>;
      retryPolicy: Readonly<{
        maxAttempts: number;
        baseBackoffMs: number;
        maxBackoffMs: number;
      }>;
    }>,
  ) {
    this.#jobs = dependencies.jobs;
    this.#episodes = dependencies.episodes;
    this.#builder = dependencies.builder;
    this.#clock = dependencies.clock;
    this.#retryPolicy = dependencies.retryPolicy;
  }

  claim(workerId: string, limit = 1): Promise<readonly ExperienceJob[]> {
    return this.#jobs.claim(workerId, this.#clock.now(), 60_000, limit);
  }

  async process(job: ExperienceJob, workerId: string): Promise<void> {
    if (job.jobType !== 'episode') return;
    try {
      const goalId = requireString(job.payload['goalId'], 'goalId');
      const goalVersion = requirePositiveInteger(job.payload['goalVersion'], 'goalVersion');
      const episode = await this.#builder.build({ goalId, goalVersion });
      const inserted = await this.#episodes.saveIfAbsent(episode);
      const persistedEpisode = inserted
        ? episode
        : (await this.#episodes.findByGoal(goalId)).find(
            (candidate) =>
              candidate.goalVersion === goalVersion &&
              candidate.terminalOutcomeRef === episode.terminalOutcomeRef,
          );
      if (persistedEpisode === undefined) {
        throw new Error('EXPERIENCE_EPISODE_IDEMPOTENCY_CONFLICT');
      }
      await this.#jobs.complete(job.jobId, workerId, this.#clock.now(), persistedEpisode.episodeId);
    } catch (error: unknown) {
      const now = this.#clock.now();
      const attemptLimit = Math.min(job.maxAttempts, this.#retryPolicy.maxAttempts);
      const retryAt =
        job.attempt >= attemptLimit
          ? undefined
          : new Date(
              Date.parse(now) +
                Math.min(
                  this.#retryPolicy.maxBackoffMs,
                  this.#retryPolicy.baseBackoffMs * 2 ** Math.max(0, job.attempt - 1),
                ),
            ).toISOString();
      await this.#jobs.fail(
        job.jobId,
        workerId,
        errorCode(error),
        errorSummary(error),
        now,
        retryAt,
      );
    }
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`EXPERIENCE_JOB_${field.toUpperCase()}_INVALID`);
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`EXPERIENCE_JOB_${field.toUpperCase()}_INVALID`);
  }
  return value as number;
}

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code.slice(0, 128);
  }
  return error instanceof Error && /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.message)
    ? error.message
    : 'EXPERIENCE_JOB_FAILED';
}

function errorSummary(error: unknown): string {
  const summary = error instanceof Error ? error.message : 'Experience job failed.';
  return summary
    .replace(/(password|secret|token|authorization|credential)=[^\s]+/giu, '$1=[REDACTED]')
    .slice(0, 2048);
}
