import { ArtifactDomainError, type ArtifactDomainErrorCode } from './errors.js';
import type { JsonValue } from './contracts.js';

export const EXPERIENCE_COMPILATION_CONTRACT_VERSION = '1.1' as const;
export const EXPERIENCE_NORMALIZER_VERSION = 'sdar-experience-normalizer/1.1' as const;
export const PROCESS_MINING_ALGORITHM_VERSION = 'sdar-deterministic-process-miner/1.1' as const;

export const EXPERIENCE_COMPILATION_SCHEMA_HASHES = Object.freeze({
  ExperienceTrace: 'd929a15aa9fc268bd713ddf9d44d8b1a856d8edc8acf8650ddc1b8511945c4f9',
  ExperienceTraceEvent: '8b9742001edfbbe7a6dc93971d5f08dff002f32d56a7ca124c5b54e59133a878',
  CohortDefinition: '864abd2238982993ced478f96be4a65eb53b6813f8a984b2b1c05175a44a4f90',
  ProcessVariant: 'f8f772dfbc589945e691bb9052b0164941e62dab0f7ac68f7d8021c16010fa86',
  DiscoveredProcessPattern: 'de261049c901dc1e19fcce26adc665149f1cfab9c7b83a2f25e2a6b5fbd70eac',
  WorkflowPattern: '5ff2cbf281b8c298e1ae972879c4c7ffc7264eb5e5358912c4c46de94080f99b',
} as const);

export const EXPERIENCE_TRACE_EVENT_TYPES = Object.freeze([
  'goal_created',
  'goal_contract_confirmed',
  'plan_created',
  'plan_confirmed',
  'skill_goal_ready',
  'skill_attempt_started',
  'skill_attempt_completed',
  'workflow_waiting',
  'workflow_failed',
  'recovery_started',
  'human_intervention',
  'plan_revised',
  'business_event_observed',
  'goal_completed',
  'goal_failed',
] as const);

export type ExperienceTraceEventType = (typeof EXPERIENCE_TRACE_EVENT_TYPES)[number];
export type ExperienceTraceActorType = 'user' | 'agent' | 'runtime' | 'provider';

export interface ExperienceTraceEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly eventType: ExperienceTraceEventType;
  readonly actorType: ExperienceTraceActorType;
  readonly capabilityRefs: readonly string[];
  readonly authorityRefs: readonly string[];
  readonly parentEventRefs: readonly string[];
  readonly concurrencyGroup?: string;
  readonly branchRef?: string;
  readonly payloadSummary: JsonValue;
}

export interface ExperienceTraceBody {
  readonly schemaVersion: typeof EXPERIENCE_COMPILATION_CONTRACT_VERSION;
  readonly tenantId: string;
  readonly events: readonly ExperienceTraceEvent[];
  readonly correctionRefs: readonly string[];
  readonly outcomeRef?: string;
  readonly outcomeStatus: 'succeeded' | 'failed' | 'partial' | 'unknown';
  readonly missingFactCodes: readonly string[];
  readonly environmentClass: string;
  readonly deviceClass?: string;
}

export interface ExperienceTrace {
  readonly traceId: string;
  readonly sourceEpisodeId: string;
  readonly taskTypeRefs: readonly string[];
  readonly goalFingerprint: string;
  readonly capabilityFingerprint: string;
  readonly environmentFingerprint: string;
  readonly trace: ExperienceTraceBody;
  readonly completeness: number;
  readonly dataClassification: 'public' | 'internal' | 'user_scoped' | 'restricted';
  readonly normalizerVersion: string;
  readonly sourceHash: string;
  readonly createdAt: string;
}

export interface CohortTimeRange {
  readonly from: string;
  readonly to: string;
}

export interface CohortDefinition {
  readonly tenantId: string;
  readonly taskTypeId: string;
  readonly goalFingerprint?: string;
  readonly capabilityFingerprint?: string;
  readonly environmentClass?: string;
  readonly deviceClass?: string;
  readonly timeRange?: CohortTimeRange;
  readonly minimumCompleteness: number;
}

export interface ProcessVariant {
  readonly variantId: string;
  readonly activitySequence: readonly string[];
  readonly concurrencyGroups: readonly (readonly string[])[];
  readonly branchSequence: readonly string[];
  readonly occurrenceCount: number;
  readonly traceRefs: readonly string[];
  readonly successCount: number;
  readonly failureCount: number;
}

export interface OrderingConstraint {
  readonly predecessorActivity: string;
  readonly successorActivity: string;
  readonly relation: 'direct_follows' | 'precedes';
  readonly supportRefs: readonly string[];
  readonly contradictionRefs: readonly string[];
}

export interface ParallelCandidate {
  readonly activityRefs: readonly string[];
  readonly evidenceType: 'explicit_concurrency' | 'partial_order' | 'dependency_independence';
  readonly supportRefs: readonly string[];
  readonly contradictionRefs: readonly string[];
}

export interface RecoveryPattern {
  readonly triggerActivity: string;
  readonly resumeActivity?: string;
  readonly activitySequence: readonly string[];
  readonly supportRefs: readonly string[];
}

export interface FailureVariant {
  readonly activitySequence: readonly string[];
  readonly failureActivity: string;
  readonly traceRefs: readonly string[];
  readonly count: number;
}

export interface PatternQuality {
  readonly support: number;
  readonly successRate: number;
  readonly traceCoverage: number;
  readonly fitness: number;
  readonly precisionProxy: number;
  readonly environmentCoverage: number;
  readonly contradictionRate: number;
  readonly generalization: number;
  readonly mandatoryThreshold: number;
}

export interface DiscoveredProcessPattern {
  readonly patternId: string;
  readonly cohortFingerprint: string;
  readonly algorithmVersion: string;
  readonly mandatoryActivities: readonly string[];
  readonly optionalActivities: readonly string[];
  readonly orderingConstraints: readonly OrderingConstraint[];
  readonly parallelCandidates: readonly ParallelCandidate[];
  readonly recoveryBranches: readonly RecoveryPattern[];
  readonly failureVariants: readonly FailureVariant[];
  readonly supportRefs: readonly string[];
  readonly contradictionRefs: readonly string[];
  readonly environmentCoverage: readonly string[];
  readonly quality: PatternQuality;
}

export interface ActivityPattern {
  readonly activity: string;
  readonly required: boolean;
  readonly supportRate: number;
  readonly capabilityRefs: readonly string[];
}

export interface DependencyPattern {
  readonly predecessorActivity: string;
  readonly successorActivity: string;
  readonly relation: 'direct_follows' | 'precedes' | 'parallel';
  readonly supportRefs: readonly string[];
  readonly contradictionRefs: readonly string[];
}

export interface WorkflowPattern {
  readonly workflowPatternId: string;
  readonly taskTypeId: string;
  readonly activityPatterns: readonly ActivityPattern[];
  readonly dependencyPatterns: readonly DependencyPattern[];
  readonly recoveryPatterns: readonly RecoveryPattern[];
  readonly sourcePatternRef: string;
  readonly sourceTraceRefs: readonly string[];
  readonly quality: PatternQuality;
}

export function createExperienceTraceEvent(input: ExperienceTraceEvent): ExperienceTraceEvent {
  assertExactKeys(
    input,
    [
      'eventId',
      'sequence',
      'occurredAt',
      'eventType',
      'actorType',
      'capabilityRefs',
      'authorityRefs',
      'parentEventRefs',
      'concurrencyGroup',
      'branchRef',
      'payloadSummary',
    ],
    ['concurrencyGroup', 'branchRef'],
    'ExperienceTraceEvent',
  );
  assertIdentifier(input.eventId, 'eventId');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    invalid('EXPERIENCE_TRACE_EVENT_INVALID', 'Event sequence must be a non-negative integer.');
  }
  assertTimestamp(input.occurredAt, 'occurredAt');
  if (!EXPERIENCE_TRACE_EVENT_TYPES.includes(input.eventType)) {
    invalid('EXPERIENCE_TRACE_EVENT_INVALID', 'Unknown Experience Trace event type.');
  }
  if (!['user', 'agent', 'runtime', 'provider'].includes(input.actorType)) {
    invalid('EXPERIENCE_TRACE_EVENT_INVALID', 'Unknown Experience Trace actor type.');
  }
  if (input.concurrencyGroup !== undefined) {
    assertIdentifier(input.concurrencyGroup, 'concurrencyGroup');
  }
  if (input.branchRef !== undefined) assertIdentifier(input.branchRef, 'branchRef');
  const event = {
    ...input,
    capabilityRefs: freezeIdentifiers(input.capabilityRefs, 'capabilityRefs'),
    authorityRefs: freezeIdentifiers(input.authorityRefs, 'authorityRefs'),
    parentEventRefs: freezeIdentifiers(input.parentEventRefs, 'parentEventRefs'),
    payloadSummary: freezeJson(input.payloadSummary, 0),
  };
  return Object.freeze(event);
}

export function createExperienceTrace(input: ExperienceTrace): ExperienceTrace {
  assertExactKeys(
    input,
    [
      'traceId',
      'sourceEpisodeId',
      'taskTypeRefs',
      'goalFingerprint',
      'capabilityFingerprint',
      'environmentFingerprint',
      'trace',
      'completeness',
      'dataClassification',
      'normalizerVersion',
      'sourceHash',
      'createdAt',
    ],
    [],
    'ExperienceTrace',
  );
  assertIdentifier(input.traceId, 'traceId');
  assertIdentifier(input.sourceEpisodeId, 'sourceEpisodeId');
  assertFingerprint(input.goalFingerprint, 'goalFingerprint');
  assertFingerprint(input.capabilityFingerprint, 'capabilityFingerprint');
  assertFingerprint(input.environmentFingerprint, 'environmentFingerprint');
  assertHash(input.sourceHash, 'sourceHash');
  assertTimestamp(input.createdAt, 'createdAt');
  assertUnitInterval(input.completeness, 'completeness');
  if (!['public', 'internal', 'user_scoped', 'restricted'].includes(input.dataClassification)) {
    invalid('EXPERIENCE_TRACE_INVALID', 'Unknown Trace data classification.');
  }
  if (input.normalizerVersion.trim().length < 1 || input.normalizerVersion.length > 128) {
    invalid('EXPERIENCE_TRACE_INVALID', 'Normalizer version is invalid.');
  }
  const trace = createTraceBody(input.trace);
  const seen = new Set<string>();
  for (const [index, event] of trace.events.entries()) {
    if (event.sequence !== index) {
      invalid('EXPERIENCE_TRACE_INVALID', 'Trace event sequences must be contiguous and ordered.');
    }
    if (seen.has(event.eventId)) {
      invalid('EXPERIENCE_TRACE_INVALID', 'Trace event IDs must be unique.');
    }
    for (const parent of event.parentEventRefs) {
      if (!seen.has(parent)) {
        invalid('EXPERIENCE_TRACE_INVALID', 'Trace parent events must precede their children.');
      }
    }
    seen.add(event.eventId);
  }
  return Object.freeze({
    ...input,
    taskTypeRefs: freezeIdentifiers(input.taskTypeRefs, 'taskTypeRefs'),
    trace,
  });
}

export function createCohortDefinition(input: CohortDefinition): CohortDefinition {
  assertExactKeys(
    input,
    [
      'tenantId',
      'taskTypeId',
      'goalFingerprint',
      'capabilityFingerprint',
      'environmentClass',
      'deviceClass',
      'timeRange',
      'minimumCompleteness',
    ],
    ['goalFingerprint', 'capabilityFingerprint', 'environmentClass', 'deviceClass', 'timeRange'],
    'CohortDefinition',
  );
  assertIdentifier(input.tenantId, 'tenantId');
  assertIdentifier(input.taskTypeId, 'taskTypeId');
  if (input.goalFingerprint !== undefined) {
    assertFingerprint(input.goalFingerprint, 'goalFingerprint');
  }
  if (input.capabilityFingerprint !== undefined) {
    assertFingerprint(input.capabilityFingerprint, 'capabilityFingerprint');
  }
  if (input.environmentClass !== undefined) {
    assertIdentifier(input.environmentClass, 'environmentClass');
  }
  if (input.deviceClass !== undefined) assertIdentifier(input.deviceClass, 'deviceClass');
  assertUnitInterval(input.minimumCompleteness, 'minimumCompleteness');
  let timeRange: CohortTimeRange | undefined;
  if (input.timeRange !== undefined) {
    assertTimestamp(input.timeRange.from, 'timeRange.from');
    assertTimestamp(input.timeRange.to, 'timeRange.to');
    if (Date.parse(input.timeRange.from) > Date.parse(input.timeRange.to)) {
      invalid('COHORT_DEFINITION_INVALID', 'Cohort time range is reversed.');
    }
    timeRange = Object.freeze({ ...input.timeRange });
  }
  return Object.freeze({ ...input, ...(timeRange === undefined ? {} : { timeRange }) });
}

export function createProcessVariant(input: ProcessVariant): ProcessVariant {
  assertExactKeys(
    input,
    [
      'variantId',
      'activitySequence',
      'concurrencyGroups',
      'branchSequence',
      'occurrenceCount',
      'traceRefs',
      'successCount',
      'failureCount',
    ],
    [],
    'ProcessVariant',
  );
  assertIdentifier(input.variantId, 'variantId');
  if (input.activitySequence.length === 0) {
    invalid('PROCESS_VARIANT_INVALID', 'A Process Variant requires an activity sequence.');
  }
  for (const field of ['occurrenceCount', 'successCount', 'failureCount'] as const) {
    if (!Number.isSafeInteger(input[field]) || input[field] < 0) {
      invalid('PROCESS_VARIANT_INVALID', `${field} must be a non-negative integer.`);
    }
  }
  if (
    input.occurrenceCount < 1 ||
    input.successCount + input.failureCount > input.occurrenceCount
  ) {
    invalid('PROCESS_VARIANT_INVALID', 'Process Variant outcome counts are inconsistent.');
  }
  return Object.freeze({
    ...input,
    activitySequence: freezeIdentifiers(input.activitySequence, 'activitySequence'),
    concurrencyGroups: Object.freeze(
      input.concurrencyGroups.map((group) => freezeIdentifiers(group, 'concurrencyGroups')),
    ),
    branchSequence: freezeIdentifiers(input.branchSequence, 'branchSequence'),
    traceRefs: freezeIdentifiers(input.traceRefs, 'traceRefs'),
  });
}

export function createDiscoveredProcessPattern(
  input: DiscoveredProcessPattern,
): DiscoveredProcessPattern {
  assertExactKeys(
    input,
    [
      'patternId',
      'cohortFingerprint',
      'algorithmVersion',
      'mandatoryActivities',
      'optionalActivities',
      'orderingConstraints',
      'parallelCandidates',
      'recoveryBranches',
      'failureVariants',
      'supportRefs',
      'contradictionRefs',
      'environmentCoverage',
      'quality',
    ],
    [],
    'DiscoveredProcessPattern',
  );
  assertIdentifier(input.patternId, 'patternId');
  assertFingerprint(input.cohortFingerprint, 'cohortFingerprint');
  assertVersion(input.algorithmVersion, 'algorithmVersion');
  const mandatory = freezeIdentifiers(input.mandatoryActivities, 'mandatoryActivities');
  const optional = freezeIdentifiers(input.optionalActivities, 'optionalActivities');
  if (mandatory.some((activity) => optional.includes(activity))) {
    invalid(
      'DISCOVERED_PROCESS_PATTERN_INVALID',
      'Mandatory and optional activities must be disjoint.',
    );
  }
  const supportRefs = freezeIdentifiers(input.supportRefs, 'supportRefs');
  if (supportRefs.length === 0) {
    invalid(
      'DISCOVERED_PROCESS_PATTERN_INVALID',
      'A discovered pattern requires support evidence.',
    );
  }
  return Object.freeze({
    ...input,
    mandatoryActivities: mandatory,
    optionalActivities: optional,
    orderingConstraints: Object.freeze(
      input.orderingConstraints.map((item) => createOrderingConstraint(item)),
    ),
    parallelCandidates: Object.freeze(
      input.parallelCandidates.map((item) => createParallelCandidate(item)),
    ),
    recoveryBranches: Object.freeze(
      input.recoveryBranches.map((item) => createRecoveryPattern(item)),
    ),
    failureVariants: Object.freeze(input.failureVariants.map((item) => createFailureVariant(item))),
    supportRefs,
    contradictionRefs: freezeIdentifiers(input.contradictionRefs, 'contradictionRefs'),
    environmentCoverage: freezeIdentifiers(input.environmentCoverage, 'environmentCoverage'),
    quality: createPatternQuality(input.quality),
  });
}

export function createWorkflowPattern(input: WorkflowPattern): WorkflowPattern {
  assertExactKeys(
    input,
    [
      'workflowPatternId',
      'taskTypeId',
      'activityPatterns',
      'dependencyPatterns',
      'recoveryPatterns',
      'sourcePatternRef',
      'sourceTraceRefs',
      'quality',
    ],
    [],
    'WorkflowPattern',
  );
  assertIdentifier(input.workflowPatternId, 'workflowPatternId');
  assertIdentifier(input.taskTypeId, 'taskTypeId');
  assertIdentifier(input.sourcePatternRef, 'sourcePatternRef');
  const sourceTraceRefs = freezeIdentifiers(input.sourceTraceRefs, 'sourceTraceRefs');
  if (sourceTraceRefs.length === 0) {
    invalid('WORKFLOW_PATTERN_INVALID', 'A Workflow Pattern requires source Trace references.');
  }
  return Object.freeze({
    ...input,
    activityPatterns: Object.freeze(input.activityPatterns.map(createActivityPattern)),
    dependencyPatterns: Object.freeze(input.dependencyPatterns.map(createDependencyPattern)),
    recoveryPatterns: Object.freeze(input.recoveryPatterns.map(createRecoveryPattern)),
    sourceTraceRefs,
    quality: createPatternQuality(input.quality),
  });
}

function createTraceBody(
  input: Omit<ExperienceTraceBody, 'schemaVersion'> & { readonly schemaVersion: string },
): ExperienceTraceBody {
  if (input.schemaVersion !== EXPERIENCE_COMPILATION_CONTRACT_VERSION) {
    invalid('EXPERIENCE_TRACE_INVALID', 'Unsupported Trace schema version.');
  }
  assertIdentifier(input.tenantId, 'tenantId');
  assertIdentifier(input.environmentClass, 'environmentClass');
  if (input.deviceClass !== undefined) assertIdentifier(input.deviceClass, 'deviceClass');
  if (!['succeeded', 'failed', 'partial', 'unknown'].includes(input.outcomeStatus)) {
    invalid('EXPERIENCE_TRACE_INVALID', 'Unknown Trace Outcome status.');
  }
  if (input.outcomeRef !== undefined) assertIdentifier(input.outcomeRef, 'outcomeRef');
  return Object.freeze({
    ...input,
    schemaVersion: EXPERIENCE_COMPILATION_CONTRACT_VERSION,
    events: Object.freeze(input.events.map(createExperienceTraceEvent)),
    correctionRefs: freezeIdentifiers(input.correctionRefs, 'correctionRefs'),
    missingFactCodes: freezeIdentifiers(input.missingFactCodes, 'missingFactCodes'),
  });
}

function createOrderingConstraint(input: OrderingConstraint): OrderingConstraint {
  assertIdentifier(input.predecessorActivity, 'predecessorActivity');
  assertIdentifier(input.successorActivity, 'successorActivity');
  if (input.predecessorActivity === input.successorActivity) {
    invalid('DISCOVERED_PROCESS_PATTERN_INVALID', 'Ordering constraint cannot self-reference.');
  }
  if (!['direct_follows', 'precedes'].includes(input.relation)) {
    invalid('DISCOVERED_PROCESS_PATTERN_INVALID', 'Unknown ordering relation.');
  }
  return Object.freeze({
    ...input,
    supportRefs: freezeIdentifiers(input.supportRefs, 'supportRefs'),
    contradictionRefs: freezeIdentifiers(input.contradictionRefs, 'contradictionRefs'),
  });
}

function createParallelCandidate(input: ParallelCandidate): ParallelCandidate {
  const activityRefs = freezeIdentifiers(input.activityRefs, 'activityRefs');
  if (activityRefs.length < 2) {
    invalid('DISCOVERED_PROCESS_PATTERN_INVALID', 'Parallel evidence requires two activities.');
  }
  if (
    !['explicit_concurrency', 'partial_order', 'dependency_independence'].includes(
      input.evidenceType,
    )
  ) {
    invalid('DISCOVERED_PROCESS_PATTERN_INVALID', 'Unknown parallel evidence type.');
  }
  return Object.freeze({
    ...input,
    activityRefs,
    supportRefs: freezeIdentifiers(input.supportRefs, 'supportRefs'),
    contradictionRefs: freezeIdentifiers(input.contradictionRefs, 'contradictionRefs'),
  });
}

function createRecoveryPattern(input: RecoveryPattern): RecoveryPattern {
  assertIdentifier(input.triggerActivity, 'triggerActivity');
  if (input.resumeActivity !== undefined) assertIdentifier(input.resumeActivity, 'resumeActivity');
  return Object.freeze({
    ...input,
    activitySequence: freezeIdentifiers(input.activitySequence, 'activitySequence'),
    supportRefs: freezeIdentifiers(input.supportRefs, 'supportRefs'),
  });
}

function createFailureVariant(input: FailureVariant): FailureVariant {
  assertIdentifier(input.failureActivity, 'failureActivity');
  if (!Number.isSafeInteger(input.count) || input.count < 1) {
    invalid('DISCOVERED_PROCESS_PATTERN_INVALID', 'Failure Variant count must be positive.');
  }
  return Object.freeze({
    ...input,
    activitySequence: freezeIdentifiers(input.activitySequence, 'activitySequence'),
    traceRefs: freezeIdentifiers(input.traceRefs, 'traceRefs'),
  });
}

function createPatternQuality(input: PatternQuality): PatternQuality {
  for (const field of [
    'support',
    'successRate',
    'traceCoverage',
    'fitness',
    'precisionProxy',
    'environmentCoverage',
    'contradictionRate',
    'generalization',
    'mandatoryThreshold',
  ] as const) {
    assertUnitInterval(input[field], field);
  }
  return Object.freeze({ ...input });
}

function createActivityPattern(input: ActivityPattern): ActivityPattern {
  assertIdentifier(input.activity, 'activity');
  assertUnitInterval(input.supportRate, 'supportRate');
  return Object.freeze({
    ...input,
    capabilityRefs: freezeIdentifiers(input.capabilityRefs, 'capabilityRefs'),
  });
}

function createDependencyPattern(input: DependencyPattern): DependencyPattern {
  assertIdentifier(input.predecessorActivity, 'predecessorActivity');
  assertIdentifier(input.successorActivity, 'successorActivity');
  if (!['direct_follows', 'precedes', 'parallel'].includes(input.relation)) {
    invalid('WORKFLOW_PATTERN_INVALID', 'Unknown dependency relation.');
  }
  return Object.freeze({
    ...input,
    supportRefs: freezeIdentifiers(input.supportRefs, 'supportRefs'),
    contradictionRefs: freezeIdentifiers(input.contradictionRefs, 'contradictionRefs'),
  });
}

function freezeIdentifiers(values: readonly string[], field: string): readonly string[] {
  if (values.length > 4096)
    invalid('EXPERIENCE_COMPILATION_BOUND_EXCEEDED', `${field} is too large.`);
  const normalized = values.map((value) => {
    assertIdentifier(value, field);
    return value.trim();
  });
  if (new Set(normalized).size !== normalized.length) {
    invalid('EXPERIENCE_COMPILATION_DUPLICATE', `${field} contains duplicates.`);
  }
  return Object.freeze(normalized);
}

function freezeJson(value: JsonValue, depth: number): JsonValue {
  if (depth > 32) invalid('EXPERIENCE_COMPILATION_BOUND_EXCEEDED', 'JSON depth exceeds 32.');
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (isJsonArray(value)) {
    if (value.length > 4096) {
      invalid('EXPERIENCE_COMPILATION_BOUND_EXCEEDED', 'JSON array exceeds 4096 entries.');
    }
    return Object.freeze(value.map((item) => freezeJson(item, depth + 1)));
  }
  if (typeof value !== 'object') {
    invalid('EXPERIENCE_COMPILATION_JSON_INVALID', 'Only finite JSON data is allowed.');
  }
  const entries = Object.entries(value);
  if (entries.length > 4096) {
    invalid('EXPERIENCE_COMPILATION_BOUND_EXCEEDED', 'JSON object exceeds 4096 entries.');
  }
  return Object.freeze(
    Object.fromEntries(entries.map(([key, item]) => [key, freezeJson(item, depth + 1)])),
  );
}

function assertIdentifier(value: string, field: string): void {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 256 || containsControlCharacter(normalized)) {
    invalid('EXPERIENCE_COMPILATION_ID_INVALID', `${field} is invalid.`);
  }
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) return true;
  }
  return false;
}

function assertHash(value: string, field: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    invalid('EXPERIENCE_COMPILATION_HASH_INVALID', `${field} must be a canonical SHA-256 value.`);
  }
}

function assertFingerprint(value: string, field: string): void {
  assertHash(value, field);
}

function assertTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    invalid('EXPERIENCE_COMPILATION_TIMESTAMP_INVALID', `${field} must be an ISO timestamp.`);
  }
}

function assertUnitInterval(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    invalid('EXPERIENCE_COMPILATION_NUMBER_INVALID', `${field} must be between zero and one.`);
  }
}

function assertVersion(value: string, field: string): void {
  if (!/^[a-z][a-z0-9._/-]{0,127}$/u.test(value)) {
    invalid('EXPERIENCE_COMPILATION_VERSION_INVALID', `${field} is invalid.`);
  }
}

function assertExactKeys(
  value: object,
  allowed: readonly string[],
  optional: readonly string[],
  contractName: string,
): void {
  const keys = Object.keys(value);
  const required = allowed.filter((key) => !optional.includes(key));
  if (
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    invalid(
      'EXPERIENCE_COMPILATION_JSON_INVALID',
      `${contractName} fields do not match the frozen contract.`,
    );
  }
}

function invalid(code: ArtifactDomainErrorCode, message: string): never {
  throw new ArtifactDomainError(code, message);
}
