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

const transactional: CatalogOptions = { deliveryGuarantee: 'transactional' };
const always: CatalogOptions = {
  deliveryGuarantee: 'transactional',
  requirementLevel: 'required',
  applicability: 'every Runtime episode',
};
const diagnostic: CatalogOptions = {
  evaluationRole: 'diagnostic',
  requirementLevel: 'optional',
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
    transactional,
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
    transactional,
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
    transactional,
  ),
  defineRecord(
    'runtime.state_transition',
    runtime('workflow_node_event'),
    ['eventId', 'nodeId', 'eventType'],
    ['runtime.episode', 'runtime.plan_step'],
    transactional,
  ),
  defineRecord(
    'runtime.decision',
    runtime('workflow_control_round'),
    ['controlId', 'roundIndex', 'decision'],
    ['runtime.episode', 'runtime.plan'],
    transactional,
  ),
  defineRecord(
    'runtime.policy_decision',
    runtime('workflow_control_round'),
    ['controlId', 'roundIndex', 'reasonCodes'],
    ['runtime.decision'],
    transactional,
  ),
  defineRecord(
    'runtime.execution_gate',
    runtime('task_execution_readiness'),
    ['readinessId', 'disposition', 'guardAction'],
    ['runtime.policy_decision'],
    transactional,
  ),
  defineRecord(
    'runtime.human_confirmation',
    runtime('workflow_plan'),
    ['planId', 'confirmationStatus', 'confirmationTaskId'],
    ['runtime.plan'],
    transactional,
  ),
  defineRecord(
    'runtime.action',
    runtime('mcp_invocation'),
    ['invocationId', 'operationName', 'argumentsHash'],
    ['runtime.plan_step', 'skill.execution'],
    transactional,
  ),
  defineRecord(
    'runtime.receipt',
    runtime('mcp_invocation'),
    ['invocationId', 'status', 'resultHash'],
    ['runtime.action'],
    transactional,
  ),
  defineRecord(
    'runtime.verification',
    runtime('completed_effect'),
    ['completedEffectId', 'status', 'effectFingerprint'],
    ['runtime.action', 'runtime.receipt'],
    transactional,
  ),
  defineRecord(
    'runtime.outcome',
    runtime('outcome_decision'),
    ['outcomeDecisionId', 'level', 'status'],
    ['runtime.verification'],
    transactional,
  ),
  defineRecord(
    'runtime.run_seal',
    runtime('runtime_terminal_outcome'),
    ['outcomeId', 'outcomeKind', 'committedAt'],
    ['runtime.outcome', 'evidence.episode_manifest'],
    transactional,
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
    transactional,
  ),
  defineRecord(
    'skill.selection',
    runtime('skill_selection_record'),
    ['selectionId', 'selectedSkillId', 'selectedSkillVersion'],
    ['skill.candidate', 'skill.applicability'],
    transactional,
  ),
  defineRecord(
    'skill.mode_selection',
    runtime('skill_execution_event[event_type=skill.mode_selected]'),
    ['eventId', 'executionId', 'mode'],
    ['skill.selection'],
    transactional,
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
    transactional,
  ),
  defineRecord(
    'skill.capability_slot_resolution',
    runtime('skill_execution_event'),
    ['eventId', 'slotId', 'capabilityId'],
    ['skill.composition', 'capability.definition'],
    transactional,
  ),
  defineRecord(
    'skill.procedure_compilation',
    runtime('skill_execution_event[event_type=skill.procedure_compiled]'),
    ['eventId', 'executionId', 'procedureHash'],
    ['skill.capability_slot_resolution'],
    transactional,
  ),
  defineRecord(
    'skill.plan_compliance',
    runtime('skill_execution_event'),
    ['eventId', 'executionId', 'complianceStatus'],
    ['skill.procedure_compilation', 'runtime.plan'],
    transactional,
  ),
  defineRecord(
    'skill.execution',
    runtime('skill_execution_record'),
    ['executionId', 'skillId', 'workflowPlanId'],
    ['skill.selection', 'runtime.plan_step'],
    transactional,
  ),
  defineRecord(
    'skill.execution_event',
    runtime('skill_execution_event'),
    ['eventId', 'executionId', 'eventType'],
    ['skill.execution'],
    transactional,
  ),
  defineRecord(
    'skill.execution_reference',
    runtime('skill_execution_reference'),
    ['linkId', 'executionId', 'referenceType'],
    ['skill.execution'],
    transactional,
  ),
  defineRecord(
    'skill.failure_propagation',
    runtime('skill_execution_event[event_type=skill.execution_failed]'),
    ['eventId', 'executionId', 'failureCode'],
    ['skill.execution_event'],
    transactional,
  ),
  defineRecord(
    'skill.evidence_requirement',
    runtime('task_capability_binding.evidence_requirement_snapshot[]'),
    ['bindingId', 'requirementId', 'requirementType'],
    ['capability.task_binding'],
    transactional,
  ),

  defineRecord(
    'mcp_task.tool_call',
    runtime('mcp_invocation'),
    ['invocationId', 'serverId', 'toolName'],
    ['runtime.action'],
    transactional,
  ),
  defineRecord(
    'mcp_task.availability',
    runtime('task_availability_snapshot'),
    ['snapshotId', 'operationName', 'availability'],
    ['mcp_task.tool_call'],
    transactional,
  ),
  defineRecord(
    'mcp_task.remote_binding',
    runtime('remote_task_binding'),
    ['bindingId', 'remoteTaskId', 'version'],
    ['mcp_task.tool_call'],
    transactional,
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
    transactional,
  ),
  defineRecord(
    'mcp_task.poll_attempt',
    runtime('remote_task_protocol_attempt'),
    ['attemptId', 'bindingId', 'status'],
    ['mcp_task.remote_binding'],
    transactional,
  ),
  defineRecord(
    'mcp_task.input_link',
    runtime('remote_task_input_link'),
    ['inputRequestId', 'bindingId', 'status'],
    ['mcp_task.remote_binding'],
    transactional,
  ),
  defineRecord(
    'mcp_task.cancel',
    runtime('remote_task_cancel_request'),
    ['cancelRequestId', 'bindingId', 'deliveryStatus'],
    ['mcp_task.remote_binding'],
    transactional,
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
    transactional,
  ),
  defineRecord(
    'mcp_task.continuation_attempt',
    runtime('workflow_continuation_attempt'),
    ['attemptId', 'snapshotId', 'status'],
    ['mcp_task.continuation_snapshot'],
    transactional,
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
    transactional,
  ),
  defineRecord(
    'capability.execution_attempt',
    runtime('task_capability_execution_attempt'),
    ['attemptId', 'bindingId', 'attemptNo'],
    ['capability.task_binding', 'skill.execution'],
    transactional,
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
    ['episodeId', 'revision', 'episodeHash'],
    ['runtime.episode'],
  ),
  defineRecord(
    'experience.trace',
    runtime('experience_trace'),
    ['traceId', 'sourceEpisodeId', 'completeness'],
    ['experience.episode'],
  ),
  defineRecord(
    'experience.trace_event',
    runtime('experience_trace.trace.events[]'),
    ['traceId', 'eventId', 'eventType'],
    ['experience.trace'],
  ),
  defineRecord(
    'experience.activity',
    runtime('experience_trace.trace.events[].activity'),
    ['traceId', 'eventId', 'activityKey'],
    ['experience.trace_event'],
  ),
  defineRecord(
    'experience.process_variant',
    runtime('pattern_candidate.definition.processVariants[]'),
    ['patternId', 'variantId', 'supportCount'],
    ['experience.trace'],
  ),
  defineRecord(
    'experience.workflow_pattern',
    runtime('pattern_candidate'),
    ['patternId', 'patternType', 'confidence'],
    ['experience.process_variant'],
  ),
  defineRecord(
    'experience.workflow_pattern_dependency',
    runtime('pattern_candidate.definition.dependencies[]'),
    ['patternId', 'dependencyKey', 'dependencyType'],
    ['experience.workflow_pattern'],
  ),
  defineRecord(
    'experience.recovery_pattern',
    runtime('pattern_candidate.definition.recoveryPatterns[]'),
    ['patternId', 'recoveryPatternId', 'triggerActivityKey'],
    ['experience.workflow_pattern'],
  ),
  defineRecord(
    'experience.planning_correction',
    runtime('planning_correction_fact'),
    ['correctionId', 'taskId', 'correctionType'],
    ['runtime.plan', 'experience.episode'],
  ),
  defineRecord(
    'experience.interaction_episode',
    runtime('planning_interaction_episode'),
    ['episodeId', 'taskId', 'revision'],
    ['runtime.episode'],
  ),

  defineRecord(
    'replay.dataset',
    runtime('replay_dataset_manifest'),
    ['datasetId', 'datasetVersion', 'contentHash'],
    ['artifact.lifecycle'],
    { maximumInlineBytes: 131_072 },
  ),
  defineRecord(
    'replay.case',
    runtime('artifact_replay_case'),
    ['replayCaseId', 'taskTypeId', 'contentHash'],
    ['replay.dataset'],
    { maximumInlineBytes: 131_072 },
  ),
  defineRecord(
    'replay.run',
    runtime('artifact_validation_run'),
    ['validationRunId', 'artifactId', 'status'],
    ['replay.dataset', 'artifact.validation'],
  ),
  defineRecord(
    'replay.case_result',
    runtime('artifact_replay_case_result'),
    ['validationRunId', 'replayCaseId', 'resultHash'],
    ['replay.run', 'replay.case'],
  ),
  defineRecord(
    'replay.metric_result',
    runtime('artifact_replay_case_result.metrics[]'),
    ['validationRunId', 'replayCaseId', 'metricKey'],
    ['replay.case_result'],
  ),
  defineRecord(
    'replay.counterexample',
    runtime('artifact_counterexample'),
    ['counterexampleId', 'artifactId', 'replayCaseId'],
    ['replay.case_result', 'artifact.lifecycle'],
  ),

  defineRecord(
    'artifact.lifecycle',
    runtime('compiled_artifact + artifact_lineage'),
    ['artifactId', 'version', 'contentHash'],
    ['experience.workflow_pattern'],
    { maximumInlineBytes: 131_072 },
  ),
  defineRecord(
    'artifact.validation',
    runtime('artifact_validation_run'),
    ['validationRunId', 'artifactId', 'validationType'],
    ['artifact.lifecycle', 'replay.run'],
  ),
  defineRecord(
    'artifact.retrieval',
    runtime('artifact_match_log'),
    ['matchId', 'candidateArtifactId', 'decision'],
    ['artifact.lifecycle', 'runtime.request'],
  ),
  defineRecord(
    'artifact.usage',
    runtime('artifact_execution'),
    ['artifactExecutionId', 'artifactId', 'status'],
    ['artifact.retrieval', 'runtime.episode'],
    transactional,
  ),
  defineRecord(
    'artifact.feedback',
    runtime('artifact_feedback'),
    ['feedbackId', 'artifactExecutionId', 'feedbackType'],
    ['artifact.usage'],
    transactional,
  ),
  defineRecord(
    'artifact.promotion',
    runtime('artifact_promotion_package + artifact_promotion_assessment'),
    ['promotionPackageId', 'artifactId', 'eligibility'],
    ['artifact.validation', 'replay.counterexample'],
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
