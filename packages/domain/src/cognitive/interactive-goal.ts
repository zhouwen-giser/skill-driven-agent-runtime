import {
  assertIdentifier,
  assertPositiveVersion,
  assertSha256,
  assertTimestamp,
  createCognitiveSourceRef,
  freezeStrings,
  type COGNITIVE_SCHEMA_VERSION,
  type CognitiveSourceRef,
} from './common.js';
import { CognitiveDomainError } from './errors.js';

export type InteractiveGoalSessionState =
  'understand' | 'goal_review' | 'confirmed' | 'rejected' | 'canceled' | 'budget_exhausted';
export type InteractiveGoalAction =
  'answer' | 'accept' | 'patch' | 'reject' | 'restart_understanding' | 'cancel';
export type GoalContractCandidateStatus = 'candidate' | 'confirmed' | 'rejected' | 'superseded';

export interface CandidateUserGoalCompletionContract {
  readonly title: string;
  readonly description: string;
  readonly constraints: readonly string[];
  readonly successCriteria: readonly string[];
}

export interface GoalContractDiff {
  readonly baseRevision?: number;
  readonly changedFields: readonly ('title' | 'description' | 'constraints' | 'successCriteria')[];
}

export interface GoalContractCandidateSnapshot {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly candidateId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly status: GoalContractCandidateStatus;
  readonly contract: CandidateUserGoalCompletionContract;
  readonly contractHash: string;
  readonly diff: GoalContractDiff;
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly modelInvocationId: string;
  readonly createdAt: string;
}

export interface InteractiveGoalSessionSnapshot {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly taskId: string;
  readonly state: InteractiveGoalSessionState;
  readonly version: number;
  readonly currentUnderstandingId: string;
  readonly currentCandidateId?: string;
  readonly currentCandidateRevision?: number;
  readonly clarificationRounds: number;
  readonly revisionCount: number;
  readonly maxClarificationRounds: number;
  readonly maxRevisions: number;
  readonly maxElapsedMs: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InteractiveGoalTurnBinding {
  readonly understandingRevision: number;
  readonly dimensionId?: string;
  readonly criterionId?: string;
  readonly blockingReason?: string;
}

export interface InteractiveGoalTurn {
  readonly turnId: string;
  readonly sessionId: string;
  readonly ordinal: number;
  readonly expectedSessionVersion: number;
  readonly idempotencyKey: string;
  readonly action: InteractiveGoalAction;
  readonly actorId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly binding: InteractiveGoalTurnBinding;
  readonly createdAt: string;
}

export function createInteractiveGoalSessionSnapshot(
  input: InteractiveGoalSessionSnapshot,
): InteractiveGoalSessionSnapshot {
  assertIdentifier(input.sessionId, 'sessionId');
  assertIdentifier(input.taskId, 'taskId');
  assertIdentifier(input.currentUnderstandingId, 'currentUnderstandingId');
  assertPositiveVersion(input.version, 'version');
  assertTimestamp(input.createdAt, 'createdAt');
  assertTimestamp(input.updatedAt, 'updatedAt');
  for (const [field, value] of Object.entries({
    clarificationRounds: input.clarificationRounds,
    revisionCount: input.revisionCount,
    maxClarificationRounds: input.maxClarificationRounds,
    maxRevisions: input.maxRevisions,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) invalid(`${field} is invalid.`);
  }
  if (!Number.isSafeInteger(input.maxElapsedMs) || input.maxElapsedMs < 1) {
    invalid('maxElapsedMs is invalid.');
  }
  if (
    input.clarificationRounds > input.maxClarificationRounds ||
    input.revisionCount > input.maxRevisions
  ) {
    invalid('Interactive Goal Session budget is exceeded.');
  }
  if ((input.currentCandidateId === undefined) !== (input.currentCandidateRevision === undefined)) {
    invalid('Candidate identity and revision must be supplied together.');
  }
  if (input.currentCandidateId !== undefined) {
    assertIdentifier(input.currentCandidateId, 'currentCandidateId');
    assertPositiveVersion(input.currentCandidateRevision ?? 0, 'currentCandidateRevision');
  }
  if (
    ['goal_review', 'confirmed'].includes(input.state) &&
    input.currentCandidateId === undefined
  ) {
    invalid('Goal review and terminal candidate states require a current candidate.');
  }
  return Object.freeze({ ...input });
}

export function createGoalContractCandidateSnapshot(
  input: GoalContractCandidateSnapshot,
): GoalContractCandidateSnapshot {
  assertIdentifier(input.candidateId, 'candidateId');
  assertIdentifier(input.sessionId, 'sessionId');
  assertPositiveVersion(input.revision, 'revision');
  assertIdentifier(input.modelInvocationId, 'modelInvocationId');
  assertSha256(input.contractHash, 'contractHash');
  assertTimestamp(input.createdAt, 'createdAt');
  const title = bounded(input.contract.title, 512, 'title');
  const description = bounded(input.contract.description, 8192, 'description');
  if (input.contract.successCriteria.length === 0) invalid('Success criteria are required.');
  const changedFields = Object.freeze([...new Set(input.diff.changedFields)].sort());
  if (input.diff.baseRevision !== undefined) {
    assertPositiveVersion(input.diff.baseRevision, 'baseRevision');
  }
  return Object.freeze({
    ...input,
    contract: Object.freeze({
      title,
      description,
      constraints: freezeStrings(input.contract.constraints, 'constraints'),
      successCriteria: freezeStrings(input.contract.successCriteria, 'successCriteria'),
    }),
    diff: Object.freeze({
      ...(input.diff.baseRevision === undefined ? {} : { baseRevision: input.diff.baseRevision }),
      changedFields,
    }),
    sourceRefs: Object.freeze(input.sourceRefs.map(createCognitiveSourceRef)),
  });
}

export function createInteractiveGoalTurn(input: InteractiveGoalTurn): InteractiveGoalTurn {
  assertIdentifier(input.turnId, 'turnId');
  assertIdentifier(input.sessionId, 'sessionId');
  assertIdentifier(input.idempotencyKey, 'idempotencyKey');
  assertIdentifier(input.actorId, 'actorId');
  assertPositiveVersion(input.ordinal, 'ordinal');
  assertPositiveVersion(input.expectedSessionVersion, 'expectedSessionVersion');
  assertPositiveVersion(input.binding.understandingRevision, 'understandingRevision');
  if (input.binding.dimensionId !== undefined) {
    assertIdentifier(input.binding.dimensionId, 'dimensionId');
  }
  if (input.binding.criterionId !== undefined) {
    assertIdentifier(input.binding.criterionId, 'criterionId');
  }
  assertTimestamp(input.createdAt, 'createdAt');
  return Object.freeze({
    ...input,
    payload: Object.freeze({ ...input.payload }),
    binding: Object.freeze({ ...input.binding }),
  });
}

function bounded(value: string, maximum: number, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) invalid(`${field} is invalid.`);
  return normalized;
}

function invalid(message: string): never {
  throw new CognitiveDomainError('INTERACTIVE_SESSION_INVALID', message);
}
