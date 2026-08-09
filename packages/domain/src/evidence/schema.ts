import { EVIDENCE_CONTRACT_VERSION, EVIDENCE_RECORD_FAMILIES } from './canonical-evidence.js';
import type { EvidenceRecordCatalogEntry } from './catalog.js';

export type EvidenceJsonSchema = Readonly<Record<string, unknown>>;

const text = (maxLength = 4096): EvidenceJsonSchema => ({
  type: 'string',
  minLength: 1,
  maxLength,
});
const hash: EvidenceJsonSchema = { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' };
const MAX_DATABASE_INTEGER = 2_147_483_647;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const CANONICAL_JSON_MAX_ARRAY_ITEMS = 4096;
const CANONICAL_JSON_MAX_OBJECT_PROPERTIES = 1024;
const ARTIFACT_JSON_MAX_ARRAY_ITEMS = 256;
const ARTIFACT_JSON_MAX_OBJECT_PROPERTIES = 128;
const nonNegativeInteger: EvidenceJsonSchema = {
  type: 'integer',
  minimum: 0,
  maximum: MAX_SAFE_INTEGER,
};
const positiveInteger: EvidenceJsonSchema = {
  type: 'integer',
  minimum: 1,
  maximum: MAX_SAFE_INTEGER,
};
const positiveDatabaseInteger: EvidenceJsonSchema = {
  type: 'integer',
  minimum: 1,
  maximum: MAX_DATABASE_INTEGER,
};

const booleanValue: EvidenceJsonSchema = { type: 'boolean' };
const unitInterval: EvidenceJsonSchema = { type: 'number', minimum: 0, maximum: 1 };
const numberValue: EvidenceJsonSchema = { type: 'number' };
const dateTime: EvidenceJsonSchema = { type: 'string', format: 'date-time' };
const openText: EvidenceJsonSchema = { type: 'string', maxLength: 65_536 };

const EXPERIENCE_ACTIVITY_KINDS = [
  'skill_goal',
  'plan_node',
  'provider_operation',
  'observation',
  'verification',
  'reasoning',
  'human_gate',
  'unknown',
] as const;
const EXPERIENCE_EVENT_TYPES = [
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
] as const;
const DATA_CLASSIFICATIONS = ['public', 'internal', 'user_scoped', 'restricted'] as const;
const COGNITIVE_SOURCE_KINDS = [
  'task_request',
  'task_understanding',
  'capability_summary',
  'task_type_definition',
  'user_preference',
  'goal_contract',
  'plan_revision',
  'skill_attempt',
  'workflow_outcome',
  'runtime_terminal_outcome',
  'recovery_decision',
  'business_event',
  'planning_correction',
  'model_invocation',
  'goal_experience_episode',
  'knowledge_revision',
  'skill_version',
] as const;
const COGNITIVE_SOURCE_AUTHORITIES = [
  'runtime_fact',
  'user_instruction',
  'user_confirmation',
  'domain_rule',
  'model_candidate',
  'promoted_knowledge',
  'skill_declaration',
] as const;

const cognitiveSourceRef = exactObject(
  {
    schemaVersion: { const: '1.0' },
    sourceRefId: text(),
    sourceKind: enumText(COGNITIVE_SOURCE_KINDS),
    sourceId: text(),
    sourceRevision: positiveDatabaseInteger,
    authority: enumText(COGNITIVE_SOURCE_AUTHORITIES),
    dataClassification: enumText(DATA_CLASSIFICATIONS),
    capturedAt: dateTime,
    contentHash: hash,
  },
  [
    'schemaVersion',
    'sourceRefId',
    'sourceKind',
    'sourceId',
    'sourceRevision',
    'authority',
    'dataClassification',
    'capturedAt',
  ],
);

const CANONICAL_ENCODED_ASCII_SOURCE_ID_CHARACTER =
  '%(?:22|23|24|25|26|2B|2C|3A|3B|3C|3D|3E|3F|40|5B|5D|5E|60|7B|7C|7D)';
const CANONICAL_ENCODED_UNICODE_SOURCE_ID_CHARACTER =
  '(?:%(?:C[2-9A-F]|D[0-9A-F])%[89AB][0-9A-F]|%E0%[AB][0-9A-F]%[89AB][0-9A-F]|%E(?:[1-9A-C]|E|F)%[89AB][0-9A-F]%[89AB][0-9A-F]|%ED%[89][0-9A-F]%[89AB][0-9A-F]|%F0%[9AB][0-9A-F](?:%[89AB][0-9A-F]){2}|%F[1-3]%[89AB][0-9A-F](?:%[89AB][0-9A-F]){2}|%F4%8[0-9A-F](?:%[89AB][0-9A-F]){2})';
const CANONICAL_SOURCE_ID_NON_SPACE_TOKEN = `(?:[A-Za-z0-9_.!~*'()-]|${CANONICAL_ENCODED_ASCII_SOURCE_ID_CHARACTER}|${CANONICAL_ENCODED_UNICODE_SOURCE_ID_CHARACTER})`;
const CANONICAL_SOURCE_ID_TOKEN = `(?:${CANONICAL_SOURCE_ID_NON_SPACE_TOKEN}|%20)`;
const CANONICAL_SOURCE_ID_SEGMENT = `(?!\\.{1,2}/)${CANONICAL_SOURCE_ID_NON_SPACE_TOKEN}(?:${CANONICAL_SOURCE_ID_TOKEN}*${CANONICAL_SOURCE_ID_NON_SPACE_TOKEN})?`;
const POSITIVE_DATABASE_INTEGER_PATTERN =
  '(?:[1-9][0-9]{0,8}|1[0-9]{9}|20[0-9]{8}|21[0-3][0-9]{7}|214[0-6][0-9]{6}|2147[0-3][0-9]{5}|21474[0-7][0-9]{4}|214748[0-2][0-9]{3}|2147483[0-5][0-9]{2}|21474836[0-3][0-9]|214748364[0-7])';
const PATTERN_CANDIDATE_ARTIFACT_URI_PATTERN = runtimeSourceArtifactUriPattern(
  'pattern_candidate',
  '1',
  'definition',
);

const patternCandidateArtifactUri: EvidenceJsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 4096,
  pattern: PATTERN_CANDIDATE_ARTIFACT_URI_PATTERN,
};

const patternCandidateArtifactRef = runtimeSourceArtifactRef(
  PATTERN_CANDIDATE_ARTIFACT_URI_PATTERN,
  { const: 1 },
  64 * 1024 * 1024,
);
const replayCaseArtifactRef = runtimeSourceArtifactRef(
  runtimeSourceArtifactUriPattern('artifact_replay_case', '1', 'content'),
  { const: 1 },
  1024 * 1024,
);
const replayDatasetArtifactRef = runtimeSourceArtifactRef(
  runtimeSourceArtifactUriPattern(
    'replay_dataset_manifest',
    POSITIVE_DATABASE_INTEGER_PATTERN,
    'content',
  ),
  positiveDatabaseInteger,
  1024 * 1024,
);
const compiledArtifactRef = runtimeSourceArtifactRef(
  runtimeSourceArtifactUriPattern(
    'compiled_artifact',
    POSITIVE_DATABASE_INTEGER_PATTERN,
    'definition/artifact/definition',
  ),
  positiveDatabaseInteger,
  1024 * 1024,
);

const processVariantSetDescriptor = patternCollectionDescriptor({ const: '/variants' });

const traceBody = exactObject({
  schemaVersion: { const: '1.2' },
  tenantId: text(),
  eventRecordIds: uniqueStringArray(4096),
  correctionRefs: uniqueStringArray(4096),
  outcomeRef: nullable(text()),
  outcomeStatus: enumText(['succeeded', 'failed', 'partial', 'unknown']),
  missingFactCodes: uniqueStringArray(4096),
  environmentClass: text(),
  deviceClass: nullable(text()),
});

const patternQuality = exactObject({
  supportCount: positiveInteger,
  totalTraceCount: positiveInteger,
  supportRate: unitInterval,
  successRate: unitInterval,
  traceCoverage: unitInterval,
  fitness: unitInterval,
  precisionProxy: unitInterval,
  environmentCoverage: unitInterval,
  contradictionRate: unitInterval,
  generalization: unitInterval,
  mandatoryThreshold: unitInterval,
});

const activityPattern = exactObject({
  activityKey: text(),
  activityKind: enumText(EXPERIENCE_ACTIVITY_KINDS),
  objectiveSummary: text(16_384),
  required: booleanValue,
  supportCount: positiveInteger,
  supportRate: unitInterval,
  capabilityRefs: uniqueStringArray(4096),
  effectRefs: uniqueStringArray(4096),
  lifecycleEventTypes: uniqueStringArray(4096),
});

const replaySafety = exactObject({
  provider: { const: 'ReplayNoPhysicalProvider' },
  physicalAdapterInvocationCount: { const: 0 },
  sideEffectAttemptCount: nonNegativeInteger,
  deniedBeforePhysicalBoundaryCount: nonNegativeInteger,
  denialEvidenceRefs: uniqueStringArray(4096),
  physicalOutcomeClaim: { const: 'none' },
});

const artifactApplicability = exactObject({
  artifactRef: text(),
  applicable: booleanValue,
  confidence: unitInterval,
  satisfiedConditionIds: uniqueStringArray(256),
  missingConditionIds: uniqueStringArray(257),
  violatedConditionIds: uniqueStringArray(257),
  uncertainConditionIds: uniqueStringArray(513),
  outOfDistribution: booleanValue,
  disposition: enumText([
    'eligible',
    'requires_adaptation',
    'fallback',
    'require_confirmation',
    'deny',
  ]),
  reasonCodes: uniqueStringArray(5),
});

const artifactMatchScore = exactObject({
  intentScore: unitInterval,
  structuredConditionScore: unitInterval,
  parameterCoverageScore: unitInterval,
  capabilityShapeScore: unitInterval,
  environmentSimilarityScore: unitInterval,
  validationConfidenceScore: unitInterval,
  recentReliabilityScore: unitInterval,
  riskPenalty: unitInterval,
  totalScore: unitInterval,
});

const artifactLineage = exactObject({
  lineage_id: text(),
  artifact_id: text(),
  artifact_version: positiveDatabaseInteger,
  source_episode_refs: uniqueStringArray(4096),
  source_knowledge_refs: uniqueStringArray(4096),
  source_correction_refs: uniqueStringArray(4096),
  source_pattern_refs: uniqueStringArray(4096),
  generation_methods: enumTextArray(
    [
      'process_mining',
      'workflow_induction',
      'rule_mining',
      'case_mining',
      'model_assisted_generalization',
      'human_authored',
    ],
    6,
    1,
  ),
  compiler_version: text(),
  created_at: dateTime,
});

const phase8PayloadProperties: Readonly<
  Record<string, Readonly<Record<string, EvidenceJsonSchema>>>
> = Object.freeze({
  'experience.activity': {
    traceId: text(),
    eventId: text(),
    activityKey: text(),
    activityKind: enumText(EXPERIENCE_ACTIVITY_KINDS),
    objectiveSummary: text(16_384),
    sourcePlanNodeRef: nullable(text()),
    sourceSkillGoalRef: nullable(text()),
    sourceAttemptRef: nullable(text()),
    operationRef: nullable(text()),
    capabilityRefs: uniqueStringArray(64),
    effectRefs: uniqueStringArray(64),
  },
  'experience.episode': {
    episodeId: text(),
    goalId: text(),
    goalVersion: positiveDatabaseInteger,
    taskId: text(),
    contextId: text(),
    episodeType: enumText(['terminal', 'revision', 'interaction', 'recovery']),
    revision: positiveDatabaseInteger,
    terminalOutcomeRef: text(),
    sourceHash: hash,
    episodeHash: hash,
    completeness: unitInterval,
    status: enumText(['partial', 'complete']),
    dataClassification: enumText(DATA_CLASSIFICATIONS),
    redactionCodes: uniqueStringArray(4096),
    sourceRefs: schemaArray(cognitiveSourceRef, { minItems: 1, maxItems: 4096 }),
    missingFactCodes: uniqueStringArray(4096),
  },
  'experience.interaction_episode': {
    episodeId: text(),
    taskId: text(),
    revision: positiveDatabaseInteger,
    goalId: nullable(text()),
    goalVersion: nullable(positiveDatabaseInteger),
    completeness: unitInterval,
    inductionFingerprint: hash,
    episodeHash: hash,
    outcomeRef: nullable(text()),
    correctionIds: uniqueStringArray(4096),
    counterexampleRefs: uniqueStringArray(4096),
    sourceRefs: schemaArray(cognitiveSourceRef, { minItems: 1, maxItems: 4096 }),
  },
  'experience.planning_correction': {
    correctionId: text(),
    taskId: text(),
    correctionType: enumText([
      'missing_target',
      'missing_scope',
      'missing_criterion',
      'missing_artifact',
      'missing_evidence',
      'missing_capability',
      'wrong_decomposition',
      'wrong_dependency',
      'wrong_priority',
      'unsafe_side_effect',
      'unnecessary_goal',
      'parallelism_correction',
      'degradation_correction',
    ]),
    scope: enumText(['task', 'user', 'tenant', 'global_candidate']),
    target: enumText(['task_understanding', 'goal_contract', 'skill_goal_plan']),
    accepted: booleanValue,
    correctionHash: hash,
    patchHash: hash,
    sourceRefs: schemaArray(cognitiveSourceRef, { minItems: 1, maxItems: 4096 }),
    counterexampleRefs: uniqueStringArray(4096),
  },
  'experience.process_variant': {
    patternId: text(),
    variantId: text(),
    supportCount: positiveInteger,
    occurrenceCount: positiveInteger,
    activitySequence: externalizablePatternCollection(
      orderedStringArray(256, 1),
      patternVariantFieldPointer('activitySequence'),
    ),
    activityKindSequence: externalizablePatternCollection(
      enumTextArray(EXPERIENCE_ACTIVITY_KINDS, 256, 1, false),
      patternVariantFieldPointer('activityKindSequence'),
    ),
    concurrencyGroups: externalizablePatternCollection(
      schemaArray(orderedStringArray(4096, 2), { maxItems: 256 }),
      patternVariantFieldPointer('concurrencyGroups'),
    ),
    branchSequence: externalizablePatternCollection(
      orderedStringArray(256),
      patternVariantFieldPointer('branchSequence'),
    ),
    traceRefs: externalizablePatternCollection(
      uniqueStringArray(256),
      patternVariantFieldPointer('traceRefs'),
    ),
    successCount: nonNegativeInteger,
    failureCount: nonNegativeInteger,
    patternDefinitionArtifactRef: patternCandidateArtifactRef,
  },
  'experience.recovery_pattern': {
    patternId: text(),
    recoveryPatternId: text(),
    triggerActivityKey: text(),
    resumeActivityKey: nullable(text()),
    activitySequence: externalizablePatternCollection(
      orderedStringArray(256),
      patternRecoveryFieldPointer('activitySequence'),
    ),
    requiredCapabilityRefs: externalizablePatternCollection(
      uniqueStringArray(256),
      patternRecoveryFieldPointer('requiredCapabilityRefs'),
    ),
    supportRefs: externalizablePatternCollection(
      uniqueStringArray(256),
      patternRecoveryFieldPointer('supportRefs'),
    ),
    patternDefinitionArtifactRef: patternCandidateArtifactRef,
  },
  'experience.trace': {
    traceId: text(),
    sourceEpisodeId: text(),
    taskTypeRefs: uniqueStringArray(4096),
    goalFingerprint: hash,
    capabilityFingerprint: hash,
    environmentFingerprint: hash,
    completeness: unitInterval,
    dataClassification: enumText(DATA_CLASSIFICATIONS),
    redactionCodes: uniqueStringArray(128),
    normalizerVersion: text(),
    sourceHash: hash,
    traceBody,
  },
  'experience.trace_event': {
    traceId: text(),
    eventId: text(),
    sequence: nonNegativeInteger,
    eventType: enumText(EXPERIENCE_EVENT_TYPES),
    actorType: enumText(['user', 'agent', 'runtime', 'provider']),
    activityRecordId: nullable(text()),
    capabilityRefs: uniqueStringArray(4096),
    authorityRefs: uniqueStringArray(4096),
    parentEventRefs: uniqueStringArray(4096),
    concurrencyGroup: nullable(text()),
    branchRef: nullable(text()),
    payloadSummary: { $ref: '#/$defs/evidenceValue' },
  },
  'experience.workflow_pattern': {
    patternId: text(),
    patternType: { const: 'workflow_pattern' },
    cohortFingerprint: hash,
    supportRefs: externalizablePatternCollection(uniqueStringArray(256), {
      const: '/discoveredPattern/supportRefs',
    }),
    contradictionRefs: externalizablePatternCollection(uniqueStringArray(256), {
      const: '/discoveredPattern/contradictionRefs',
    }),
    confidence: unitInterval,
    status: enumText(['discovered', 'candidate', 'rejected']),
    workflowPatternId: text(),
    taskTypeId: text(),
    activityPatterns: externalizablePatternCollection(
      schemaArray(activityPattern, { maxItems: 256 }),
      { const: '/workflowPattern/activityPatterns' },
    ),
    sourcePatternRef: text(),
    sourceTraceRefs: externalizablePatternCollection(uniqueStringArray(256), {
      const: '/workflowPattern/sourceTraceRefs',
    }),
    quality: patternQuality,
    sourceSnapshotHash: hash,
    processVariantSet: processVariantSetDescriptor,
    patternDefinitionArtifactRef: patternCandidateArtifactRef,
  },
  'experience.workflow_pattern_dependency': {
    patternId: text(),
    dependencyKey: text(),
    dependencyType: enumText(['direct_follows', 'precedes', 'parallel', 'conditional']),
    predecessorActivityKey: text(),
    successorActivityKey: text(),
    condition: nullable({ $ref: '#/$defs/conditionExpression' }),
    supportRefs: externalizablePatternCollection(
      uniqueStringArray(256),
      patternDependencyFieldPointer('supportRefs'),
    ),
    contradictionRefs: externalizablePatternCollection(
      uniqueStringArray(256),
      patternDependencyFieldPointer('contradictionRefs'),
    ),
    patternDefinitionArtifactRef: patternCandidateArtifactRef,
  },
  'replay.case': {
    replayCaseId: text(),
    taskTypeId: text(),
    tenantId: text(),
    primarySourceEpisodeId: text(),
    sourceEpisodeRefs: uniqueStringArray(4096, 1),
    goalLineageHash: hash,
    environmentClass: text(),
    deviceClass: nullable(text()),
    snapshotCompleteness: unitInterval,
    contentHash: hash,
    sourceSnapshotHash: hash,
    artifactRef: replayCaseArtifactRef,
  },
  'replay.case_result': {
    validationRunId: text(),
    replayCaseId: text(),
    resultHash: hash,
    evaluation: evidenceValueObject(),
  },
  'replay.counterexample': {
    counterexampleId: text(),
    artifactId: text(),
    artifactVersion: positiveDatabaseInteger,
    replayCaseId: text(),
    validationRunId: text(),
    failureId: text(),
    conditionFingerprint: hash,
    status: enumText(['recorded', 'reviewed', 'superseded']),
    content: evidenceValueObject(),
  },
  'replay.dataset': {
    datasetId: text(),
    datasetVersion: positiveDatabaseInteger,
    purpose: enumText([
      'discovery',
      'candidate_development',
      'promotion_holdout',
      'counterexample',
    ]),
    tenantId: text(),
    caseRefs: uniqueStringArray(4096),
    contentHash: hash,
    sourceSnapshotHash: hash,
    leakageCheckRef: text(),
    promotionEligible: booleanValue,
    invalidatedAt: nullable(dateTime),
    invalidationReason: nullable(openText),
    artifactRef: replayDatasetArtifactRef,
  },
  'replay.metric_result': {
    validationRunId: text(),
    replayCaseId: text(),
    metricKey: text(),
    metricValue: numberValue,
  },
  'replay.run': {
    validationRunId: text(),
    artifactId: text(),
    artifactVersion: positiveDatabaseInteger,
    status: enumText(['pending', 'running', 'passed', 'failed']),
    datasetId: text(),
    datasetVersion: positiveDatabaseInteger,
    sourceSnapshotHash: hash,
    validatorVersion: nullable(text()),
    metricCatalogVersion: nullable(text()),
    resultHash: nullable(hash),
    replaySafetyStatus: enumText(['pending', 'verified']),
    replaySafety: nullable(replaySafety),
    noPhysicalSideEffects: nullable(booleanValue),
  },
  'artifact.feedback': {
    feedbackId: text(),
    artifactExecutionId: text(),
    artifactId: text(),
    artifactVersion: positiveDatabaseInteger,
    feedbackType: openText,
    reasonCode: openText,
    summary: text(4096),
    impact: evidenceValueObject(),
    outcomeRef: nullable(text()),
  },
  'artifact.lifecycle': {
    artifactId: text(),
    version: positiveDatabaseInteger,
    contentHash: hash,
    artifactType: enumText([
      'intent_route',
      'plan_template',
      'decision_rule',
      'case_template',
      'model_route',
    ]),
    status: enumText([
      'discovered',
      'candidate',
      'validating',
      'awaiting_approval',
      'active',
      'revalidating',
      'deprecated',
      'archived',
      'rejected',
    ]),
    tenantId: nullable(text()),
    domain: text(),
    riskLevel: enumText(['low', 'medium', 'high', 'critical']),
    policyRefs: uniqueStringArray(512),
    authorityRef: text(),
    artifactRef: compiledArtifactRef,
    lineage: artifactLineage,
  },
  'artifact.promotion': {
    promotionPackageId: text(),
    artifactId: text(),
    artifactVersion: positiveDatabaseInteger,
    artifactRef: text(),
    artifactHash: hash,
    eligibility: enumText(['eligible_for_review', 'needs_more_data', 'ineligible', 'unsafe']),
    promotionPolicyVersion: text(),
    validationSummaryRef: text(),
    validationSummaryHash: hash,
    shadowSummaryRef: text(),
    shadowSummaryHash: hash,
    counterexampleSummaryRef: text(),
    counterexampleSummaryHash: hash,
    riskReviewRef: text(),
    riskReviewHash: hash,
    dependencySnapshotRef: text(),
    dependencySnapshotHash: hash,
    evidenceHash: nullable(hash),
    counterexampleRefs: uniqueStringArray(4096),
  },
  'artifact.retrieval': {
    matchId: text(),
    candidateArtifactId: text(),
    artifactVersion: positiveDatabaseInteger,
    decision: enumText([
      'compiled_fast',
      'template_adapt',
      'case_adapt',
      'small_model',
      'cognitive_runtime',
      'human_input',
      'denied',
    ]),
    policySnapshotHash: hash,
    requestId: text(),
    reasonCodes: uniqueStringArray(4096),
    applicability: artifactApplicability,
    score: artifactMatchScore,
  },
  'artifact.usage': {
    artifactExecutionId: text(),
    artifactId: text(),
    artifactVersion: positiveDatabaseInteger,
    status: enumText(['started', 'completed', 'failed', 'canceled']),
    taskId: text(),
    goalId: nullable(text()),
    goalVersion: nullable(positiveDatabaseInteger),
    generatedPlanId: nullable(text()),
    mode: openText,
    retrievalDecisionId: text(),
    retrievalMatchId: text(),
  },
  'artifact.validation': {
    validationRunId: text(),
    artifactId: text(),
    artifactVersion: positiveDatabaseInteger,
    validationType: enumText(['static', 'replay', 'simulation', 'shadow', 'revalidation']),
    datasetRef: text(),
    datasetVersion: nullable(positiveDatabaseInteger),
    artifactHash: nullable(hash),
    datasetHash: nullable(hash),
    status: enumText(['pending', 'running', 'passed', 'failed']),
    // Generic static/shadow/governance validators persist stable, typed status but an
    // authority-owned textual result. Replay is the only validation kind whose result
    // vocabulary is closed by ArtifactValidationResult; see the payload conditional below.
    result: nullable(text(4096)),
    metrics: evidenceValueObject(),
    resultHash: nullable(hash),
    validatorVersion: nullable(text()),
    metricCatalogVersion: nullable(text()),
    counterexampleRefs: uniqueStringArray(4096),
  },
});

function payloadProperty(recordType: string, field: string): EvidenceJsonSchema {
  const phase8 = phase8PayloadProperties[recordType];
  const explicit = phase8?.[field];
  if (explicit !== undefined) return explicit;
  if (phase8 !== undefined) {
    throw new Error(`Phase 8 payload field ${recordType}.${field} has no authoritative schema.`);
  }
  return inferredPayloadProperty(field);
}

function payloadCrossFieldConstraints(recordType: string): EvidenceJsonSchema {
  if (recordType === 'experience.interaction_episode') {
    return {
      oneOf: [
        objectPropertiesConstraint({ goalId: { const: null }, goalVersion: { const: null } }),
        objectPropertiesConstraint({ goalId: text(), goalVersion: positiveDatabaseInteger }),
      ],
    };
  }
  if (recordType === 'experience.workflow_pattern_dependency') {
    return {
      oneOf: [
        objectPropertiesConstraint({
          dependencyType: { const: 'conditional' },
          condition: { $ref: '#/$defs/conditionExpression' },
        }),
        objectPropertiesConstraint({
          dependencyType: enumText(['direct_follows', 'precedes', 'parallel']),
          condition: { const: null },
        }),
      ],
    };
  }
  if (recordType === 'replay.dataset') {
    return {
      oneOf: [
        objectPropertiesConstraint({
          invalidatedAt: { const: null },
          invalidationReason: { const: null },
        }),
        objectPropertiesConstraint({ invalidatedAt: dateTime, invalidationReason: text(65_536) }),
      ],
    };
  }
  if (recordType === 'replay.run') {
    return {
      oneOf: [
        objectPropertiesConstraint({
          status: enumText(['pending', 'running']),
          replaySafetyStatus: { const: 'pending' },
          replaySafety: { const: null },
          noPhysicalSideEffects: { const: null },
          resultHash: { const: null },
        }),
        objectPropertiesConstraint({
          status: enumText(['passed', 'failed']),
          replaySafetyStatus: { const: 'verified' },
          replaySafety,
          noPhysicalSideEffects: { const: true },
          resultHash: hash,
          validatorVersion: text(),
          metricCatalogVersion: text(),
        }),
      ],
    };
  }
  if (recordType === 'artifact.validation') {
    return {
      allOf: [
        {
          oneOf: [
            objectPropertiesConstraint({
              status: enumText(['pending', 'running']),
              result: { const: null },
            }),
            objectPropertiesConstraint({
              status: enumText(['passed', 'failed']),
              result: text(4096),
            }),
          ],
        },
        {
          if: objectPropertiesConstraint({ validationType: { const: 'replay' } }),
          then: objectPropertiesConstraint({
            result: nullable(enumText(['passed', 'failed', 'needs_more_data', 'unsafe'])),
          }),
        },
      ],
    };
  }
  return {};
}

function objectPropertiesConstraint(
  properties: Readonly<Record<string, EvidenceJsonSchema>>,
): EvidenceJsonSchema {
  return { type: 'object', required: Object.keys(properties), properties };
}

function inferredPayloadProperty(field: string): EvidenceJsonSchema {
  if (field.endsWith('Hash')) return hash;
  if (
    ['Version', 'Revision', 'Sequence', 'Ordinal', 'Index', 'Count', 'AttemptNo'].some((suffix) =>
      field.endsWith(suffix),
    )
  ) {
    return nonNegativeInteger;
  }
  if (field.endsWith('At')) return { type: 'string', format: 'date-time' };
  if (['Refs', 'ReasonCodes'].some((suffix) => field.endsWith(suffix))) {
    return { type: 'array', maxItems: 256, uniqueItems: true, items: text() };
  }
  if (
    ['Id', 'Key', 'Type', 'Status', 'Kind', 'Mode', 'Action', 'Decision', 'Disposition'].some(
      (suffix) => field.endsWith(suffix),
    )
  ) {
    return text();
  }
  return { $ref: '#/$defs/evidenceValue' };
}

function nullable(property: EvidenceJsonSchema): EvidenceJsonSchema {
  return { oneOf: [property, { type: 'null' }] };
}

function enumText(values: readonly string[]): EvidenceJsonSchema {
  return { type: 'string', enum: [...values] };
}

function schemaArray(
  items: EvidenceJsonSchema,
  options: Readonly<{ minItems?: number; maxItems?: number; uniqueItems?: boolean }> = {},
): EvidenceJsonSchema {
  return {
    type: 'array',
    ...(options.minItems === undefined ? {} : { minItems: options.minItems }),
    maxItems: options.maxItems ?? CANONICAL_JSON_MAX_ARRAY_ITEMS,
    ...(options.uniqueItems === undefined ? {} : { uniqueItems: options.uniqueItems }),
    items,
  };
}

function uniqueStringArray(
  maxItems = CANONICAL_JSON_MAX_ARRAY_ITEMS,
  minItems?: number,
): EvidenceJsonSchema {
  return schemaArray(text(), {
    ...(minItems === undefined ? {} : { minItems }),
    maxItems,
    uniqueItems: true,
  });
}

function orderedStringArray(
  maxItems = CANONICAL_JSON_MAX_ARRAY_ITEMS,
  minItems?: number,
): EvidenceJsonSchema {
  return schemaArray(text(), { ...(minItems === undefined ? {} : { minItems }), maxItems });
}

function enumTextArray(
  values: readonly string[],
  maxItems = CANONICAL_JSON_MAX_ARRAY_ITEMS,
  minItems?: number,
  uniqueItems = true,
): EvidenceJsonSchema {
  return schemaArray(enumText(values), {
    ...(minItems === undefined ? {} : { minItems }),
    maxItems,
    uniqueItems,
  });
}

function externalizablePatternCollection(
  inline: EvidenceJsonSchema,
  jsonPointer: EvidenceJsonSchema,
): EvidenceJsonSchema {
  return { oneOf: [inline, patternCollectionDescriptor(jsonPointer)] };
}

function evidenceValueObject(): EvidenceJsonSchema {
  return {
    type: 'object',
    maxProperties: CANONICAL_JSON_MAX_OBJECT_PROPERTIES,
    additionalProperties: { $ref: '#/$defs/evidenceValue' },
  };
}

function patternCollectionDescriptor(jsonPointer: EvidenceJsonSchema): EvidenceJsonSchema {
  return exactObject({
    artifactRefUri: patternCandidateArtifactUri,
    jsonPointer,
    count: positiveInteger,
    sha256: hash,
  });
}

function patternVariantFieldPointer(field: string): EvidenceJsonSchema {
  return { pattern: `^/variants/(?:0|[1-9][0-9]*)/${field}$`, type: 'string' };
}

function patternDependencyFieldPointer(field: string): EvidenceJsonSchema {
  return {
    pattern: `^/workflowPattern/dependencyPatterns/(?:0|[1-9][0-9]*)/${field}$`,
    type: 'string',
  };
}

function patternRecoveryFieldPointer(field: string): EvidenceJsonSchema {
  return {
    pattern: `^/workflowPattern/recoveryPatterns/(?:0|[1-9][0-9]*)/${field}$`,
    type: 'string',
  };
}

function runtimeSourceArtifactRef(
  uriPattern: string,
  version: EvidenceJsonSchema,
  maximumByteSize: number,
): EvidenceJsonSchema {
  return exactObject({
    artifactId: text(512),
    version,
    uri: { type: 'string', minLength: 1, maxLength: 4096, pattern: uriPattern },
    sha256: hash,
    mediaType: { const: 'application/json' },
    byteSize: { type: 'integer', minimum: 0, maximum: maximumByteSize },
  });
}

function runtimeSourceArtifactUriPattern(
  sourceTable: string,
  sourceVersionPattern: string,
  fieldPath: string,
): string {
  return `^artifact://runtime/v1/${sourceTable}/${CANONICAL_SOURCE_ID_SEGMENT}/${sourceVersionPattern}/${fieldPath}$`;
}

function exactObject(
  properties: Readonly<Record<string, EvidenceJsonSchema>>,
  required: readonly string[] = Object.keys(properties),
): EvidenceJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...required],
    properties,
  };
}

const conditionExpressionDefinition: EvidenceJsonSchema = {
  oneOf: [
    exactObject({
      type: enumText(['all', 'any']),
      children: schemaArray(
        { $ref: '#/$defs/conditionExpression' },
        { minItems: 1, maxItems: ARTIFACT_JSON_MAX_ARRAY_ITEMS },
      ),
    }),
    exactObject({
      type: { const: 'not' },
      child: { $ref: '#/$defs/conditionExpression' },
    }),
    exactObject({
      type: { const: 'atomic' },
      field: text(),
      operator: { const: 'exists' },
    }),
    exactObject({
      type: { const: 'atomic' },
      field: text(),
      operator: enumText(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']),
      value: { $ref: '#/$defs/artifactValue' },
    }),
  ],
};

export function buildEvidenceRecordSchema(
  entry: Omit<EvidenceRecordCatalogEntry, 'schemaHash'>,
): EvidenceJsonSchema {
  const identifierProperties = Object.fromEntries(
    [
      'tenantId',
      'userScopeId',
      'projectId',
      'taskId',
      'contextId',
      'episodeId',
      'runId',
      'goalId',
      'planId',
      'skillExecutionId',
      'capabilityBindingId',
      'remoteTaskBindingId',
      'nodeId',
      'causationId',
      'evidenceSequence',
    ].map((field) => [field, text()]),
  );
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://schemas.sdar.local/evidence/v1/records/${entry.recordType}.schema.json`,
    title: `${entry.recordType} canonical evidence record`,
    description: `Canonical ${entry.recordType} evidence projected from ${entry.authority} ${entry.sourceTable}.`,
    type: 'object',
    additionalProperties: false,
    required: [
      'contractVersion',
      'schemaName',
      'schemaVersion',
      'recordFamily',
      'recordType',
      'recordId',
      'sourceSystem',
      'sourceTable',
      'sourceRecordId',
      'sourceRevision',
      'environment',
      'correlationId',
      'occurredAt',
      'recordedAt',
      'deliveryGuarantee',
      'evaluationRole',
      'evidenceRefs',
      'artifactRefs',
      'payloadHash',
      'payload',
    ],
    properties: {
      contractVersion: { const: EVIDENCE_CONTRACT_VERSION },
      schemaName: { const: entry.schemaName },
      schemaVersion: { const: entry.schemaVersion },
      recordFamily: { const: entry.recordFamily, enum: EVIDENCE_RECORD_FAMILIES },
      recordType: { const: entry.recordType },
      recordId: { type: 'string', pattern: '^evidence_[0-9a-f]{64}$' },
      sourceSystem: { const: entry.sourceSystem },
      sourceTable: { const: entry.sourceTable },
      sourceRecordId: text(),
      sourceRevision: text(),
      environment: text(256),
      correlationId: text(),
      occurredAt: { type: 'string', format: 'date-time' },
      recordedAt: { type: 'string', format: 'date-time' },
      deliveryGuarantee: { const: entry.deliveryGuarantee },
      evaluationRole: { const: entry.evaluationRole },
      evidenceRefs: { type: 'array', maxItems: 256, uniqueItems: true, items: text() },
      artifactRefs: {
        type: 'array',
        ...(entry.artifactPolicy === 'artifact_ref_required' ? { minItems: 1 } : {}),
        maxItems: 256,
        uniqueItems: true,
        items: text(),
      },
      payloadHash: hash,
      payload: {
        type: 'object',
        minProperties: entry.requiredPayloadFields.length,
        maxProperties: 128,
        required: entry.requiredPayloadFields,
        properties: Object.fromEntries(
          entry.requiredPayloadFields.map((field) => [
            field,
            payloadProperty(entry.recordType, field),
          ]),
        ),
        additionalProperties: { $ref: '#/$defs/evidenceValue' },
        ...payloadCrossFieldConstraints(entry.recordType),
      },
      goalVersion: positiveDatabaseInteger,
      planVersion: positiveDatabaseInteger,
      ...identifierProperties,
    },
    $defs: {
      evidenceValue: {
        oneOf: [
          { type: 'null' },
          { type: 'boolean' },
          { type: 'number' },
          { type: 'string', maxLength: 65_536 },
          {
            type: 'array',
            maxItems: CANONICAL_JSON_MAX_ARRAY_ITEMS,
            items: { $ref: '#/$defs/evidenceValue' },
          },
          {
            type: 'object',
            maxProperties: CANONICAL_JSON_MAX_OBJECT_PROPERTIES,
            additionalProperties: { $ref: '#/$defs/evidenceValue' },
          },
        ],
      },
      artifactValue: {
        oneOf: [
          { type: 'null' },
          { type: 'boolean' },
          { type: 'number' },
          { type: 'string', maxLength: 65_536 },
          {
            type: 'array',
            maxItems: ARTIFACT_JSON_MAX_ARRAY_ITEMS,
            items: { $ref: '#/$defs/artifactValue' },
          },
          {
            type: 'object',
            maxProperties: ARTIFACT_JSON_MAX_OBJECT_PROPERTIES,
            additionalProperties: { $ref: '#/$defs/artifactValue' },
          },
        ],
      },
      ...(entry.recordType === 'experience.workflow_pattern_dependency'
        ? { conditionExpression: conditionExpressionDefinition }
        : {}),
    },
    'x-sdar-compatibility': entry.compatibility,
    'x-sdar-maximum-inline-bytes': entry.maximumInlineBytes,
    'x-sdar-redaction-policy': entry.redactionPolicy,
    'x-sdar-artifact-policy': entry.artifactPolicy,
  };
}
