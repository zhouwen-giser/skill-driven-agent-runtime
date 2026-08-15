import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_RECORD_CATALOG,
  buildRuntimeSourceArtifact,
  canonicalizeEvidenceJson,
  createArtifactCounterexample,
  createArtifactLineage,
  createArtifactReplayCase,
  createArtifactValidationResult,
  createArtifactValidationRun,
  createCohortDefinition,
  createCompiledArtifact,
  createDiscoveredProcessPattern,
  createExperienceTrace,
  createProcessVariant,
  createReplayDatasetManifest,
  createWorkflowPattern,
  hashCanonicalEvidenceJson,
  hashSourceArtifactJson,
  type CanonicalEvidenceEnvelope,
  type ArtifactReplayCase,
  type ArtifactReplaySafety,
  type EpisodeEvidenceManifest,
  type EvidenceJsonValue,
  type EvidenceQualityIssue,
  type EvidenceSourceCheckpoint,
  type PlanTemplateArtifactDefinition,
  type ReplayDatasetManifest,
} from '../../domain/src/index.js';
import {
  ExperienceReplayArtifactEvidenceProjector,
  type ExperienceReplayArtifactEvidenceSnapshot,
  type ExperienceReplayArtifactEvidenceSource,
  type ExperienceReplayArtifactEvidenceWriter,
  type ExperienceReplayArtifactProjectionPartition,
  type ExperienceReplayArtifactSourceRow,
} from '../src/index.js';

const AT = '2026-08-04T07:00:00.000Z';
const RECORDED_AT = '2026-08-04T08:00:00.000Z';
const TENANT_ID = 'tenant-a';
const USER_ID = 'user-a';
const TASK_ID = 'task-evidence';
const CONTEXT_ID = 'context-evidence';
const GOAL_ID = 'goal-evidence';
const GOAL_VERSION = 2;
const PLAN_ID = 'plan-a';
const PLAN_VERSION = 4;
const EPISODE_ID = 'episode-a';
const TRACE_ID = 'trace-a';
const PATTERN_ID = 'pattern-a';
const WORKFLOW_PATTERN_ID = 'workflow-pattern-a';
const REPLAY_CASE_ID = 'case-a';
const DATASET_ID = 'dataset-a';
const DATASET_VERSION = 2;
const ARTIFACT_ID = 'artifact-a';
const ARTIFACT_VERSION = 3;
const VALIDATION_ID = 'validation-a';
const MATCH_ID = 'match-a';
const USAGE_ID = 'execution-a';
const FEEDBACK_ID = 'feedback-a';
const PROMOTION_ID = 'promotion-a';
const COUNTEREXAMPLE_ID = 'counterexample-a';
const NORMALIZATION_RUN_ID = 'normalization-run-a';
const PROCESS_MINING_RUN_ID = 'process-mining-run-a';

const RUNTIME_EPISODE_REF = `evidence_${'1'.repeat(64)}`;
const RUNTIME_PLAN_REF = `evidence_${'2'.repeat(64)}`;
const RUNTIME_REQUEST_REF = `evidence_${'3'.repeat(64)}`;

const RECORD_TYPES = [
  'experience.episode',
  'experience.trace',
  'experience.trace_event',
  'experience.activity',
  'experience.process_variant',
  'experience.workflow_pattern',
  'experience.workflow_pattern_dependency',
  'experience.recovery_pattern',
  'experience.planning_correction',
  'experience.interaction_episode',
  'replay.dataset',
  'replay.case',
  'replay.run',
  'replay.case_result',
  'replay.metric_result',
  'replay.counterexample',
  'artifact.lifecycle',
  'artifact.validation',
  'artifact.retrieval',
  'artifact.usage',
  'artifact.feedback',
  'artifact.promotion',
] as const;

type RecordType = (typeof RECORD_TYPES)[number];

const PAYLOAD_FIELDS = {
  'experience.episode': [
    'episodeId',
    'taskId',
    'contextId',
    'goalId',
    'goalVersion',
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
  'experience.trace': [
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
  'experience.trace_event': [
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
  'experience.activity': [
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
  'experience.process_variant': [
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
  'experience.workflow_pattern': [
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
  'experience.workflow_pattern_dependency': [
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
  'experience.recovery_pattern': [
    'patternId',
    'recoveryPatternId',
    'triggerActivityKey',
    'resumeActivityKey',
    'activitySequence',
    'requiredCapabilityRefs',
    'supportRefs',
    'patternDefinitionArtifactRef',
  ],
  'experience.planning_correction': [
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
  'experience.interaction_episode': [
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
  'replay.dataset': [
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
  'replay.case': [
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
  'replay.run': [
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
  'replay.case_result': ['validationRunId', 'replayCaseId', 'resultHash', 'evaluation'],
  'replay.metric_result': ['validationRunId', 'replayCaseId', 'metricKey', 'metricValue'],
  'replay.counterexample': [
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
  'artifact.lifecycle': [
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
  'artifact.validation': [
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
  'artifact.retrieval': [
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
  'artifact.usage': [
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
  'artifact.feedback': [
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
  'artifact.promotion': [
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
} as const satisfies Readonly<Record<RecordType, readonly string[]>>;

const TASK_SCOPED_TYPES = new Set<RecordType>([
  'experience.episode',
  'experience.trace',
  'experience.trace_event',
  'experience.activity',
  'experience.planning_correction',
  'experience.interaction_episode',
  'replay.case',
  'replay.case_result',
  'replay.metric_result',
  'replay.counterexample',
  'artifact.retrieval',
  'artifact.usage',
  'artifact.feedback',
]);

const PARTITIONS = Object.freeze([
  partition('experience_task', 'experience', TASK_ID),
  partition('experience_pattern', 'experience', PATTERN_ID),
  partition('replay_case', 'replay', REPLAY_CASE_ID),
  partition('artifact', 'artifact', ARTIFACT_ID, ARTIFACT_VERSION),
  partition('replay_dataset', 'replay', DATASET_ID, DATASET_VERSION),
  partition('validation', 'replay', VALIDATION_ID),
  partition('retrieval', 'artifact', MATCH_ID),
  partition('usage', 'artifact', USAGE_ID),
  partition('feedback', 'artifact', FEEDBACK_ID),
  partition('promotion', 'artifact', PROMOTION_ID),
]);

const EXTERNAL_EVIDENCE = Object.freeze([
  sourceRow({
    record_id: RUNTIME_EPISODE_REF,
    record_type: 'runtime.episode',
    source_record_id: TASK_ID,
    payload: { episodeId: TASK_ID },
  }),
  sourceRow({
    record_id: RUNTIME_PLAN_REF,
    record_type: 'runtime.plan',
    source_record_id: PLAN_ID,
    payload: { planId: PLAN_ID },
  }),
  sourceRow({
    record_id: RUNTIME_REQUEST_REF,
    record_type: 'runtime.request',
    source_record_id: TASK_ID,
    payload: { requestId: TASK_ID },
  }),
]);

describe('ExperienceReplayArtifactEvidenceProjector', () => {
  it('does not refresh a checkpoint when the authoritative partition revision is unchanged', async () => {
    const writer = new MemoryWriter();
    const source = new MemorySource(writer, authorityFixtures());
    const projector = createProjector(source, writer);
    const fixturePartition = PARTITIONS[0];
    if (fixturePartition === undefined) throw new Error('Missing Experience fixture partition.');
    const partition = Object.freeze({
      ...fixturePartition,
      observedAt: '2026-08-04T07:30:00.000Z',
    });

    const first = await projector.projectPartition(partition);
    const checkpointCount = writer.checkpoints.length;
    const second = await projector.projectPartition(partition);

    expect(first.projectedRecordIds.length).toBeGreaterThan(0);
    expect(second.projectedRecordIds).toEqual([]);
    expect(writer.checkpoints).toHaveLength(checkpointCount);
    expect(writer.checkpoints[0]?.lastOccurredAt).toBe(partition.observedAt);
  });

  it('advances only the durable scan cursor when a newer observation has the same authority revision', async () => {
    const writer = new MemoryWriter();
    const source = new MemorySource(writer, authorityFixtures());
    const projector = createProjector(source, writer);
    const fixturePartition = PARTITIONS[0];
    if (fixturePartition === undefined) throw new Error('Missing Experience fixture partition.');
    const firstPartition = Object.freeze({
      ...fixturePartition,
      observedAt: '2026-08-04T07:30:00.000Z',
    });
    const laterPartition = Object.freeze({
      ...fixturePartition,
      observedAt: '2026-08-04T07:45:00.000Z',
    });

    await projector.projectPartition(firstPartition);
    const firstCheckpoint = writer.checkpoints.at(-1);
    const recordCount = writer.records.length;
    const replay = await projector.projectPartition(laterPartition);
    const cursorCheckpoint = writer.checkpoints.at(-1);

    expect(replay.projectedRecordIds).toEqual([]);
    expect(writer.records).toHaveLength(recordCount);
    expect(writer.checkpoints).toHaveLength(2);
    expect(cursorCheckpoint).toMatchObject({
      lastOccurredAt: laterPartition.observedAt,
      lastProjectedAt: firstCheckpoint?.lastProjectedAt,
      lastSourceRevision: firstCheckpoint?.lastSourceRevision,
      lastPayloadHash: firstCheckpoint?.lastPayloadHash,
    });
  });

  it('projects all 22 types through source-centric partitions with complete fields, exact lineage and canonical artifacts', async () => {
    const fixtures = authorityFixtures();
    const writer = new MemoryWriter();
    const source = new MemorySource(writer, fixtures);
    const projector = createProjector(source, writer);

    for (const sourcePartition of PARTITIONS) {
      await projector.projectPartition(sourcePartition);
    }

    expect(new Set(writer.records.map((item) => item.recordType))).toEqual(new Set(RECORD_TYPES));
    expect(writer.issues).toEqual([]);
    expect(writer.checkpoints).toHaveLength(PARTITIONS.length);
    expect(
      writer.checkpoints.every((item) => !item.lastSourceRevision?.startsWith('blocked:')),
    ).toBe(true);
    for (const load of source.loads) {
      expect(new Set(load.existingRecordIds)).toEqual(
        new Set([
          ...EXTERNAL_EVIDENCE.map((row) => row['record_id'] as string),
          ...load.priorRecordIds,
        ]),
      );
    }

    for (const envelope of writer.records) {
      const recordType = envelope.recordType as RecordType;
      expect(RECORD_TYPES).toContain(recordType);
      const payload = payloadRecord(envelope);
      expect(Object.keys(payload).sort()).toEqual([...PAYLOAD_FIELDS[recordType]].sort());
      const catalogEntry = catalog(recordType);
      for (const field of catalogEntry.requiredPayloadFields) expect(payload).toHaveProperty(field);
      expect(
        new TextEncoder().encode(canonicalizeEvidenceJson(payload)).byteLength,
      ).toBeLessThanOrEqual(catalogEntry.maximumInlineBytes);
      if (TASK_SCOPED_TYPES.has(recordType)) {
        expect(envelope).toMatchObject({
          tenantId: TENANT_ID,
          userScopeId: USER_ID,
          taskId: TASK_ID,
          contextId: CONTEXT_ID,
          goalId: GOAL_ID,
          goalVersion: GOAL_VERSION,
        });
      } else {
        expect(envelope).not.toHaveProperty('taskId');
        expect(envelope).not.toHaveProperty('contextId');
        expect(envelope).not.toHaveProperty('userScopeId');
        expect(envelope).not.toHaveProperty('goalId');
        expect(envelope).not.toHaveProperty('planId');
      }
    }

    const episode = record(writer, 'experience.episode');
    const trace = record(writer, 'experience.trace');
    const firstEvent = record(writer, 'experience.trace_event', `${TRACE_ID}:event-start`);
    const secondEvent = record(writer, 'experience.trace_event', `${TRACE_ID}:event-complete`);
    const firstActivity = record(
      writer,
      'experience.activity',
      `${TRACE_ID}:event-start:inspect-area`,
    );
    const secondActivity = record(
      writer,
      'experience.activity',
      `${TRACE_ID}:event-complete:inspect-area`,
    );
    const variant = record(writer, 'experience.process_variant');
    const workflow = record(writer, 'experience.workflow_pattern');
    const correction = record(writer, 'experience.planning_correction');
    const interaction = record(writer, 'experience.interaction_episode');
    const replayCase = record(writer, 'replay.case');
    const lifecycle = record(writer, 'artifact.lifecycle');
    const dataset = record(writer, 'replay.dataset');
    const validation = record(writer, 'artifact.validation');
    const replayRun = record(writer, 'replay.run');
    const caseResult = record(writer, 'replay.case_result');
    const metricResult = record(writer, 'replay.metric_result');
    const counterexample = record(writer, 'replay.counterexample');
    const retrieval = record(writer, 'artifact.retrieval');
    const usage = record(writer, 'artifact.usage');
    const feedback = record(writer, 'artifact.feedback');
    const promotion = record(writer, 'artifact.promotion');

    expectRefs(episode, [RUNTIME_EPISODE_REF]);
    expectRefs(trace, [episode.recordId]);
    expectRefs(firstEvent, [trace.recordId]);
    expectRefs(secondEvent, [trace.recordId, firstEvent.recordId]);
    expectRefs(firstActivity, [firstEvent.recordId]);
    expectRefs(secondActivity, [secondEvent.recordId]);
    expect(firstActivity.recordId).not.toBe(secondActivity.recordId);
    expect(payloadRecord(firstActivity)).toMatchObject({
      activityKey: 'inspect-area',
      activityKind: 'provider_operation',
      objectiveSummary: 'Inspect the selected area through the frozen Provider operation.',
      sourcePlanNodeRef: 'plan-node-inspect',
      sourceSkillGoalRef: 'skill-goal-inspect',
      sourceAttemptRef: 'attempt-start',
      operationRef: 'provider-a/tools/inspect-area',
      capabilityRefs: ['capability.inspect-area'],
      effectRefs: ['effect.area-observed'],
    });
    expect(payloadRecord(secondEvent)).toMatchObject({
      sequence: 1,
      parentEventRefs: ['event-start'],
      concurrencyGroup: 'parallel-inspection',
      branchRef: 'branch-success',
    });
    expectRefs(variant, [trace.recordId]);
    expectRefs(workflow, [variant.recordId]);
    for (const dependency of records(writer, 'experience.workflow_pattern_dependency'))
      expectRefs(dependency, [workflow.recordId]);
    for (const recovery of records(writer, 'experience.recovery_pattern'))
      expectRefs(recovery, [workflow.recordId]);
    expectRefs(correction, [RUNTIME_PLAN_REF, episode.recordId]);
    expectRefs(interaction, [RUNTIME_EPISODE_REF]);
    expectRefs(replayCase, [episode.recordId]);
    expectRefs(lifecycle, [workflow.recordId]);
    expectRefs(dataset, [replayCase.recordId]);
    expectRefs(validation, [lifecycle.recordId]);
    expectRefs(replayRun, [dataset.recordId, validation.recordId]);
    expectRefs(caseResult, [replayRun.recordId, replayCase.recordId]);
    expectRefs(metricResult, [caseResult.recordId]);
    expectRefs(counterexample, [caseResult.recordId, lifecycle.recordId]);
    expectRefs(retrieval, [lifecycle.recordId, RUNTIME_REQUEST_REF]);
    expectRefs(usage, [lifecycle.recordId, retrieval.recordId, RUNTIME_EPISODE_REF]);
    expectRefs(feedback, [usage.recordId]);
    expectRefs(promotion, [lifecycle.recordId, validation.recordId, counterexample.recordId]);

    expect(payloadRecord(trace)).toMatchObject({
      taskTypeRefs: ['task-type-inspection'],
      normalizerVersion: 'sdar-experience-normalizer/1.2',
      traceBody: {
        schemaVersion: '1.2',
        tenantId: TENANT_ID,
        eventRecordIds: [firstEvent.recordId, secondEvent.recordId],
        outcomeStatus: 'succeeded',
      },
    });
    expect(payloadRecord(variant)).toMatchObject({
      activitySequence: ['inspect-area', 'inspect-area', 'verify-area'],
      activityKindSequence: ['provider_operation', 'provider_operation', 'verification'],
      traceRefs: [TRACE_ID],
      successCount: 2,
      failureCount: 1,
    });
    expect(payloadRecord(workflow)).toMatchObject({
      workflowPatternId: WORKFLOW_PATTERN_ID,
      taskTypeId: 'task-type-inspection',
      sourcePatternRef: 'discovered-pattern-a',
      sourceTraceRefs: [TRACE_ID],
    });

    const replayCasePayload = payloadRecord(replayCase);
    const lifecyclePayload = payloadRecord(lifecycle);
    const datasetPayload = payloadRecord(dataset);
    expect(replayCasePayload['artifactRef']).toEqual(fixtures.replayCaseArtifact.artifactRef);
    expect(replayCase.artifactRefs).toEqual([fixtures.replayCaseArtifact.artifactRef.uri]);
    expect(lifecyclePayload['artifactRef']).toEqual(fixtures.compiledArtifactRef.artifactRef);
    expect(lifecycle.artifactRefs).toEqual([fixtures.compiledArtifactRef.artifactRef.uri]);
    expect(datasetPayload['artifactRef']).toEqual(fixtures.datasetArtifact.artifactRef);
    expect(dataset.artifactRefs).toEqual([fixtures.datasetArtifact.artifactRef.uri]);
    expect(replayCasePayload['contentHash']).toBe(fixtures.replayCase.contentHash);
    expect(replayCasePayload['contentHash']).not.toBe(
      fixtures.replayCaseArtifact.artifactRef.sha256,
    );
    expect(datasetPayload['contentHash']).toBe(fixtures.dataset.contentHash);
    expect(datasetPayload['contentHash']).not.toBe(fixtures.datasetArtifact.artifactRef.sha256);
    expect(lifecyclePayload['contentHash']).toBe(fixtures.compiledArtifactRef.artifactRef.sha256);
    expect(lifecyclePayload['policyRefs']).toEqual(['policy.read-only@2']);
    for (const artifact of [
      fixtures.replayCaseArtifact,
      fixtures.compiledArtifactRef,
      fixtures.datasetArtifact,
    ]) {
      expect(artifact.artifactRef).toMatchObject({
        mediaType: 'application/json',
        sha256: hashCanonicalBytes(artifact.canonicalJson),
        byteSize: new TextEncoder().encode(artifact.canonicalJson).byteLength,
      });
      expect(artifact.artifactRef.uri).toMatch(/^artifact:\/\/runtime\/v1\//u);
    }
    expect(JSON.stringify(payloadRecord(lifecycle))).not.toContain('skillGoalGraph');

    expect(payloadRecord(replayCase)).not.toHaveProperty('noPhysicalSideEffects');
    expect(payloadRecord(dataset)).not.toHaveProperty('noPhysicalSideEffects');
    expect(payloadRecord(caseResult)).not.toHaveProperty('noPhysicalSideEffects');
    expect(payloadRecord(replayRun)).toMatchObject({
      replaySafetyStatus: 'verified',
      replaySafety: fixtures.replaySafety,
      noPhysicalSideEffects: true,
    });
    expect(payloadRecord(metricResult)).toEqual({
      validationRunId: VALIDATION_ID,
      replayCaseId: REPLAY_CASE_ID,
      metricKey: 'goal_satisfaction',
      metricValue: 0.98,
    });
    expect(JSON.stringify(writer.records)).not.toContain('privateReasoning');

    expect(workflow).toMatchObject({ tenantId: TENANT_ID, runId: PROCESS_MINING_RUN_ID });
    expect(trace).toMatchObject({ episodeId: TASK_ID, runId: NORMALIZATION_RUN_ID });
    expect(replayRun).toMatchObject({ tenantId: TENANT_ID, runId: VALIDATION_ID });
    expect(validation).toMatchObject({ tenantId: TENANT_ID, runId: VALIDATION_ID });
    expect(lifecycle).toMatchObject({ tenantId: TENANT_ID });
    expect(usage).toMatchObject({
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      planId: PLAN_ID,
      planVersion: PLAN_VERSION,
    });
  });

  it('records a missing required reference and preserves a blocked retry checkpoint', async () => {
    const fixtures = authorityFixtures();
    const writer = new MemoryWriter();
    const missingCaseDataset = sourceRow({
      ...fixtures.datasetRow,
      case_refs: ['missing-replay-case'],
    });
    const source = new MemorySource(writer, {
      ...fixtures,
      datasetRow: missingCaseDataset,
    });
    const projector = createProjector(source, writer);
    const datasetPartition = PARTITIONS.find((item) => item.kind === 'replay_dataset');
    if (datasetPartition === undefined) throw new Error('Missing Dataset partition fixture.');

    const result = await projector.projectPartition(datasetPartition);

    expect(result.projectedRecordIds).toEqual([]);
    expect(result.qualityIssueIds).toHaveLength(1);
    expect(writer.records).toEqual([]);
    expect(writer.issues).toHaveLength(1);
    expect(writer.issues[0]).toMatchObject({
      issueId: result.qualityIssueIds[0],
      issueCode: 'reference_unresolved',
      severity: 'blocking',
      recordType: 'replay.dataset',
      sourceTable: 'replay_dataset_manifest',
      sourceRecordId: `${DATASET_ID}:${String(DATASET_VERSION)}`,
      detail: {
        missingReference: 'replay.case',
        missingSourceId: 'missing-replay-case',
      },
    });
    expect(writer.checkpoints).toHaveLength(1);
    expect(writer.checkpoints[0]).toMatchObject({
      sourceFamily: 'replay',
      sourcePartition: datasetPartition.sourcePartition,
      lastSourceRecordId: `${DATASET_ID}:${String(DATASET_VERSION)}`,
      lastSourceRevision: expect.stringMatching(/^blocked:[0-9a-f]{64}$/u),
      lastPayloadHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    expect(writer.sourceResolutions).toEqual([
      {
        sourceTable: 'replay_dataset_manifest',
        sourceRecordId: `${DATASET_ID}:${String(DATASET_VERSION)}`,
        recordTypePrefix: 'replay.dataset',
        retainedIssueIds: result.qualityIssueIds,
        resolvedAt: RECORDED_AT,
      },
    ]);
    expect(writer.terminalOperations).toEqual(['resolve_source_quality', 'save_checkpoint']);
  });

  it('rejects a replay proof whose persisted result payload drifts from the validation columns', async () => {
    const fixtures = authorityFixtures();
    const writer = new MemoryWriter();
    const source = new MemorySource(writer, {
      ...fixtures,
      validationRow: sourceRow({
        ...fixtures.validationRow,
        metrics: { goal_satisfaction: 0.12, side_effect_attempt_count: 0 },
      }),
    });
    const projector = createProjector(source, writer);
    for (const sourcePartition of PARTITIONS.slice(0, 6)) {
      await projector.projectPartition(sourcePartition);
    }

    expect(records(writer, 'artifact.validation')).toEqual([]);
    expect(records(writer, 'replay.run')).toEqual([]);
    expect(writer.issues).toContainEqual(
      expect.objectContaining({
        issueCode: 'payload_hash_conflict',
        recordType: 'replay.run',
        sourceTable: 'artifact_validation_run',
        sourceRecordId: VALIDATION_ID,
      }),
    );
    expect(writer.checkpoints.at(-1)?.lastSourceRevision).toMatch(/^blocked:[0-9a-f]{64}$/u);
  });

  it('rejects usage when the exact retrieval version differs from the executed Artifact version', async () => {
    const fixtures = authorityFixtures();
    const writer = new MemoryWriter();
    const source = new MemorySource(writer, {
      ...fixtures,
      usageRow: sourceRow({
        ...fixtures.usageRow,
        retrieval_artifact_version: ARTIFACT_VERSION + 1,
      }),
    });
    const projector = createProjector(source, writer);
    for (const sourcePartition of PARTITIONS.slice(0, 8)) {
      await projector.projectPartition(sourcePartition);
    }

    expect(records(writer, 'artifact.usage')).toEqual([]);
    expect(writer.issues).toContainEqual(
      expect.objectContaining({
        issueCode: 'reference_unresolved',
        recordType: 'artifact.usage',
        sourceTable: 'artifact_execution',
        sourceRecordId: USAGE_ID,
        detail: expect.objectContaining({
          retrievalArtifactVersion: ARTIFACT_VERSION + 1,
        }),
      }),
    );
    expect(writer.checkpoints.at(-1)?.lastSourceRevision).toMatch(/^blocked:[0-9a-f]{64}$/u);
  });

  it('keeps child source identities stable and revision IDs integrity-bound when arrays reorder', async () => {
    const firstFixtures = authorityFixtures();
    const reversedFixtures = authorityFixtures({ reversePatternChildren: true });
    const firstWriter = await projectThroughPattern(firstFixtures);
    const reversedWriter = await projectThroughPattern(reversedFixtures);

    for (const type of [
      'experience.workflow_pattern_dependency',
      'experience.recovery_pattern',
    ] as const) {
      expect(
        records(firstWriter, type)
          .map((item) => item.recordId)
          .sort(),
      ).not.toEqual(
        records(reversedWriter, type)
          .map((item) => item.recordId)
          .sort(),
      );
      expect(
        records(firstWriter, type)
          .map((item) => item.sourceRecordId)
          .sort(),
      ).toEqual(
        records(reversedWriter, type)
          .map((item) => item.sourceRecordId)
          .sort(),
      );
    }
  });

  it(
    'externalizes a legal 10k Pattern without truncating associations or exceeding envelope refs',
    { timeout: 30_000 },
    async () => {
      const large = largePatternFixtures(10_000);
      const writer = new MemoryWriter();
      const source = new MemorySource(writer, large.fixtures, large.existingEvidence);
      const projector = createProjector(source, writer);
      const patternPartition = PARTITIONS[1];
      if (patternPartition === undefined) throw new Error('Pattern partition fixture is missing.');

      await projector.projectPartition(patternPartition);

      expect(writer.issues).toEqual([]);
      const variant = record(writer, 'experience.process_variant');
      const variantPayload = payloadRecord(variant);
      expect(variant.evidenceRefs).toEqual([]);
      expect(variant.artifactRefs).toEqual([large.artifact.artifactRef.uri]);
      expect(variantPayload['traceRefs']).toEqual({
        artifactRefUri: large.artifact.artifactRef.uri,
        jsonPointer: '/variants/0/traceRefs',
        count: 10_000,
        sha256: hashSourceArtifactJson(large.traceIds),
      });
      expect(variantPayload['patternDefinitionArtifactRef']).toEqual(large.artifact.artifactRef);

      const workflow = record(writer, 'experience.workflow_pattern');
      const workflowPayload = payloadRecord(workflow);
      expect(workflow.evidenceRefs).toEqual([variant.recordId]);
      expect(workflow.artifactRefs).toEqual([large.artifact.artifactRef.uri]);
      expect(workflowPayload['supportRefs']).toEqual({
        artifactRefUri: large.artifact.artifactRef.uri,
        jsonPointer: '/discoveredPattern/supportRefs',
        count: 10_000,
        sha256: hashSourceArtifactJson(large.traceIds),
      });
      expect(workflowPayload['sourceTraceRefs']).toEqual({
        artifactRefUri: large.artifact.artifactRef.uri,
        jsonPointer: '/workflowPattern/sourceTraceRefs',
        count: 10_000,
        sha256: hashSourceArtifactJson(large.traceIds),
      });
      expect(workflowPayload['processVariantSet']).toEqual({
        artifactRefUri: large.artifact.artifactRef.uri,
        jsonPointer: '/variants',
        count: 1,
        sha256: hashSourceArtifactJson(
          jsonObject(large.definition)['variants'] as readonly EvidenceJsonValue[],
        ),
      });
      expect(
        writer.records.every(
          (envelope) => envelope.evidenceRefs.length <= 256 && envelope.artifactRefs.length <= 256,
        ),
      ).toBe(true);
    },
  );
});

function createProjector(source: MemorySource, writer: MemoryWriter) {
  return new ExperienceReplayArtifactEvidenceProjector({
    source,
    writer,
    environment: 'test',
    clock: { now: () => RECORDED_AT },
  });
}

async function projectThroughPattern(fixtures: AuthorityFixtures) {
  const writer = new MemoryWriter();
  const source = new MemorySource(writer, fixtures);
  const projector = createProjector(source, writer);
  for (const sourcePartition of PARTITIONS.slice(0, 2))
    await projector.projectPartition(sourcePartition);
  return writer;
}

class MemorySource implements ExperienceReplayArtifactEvidenceSource {
  readonly loads: {
    readonly sourcePartition: string;
    readonly priorRecordIds: readonly string[];
    readonly existingRecordIds: readonly string[];
  }[] = [];

  constructor(
    private readonly writer: MemoryWriter,
    private readonly fixtures: AuthorityFixtures,
    private readonly additionalExistingEvidence: readonly ExperienceReplayArtifactSourceRow[] = [],
  ) {}

  pendingPartitions(
    limit: number,
  ): Promise<readonly ExperienceReplayArtifactProjectionPartition[]> {
    return Promise.resolve(PARTITIONS.slice(0, limit));
  }

  load(
    sourcePartition: ExperienceReplayArtifactProjectionPartition,
  ): Promise<ExperienceReplayArtifactEvidenceSnapshot | undefined> {
    const snapshot = snapshotFor(sourcePartition, this.fixtures);
    if (snapshot === undefined) return Promise.resolve(undefined);
    const priorRecordIds = this.writer.records.map((item) => item.recordId);
    const existingEvidence = [
      ...EXTERNAL_EVIDENCE,
      ...this.additionalExistingEvidence,
      ...this.writer.records.map((item) =>
        sourceRow({
          record_id: item.recordId,
          record_type: item.recordType,
          source_record_id: item.sourceRecordId,
          payload: item.payload,
        }),
      ),
    ];
    this.loads.push({
      sourcePartition: sourcePartition.sourcePartition,
      priorRecordIds: Object.freeze([...priorRecordIds]),
      existingRecordIds: Object.freeze(existingEvidence.map((row) => text(row, 'record_id'))),
    });
    const checkpoint = [...this.writer.checkpoints]
      .reverse()
      .find(
        (candidate) =>
          candidate.sourceFamily === sourcePartition.sourceFamily &&
          candidate.sourcePartition === sourcePartition.sourcePartition,
      );
    return Promise.resolve(
      Object.freeze({
        ...snapshot,
        existingEvidence,
        ...(checkpoint === undefined
          ? {}
          : {
              checkpoint: sourceRow({
                source_family: checkpoint.sourceFamily,
                source_partition: checkpoint.sourcePartition,
                last_occurred_at: checkpoint.lastOccurredAt ?? null,
                last_source_record_id: checkpoint.lastSourceRecordId ?? null,
                last_source_revision: checkpoint.lastSourceRevision ?? null,
                last_payload_hash: checkpoint.lastPayloadHash ?? null,
                last_projected_at: checkpoint.lastProjectedAt ?? null,
                projector_version: checkpoint.projectorVersion,
              }),
            }),
      }),
    );
  }
}

class MemoryWriter implements ExperienceReplayArtifactEvidenceWriter {
  readonly records: CanonicalEvidenceEnvelope[] = [];
  readonly issues: EvidenceQualityIssue[] = [];
  readonly checkpoints: EvidenceSourceCheckpoint[] = [];
  readonly manifests: EpisodeEvidenceManifest[] = [];
  readonly sourceResolutions: {
    readonly sourceTable: string;
    readonly sourceRecordId: string;
    readonly recordTypePrefix: string;
    readonly retainedIssueIds: readonly string[];
    readonly resolvedAt: string;
  }[] = [];
  readonly episodeResolutions: {
    readonly episodeId: string;
    readonly recordTypePrefix: string;
    readonly retainedIssueIds: readonly string[];
    readonly resolvedAt: string;
  }[] = [];
  readonly terminalOperations: string[] = [];
  readonly #sequences = new Map<string, string>();

  append(
    envelope: CanonicalEvidenceEnvelope,
    _capturedAt: string,
    _sourcePartition: string,
  ): Promise<string> {
    void _capturedAt;
    void _sourcePartition;
    const prior = this.records.find((item) => item.recordId === envelope.recordId);
    if (prior !== undefined) {
      if (prior.payloadHash !== envelope.payloadHash)
        throw new Error(`Memory Evidence payload conflict for ${envelope.recordId}.`);
      const sequence = this.#sequences.get(envelope.recordId);
      if (sequence === undefined) throw new Error('Memory Evidence sequence missing.');
      return Promise.resolve(sequence);
    }
    const sequence = String(this.records.length + 1);
    this.records.push(envelope);
    this.#sequences.set(envelope.recordId, sequence);
    return Promise.resolve(sequence);
  }

  recordQualityIssue(issue: EvidenceQualityIssue): Promise<void> {
    const index = this.issues.findIndex((item) => item.issueId === issue.issueId);
    if (index === -1) this.issues.push(issue);
    else this.issues[index] = issue;
    return Promise.resolve();
  }

  saveCheckpoint(checkpoint: EvidenceSourceCheckpoint): Promise<void> {
    this.terminalOperations.push('save_checkpoint');
    this.checkpoints.push(checkpoint);
    return Promise.resolve();
  }

  saveManifest(manifest: EpisodeEvidenceManifest): Promise<void> {
    this.manifests.push(manifest);
    return Promise.resolve();
  }

  resolveQualityIssues(input: {
    readonly episodeId: string;
    readonly recordTypePrefix: string;
    readonly retainedIssueIds: readonly string[];
    readonly resolvedAt: string;
  }): Promise<void> {
    this.episodeResolutions.push(input);
    return Promise.resolve();
  }

  resolveSourceQualityIssues(input: {
    readonly sourceTable: string;
    readonly sourceRecordId: string;
    readonly recordTypePrefix: string;
    readonly retainedIssueIds: readonly string[];
    readonly resolvedAt: string;
  }): Promise<void> {
    this.terminalOperations.push('resolve_source_quality');
    this.sourceResolutions.push(input);
    return Promise.resolve();
  }
}

interface AuthorityFixtures {
  readonly taskRow: ExperienceReplayArtifactSourceRow;
  readonly episodeRow: ExperienceReplayArtifactSourceRow;
  readonly traceRow: ExperienceReplayArtifactSourceRow;
  readonly patternRow: ExperienceReplayArtifactSourceRow;
  readonly correctionRow: ExperienceReplayArtifactSourceRow;
  readonly interactionRow: ExperienceReplayArtifactSourceRow;
  readonly replayCaseRow: ExperienceReplayArtifactSourceRow;
  readonly datasetRow: ExperienceReplayArtifactSourceRow;
  readonly artifactRow: ExperienceReplayArtifactSourceRow;
  readonly validationRow: ExperienceReplayArtifactSourceRow;
  readonly caseResultRow: ExperienceReplayArtifactSourceRow;
  readonly counterexampleRow: ExperienceReplayArtifactSourceRow;
  readonly retrievalRow: ExperienceReplayArtifactSourceRow;
  readonly usageRow: ExperienceReplayArtifactSourceRow;
  readonly feedbackRow: ExperienceReplayArtifactSourceRow;
  readonly promotionRow: ExperienceReplayArtifactSourceRow;
  readonly replayCaseArtifact: ReturnType<typeof buildRuntimeSourceArtifact>;
  readonly datasetArtifact: ReturnType<typeof buildRuntimeSourceArtifact>;
  readonly compiledArtifactRef: ReturnType<typeof buildRuntimeSourceArtifact>;
  readonly replayCase: ArtifactReplayCase;
  readonly dataset: ReplayDatasetManifest;
  readonly replaySafety: ArtifactReplaySafety;
}

function authorityFixtures(
  options: Readonly<{ reversePatternChildren?: boolean; patternHash?: string }> = {},
): AuthorityFixtures {
  const trace = createExperienceTrace({
    traceId: TRACE_ID,
    sourceEpisodeId: EPISODE_ID,
    taskTypeRefs: ['task-type-inspection'],
    goalFingerprint: hash('4'),
    capabilityFingerprint: hash('5'),
    environmentFingerprint: hash('6'),
    trace: {
      schemaVersion: '1.2',
      tenantId: TENANT_ID,
      events: [
        {
          eventId: 'event-start',
          sequence: 0,
          occurredAt: AT,
          eventType: 'skill_attempt_started',
          actorType: 'runtime',
          activity: {
            activityKey: 'inspect-area',
            activityKind: 'provider_operation',
            objectiveSummary: 'Inspect the selected area through the frozen Provider operation.',
            sourcePlanNodeRef: 'plan-node-inspect',
            sourceSkillGoalRef: 'skill-goal-inspect',
            sourceAttemptRef: 'attempt-start',
            operationRef: 'provider-a/tools/inspect-area',
            capabilityRefs: ['capability.inspect-area'],
            effectRefs: ['effect.area-observed'],
          },
          capabilityRefs: ['capability.inspect-area'],
          authorityRefs: ['provider-operation.inspect-area'],
          parentEventRefs: [],
          concurrencyGroup: 'parallel-inspection',
          branchRef: 'branch-success',
          payloadSummary: { lifecycle: 'started' },
        },
        {
          eventId: 'event-complete',
          sequence: 1,
          occurredAt: '2026-08-04T07:00:01.000Z',
          eventType: 'skill_attempt_completed',
          actorType: 'provider',
          activity: {
            activityKey: 'inspect-area',
            activityKind: 'provider_operation',
            objectiveSummary: 'Confirm the same inspection activity completed with evidence.',
            sourcePlanNodeRef: 'plan-node-inspect',
            sourceSkillGoalRef: 'skill-goal-inspect',
            sourceAttemptRef: 'attempt-complete',
            operationRef: 'provider-a/tools/inspect-area',
            capabilityRefs: ['capability.inspect-area'],
            effectRefs: ['effect.area-observed'],
          },
          capabilityRefs: ['capability.inspect-area'],
          authorityRefs: ['provider-operation.inspect-area'],
          parentEventRefs: ['event-start'],
          concurrencyGroup: 'parallel-inspection',
          branchRef: 'branch-success',
          payloadSummary: { lifecycle: 'completed', outcome: 'observed' },
        },
      ],
      correctionRefs: ['correction-a'],
      outcomeRef: 'outcome-a',
      outcomeStatus: 'succeeded',
      missingFactCodes: [],
      environmentClass: 'trusted-intranet',
      deviceClass: 'inspection-sensor',
    },
    completeness: 1,
    dataClassification: 'user_scoped',
    normalizerVersion: 'sdar-experience-normalizer/1.2',
    sourceHash: hash('7'),
    createdAt: AT,
  });
  const quality = Object.freeze({
    supportCount: 3,
    totalTraceCount: 4,
    supportRate: 0.75,
    successRate: 0.67,
    traceCoverage: 1,
    fitness: 0.95,
    precisionProxy: 0.9,
    environmentCoverage: 0.8,
    contradictionRate: 0.05,
    generalization: 0.85,
    mandatoryThreshold: 0.7,
  });
  const cohort = createCohortDefinition({
    tenantId: TENANT_ID,
    taskTypeId: 'task-type-inspection',
    goalFingerprint: trace.goalFingerprint,
    capabilityFingerprint: trace.capabilityFingerprint,
    environmentClass: 'trusted-intranet',
    deviceClass: 'inspection-sensor',
    minimumCompleteness: 0.9,
  });
  const variant = createProcessVariant({
    variantId: 'variant-a',
    activitySequence: ['inspect-area', 'inspect-area', 'verify-area'],
    activityKindSequence: ['provider_operation', 'provider_operation', 'verification'],
    concurrencyGroups: [['inspect-area', 'verify-area']],
    branchSequence: ['branch-success'],
    occurrenceCount: 3,
    traceRefs: [TRACE_ID],
    successCount: 2,
    failureCount: 1,
  });
  const dependencies = [
    {
      predecessorActivityKey: 'inspect-area',
      successorActivityKey: 'inspect-area',
      relation: 'direct_follows' as const,
      supportRefs: [TRACE_ID],
      contradictionRefs: [],
    },
    {
      predecessorActivityKey: 'inspect-area',
      successorActivityKey: 'verify-area',
      relation: 'parallel' as const,
      supportRefs: [TRACE_ID],
      contradictionRefs: [],
    },
    {
      predecessorActivityKey: 'verify-area',
      successorActivityKey: 'recover-area',
      relation: 'conditional' as const,
      condition: {
        type: 'atomic' as const,
        field: 'verification.passed',
        operator: 'eq' as const,
        value: false,
      },
      supportRefs: [TRACE_ID],
      contradictionRefs: [],
    },
  ];
  const recoveries = [
    {
      triggerActivityKey: 'verify-area',
      resumeActivityKey: 'inspect-area',
      activitySequence: ['verify-area', 'recover-area', 'inspect-area'],
      requiredCapabilityRefs: ['capability.inspect-area'],
      supportRefs: [TRACE_ID],
    },
    {
      triggerActivityKey: 'inspect-area',
      resumeActivityKey: 'verify-area',
      activitySequence: ['inspect-area', 'verify-area'],
      requiredCapabilityRefs: ['capability.verify-area'],
      supportRefs: [TRACE_ID],
    },
  ];
  const workflowPattern = createWorkflowPattern({
    workflowPatternId: WORKFLOW_PATTERN_ID,
    taskTypeId: 'task-type-inspection',
    activityPatterns: [
      {
        activityKey: 'inspect-area',
        activityKind: 'provider_operation',
        objectiveSummary: 'Inspect the selected area.',
        required: true,
        supportCount: 3,
        supportRate: 1,
        capabilityRefs: ['capability.inspect-area'],
        effectRefs: ['effect.area-observed'],
        lifecycleEventTypes: ['skill_attempt_started', 'skill_attempt_completed'],
      },
      {
        activityKey: 'verify-area',
        activityKind: 'verification',
        objectiveSummary: 'Verify the observation evidence.',
        required: true,
        supportCount: 3,
        supportRate: 1,
        capabilityRefs: ['capability.verify-area'],
        effectRefs: ['effect.area-verified'],
        lifecycleEventTypes: ['business_event_observed'],
      },
      {
        activityKey: 'recover-area',
        activityKind: 'reasoning',
        objectiveSummary: 'Recover a failed inspection boundary.',
        required: false,
        supportCount: 1,
        supportRate: 0.33,
        capabilityRefs: ['capability.inspect-area'],
        effectRefs: ['effect.area-observed'],
        lifecycleEventTypes: ['recovery_started'],
      },
    ],
    dependencyPatterns: options.reversePatternChildren ? [...dependencies].reverse() : dependencies,
    recoveryPatterns: options.reversePatternChildren ? [...recoveries].reverse() : recoveries,
    sourcePatternRef: 'discovered-pattern-a',
    sourceTraceRefs: [TRACE_ID],
    quality,
  });
  const discoveredPattern = createDiscoveredProcessPattern({
    patternId: 'discovered-pattern-a',
    cohortFingerprint: hash('8'),
    algorithmVersion: 'sdar-deterministic-process-miner/1.2',
    mandatoryActivities: ['inspect-area', 'verify-area'],
    optionalActivities: ['recover-area'],
    orderingConstraints: [
      {
        predecessorActivity: 'inspect-area',
        successorActivity: 'verify-area',
        relation: 'precedes',
        supportRefs: [TRACE_ID],
        contradictionRefs: [],
      },
    ],
    parallelCandidates: [
      {
        activityRefs: ['inspect-area', 'verify-area'],
        evidenceType: 'explicit_concurrency',
        supportRefs: [TRACE_ID],
        contradictionRefs: [],
      },
    ],
    recoveryBranches: recoveries,
    failureVariants: [
      {
        activitySequence: ['inspect-area', 'verify-area'],
        failureActivity: 'verify-area',
        traceRefs: [TRACE_ID],
        count: 1,
      },
    ],
    supportRefs: [TRACE_ID],
    contradictionRefs: [],
    environmentCoverage: ['trusted-intranet'],
    quality,
  });
  const patternDefinition = sourceRow({
    schemaVersion: '1.2',
    cohort: evidenceJson(cohort),
    variants: evidenceJson([variant]),
    discoveredPattern: evidenceJson(discoveredPattern),
    workflowPattern: evidenceJson(workflowPattern),
  });
  const patternDefinitionArtifact = buildRuntimeSourceArtifact({
    sourceTable: 'pattern_candidate',
    sourceRecordId: PATTERN_ID,
    sourceVersion: 1,
    value: patternDefinition,
  });
  const definitionHash = options.patternHash ?? patternDefinitionArtifact.artifactRef.sha256;

  const replayCase = createArtifactReplayCase({
    replayCaseId: REPLAY_CASE_ID,
    tenantId: TENANT_ID,
    requestSnapshotRef: 'request-snapshot-a',
    goalContractSnapshotRef: 'goal-contract-snapshot-a',
    capabilityCatalogSnapshotRef: 'capability-catalog-snapshot-a',
    worldStateSnapshotRef: 'world-state-snapshot-a',
    policySnapshotRef: 'policy-snapshot-a',
    readinessSnapshotRef: 'readiness-snapshot-a',
    acceptedPlanSnapshotRef: 'accepted-plan-snapshot-a',
    executionTraceSnapshotRef: TRACE_ID,
    outcomeSnapshotRef: 'outcome-a',
    correctionRefs: ['correction-a'],
    environmentClass: 'trusted-intranet',
    deviceClass: 'inspection-sensor',
    taskTypeId: 'task-type-inspection',
    sourceEpisodeRefs: [EPISODE_ID],
    goalLineageHash: hash('9'),
    snapshotCompleteness: 1,
    contentHash: hash('c'),
  });
  const replayCaseContent = evidenceJson(replayCase);
  const replayCaseArtifact = buildRuntimeSourceArtifact({
    sourceTable: 'artifact_replay_case',
    sourceRecordId: REPLAY_CASE_ID,
    sourceVersion: 1,
    value: replayCaseContent,
  });

  const dataset = createReplayDatasetManifest({
    datasetId: DATASET_ID,
    datasetVersion: DATASET_VERSION,
    purpose: 'promotion_holdout',
    tenantId: TENANT_ID,
    taskTypeIds: ['task-type-inspection'],
    caseRefs: [REPLAY_CASE_ID],
    splitPolicyVersion: 'split-policy-v2',
    sourceRange: { from: AT, to: AT },
    sourceHash: hash('a'),
    contentHash: hash('d'),
    leakageCheckRef: 'leakage-check-a',
    createdAt: AT,
  });
  const datasetContent = evidenceJson(dataset);
  const datasetArtifact = buildRuntimeSourceArtifact({
    sourceTable: 'replay_dataset_manifest',
    sourceRecordId: DATASET_ID,
    sourceVersion: DATASET_VERSION,
    value: datasetContent,
  });

  const artifactDefinition = planTemplateDefinition();
  const compiledArtifactRef = buildRuntimeSourceArtifact({
    sourceTable: 'compiled_artifact',
    sourceRecordId: ARTIFACT_ID,
    sourceVersion: ARTIFACT_VERSION,
    value: evidenceJson(artifactDefinition),
  });
  const compiledArtifact = createCompiledArtifact({
    artifactId: ARTIFACT_ID,
    artifactKey: 'inspection-plan-template',
    version: ARTIFACT_VERSION,
    artifactType: 'plan_template',
    name: 'Inspection plan template',
    description: 'Materializes a bounded inspection and verification plan.',
    scope: {
      tenantId: TENANT_ID,
      domain: 'inspection',
      taskTypeIds: ['task-type-inspection'],
    },
    definition: artifactDefinition,
    applicability: {
      requiredConditions: [],
      optionalConditions: [],
      forbiddenConditions: [],
      requiredParameters: ['areaId'],
      allowedEnvironmentClasses: ['trusted-intranet'],
      excludedEnvironmentClasses: [],
      minimumIntentScore: 0.8,
      minimumConditionScore: 0.8,
      maximumUncertainty: 0.2,
      outOfDistributionPolicy: 'require_confirmation',
    },
    requiredCapabilities: [{ capabilityId: 'capability.inspect-area' }],
    requiredPolicies: [{ policyId: 'policy.read-only', version: '2' }],
    dependencySnapshot: {
      capabilityCatalogHash: hash('b'),
      policyVersionRefs: ['policy.read-only@2'],
      taskTypeVersionRefs: ['task-type-inspection@2'],
      schemaVersionRefs: ['artifact.contract@1.2'],
      requiredSkillVersionRefs: ['skill.inspect-area@2'],
      compilerVersion: 'compiler.1.2',
    },
    riskLevel: 'low',
    status: 'candidate',
    lineageRef: 'lineage-a',
    contentHash: compiledArtifactRef.artifactRef.sha256,
    createdAt: AT,
  });
  const artifactLineage = createArtifactLineage({
    lineageId: 'lineage-a',
    artifactId: ARTIFACT_ID,
    artifactVersion: ARTIFACT_VERSION,
    sourceEpisodeRefs: [EPISODE_ID],
    sourceKnowledgeRefs: [],
    sourceCorrectionRefs: ['correction-a'],
    sourcePatternRefs: [WORKFLOW_PATTERN_ID],
    generationMethods: ['process_mining'],
    validationRunRefs: [VALIDATION_ID],
    supersedesArtifactRefs: [],
  });

  const validationRun = createArtifactValidationRun({
    validationRunId: VALIDATION_ID,
    artifactId: ARTIFACT_ID,
    artifactVersion: ARTIFACT_VERSION,
    validationType: 'replay',
    datasetRef: DATASET_ID,
    status: 'passed',
    result: 'passed',
    metrics: { goal_satisfaction: 0.98, side_effect_attempt_count: 0 },
    counterexampleRefs: [COUNTEREXAMPLE_ID],
    startedAt: AT,
    completedAt: '2026-08-04T07:01:00.000Z',
  });
  const validationResult = createArtifactValidationResult({
    validationRunId: VALIDATION_ID,
    artifactRef: `${ARTIFACT_ID}:v${String(ARTIFACT_VERSION)}`,
    datasetRef: `${DATASET_ID}:v${String(DATASET_VERSION)}`,
    validationType: 'replay',
    metrics: { goal_satisfaction: 0.98, side_effect_attempt_count: 0 },
    failureRefs: [],
    counterexampleRefs: [COUNTEREXAMPLE_ID],
    unsafe: false,
    result: 'passed',
    validatorVersion: 'validator.1.2',
    metricCatalogVersion: 'metrics.1.2',
    artifactHash: compiledArtifact.contentHash,
    datasetHash: dataset.contentHash,
    resultHash: hash('c'),
    replaySafety: {
      provider: 'ReplayNoPhysicalProvider',
      physicalAdapterInvocationCount: 0,
      sideEffectAttemptCount: 0,
      deniedBeforePhysicalBoundaryCount: 0,
      denialEvidenceRefs: [],
      physicalOutcomeClaim: 'none',
    },
    completedAt: '2026-08-04T07:01:00.000Z',
  });
  if (validationResult.validationType !== 'replay')
    throw new Error('Fixture Replay validation result was not narrowed.');
  const counterexample = createArtifactCounterexample({
    counterexampleId: COUNTEREXAMPLE_ID,
    artifactRef: `${ARTIFACT_ID}:v${String(ARTIFACT_VERSION)}`,
    replayCaseRef: REPLAY_CASE_ID,
    failureRef: 'failure-a',
    conditionFingerprint: hash('d'),
    environmentClass: 'trusted-intranet',
    failureBoundaryCandidate: { boundary: 'verification-mismatch', preserved: true },
    sourceRefs: [REPLAY_CASE_ID],
    status: 'recorded',
    createdAt: AT,
  });
  const validationCounterexamples = [
    {
      counterexampleId: COUNTEREXAMPLE_ID,
      content: evidenceJson(counterexample),
    },
  ];
  const counterexampleSummaryHash = hashCanonicalEvidenceJson(
    validationCounterexamples.map((item) => item.content),
  );

  const validationRow = sourceRow({
    validation_run_id: validationRun.validationRunId,
    artifact_id: validationRun.artifactId,
    artifact_version: validationRun.artifactVersion,
    validation_type: validationRun.validationType,
    dataset_ref: validationRun.datasetRef,
    dataset_version: DATASET_VERSION,
    artifact_hash: compiledArtifact.contentHash,
    dataset_hash: dataset.contentHash,
    status: validationRun.status,
    result: validationRun.result ?? null,
    metrics: evidenceJson(validationRun.metrics),
    counterexample_refs: evidenceJson(validationRun.counterexampleRefs),
    started_at: validationRun.startedAt,
    completed_at: validationRun.completedAt ?? null,
    result_hash: validationResult.resultHash,
    validator_version: validationResult.validatorVersion,
    metric_catalog_version: validationResult.metricCatalogVersion,
    result_payload: evidenceJson(validationResult),
    artifact_tenant_id: TENANT_ID,
    updated_at: validationResult.completedAt,
    created_at: AT,
  });
  const counterexampleRow = sourceRow({
    counterexample_id: COUNTEREXAMPLE_ID,
    validation_run_id: VALIDATION_ID,
    replay_case_id: REPLAY_CASE_ID,
    artifact_id: ARTIFACT_ID,
    artifact_version: ARTIFACT_VERSION,
    failure_id: 'failure-a',
    condition_fingerprint: counterexample.conditionFingerprint,
    status: counterexample.status,
    content: evidenceJson(counterexample),
    created_at: counterexample.createdAt,
    source_task_id: TASK_ID,
    source_context_id: CONTEXT_ID,
    source_episode_id: EPISODE_ID,
    source_goal_id: GOAL_ID,
    source_goal_version: GOAL_VERSION,
    source_user_scope_id: USER_ID,
    source_tenant_id: TENANT_ID,
    source_plan_id: PLAN_ID,
    source_plan_version: PLAN_VERSION,
  });

  return Object.freeze({
    taskRow: sourceRow({
      task_id: TASK_ID,
      context_id: CONTEXT_ID,
      user_id: USER_ID,
      goal_id: GOAL_ID,
      goal_version: GOAL_VERSION,
      user_goal_plan_id: PLAN_ID,
      evidence_plan_id: PLAN_ID,
      evidence_plan_version: PLAN_VERSION,
    }),
    episodeRow: sourceRow({
      episode_id: EPISODE_ID,
      task_id: TASK_ID,
      context_id: CONTEXT_ID,
      goal_id: GOAL_ID,
      goal_version: GOAL_VERSION,
      episode_type: 'terminal',
      revision: 2,
      terminal_outcome_ref: 'outcome-a',
      source_hash: hash('e'),
      episode_hash: hash('f'),
      completeness: 1,
      status: 'complete',
      data_classification: 'user_scoped',
      redaction_codes: [],
      snapshot: { missingFactCodes: [], terminalStatus: 'succeeded' },
      source_refs: [
        {
          schemaVersion: '1.0',
          sourceRefId: 'source-task-a',
          sourceKind: 'task_request',
          sourceId: TASK_ID,
          sourceRevision: 1,
          authority: 'runtime_fact',
          dataClassification: 'user_scoped',
          contentHash: hash('0'),
          capturedAt: AT,
        },
      ],
      created_at: AT,
      tenant_id: TENANT_ID,
      user_scope_id: USER_ID,
    }),
    traceRow: sourceRow({
      trace_id: trace.traceId,
      source_episode_id: trace.sourceEpisodeId,
      task_id: TASK_ID,
      task_type_refs: evidenceJson(trace.taskTypeRefs),
      goal_fingerprint: trace.goalFingerprint,
      capability_fingerprint: trace.capabilityFingerprint,
      environment_fingerprint: trace.environmentFingerprint,
      trace: evidenceJson(trace.trace),
      completeness: trace.completeness,
      data_classification: trace.dataClassification,
      redaction_codes: [],
      normalizer_version: trace.normalizerVersion,
      source_hash: trace.sourceHash,
      tenant_id: TENANT_ID,
      user_scope_id: USER_ID,
      compilation_run_refs: [NORMALIZATION_RUN_ID],
      created_at: trace.createdAt,
    }),
    patternRow: sourceRow({
      pattern_id: PATTERN_ID,
      pattern_type: 'workflow_pattern',
      cohort_fingerprint: discoveredPattern.cohortFingerprint,
      definition: patternDefinition,
      definition_content_hash: definitionHash,
      definition_uncompressed_bytes: patternDefinitionArtifact.artifactRef.byteSize,
      support_refs: [TRACE_ID],
      contradiction_refs: [],
      confidence: 0.95,
      status: 'candidate',
      tenant_ids: [TENANT_ID],
      compilation_run_refs: [PROCESS_MINING_RUN_ID],
      created_at: AT,
    }),
    correctionRow: sourceRow({
      correction_id: 'correction-a',
      task_id: TASK_ID,
      scope: 'task',
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      correction_type: 'wrong_decomposition',
      target_scope: 'skill_goal_plan',
      accepted: true,
      structured_patch: { operation: 'replace', path: '/nodes/inspect-area' },
      source_refs: [
        {
          schemaVersion: '1.0',
          sourceRefId: 'source-plan-a',
          sourceKind: 'plan_revision',
          sourceId: PLAN_ID,
          sourceRevision: PLAN_VERSION,
          authority: 'runtime_fact',
          dataClassification: 'internal',
          capturedAt: AT,
        },
        {
          schemaVersion: '1.0',
          sourceRefId: 'source-episode-a',
          sourceKind: 'goal_experience_episode',
          sourceId: EPISODE_ID,
          sourceRevision: 2,
          authority: 'runtime_fact',
          dataClassification: 'user_scoped',
          capturedAt: AT,
        },
      ],
      counterexample_refs: [COUNTEREXAMPLE_ID],
      correction_hash: hash('1'),
      goal_id: GOAL_ID,
      goal_version: GOAL_VERSION,
      created_at: AT,
    }),
    interactionRow: sourceRow({
      episode_id: 'interaction-a',
      task_id: TASK_ID,
      revision: 1,
      episode_hash: hash('2'),
      completeness: 1,
      induction_fingerprint: hash('3'),
      goal_id: GOAL_ID,
      goal_version: GOAL_VERSION,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      outcome_ref: 'outcome-a',
      correction_ids: ['correction-a'],
      counterexample_refs: [COUNTEREXAMPLE_ID],
      source_refs: [
        {
          schemaVersion: '1.0',
          sourceRefId: 'interaction-task-source-a',
          sourceKind: 'task_request',
          sourceId: TASK_ID,
          sourceRevision: 1,
          authority: 'runtime_fact',
          dataClassification: 'user_scoped',
          capturedAt: AT,
        },
        {
          schemaVersion: '1.0',
          sourceRefId: 'interaction-episode-source-a',
          sourceKind: 'goal_experience_episode',
          sourceId: EPISODE_ID,
          sourceRevision: 2,
          authority: 'runtime_fact',
          dataClassification: 'user_scoped',
          capturedAt: AT,
        },
      ],
      created_at: AT,
    }),
    replayCaseRow: sourceRow({
      replay_case_id: replayCase.replayCaseId,
      tenant_id: replayCase.tenantId,
      task_type_id: replayCase.taskTypeId,
      primary_source_episode_id: EPISODE_ID,
      content: replayCaseContent,
      content_hash: replayCase.contentHash,
      snapshot_completeness: replayCase.snapshotCompleteness,
      dataset_refs: [{ datasetId: DATASET_ID, datasetVersion: DATASET_VERSION }],
      source_task_id: TASK_ID,
      source_context_id: CONTEXT_ID,
      source_goal_id: GOAL_ID,
      source_goal_version: GOAL_VERSION,
      source_user_scope_id: USER_ID,
      created_at: AT,
    }),
    datasetRow: sourceRow({
      dataset_id: dataset.datasetId,
      dataset_version: dataset.datasetVersion,
      purpose: dataset.purpose,
      tenant_id: dataset.tenantId,
      content: datasetContent,
      source_hash: dataset.sourceHash,
      content_hash: dataset.contentHash,
      leakage_check_ref: dataset.leakageCheckRef,
      promotion_eligible: true,
      invalidated_at: null,
      invalidation_reason: null,
      case_refs: evidenceJson(dataset.caseRefs),
      created_at: dataset.createdAt,
    }),
    artifactRow: sourceRow({
      artifact_id: compiledArtifact.artifactId,
      artifact_key: compiledArtifact.artifactKey,
      version: compiledArtifact.version,
      artifact_type: compiledArtifact.artifactType,
      tenant_id: TENANT_ID,
      domain: compiledArtifact.scope.domain,
      status: compiledArtifact.status,
      risk_level: compiledArtifact.riskLevel,
      definition: {
        schemaVersion: '1.0',
        artifact: evidenceJson(compiledArtifact),
        lineage: evidenceJson(artifactLineage),
      },
      workflow_pattern_refs: [WORKFLOW_PATTERN_ID],
      content_hash: compiledArtifact.contentHash,
      lineage: {
        lineage_id: artifactLineage.lineageId,
        artifact_id: ARTIFACT_ID,
        artifact_version: ARTIFACT_VERSION,
        source_episode_refs: [EPISODE_ID],
        source_knowledge_refs: [],
        source_correction_refs: ['correction-a'],
        source_pattern_refs: [WORKFLOW_PATTERN_ID],
        generation_methods: ['process_mining'],
        compiler_version: 'compiler.1.2',
        created_at: AT,
      },
      created_at: AT,
    }),
    validationRow,
    caseResultRow: sourceRow({
      validation_run_id: VALIDATION_ID,
      replay_case_id: REPLAY_CASE_ID,
      result_hash: hash('4'),
      evaluation: { passed: true, outcomeStatus: 'succeeded' },
      metrics: { goal_satisfaction: 0.98, privateReasoning: 'must-not-export' },
      created_at: '2026-08-04T07:01:00.000Z',
      source_task_id: TASK_ID,
      source_context_id: CONTEXT_ID,
      source_episode_id: EPISODE_ID,
      source_goal_id: GOAL_ID,
      source_goal_version: GOAL_VERSION,
      source_user_scope_id: USER_ID,
      source_tenant_id: TENANT_ID,
      source_plan_id: PLAN_ID,
      source_plan_version: PLAN_VERSION,
    }),
    counterexampleRow,
    retrievalRow: sourceRow({
      match_id: MATCH_ID,
      request_id: 'retrieval-request-a',
      task_id: TASK_ID,
      candidate_artifact_id: ARTIFACT_ID,
      artifact_version: ARTIFACT_VERSION,
      artifact_tenant_id: TENANT_ID,
      decision: 'template_adapt',
      policy_snapshot_hash: hash('5'),
      reason_codes: ['exact-task-type', 'policy-allowed'],
      applicability: {
        artifactRef: `${ARTIFACT_ID}:v${String(ARTIFACT_VERSION)}`,
        applicable: true,
        confidence: 0.98,
        satisfiedConditionIds: ['condition-a'],
        missingConditionIds: [],
        violatedConditionIds: [],
        uncertainConditionIds: [],
        outOfDistribution: false,
        disposition: 'requires_adaptation',
        reasonCodes: ['condition-satisfied'],
      },
      score: {
        intentScore: 0.98,
        structuredConditionScore: 0.98,
        parameterCoverageScore: 1,
        capabilityShapeScore: 1,
        environmentSimilarityScore: 1,
        validationConfidenceScore: 0.95,
        recentReliabilityScore: 0.9,
        riskPenalty: 0,
        totalScore: 0.97,
      },
      created_at: AT,
    }),
    usageRow: sourceRow({
      artifact_execution_id: USAGE_ID,
      artifact_id: ARTIFACT_ID,
      artifact_version: ARTIFACT_VERSION,
      artifact_tenant_id: TENANT_ID,
      task_id: TASK_ID,
      goal_id: GOAL_ID,
      goal_version: GOAL_VERSION,
      mode: 'template',
      status: 'completed',
      generated_plan_id: PLAN_ID,
      retrieval_decision_id: 'retrieval-decision-a',
      retrieval_match_id: MATCH_ID,
      retrieval_selected_artifact_ref: `${ARTIFACT_ID}:v${String(ARTIFACT_VERSION)}`,
      retrieval_request_id: 'retrieval-request-a',
      retrieval_task_id: TASK_ID,
      retrieval_artifact_id: ARTIFACT_ID,
      retrieval_artifact_version: ARTIFACT_VERSION,
      started_at: AT,
      completed_at: '2026-08-04T07:02:00.000Z',
    }),
    feedbackRow: sourceRow({
      feedback_id: FEEDBACK_ID,
      artifact_execution_id: USAGE_ID,
      artifact_id: ARTIFACT_ID,
      artifact_version: ARTIFACT_VERSION,
      artifact_tenant_id: TENANT_ID,
      task_id: TASK_ID,
      feedback_type: 'successful_use',
      reason_code: 'goal_verified',
      summary: 'The generated plan satisfied the frozen completion contract.',
      impact: { positive: true, score: 0.98 },
      outcome_ref: 'outcome-a',
      created_at: '2026-08-04T07:03:00.000Z',
    }),
    promotionRow: sourceRow({
      promotion_package_id: PROMOTION_ID,
      artifact_id: ARTIFACT_ID,
      artifact_version: ARTIFACT_VERSION,
      artifact_tenant_id: TENANT_ID,
      artifact_ref: compiledArtifactRef.artifactRef.uri,
      artifact_hash: compiledArtifact.contentHash,
      eligibility: 'eligible_for_review',
      promotion_policy_version: 'promotion-policy-v2',
      validation_summary_ref: VALIDATION_ID,
      validation_summary_hash: validationResult.resultHash,
      shadow_summary_ref: 'shadow-summary-a',
      shadow_summary_hash: hash('6'),
      counterexample_summary_ref: COUNTEREXAMPLE_ID,
      counterexample_summary_hash: counterexampleSummaryHash,
      risk_review_ref: 'risk-review-a',
      risk_review_hash: hash('8'),
      dependency_snapshot_ref: 'dependency-snapshot-a',
      dependency_snapshot_hash: hash('9'),
      validation_counterexamples: validationCounterexamples,
      assessment: { evidence_hash: hash('a'), coverage: { complete: true } },
      content_hash: hash('b'),
      created_at: '2026-08-04T07:04:00.000Z',
    }),
    replayCaseArtifact,
    datasetArtifact,
    compiledArtifactRef,
    replayCase,
    dataset,
    replaySafety: validationResult.replaySafety,
  });
}

function largePatternFixtures(count: number) {
  const fixtures = authorityFixtures();
  const traceIds = Object.freeze(
    Array.from({ length: count }, (_, index) => `trace-large-${String(index).padStart(5, '0')}`),
  );
  const definition = jsonObject(fixtures.patternRow['definition']);
  const variantValues = jsonArray(definition['variants']);
  const firstVariant = variantValues[0];
  if (firstVariant === undefined) throw new Error('Fixture Pattern variant is missing.');
  const baseVariant = jsonObject(firstVariant);
  const discovered = jsonObject(definition['discoveredPattern']);
  const workflow = jsonObject(definition['workflowPattern']);
  const quality = Object.freeze({
    ...jsonObject(workflow['quality']),
    supportCount: count,
    totalTraceCount: count,
    supportRate: 1,
    successRate: 1,
    traceCoverage: 1,
    contradictionRate: 0,
  });
  const largeVariant = Object.freeze({
    ...baseVariant,
    occurrenceCount: count,
    traceRefs: traceIds,
    successCount: count,
    failureCount: 0,
  });
  const activityValues = jsonArray(workflow['activityPatterns']);
  const activityPatterns = activityValues.map((activity) =>
    Object.freeze({ ...jsonObject(activity), supportCount: count, supportRate: 1 }),
  );
  const largeDefinition = sourceRow({
    ...definition,
    variants: [largeVariant],
    discoveredPattern: {
      ...discovered,
      supportRefs: traceIds,
      contradictionRefs: [],
      quality,
    },
    workflowPattern: {
      ...workflow,
      activityPatterns,
      sourceTraceRefs: traceIds,
      quality,
    },
  });
  const artifact = buildRuntimeSourceArtifact({
    sourceTable: 'pattern_candidate',
    sourceRecordId: PATTERN_ID,
    sourceVersion: 1,
    value: largeDefinition,
  });
  const patternRow = sourceRow({
    ...fixtures.patternRow,
    definition: largeDefinition,
    definition_content_hash: artifact.artifactRef.sha256,
    definition_uncompressed_bytes: artifact.artifactRef.byteSize,
    support_refs: traceIds,
    contradiction_refs: [],
  });
  const existingEvidence = Object.freeze(
    traceIds.map((traceId, index) =>
      sourceRow({
        record_id: `evidence-trace-large-${String(index).padStart(5, '0')}`,
        record_type: 'experience.trace',
        source_record_id: traceId,
        payload: { traceId },
      }),
    ),
  );
  return Object.freeze({
    fixtures: Object.freeze({ ...fixtures, patternRow }),
    traceIds,
    definition: largeDefinition,
    artifact,
    existingEvidence,
  });
}

function planTemplateDefinition(): PlanTemplateArtifactDefinition {
  const definition: PlanTemplateArtifactDefinition = {
    goalPattern: {
      objectiveTemplate: 'Inspect {{areaId}}.',
      criterionTemplates: [
        {
          criterionTemplateId: 'criterion.area-observed',
          statementTemplate: 'Structured area state was observed and verified.',
          required: true,
        },
      ],
    },
    parameterSchema: {
      type: 'object',
      required: ['areaId'],
      properties: { areaId: { type: 'string' } },
    },
    parameterBindings: [
      {
        parameterName: 'areaId',
        schema: { type: 'string' },
        required: true,
        allowedSources: 'user_confirmed',
        trustLevel: 'authoritative',
        defaultPolicy: 'none',
      },
    ],
    skillGoalGraph: {
      nodes: [
        {
          nodeKey: 'inspect-area',
          nodeType: 'observation',
          objectiveTemplate: 'Inspect {{areaId}} without physical side effects.',
          requiredCapabilities: ['capability.inspect-area'],
          requiredEffectRefs: ['effect.area-observed'],
          coveredCriterionTemplateIds: ['criterion.area-observed'],
          evidenceRequirements: ['evidence.structured-area-state'],
          artifactRequirements: [],
          inputTemplate: { areaId: '{{areaId}}' },
          assumptionsAllowed: [],
          constraints: ['No physical side effects.'],
        },
      ],
      dependencies: [],
    },
    completionContractTemplate: {
      titleTemplate: 'Inspection complete',
      descriptionTemplate: 'The requested area was inspected and verified.',
      criteria: [
        {
          criterionTemplateId: 'criterion.area-observed',
          statementTemplate: 'Structured area state was observed and verified.',
          required: true,
        },
      ],
      evidenceRequirements: ['evidence.structured-area-state'],
      artifactRequirements: [],
    },
    recoveryBranches: [],
  };
  return Object.freeze(definition);
}

function snapshotFor(
  sourcePartition: ExperienceReplayArtifactProjectionPartition,
  fixtures: AuthorityFixtures,
): ExperienceReplayArtifactEvidenceSnapshot | undefined {
  const base = emptySnapshot(sourcePartition);
  switch (sourcePartition.kind) {
    case 'experience_task':
      return Object.freeze({
        ...base,
        task: fixtures.taskRow,
        episodes: [fixtures.episodeRow],
        traces: [fixtures.traceRow],
        corrections: [fixtures.correctionRow],
        interactions: [fixtures.interactionRow],
      });
    case 'experience_pattern':
      return Object.freeze({ ...base, patterns: [fixtures.patternRow] });
    case 'replay_case':
      return Object.freeze({
        ...base,
        task: fixtures.taskRow,
        replayCases: [fixtures.replayCaseRow],
      });
    case 'artifact':
      return Object.freeze({ ...base, artifacts: [fixtures.artifactRow] });
    case 'replay_dataset':
      return Object.freeze({ ...base, datasets: [fixtures.datasetRow] });
    case 'validation':
      return Object.freeze({
        ...base,
        validationRuns: [fixtures.validationRow],
        caseResults: [fixtures.caseResultRow],
        counterexamples: [fixtures.counterexampleRow],
      });
    case 'retrieval':
      return Object.freeze({
        ...base,
        task: fixtures.taskRow,
        retrievals: [fixtures.retrievalRow],
      });
    case 'usage':
      return Object.freeze({ ...base, task: fixtures.taskRow, usages: [fixtures.usageRow] });
    case 'feedback':
      return Object.freeze({ ...base, task: fixtures.taskRow, feedback: [fixtures.feedbackRow] });
    case 'promotion':
      return Object.freeze({
        ...base,
        validationRuns: [fixtures.validationRow],
        counterexamples: [fixtures.counterexampleRow],
        promotions: [fixtures.promotionRow],
      });
  }
}

function emptySnapshot(
  sourcePartition: ExperienceReplayArtifactProjectionPartition,
): ExperienceReplayArtifactEvidenceSnapshot {
  return Object.freeze({
    partition: sourcePartition,
    episodes: [],
    traces: [],
    patterns: [],
    corrections: [],
    interactions: [],
    replayCases: [],
    datasets: [],
    artifacts: [],
    validationRuns: [],
    caseResults: [],
    counterexamples: [],
    retrievals: [],
    usages: [],
    feedback: [],
    promotions: [],
    existingEvidence: [],
  });
}

function partition(
  kind: ExperienceReplayArtifactProjectionPartition['kind'],
  sourceFamily: ExperienceReplayArtifactProjectionPartition['sourceFamily'],
  sourceId: string,
  sourceVersion?: number,
): ExperienceReplayArtifactProjectionPartition {
  return Object.freeze({
    kind,
    sourceFamily,
    sourcePartition: `v141:${kind}:${String(sourceId.length)}:${sourceId}${
      sourceVersion === undefined ? '' : `:v${String(sourceVersion)}`
    }`,
    sourceId,
    ...(sourceVersion === undefined ? {} : { sourceVersion }),
  });
}

function record(
  writer: MemoryWriter,
  recordType: RecordType,
  sourceRecordId?: string,
): CanonicalEvidenceEnvelope {
  const result = writer.records.find(
    (item) =>
      item.recordType === recordType &&
      (sourceRecordId === undefined || item.sourceRecordId === sourceRecordId),
  );
  if (result === undefined)
    throw new Error(
      `Missing fixture record ${recordType}${sourceRecordId === undefined ? '' : `:${sourceRecordId}`}.`,
    );
  return result;
}

function records(writer: MemoryWriter, recordType: RecordType) {
  return writer.records.filter((item) => item.recordType === recordType);
}

function payloadRecord(
  envelope: CanonicalEvidenceEnvelope,
): Readonly<Record<string, EvidenceJsonValue>> {
  const payload = envelope.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error(`Fixture payload ${envelope.recordType} is not an object.`);
  return payload as Readonly<Record<string, EvidenceJsonValue>>;
}

function expectRefs(envelope: CanonicalEvidenceEnvelope, expected: readonly string[]) {
  expect(envelope.evidenceRefs).toEqual([...new Set(expected)].sort());
}

function catalog(recordType: RecordType) {
  const result = EVIDENCE_RECORD_CATALOG.find((entry) => entry.recordType === recordType);
  if (result === undefined) throw new Error(`Missing Evidence catalog ${recordType}.`);
  return result;
}

function sourceRow(value: Readonly<Record<string, unknown>>): ExperienceReplayArtifactSourceRow {
  return Object.freeze(value) as ExperienceReplayArtifactSourceRow;
}

function evidenceJson(value: unknown): EvidenceJsonValue {
  return value as EvidenceJsonValue;
}

function jsonObject(
  value: EvidenceJsonValue | undefined,
): Readonly<Record<string, EvidenceJsonValue>> {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Fixture JSON object is invalid.');
  }
  return value as Readonly<Record<string, EvidenceJsonValue>>;
}

function jsonArray(value: EvidenceJsonValue | undefined): readonly EvidenceJsonValue[] {
  if (!Array.isArray(value)) throw new Error('Fixture JSON array is invalid.');
  return value as readonly EvidenceJsonValue[];
}

function text(row: ExperienceReplayArtifactSourceRow, field: string) {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`Fixture ${field} is missing.`);
  return value;
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}

function hashCanonicalBytes(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}
