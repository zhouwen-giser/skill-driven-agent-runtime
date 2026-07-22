import {
  assertIdentifier,
  assertPositiveVersion,
  assertSha256,
  assertTimestamp,
} from './common.js';
import type { CognitiveSourceRef } from './common.js';
import { CognitiveDomainError } from './errors.js';

export type InteractivePlanningState =
  'plan_review' | 'confirmed' | 'rejected' | 'canceled' | 'budget_exhausted';
export type InteractivePlanningAction = 'accept' | 'patch' | 'reject' | 'cancel';
export type PlanConfirmationPolicy =
  'manual_all' | 'manual_risky' | 'auto_validated' | 'never_auto';
export type PlanCandidateStatus = 'candidate' | 'confirmed' | 'rejected' | 'superseded';

export interface PlanValidationCheck {
  readonly check:
    'dag' | 'bounds' | 'coverage' | 'capability_shape' | 'policy' | 'side_effect' | 'no_replay';
  readonly passed: boolean;
  readonly errorCode?: string;
}

export interface UserGoalPlanCandidateValidation {
  readonly valid: boolean;
  readonly errorCodes: readonly string[];
  readonly checks: readonly PlanValidationCheck[];
}

export interface UserGoalPlanCandidateDiff {
  readonly changedFields: readonly (
    'skillGoals' | 'dependencies' | 'confirmationPolicy' | 'planningMetadata'
  )[];
  readonly addedSkillGoalIds: readonly string[];
  readonly removedSkillGoalIds: readonly string[];
}

export interface InteractivePlanningMetadata {
  readonly priorities: Readonly<Record<string, number>>;
  readonly parallelGroups: Readonly<Record<string, readonly string[]>>;
}

export interface UserGoalPlanCandidateSnapshot<TPlan = unknown> {
  readonly schemaVersion: '1.0';
  readonly candidateId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly status: PlanCandidateStatus;
  readonly basePlanId?: string;
  readonly plan: TPlan;
  readonly planHash: string;
  readonly validation: UserGoalPlanCandidateValidation;
  readonly diff: UserGoalPlanCandidateDiff;
  readonly experienceHints: readonly string[];
  readonly confirmationPolicy: PlanConfirmationPolicy;
  readonly riskLevel: 'low' | 'high';
  readonly planningMetadata: InteractivePlanningMetadata;
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly patchModelInvocationId?: string;
  readonly createdAt: string;
}

export interface InteractivePlanningSessionSnapshot {
  readonly schemaVersion: '1.0';
  readonly sessionId: string;
  readonly taskId: string;
  readonly goalSessionId: string;
  readonly confirmedContractCandidateId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly state: InteractivePlanningState;
  readonly version: number;
  readonly currentCandidateId: string;
  readonly currentCandidateRevision: number;
  readonly revisionCount: number;
  readonly maxRevisions: number;
  readonly maxElapsedMs: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InteractivePlanningTurn {
  readonly turnId: string;
  readonly sessionId: string;
  readonly ordinal: number;
  readonly expectedSessionVersion: number;
  readonly idempotencyKey: string;
  readonly action: InteractivePlanningAction;
  readonly actorId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly compiledPatch?: unknown;
  readonly createdAt: string;
}

export function createUserGoalPlanCandidateSnapshot<TPlan>(
  input: UserGoalPlanCandidateSnapshot<TPlan>,
): UserGoalPlanCandidateSnapshot<TPlan> {
  if (!isRecord(input.plan)) invalid('Candidate plan snapshot must be an object.');
  const planId = input.plan['planId'];
  const contentHash = input.plan['contentHash'];
  if (typeof planId !== 'string' || typeof contentHash !== 'string')
    invalid('Candidate plan identity and content hash are required.');
  for (const [value, field] of [
    [input.candidateId, 'candidateId'],
    [input.sessionId, 'sessionId'],
    [planId, 'planId'],
  ] as const) {
    assertIdentifier(value, field);
  }
  if (input.basePlanId !== undefined) assertIdentifier(input.basePlanId, 'basePlanId');
  if (input.patchModelInvocationId !== undefined)
    assertIdentifier(input.patchModelInvocationId, 'patchModelInvocationId');
  assertPositiveVersion(input.revision, 'revision');
  assertSha256(input.planHash, 'planHash');
  assertTimestamp(input.createdAt, 'createdAt');
  if (contentHash !== input.planHash)
    invalid('Candidate plan hash must equal the validated User Goal Plan content hash.');
  if (input.status === 'confirmed' && !input.validation.valid)
    invalid('An invalid plan candidate cannot be confirmed.');
  if (input.experienceHints.some((hint) => hint.trim() === '' || hint.length > 2048))
    invalid('Experience hints must be bounded display-only strings.');
  for (const priority of Object.values(input.planningMetadata.priorities)) {
    if (!Number.isSafeInteger(priority) || priority < 0 || priority > 100)
      invalid('Planning priority must be an integer between 0 and 100.');
  }
  return Object.freeze({
    ...input,
    validation: Object.freeze({
      valid: input.validation.valid,
      errorCodes: Object.freeze([...input.validation.errorCodes]),
      checks: Object.freeze(input.validation.checks.map((check) => Object.freeze({ ...check }))),
    }),
    diff: Object.freeze({
      changedFields: Object.freeze([...input.diff.changedFields]),
      addedSkillGoalIds: Object.freeze([...input.diff.addedSkillGoalIds]),
      removedSkillGoalIds: Object.freeze([...input.diff.removedSkillGoalIds]),
    }),
    experienceHints: Object.freeze([...input.experienceHints]),
    planningMetadata: Object.freeze({
      priorities: Object.freeze({ ...input.planningMetadata.priorities }),
      parallelGroups: Object.freeze(
        Object.fromEntries(
          Object.entries(input.planningMetadata.parallelGroups).map(([key, values]) => [
            key,
            Object.freeze([...values]),
          ]),
        ),
      ),
    }),
    sourceRefs: Object.freeze([...input.sourceRefs]),
  });
}

export function createInteractivePlanningSessionSnapshot(
  input: InteractivePlanningSessionSnapshot,
): InteractivePlanningSessionSnapshot {
  for (const [value, field] of [
    [input.sessionId, 'sessionId'],
    [input.taskId, 'taskId'],
    [input.goalSessionId, 'goalSessionId'],
    [input.confirmedContractCandidateId, 'confirmedContractCandidateId'],
    [input.goalId, 'goalId'],
    [input.currentCandidateId, 'currentCandidateId'],
  ] as const) {
    assertIdentifier(value, field);
  }
  for (const [value, field] of [
    [input.goalVersion, 'goalVersion'],
    [input.version, 'version'],
    [input.currentCandidateRevision, 'currentCandidateRevision'],
  ] as const) {
    assertPositiveVersion(value, field);
  }
  if (
    !Number.isSafeInteger(input.revisionCount) ||
    !Number.isSafeInteger(input.maxRevisions) ||
    input.revisionCount < 1 ||
    input.revisionCount > input.maxRevisions ||
    !Number.isSafeInteger(input.maxElapsedMs) ||
    input.maxElapsedMs < 1
  ) {
    invalid('Interactive planning budgets are invalid.');
  }
  assertTimestamp(input.createdAt, 'createdAt');
  assertTimestamp(input.updatedAt, 'updatedAt');
  return Object.freeze({ ...input });
}

export function createInteractivePlanningTurn(
  input: InteractivePlanningTurn,
): InteractivePlanningTurn {
  for (const [value, field] of [
    [input.turnId, 'turnId'],
    [input.sessionId, 'sessionId'],
    [input.idempotencyKey, 'idempotencyKey'],
    [input.actorId, 'actorId'],
  ] as const) {
    assertIdentifier(value, field);
  }
  assertPositiveVersion(input.ordinal, 'ordinal');
  assertPositiveVersion(input.expectedSessionVersion, 'expectedSessionVersion');
  assertTimestamp(input.createdAt, 'createdAt');
  return Object.freeze({ ...input, payload: Object.freeze({ ...input.payload }) });
}

function invalid(message: string): never {
  throw new CognitiveDomainError('INTERACTIVE_SESSION_INVALID', message);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
