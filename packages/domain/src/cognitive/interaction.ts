import {
  assertIdentifier,
  assertPositiveVersion,
  assertSha256,
  assertTimestamp,
  freezeStrings,
  type COGNITIVE_SCHEMA_VERSION,
  type CognitiveSourceRef,
} from './common.js';
import { CognitiveDomainError } from './errors.js';

export type MissingDimensionKind =
  | 'target'
  | 'scope'
  | 'time_range'
  | 'criteria'
  | 'artifact'
  | 'evidence'
  | 'side_effect_authorization';
export type MissingDimensionSeverity = 'blocking' | 'conditional' | 'non_blocking';
export type TaskUnderstandingDisposition =
  'clarification_required' | 'confirmation_required' | 'contract_candidate' | 'rejected';
export type InteractiveSessionKind = 'goal' | 'planning';
export type InteractiveSessionState =
  | 'understand'
  | 'goal_review'
  | 'plan_review'
  | 'confirmed'
  | 'rejected'
  | 'canceled'
  | 'budget_exhausted';

export interface MissingDimension {
  readonly dimensionId: string;
  readonly kind: MissingDimensionKind;
  readonly severity: MissingDimensionSeverity;
  readonly question: string;
  readonly answered: boolean;
  readonly authorizationSensitive: boolean;
}

export interface GenericTaskUnderstandingRevision {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly understandingId: string;
  readonly taskId: string;
  readonly revision: number;
  readonly disposition: TaskUnderstandingDisposition;
  readonly objective: string;
  readonly knownConstraints: readonly string[];
  readonly assumptions: readonly string[];
  readonly missingDimensions: readonly MissingDimension[];
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly policyVersion: string;
  readonly stateHash: string;
  readonly createdAt: string;
}

export interface InteractiveSessionSnapshot {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly taskId: string;
  readonly kind: InteractiveSessionKind;
  readonly state: InteractiveSessionState;
  readonly version: number;
  readonly currentCandidateId?: string;
  readonly currentCandidateRevision?: number;
  readonly clarificationRounds: number;
  readonly revisionCount: number;
  readonly maxClarificationRounds: number;
  readonly maxRevisions: number;
  readonly idempotencyKeys: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createGenericTaskUnderstandingRevision(
  input: GenericTaskUnderstandingRevision,
): GenericTaskUnderstandingRevision {
  assertIdentifier(input.understandingId, 'understandingId');
  assertIdentifier(input.taskId, 'taskId');
  assertPositiveVersion(input.revision, 'revision');
  assertIdentifier(input.policyVersion, 'policyVersion');
  assertSha256(input.stateHash, 'stateHash');
  assertTimestamp(input.createdAt, 'createdAt');
  const objective = input.objective.trim();
  if (objective.length === 0 || objective.length > 8192) {
    throw new CognitiveDomainError('TASK_UNDERSTANDING_INVALID', 'Objective is invalid.');
  }
  const dimensionIds = new Set<string>();
  const missingDimensions = input.missingDimensions.map((dimension) => {
    assertIdentifier(dimension.dimensionId, 'dimensionId');
    if (dimensionIds.has(dimension.dimensionId)) {
      throw new CognitiveDomainError(
        'TASK_UNDERSTANDING_INVALID',
        'Missing dimension identifiers must be unique.',
      );
    }
    dimensionIds.add(dimension.dimensionId);
    const question = dimension.question.trim();
    if (question.length === 0 || question.length > 2048) {
      throw new CognitiveDomainError('TASK_UNDERSTANDING_INVALID', 'Question is invalid.');
    }
    return Object.freeze({ ...dimension, question });
  });
  return Object.freeze({
    ...input,
    objective,
    knownConstraints: freezeStrings(input.knownConstraints, 'knownConstraints'),
    assumptions: Object.freeze(input.assumptions.map((value) => value.trim()).filter(Boolean)),
    missingDimensions: Object.freeze(missingDimensions),
    sourceRefs: Object.freeze([...input.sourceRefs]),
  });
}

export function createInteractiveSessionSnapshot(
  input: InteractiveSessionSnapshot,
): InteractiveSessionSnapshot {
  assertIdentifier(input.sessionId, 'sessionId');
  assertIdentifier(input.taskId, 'taskId');
  assertPositiveVersion(input.version, 'version');
  assertTimestamp(input.createdAt, 'createdAt');
  assertTimestamp(input.updatedAt, 'updatedAt');
  for (const [field, value] of Object.entries({
    clarificationRounds: input.clarificationRounds,
    revisionCount: input.revisionCount,
    maxClarificationRounds: input.maxClarificationRounds,
    maxRevisions: input.maxRevisions,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new CognitiveDomainError('INTERACTIVE_SESSION_INVALID', `${field} is invalid.`);
    }
  }
  if (
    input.clarificationRounds > input.maxClarificationRounds ||
    input.revisionCount > input.maxRevisions
  ) {
    throw new CognitiveDomainError(
      'INTERACTIVE_SESSION_INVALID',
      'Interactive session budget is exceeded.',
    );
  }
  if ((input.currentCandidateId === undefined) !== (input.currentCandidateRevision === undefined)) {
    throw new CognitiveDomainError(
      'INTERACTIVE_SESSION_INVALID',
      'Candidate identity and revision must be supplied together.',
    );
  }
  if (input.currentCandidateId !== undefined) {
    assertIdentifier(input.currentCandidateId, 'currentCandidateId');
    assertPositiveVersion(input.currentCandidateRevision ?? 0, 'currentCandidateRevision');
  }
  return Object.freeze({ ...input, idempotencyKeys: Object.freeze([...input.idempotencyKeys]) });
}
