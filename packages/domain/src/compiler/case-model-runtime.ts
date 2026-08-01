import { hashCanonical } from './artifact-shadow-governance.js';
import type {
  CaseArtifactDefinition,
  JsonValue,
  ModelBudget,
  ModelRouteArtifactDefinition,
} from './contracts.js';

export const CASE_MODEL_RUNTIME_CONTRACT_VERSION = '1.1' as const;

export const CASE_MODEL_RUNTIME_SCHEMA_HASHES = Object.freeze({
  CaseRetrievalInput: '161342c806b7f58254efac7d076d3193da80982d9c0bea22998c91e71cd3b1de',
  CaseMatch: '135dbfad26d68afa26201c43cf69816a80be23d4a550c28062a755ff6cfb084f',
  CaseAdaptationInput: '0c81b6bcabb43c588175a33d2621c431463a2547a6040efdfe39883e3a427929',
  CaseAdaptationResult: 'b2cd17de0f8a9bd09948981f29c368a1bc0ae18fedf4c9caf4d422e26ed2a72d',
  CaseRuntime: 'a2cb1f3f4c0a18abf03d3fb1a552b1f480e11e8a2ac5d3f1aa98c849dd96a387',
  ModelProfile: '03bc8f277534a5a1529d186697f7afa61eb27342a2f6ca6da85e5521d2af70bd',
  ModelRouteContext: '346e0917e77a181b332581bfdb94943742dc0dfec035938e50ba3ac225b93aa2',
  ModelRouteDecision: '9785cd514c16f49982012f3943441defe246c33dfcf3429a3504885187b7d1fd',
  ModelCascadeRun: '160a4e179dc1911f4b56557361bb0c688ea79d6c7f0964646fe70309959591df',
  ModelRouteRuntime: '386a10226570efe3572177718a9bca0f826cf6abc95ac91b63279a5993ae3dae',
} as const);

export const CASE_RUNTIME_REASON_CODES = Object.freeze([
  'CASE_ACTIVE_MATCH',
  'CASE_TENANT_MISMATCH',
  'CASE_TASK_TYPE_MISMATCH',
  'CASE_SIMILARITY_BELOW_THRESHOLD',
  'CASE_FAILURE_BOUNDARY_CLEAR',
  'CASE_FAILURE_BOUNDARY_MATCHED',
  'CASE_OUT_OF_DISTRIBUTION',
  'CASE_ADAPTATION_SAFE',
  'CASE_ADAPTATION_REQUIRES_VALIDATION',
  'CASE_HISTORICAL_ID_REJECTED',
  'CASE_CREDENTIAL_REJECTED',
  'CASE_SCOPE_EXPANSION_REJECTED',
  'CASE_DEADLINE_EXPIRED',
  'CASE_DISCARDED_STALE',
] as const);

export const MODEL_ROUTE_REASON_CODES = Object.freeze([
  'MODEL_ROUTE_SELECTED',
  'MODEL_ROUTE_NO_READY_PROFILE',
  'MODEL_ROUTE_CAPABILITY_MISMATCH',
  'MODEL_ROUTE_CLASSIFICATION_DENIED',
  'MODEL_ROUTE_RESIDENCY_DENIED',
  'MODEL_ROUTE_OUTPUT_SCHEMA_UNSUPPORTED',
  'MODEL_ROUTE_BUDGET_EXHAUSTED',
  'MODEL_ROUTE_DEADLINE_EXPIRED',
  'MODEL_ROUTE_PROFILE_STALE',
  'MODEL_ROUTE_POLICY_STALE',
  'MODEL_CASCADE_ESCALATED',
  'MODEL_CASCADE_OUTPUT_ACCEPTED',
  'MODEL_CASCADE_OUTPUT_REJECTED',
  'MODEL_CASCADE_CANCELLED',
  'MODEL_CASCADE_LATE_RESULT_DISCARDED',
] as const);

export interface CaseProblemFingerprint {
  readonly goalFeatureHash: string;
  readonly entityClasses: readonly string[];
  readonly environmentClasses: readonly string[];
  readonly capabilityState: readonly string[];
  readonly failureTypes: readonly string[];
}

export interface CaseRetrievalInput {
  readonly runtimeRequestRef: string;
  readonly goalContextRef: string;
  readonly taskTypeId: string;
  readonly problemFingerprint: CaseProblemFingerprint;
  readonly tenantId: string;
  readonly deadlineAt: string;
  readonly runtimeSnapshotHash: string;
}

export interface CaseMatch {
  readonly caseRef: string;
  readonly score: number;
  readonly applicability: 'eligible' | 'requires_adaptation' | 'fallback' | 'require_confirmation';
  readonly failureBoundaryStatus: 'clear' | 'matched' | 'unknown';
  readonly reasonCodes: readonly string[];
}

export interface CaseAdaptationInput {
  readonly caseRef: string;
  readonly goalContextRef: string;
  readonly parameterBindingRef: string;
  readonly policyDecisionRef: string;
  readonly deadlineAt: string;
  readonly runtimeSnapshotHash: string;
}

export interface CaseAdaptationResult {
  readonly caseRef: string;
  readonly parameterMappings: Readonly<Record<string, JsonValue>>;
  readonly planPatchCandidate?: JsonValue;
  readonly recoveryPlanCandidate?: JsonValue;
  readonly confidence: number;
  readonly unknowns: readonly string[];
  readonly validationRequired: boolean;
}

export interface CaseRuntime {
  retrieve(input: CaseRetrievalInput): Promise<readonly CaseMatch[]>;
  adapt(input: CaseAdaptationInput): Promise<CaseAdaptationResult>;
}

export type ModelReadiness = 'ready' | 'restricted' | 'degraded' | 'disabled' | 'unknown';

export interface ModelRateCapacity {
  readonly available: boolean;
  readonly remainingInvocations: number;
  readonly observedAt: string;
}

export interface ModelProfile {
  readonly profileId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly capabilityTags: readonly string[];
  readonly qualityTier: number;
  readonly latencyTier: number;
  readonly costTier: number;
  readonly contextWindow: number;
  readonly modalities: readonly string[];
  readonly structuredOutputSupport: boolean;
  readonly toolCallingSupport: boolean;
  readonly dataResidency: readonly string[];
  readonly dataClassificationAllowance: readonly string[];
  readonly rateCapacity: ModelRateCapacity;
  readonly readiness: ModelReadiness;
  readonly health: number;
  readonly profileVersion: number;
}

export interface ModelRouteBudget {
  readonly maxCostUnits: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxInvocations: number;
}

export interface ModelRouteContext {
  readonly requestRef: string;
  readonly tenantId: string;
  readonly taskTypeId?: string;
  readonly operationType: string;
  readonly riskLevel: string;
  readonly dataClassification: string;
  readonly requiredCapabilities: readonly string[];
  readonly outputSchemaRef: string;
  readonly deadlineAt: string;
  readonly budget: ModelRouteBudget;
  readonly policySnapshotHash: string;
  readonly providerProfileSnapshotHash: string;
}

export interface ModelRouteDecision {
  readonly route: ModelRouteArtifactDefinition['route'];
  readonly reasonCodes: readonly string[];
  readonly budget: ModelBudget;
  readonly fallbackRoutes: ModelRouteArtifactDefinition['fallbackRoutes'];
  readonly selectedProfileRefs: readonly string[];
  readonly decisionHash: string;
}

export interface ModelCascadeRun {
  readonly cascadeRunId: string;
  readonly routeDecisionRef: string;
  readonly status:
    | 'running'
    | 'completed'
    | 'fallback'
    | 'cancelled'
    | 'timed_out'
    | 'budget_exhausted'
    | 'failed';
  readonly stepRefs: readonly string[];
  readonly selectedOutputRef?: string;
  readonly totalCostUnits: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly completedAt?: string;
}

export interface ModelRouteRuntime {
  evaluate(input: ModelRouteContext): Promise<ModelRouteDecision>;
}

export function createCaseRetrievalInput(input: CaseRetrievalInput): CaseRetrievalInput {
  return Object.freeze({
    runtimeRequestRef: text(input.runtimeRequestRef, 'runtimeRequestRef'),
    goalContextRef: text(input.goalContextRef, 'goalContextRef'),
    taskTypeId: text(input.taskTypeId, 'taskTypeId'),
    problemFingerprint: Object.freeze({
      goalFeatureHash: hash(input.problemFingerprint.goalFeatureHash, 'goalFeatureHash'),
      entityClasses: texts(input.problemFingerprint.entityClasses, 'entityClasses'),
      environmentClasses: texts(input.problemFingerprint.environmentClasses, 'environmentClasses'),
      capabilityState: texts(input.problemFingerprint.capabilityState, 'capabilityState'),
      failureTypes: texts(input.problemFingerprint.failureTypes, 'failureTypes'),
    }),
    tenantId: text(input.tenantId, 'tenantId'),
    deadlineAt: iso(input.deadlineAt, 'deadlineAt'),
    runtimeSnapshotHash: hash(input.runtimeSnapshotHash, 'runtimeSnapshotHash'),
  });
}

export function createCaseAdaptationInput(input: CaseAdaptationInput): CaseAdaptationInput {
  return Object.freeze({
    caseRef: text(input.caseRef, 'caseRef'),
    goalContextRef: text(input.goalContextRef, 'goalContextRef'),
    parameterBindingRef: text(input.parameterBindingRef, 'parameterBindingRef'),
    policyDecisionRef: text(input.policyDecisionRef, 'policyDecisionRef'),
    deadlineAt: iso(input.deadlineAt, 'deadlineAt'),
    runtimeSnapshotHash: hash(input.runtimeSnapshotHash, 'runtimeSnapshotHash'),
  });
}

export function createModelProfile(input: ModelProfile): ModelProfile {
  if (
    !Number.isInteger(input.contextWindow) ||
    input.contextWindow < 1 ||
    !Number.isInteger(input.profileVersion) ||
    input.profileVersion < 1
  ) {
    invalid('MODEL_PROFILE_INVALID', 'contextWindow and profileVersion must be positive integers.');
  }
  for (const [field, value] of [
    ['qualityTier', input.qualityTier],
    ['latencyTier', input.latencyTier],
    ['costTier', input.costTier],
    ['health', input.health],
  ] as const) {
    if (!Number.isFinite(value) || value < 0)
      invalid('MODEL_PROFILE_INVALID', `${field} is invalid.`);
  }
  if (
    !Number.isInteger(input.rateCapacity.remainingInvocations) ||
    input.rateCapacity.remainingInvocations < 0
  ) {
    invalid('MODEL_PROFILE_INVALID', 'remainingInvocations must be a non-negative integer.');
  }
  return Object.freeze({
    profileId: text(input.profileId, 'profileId'),
    providerId: text(input.providerId, 'providerId'),
    modelId: text(input.modelId, 'modelId'),
    modelVersion: text(input.modelVersion, 'modelVersion'),
    capabilityTags: texts(input.capabilityTags, 'capabilityTags'),
    qualityTier: input.qualityTier,
    latencyTier: input.latencyTier,
    costTier: input.costTier,
    contextWindow: input.contextWindow,
    modalities: texts(input.modalities, 'modalities'),
    structuredOutputSupport: input.structuredOutputSupport,
    toolCallingSupport: input.toolCallingSupport,
    dataResidency: texts(input.dataResidency, 'dataResidency'),
    dataClassificationAllowance: texts(
      input.dataClassificationAllowance,
      'dataClassificationAllowance',
    ),
    rateCapacity: Object.freeze({
      available: input.rateCapacity.available,
      remainingInvocations: input.rateCapacity.remainingInvocations,
      observedAt: iso(input.rateCapacity.observedAt, 'rateCapacity.observedAt'),
    }),
    readiness: input.readiness,
    health: input.health,
    profileVersion: input.profileVersion,
  });
}

export function createModelRouteContext(input: ModelRouteContext): ModelRouteContext {
  if (
    !Number.isFinite(input.budget.maxCostUnits) ||
    input.budget.maxCostUnits < 0 ||
    !Number.isInteger(input.budget.maxInvocations) ||
    input.budget.maxInvocations < 1
  ) {
    invalid('MODEL_ROUTE_CONTEXT_INVALID', 'Route budget is invalid.');
  }
  const optionalTokens = [input.budget.maxInputTokens, input.budget.maxOutputTokens].filter(
    (value): value is number => value !== undefined,
  );
  if (optionalTokens.some((value) => !Number.isInteger(value) || value < 0)) {
    invalid('MODEL_ROUTE_CONTEXT_INVALID', 'Token budgets must be non-negative integers.');
  }
  return Object.freeze({
    requestRef: text(input.requestRef, 'requestRef'),
    tenantId: text(input.tenantId, 'tenantId'),
    ...(input.taskTypeId === undefined ? {} : { taskTypeId: text(input.taskTypeId, 'taskTypeId') }),
    operationType: text(input.operationType, 'operationType'),
    riskLevel: text(input.riskLevel, 'riskLevel'),
    dataClassification: text(input.dataClassification, 'dataClassification'),
    requiredCapabilities: texts(input.requiredCapabilities, 'requiredCapabilities'),
    outputSchemaRef: text(input.outputSchemaRef, 'outputSchemaRef'),
    deadlineAt: iso(input.deadlineAt, 'deadlineAt'),
    budget: Object.freeze({ ...input.budget }),
    policySnapshotHash: hash(input.policySnapshotHash, 'policySnapshotHash'),
    providerProfileSnapshotHash: hash(
      input.providerProfileSnapshotHash,
      'providerProfileSnapshotHash',
    ),
  });
}

export function createModelRouteDecision(
  input: Omit<ModelRouteDecision, 'decisionHash'> & { readonly decisionHash?: string },
): ModelRouteDecision {
  const unsigned = {
    route: input.route,
    reasonCodes: texts(input.reasonCodes, 'reasonCodes'),
    budget: Object.freeze({ ...input.budget }),
    fallbackRoutes: Object.freeze([...input.fallbackRoutes]),
    selectedProfileRefs: orderedTexts(input.selectedProfileRefs, 'selectedProfileRefs'),
  };
  const decisionHash = hashCanonical(unsigned);
  if (input.decisionHash !== undefined && input.decisionHash !== decisionHash) {
    invalid('MODEL_ROUTE_DECISION_HASH_MISMATCH', 'decisionHash is not canonical.');
  }
  return Object.freeze({ ...unsigned, decisionHash });
}

export function createModelCascadeRun(input: ModelCascadeRun): ModelCascadeRun {
  if (
    [input.totalCostUnits, input.totalInputTokens, input.totalOutputTokens].some(
      (value) => !Number.isFinite(value) || value < 0,
    )
  ) {
    invalid('MODEL_CASCADE_RUN_INVALID', 'Cascade usage must be non-negative.');
  }
  if (input.status === 'running' && input.completedAt !== undefined) {
    invalid('MODEL_CASCADE_RUN_INVALID', 'A running cascade cannot be completed.');
  }
  if (input.status !== 'running' && input.completedAt === undefined) {
    invalid('MODEL_CASCADE_RUN_INVALID', 'A terminal cascade requires completedAt.');
  }
  return Object.freeze({
    cascadeRunId: text(input.cascadeRunId, 'cascadeRunId'),
    routeDecisionRef: text(input.routeDecisionRef, 'routeDecisionRef'),
    status: input.status,
    stepRefs: texts(input.stepRefs, 'stepRefs'),
    ...(input.selectedOutputRef === undefined
      ? {}
      : { selectedOutputRef: text(input.selectedOutputRef, 'selectedOutputRef') }),
    totalCostUnits: input.totalCostUnits,
    totalInputTokens: input.totalInputTokens,
    totalOutputTokens: input.totalOutputTokens,
    ...(input.completedAt === undefined
      ? {}
      : { completedAt: iso(input.completedAt, 'completedAt') }),
  });
}

export function caseSimilarity(
  input: CaseRetrievalInput,
  definition: CaseArtifactDefinition,
): number {
  const fingerprint = definition.problemFingerprint;
  const goal = input.problemFingerprint.goalFeatureHash === fingerprint.goalFeatureHash ? 1 : 0;
  const entity = jaccard(input.problemFingerprint.entityClasses, fingerprint.entityClasses);
  const environment = jaccard(
    input.problemFingerprint.environmentClasses,
    fingerprint.environmentClasses,
  );
  const capability = jaccard(input.problemFingerprint.capabilityState, fingerprint.capabilityState);
  const failures = jaccard(input.problemFingerprint.failureTypes, fingerprint.failureTypes);
  return round(goal * 0.35 + entity * 0.2 + environment * 0.15 + capability * 0.2 + failures * 0.1);
}

export function hashModelProfileSnapshot(profiles: readonly ModelProfile[]): string {
  return hashCanonical(
    profiles
      .map((profile) => createModelProfile(profile))
      .sort((left, right) => left.profileId.localeCompare(right.profileId)),
  );
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of leftSet) if (rightSet.has(value)) intersection += 1;
  return intersection / union.size;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function texts(values: readonly string[], field: string): readonly string[] {
  if (values.length > 256) invalid('P11_VALUE_INVALID', `${field} is too large.`);
  return Object.freeze([...new Set(values.map((value) => text(value, field)))].sort());
}

function orderedTexts(values: readonly string[], field: string): readonly string[] {
  if (values.length > 256) invalid('P11_VALUE_INVALID', `${field} is too large.`);
  const normalized = values.map((value) => text(value, field));
  if (new Set(normalized).size !== normalized.length)
    invalid('P11_VALUE_INVALID', `${field} must not contain duplicates.`);
  return Object.freeze(normalized);
}

function text(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 8_192)
    invalid('P11_VALUE_INVALID', `${field} is invalid.`);
  return normalized;
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    invalid('P11_VALUE_INVALID', `${field} must be canonical ISO.`);
  return value;
}

function hash(value: string, field: string): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value))
    invalid('P11_VALUE_INVALID', `${field} must be sha256:<64 lowercase hex>.`);
  return value;
}

function invalid(code: string, message: string): never {
  throw new CaseModelRuntimeDomainError(code, message);
}

export class CaseModelRuntimeDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CaseModelRuntimeDomainError';
    this.code = code;
  }
}
