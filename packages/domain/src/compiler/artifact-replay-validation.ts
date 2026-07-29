import type { JsonValue } from './contracts.js';
import { ArtifactDomainError, type ArtifactDomainErrorCode } from './errors.js';

export const ARTIFACT_REPLAY_VALIDATION_CONTRACT_VERSION = '1.1' as const;
export const ARTIFACT_REPLAY_VALIDATION_SCHEMA_HASHES = Object.freeze({
  ArtifactReplayCase: 'ab24f3c2d8a692f6e569c7e95f04f4389244941da0b297ec799610e8d1bab64f',
  ReplayDatasetManifest: '132f1c215f12fdd28388ac3879589fd22e8772f1fd75ce058ce36977802c746e',
  ArtifactValidationRun: 'c602d26e36dc9fc55b0ecaeeeebbf962af8e4d8f80080b7d9f12798be2afdd1a',
  ArtifactValidationResult: '0a9b4fe3b71242744760ecf7bfcd14cf4272b32ac130e111878f67f3514fd64b',
  ArtifactValidationFailure: 'e017c434add5d1f1aec004552a8795c34509461699d351d879a02003ddb37182',
  ArtifactCounterexample: 'ef317932640d095863d9bb13c96e2f738989bc7858aec9a613f76c4438ad46f3',
} as const);

const MAX_REFS = 4_096;
const MAX_METRICS = 256;
const MAX_TEXT = 4_096;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_ITEMS = 4_096;

export type ReplayDatasetPurpose =
  'discovery' | 'candidate_development' | 'promotion_holdout' | 'counterexample';

export interface ArtifactReplayCase {
  readonly replayCaseId: string;
  readonly tenantId: string;
  readonly requestSnapshotRef: string;
  readonly goalContractSnapshotRef: string;
  readonly capabilityCatalogSnapshotRef: string;
  readonly worldStateSnapshotRef?: string;
  readonly policySnapshotRef: string;
  readonly readinessSnapshotRef?: string;
  readonly acceptedPlanSnapshotRef?: string;
  readonly executionTraceSnapshotRef?: string;
  readonly outcomeSnapshotRef: string;
  readonly correctionRefs: readonly string[];
  readonly environmentClass: string;
  readonly deviceClass?: string;
  readonly taskTypeId: string;
  readonly sourceEpisodeRefs: readonly string[];
  readonly goalLineageHash: string;
  readonly snapshotCompleteness: number;
  readonly contentHash: string;
}

export interface ReplayDatasetSourceRange {
  readonly from: string;
  readonly to: string;
}

export interface ReplayDatasetManifest {
  readonly datasetId: string;
  readonly datasetVersion: number;
  readonly purpose: ReplayDatasetPurpose;
  readonly tenantId: string;
  readonly taskTypeIds: readonly string[];
  readonly caseRefs: readonly string[];
  readonly splitPolicyVersion: string;
  readonly sourceRange: ReplayDatasetSourceRange;
  readonly sourceHash: string;
  readonly contentHash: string;
  readonly leakageCheckRef: string;
  readonly createdAt: string;
}

export type ArtifactValidationType = 'static' | 'replay' | 'simulation' | 'shadow' | 'revalidation';
export type ArtifactValidationRunStatus = 'pending' | 'running' | 'passed' | 'failed';

export interface ArtifactValidationRun {
  readonly validationRunId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly validationType: ArtifactValidationType;
  readonly datasetRef: string;
  readonly status: ArtifactValidationRunStatus;
  readonly result?: string;
  readonly metrics: Readonly<Record<string, number>>;
  readonly counterexampleRefs: readonly string[];
  readonly startedAt: string;
  readonly completedAt?: string;
}

export type ArtifactValidationResultType = 'static' | 'replay' | 'counterfactual';
export type ArtifactValidationResultStatus = 'passed' | 'failed' | 'needs_more_data' | 'unsafe';

export interface ArtifactValidationResult {
  readonly validationRunId: string;
  readonly artifactRef: string;
  readonly datasetRef: string;
  readonly validationType: ArtifactValidationResultType;
  readonly metrics: Readonly<Record<string, number>>;
  readonly failureRefs: readonly string[];
  readonly counterexampleRefs: readonly string[];
  readonly unsafe: boolean;
  readonly result: ArtifactValidationResultStatus;
  readonly validatorVersion: string;
  readonly metricCatalogVersion: string;
  readonly artifactHash: string;
  readonly datasetHash: string;
  readonly resultHash: string;
  readonly completedAt: string;
}

export const ARTIFACT_VALIDATION_FAILURE_CATEGORIES = Object.freeze([
  'schema',
  'criterion_coverage',
  'policy_violation',
  'unsafe_allow',
  'missed_confirmation',
  'capability_gap',
  'readiness_gap',
  'side_effect_attempt',
  'plan_invalid',
  'outcome_regression',
  'snapshot_incomplete',
  'unknown',
] as const);

export type ArtifactValidationFailureCategory =
  (typeof ARTIFACT_VALIDATION_FAILURE_CATEGORIES)[number];
export type ArtifactValidationFailureSeverity = 'info' | 'minor' | 'major' | 'critical';

export interface ArtifactValidationFailure {
  readonly failureId: string;
  readonly validationRunRef: string;
  readonly replayCaseRef: string;
  readonly category: ArtifactValidationFailureCategory;
  readonly severity: ArtifactValidationFailureSeverity;
  readonly expectedRef?: string;
  readonly actualRef?: string;
  readonly evidenceRefs: readonly string[];
  readonly explanation: string;
}

export type ArtifactCounterexampleStatus = 'recorded' | 'reviewed' | 'superseded';

export interface ArtifactCounterexample {
  readonly counterexampleId: string;
  readonly artifactRef: string;
  readonly replayCaseRef: string;
  readonly failureRef: string;
  readonly conditionFingerprint: string;
  readonly environmentClass: string;
  readonly failureBoundaryCandidate: JsonValue;
  readonly sourceRefs: readonly string[];
  readonly status: ArtifactCounterexampleStatus;
  readonly createdAt: string;
}

export function createArtifactReplayCase(input: ArtifactReplayCase): ArtifactReplayCase {
  const code = 'ARTIFACT_REPLAY_CASE_INVALID' as const;
  assertExactKeys(
    input,
    [
      'replayCaseId',
      'tenantId',
      'requestSnapshotRef',
      'goalContractSnapshotRef',
      'capabilityCatalogSnapshotRef',
      'worldStateSnapshotRef',
      'policySnapshotRef',
      'readinessSnapshotRef',
      'acceptedPlanSnapshotRef',
      'executionTraceSnapshotRef',
      'outcomeSnapshotRef',
      'correctionRefs',
      'environmentClass',
      'deviceClass',
      'taskTypeId',
      'sourceEpisodeRefs',
      'goalLineageHash',
      'snapshotCompleteness',
      'contentHash',
    ],
    code,
  );
  for (const field of [
    'replayCaseId',
    'tenantId',
    'requestSnapshotRef',
    'goalContractSnapshotRef',
    'capabilityCatalogSnapshotRef',
    'policySnapshotRef',
    'outcomeSnapshotRef',
    'environmentClass',
    'taskTypeId',
  ] as const) {
    assertIdentifier(input[field], field, code);
  }
  for (const field of [
    'worldStateSnapshotRef',
    'readinessSnapshotRef',
    'acceptedPlanSnapshotRef',
    'executionTraceSnapshotRef',
    'deviceClass',
  ] as const) {
    if (input[field] !== undefined) assertIdentifier(input[field], field, code);
  }
  const correctionRefs = freezeRefs(input.correctionRefs, 'correctionRefs', code);
  const sourceEpisodeRefs = freezeRefs(input.sourceEpisodeRefs, 'sourceEpisodeRefs', code, true);
  assertHash(input.goalLineageHash, 'goalLineageHash', code);
  assertUnitInterval(input.snapshotCompleteness, 'snapshotCompleteness', code);
  assertHash(input.contentHash, 'contentHash', code);
  return Object.freeze({ ...input, correctionRefs, sourceEpisodeRefs });
}

export function createReplayDatasetManifest(input: ReplayDatasetManifest): ReplayDatasetManifest {
  const code = 'REPLAY_DATASET_MANIFEST_INVALID' as const;
  assertExactKeys(
    input,
    [
      'datasetId',
      'datasetVersion',
      'purpose',
      'tenantId',
      'taskTypeIds',
      'caseRefs',
      'splitPolicyVersion',
      'sourceRange',
      'sourceHash',
      'contentHash',
      'leakageCheckRef',
      'createdAt',
    ],
    code,
  );
  assertIdentifier(input.datasetId, 'datasetId', code);
  if (!Number.isSafeInteger(input.datasetVersion) || input.datasetVersion < 1) {
    invalid(code, 'datasetVersion must be a positive integer.');
  }
  if (
    !['discovery', 'candidate_development', 'promotion_holdout', 'counterexample'].includes(
      input.purpose,
    )
  ) {
    invalid(code, 'purpose is unsupported.');
  }
  assertIdentifier(input.tenantId, 'tenantId', code);
  const taskTypeIds = freezeRefs(input.taskTypeIds, 'taskTypeIds', code, true);
  // A source-deletion successor is an immutable, non-promotable Dataset version and may
  // intentionally contain no remaining Cases. Dataset construction still requires every
  // active purpose to be non-empty before it can become promotion eligible.
  const caseRefs = freezeRefs(input.caseRefs, 'caseRefs', code);
  assertIdentifier(input.splitPolicyVersion, 'splitPolicyVersion', code);
  assertExactKeys(input.sourceRange, ['from', 'to'], code);
  assertTimestamp(input.sourceRange.from, 'sourceRange.from', code);
  assertTimestamp(input.sourceRange.to, 'sourceRange.to', code);
  if (Date.parse(input.sourceRange.from) > Date.parse(input.sourceRange.to)) {
    invalid(code, 'sourceRange is inverted.');
  }
  assertHash(input.sourceHash, 'sourceHash', code);
  assertHash(input.contentHash, 'contentHash', code);
  assertIdentifier(input.leakageCheckRef, 'leakageCheckRef', code);
  assertTimestamp(input.createdAt, 'createdAt', code);
  return Object.freeze({
    ...input,
    taskTypeIds,
    caseRefs,
    sourceRange: Object.freeze({ ...input.sourceRange }),
  });
}

export function createArtifactValidationRun(input: ArtifactValidationRun): ArtifactValidationRun {
  const code = 'ARTIFACT_VALIDATION_RUN_INVALID' as const;
  assertExactKeys(
    input,
    [
      'validationRunId',
      'artifactId',
      'artifactVersion',
      'validationType',
      'datasetRef',
      'status',
      'result',
      'metrics',
      'counterexampleRefs',
      'startedAt',
      'completedAt',
    ],
    code,
  );
  assertIdentifier(input.validationRunId, 'validationRunId', code);
  assertIdentifier(input.artifactId, 'artifactId', code);
  if (!Number.isSafeInteger(input.artifactVersion) || input.artifactVersion < 1) {
    invalid(code, 'artifactVersion must be a positive integer.');
  }
  if (
    !['static', 'replay', 'simulation', 'shadow', 'revalidation'].includes(input.validationType)
  ) {
    invalid(code, 'validationType is unsupported.');
  }
  assertIdentifier(input.datasetRef, 'datasetRef', code);
  if (!['pending', 'running', 'passed', 'failed'].includes(input.status)) {
    invalid(code, 'status is unsupported.');
  }
  const terminal = input.status === 'passed' || input.status === 'failed';
  if (
    terminal !==
    (input.completedAt !== undefined && input.result !== undefined && input.result.length > 0)
  ) {
    invalid(code, 'terminal status requires result and completedAt only.');
  }
  if (input.result !== undefined) assertText(input.result, 'result', code);
  const metrics = freezeMetrics(input.metrics, code);
  const counterexampleRefs = freezeRefs(input.counterexampleRefs, 'counterexampleRefs', code);
  assertTimestamp(input.startedAt, 'startedAt', code);
  if (input.completedAt !== undefined) {
    assertTimestamp(input.completedAt, 'completedAt', code);
    if (Date.parse(input.completedAt) < Date.parse(input.startedAt)) {
      invalid(code, 'completedAt precedes startedAt.');
    }
  }
  return Object.freeze({ ...input, metrics, counterexampleRefs });
}

export function createArtifactValidationResult(
  input: ArtifactValidationResult,
): ArtifactValidationResult {
  const code = 'ARTIFACT_VALIDATION_RESULT_INVALID' as const;
  assertExactKeys(
    input,
    [
      'validationRunId',
      'artifactRef',
      'datasetRef',
      'validationType',
      'metrics',
      'failureRefs',
      'counterexampleRefs',
      'unsafe',
      'result',
      'validatorVersion',
      'metricCatalogVersion',
      'artifactHash',
      'datasetHash',
      'resultHash',
      'completedAt',
    ],
    code,
  );
  for (const field of [
    'validationRunId',
    'artifactRef',
    'datasetRef',
    'validatorVersion',
    'metricCatalogVersion',
  ] as const) {
    assertIdentifier(input[field], field, code);
  }
  if (!['static', 'replay', 'counterfactual'].includes(input.validationType)) {
    invalid(code, 'validationType is unsupported.');
  }
  const metrics = freezeMetrics(input.metrics, code, true);
  const failureRefs = freezeRefs(input.failureRefs, 'failureRefs', code);
  const counterexampleRefs = freezeRefs(input.counterexampleRefs, 'counterexampleRefs', code);
  if (typeof input.unsafe !== 'boolean') invalid(code, 'unsafe must be boolean.');
  if (!['passed', 'failed', 'needs_more_data', 'unsafe'].includes(input.result)) {
    invalid(code, 'result is unsupported.');
  }
  if (input.unsafe !== (input.result === 'unsafe')) {
    invalid(code, 'unsafe flag and result must agree.');
  }
  for (const field of ['artifactHash', 'datasetHash', 'resultHash'] as const) {
    assertHash(input[field], field, code);
  }
  assertTimestamp(input.completedAt, 'completedAt', code);
  return Object.freeze({ ...input, metrics, failureRefs, counterexampleRefs });
}

export function createArtifactValidationFailure(
  input: ArtifactValidationFailure,
): ArtifactValidationFailure {
  const code = 'ARTIFACT_VALIDATION_FAILURE_INVALID' as const;
  assertExactKeys(
    input,
    [
      'failureId',
      'validationRunRef',
      'replayCaseRef',
      'category',
      'severity',
      'expectedRef',
      'actualRef',
      'evidenceRefs',
      'explanation',
    ],
    code,
  );
  for (const field of ['failureId', 'validationRunRef', 'replayCaseRef'] as const) {
    assertIdentifier(input[field], field, code);
  }
  if (!ARTIFACT_VALIDATION_FAILURE_CATEGORIES.includes(input.category)) {
    invalid(code, 'category is unsupported.');
  }
  if (!['info', 'minor', 'major', 'critical'].includes(input.severity)) {
    invalid(code, 'severity is unsupported.');
  }
  if (input.expectedRef !== undefined) assertIdentifier(input.expectedRef, 'expectedRef', code);
  if (input.actualRef !== undefined) assertIdentifier(input.actualRef, 'actualRef', code);
  const evidenceRefs = freezeRefs(input.evidenceRefs, 'evidenceRefs', code, true);
  assertText(input.explanation, 'explanation', code);
  if (input.category === 'side_effect_attempt' && input.severity !== 'critical') {
    invalid(code, 'side-effect attempts must be critical.');
  }
  return Object.freeze({ ...input, evidenceRefs });
}

export function createArtifactCounterexample(
  input: ArtifactCounterexample,
): ArtifactCounterexample {
  const code = 'ARTIFACT_COUNTEREXAMPLE_INVALID' as const;
  assertExactKeys(
    input,
    [
      'counterexampleId',
      'artifactRef',
      'replayCaseRef',
      'failureRef',
      'conditionFingerprint',
      'environmentClass',
      'failureBoundaryCandidate',
      'sourceRefs',
      'status',
      'createdAt',
    ],
    code,
  );
  for (const field of [
    'counterexampleId',
    'artifactRef',
    'replayCaseRef',
    'failureRef',
    'environmentClass',
  ] as const) {
    assertIdentifier(input[field], field, code);
  }
  assertHash(input.conditionFingerprint, 'conditionFingerprint', code);
  const failureBoundaryCandidate = freezeJson(
    input.failureBoundaryCandidate,
    'failureBoundaryCandidate',
    code,
  );
  const sourceRefs = freezeRefs(input.sourceRefs, 'sourceRefs', code, true);
  if (!['recorded', 'reviewed', 'superseded'].includes(input.status)) {
    invalid(code, 'status is unsupported.');
  }
  assertTimestamp(input.createdAt, 'createdAt', code);
  return Object.freeze({ ...input, failureBoundaryCandidate, sourceRefs });
}

function assertExactKeys(
  input: object,
  allowed: readonly string[],
  code: ArtifactDomainErrorCode,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(input).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) invalid(code, `Unknown fields: ${unknown.sort().join(',')}.`);
}

function assertIdentifier(
  value: unknown,
  field: string,
  code: ArtifactDomainErrorCode,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 512 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value)
  ) {
    invalid(code, `${field} is not a bounded identifier.`);
  }
}

function assertText(value: unknown, field: string, code: ArtifactDomainErrorCode): void {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > MAX_TEXT) {
    invalid(code, `${field} is not bounded text.`);
  }
}

function assertHash(value: unknown, field: string, code: ArtifactDomainErrorCode): void {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    invalid(code, `${field} must be a SHA-256 value.`);
  }
}

function assertTimestamp(value: unknown, field: string, code: ArtifactDomainErrorCode): void {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    invalid(code, `${field} must be a canonical timestamp.`);
  }
}

function assertUnitInterval(value: unknown, field: string, code: ArtifactDomainErrorCode): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    invalid(code, `${field} must be in [0,1].`);
  }
}

function freezeRefs(
  value: readonly string[],
  field: string,
  code: ArtifactDomainErrorCode,
  required = false,
): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_REFS || (required && value.length === 0)) {
    invalid(code, `${field} is not a bounded reference list.`);
  }
  const refs = value.map((item) => {
    assertIdentifier(item, field, code);
    return item;
  });
  if (new Set(refs).size !== refs.length) invalid(code, `${field} contains duplicates.`);
  return Object.freeze(refs);
}

function freezeMetrics(
  value: unknown,
  code: ArtifactDomainErrorCode,
  required = false,
): Readonly<Record<string, number>> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid(code, 'metrics must be a plain object.');
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_METRICS || (required && entries.length === 0)) {
    invalid(code, 'metrics count is invalid.');
  }
  const metrics: Record<string, number> = {};
  for (const [key, metric] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    assertIdentifier(key, 'metric', code);
    if (typeof metric !== 'number' || !Number.isFinite(metric)) {
      invalid(code, `metric ${key} is not finite.`);
    }
    metrics[key] = metric;
  }
  return Object.freeze(metrics);
}

function freezeJson(
  value: JsonValue,
  field: string,
  code: ArtifactDomainErrorCode,
  depth = 0,
  count = { value: 0 },
): JsonValue {
  count.value += 1;
  if (depth > MAX_JSON_DEPTH || count.value > MAX_JSON_ITEMS) {
    invalid(code, `${field} exceeds JSON bounds.`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(code, `${field} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      (value as readonly JsonValue[]).map((item) =>
        freezeJson(item, field, code, depth + 1, count),
      ),
    );
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid(code, `${field} contains a non-JSON value.`);
  }
  const result: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (
      key.length < 1 ||
      key.length > 256 ||
      ['__proto__', 'prototype', 'constructor'].includes(key)
    ) {
      invalid(code, `${field} contains an unsafe key.`);
    }
    result[key] = freezeJson(item, field, code, depth + 1, count);
  }
  return Object.freeze(result);
}

function invalid(code: ArtifactDomainErrorCode, message: string): never {
  throw new ArtifactDomainError(code, message);
}
