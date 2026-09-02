import { describe, expect, it } from 'vitest';

import {
  EPISODE_EVIDENCE_POLICY,
  EVIDENCE_EXPECTATION_STAGES,
  EVIDENCE_MAX_CANONICAL_BYTES,
  EVIDENCE_QUALITY_RULE_IDS,
  EVIDENCE_RECORD_CATALOG,
  EvidenceContractError,
  assertEvidencePayloadIdentity,
  canonicalizeEvidenceJson,
  createCatalogEvidenceEnvelope,
  createCanonicalEvidenceEnvelope,
  createEvidenceRecordId,
  evidenceObservationGeneration,
  getEvidenceCatalogEntry,
  getEvidenceRecordSchema,
  hashCanonicalEvidenceJson,
  isEvidenceRecordId,
  isEvidenceSha256,
  normalizeEvidenceExportConfiguration,
  shouldRecordEvidenceExportObservation,
} from '../src/index.js';

const identity = {
  sourceSystem: 'runtime' as const,
  sourceTable: 'goal',
  sourceRecordId: 'goal-1:1',
  sourceRevision: '1:sha256:source',
  schemaName: 'sdar.evidence.runtime.goal',
  schemaVersion: 1,
};

function envelope(payload: Readonly<Record<string, string>> = { goalId: 'goal-1' }) {
  return createCanonicalEvidenceEnvelope({
    ...identity,
    recordFamily: 'runtime',
    recordType: 'runtime.goal',
    environment: 'test',
    correlationId: 'correlation-1',
    occurredAt: '2026-08-04T00:00:00.000Z',
    recordedAt: '2026-08-04T00:00:01.000Z',
    deliveryGuarantee: 'transactional',
    evaluationRole: 'required',
    evidenceRefs: ['runtime.episode:evidence_1'],
    artifactRefs: [],
    payload,
  });
}

describe('canonical evidence Domain', () => {
  it('freezes exactly 105 typed catalog entries with real schema hashes', () => {
    expect(EVIDENCE_RECORD_CATALOG).toHaveLength(105);
    expect(new Set(EVIDENCE_RECORD_CATALOG.map((entry) => entry.recordType)).size).toBe(105);
    expect(EVIDENCE_RECORD_CATALOG.every((entry) => isEvidenceSha256(entry.schemaHash))).toBe(true);
    expect(EVIDENCE_RECORD_CATALOG.every((entry) => entry.requiredPayloadFields.length >= 2)).toBe(
      true,
    );
    expect(
      EVIDENCE_RECORD_CATALOG.every((entry) => entry.deliveryGuarantee === 'durable_projection'),
    ).toBe(true);
    expect(getEvidenceCatalogEntry('runtime.goal').sourceTable).toBe('goal');
    expect(getEvidenceCatalogEntry('artifact.usage')).toMatchObject({
      sourceTable: 'artifact_execution',
      deliveryGuarantee: 'durable_projection',
    });
    expect(getEvidenceCatalogEntry('artifact.feedback')).toMatchObject({
      sourceTable: 'artifact_feedback',
      deliveryGuarantee: 'durable_projection',
    });
    expect(() => getEvidenceCatalogEntry('unknown.record')).toThrow('EVIDENCE_RECORD_TYPE_UNKNOWN');
  });

  it('freezes the Phase 10 episode policy and five explicit Evidence infrastructure contracts', () => {
    expect(EPISODE_EVIDENCE_POLICY).toMatchObject({
      policyVersion: 'episode-evidence-policy/v1',
      catalogRecordCount: 105,
      requiredRecordCount: 100,
      diagnosticRecordCount: 5,
      durableProjectionRecordCount: 105,
    });
    expect(EPISODE_EVIDENCE_POLICY.records).toHaveLength(105);
    expect(EVIDENCE_EXPECTATION_STAGES).toEqual([
      'source_fact_missing',
      'source_fact_unprojected',
      'projected_pending_export',
      'exported_unacknowledged',
      'acknowledged',
      'projection_failed',
      'schema_invalid',
      'payload_conflict',
    ]);
    expect(EVIDENCE_QUALITY_RULE_IDS).toEqual([
      'sequence_gap',
      'payload_conflict',
      'orphan_reference',
      'version_gap',
      'missing_verification',
      'remote_task_unclosed',
      'skill_tree_incomplete',
      'experience_missing_fact',
      'node_revision_regression',
      'export_ack_gap',
    ]);
    expect(getEvidenceCatalogEntry('runtime.run_seal').expectedReferences).toEqual([
      'runtime.outcome',
    ]);
    expect(getEvidenceCatalogEntry('evidence.episode_manifest').expectedReferences).toEqual([
      'runtime.run_seal',
    ]);

    const infrastructure = EVIDENCE_RECORD_CATALOG.filter(
      (entry) => entry.recordFamily === 'evidence',
    );
    expect(infrastructure).toHaveLength(5);
    for (const entry of infrastructure) {
      const schema = getEvidenceRecordSchema(entry.recordType) as Readonly<{
        properties: Readonly<{
          payload: Readonly<{
            required: readonly string[];
            properties: Readonly<Record<string, unknown>>;
          }>;
        }>;
      }>;
      expect(schema.properties.payload.required).toEqual(entry.requiredPayloadFields);
      expect(Object.keys(schema.properties.payload.properties).sort()).toEqual(
        [...entry.requiredPayloadFields].sort(),
      );
    }
    expect(getEvidenceCatalogEntry('evidence.export_status').sourceTable).toBe(
      'evidence_export_batch + evidence_export_ack[generation0-derived]',
    );
  });

  it('freezes reconstructible Phase 8 Experience payloads and source-owned references', () => {
    expect(getEvidenceCatalogEntry('experience.trace').requiredPayloadFields).toEqual(
      expect.arrayContaining([
        'taskTypeRefs',
        'goalFingerprint',
        'capabilityFingerprint',
        'environmentFingerprint',
        'traceBody',
      ]),
    );
    expect(getEvidenceCatalogEntry('experience.trace_event').requiredPayloadFields).toEqual(
      expect.arrayContaining([
        'sequence',
        'actorType',
        'activityRecordId',
        'capabilityRefs',
        'authorityRefs',
        'parentEventRefs',
        'concurrencyGroup',
        'branchRef',
        'payloadSummary',
      ]),
    );
    expect(getEvidenceCatalogEntry('experience.activity').requiredPayloadFields).toEqual(
      expect.arrayContaining([
        'activityKind',
        'objectiveSummary',
        'sourcePlanNodeRef',
        'sourceSkillGoalRef',
        'sourceAttemptRef',
        'operationRef',
        'capabilityRefs',
        'effectRefs',
      ]),
    );
    expect(getEvidenceCatalogEntry('experience.process_variant').requiredPayloadFields).toEqual(
      expect.arrayContaining([
        'activitySequence',
        'activityKindSequence',
        'concurrencyGroups',
        'branchSequence',
        'traceRefs',
        'successCount',
        'failureCount',
      ]),
    );
    expect(getEvidenceCatalogEntry('experience.workflow_pattern').requiredPayloadFields).toEqual(
      expect.arrayContaining([
        'taskTypeId',
        'activityPatterns',
        'sourcePatternRef',
        'sourceTraceRefs',
        'quality',
      ]),
    );
    expect(
      getEvidenceCatalogEntry('experience.workflow_pattern_dependency').requiredPayloadFields,
    ).toEqual(expect.arrayContaining(['condition', 'supportRefs', 'contradictionRefs']));
    expect(getEvidenceCatalogEntry('experience.recovery_pattern').requiredPayloadFields).toEqual(
      expect.arrayContaining([
        'resumeActivityKey',
        'activitySequence',
        'requiredCapabilityRefs',
        'supportRefs',
      ]),
    );
  });

  it('freezes acyclic Replay and exact Artifact lineage references', () => {
    expect(getEvidenceCatalogEntry('replay.case').expectedReferences).toEqual([
      'experience.episode',
    ]);
    expect(getEvidenceCatalogEntry('replay.dataset').expectedReferences).toEqual(['replay.case']);
    expect(getEvidenceCatalogEntry('artifact.validation').expectedReferences).toEqual([
      'artifact.lifecycle',
    ]);
    expect(getEvidenceCatalogEntry('artifact.usage').expectedReferences).toEqual([
      'artifact.lifecycle',
      'artifact.retrieval',
      'runtime.episode',
    ]);
    expect(getEvidenceCatalogEntry('artifact.promotion').expectedReferences).toEqual([
      'artifact.lifecycle',
      'artifact.validation',
      'replay.counterexample',
    ]);
    for (const recordType of [
      'experience.process_variant',
      'experience.workflow_pattern',
      'experience.workflow_pattern_dependency',
      'experience.recovery_pattern',
      'replay.case',
      'replay.dataset',
      'artifact.lifecycle',
    ]) {
      expect(getEvidenceCatalogEntry(recordType).artifactPolicy).toBe('artifact_ref_required');
    }
    expect(getEvidenceCatalogEntry('replay.run').requiredPayloadFields).toEqual(
      expect.arrayContaining([
        'artifactVersion',
        'datasetVersion',
        'sourceSnapshotHash',
        'replaySafety',
        'noPhysicalSideEffects',
      ]),
    );
    expect(getEvidenceCatalogEntry('artifact.lifecycle').requiredPayloadFields).toEqual(
      expect.arrayContaining(['version', 'policyRefs', 'authorityRef', 'artifactRef', 'lineage']),
    );
    expect(getEvidenceCatalogEntry('artifact.usage').requiredPayloadFields).toEqual(
      expect.arrayContaining(['artifactVersion', 'retrievalDecisionId', 'retrievalMatchId']),
    );
    expect(getEvidenceCatalogEntry('artifact.promotion').requiredPayloadFields).toEqual(
      expect.arrayContaining([
        'artifactVersion',
        'promotionPolicyVersion',
        'validationSummaryRef',
        'validationSummaryHash',
        'counterexampleRefs',
      ]),
    );
  });

  it('keeps repeated Process Variant activity order and narrows only explicit nullable fields', () => {
    const variantPayload = payloadProperties('experience.process_variant');
    const activitySequence = variantPayload['activitySequence'] as Readonly<{
      oneOf: readonly unknown[];
    }>;
    expect(activitySequence.oneOf[0]).toEqual({
      type: 'array',
      minItems: 1,
      maxItems: 256,
      items: { type: 'string', minLength: 1, maxLength: 4096 },
    });
    expect(activitySequence.oneOf[0]).not.toHaveProperty('uniqueItems');
    expect(activitySequence.oneOf[1]).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['artifactRefUri', 'jsonPointer', 'count', 'sha256'],
    });
    expect(variantPayload['activityKindSequence']).toHaveProperty('oneOf');
    expect(variantPayload['concurrencyGroups']).toHaveProperty('oneOf');

    expect(payloadProperties('artifact.lifecycle')['tenantId']).toEqual({
      oneOf: [{ type: 'string', minLength: 1, maxLength: 4096 }, { type: 'null' }],
    });
    expect(payloadProperties('replay.run')['validatorVersion']).toEqual({
      oneOf: [{ type: 'string', minLength: 1, maxLength: 4096 }, { type: 'null' }],
    });
    expect(payloadProperties('artifact.promotion')['promotionPolicyVersion']).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 4096,
    });
    expect(variantPayload['patternDefinitionArtifactRef']).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['artifactId', 'version', 'uri', 'sha256', 'mediaType', 'byteSize'],
    });
    expect(payloadProperties('experience.workflow_pattern')['processVariantSet']).toMatchObject({
      properties: { jsonPointer: { const: '/variants' } },
    });
  });

  it('derives Phase 8 enum and positive-version schemas from closed Domain authorities', () => {
    expect(payloadProperties('experience.activity')['activityKind']).toMatchObject({
      type: 'string',
      enum: expect.arrayContaining(['skill_goal', 'plan_node', 'provider_operation', 'unknown']),
    });
    expect(payloadProperties('experience.trace_event')['eventType']).toMatchObject({
      enum: expect.arrayContaining(['goal_created', 'business_event_observed', 'goal_failed']),
    });
    expect(payloadProperties('experience.episode')['goalVersion']).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 2_147_483_647,
    });
    expect(payloadProperties('experience.interaction_episode')['goalVersion']).toEqual({
      oneOf: [{ type: 'integer', minimum: 1, maximum: 2_147_483_647 }, { type: 'null' }],
    });
    expect(payloadProperties('replay.dataset')['purpose']).toMatchObject({
      enum: ['discovery', 'candidate_development', 'promotion_holdout', 'counterexample'],
    });
    expect(payloadProperties('artifact.lifecycle')['artifactType']).toMatchObject({
      enum: ['intent_route', 'plan_template', 'decision_rule', 'case_template', 'model_route'],
    });
    expect(payloadProperties('artifact.retrieval')['decision']).toMatchObject({
      enum: [
        'compiled_fast',
        'template_adapt',
        'case_adapt',
        'small_model',
        'cognitive_runtime',
        'human_input',
        'denied',
      ],
    });
    expect(payloadProperties('artifact.retrieval')['applicability']).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining(['disposition', 'applicable', 'confidence']),
    });
    expect(payloadProperties('replay.run')['replaySafety']).toMatchObject({
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: expect.arrayContaining([
            'provider',
            'physicalAdapterInvocationCount',
            'physicalOutcomeClaim',
          ]),
        },
        { type: 'null' },
      ],
    });
  });

  it('freezes all 21 Phase 9 Node Control payloads to explicit authority schemas', () => {
    const records = EVIDENCE_RECORD_CATALOG.filter(
      ({ recordFamily }) => recordFamily === 'node_control',
    );
    expect(records).toHaveLength(21);
    for (const entry of records) {
      const schema = getEvidenceRecordSchema(entry.recordType) as Readonly<{
        properties: Readonly<{
          payload: Readonly<{
            required: readonly string[];
            properties: Readonly<Record<string, unknown>>;
          }>;
        }>;
      }>;
      expect(schema.properties.payload.required).toEqual(entry.requiredPayloadFields);
      expect(Object.keys(schema.properties.payload.properties).sort()).toEqual(
        [...entry.requiredPayloadFields].sort(),
      );
    }

    expect(getEvidenceCatalogEntry('node_control.health_observation').sourceTable).toBe(
      'sdar_control.node_health_observation',
    );
    expect(getEvidenceCatalogEntry('node_control.capability_readiness').sourceTable).toContain(
      'event_type=node.capability.readiness_changed',
    );
    expect(getEvidenceCatalogEntry('node_control.plan_template_governance').sourceTable).toContain(
      'action prefix=plan-template.',
    );
    expect(getEvidenceCatalogEntry('node_control.telemetry_delivery').sourceTable).toBe(
      'evidence_export_batch',
    );
    expect(getEvidenceCatalogEntry('node_control.telemetry_ack').sourceTable).toBe(
      'evidence_export_ack',
    );
    for (const recordType of [
      'node_control.profile_revision',
      'node_control.configuration_revision',
      'node_control.llm_provider_revision',
      'node_control.model_route_revision',
      'node_control.mcp_provider_binding_revision',
      'node_control.agent_card_revision',
      'node_control.management_operation',
      'node_control.audit_event',
      'node_control.node_event',
      'node_control.telemetry_configuration',
    ]) {
      expect(getEvidenceCatalogEntry(recordType).expectedReferences).toEqual([]);
    }
  });

  it('closes Node Control authority vocabularies and decimal sequence contracts', () => {
    expect(payloadProperties('node_control.profile_revision')['status']).toMatchObject({
      enum: ['draft', 'active', 'maintenance', 'retired'],
    });
    expect(payloadProperties('node_control.capability_readiness')['readinessStatus']).toMatchObject(
      {
        enum: ['available', 'degraded', 'unavailable', 'suspended'],
      },
    );
    expect(payloadProperties('node_control.health_observation')['observationRevision']).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(payloadProperties('node_control.node_event')['eventType']).toMatchObject({
      enum: expect.arrayContaining([
        'node.health.changed',
        'node.capability.readiness_changed',
        'node.telemetry_export.status_changed',
      ]),
    });
    expect(payloadProperties('node_control.node_event')['sequence']).toEqual({
      type: 'string',
      pattern: '^(?:0|[1-9][0-9]{0,18})$',
    });
    expect(payloadProperties('node_control.telemetry_delivery')['deliveryStatus']).toEqual({
      const: 'attempted',
    });
    expect(payloadProperties('node_control.telemetry_ack')['ackDisposition']).toMatchObject({
      enum: ['accepted', 'partial', 'rejected'],
    });
  });

  it('bounds export self-observation at generation one', () => {
    expect(evidenceObservationGeneration({})).toBe(0);
    expect(evidenceObservationGeneration({ observationGeneration: 1 })).toBe(1);
    expect(shouldRecordEvidenceExportObservation([{}, { observationGeneration: 1 }])).toBe(true);
    expect(
      shouldRecordEvidenceExportObservation([
        { observationGeneration: 1 },
        { observationGeneration: 1 },
      ]),
    ).toBe(false);

    expect(() =>
      createCanonicalEvidenceEnvelope({
        ...identity,
        recordFamily: 'runtime',
        recordType: 'runtime.goal',
        environment: 'test',
        correlationId: 'correlation-1',
        occurredAt: '2026-08-04T00:00:00.000Z',
        recordedAt: '2026-08-04T00:00:01.000Z',
        deliveryGuarantee: 'durable_projection',
        evaluationRole: 'required',
        observationGeneration: 2 as never,
        payload: { goalId: 'goal-1' },
      }),
    ).toThrow(expect.objectContaining({ code: 'EVIDENCE_IDENTITY_INVALID' }));

    const telemetrySchema = getEvidenceRecordSchema('node_control.telemetry_delivery');
    expect(telemetrySchema).toMatchObject({
      properties: { observationGeneration: { type: 'integer', enum: [0, 1] } },
      allOf: [
        {
          required: ['observationGeneration'],
          properties: { observationGeneration: { const: 1 } },
        },
      ],
    });
  });

  it('fails closed when a ref-required Phase 8 payload omits its ArtifactRef URI', () => {
    const entry = getEvidenceCatalogEntry('replay.case');
    const payload = Object.fromEntries(
      entry.requiredPayloadFields.map((field) => [field, null]),
    ) as Readonly<Record<string, null>>;
    const input = {
      recordType: 'replay.case',
      sourceRecordId: 'replay-case-1',
      sourceRevision: 'revision-1',
      environment: 'test',
      correlationId: 'correlation-1',
      occurredAt: '2026-08-04T00:00:00.000Z',
      recordedAt: '2026-08-04T00:00:01.000Z',
      payload,
    } as const;
    expect(() => createCatalogEvidenceEnvelope(input)).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_REFERENCE_INVALID', field: 'artifactRefs' }),
    );
    expect(() =>
      createCatalogEvidenceEnvelope({
        ...input,
        artifactRefs: ['artifact://runtime/v1/artifact_replay_case/replay-case-1/1/content'],
      }),
    ).not.toThrow();
  });

  it('canonicalizes object keys and hashes deterministically', () => {
    const first = { z: [3, 2, 1], a: { y: true, x: 'value' } };
    const second = { a: { x: 'value', y: true }, z: [3, 2, 1] };
    expect(canonicalizeEvidenceJson(first)).toBe(canonicalizeEvidenceJson(second));
    expect(hashCanonicalEvidenceJson(first)).toBe(hashCanonicalEvidenceJson(second));
    expect(hashCanonicalEvidenceJson(first)).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('derives stable record identity only from source and schema identity', () => {
    const first = createEvidenceRecordId(identity);
    const second = createEvidenceRecordId({ ...identity });
    expect(first).toBe(second);
    expect(isEvidenceRecordId(first)).toBe(true);
    expect(createEvidenceRecordId({ ...identity, sourceRevision: '2:sha256:source' })).not.toBe(
      first,
    );
  });

  it('builds a frozen envelope and detects same-ID payload conflicts', () => {
    const first = envelope({ goalId: 'goal-1', status: 'active' });
    const replay = envelope({ status: 'active', goalId: 'goal-1' });
    const conflict = envelope({ goalId: 'goal-1', status: 'achieved' });
    expect(first).toEqual(replay);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      assertEvidencePayloadIdentity(first, replay);
    }).not.toThrow();
    expect(() => {
      assertEvidencePayloadIdentity(first, conflict);
    }).toThrow(expect.objectContaining({ code: 'EVIDENCE_PAYLOAD_CONFLICT' }));
  });

  it.each([
    [{ credentialValue: 'inline-value' }, 'EVIDENCE_FORBIDDEN_FIELD'],
    [{ access_token: 'inline-value' }, 'EVIDENCE_FORBIDDEN_FIELD'],
    [{ Authorization: 'Bearer value' }, 'EVIDENCE_FORBIDDEN_FIELD'],
    [{ chainOfThought: 'private' }, 'EVIDENCE_FORBIDDEN_FIELD'],
    [{ private_reasoning: 'private' }, 'EVIDENCE_FORBIDDEN_FIELD'],
    [{ score: Number.NaN }, 'EVIDENCE_JSON_VALUE_INVALID'],
    [{ score: Number.POSITIVE_INFINITY }, 'EVIDENCE_JSON_VALUE_INVALID'],
  ])('rejects unsafe payload %#', (payload, code) => {
    expect(() => canonicalizeEvidenceJson(payload)).toThrow(expect.objectContaining({ code }));
  });

  it('permits opaque credential references while rejecting inline credential material', () => {
    expect(() =>
      canonicalizeEvidenceJson({ credentialRef: 'secret://evidence-sink' }),
    ).not.toThrow();
    expect(() =>
      canonicalizeEvidenceJson({ sinkSecretRef: 'secret://evidence-sink' }),
    ).not.toThrow();
    expect(() => canonicalizeEvidenceJson({ secretStatus: 'available' })).not.toThrow();
    expect(() =>
      canonicalizeEvidenceJson({
        secretStatus: {
          type: 'string',
          enum: ['unknown', 'available', 'unavailable', 'invalid'],
        },
      }),
    ).not.toThrow();
    expect(() => canonicalizeEvidenceJson({ secretStatus: 'inline-secret' })).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_FORBIDDEN_FIELD' }),
    );
  });

  it('rejects cycles, excessive depth, excessive bytes and duplicate references', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => canonicalizeEvidenceJson(cyclic)).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_JSON_CYCLE' }),
    );

    let deep: unknown = 'leaf';
    for (let index = 0; index < 34; index += 1) deep = { child: deep };
    expect(() => canonicalizeEvidenceJson(deep)).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_JSON_DEPTH_EXCEEDED' }),
    );
    expect(() => canonicalizeEvidenceJson('x'.repeat(EVIDENCE_MAX_CANONICAL_BYTES + 1))).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_JSON_SIZE_EXCEEDED' }),
    );
    expect(() =>
      createCanonicalEvidenceEnvelope({
        ...identity,
        recordFamily: 'runtime',
        recordType: 'runtime.goal',
        environment: 'test',
        correlationId: 'correlation-1',
        occurredAt: '2026-08-04T00:00:00Z',
        recordedAt: '2026-08-04T00:00:01Z',
        deliveryGuarantee: 'transactional',
        evaluationRole: 'required',
        evidenceRefs: ['same', 'same'],
        payload: { goalId: 'goal-1' },
      }),
    ).toThrow(expect.objectContaining({ code: 'EVIDENCE_REFERENCE_INVALID' }));
  });

  it('requires an explicit source revision and UTC RFC 3339 timestamps', () => {
    expect(() => createEvidenceRecordId({ ...identity, sourceRevision: '' })).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_IDENTITY_INVALID' }),
    );
    expect(() =>
      createCanonicalEvidenceEnvelope({
        ...identity,
        recordFamily: 'runtime',
        recordType: 'runtime.goal',
        environment: 'test',
        correlationId: 'correlation-1',
        occurredAt: '2026-08-04T08:00:00+08:00',
        recordedAt: '2026-08-04T00:00:01Z',
        deliveryGuarantee: 'transactional',
        evaluationRole: 'required',
        payload: { goalId: 'goal-1' },
      }),
    ).toThrow(expect.objectContaining({ code: 'EVIDENCE_TIMESTAMP_INVALID' }));
  });

  it('uses a typed contract error', () => {
    try {
      canonicalizeEvidenceJson({ secret: 'no' });
      expect.unreachable('unsafe evidence should fail');
    } catch (error) {
      expect(error).toBeInstanceOf(EvidenceContractError);
    }
  });

  it('normalizes a closed Evidence export configuration and rejects required-family exclusion', () => {
    const configuration = {
      exportId: 'primary-evidence-export',
      revision: 1,
      endpointRef: 'https://evidence.example.test/v1/batches',
      sourceId: 'sdar-runtime',
      nodeId: 'node-001',
      credentialRef: 'secret:evidence-sink',
      includedFamilies: [
        'runtime',
        'skill',
        'mcp_task',
        'capability',
        'experience',
        'replay',
        'artifact',
        'node_control',
        'evidence',
      ],
      excludedDiagnosticTypes: ['node_control.health_observation'],
      batchPolicy: { maxRecords: 100, maxBytes: 262_144, flushIntervalMs: 1_000 },
      retryPolicy: { baseDelayMs: 100, maxDelayMs: 10_000, maxAttempts: 10 },
      outboxPolicy: { maxPendingRecords: 10_000, retentionDays: 30 },
      redactionProfile: 'strict_internal_v1',
      artifactMode: 'reference',
      status: 'draft',
      applyMode: 'hot_reload',
    } as const;
    expect(normalizeEvidenceExportConfiguration(configuration).includedFamilies).toHaveLength(9);
    expect(() =>
      normalizeEvidenceExportConfiguration({
        ...configuration,
        includedFamilies: configuration.includedFamilies.filter((family) => family !== 'runtime'),
      }),
    ).toThrow(/cannot exclude required Evidence families/u);
    expect(() =>
      normalizeEvidenceExportConfiguration({
        ...configuration,
        excludedDiagnosticTypes: ['runtime.goal'],
      }),
    ).toThrow(/only catalog Diagnostic/u);
  });
});

function payloadProperties(recordType: string): Readonly<Record<string, unknown>> {
  const schema = getEvidenceRecordSchema(recordType);
  const properties = schema['properties'] as Readonly<Record<string, unknown>>;
  const payload = properties['payload'] as Readonly<Record<string, unknown>>;
  return payload['properties'] as Readonly<Record<string, unknown>>;
}
