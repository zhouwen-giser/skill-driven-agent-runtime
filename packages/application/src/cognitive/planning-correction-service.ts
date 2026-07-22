import { createHash } from 'node:crypto';

import {
  COGNITIVE_SCHEMA_VERSION,
  createCognitiveSourceRef,
  createPlanningCorrectionFact,
  type PlanningCorrectionFact,
} from '../../../domain/src/index.js';
import type {
  PlanningCorrectionRepository,
  PlanningInteractionEpisodeBuilderPort,
  PlanningPreferenceProjectionPort,
} from './ports.js';

export type PlanningCorrectionRecordInput = Readonly<
  Omit<
    PlanningCorrectionFact,
    'schemaVersion' | 'correctionId' | 'correctionHash' | 'counterexampleRefs' | 'createdAt'
  > & {
    finalOutcomeRef?: string;
    counterexampleRefs?: readonly string[];
  }
>;

export interface PlanningCorrectionObserver {
  record(input: PlanningCorrectionRecordInput): Promise<unknown>;
  recordInteraction(taskId: string): Promise<unknown>;
}

export class PlanningCorrectionService {
  readonly #repository: PlanningCorrectionRepository;
  readonly #builder: PlanningInteractionEpisodeBuilderPort;
  readonly #preferences: PlanningPreferenceProjectionPort;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #nextCorrectionId: () => string;

  constructor(
    dependencies: Readonly<{
      repository: PlanningCorrectionRepository;
      builder: PlanningInteractionEpisodeBuilderPort;
      preferences: PlanningPreferenceProjectionPort;
      clock: Readonly<{ now(): string }>;
      nextCorrectionId(): string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#builder = dependencies.builder;
    this.#preferences = dependencies.preferences;
    this.#clock = dependencies.clock;
    this.#nextCorrectionId = dependencies.nextCorrectionId;
  }

  async record(input: PlanningCorrectionRecordInput) {
    const duplicate = await this.#repository.findByIdempotencyKey(
      input.taskId,
      input.idempotencyKey,
    );
    if (duplicate !== undefined) {
      await this.#preferences.projectLowRisk(duplicate);
      const episodes = await this.#repository.listEpisodes(input.taskId);
      const episode = episodes.at(-1) ?? (await this.#appendEpisode({ taskId: input.taskId }));
      return { fact: duplicate, episode, inserted: false as const };
    }
    const correctionId = this.#nextCorrectionId();
    const createdAt = this.#clock.now();
    const correctionHash = sha256({
      taskId: input.taskId,
      target: input.target,
      correctionType: input.correctionType,
      scope: input.scope,
      beforeSnapshot: input.beforeSnapshot,
      userInstruction: input.userInstruction,
      structuredPatch: input.structuredPatch,
      afterSnapshot: input.afterSnapshot,
      validation: input.validation,
      accepted: input.accepted,
    });
    const fact = createPlanningCorrectionFact({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      correctionId,
      taskId: input.taskId,
      ...(input.goalId === undefined || input.goalVersion === undefined
        ? {}
        : { goalId: input.goalId, goalVersion: input.goalVersion }),
      sessionId: input.sessionId,
      turnId: input.turnId,
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      target: input.target,
      correctionType: input.correctionType,
      scope: input.scope,
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      beforeSnapshot: input.beforeSnapshot,
      userInstruction: input.userInstruction,
      structuredPatch: input.structuredPatch,
      afterSnapshot: input.afterSnapshot,
      validation: input.validation,
      accepted: input.accepted,
      ...(input.preferenceCategory === undefined
        ? {}
        : { preferenceCategory: input.preferenceCategory }),
      ...(input.finalOutcomeRef === undefined ? {} : { finalOutcomeRef: input.finalOutcomeRef }),
      counterexampleRefs: input.counterexampleRefs ?? [],
      correctionHash,
      sourceRefs: [
        ...input.sourceRefs,
        createCognitiveSourceRef({
          schemaVersion: COGNITIVE_SCHEMA_VERSION,
          sourceRefId: sourceRefId(correctionId),
          sourceKind: 'planning_correction',
          sourceId: correctionId,
          sourceRevision: 1,
          authority: 'user_instruction',
          dataClassification: input.scope === 'user' ? 'user_scoped' : 'internal',
          capturedAt: createdAt,
          contentHash: correctionHash,
        }),
      ],
      createdAt,
    });
    const saved = await this.#repository.saveIfAbsent(fact);
    await this.#preferences.projectLowRisk(saved.fact);
    const episode = await this.#appendEpisode({ taskId: input.taskId });
    return { fact: saved.fact, episode, inserted: saved.inserted };
  }

  async recordInteraction(taskId: string) {
    return this.#appendEpisode({ taskId });
  }

  async recordOutcome(
    input: Readonly<{
      taskId: string;
      outcomeRef: string;
      counterexampleRefs?: readonly string[];
    }>,
  ) {
    return this.#appendEpisode(input);
  }

  async listTaskInteractions(taskId: string) {
    const [corrections, episodes] = await Promise.all([
      this.#repository.listByTask(taskId),
      this.#repository.listEpisodes(taskId),
    ]);
    return { corrections, episodes };
  }

  async deleteUserScopedProjection(userId: string, actorId: string): Promise<number> {
    return this.#preferences.deleteUserScope(
      userId,
      await this.#repository.listUserScoped(userId),
      actorId,
    );
  }

  async #appendEpisode(
    input: Readonly<{
      taskId: string;
      outcomeRef?: string;
      counterexampleRefs?: readonly string[];
    }>,
  ) {
    const episode = await this.#builder.build(input);
    await this.#repository.saveEpisode(episode);
    const episodes = await this.#repository.listEpisodes(input.taskId);
    return episodes.find((item) => item.episodeHash === episode.episodeHash) ?? episode;
  }
}

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('PLANNING_CORRECTION_NON_FINITE_JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') {
    throw new Error('PLANNING_CORRECTION_NON_JSON_VALUE');
  }
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function sourceRefId(correctionId: string): string {
  return `source.correction.${createHash('sha256').update(correctionId).digest('hex').slice(0, 24)}`;
}
