import {
  assertIdentifier,
  assertPositiveVersion,
  assertSha256,
  assertTimestamp,
  type COGNITIVE_SCHEMA_VERSION,
} from './common.js';
import { CognitiveDomainError } from './errors.js';
import type { ExperienceObservationStatement, ExperienceStatementKind } from './experience.js';

export const EXPERIENCE_EXTRACTOR_KINDS = Object.freeze([
  'goal_pattern',
  'task_type_signal',
  'decomposition',
  'dependency',
  'criterion',
  'evidence',
  'artifact',
  'capability',
  'failure',
  'recovery',
  'no_progress',
  'human_correction',
] as const);

export type ExperienceExtractorKind = (typeof EXPERIENCE_EXTRACTOR_KINDS)[number];
export type ExperienceExtractionStatus = 'completed' | 'no_op' | 'failed';
export type ExperienceObservationStatus = 'partial' | 'completed' | 'failed';
export type ExperienceObservationScope =
  'goal_episode' | 'planning_interaction' | 'cross_episode_batch';
export type ExperienceChangeSuggestionAction =
  'create_candidate' | 'create_revision' | 'suggest_supersede' | 'suggest_reject' | 'no_change';

export interface ExperienceChangeSuggestion {
  readonly action: ExperienceChangeSuggestionAction;
  readonly summary: string;
  readonly sourceRefIds: readonly string[];
}

export interface ExperienceExtraction {
  readonly extractionId: string;
  readonly observationId: string;
  readonly extractorKind: ExperienceExtractorKind;
  readonly status: ExperienceExtractionStatus;
  readonly modelTier: 'fast' | 'reasoning';
  readonly sourceEpisodeIds: readonly string[];
  readonly statements: readonly ExperienceObservationStatement[];
  readonly changeSuggestions: readonly ExperienceChangeSuggestion[];
  readonly modelInvocationId?: string;
  readonly errorCode?: string;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly createdAt: string;
}

export interface ExperienceObservation {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly observationId: string;
  readonly scope: ExperienceObservationScope;
  readonly sourceEpisodeIds: readonly string[];
  readonly revision: number;
  readonly status: ExperienceObservationStatus;
  readonly statements: readonly ExperienceObservationStatement[];
  readonly extractions: readonly ExperienceExtraction[];
  readonly modelInvocationRefs: readonly string[];
  readonly observationHash: string;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export function createExperienceObservationStatement(
  input: ExperienceObservationStatement,
): ExperienceObservationStatement {
  assertIdentifier(input.statementId, 'statementId');
  if (!statementKinds.includes(input.kind)) invalid('Unknown Observation statement kind.');
  if (input.summary.trim().length === 0 || input.summary.length > 4096) {
    invalid('Observation statement summary must contain 1 to 4096 characters.');
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    invalid('Observation statement confidence must be between zero and one.');
  }
  if (input.sourceRefIds.length === 0) invalid('Observation statements require source references.');
  for (const sourceRefId of input.sourceRefIds) assertIdentifier(sourceRefId, 'sourceRefId');
  return Object.freeze({
    ...input,
    summary: input.summary.trim(),
    sourceRefIds: Object.freeze([...new Set(input.sourceRefIds)].sort()),
  });
}

export function createExperienceExtraction(input: ExperienceExtraction): ExperienceExtraction {
  assertIdentifier(input.extractionId, 'extractionId');
  assertIdentifier(input.observationId, 'observationId');
  if (!EXPERIENCE_EXTRACTOR_KINDS.includes(input.extractorKind)) {
    invalid('Unknown Experience extractor kind.');
  }
  if (!['completed', 'no_op', 'failed'].includes(input.status))
    invalid('Invalid extraction status.');
  if (!['fast', 'reasoning'].includes(input.modelTier)) invalid('Invalid extraction model tier.');
  if (input.sourceEpisodeIds.length === 0 || input.sourceEpisodeIds.length > 8) {
    invalid('Extraction source Episode count must be between one and eight.');
  }
  for (const episodeId of input.sourceEpisodeIds) assertIdentifier(episodeId, 'sourceEpisodeId');
  if (input.modelInvocationId !== undefined)
    assertIdentifier(input.modelInvocationId, 'modelInvocationId');
  if (input.status === 'failed' && input.errorCode === undefined) {
    invalid('A failed extraction requires an error code.');
  }
  if (input.status !== 'failed' && input.errorCode !== undefined) {
    invalid('Only failed extractions may contain an error code.');
  }
  if (input.status === 'completed' && input.statements.length === 0) {
    invalid('A completed extraction requires at least one statement.');
  }
  if (input.status !== 'completed' && input.statements.length > 0) {
    invalid('No-op and failed extractions cannot contain statements.');
  }
  if (!Number.isSafeInteger(input.inputBytes) || input.inputBytes < 0) {
    invalid('Extraction input byte count is invalid.');
  }
  if (!Number.isSafeInteger(input.outputBytes) || input.outputBytes < 0) {
    invalid('Extraction output byte count is invalid.');
  }
  assertTimestamp(input.createdAt, 'createdAt');
  return Object.freeze({
    ...input,
    sourceEpisodeIds: Object.freeze([...new Set(input.sourceEpisodeIds)]),
    statements: Object.freeze(input.statements.map(createExperienceObservationStatement)),
    changeSuggestions: Object.freeze(input.changeSuggestions.map(createChangeSuggestion)),
  });
}

export function createExperienceObservation(input: ExperienceObservation): ExperienceObservation {
  assertIdentifier(input.observationId, 'observationId');
  assertPositiveVersion(input.revision, 'revision');
  if (!['goal_episode', 'planning_interaction', 'cross_episode_batch'].includes(input.scope)) {
    invalid('Invalid Observation scope.');
  }
  if (input.sourceEpisodeIds.length === 0 || input.sourceEpisodeIds.length > 8) {
    invalid('Observation source Episode count must be between one and eight.');
  }
  for (const episodeId of input.sourceEpisodeIds) assertIdentifier(episodeId, 'sourceEpisodeId');
  if (!['partial', 'completed', 'failed'].includes(input.status))
    invalid('Invalid Observation status.');
  assertSha256(input.observationHash, 'observationHash');
  assertTimestamp(input.createdAt, 'createdAt');
  for (const invocationId of input.modelInvocationRefs)
    assertIdentifier(invocationId, 'modelInvocationRef');
  const extractions = input.extractions.map(createExperienceExtraction);
  if (extractions.some((item) => item.observationId !== input.observationId)) {
    invalid('Extraction and Observation identities do not match.');
  }
  return Object.freeze({
    ...input,
    sourceEpisodeIds: Object.freeze([...new Set(input.sourceEpisodeIds)]),
    statements: Object.freeze(input.statements.map(createExperienceObservationStatement)),
    extractions: Object.freeze(extractions),
    modelInvocationRefs: Object.freeze([...new Set(input.modelInvocationRefs)]),
    summary: freezeJsonObject(input.summary),
  });
}

function createChangeSuggestion(input: ExperienceChangeSuggestion): ExperienceChangeSuggestion {
  if (
    ![
      'create_candidate',
      'create_revision',
      'suggest_supersede',
      'suggest_reject',
      'no_change',
    ].includes(input.action)
  ) {
    invalid('Invalid Experience change suggestion action.');
  }
  if (input.summary.trim().length === 0 || input.summary.length > 4096) {
    invalid('Experience change suggestion summary is invalid.');
  }
  if (input.sourceRefIds.length === 0) {
    invalid('Experience change suggestions require source references.');
  }
  for (const sourceRefId of input.sourceRefIds) assertIdentifier(sourceRefId, 'sourceRefId');
  return Object.freeze({
    ...input,
    summary: input.summary.trim(),
    sourceRefIds: Object.freeze([...new Set(input.sourceRefIds)].sort()),
  });
}

function freezeJsonObject(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return freezeJson(value) as Readonly<Record<string, unknown>>;
}

function freezeJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('Observation JSON must be finite.');
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (typeof value === 'object') {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalid('Observation JSON must be plain data.');
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .map(([key, item]) => [key, freezeJson(item)]),
      ),
    );
  }
  invalid('Observation JSON must be plain data.');
}

function invalid(message: string): never {
  throw new CognitiveDomainError('EXPERIENCE_OBSERVATION_INVALID', message);
}

const statementKinds: readonly ExperienceStatementKind[] = Object.freeze([
  'fact',
  'inference',
  'candidate_lesson',
  'uncertainty',
  'contradiction',
]);
