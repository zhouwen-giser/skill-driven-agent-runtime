import { createHash } from 'node:crypto';

import {
  createExperienceObservation,
  type ExperienceJob,
  type ExperienceObservation,
  type GoalExperienceEpisode,
} from '../../../domain/src/index.js';
import type { ExperienceExtractorPipeline } from './experience-extractor-pipeline.js';
import type {
  GoalExperienceEpisodeRepository,
  ObservationJobRepository,
  ObservationRepository,
} from './ports.js';

export class ExperienceObserverService {
  readonly #jobs: ObservationJobRepository;
  readonly #episodes: GoalExperienceEpisodeRepository;
  readonly #observations: ObservationRepository;
  readonly #pipeline: Pick<ExperienceExtractorPipeline, 'run'>;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #nextObservationId: (episodeId: string) => string;
  readonly #retryPolicy: Readonly<{
    maxAttempts: number;
    baseBackoffMs: number;
    maxBackoffMs: number;
  }>;

  constructor(
    dependencies: Readonly<{
      jobs: ObservationJobRepository;
      episodes: GoalExperienceEpisodeRepository;
      observations: ObservationRepository;
      pipeline: Pick<ExperienceExtractorPipeline, 'run'>;
      clock: Readonly<{ now(): string }>;
      nextObservationId(episodeId: string): string;
      retryPolicy: Readonly<{
        maxAttempts: number;
        baseBackoffMs: number;
        maxBackoffMs: number;
      }>;
    }>,
  ) {
    this.#jobs = dependencies.jobs;
    this.#episodes = dependencies.episodes;
    this.#observations = dependencies.observations;
    this.#pipeline = dependencies.pipeline;
    this.#clock = dependencies.clock;
    this.#nextObservationId = dependencies.nextObservationId;
    this.#retryPolicy = dependencies.retryPolicy;
  }

  claim(workerId: string, limit = 1): Promise<readonly ExperienceJob[]> {
    return this.#jobs.claimObservation(workerId, this.#clock.now(), 60_000, limit);
  }

  async observe(job: ExperienceJob, workerId: string): Promise<void> {
    if (job.jobType !== 'observe') return;
    try {
      const episode = await this.#requiredEpisode(job.subjectId);
      const existing = await this.#observations.findByEpisode(episode.episodeId);
      const prior = existing.at(-1);
      if (prior !== undefined) {
        await this.#jobs.completeObservation(
          job.jobId,
          workerId,
          this.#clock.now(),
          prior.observationId,
        );
        return;
      }
      const previousObservations = await this.#observations.listPrevious(
        episode.goalId,
        episode.episodeId,
        3,
      );
      const observationId = this.#nextObservationId(episode.episodeId);
      const result = await this.#pipeline.run({
        observationId,
        episodes: [episode],
        previousObservations,
      });
      const failed = result.extractions.filter((item) => item.status === 'failed').length;
      if (failed === result.extractions.length && failed > 0) {
        throw codedError('EXPERIENCE_OBSERVER_ALL_EXTRACTORS_FAILED');
      }
      const completed = result.extractions.filter((item) => item.status === 'completed').length;
      const noOp = result.extractions.filter((item) => item.status === 'no_op').length;
      const observation = createExperienceObservation({
        schemaVersion: '1.0',
        observationId,
        scope: scopeFor(episode),
        sourceEpisodeIds: [episode.episodeId],
        revision: 1,
        status: failed > 0 ? 'partial' : 'completed',
        statements: result.statements,
        extractions: result.extractions,
        modelInvocationRefs: result.modelInvocationRefs,
        observationHash: hash({
          sourceEpisodeIds: [episode.episodeId],
          statements: result.statements,
          extractions: result.extractions.map((item) => ({
            extractorKind: item.extractorKind,
            status: item.status,
            statements: item.statements,
            changeSuggestions: item.changeSuggestions,
            errorCode: item.errorCode,
          })),
        }),
        summary: {
          extractorCount: result.extractions.length,
          completed,
          noOp,
          failed,
          statementCount: result.statements.length,
          inputBytes: result.inputBytes,
          approximateTokens: result.approximateTokens,
        },
        createdAt: this.#clock.now(),
      });
      await this.#observations.save(observation);
      await this.#jobs.completeObservation(
        job.jobId,
        workerId,
        this.#clock.now(),
        observation.observationId,
      );
    } catch (error: unknown) {
      await this.#fail(job, workerId, error);
    }
  }

  async #requiredEpisode(episodeId: string): Promise<GoalExperienceEpisode> {
    const episode = await this.#episodes.findById(episodeId);
    if (episode === undefined) throw codedError('EXPERIENCE_OBSERVER_EPISODE_NOT_FOUND');
    return episode;
  }

  async #fail(job: ExperienceJob, workerId: string, error: unknown): Promise<void> {
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
    await this.#jobs.fail(job.jobId, workerId, errorCode(error), errorSummary(error), now, retryAt);
  }
}

function scopeFor(episode: GoalExperienceEpisode): ExperienceObservation['scope'] {
  return episode.episodeType === 'interaction' ? 'planning_interaction' : 'goal_episode';
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
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
  return 'EXPERIENCE_OBSERVER_FAILED';
}

function errorSummary(error: unknown): string {
  return (error instanceof Error ? error.message : 'Experience observer failed.')
    .replace(/(password|secret|token|authorization|credential)=[^\s]+/giu, '$1=[REDACTED]')
    .slice(0, 2048);
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw codedError('EXPERIENCE_OBSERVER_NON_FINITE_JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw codedError('EXPERIENCE_OBSERVER_NON_JSON_VALUE');
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
