import { createHash } from 'node:crypto';

import {
  COGNITIVE_SCHEMA_VERSION,
  createGoalExperienceEpisode,
  type CognitiveSourceRef,
} from '../../../domain/src/index.js';
import type { CognitiveRuntimeFactReader, GoalExperienceEpisodeRepository } from './ports.js';
import type { ExperienceEligibilityPolicy } from './experience-eligibility-policy.js';

export class ExperienceEligibilityError extends Error {
  readonly code = 'EXPERIENCE_EPISODE_INELIGIBLE';
  readonly reasonCodes: readonly string[];

  constructor(reasonCodes: readonly string[]) {
    super(`Goal Experience Episode is not eligible: ${reasonCodes.join(',')}`);
    this.name = 'ExperienceEligibilityError';
    this.reasonCodes = Object.freeze([...reasonCodes]);
  }
}

export class GoalExperienceEpisodeBuilder {
  readonly #facts: CognitiveRuntimeFactReader;
  readonly #episodes: GoalExperienceEpisodeRepository;
  readonly #eligibility: ExperienceEligibilityPolicy;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #nextEpisodeId: () => string;

  constructor(
    dependencies: Readonly<{
      facts: CognitiveRuntimeFactReader;
      episodes: GoalExperienceEpisodeRepository;
      eligibility: ExperienceEligibilityPolicy;
      clock: Readonly<{ now(): string }>;
      nextEpisodeId(): string;
    }>,
  ) {
    this.#facts = dependencies.facts;
    this.#episodes = dependencies.episodes;
    this.#eligibility = dependencies.eligibility;
    this.#clock = dependencies.clock;
    this.#nextEpisodeId = dependencies.nextEpisodeId;
  }

  async build(input: Readonly<{ goalId: string; goalVersion: number }>) {
    const facts = await this.#facts.readGoalFacts(input.goalId, input.goalVersion);
    const eligibility = this.#eligibility.evaluate(facts);
    if (!eligibility.eligible) throw new ExperienceEligibilityError(eligibility.reasonCodes);

    const task = requireRecord(facts['task'], 'task');
    const terminal = requireRecord(facts['terminalOutcome'], 'terminalOutcome');
    const sourceRefs = requireSourceRefs(facts['sourceRefs']);
    const redactionCodes = new Set<string>();
    const snapshot = redactRecord(
      Object.fromEntries(Object.entries(facts).filter(([key]) => key !== 'sourceRefs')),
      redactionCodes,
    );
    const sourceHash = hash(
      sourceRefs
        .map((source) => ({
          sourceRefId: source.sourceRefId,
          sourceKind: source.sourceKind,
          sourceId: source.sourceId,
          sourceRevision: source.sourceRevision,
          authority: source.authority,
          contentHash: source.contentHash,
        }))
        .sort((left, right) => left.sourceRefId.localeCompare(right.sourceRefId)),
    );
    const terminalOutcomeId = requireString(terminal['outcomeId'], 'terminalOutcome.outcomeId');
    const episodeHash = hash({
      goalId: input.goalId,
      goalVersion: input.goalVersion,
      episodeType: 'terminal',
      terminalOutcomeId,
      sourceHash,
      snapshot,
    });
    const prior = await this.#episodes.findByGoal(input.goalId);
    const completeness = computeCompleteness(facts);
    return createGoalExperienceEpisode({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      episodeId: this.#nextEpisodeId(),
      goalId: input.goalId,
      goalVersion: input.goalVersion,
      ...(typeof task['taskId'] === 'string' ? { taskId: task['taskId'] } : {}),
      contextId: requireString(task['contextId'], 'task.contextId'),
      episodeType: 'terminal',
      revision: Math.max(0, ...prior.map((item) => item.revision)) + 1,
      terminalOutcomeRef: `runtime-terminal-outcome:${terminalOutcomeId}`,
      sourceHash,
      episodeHash,
      completeness,
      status: completeness >= 0.8 ? 'complete' : 'partial',
      dataClassification: sourceRefs.some((source) => source.dataClassification === 'user_scoped')
        ? 'user_scoped'
        : 'internal',
      snapshot,
      sourceRefs,
      redactionCodes: [...redactionCodes],
      createdAt: this.#clock.now(),
    });
  }
}

function computeCompleteness(facts: Readonly<Record<string, unknown>>): number {
  const optional = [
    'planRevisions',
    'attempts',
    'outcomes',
    'progress',
    'recovery',
    'eventImpacts',
    'interactions',
  ];
  const present = optional.filter(
    (key) => Array.isArray(facts[key]) && facts[key].length > 0,
  ).length;
  return Number((0.65 + (present / optional.length) * 0.35).toFixed(4));
}

function redactRecord(
  input: Readonly<Record<string, unknown>>,
  codes: Set<string>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => {
      if (/credential|password|secret|token|authorization|api[_-]?key/iu.test(key)) {
        codes.add('credentials_excluded');
        return [];
      }
      if (/private[_-]?reasoning|chain[_-]?of[_-]?thought|reasoning[_-]?content/iu.test(key)) {
        codes.add('private_reasoning_excluded');
        return [];
      }
      if (/^(?:email|phone|address|fullName|userId)$/iu.test(key)) {
        codes.add('unnecessary_pii_excluded');
        return [];
      }
      return [[key, redactValue(value, codes)]];
    }),
  );
}

function redactValue(value: unknown, codes: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, codes));
  if (typeof value === 'object' && value !== null) {
    return redactRecord(value as Readonly<Record<string, unknown>>, codes);
  }
  if (typeof value === 'string') return redactText(value, codes);
  return value;
}

function redactText(value: string, codes: Set<string>): string {
  let redacted = value.replace(
    /\b(credential|password|secret|token|authorization|api[_ -]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|Bearer\s+[^\s,;]+|[^\s,;]+)/giu,
    (_match, label: string) => {
      codes.add('credentials_excluded');
      return `${label}=[REDACTED]`;
    },
  );
  redacted = redacted.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, () => {
    codes.add('credentials_excluded');
    return 'Bearer [REDACTED]';
  });
  redacted = redacted.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/giu,
    (_match, scheme: string) => {
      codes.add('credentials_excluded');
      return `${scheme}[REDACTED]@`;
    },
  );
  redacted = redacted.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, () => {
    codes.add('unnecessary_pii_excluded');
    return '[REDACTED_EMAIL]';
  });
  return redacted;
}

function requireSourceRefs(value: unknown): readonly CognitiveSourceRef[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ExperienceEligibilityError(['missing_source_refs']);
  }
  return value as readonly CognitiveSourceRef[];
}

function requireRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExperienceEligibilityError([`invalid_${field}`]);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExperienceEligibilityError([`invalid_${field}`]);
  }
  return value;
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('EXPERIENCE_NON_FINITE_JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error('EXPERIENCE_NON_JSON_VALUE');
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
