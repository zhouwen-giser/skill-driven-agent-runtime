import type {
  SkillQualityObservation,
  SkillQualityWarning,
  SkillQualityWarningKind,
} from '../../domain/src/index.js';

import type { Clock, SkillQualityRepository, SkillRepository } from './ports.js';

const WINDOW_SIZE = 3;
const LOW_SCORE_THRESHOLD = 0.4;
const FAILURE_RATE_INCREASE_THRESHOLD = 1 / 3;

export class SkillQualityService {
  readonly #repository: SkillQualityRepository;
  readonly #skills: Pick<SkillRepository, 'findVersion'>;
  readonly #clock: Clock;
  readonly #ids: Readonly<{ nextObservationId(): string; nextWarningId(): string }>;

  constructor(
    dependencies: Readonly<{
      repository: SkillQualityRepository;
      skills: Pick<SkillRepository, 'findVersion'>;
      clock: Clock;
      ids: Readonly<{ nextObservationId(): string; nextWarningId(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#skills = dependencies.skills;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async record(
    input: Readonly<{
      skillId: string;
      skillVersion: number;
      evaluationRef: string;
      score: number;
      successful: boolean;
    }>,
  ): Promise<
    Readonly<{ observation: SkillQualityObservation; warnings: readonly SkillQualityWarning[] }>
  > {
    if (!Number.isFinite(input.score) || input.score < 0 || input.score > 1)
      throw new Error('SKILL_QUALITY_SCORE_INVALID');
    const skill = await this.#skills.findVersion(input.skillId, input.skillVersion);
    if (skill === undefined) throw new Error('SKILL_VERSION_NOT_FOUND');
    const observation: SkillQualityObservation = {
      observationId: this.#ids.nextObservationId(),
      skillId: input.skillId,
      skillVersion: input.skillVersion,
      evaluationRef: input.evaluationRef,
      score: input.score,
      successful: input.successful,
      createdAt: this.#clock.now(),
    };
    await this.#repository.saveObservation(observation);
    const recent = await this.#repository.listRecentObservations(
      input.skillId,
      input.skillVersion,
      WINDOW_SIZE * 2,
    );
    const triggers = warningTriggers(recent);
    const warnings: SkillQualityWarning[] = [];
    for (const trigger of triggers) {
      const existing = await this.#repository.findActiveWarning(
        input.skillId,
        input.skillVersion,
        trigger.kind,
      );
      if (existing !== undefined) {
        warnings.push(existing);
        continue;
      }
      const warning: SkillQualityWarning = {
        warningId: this.#ids.nextWarningId(),
        skillId: input.skillId,
        skillVersion: input.skillVersion,
        kind: trigger.kind,
        observationIds: trigger.observations.map((item) => item.observationId),
        observedValue: trigger.observedValue,
        threshold: trigger.threshold,
        summary: trigger.summary,
        status: 'active',
        skillStatusAtCreation: skill.status,
        createdAt: this.#clock.now(),
      };
      await this.#repository.saveWarning(warning);
      warnings.push(warning);
    }
    return { observation, warnings };
  }

  listWarnings(skillId?: string): Promise<readonly SkillQualityWarning[]> {
    return this.#repository.listWarnings(skillId);
  }
}

function warningTriggers(observations: readonly SkillQualityObservation[]): readonly Readonly<{
  kind: SkillQualityWarningKind;
  observations: readonly SkillQualityObservation[];
  observedValue: number;
  threshold: number;
  summary: string;
}>[] {
  const latest = observations.slice(0, WINDOW_SIZE);
  const triggers: {
    kind: SkillQualityWarningKind;
    observations: readonly SkillQualityObservation[];
    observedValue: number;
    threshold: number;
    summary: string;
  }[] = [];
  if (latest.length === WINDOW_SIZE && latest.every((item) => item.score <= LOW_SCORE_THRESHOLD)) {
    const average = latest.reduce((sum, item) => sum + item.score, 0) / WINDOW_SIZE;
    triggers.push({
      kind: 'consecutive_low_score',
      observations: latest,
      observedValue: average,
      threshold: LOW_SCORE_THRESHOLD,
      summary: 'Three consecutive Skill quality scores are at or below the warning threshold.',
    });
  }
  const previous = observations.slice(WINDOW_SIZE, WINDOW_SIZE * 2);
  if (latest.length === WINDOW_SIZE && previous.length === WINDOW_SIZE) {
    const latestFailureRate = latest.filter((item) => !item.successful).length / WINDOW_SIZE;
    const previousFailureRate = previous.filter((item) => !item.successful).length / WINDOW_SIZE;
    if (
      latestFailureRate >= 0.5 &&
      latestFailureRate - previousFailureRate >= FAILURE_RATE_INCREASE_THRESHOLD
    )
      triggers.push({
        kind: 'failure_rate_increase',
        observations: [...latest, ...previous],
        observedValue: latestFailureRate - previousFailureRate,
        threshold: FAILURE_RATE_INCREASE_THRESHOLD,
        summary: 'The recent Skill failure rate increased materially over the preceding window.',
      });
  }
  return triggers;
}
