import {
  assertIdentifier,
  assertPositiveVersion,
  assertTimestamp,
  type COGNITIVE_SCHEMA_VERSION,
} from './common.js';
import { CognitiveDomainError } from './errors.js';

export type InteractiveSessionKind = 'goal' | 'planning';
export type InteractiveSessionState =
  | 'understand'
  | 'goal_review'
  | 'plan_review'
  | 'confirmed'
  | 'rejected'
  | 'canceled'
  | 'budget_exhausted';

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
