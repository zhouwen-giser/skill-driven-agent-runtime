import { ArtifactDomainError, type ArtifactDomainErrorCode } from './errors.js';
import type { ConditionExpression, JsonValue } from './contracts.js';
import { assertConditionExpression } from './validation.js';

export const EXPERIENCE_COMPILATION_CONTRACT_VERSION = '1.2' as const;
export const EXPERIENCE_NORMALIZER_VERSION = 'sdar-experience-normalizer/1.2' as const;
export const PROCESS_MINING_ALGORITHM_VERSION = 'sdar-deterministic-process-miner/1.2' as const;
const DEFAULT_IDENTIFIER_COLLECTION_LIMIT = 4_096;
const PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT = 65_536;

export const EXPERIENCE_COMPILATION_SCHEMA_HASHES = Object.freeze({
  ExperienceTrace: 'd929a15aa9fc268bd713ddf9d44d8b1a856d8edc8acf8650ddc1b8511945c4f9',
  ExperienceActivityRef: 'c8fcce49423d402c5cc202b588cbf8687c0c2cf4c8cd2f3ee15b723512e287e0',
  ExperienceTraceEvent: '4bd9445b70c69e82956eb3edd8dbad570bc0e4333ab5cb1908a816ad4a8e6425',
  CohortDefinition: '864abd2238982993ced478f96be4a65eb53b6813f8a984b2b1c05175a44a4f90',
  ProcessVariant: 'eabdc0a2265c302b5da9cd456fed06e8396c933ce7fd5ae6a25b75fa73c0bd17',
  DiscoveredProcessPattern: 'de261049c901dc1e19fcce26adc665149f1cfab9c7b83a2f25e2a6b5fbd70eac',
  WorkflowPattern: 'a81cd287ea6d035e1d668d4ea17d4987a9789a10a6ec0744f64d8065951d2e11',
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
export type ExperienceActivityKind =
  | 'skill_goal'
  | 'plan_node'
  | 'provider_operation'
  | 'observation'
  | 'verification'
  | 'reasoning'
  | 'human_gate'
  | 'unknown';

export interface ExperienceActivityRef {
  readonly activityKey: string;
  readonly activityKind: ExperienceActivityKind;
  readonly objectiveSummary: string;
  readonly sourcePlanNodeRef?: string;
  readonly sourceSkillGoalRef?: string;
  readonly sourceAttemptRef?: string;
  readonly operationRef?: string;
  readonly capabilityRefs: readonly string[];
  readonly effectRefs: readonly string[];
}

export interface ExperienceTraceEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly eventType: ExperienceTraceEventType;
  readonly actorType: ExperienceTraceActorType;
  readonly activity?: ExperienceActivityRef | null;
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
  readonly activityKindSequence: readonly ExperienceActivityKind[];
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
  readonly triggerActivityKey: string;
  readonly resumeActivityKey?: string;
  readonly activitySequence: readonly string[];
  readonly requiredCapabilityRefs: readonly string[];
  readonly supportRefs: readonly string[];
}

export interface FailureVariant {
  readonly activitySequence: readonly string[];
  readonly failureActivity: string;
  readonly traceRefs: readonly string[];
  readonly count: number;
}

export interface PatternQuality {
  readonly supportCount: number;
  readonly totalTraceCount: number;
  readonly supportRate: number;
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
  readonly activityKey: string;
  readonly activityKind: ExperienceActivityKind;
  readonly objectiveSummary: string;
  readonly required: boolean;
  readonly supportCount: number;
  readonly supportRate: number;
  readonly capabilityRefs: readonly string[];
  readonly effectRefs: readonly string[];
  readonly lifecycleEventTypes: readonly string[];
}

export interface DependencyPattern {
  readonly predecessorActivityKey: string;
  readonly successorActivityKey: string;
  readonly relation: 'direct_follows' | 'precedes' | 'parallel' | 'conditional';
  readonly condition?: ConditionExpression;
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
      'activity',
      'capabilityRefs',
      'authorityRefs',
      'parentEventRefs',
      'concurrencyGroup',
      'branchRef',
      'payloadSummary',
    ],
    ['activity', 'concurrencyGroup', 'branchRef'],
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
  const activity =
    input.activity === undefined || input.activity === null
      ? input.activity
      : createExperienceActivityRef(input.activity);
  const event = {
    ...input,
    ...(activity === undefined ? {} : { activity }),
    capabilityRefs: freezeIdentifiers(input.capabilityRefs, 'capabilityRefs'),
    authorityRefs: freezeIdentifiers(input.authorityRefs, 'authorityRefs'),
    parentEventRefs: freezeIdentifiers(input.parentEventRefs, 'parentEventRefs'),
    payloadSummary: freezeJson(input.payloadSummary, 0),
  };
  return Object.freeze(event);
}

export function createExperienceActivityRef(input: ExperienceActivityRef): ExperienceActivityRef {
  assertExactKeys(
    input,
    [
      'activityKey',
      'activityKind',
      'objectiveSummary',
      'sourcePlanNodeRef',
      'sourceSkillGoalRef',
      'sourceAttemptRef',
      'operationRef',
      'capabilityRefs',
      'effectRefs',
    ],
    ['sourcePlanNodeRef', 'sourceSkillGoalRef', 'sourceAttemptRef', 'operationRef'],
    'ExperienceActivityRef',
  );
  assertIdentifier(input.activityKey, 'activityKey');
  if (
    ![
      'skill_goal',
      'plan_node',
      'provider_operation',
      'observation',
      'verification',
      'reasoning',
      'human_gate',
      'unknown',
    ].includes(input.activityKind)
  ) {
    invalid('EXPERIENCE_TRACE_EVENT_INVALID', 'Unknown Experience Activity kind.');
  }
  if (input.objectiveSummary.trim().length === 0 || input.objectiveSummary.length > 1_024) {
    invalid('EXPERIENCE_TRACE_EVENT_INVALID', 'Activity objective summary is invalid.');
  }
  for (const field of [
    'sourcePlanNodeRef',
    'sourceSkillGoalRef',
    'sourceAttemptRef',
    'operationRef',
  ] as const) {
    if (input[field] !== undefined) assertIdentifier(input[field], field);
  }
  return Object.freeze({
    ...input,
    objectiveSummary: input.objectiveSummary.trim(),
    capabilityRefs: freezeIdentifiers(input.capabilityRefs, 'activity.capabilityRefs', 64),
    effectRefs: freezeIdentifiers(input.effectRefs, 'activity.effectRefs', 64),
  });
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
    assertExactKeys(input.timeRange, ['from', 'to'], [], 'CohortTimeRange');
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
      'activityKindSequence',
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
  if (
    input.activityKindSequence.length !== input.activitySequence.length ||
    input.activityKindSequence.some(
      (kind) =>
        ![
          'skill_goal',
          'plan_node',
          'provider_operation',
          'observation',
          'verification',
          'reasoning',
          'human_gate',
          'unknown',
        ].includes(kind),
    )
  ) {
    invalid('PROCESS_VARIANT_INVALID', 'Activity kind sequence must align with activities.');
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
    activitySequence: freezeSequence(input.activitySequence, 'activitySequence'),
    activityKindSequence: Object.freeze([...input.activityKindSequence]),
    concurrencyGroups: Object.freeze(
      input.concurrencyGroups.map((group) => {
        if (group.length < 2) {
          invalid(
            'PROCESS_VARIANT_INVALID',
            'A concurrency group requires at least two activity occurrences.',
          );
        }
        return freezeSequence(group, 'concurrencyGroups');
      }),
    ),
    branchSequence: freezeSequence(input.branchSequence, 'branchSequence'),
    traceRefs: freezeIdentifiers(
      input.traceRefs,
      'traceRefs',
      PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT,
    ),
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
  const supportRefs = freezeIdentifiers(
    input.supportRefs,
    'supportRefs',
    PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT,
  );
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
    contradictionRefs: freezeIdentifiers(
      input.contradictionRefs,
      'contradictionRefs',
      PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT,
    ),
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
  const sourceTraceRefs = freezeIdentifiers(
    input.sourceTraceRefs,
    'sourceTraceRefs',
    PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT,
  );
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
  assertExactKeys(
    input,
    [
      'schemaVersion',
      'tenantId',
      'events',
      'correctionRefs',
      'outcomeRef',
      'outcomeStatus',
      'missingFactCodes',
      'environmentClass',
      'deviceClass',
    ],
    ['outcomeRef', 'deviceClass'],
    'ExperienceTraceBody',
  );
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
  assertExactKeys(
    input,
    ['predecessorActivity', 'successorActivity', 'relation', 'supportRefs', 'contradictionRefs'],
    [],
    'OrderingConstraint',
  );
  assertIdentifier(input.predecessorActivity, 'predecessorActivity');
  assertIdentifier(input.successorActivity, 'successorActivity');
  if (!['direct_follows', 'precedes'].includes(input.relation)) {
    invalid('DISCOVERED_PROCESS_PATTERN_INVALID', 'Unknown ordering relation.');
  }
  return Object.freeze({
    ...input,
    supportRefs: freezeIdentifiers(
      input.supportRefs,
      'supportRefs',
      PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT,
    ),
    contradictionRefs: freezeIdentifiers(
      input.contradictionRefs,
      'contradictionRefs',
      PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT,
    ),
  });
}

function createParallelCandidate(input: ParallelCandidate): ParallelCandidate {
  assertExactKeys(
    input,
    ['activityRefs', 'evidenceType', 'supportRefs', 'contradictionRefs'],
    [],
    'ParallelCandidate',
  );
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
    supportRefs: freezeIdentifiers(
      input.supportRefs,
      'supportRefs',
      PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT,
    ),
    contradictionRefs: freezeIdentifiers(
      input.contradictionRefs,
      'contradictionRefs',
      PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT,
    ),
  });
}

function createRecoveryPattern(input: RecoveryPattern): RecoveryPattern {
  assertExactKeys(
    input,
    [
      'triggerActivityKey',
      'resumeActivityKey',
      'activitySequence',
      'requiredCapabilityRefs',
      'supportRefs',
    ],
    ['resumeActivityKey'],
    'RecoveryPattern',
  );
  assertIdentifier(input.triggerActivityKey, 'triggerActivityKey');
  if (input.resumeActivityKey !== undefined)
    assertIdentifier(input.resumeActivityKey, 'resumeActivityKey');
  return Object.freeze({
    ...input,
    activitySequence: freezeSequence(input.activitySequence, 'activitySequence'),
    requiredCapabilityRefs: freezeIdentifiers(
      input.requiredCapabilityRefs,
      'requiredCapabilityRefs',
    ),
    supportRefs: freezeIdentifiers(
      input.supportRefs,
      'supportRefs',
      PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT,
    ),
  });
}

function createFailureVariant(input: FailureVariant): FailureVariant {
  assertExactKeys(
    input,
    ['activitySequence', 'failureActivity', 'traceRefs', 'count'],
    [],
    'FailureVariant',
  );
  assertIdentifier(input.failureActivity, 'failureActivity');
  if (!Number.isSafeInteger(input.count) || input.count < 1) {
    invalid('DISCOVERED_PROCESS_PATTERN_INVALID', 'Failure Variant count must be positive.');
  }
  return Object.freeze({
    ...input,
    activitySequence: freezeSequence(input.activitySequence, 'activitySequence'),
    traceRefs: freezeIdentifiers(
      input.traceRefs,
      'traceRefs',
      PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT,
    ),
  });
}

function createPatternQuality(input: PatternQuality): PatternQuality {
  assertExactKeys(
    input,
    [
      'supportCount',
      'totalTraceCount',
      'supportRate',
      'successRate',
      'traceCoverage',
      'fitness',
      'precisionProxy',
      'environmentCoverage',
      'contradictionRate',
      'generalization',
      'mandatoryThreshold',
    ],
    [],
    'PatternQuality',
  );
  for (const field of [
    'supportRate',
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
  for (const field of ['supportCount', 'totalTraceCount'] as const) {
    if (!Number.isSafeInteger(input[field]) || input[field] < 1) {
      invalid('DISCOVERED_PROCESS_PATTERN_INVALID', `${field} must be a positive integer.`);
    }
  }
  if (input.supportCount > input.totalTraceCount) {
    invalid('DISCOVERED_PROCESS_PATTERN_INVALID', 'Pattern support exceeds trace denominator.');
  }
  return Object.freeze({ ...input });
}

function createActivityPattern(input: ActivityPattern): ActivityPattern {
  assertExactKeys(
    input,
    [
      'activityKey',
      'activityKind',
      'objectiveSummary',
      'required',
      'supportCount',
      'supportRate',
      'capabilityRefs',
      'effectRefs',
      'lifecycleEventTypes',
    ],
    [],
    'ActivityPattern',
  );
  assertIdentifier(input.activityKey, 'activityKey');
  if (
    ![
      'skill_goal',
      'plan_node',
      'provider_operation',
      'observation',
      'verification',
      'reasoning',
      'human_gate',
      'unknown',
    ].includes(input.activityKind)
  ) {
    invalid('WORKFLOW_PATTERN_INVALID', 'Unknown Activity Pattern kind.');
  }
  if (input.objectiveSummary.trim().length === 0) {
    invalid('WORKFLOW_PATTERN_INVALID', 'Activity objective summary is required.');
  }
  if (!Number.isSafeInteger(input.supportCount) || input.supportCount < 1) {
    invalid('WORKFLOW_PATTERN_INVALID', 'Activity support count must be positive.');
  }
  assertUnitInterval(input.supportRate, 'supportRate');
  return Object.freeze({
    ...input,
    capabilityRefs: freezeIdentifiers(input.capabilityRefs, 'capabilityRefs'),
    effectRefs: freezeIdentifiers(input.effectRefs, 'effectRefs'),
    lifecycleEventTypes: freezeIdentifiers(input.lifecycleEventTypes, 'lifecycleEventTypes'),
  });
}

function createDependencyPattern(input: DependencyPattern): DependencyPattern {
  assertExactKeys(
    input,
    [
      'predecessorActivityKey',
      'successorActivityKey',
      'relation',
      'condition',
      'supportRefs',
      'contradictionRefs',
    ],
    ['condition'],
    'DependencyPattern',
  );
  assertIdentifier(input.predecessorActivityKey, 'predecessorActivityKey');
  assertIdentifier(input.successorActivityKey, 'successorActivityKey');
  if (!['direct_follows', 'precedes', 'parallel', 'conditional'].includes(input.relation)) {
    invalid('WORKFLOW_PATTERN_INVALID', 'Unknown dependency relation.');
  }
  if ((input.relation === 'conditional') !== (input.condition !== undefined)) {
    invalid(
      'WORKFLOW_PATTERN_INVALID',
      'Conditional dependencies require a ConditionExpression and other relations forbid one.',
    );
  }
  if (input.condition !== undefined) {
    assertConditionExpression(input.condition, 'DependencyPattern.condition');
  }
  return Object.freeze({
    ...input,
    supportRefs: freezeIdentifiers(
      input.supportRefs,
      'supportRefs',
      PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT,
    ),
    contradictionRefs: freezeIdentifiers(
      input.contradictionRefs,
      'contradictionRefs',
      PROCESS_MINING_EVIDENCE_REFERENCE_LIMIT,
    ),
  });
}

function freezeIdentifiers(
  values: readonly string[],
  field: string,
  maximum = DEFAULT_IDENTIFIER_COLLECTION_LIMIT,
): readonly string[] {
  if (values.length > maximum)
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

function freezeSequence(values: readonly string[], field: string): readonly string[] {
  if (values.length > 4096)
    invalid('EXPERIENCE_COMPILATION_BOUND_EXCEEDED', `${field} is too large.`);
  return Object.freeze(
    values.map((value) => {
      assertIdentifier(value, field);
      return value.trim();
    }),
  );
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
