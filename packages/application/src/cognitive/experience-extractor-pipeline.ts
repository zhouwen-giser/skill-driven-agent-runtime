import { createHash } from 'node:crypto';

import {
  createExperienceExtraction,
  type CognitiveSourceRef,
  type ExperienceExtraction,
  type ExperienceObservation,
  type ExperienceObservationStatement,
  type GoalExperienceEpisode,
} from '../../../domain/src/index.js';
import type { ExperienceExtractor, ExperienceObservationPartition } from './ports.js';

export interface ExperienceExtractorPipelineResult {
  readonly extractions: readonly ExperienceExtraction[];
  readonly statements: readonly ExperienceObservationStatement[];
  readonly modelInvocationRefs: readonly string[];
  readonly inputBytes: number;
  readonly approximateTokens: number;
}

export class ExperienceExtractorPipeline {
  readonly #extractors: readonly ExperienceExtractor<unknown>[];
  readonly #policy: Readonly<{
    maxEpisodes: number;
    maxInputBytes: number;
    maxApproxTokens: number;
    maxPreviousObservations: number;
  }>;

  constructor(
    dependencies: Readonly<{
      extractors: readonly ExperienceExtractor<unknown>[];
      policy: Readonly<{
        maxEpisodes: number;
        maxInputBytes: number;
        maxApproxTokens: number;
        maxPreviousObservations: number;
      }>;
    }>,
  ) {
    this.#extractors = Object.freeze([...dependencies.extractors]);
    this.#policy = Object.freeze({ ...dependencies.policy });
  }

  async run(
    input: Readonly<{
      observationId: string;
      episodes: readonly GoalExperienceEpisode[];
      previousObservations: readonly ExperienceObservation[];
    }>,
  ): Promise<ExperienceExtractorPipelineResult> {
    if (input.episodes.length === 0) throw new Error('EXPERIENCE_OBSERVER_EPISODE_REQUIRED');
    if (input.episodes.length > this.#policy.maxEpisodes) {
      throw new Error('EXPERIENCE_OBSERVER_BATCH_LIMIT_EXCEEDED');
    }
    const previousObservations = input.previousObservations.slice(
      0,
      this.#policy.maxPreviousObservations,
    );
    const inputBytes = Buffer.byteLength(
      JSON.stringify({
        episodes: input.episodes.map((episode) => ({
          episodeId: episode.episodeId,
          snapshot: episode.snapshot,
          sourceRefs: episode.sourceRefs,
        })),
        previousObservations,
      }),
      'utf8',
    );
    if (inputBytes > this.#policy.maxInputBytes) {
      throw new Error('EXPERIENCE_OBSERVER_BYTE_BUDGET_EXCEEDED');
    }
    const approximateTokens = Math.ceil(inputBytes / 4);
    if (approximateTokens > this.#policy.maxApproxTokens) {
      throw new Error('EXPERIENCE_OBSERVER_TOKEN_BUDGET_EXCEEDED');
    }
    const partitions = partitionEpisodes(input.episodes);
    const sourceRefs = uniqueSources(input.episodes);
    const extractions = await Promise.all(
      this.#extractors.map(async (extractor): Promise<ExperienceExtraction> => {
        try {
          return await extractor.extract({
            observationId: input.observationId,
            episodes: input.episodes,
            partitions,
            sourceRefs,
            previousObservations,
          });
        } catch (error: unknown) {
          return createExperienceExtraction({
            extractionId: stableId(
              'experience-extraction-failed',
              `${input.observationId}:${extractor.id}`,
            ),
            observationId: input.observationId,
            extractorKind: extractor.id,
            status: 'failed',
            modelTier: extractor.modelTier,
            sourceEpisodeIds: input.episodes.map((episode) => episode.episodeId),
            statements: [],
            changeSuggestions: [],
            errorCode: errorCode(error),
            inputBytes,
            outputBytes: 0,
            createdAt: input.episodes[0]?.createdAt ?? new Date(0).toISOString(),
          });
        }
      }),
    );
    return Object.freeze({
      extractions: Object.freeze(extractions),
      statements: Object.freeze(extractions.flatMap((extraction) => extraction.statements)),
      modelInvocationRefs: Object.freeze([
        ...new Set(extractions.flatMap((item) => item.modelInvocationId ?? [])),
      ]),
      inputBytes,
      approximateTokens,
    });
  }
}

function partitionEpisodes(
  episodes: readonly GoalExperienceEpisode[],
): Readonly<Record<ExperienceObservationPartition, unknown>> {
  const values = episodes.map((episode) => episode.snapshot);
  return Object.freeze({
    contract: values.flatMap((snapshot) => optional(snapshot['contract'])),
    plan: values.flatMap((snapshot) => [
      ...optional(snapshot['currentPlan']),
      ...array(snapshot['planRevisions']),
    ]),
    attempt: values.flatMap((snapshot) => array(snapshot['attempts'])),
    outcome: values.flatMap((snapshot) => [
      ...array(snapshot['outcomes']),
      ...array(snapshot['progress']),
      ...optional(snapshot['terminalOutcome']),
    ]),
    recovery: values.flatMap((snapshot) => [
      ...array(snapshot['recovery']),
      ...array(snapshot['eventImpacts']),
    ]),
    correction: values.flatMap((snapshot) => array(snapshot['interactions'])),
  });
}

function uniqueSources(episodes: readonly GoalExperienceEpisode[]): readonly CognitiveSourceRef[] {
  const sources = new Map<string, CognitiveSourceRef>();
  for (const source of episodes.flatMap((episode) => episode.sourceRefs)) {
    sources.set(source.sourceRefId, source);
  }
  return Object.freeze([...sources.values()]);
}

function optional(value: unknown): readonly unknown[] {
  return value === undefined || value === null ? [] : [value];
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
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
    : 'EXPERIENCE_EXTRACTOR_FAILED';
}
