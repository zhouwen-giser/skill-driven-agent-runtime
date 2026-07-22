import {
  assertIdentifier,
  assertPositiveVersion,
  assertSha256,
  assertTimestamp,
  type COGNITIVE_SCHEMA_VERSION,
  type CognitiveDataClassification,
  type CognitiveSourceRef,
} from './common.js';
import { CognitiveDomainError } from './errors.js';

export type ExperienceJobStatus = 'pending' | 'leased' | 'retry_wait' | 'completed' | 'dead_letter';
export type ExperienceStatementKind =
  'fact' | 'inference' | 'candidate_lesson' | 'uncertainty' | 'contradiction';

export interface GoalExperienceEpisode {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly episodeId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly revision: number;
  readonly episodeHash: string;
  readonly completeness: number;
  readonly dataClassification: CognitiveDataClassification;
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly redactionCodes: readonly string[];
  readonly createdAt: string;
}

export interface ExperienceObservationStatement {
  readonly statementId: string;
  readonly kind: ExperienceStatementKind;
  readonly summary: string;
  readonly confidence: number;
  readonly sourceRefIds: readonly string[];
}

export function createGoalExperienceEpisode(input: GoalExperienceEpisode): GoalExperienceEpisode {
  assertIdentifier(input.episodeId, 'episodeId');
  assertIdentifier(input.goalId, 'goalId');
  assertPositiveVersion(input.goalVersion, 'goalVersion');
  assertPositiveVersion(input.revision, 'revision');
  assertSha256(input.episodeHash, 'episodeHash');
  assertTimestamp(input.createdAt, 'createdAt');
  if (!Number.isFinite(input.completeness) || input.completeness < 0 || input.completeness > 1) {
    throw new CognitiveDomainError(
      'EXPERIENCE_EPISODE_INVALID',
      'Episode completeness must be between zero and one.',
    );
  }
  if (input.sourceRefs.length === 0) {
    throw new CognitiveDomainError(
      'EXPERIENCE_EPISODE_INVALID',
      'An Experience Episode requires persisted source facts.',
    );
  }
  return Object.freeze({
    ...input,
    sourceRefs: Object.freeze([...input.sourceRefs]),
    redactionCodes: Object.freeze([...input.redactionCodes]),
  });
}
