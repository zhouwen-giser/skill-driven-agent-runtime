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
export type ExperienceJobType = 'episode' | 'observe' | 'reflect' | 'induce' | 'revalidate';
export type GoalExperienceEpisodeType = 'terminal' | 'revision' | 'interaction' | 'recovery';
export type GoalExperienceEpisodeStatus = 'partial' | 'complete';
export type ExperienceStatementKind =
  'fact' | 'inference' | 'candidate_lesson' | 'uncertainty' | 'contradiction';

export interface ExperienceJob {
  readonly jobId: string;
  readonly jobType: ExperienceJobType;
  readonly subjectId: string;
  readonly status: ExperienceJobStatus;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly availableAt: string;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: string;
  readonly idempotencyKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly resultRef?: string;
  readonly lastErrorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExperienceDeadLetter {
  readonly deadLetterId: string;
  readonly jobId: string;
  readonly errorCode: string;
  readonly errorSummary: string;
  readonly failedAt: string;
  readonly replayedAt?: string;
  readonly replayedBy?: string;
}

export interface GoalExperienceEpisode {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly episodeId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly taskId?: string;
  readonly contextId: string;
  readonly episodeType: GoalExperienceEpisodeType;
  readonly revision: number;
  readonly terminalOutcomeRef: string;
  readonly sourceHash: string;
  readonly episodeHash: string;
  readonly completeness: number;
  readonly status: GoalExperienceEpisodeStatus;
  readonly dataClassification: CognitiveDataClassification;
  readonly snapshot: Readonly<Record<string, unknown>>;
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
  if (input.taskId !== undefined) assertIdentifier(input.taskId, 'taskId');
  assertIdentifier(input.contextId, 'contextId');
  assertPositiveVersion(input.goalVersion, 'goalVersion');
  assertPositiveVersion(input.revision, 'revision');
  if (!['terminal', 'revision', 'interaction', 'recovery'].includes(input.episodeType)) {
    throw new CognitiveDomainError('EXPERIENCE_EPISODE_INVALID', 'Unknown Episode type.');
  }
  if (input.terminalOutcomeRef.length === 0 || input.terminalOutcomeRef.length > 256) {
    throw new CognitiveDomainError(
      'EXPERIENCE_EPISODE_INVALID',
      'Episode terminal Outcome reference is invalid.',
    );
  }
  assertSha256(input.sourceHash, 'sourceHash');
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
  if (!['partial', 'complete'].includes(input.status)) {
    throw new CognitiveDomainError('EXPERIENCE_EPISODE_INVALID', 'Unknown Episode status.');
  }
  return Object.freeze({
    ...input,
    snapshot: freezeJsonObject(input.snapshot),
    sourceRefs: Object.freeze([...input.sourceRefs]),
    redactionCodes: Object.freeze([...new Set(input.redactionCodes)].sort()),
  });
}

export function createExperienceJob(input: ExperienceJob): ExperienceJob {
  assertIdentifier(input.jobId, 'jobId');
  assertIdentifier(input.subjectId, 'subjectId');
  assertIdentifier(input.idempotencyKey, 'idempotencyKey');
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 0) {
    throw new CognitiveDomainError('EXPERIENCE_JOB_INVALID', 'Job attempt must be non-negative.');
  }
  if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) {
    throw new CognitiveDomainError('EXPERIENCE_JOB_INVALID', 'Job maxAttempts must be positive.');
  }
  assertTimestamp(input.availableAt, 'availableAt');
  assertTimestamp(input.createdAt, 'createdAt');
  assertTimestamp(input.updatedAt, 'updatedAt');
  if ((input.leaseOwner === undefined) !== (input.leaseExpiresAt === undefined)) {
    throw new CognitiveDomainError('EXPERIENCE_JOB_INVALID', 'Job lease fields must be paired.');
  }
  if (input.status === 'leased' && input.leaseOwner === undefined) {
    throw new CognitiveDomainError(
      'EXPERIENCE_JOB_INVALID',
      'A leased job requires a lease owner.',
    );
  }
  if (input.leaseExpiresAt !== undefined) assertTimestamp(input.leaseExpiresAt, 'leaseExpiresAt');
  return Object.freeze({ ...input, payload: freezeJsonObject(input.payload) });
}

export function createExperienceDeadLetter(input: ExperienceDeadLetter): ExperienceDeadLetter {
  assertIdentifier(input.deadLetterId, 'deadLetterId');
  assertIdentifier(input.jobId, 'jobId');
  assertTimestamp(input.failedAt, 'failedAt');
  if (input.replayedAt !== undefined) assertTimestamp(input.replayedAt, 'replayedAt');
  if (input.errorCode.length === 0 || input.errorSummary.length === 0) {
    throw new CognitiveDomainError(
      'EXPERIENCE_JOB_INVALID',
      'Dead-letter error evidence is required.',
    );
  }
  return Object.freeze({ ...input });
}

function freezeJsonObject(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return freezeJson(value) as Readonly<Record<string, unknown>>;
}

function freezeJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CognitiveDomainError('EXPERIENCE_EPISODE_INVALID', 'Episode JSON must be finite.');
    }
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (typeof value === 'object') {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CognitiveDomainError(
        'EXPERIENCE_EPISODE_INVALID',
        'Episode JSON must be plain data.',
      );
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .map(([key, item]) => [key, freezeJson(item)]),
      ),
    );
  }
  throw new CognitiveDomainError('EXPERIENCE_EPISODE_INVALID', 'Episode JSON must be plain data.');
}
