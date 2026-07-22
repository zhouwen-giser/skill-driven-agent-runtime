import { CognitiveDomainError } from './errors.js';

export const COGNITIVE_SCHEMA_VERSION = '1.0' as const;

export const COGNITIVE_MODEL_STAGES = Object.freeze([
  'capability_narrative',
  'task_understanding',
  'task_clarification',
  'goal_contract_generation',
  'interactive_plan_patch',
  'experience_observation',
  'experience_reflection',
  'task_type_induction',
  'capability_pattern_induction',
  'knowledge_promotion_assessment',
] as const);

export const COGNITIVE_OUTBOX_EVENT_TYPES = Object.freeze([
  'skill.catalog_changed',
  'capability.summary_built',
  'capability.card_published',
  'task.understanding_created',
  'task.clarification_requested',
  'task.clarification_answered',
  'goal.contract_candidate_created',
  'goal.contract_confirmed',
  'plan.candidate_created',
  'plan.revised',
  'plan.confirmed',
  'planning.correction_recorded',
  'user_goal.terminal_committed',
  'experience.episode_created',
  'experience.observation_completed',
  'experience.reflection_completed',
  'knowledge.candidate_created',
  'knowledge.contradiction_recorded',
  'knowledge.validating',
  'knowledge.promoted',
  'knowledge.rejected',
  'capability.gap_candidate_created',
  'planning.knowledge_used',
] as const);

export const COGNITIVE_QUEUE_NAMES = Object.freeze({
  outboxDispatch: 'sdar.cognitive.outbox-dispatch.v1',
  episodeBuild: 'sdar.cognitive.episode-build.v1',
  observe: 'sdar.cognitive.observe.v1',
  reflect: 'sdar.cognitive.reflect.v1',
  induce: 'sdar.cognitive.induce.v1',
  revalidate: 'sdar.cognitive.revalidate.v1',
} as const);

export type CognitiveModelStage = (typeof COGNITIVE_MODEL_STAGES)[number];
export type CognitiveOutboxEventType = (typeof COGNITIVE_OUTBOX_EVENT_TYPES)[number];
export type CognitiveScope = 'task' | 'user' | 'tenant' | 'global_candidate';
export type CognitiveDataClassification = 'public' | 'internal' | 'user_scoped' | 'restricted';
export type CognitiveSourceAuthority =
  | 'runtime_fact'
  | 'user_instruction'
  | 'user_confirmation'
  | 'domain_rule'
  | 'model_candidate'
  | 'promoted_knowledge'
  | 'skill_declaration';
export type CognitiveSourceKind =
  | 'task_request'
  | 'capability_summary'
  | 'task_type_definition'
  | 'user_preference'
  | 'goal_contract'
  | 'plan_revision'
  | 'skill_attempt'
  | 'workflow_outcome'
  | 'runtime_terminal_outcome'
  | 'recovery_decision'
  | 'business_event'
  | 'planning_correction'
  | 'model_invocation'
  | 'knowledge_revision'
  | 'skill_version';

export interface CognitiveSourceRef {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly sourceRefId: string;
  readonly sourceKind: CognitiveSourceKind;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly authority: CognitiveSourceAuthority;
  readonly dataClassification: CognitiveDataClassification;
  readonly capturedAt: string;
  readonly contentHash?: string;
}

export interface CognitiveCorrelation {
  readonly correlationId: string;
  readonly causationId?: string;
  readonly goalId?: string;
  readonly taskId?: string;
  readonly tenantId?: string;
  readonly userId?: string;
}

export interface CognitiveDomainEvent<
  TPayload extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly eventId: string;
  readonly eventType: CognitiveOutboxEventType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly occurredAt: string;
  readonly correlation: CognitiveCorrelation;
  readonly payload: TPayload;
}

export type CognitiveUnderstandingMode = 'off' | 'ambiguous_only' | 'all';
export type CognitiveInteractiveMode = 'off' | 'manual' | 'policy';
export type CognitiveInductionMode = 'off' | 'shadow' | 'candidate';
export type CognitiveInjectionMode = 'off' | 'shadow' | 'advisory' | 'active_low_risk';

export interface CognitiveRuntimeFeatureFlags {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly capabilitySummaryEnabled: boolean;
  readonly publicCapabilityCardEnabled: boolean;
  readonly understandingMode: CognitiveUnderstandingMode;
  readonly interactiveMode: CognitiveInteractiveMode;
  readonly experienceCaptureEnabled: boolean;
  readonly experienceObserverEnabled: boolean;
  readonly inductionMode: CognitiveInductionMode;
  readonly promotionMode: 'manual';
  readonly injectionMode: CognitiveInjectionMode;
}

export type CognitiveRuntimeFeatureFlagsInput = Readonly<
  Omit<CognitiveRuntimeFeatureFlags, 'schemaVersion' | 'promotionMode'> & {
    schemaVersion: string;
    promotionMode: string;
  }
>;

export const DEFAULT_COGNITIVE_RUNTIME_FEATURE_FLAGS: CognitiveRuntimeFeatureFlags = Object.freeze({
  schemaVersion: COGNITIVE_SCHEMA_VERSION,
  capabilitySummaryEnabled: true,
  publicCapabilityCardEnabled: true,
  understandingMode: 'ambiguous_only',
  interactiveMode: 'manual',
  experienceCaptureEnabled: true,
  experienceObserverEnabled: true,
  inductionMode: 'shadow',
  promotionMode: 'manual',
  injectionMode: 'shadow',
});

export function createCognitiveSourceRef(input: CognitiveSourceRef): CognitiveSourceRef {
  assertIdentifier(input.sourceRefId, 'sourceRefId');
  assertIdentifier(input.sourceId, 'sourceId');
  assertPositiveVersion(input.sourceRevision, 'sourceRevision');
  assertTimestamp(input.capturedAt, 'capturedAt');
  if (input.contentHash !== undefined) assertSha256(input.contentHash, 'contentHash');
  return Object.freeze({ ...input });
}

export function createCognitiveRuntimeFeatureFlags(
  input: CognitiveRuntimeFeatureFlagsInput,
): CognitiveRuntimeFeatureFlags {
  if (input.schemaVersion !== COGNITIVE_SCHEMA_VERSION || input.promotionMode !== 'manual') {
    throw new CognitiveDomainError(
      'COGNITIVE_FEATURE_FLAGS_INVALID',
      'Cognitive feature flags must use schema 1.0 and manual promotion.',
    );
  }
  return Object.freeze({
    ...input,
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    promotionMode: 'manual',
  });
}

export function createCognitiveDomainEvent<TPayload extends Readonly<Record<string, unknown>>>(
  input: CognitiveDomainEvent<TPayload>,
): CognitiveDomainEvent<TPayload> {
  assertIdentifier(input.eventId, 'eventId');
  assertIdentifier(input.aggregateType, 'aggregateType');
  assertIdentifier(input.aggregateId, 'aggregateId');
  assertPositiveVersion(input.aggregateVersion, 'aggregateVersion');
  assertTimestamp(input.occurredAt, 'occurredAt');
  assertIdentifier(input.correlation.correlationId, 'correlationId');
  if (!COGNITIVE_OUTBOX_EVENT_TYPES.includes(input.eventType)) {
    throw new CognitiveDomainError('COGNITIVE_EVENT_INVALID', 'Unknown cognitive event type.');
  }
  return Object.freeze({
    ...input,
    correlation: Object.freeze({ ...input.correlation }),
    payload: Object.freeze({ ...input.payload }),
  });
}

export function assertIdentifier(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new CognitiveDomainError('COGNITIVE_ID_INVALID', `${field} is invalid.`, { field });
  }
}

export function assertPositiveVersion(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CognitiveDomainError('COGNITIVE_REVISION_INVALID', `${field} must be positive.`, {
      field,
    });
  }
}

export function assertTimestamp(value: string, field: string): void {
  if (!/(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new CognitiveDomainError('COGNITIVE_SOURCE_REF_INVALID', `${field} is invalid.`, {
      field,
    });
  }
}

export function assertSha256(value: string, field: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new CognitiveDomainError('COGNITIVE_SOURCE_REF_INVALID', `${field} is invalid.`, {
      field,
    });
  }
}

export function freezeStrings(values: readonly string[], field: string): readonly string[] {
  const result = values.map((value) => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 4096) {
      throw new CognitiveDomainError('COGNITIVE_REVISION_INVALID', `${field} is invalid.`, {
        field,
      });
    }
    return trimmed;
  });
  return Object.freeze(result);
}
