import {
  EVIDENCE_SCHEMA_VERSION,
  EvidenceContractError,
  canonicalizeEvidenceJson,
  createCanonicalEvidenceEnvelope,
  hashCanonicalEvidenceJson,
  type CanonicalEvidenceEnvelope,
  type CreateCanonicalEvidenceEnvelopeInput,
  type EvidenceDeliveryGuarantee,
  type EvidenceEvaluationRole,
  type EvidenceJsonValue,
  type EvidenceRecordFamily,
  type EvidenceRequirementLevel,
  type EvidenceSchemaCompatibility,
  type EvidenceSourceSystem,
} from './canonical-evidence.js';
import { buildEvidenceRecordSchema, type EvidenceJsonSchema } from './schema.js';

export interface EvidenceRecordSource {
  readonly sourceSystem: EvidenceSourceSystem;
  readonly sourceTable: string;
  readonly authority: 'Runtime PostgreSQL' | 'Control PostgreSQL';
}

export interface EvidenceRecordCatalogEntry extends EvidenceRecordSource {
  readonly recordFamily: EvidenceRecordFamily;
  readonly recordType: string;
  readonly schemaName: string;
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  readonly schemaHash: `sha256:${string}`;
  readonly compatibility: EvidenceSchemaCompatibility;
  readonly maximumInlineBytes: number;
  readonly mapper: string;
  readonly deliveryGuarantee: EvidenceDeliveryGuarantee;
  readonly evaluationRole: EvidenceEvaluationRole;
  readonly requirementLevel: EvidenceRequirementLevel;
  readonly applicability: string;
  readonly artifactPolicy: 'inline_bounded_or_artifact_ref' | 'artifact_ref_required';
  readonly redactionPolicy: 'strict_internal_v1';
  readonly expectedReferences: readonly string[];
  readonly requiredPayloadFields: readonly string[];
}

type CatalogOptions = Readonly<{
  deliveryGuarantee?: EvidenceDeliveryGuarantee;
  evaluationRole?: EvidenceEvaluationRole;
  requirementLevel?: EvidenceRequirementLevel;
  applicability?: string;
  artifactPolicy?: EvidenceRecordCatalogEntry['artifactPolicy'];
  maximumInlineBytes?: number;
}>;

const runtime = (sourceTable: string): EvidenceRecordSource => ({
  sourceSystem: 'runtime',
  sourceTable,
  authority: 'Runtime PostgreSQL',
});
const control = (sourceTable: string): EvidenceRecordSource => ({
  sourceSystem: 'node_control',
  sourceTable,
  authority: 'Control PostgreSQL',
});

function defineRecord(
  recordType: string,
  source: EvidenceRecordSource,
  requiredPayloadFields: readonly string[],
  expectedReferences: readonly string[] = [],
  options: CatalogOptions = {},
): EvidenceRecordCatalogEntry {
  const recordFamily = recordType.split('.')[0] as EvidenceRecordFamily;
  const schemaName = `sdar.evidence.${recordType}`;
  const base = {
    ...source,
    recordFamily,
    recordType,
    schemaName,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    compatibility: 'backward_compatible_additive' as const,
    maximumInlineBytes: options.maximumInlineBytes ?? 65_536,
    mapper: `${recordType
      .split(/[._]/u)
      .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
      .join('')}EvidenceMapper`,
    deliveryGuarantee: options.deliveryGuarantee ?? 'durable_projection',
    evaluationRole: options.evaluationRole ?? 'required',
    requirementLevel: options.requirementLevel ?? 'conditional',
    applicability: options.applicability ?? `when ${recordType} source fact exists for the episode`,
    artifactPolicy: options.artifactPolicy ?? 'inline_bounded_or_artifact_ref',
    redactionPolicy: 'strict_internal_v1' as const,
    expectedReferences: Object.freeze([...expectedReferences]),
    requiredPayloadFields: Object.freeze([...requiredPayloadFields]),
  };
  const schemaHash = hashCanonicalEvidenceJson(buildEvidenceRecordSchema(base));
  return Object.freeze({ ...base, schemaHash });
}

const durableProjection: CatalogOptions = { deliveryGuarantee: 'durable_projection' };
const always: CatalogOptions = {
  deliveryGuarantee: 'durable_projection',
  requirementLevel: 'required',
  applicability: 'every Runtime episode',
};
const diagnostic: CatalogOptions = {
  evaluationRole: 'diagnostic',
  requirementLevel: 'optional',
};
const patternArtifactRequired: CatalogOptions = {
  maximumInlineBytes: 131_072,
  artifactPolicy: 'artifact_ref_required',
};

export const EVIDENCE_RECORD_CATALOG = Object.freeze([
  defineRecord(
    'runtime.episode',
    runtime('agent_task'),
    ['episodeId', 'taskId', 'status'],
    [],
    always,
  ),
  defineRecord(
    'runtime.request',
    runtime('agent_task'),
    ['requestId', 'taskId', 'inputHash'],
    ['runtime.episode'],
    always,
  ),
  defineRecord(
    'runtime.a2a_task',
    runtime('agent_task'),
    ['taskId', 'contextId', 'protocolStatus'],
    ['runtime.request'],
    durableProjection,
  ),
  defineRecord(
    'runtime.goal',
    runtime('goal'),
    ['goalId', 'goalVersion', 'status'],
    ['runtime.episode'],
    always,
  ),
  defineRecord(
    'runtime.goal_contract',
    runtime('user_goal_contract'),
    ['goalId', 'goalVersion', 'contractHash'],
    ['runtime.goal'],
    always,
  ),
  defineRecord(
    'runtime.goal_patch',
    runtime('goal_patch'),
    ['patchId', 'fromVersion', 'toVersion'],
    ['runtime.goal', 'runtime.goal_contract'],
    durableProjection,
  ),
  defineRecord(
    'runtime.plan',
    runtime('user_goal_plan'),
    ['planId', 'revision', 'contentHash'],
    ['runtime.goal_contract'],
    always,
  ),
  defineRecord(
    'runtime.plan_step',
    runtime('skill_goal'),
    ['skillGoalId', 'ordinal', 'status'],
    ['runtime.plan'],
    durableProjection,
  ),
  defineRecord(
    'runtime.state_transition',
    runtime('workflow_node_event'),
    ['eventId', 'nodeId', 'eventType'],
    ['runtime.episode', 'runtime.plan_step'],
    durableProjection,
  ),
  defineRecord(
    'runtime.decision',
    runtime('workflow_control_round'),
    ['controlId', 'roundIndex', 'decision'],
    ['runtime.episode', 'runtime.plan'],
    durableProjection,
  ),
  defineRecord(
    'runtime.policy_decision',
    runtime('workflow_control_round'),
    ['controlId', 'roundIndex', 'reasonCodes'],
    ['runtime.decision'],
    durableProjection,
  ),
  defineRecord(
    'runtime.execution_gate',
    runtime('task_execution_readiness'),
    ['readinessId', 'disposition', 'guardAction'],
    ['runtime.policy_decision'],
    durableProjection,
  ),
  defineRecord(
    'runtime.human_confirmation',
    runtime('workflow_plan'),
    ['planId', 'confirmationStatus', 'confirmationTaskId'],
    ['runtime.plan'],
    durableProjection,
  ),
  defineRecord(
    'runtime.action',
    runtime('mcp_invocation'),
    ['invocationId', 'operationName', 'argumentsHash'],
    ['runtime.plan_step', 'skill.execution'],
    durableProjection,
  ),
  defineRecord(
    'runtime.receipt',
    runtime('mcp_invocation'),
    ['invocationId', 'status', 'resultHash'],
    ['runtime.action'],
    durableProjection,
  ),
  defineRecord(
    'runtime.verification',
    runtime('completed_effect'),
    ['completedEffectId', 'status', 'effectFingerprint'],
    ['runtime.action', 'runtime.receipt'],
    durableProjection,
  ),
  defineRecord(
    'runtime.outcome',
    runtime('outcome_decision'),
    ['outcomeDecisionId', 'level', 'status'],
    ['runtime.verification'],
    durableProjection,
  ),
  defineRecord(
    'runtime.run_seal',
    runtime('runtime_terminal_outcome'),
    ['outcomeId', 'outcomeKind', 'committedAt'],
    ['runtime.outcome', 'evidence.episode_manifest'],
    durableProjection,
  ),

  defineRecord(
    'skill.usage_snapshot',
    runtime('skill_execution_record'),
    ['executionId', 'skillId', 'skillVersion'],
    ['runtime.episode', 'skill.execution'],
  ),
  defineRecord(
    'skill.candidate',
    runtime('skill_selection_record.candidates_json[]'),
    ['selectionId', 'skillId', 'skillVersion'],
    ['runtime.goal_contract'],
  ),
  defineRecord(
    'skill.applicability',
    runtime('skill_selection_record.candidates_json[]'),
    ['selectionId', 'skillId', 'applicabilityStatus'],
    ['skill.candidate'],
  ),
  defineRecord(
    'skill.context_resolution',
    runtime('skill_input_resolution'),
    ['resolutionId', 'status', 'sourceRefs'],
    ['skill.selection'],
    durableProjection,
  ),
  defineRecord(
    'skill.selection',
    runtime('skill_selection_record'),
    ['selectionId', 'selectedSkillId', 'selectedSkillVersion'],
    ['skill.candidate', 'skill.applicability'],
    durableProjection,
  ),
  defineRecord(
    'skill.mode_selection',
    runtime('skill_execution_event[event_type=skill.mode_selected]'),
    ['eventId', 'executionId', 'mode'],
    ['skill.selection'],
    durableProjection,
  ),
  defineRecord(
    'skill.composition',
    runtime('skill_execution_record'),
    ['executionId', 'parentExecutionId', 'compositionMode'],
    ['skill.selection'],
  ),
  defineRecord(
    'skill.composition_edge',
    runtime('skill_execution_event[event_type=skill.child_selected]'),
    ['eventId', 'parentExecutionId', 'childExecutionId'],
    ['skill.composition'],
    durableProjection,
  ),
  defineRecord(
    'skill.capability_slot_resolution',
    runtime('skill_execution_event'),
    ['eventId', 'slotId', 'capabilityId'],
    ['skill.composition', 'capability.definition'],
    durableProjection,
  ),
  defineRecord(
    'skill.procedure_compilation',
    runtime('skill_execution_event[event_type=skill.procedure_compiled]'),
    ['eventId', 'executionId', 'procedureHash'],
    ['skill.capability_slot_resolution'],
    durableProjection,
  ),
  defineRecord(
    'skill.plan_compliance',
    runtime('skill_execution_event'),
    ['eventId', 'executionId', 'complianceStatus'],
    ['skill.procedure_compilation', 'runtime.plan'],
    durableProjection,
  ),
  defineRecord(
    'skill.execution',
    runtime('skill_execution_record'),
    ['executionId', 'skillId', 'workflowPlanId'],
    ['skill.selection', 'runtime.plan_step'],
    durableProjection,
  ),
  defineRecord(
    'skill.execution_event',
    runtime('skill_execution_event'),
    ['eventId', 'executionId', 'eventType'],
    ['skill.execution'],
    durableProjection,
  ),
  defineRecord(
    'skill.execution_reference',
    runtime('skill_execution_reference'),
    ['linkId', 'executionId', 'referenceType'],
    ['skill.execution'],
    durableProjection,
  ),
  defineRecord(
    'skill.failure_propagation',
    runtime('skill_execution_event[event_type=skill.execution_failed]'),
    ['eventId', 'executionId', 'failureCode'],
    ['skill.execution_event'],
    durableProjection,
  ),
  defineRecord(
    'skill.evidence_requirement',
    runtime('task_capability_binding.evidence_requirement_snapshot[]'),
    ['bindingId', 'requirementId', 'requirementType'],
    ['capability.task_binding'],
    durableProjection,
  ),

  defineRecord(
    'mcp_task.tool_call',
    runtime('mcp_invocation'),
    ['invocationId', 'serverId', 'toolName'],
    ['runtime.action'],
    durableProjection,
  ),
  defineRecord(
    'mcp_task.availability',
    runtime('task_availability_snapshot'),
    ['snapshotId', 'operationName', 'availability'],
    ['mcp_task.tool_call'],
    durableProjection,
  ),
  defineRecord(
    'mcp_task.remote_binding',
    runtime('remote_task_binding'),
    ['bindingId', 'remoteTaskId', 'version'],
    ['mcp_task.tool_call'],
    durableProjection,
  ),
  defineRecord(
    'mcp_task.observation',
    runtime('remote_task_observation'),
    ['observationId', 'bindingId', 'observationType'],
    ['mcp_task.remote_binding'],
  ),
  defineRecord(
    'mcp_task.control_event',
    runtime('remote_task_control_event'),
    ['eventId', 'bindingId', 'eventType'],
    ['mcp_task.remote_binding'],
    durableProjection,
  ),
  defineRecord(
    'mcp_task.poll_attempt',
    runtime('remote_task_protocol_attempt'),
    ['attemptId', 'bindingId', 'status'],
    ['mcp_task.remote_binding'],
    durableProjection,
  ),
  defineRecord(
    'mcp_task.input_link',
    runtime('remote_task_input_link'),
    ['inputRequestId', 'bindingId', 'status'],
    ['mcp_task.remote_binding'],
    durableProjection,
  ),
  defineRecord(
    'mcp_task.cancel',
    runtime('remote_task_cancel_request'),
    ['cancelRequestId', 'bindingId', 'deliveryStatus'],
    ['mcp_task.remote_binding'],
    durableProjection,
  ),
  defineRecord(
    'mcp_task.reconciliation',
    runtime('remote_task_observation[observation_source=reconciliation]'),
    ['observationId', 'bindingId', 'runtimeRevision'],
    ['mcp_task.observation', 'mcp_task.control_event'],
  ),
  defineRecord(
    'mcp_task.continuation_snapshot',
    runtime('workflow_continuation_snapshot'),
    ['snapshotId', 'continuationId', 'stateVersion'],
    ['mcp_task.remote_binding'],
    durableProjection,
  ),
  defineRecord(
    'mcp_task.continuation_attempt',
    runtime('workflow_continuation_attempt'),
    ['attemptId', 'snapshotId', 'status'],
    ['mcp_task.continuation_snapshot'],
    durableProjection,
  ),

  defineRecord(
    'capability.definition',
    control('sdar_control.node_capability_definition_version'),
    ['capabilityId', 'version', 'definitionHash'],
    ['node_control.capability_revision'],
  ),
  defineRecord(
    'capability.implementation_binding',
    control('sdar_control.capability_implementation_binding'),
    ['bindingId', 'revision', 'capabilityId'],
    ['capability.definition'],
  ),
  defineRecord(
    'capability.readiness',
    runtime('capability_readiness_snapshot'),
    ['capabilityId', 'snapshotVersion', 'status'],
    ['capability.definition'],
  ),
  defineRecord(
    'capability.task_binding',
    runtime('task_capability_binding'),
    ['bindingId', 'taskId', 'bindingHash'],
    ['capability.definition', 'runtime.episode'],
    durableProjection,
  ),
  defineRecord(
    'capability.execution_attempt',
    runtime('task_capability_execution_attempt'),
    ['attemptId', 'bindingId', 'attemptNo'],
    ['capability.task_binding', 'skill.execution'],
    durableProjection,
  ),
  defineRecord(
    'capability.a2a_exposure',
    runtime('runtime_agent_card_exposure_snapshot'),
    ['revision', 'exposureId', 'exposureHash'],
    ['capability.definition'],
  ),
  defineRecord(
    'capability.agent_card_revision',
    runtime('runtime_agent_card_revision'),
    ['revision', 'contentHash', 'status'],
    ['capability.a2a_exposure'],
  ),

  defineRecord(
    'experience.episode',
    runtime('goal_experience_episode'),
    [
      'episodeId',
      'goalId',
      'goalVersion',
      'taskId',
      'contextId',
      'episodeType',
      'revision',
      'terminalOutcomeRef',
      'sourceHash',
      'episodeHash',
      'completeness',
      'status',
      'dataClassification',
      'redactionCodes',
      'sourceRefs',
      'missingFactCodes',
    ],
    ['runtime.episode'],
  ),
  defineRecord(
    'experience.trace',
    runtime('experience_trace'),
    [
      'traceId',
      'sourceEpisodeId',
      'taskTypeRefs',
      'goalFingerprint',
      'capabilityFingerprint',
      'environmentFingerprint',
      'completeness',
      'dataClassification',
      'redactionCodes',
      'normalizerVersion',
      'sourceHash',
      'traceBody',
    ],
    ['experience.episode'],
  ),
  defineRecord(
    'experience.trace_event',
    runtime('experience_trace.trace.events[]'),
    [
      'traceId',
      'eventId',
      'sequence',
      'eventType',
      'actorType',
      'activityRecordId',
      'capabilityRefs',
      'authorityRefs',
      'parentEventRefs',
      'concurrencyGroup',
      'branchRef',
      'payloadSummary',
    ],
    ['experience.trace'],
  ),
  defineRecord(
    'experience.activity',
    runtime('experience_trace.trace.events[].activity'),
    [
      'traceId',
      'eventId',
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
    ['experience.trace_event'],
  ),
  defineRecord(
    'experience.process_variant',
    runtime('pattern_candidate.definition.variants[]'),
    [
      'patternId',
      'variantId',
      'supportCount',
      'occurrenceCount',
      'activitySequence',
      'activityKindSequence',
      'concurrencyGroups',
      'branchSequence',
      'traceRefs',
      'successCount',
      'failureCount',
      'patternDefinitionArtifactRef',
    ],
    ['experience.trace'],
    patternArtifactRequired,
  ),
  defineRecord(
    'experience.workflow_pattern',
    runtime('pattern_candidate'),
    [
      'patternId',
      'patternType',
      'cohortFingerprint',
      'supportRefs',
      'contradictionRefs',
      'confidence',
      'status',
      'workflowPatternId',
      'taskTypeId',
      'activityPatterns',
      'sourcePatternRef',
      'sourceTraceRefs',
      'quality',
      'sourceSnapshotHash',
      'processVariantSet',
      'patternDefinitionArtifactRef',
    ],
    ['experience.process_variant'],
    patternArtifactRequired,
  ),
  defineRecord(
    'experience.workflow_pattern_dependency',
    runtime('pattern_candidate.definition.workflowPattern.dependencyPatterns[]'),
    [
      'patternId',
      'dependencyKey',
      'dependencyType',
      'predecessorActivityKey',
      'successorActivityKey',
      'condition',
      'supportRefs',
      'contradictionRefs',
      'patternDefinitionArtifactRef',
    ],
    ['experience.workflow_pattern'],
    patternArtifactRequired,
  ),
  defineRecord(
    'experience.recovery_pattern',
    runtime('pattern_candidate.definition.workflowPattern.recoveryPatterns[]'),
    [
      'patternId',
      'recoveryPatternId',
      'triggerActivityKey',
      'resumeActivityKey',
      'activitySequence',
      'requiredCapabilityRefs',
      'supportRefs',
      'patternDefinitionArtifactRef',
    ],
    ['experience.workflow_pattern'],
    patternArtifactRequired,
  ),
  defineRecord(
    'experience.planning_correction',
    runtime('planning_correction_fact'),
    [
      'correctionId',
      'taskId',
      'correctionType',
      'scope',
      'target',
      'accepted',
      'correctionHash',
      'patchHash',
      'sourceRefs',
      'counterexampleRefs',
    ],
    ['runtime.plan', 'experience.episode'],
  ),
  defineRecord(
    'experience.interaction_episode',
    runtime('planning_interaction_episode'),
    [
      'episodeId',
      'taskId',
      'revision',
      'goalId',
      'goalVersion',
      'completeness',
      'inductionFingerprint',
      'episodeHash',
      'outcomeRef',
      'correctionIds',
      'counterexampleRefs',
      'sourceRefs',
    ],
    ['runtime.episode'],
  ),

  defineRecord(
    'replay.dataset',
    runtime('replay_dataset_manifest'),
    [
      'datasetId',
      'datasetVersion',
      'purpose',
      'tenantId',
      'caseRefs',
      'contentHash',
      'sourceSnapshotHash',
      'leakageCheckRef',
      'promotionEligible',
      'invalidatedAt',
      'invalidationReason',
      'artifactRef',
    ],
    ['replay.case'],
    { maximumInlineBytes: 131_072, artifactPolicy: 'artifact_ref_required' },
  ),
  defineRecord(
    'replay.case',
    runtime('artifact_replay_case'),
    [
      'replayCaseId',
      'taskTypeId',
      'tenantId',
      'primarySourceEpisodeId',
      'sourceEpisodeRefs',
      'goalLineageHash',
      'environmentClass',
      'deviceClass',
      'snapshotCompleteness',
      'contentHash',
      'sourceSnapshotHash',
      'artifactRef',
    ],
    ['experience.episode'],
    { maximumInlineBytes: 131_072, artifactPolicy: 'artifact_ref_required' },
  ),
  defineRecord(
    'replay.run',
    runtime('artifact_validation_run'),
    [
      'validationRunId',
      'artifactId',
      'artifactVersion',
      'status',
      'datasetId',
      'datasetVersion',
      'sourceSnapshotHash',
      'validatorVersion',
      'metricCatalogVersion',
      'resultHash',
      'replaySafetyStatus',
      'replaySafety',
      'noPhysicalSideEffects',
    ],
    ['replay.dataset', 'artifact.validation'],
  ),
  defineRecord(
    'replay.case_result',
    runtime('artifact_replay_case_result'),
    ['validationRunId', 'replayCaseId', 'resultHash', 'evaluation'],
    ['replay.run', 'replay.case'],
  ),
  defineRecord(
    'replay.metric_result',
    runtime('artifact_replay_case_result.metrics[]'),
    ['validationRunId', 'replayCaseId', 'metricKey', 'metricValue'],
    ['replay.case_result'],
  ),
  defineRecord(
    'replay.counterexample',
    runtime('artifact_counterexample'),
    [
      'counterexampleId',
      'artifactId',
      'artifactVersion',
      'replayCaseId',
      'validationRunId',
      'failureId',
      'conditionFingerprint',
      'status',
      'content',
    ],
    ['replay.case_result', 'artifact.lifecycle'],
  ),

  defineRecord(
    'artifact.lifecycle',
    runtime('compiled_artifact + artifact_lineage'),
    [
      'artifactId',
      'version',
      'contentHash',
      'artifactType',
      'status',
      'tenantId',
      'domain',
      'riskLevel',
      'policyRefs',
      'authorityRef',
      'artifactRef',
      'lineage',
    ],
    ['experience.workflow_pattern'],
    { maximumInlineBytes: 131_072, artifactPolicy: 'artifact_ref_required' },
  ),
  defineRecord(
    'artifact.validation',
    runtime('artifact_validation_run'),
    [
      'validationRunId',
      'artifactId',
      'artifactVersion',
      'validationType',
      'datasetRef',
      'datasetVersion',
      'artifactHash',
      'datasetHash',
      'status',
      'result',
      'metrics',
      'resultHash',
      'validatorVersion',
      'metricCatalogVersion',
      'counterexampleRefs',
    ],
    ['artifact.lifecycle'],
  ),
  defineRecord(
    'artifact.retrieval',
    runtime('artifact_match_log'),
    [
      'matchId',
      'candidateArtifactId',
      'artifactVersion',
      'decision',
      'policySnapshotHash',
      'requestId',
      'reasonCodes',
      'applicability',
      'score',
    ],
    ['artifact.lifecycle', 'runtime.request'],
  ),
  defineRecord(
    'artifact.usage',
    runtime('artifact_execution'),
    [
      'artifactExecutionId',
      'artifactId',
      'artifactVersion',
      'status',
      'taskId',
      'goalId',
      'goalVersion',
      'generatedPlanId',
      'mode',
      'retrievalDecisionId',
      'retrievalMatchId',
    ],
    ['artifact.lifecycle', 'artifact.retrieval', 'runtime.episode'],
  ),
  defineRecord(
    'artifact.feedback',
    runtime('artifact_feedback'),
    [
      'feedbackId',
      'artifactExecutionId',
      'artifactId',
      'artifactVersion',
      'feedbackType',
      'reasonCode',
      'summary',
      'impact',
      'outcomeRef',
    ],
    ['artifact.usage'],
  ),
  defineRecord(
    'artifact.promotion',
    runtime('artifact_promotion_package + artifact_promotion_assessment'),
    [
      'promotionPackageId',
      'artifactId',
      'artifactVersion',
      'artifactRef',
      'artifactHash',
      'eligibility',
      'promotionPolicyVersion',
      'validationSummaryRef',
      'validationSummaryHash',
      'shadowSummaryRef',
      'shadowSummaryHash',
      'counterexampleSummaryRef',
      'counterexampleSummaryHash',
      'riskReviewRef',
      'riskReviewHash',
      'dependencySnapshotRef',
      'dependencySnapshotHash',
      'evidenceHash',
      'counterexampleRefs',
    ],
    ['artifact.lifecycle', 'artifact.validation', 'replay.counterexample'],
  ),

  defineRecord(
    'node_control.profile_revision',
    control('sdar_control.node_profile_revision'),
    ['nodeId', 'revision', 'status'],
    ['node_control.audit_event'],
  ),
  defineRecord(
    'node_control.health_observation',
    control('sdar_control.node_event_outbox[event_type=node.health.changed]'),
    ['eventId', 'nodeId', 'healthStatus'],
    ['node_control.node_event'],
    diagnostic,
  ),
  defineRecord(
    'node_control.configuration_revision',
    control('sdar_control.configuration_revision'),
    ['configurationId', 'revision', 'checksum'],
    ['node_control.management_operation'],
  ),
  defineRecord(
    'node_control.configuration_apply_ack',
    control('sdar_control.configuration_application'),
    ['applicationId', 'revision', 'status'],
    ['node_control.configuration_revision'],
  ),
  defineRecord(
    'node_control.configuration_lkg_transition',
    control('sdar_control.configuration_target_state'),
    ['targetType', 'targetId', 'generation'],
    ['node_control.configuration_apply_ack'],
  ),
  defineRecord(
    'node_control.llm_provider_revision',
    control('sdar_control.llm_provider_definition'),
    ['providerId', 'revision', 'status'],
    ['node_control.audit_event'],
  ),
  defineRecord(
    'node_control.model_route_revision',
    control('sdar_control.model_route_definition'),
    ['routeId', 'revision', 'status'],
    ['node_control.llm_provider_revision'],
  ),
  defineRecord(
    'node_control.smpp_source_revision',
    control('sdar_control.smpp_registry_source'),
    ['smppSourceId', 'revision', 'status'],
    ['node_control.audit_event'],
  ),
  defineRecord(
    'node_control.mcp_provider_binding_revision',
    control('sdar_control.mcp_provider_binding'),
    ['bindingId', 'revision', 'catalogChecksum'],
    ['node_control.smpp_source_revision'],
  ),
  defineRecord(
    'node_control.skill_governance',
    control('sdar_control.control_audit_event[action prefix=skill.]'),
    ['auditId', 'aggregateId', 'resultCode'],
    ['node_control.audit_event'],
  ),
  defineRecord(
    'node_control.plan_template_governance',
    control('sdar_control.control_audit_event[action prefix=plan_template.]'),
    ['auditId', 'aggregateId', 'resultCode'],
    ['node_control.audit_event'],
  ),
  defineRecord(
    'node_control.capability_revision',
    control('sdar_control.node_capability_definition_version'),
    ['capabilityId', 'version', 'definitionHash'],
    ['node_control.audit_event'],
  ),
  defineRecord(
    'node_control.capability_readiness',
    control('sdar_control.node_event_outbox[event_type=capability.readiness.changed]'),
    ['eventId', 'capabilityId', 'readinessStatus'],
    ['node_control.capability_revision', 'node_control.node_event'],
  ),
  defineRecord(
    'node_control.a2a_exposure',
    control('sdar_control.a2a_exposure_version'),
    ['exposureId', 'version', 'exposureHash'],
    ['node_control.capability_revision'],
  ),
  defineRecord(
    'node_control.agent_card_revision',
    control('sdar_control.agent_card_revision'),
    ['revision', 'nodeId', 'contentHash'],
    ['node_control.a2a_exposure'],
  ),
  defineRecord(
    'node_control.management_operation',
    control('sdar_control.management_operation'),
    ['operationId', 'operationType', 'status'],
    ['node_control.audit_event'],
  ),
  defineRecord(
    'node_control.audit_event',
    control('sdar_control.control_audit_event'),
    ['auditId', 'action', 'resultCode'],
    ['node_control.management_operation'],
  ),
  defineRecord(
    'node_control.node_event',
    control('sdar_control.node_event_outbox'),
    ['eventId', 'eventType', 'aggregateRevision'],
    ['node_control.audit_event'],
  ),
  defineRecord(
    'node_control.telemetry_configuration',
    control('sdar_control.configuration_revision[target_type=telemetry_link]'),
    ['configurationId', 'revision', 'checksum'],
    ['node_control.management_operation'],
  ),
  defineRecord(
    'node_control.telemetry_delivery',
    runtime('evidence_export_state'),
    ['exportId', 'batchId', 'deliveryStatus'],
    ['node_control.telemetry_configuration', 'evidence.export_status'],
  ),
  defineRecord(
    'node_control.telemetry_ack',
    runtime('evidence_export_state'),
    ['exportId', 'acknowledgedSequence', 'batchHash'],
    ['node_control.telemetry_delivery', 'evidence.export_status'],
  ),

  defineRecord(
    'evidence.episode_manifest',
    runtime('episode_evidence_manifest'),
    ['manifestId', 'episodeId', 'status'],
    ['runtime.run_seal'],
  ),
  defineRecord(
    'evidence.quality_issue',
    runtime('evidence_quality_issue'),
    ['issueId', 'issueCode', 'severity'],
    ['evidence.episode_manifest'],
    diagnostic,
  ),
  defineRecord(
    'evidence.projection_issue',
    runtime('evidence_projection_issue'),
    ['issueId', 'issueCode', 'projectorVersion'],
    ['evidence.source_checkpoint'],
    diagnostic,
  ),
  defineRecord(
    'evidence.source_checkpoint',
    runtime('evidence_source_checkpoint'),
    ['sourceFamily', 'sourcePartition', 'projectorVersion'],
    [],
    diagnostic,
  ),
  defineRecord(
    'evidence.export_status',
    runtime('evidence_export_state'),
    ['exportId', 'sourcePartition', 'lastAcknowledgedSequence'],
    ['evidence.source_checkpoint'],
    diagnostic,
  ),
] satisfies readonly EvidenceRecordCatalogEntry[]);

if (EVIDENCE_RECORD_CATALOG.length !== 100) {
  throw new Error(
    `Evidence catalog must contain 100 entries, found ${String(EVIDENCE_RECORD_CATALOG.length)}.`,
  );
}

const catalogByType = new Map(EVIDENCE_RECORD_CATALOG.map((entry) => [entry.recordType, entry]));

export function getEvidenceCatalogEntry(recordType: string): EvidenceRecordCatalogEntry {
  const entry = catalogByType.get(recordType);
  if (entry === undefined) throw new Error(`EVIDENCE_RECORD_TYPE_UNKNOWN:${recordType}`);
  return entry;
}

export function getEvidenceRecordSchema(recordType: string): EvidenceJsonSchema {
  return buildEvidenceRecordSchema(getEvidenceCatalogEntry(recordType));
}

type CatalogEnvelopeInput<TPayload extends EvidenceJsonValue> = Omit<
  CreateCanonicalEvidenceEnvelopeInput<TPayload>,
  | 'recordFamily'
  | 'schemaName'
  | 'schemaVersion'
  | 'sourceSystem'
  | 'sourceTable'
  | 'deliveryGuarantee'
  | 'evaluationRole'
> &
  Readonly<{ recordType: string }>;

export function createCatalogEvidenceEnvelope<TPayload extends EvidenceJsonValue>(
  input: CatalogEnvelopeInput<TPayload>,
): CanonicalEvidenceEnvelope<TPayload> {
  const entry = getEvidenceCatalogEntry(input.recordType);
  if (typeof input.payload !== 'object' || input.payload === null || Array.isArray(input.payload)) {
    throw new EvidenceContractError(
      'EVIDENCE_JSON_VALUE_INVALID',
      `${entry.recordType} payload must be an object.`,
      'payload',
    );
  }
  if (
    entry.artifactPolicy === 'artifact_ref_required' &&
    (input.artifactRefs === undefined || input.artifactRefs.length === 0)
  ) {
    throw new EvidenceContractError(
      'EVIDENCE_REFERENCE_INVALID',
      `${entry.recordType} requires at least one ArtifactRef URI.`,
      'artifactRefs',
    );
  }
  for (const field of entry.requiredPayloadFields) {
    if (!Object.hasOwn(input.payload, field)) {
      throw new EvidenceContractError(
        'EVIDENCE_JSON_VALUE_INVALID',
        `${entry.recordType} payload is missing ${field}.`,
        `payload.${field}`,
      );
    }
  }
  const inlineBytes = Buffer.byteLength(canonicalizeEvidenceJson(input.payload), 'utf8');
  if (inlineBytes > entry.maximumInlineBytes) {
    throw new EvidenceContractError(
      'EVIDENCE_JSON_SIZE_EXCEEDED',
      `${entry.recordType} payload exceeds its ${String(entry.maximumInlineBytes)}-byte inline limit.`,
      'payload',
    );
  }
  return createCanonicalEvidenceEnvelope({
    ...input,
    recordFamily: entry.recordFamily,
    schemaName: entry.schemaName,
    schemaVersion: entry.schemaVersion,
    sourceSystem: entry.sourceSystem,
    sourceTable: entry.sourceTable,
    deliveryGuarantee: entry.deliveryGuarantee,
    evaluationRole: entry.evaluationRole,
  });
}
