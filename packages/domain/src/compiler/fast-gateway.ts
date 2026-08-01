import { hashCanonical } from './artifact-shadow-governance.js';
import type { JsonValue } from './contracts.js';
import type { RuntimeExecutionDecision } from './artifact-retrieval.js';

export const FAST_GATEWAY_CONTRACT_VERSION = '1.1' as const;

export const FAST_GATEWAY_SCHEMA_HASHES = Object.freeze({
  RuntimeRequestContext: '6ada60cdd637cd3a2467347c8ef858ce2932c5e56d891c7aaaf1dfaabc41595e',
  FastGateway: 'be8f17ffcf597a021a8758844521cf4ba43dd1537e0d74dc7be2116c91cc16fe',
  GatewayDecisionRecord: '1beecf8ae5527d5b8db7bcf89c36b4e73d35e083d6818f9ad18874f13e31d3ab',
  GatewayFeedbackEnvelope: '22faac79bc9ea9d8bcac5bc42e626bba79b5ed04579e371ba5dfadbc611aaf6b',
} as const);

export const GATEWAY_REASON_CODES = Object.freeze([
  'GATEWAY_AUTHENTICATED',
  'GATEWAY_AUTH_FAILED',
  'GATEWAY_TENANT_AUTHORIZED',
  'GATEWAY_TENANT_DENIED',
  'GATEWAY_REQUEST_INVALID',
  'GATEWAY_DEADLINE_INVALID',
  'GATEWAY_CANCELLED',
  'GATEWAY_FEATURE_DISABLED',
  'GATEWAY_KILL_SWITCH_ACTIVE',
  'GATEWAY_POLICY_DENY',
  'GATEWAY_POLICY_CONFIRM',
  'GATEWAY_ARTIFACT_MATCH',
  'GATEWAY_ARTIFACT_NO_MATCH',
  'GATEWAY_ARTIFACT_AMBIGUOUS',
  'GATEWAY_ARTIFACT_STALE',
  'GATEWAY_RULE_SELECTED',
  'GATEWAY_RULE_NO_MATCH',
  'GATEWAY_RULE_DENY',
  'GATEWAY_RULE_CONFIRM',
  'GATEWAY_RULE_PATCH',
  'GATEWAY_TEMPLATE_SELECTED',
  'GATEWAY_TEMPLATE_CONFIRM',
  'GATEWAY_TEMPLATE_FALLBACK',
  'GATEWAY_TEMPLATE_COMMITTED',
  'GATEWAY_COGNITIVE_FALLBACK',
  'GATEWAY_STAGE_TIMEOUT',
  'GATEWAY_DEADLINE_EXHAUSTED',
  'GATEWAY_CIRCUIT_OPEN',
  'GATEWAY_LOAD_SHED',
  'GATEWAY_ADAPTER_UNAVAILABLE',
  'GATEWAY_DISCARDED_LATE',
  'GATEWAY_DISCARDED_STALE',
  'GATEWAY_FORMAL_HANDOFF_SUBMITTED',
  'GATEWAY_FORMAL_HANDOFF_COMMITTED',
  'GATEWAY_FORMAL_HANDOFF_FAILED',
  'GATEWAY_INTERACTION_REQUIRED',
  'GATEWAY_DENIED',
  'GATEWAY_FEEDBACK_RECORDED',
  'GATEWAY_DRIFT_NORMAL',
  'GATEWAY_DRIFT_URGENT',
  'GATEWAY_DRIFT_CRITICAL',
] as const);

export type GatewayReasonCode = (typeof GATEWAY_REASON_CODES)[number];
export type GatewayStage =
  'precheck' | 'retrieval' | 'rule' | 'template' | 'fallback' | 'formal_handoff';
export type GatewayStageStatus =
  'not_run' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'discarded_stale' | 'skipped';
export type GatewayFeedbackType =
  | 'route_selected'
  | 'fallback'
  | 'confirmation'
  | 'denial'
  | 'formal_handoff'
  | 'outcome'
  | 'correction'
  | 'recovery'
  | 'performance'
  | 'drift';

export interface RuntimeRequestActor {
  readonly actorId: string;
  readonly tenantId: string;
  readonly authenticationRef: string;
  readonly authorizationRefs: readonly string[];
}

/** Frozen P10 request facts. References point to existing authorities. */
export interface RuntimeRequestContext {
  readonly requestId: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly rawText: string;
  readonly normalizedText: string;
  readonly actor: RuntimeRequestActor;
  readonly extractedFeatures: Readonly<Record<string, JsonValue>>;
  readonly worldStateRef: string;
  readonly capabilitySummaryRef: string;
  readonly policySnapshotRef: string;
  readonly deadlineAt: string;
  readonly cancellationRef: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface GatewayStageResult {
  readonly stage: GatewayStage;
  readonly status: GatewayStageStatus;
  readonly disposition?: string;
  readonly resultRef?: string;
  readonly reasonCodes: readonly GatewayReasonCode[];
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface GatewayDecisionRecord {
  readonly gatewayDecisionId: string;
  readonly requestId: string;
  readonly runtimeDecisionRef: string;
  readonly stageResults: readonly GatewayStageResult[];
  readonly formalHandoffRef?: string;
  readonly fallbackRef?: string;
  readonly reasonCodes: readonly GatewayReasonCode[];
  readonly runtimeSnapshotHash: string;
  readonly decisionHash: string;
  readonly createdAt: string;
}

export interface GatewayFeedbackEnvelope {
  readonly feedbackId: string;
  readonly requestId: string;
  readonly gatewayDecisionRef: string;
  readonly selectedArtifactRefs: readonly string[];
  readonly formalGoalRef?: string;
  readonly formalPlanRef?: string;
  readonly formalOutcomeRef?: string;
  readonly feedbackType: GatewayFeedbackType;
  readonly payload: JsonValue;
  readonly sourceRefs: readonly string[];
  readonly createdAt: string;
}

export interface FastGateway {
  evaluate(input: RuntimeRequestContext): Promise<RuntimeExecutionDecision>;
}

export function createRuntimeRequestContext(input: RuntimeRequestContext): RuntimeRequestContext {
  const createdAt = requireIso(input.createdAt, 'createdAt');
  const deadlineAt = requireIso(input.deadlineAt, 'deadlineAt');
  if (Date.parse(deadlineAt) <= Date.parse(createdAt)) {
    throw new FastGatewayDomainError(
      'GATEWAY_DEADLINE_INVALID',
      'deadlineAt must be later than createdAt.',
    );
  }
  const actor = Object.freeze({
    actorId: requireText(input.actor.actorId, 'actor.actorId', 256),
    tenantId: requireText(input.actor.tenantId, 'actor.tenantId', 256),
    authenticationRef: requireText(input.actor.authenticationRef, 'actor.authenticationRef', 512),
    authorizationRefs: freezeTexts(input.actor.authorizationRefs, 'actor.authorizationRefs', 64),
  });
  return Object.freeze({
    requestId: requireText(input.requestId, 'requestId', 256),
    taskId: requireText(input.taskId, 'taskId', 256),
    contextId: requireText(input.contextId, 'contextId', 256),
    rawText: requireText(input.rawText, 'rawText', 64_000),
    normalizedText: requireText(input.normalizedText, 'normalizedText', 64_000),
    actor,
    extractedFeatures: freezeJsonObject(input.extractedFeatures, 'extractedFeatures'),
    worldStateRef: requireText(input.worldStateRef, 'worldStateRef', 512),
    capabilitySummaryRef: requireText(input.capabilitySummaryRef, 'capabilitySummaryRef', 512),
    policySnapshotRef: requireText(input.policySnapshotRef, 'policySnapshotRef', 512),
    deadlineAt,
    cancellationRef: requireText(input.cancellationRef, 'cancellationRef', 512),
    idempotencyKey: requireText(input.idempotencyKey, 'idempotencyKey', 512),
    createdAt,
  });
}

export function createGatewayDecisionRecord(input: GatewayDecisionRecord): GatewayDecisionRecord {
  const stageResults = Object.freeze(
    input.stageResults.map((stage, index) => createStageResult(stage, index)),
  );
  if (stageResults.length === 0 || stageResults.length > 12) {
    throw new FastGatewayDomainError(
      'GATEWAY_REQUEST_INVALID',
      'stageResults must contain between 1 and 12 entries.',
    );
  }
  const record = {
    gatewayDecisionId: requireText(input.gatewayDecisionId, 'gatewayDecisionId', 256),
    requestId: requireText(input.requestId, 'requestId', 256),
    runtimeDecisionRef: requireText(input.runtimeDecisionRef, 'runtimeDecisionRef', 512),
    stageResults,
    ...(input.formalHandoffRef === undefined
      ? {}
      : {
          formalHandoffRef: requireText(input.formalHandoffRef, 'formalHandoffRef', 512),
        }),
    ...(input.fallbackRef === undefined
      ? {}
      : { fallbackRef: requireText(input.fallbackRef, 'fallbackRef', 512) }),
    reasonCodes: freezeReasonCodes(input.reasonCodes),
    runtimeSnapshotHash: requireHash(input.runtimeSnapshotHash, 'runtimeSnapshotHash'),
    decisionHash: requireHash(input.decisionHash, 'decisionHash'),
    createdAt: requireIso(input.createdAt, 'createdAt'),
  };
  const expected = hashGatewayDecision({
    requestId: record.requestId,
    runtimeDecisionRef: record.runtimeDecisionRef,
    stageResults: record.stageResults,
    ...(record.formalHandoffRef === undefined ? {} : { formalHandoffRef: record.formalHandoffRef }),
    ...(record.fallbackRef === undefined ? {} : { fallbackRef: record.fallbackRef }),
    reasonCodes: record.reasonCodes,
    runtimeSnapshotHash: record.runtimeSnapshotHash,
  });
  if (record.decisionHash !== expected) {
    throw new FastGatewayDomainError(
      'GATEWAY_DECISION_HASH_MISMATCH',
      'decisionHash does not match the canonical Gateway decision.',
    );
  }
  return Object.freeze(record);
}

export function createGatewayFeedbackEnvelope(
  input: GatewayFeedbackEnvelope,
): GatewayFeedbackEnvelope {
  return Object.freeze({
    feedbackId: requireText(input.feedbackId, 'feedbackId', 256),
    requestId: requireText(input.requestId, 'requestId', 256),
    gatewayDecisionRef: requireText(input.gatewayDecisionRef, 'gatewayDecisionRef', 512),
    selectedArtifactRefs: freezeTexts(input.selectedArtifactRefs, 'selectedArtifactRefs', 16),
    ...(input.formalGoalRef === undefined
      ? {}
      : { formalGoalRef: requireText(input.formalGoalRef, 'formalGoalRef', 512) }),
    ...(input.formalPlanRef === undefined
      ? {}
      : { formalPlanRef: requireText(input.formalPlanRef, 'formalPlanRef', 512) }),
    ...(input.formalOutcomeRef === undefined
      ? {}
      : { formalOutcomeRef: requireText(input.formalOutcomeRef, 'formalOutcomeRef', 512) }),
    feedbackType: input.feedbackType,
    payload: freezeJson(input.payload, 'payload', 0),
    sourceRefs: freezeTexts(input.sourceRefs, 'sourceRefs', 64),
    createdAt: requireIso(input.createdAt, 'createdAt'),
  });
}

export function hashRuntimeRequestContext(input: RuntimeRequestContext): string {
  return hashCanonical(createRuntimeRequestContext(input));
}

export function hashGatewayDecision(
  input: Omit<GatewayDecisionRecord, 'gatewayDecisionId' | 'decisionHash' | 'createdAt'>,
): string {
  return hashCanonical(input);
}

function createStageResult(input: GatewayStageResult, index: number): GatewayStageResult {
  return Object.freeze({
    stage: input.stage,
    status: input.status,
    ...(input.disposition === undefined
      ? {}
      : {
          disposition: requireText(
            input.disposition,
            `stageResults[${String(index)}].disposition`,
            128,
          ),
        }),
    ...(input.resultRef === undefined
      ? {}
      : {
          resultRef: requireText(input.resultRef, `stageResults[${String(index)}].resultRef`, 512),
        }),
    reasonCodes: freezeReasonCodes(input.reasonCodes),
    ...(input.startedAt === undefined
      ? {}
      : { startedAt: requireIso(input.startedAt, `stageResults[${String(index)}].startedAt`) }),
    ...(input.completedAt === undefined
      ? {}
      : {
          completedAt: requireIso(input.completedAt, `stageResults[${String(index)}].completedAt`),
        }),
  });
}

function freezeReasonCodes(values: readonly GatewayReasonCode[]): readonly GatewayReasonCode[] {
  if (values.length > 64 || values.some((value) => !GATEWAY_REASON_CODES.includes(value))) {
    throw new FastGatewayDomainError('GATEWAY_REQUEST_INVALID', 'Invalid Gateway reasonCodes.');
  }
  return Object.freeze([...new Set(values)].sort());
}

function freezeTexts(values: readonly string[], field: string, max: number): readonly string[] {
  if (values.length > max) {
    throw new FastGatewayDomainError('GATEWAY_REQUEST_INVALID', `${field} exceeds ${String(max)}.`);
  }
  return Object.freeze([
    ...new Set(values.map((value, index) => requireText(value, `${field}[${String(index)}]`, 512))),
  ]);
}

function freezeJsonObject(
  value: Readonly<Record<string, JsonValue>>,
  field: string,
): Readonly<Record<string, JsonValue>> {
  const frozen = freezeJson(value, field, 0);
  if (!isJsonObject(frozen)) {
    throw new FastGatewayDomainError('GATEWAY_REQUEST_INVALID', `${field} must be an object.`);
  }
  return frozen;
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !isJsonArray(value);
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function freezeJson(value: JsonValue, field: string, depth: number): JsonValue {
  if (depth > 8) {
    throw new FastGatewayDomainError('GATEWAY_REQUEST_INVALID', `${field} exceeds max depth.`);
  }
  if (typeof value === 'string') return requireText(value, field, 8_192);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new FastGatewayDomainError('GATEWAY_REQUEST_INVALID', `${field} must be finite.`);
    }
    return value;
  }
  if (isJsonArray(value)) {
    if (value.length > 256) {
      throw new FastGatewayDomainError('GATEWAY_REQUEST_INVALID', `${field} is too large.`);
    }
    return Object.freeze(
      value.map((item, index) => freezeJson(item, `${field}[${String(index)}]`, depth + 1)),
    );
  }
  if (!isJsonObject(value)) {
    throw new FastGatewayDomainError('GATEWAY_REQUEST_INVALID', `${field} must be JSON data.`);
  }
  const entries = Object.entries(value);
  if (entries.length > 256) {
    throw new FastGatewayDomainError('GATEWAY_REQUEST_INVALID', `${field} is too large.`);
  }
  return Object.freeze(
    Object.fromEntries(
      entries.map(([key, item]) => [
        requireText(key, `${field}.key`, 256),
        freezeJson(item, `${field}.${key}`, depth + 1),
      ]),
    ),
  );
}

function requireText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new FastGatewayDomainError(
      'GATEWAY_REQUEST_INVALID',
      `${field} must contain 1-${String(maxLength)} characters.`,
    );
  }
  return normalized;
}

function requireIso(value: string, field: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new FastGatewayDomainError('GATEWAY_REQUEST_INVALID', `${field} must be canonical ISO.`);
  }
  return value;
}

function requireHash(value: string, field: string): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new FastGatewayDomainError(
      'GATEWAY_REQUEST_INVALID',
      `${field} must be sha256:<64 lowercase hex>.`,
    );
  }
  return value;
}

export class FastGatewayDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FastGatewayDomainError';
    this.code = code;
  }
}
