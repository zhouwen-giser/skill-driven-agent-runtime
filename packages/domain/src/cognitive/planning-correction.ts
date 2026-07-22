import {
  assertIdentifier,
  assertPositiveVersion,
  assertSha256,
  assertTimestamp,
  createCognitiveSourceRef,
  type COGNITIVE_SCHEMA_VERSION,
  type CognitiveScope,
  type CognitiveSourceRef,
} from './common.js';
import { CognitiveDomainError } from './errors.js';

export type PlanningCorrectionTarget = 'task_understanding' | 'goal_contract' | 'skill_goal_plan';

export type PlanningCorrectionType =
  | 'missing_target'
  | 'missing_scope'
  | 'missing_criterion'
  | 'missing_artifact'
  | 'missing_evidence'
  | 'missing_capability'
  | 'wrong_decomposition'
  | 'wrong_dependency'
  | 'wrong_priority'
  | 'unsafe_side_effect'
  | 'unnecessary_goal'
  | 'parallelism_correction'
  | 'degradation_correction';

export type PlanningPreferenceCategory =
  | 'display'
  | 'interaction'
  | 'report_format'
  | 'detailed_plan'
  | 'parallel_explanation'
  | 'time_expression'
  | 'language';

export interface PlanningCorrectionFact {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly correctionId: string;
  readonly taskId: string;
  readonly goalId?: string;
  readonly goalVersion?: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly target: PlanningCorrectionTarget;
  readonly correctionType: PlanningCorrectionType;
  readonly scope: CognitiveScope;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly beforeSnapshot: Readonly<Record<string, unknown>>;
  readonly userInstruction: string;
  readonly structuredPatch: Readonly<Record<string, unknown>>;
  readonly afterSnapshot: Readonly<Record<string, unknown>>;
  readonly validation: Readonly<Record<string, unknown>>;
  readonly accepted: boolean;
  readonly preferenceCategory?: PlanningPreferenceCategory;
  readonly finalOutcomeRef?: string;
  readonly counterexampleRefs: readonly string[];
  readonly correctionHash: string;
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly createdAt: string;
}

export interface PlanningInteractionEpisode {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly episodeId: string;
  readonly taskId: string;
  readonly goalId?: string;
  readonly goalVersion?: number;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly revision: number;
  readonly originalRequest: string;
  readonly initialUnderstanding?: Readonly<Record<string, unknown>>;
  readonly initialGoalContract?: Readonly<Record<string, unknown>>;
  readonly initialPlan?: Readonly<Record<string, unknown>>;
  readonly acceptedGoalContract?: Readonly<Record<string, unknown>>;
  readonly acceptedPlan?: Readonly<Record<string, unknown>>;
  readonly turns: readonly Readonly<Record<string, unknown>>[];
  readonly correctionIds: readonly string[];
  readonly outcomeRef?: string;
  readonly counterexampleRefs: readonly string[];
  readonly completeness: number;
  readonly inductionFingerprint: string;
  readonly episodeHash: string;
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly createdAt: string;
}

export function createPlanningCorrectionFact(
  input: PlanningCorrectionFact,
): PlanningCorrectionFact {
  for (const [value, field] of [
    [input.correctionId, 'correctionId'],
    [input.taskId, 'taskId'],
    [input.sessionId, 'sessionId'],
    [input.turnId, 'turnId'],
    [input.idempotencyKey, 'idempotencyKey'],
    [input.actorId, 'actorId'],
  ] as const) {
    assertIdentifier(value, field);
  }
  if (input.goalId !== undefined) assertIdentifier(input.goalId, 'goalId');
  if (input.goalVersion !== undefined) assertPositiveVersion(input.goalVersion, 'goalVersion');
  if ((input.goalId === undefined) !== (input.goalVersion === undefined)) {
    invalid('Goal identity and version must be supplied together.');
  }
  if (input.scope === 'user' && input.userId === undefined) {
    invalid('User-scoped correction requires userId.');
  }
  if (input.scope === 'tenant' && input.tenantId === undefined) {
    invalid('Tenant-scoped correction requires tenantId.');
  }
  if (input.userId !== undefined) assertIdentifier(input.userId, 'userId');
  if (input.tenantId !== undefined) assertIdentifier(input.tenantId, 'tenantId');
  const userInstruction = input.userInstruction.trim();
  if (userInstruction.length < 1 || userInstruction.length > 8192) {
    invalid('User correction instruction must contain between 1 and 8192 characters.');
  }
  assertSha256(input.correctionHash, 'correctionHash');
  assertTimestamp(input.createdAt, 'createdAt');
  if (input.sourceRefs.length === 0) invalid('Correction source references are required.');
  return Object.freeze({
    ...input,
    userInstruction,
    beforeSnapshot: snapshotObject(input.beforeSnapshot, 'beforeSnapshot'),
    structuredPatch: snapshotObject(input.structuredPatch, 'structuredPatch'),
    afterSnapshot: snapshotObject(input.afterSnapshot, 'afterSnapshot'),
    validation: snapshotObject(input.validation, 'validation'),
    counterexampleRefs: freezeStrings(input.counterexampleRefs),
    sourceRefs: Object.freeze(input.sourceRefs.map(createCognitiveSourceRef)),
  });
}

export function createPlanningInteractionEpisode(
  input: PlanningInteractionEpisode,
): PlanningInteractionEpisode {
  assertIdentifier(input.episodeId, 'episodeId');
  assertIdentifier(input.taskId, 'taskId');
  assertPositiveVersion(input.revision, 'revision');
  if (input.goalId !== undefined) assertIdentifier(input.goalId, 'goalId');
  if (input.goalVersion !== undefined) assertPositiveVersion(input.goalVersion, 'goalVersion');
  if ((input.goalId === undefined) !== (input.goalVersion === undefined)) {
    episodeInvalid('Goal identity and version must be supplied together.');
  }
  if (input.userId !== undefined) assertIdentifier(input.userId, 'userId');
  if (input.tenantId !== undefined) assertIdentifier(input.tenantId, 'tenantId');
  const originalRequest = input.originalRequest.trim();
  if (originalRequest.length < 1 || originalRequest.length > 16_384) {
    episodeInvalid('Interaction original request is invalid.');
  }
  if (!Number.isFinite(input.completeness) || input.completeness < 0 || input.completeness > 1) {
    episodeInvalid('Interaction completeness must be between zero and one.');
  }
  assertSha256(input.inductionFingerprint, 'inductionFingerprint');
  assertSha256(input.episodeHash, 'episodeHash');
  assertTimestamp(input.createdAt, 'createdAt');
  if (input.sourceRefs.length === 0) episodeInvalid('Episode source references are required.');
  return Object.freeze({
    ...input,
    originalRequest,
    ...(input.initialUnderstanding === undefined
      ? {}
      : {
          initialUnderstanding: snapshotObject(input.initialUnderstanding, 'initialUnderstanding'),
        }),
    ...(input.initialGoalContract === undefined
      ? {}
      : { initialGoalContract: snapshotObject(input.initialGoalContract, 'initialGoalContract') }),
    ...(input.initialPlan === undefined
      ? {}
      : { initialPlan: snapshotObject(input.initialPlan, 'initialPlan') }),
    ...(input.acceptedGoalContract === undefined
      ? {}
      : {
          acceptedGoalContract: snapshotObject(input.acceptedGoalContract, 'acceptedGoalContract'),
        }),
    ...(input.acceptedPlan === undefined
      ? {}
      : { acceptedPlan: snapshotObject(input.acceptedPlan, 'acceptedPlan') }),
    turns: Object.freeze(input.turns.map((turn) => snapshotObject(turn, 'turn'))),
    correctionIds: freezeStrings(input.correctionIds),
    counterexampleRefs: freezeStrings(input.counterexampleRefs),
    sourceRefs: Object.freeze(input.sourceRefs.map(createCognitiveSourceRef)),
  });
}

function snapshotObject(
  value: Readonly<Record<string, unknown>>,
  field: string,
): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) invalid(`${field} must be a plain JSON object.`);
  return snapshotJsonObject(value, new WeakSet(), 0);
}

function snapshotJsonObject(
  value: Readonly<Record<string, unknown>>,
  active: WeakSet<object>,
  depth: number,
): Readonly<Record<string, unknown>> {
  if (depth > 64) invalid('Correction JSON exceeds the maximum depth.');
  if (active.has(value)) invalid('Correction JSON must not be cyclic.');
  active.add(value);
  try {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, snapshotJson(item, active, depth + 1)]),
      ),
    );
  } finally {
    active.delete(value);
  }
}

function snapshotJson(value: unknown, active: WeakSet<object>, depth: number): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (active.has(value)) invalid('Correction JSON must not be cyclic.');
    active.add(value);
    try {
      return Object.freeze(value.map((item) => snapshotJson(item, active, depth + 1)));
    } finally {
      active.delete(value);
    }
  }
  if (isPlainObject(value)) return snapshotJsonObject(value, active, depth);
  invalid('Correction snapshots must contain only finite JSON data.');
}

function freezeStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.map((value) => value.trim()).filter(Boolean))]);
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): never {
  throw new CognitiveDomainError('PLANNING_CORRECTION_INVALID', message);
}

function episodeInvalid(message: string): never {
  throw new CognitiveDomainError('PLANNING_INTERACTION_EPISODE_INVALID', message);
}
