import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_RECORD_CATALOG,
  createCanonicalEvidenceEnvelope,
  getEvidenceRecordSchema,
  type EvidenceJsonValue,
} from '../../domain/src/index.js';

const schemaRoot = path.resolve('schemas/evidence/v1');
type LoadedSchema = Record<string, unknown> & Readonly<{ $id: string }>;

describe('sdar.evidence/v1 JSON Schema registry', () => {
  it('compiles and validates a concrete envelope for all 100 record types', async () => {
    const ajv = createAjv(true);
    const schemas = await Promise.all(
      EVIDENCE_RECORD_CATALOG.map((entry) =>
        readSchema(path.join(schemaRoot, 'records', `${entry.recordType}.schema.json`)),
      ),
    );
    for (const schema of schemas) ajv.addSchema(schema);

    for (const entry of EVIDENCE_RECORD_CATALOG) {
      const schema = schemas.find((candidate) =>
        candidate.$id.endsWith(`${entry.recordType}.schema.json`),
      );
      if (schema === undefined) throw new Error(`Missing schema ${entry.recordType}.`);
      const properties = schema['properties'] as Record<string, unknown>;
      const payloadSchema = properties['payload'] as Record<string, unknown>;
      const payloadProperties = payloadSchema['properties'] as Record<
        string,
        Record<string, unknown>
      >;
      const payload = Object.fromEntries(
        entry.requiredPayloadFields.map((field) => [field, sampleValue(payloadProperties[field])]),
      ) as Record<string, EvidenceJsonValue>;
      normalizePhase8Sample(entry.recordType, payload);
      const envelope = createCanonicalEvidenceEnvelope({
        sourceSystem: entry.sourceSystem,
        sourceTable: entry.sourceTable,
        sourceRecordId: `${entry.recordType}:source-1`,
        sourceRevision: 'revision-1',
        schemaName: entry.schemaName,
        schemaVersion: entry.schemaVersion,
        recordFamily: entry.recordFamily,
        recordType: entry.recordType,
        environment: 'contract-test',
        correlationId: 'correlation-1',
        occurredAt: '2026-08-04T00:00:00.000Z',
        recordedAt: '2026-08-04T00:00:01.000Z',
        deliveryGuarantee: entry.deliveryGuarantee,
        evaluationRole: entry.evaluationRole,
        ...(entry.recordType === 'node_control.telemetry_delivery' ||
        entry.recordType === 'node_control.telemetry_ack'
          ? { observationGeneration: 1 as const }
          : {}),
        evidenceRefs: [],
        artifactRefs:
          entry.artifactPolicy === 'artifact_ref_required'
            ? ['artifact://runtime/v1/contract-test/source-1/1/value']
            : [],
        payload,
      });
      const validate = ajv.getSchema(schema.$id);
      expect(validate?.(envelope), JSON.stringify(validate?.errors)).toBe(true);
    }
  }, 30_000);

  it('rejects placeholder payloads and unknown envelope fields', async () => {
    const schema = await readSchema(path.join(schemaRoot, 'records', 'runtime.goal.schema.json'));
    const ajv = createAjv(false);
    const validate = ajv.compile(schema);
    expect(validate({})).toBe(false);
    const entry = EVIDENCE_RECORD_CATALOG.find(({ recordType }) => recordType === 'runtime.goal');
    expect(entry).toBeDefined();
    const envelope = createCanonicalEvidenceEnvelope({
      sourceSystem: 'runtime',
      sourceTable: 'goal',
      sourceRecordId: 'goal-1:1',
      sourceRevision: '1',
      schemaName: 'sdar.evidence.runtime.goal',
      schemaVersion: 1,
      recordFamily: 'runtime',
      recordType: 'runtime.goal',
      environment: 'test',
      correlationId: 'correlation-1',
      occurredAt: '2026-08-04T00:00:00Z',
      recordedAt: '2026-08-04T00:00:01Z',
      deliveryGuarantee: 'durable_projection',
      evaluationRole: 'required',
      payload: { goalId: 'goal-1', goalVersion: 1, status: 'active' },
    });
    expect(validate({ ...envelope, unknown: true })).toBe(false);
  });

  it('fails closed for unknown Phase 8 authority enum values', async () => {
    const cases = [
      ['experience.activity', 'activityKind'],
      ['experience.episode', 'episodeType'],
      ['experience.episode', 'status'],
      ['experience.episode', 'dataClassification'],
      ['experience.planning_correction', 'correctionType'],
      ['experience.planning_correction', 'scope'],
      ['experience.planning_correction', 'target'],
      ['experience.trace_event', 'eventType'],
      ['experience.trace_event', 'actorType'],
      ['experience.workflow_pattern', 'patternType'],
      ['experience.workflow_pattern', 'status'],
      ['experience.workflow_pattern_dependency', 'dependencyType'],
      ['replay.counterexample', 'status'],
      ['replay.dataset', 'purpose'],
      ['replay.run', 'status'],
      ['replay.run', 'replaySafetyStatus'],
      ['artifact.lifecycle', 'artifactType'],
      ['artifact.lifecycle', 'status'],
      ['artifact.lifecycle', 'riskLevel'],
      ['artifact.promotion', 'eligibility'],
      ['artifact.retrieval', 'decision'],
      ['artifact.usage', 'status'],
      ['artifact.validation', 'validationType'],
      ['artifact.validation', 'status'],
    ] as const;

    for (const [recordType, field] of cases) {
      const schema = await readSchema(
        path.join(schemaRoot, 'records', `${recordType}.schema.json`),
      );
      const validate = createAjv(true).compile(schema);
      const envelope = sampleEnvelope(schema, recordType);
      const invalid = {
        ...envelope,
        payload: { ...envelope.payload, [field]: 'future_unknown_authority_value' },
      };
      expect(validate(invalid), `${recordType}.${field}: ${JSON.stringify(validate.errors)}`).toBe(
        false,
      );
    }

    const nestedCases: readonly [
      recordType: string,
      mutate: (payload: Record<string, EvidenceJsonValue>) => void,
    ][] = [
      [
        'experience.process_variant',
        (payload) => {
          payload['activityKindSequence'] = ['future_unknown_authority_value'];
        },
      ],
      [
        'experience.workflow_pattern',
        (payload) => {
          const activities = payload['activityPatterns'] as readonly Readonly<
            Record<string, EvidenceJsonValue>
          >[];
          payload['activityPatterns'] = [
            { ...(activities[0] ?? {}), activityKind: 'future_unknown_authority_value' },
          ];
        },
      ],
      [
        'artifact.retrieval',
        (payload) => {
          const applicability = payload['applicability'] as Readonly<
            Record<string, EvidenceJsonValue>
          >;
          payload['applicability'] = {
            ...applicability,
            disposition: 'future_unknown_authority_value',
          };
        },
      ],
      [
        'replay.run',
        (payload) => {
          const safety = payload['replaySafety'] as Readonly<Record<string, EvidenceJsonValue>>;
          payload['replaySafety'] = {
            ...safety,
            provider: 'future_unknown_authority_value',
          };
        },
      ],
    ];
    for (const [recordType, mutate] of nestedCases) {
      const schema = await readSchema(
        path.join(schemaRoot, 'records', `${recordType}.schema.json`),
      );
      const validate = createAjv(true).compile(schema);
      const envelope = sampleEnvelope(schema, recordType);
      const payload = { ...envelope.payload } as Record<string, EvidenceJsonValue>;
      mutate(payload);
      expect(
        validate({ ...envelope, payload }),
        `${recordType} nested enum: ${JSON.stringify(validate.errors)}`,
      ).toBe(false);
    }

    const validationSchema = await readSchema(
      path.join(schemaRoot, 'records', 'artifact.validation.schema.json'),
    );
    const validateValidation = createAjv(true).compile(validationSchema);
    const validation = sampleEnvelope(validationSchema, 'artifact.validation');
    expect(
      validateValidation({
        ...validation,
        payload: {
          ...validation.payload,
          validationType: 'replay',
          status: 'passed',
          result: 'future_unknown_authority_value',
        },
      }),
      `artifact.validation replay result: ${JSON.stringify(validateValidation.errors)}`,
    ).toBe(false);
    expect(
      validateValidation({
        ...validation,
        payload: {
          ...validation.payload,
          validationType: 'shadow',
          status: 'passed',
          result: 'ARTIFACT_SHADOW_COMPLETED',
        },
      }),
      `artifact.validation shadow result: ${JSON.stringify(validateValidation.errors)}`,
    ).toBe(true);
  }, 30_000);

  it('fails closed for Phase 9 authority values and export observation recursion', () => {
    const cases = [
      ['node_control.capability_readiness', 'readinessStatus', 'ready'],
      ['node_control.node_event', 'eventType', 'capability.readiness.changed'],
      ['node_control.plan_template_governance', 'action', 'plan_template.published'],
      ['node_control.telemetry_delivery', 'firstSequence', '01'],
    ] as const;

    for (const [recordType, field, value] of cases) {
      const schema = getEvidenceRecordSchema(recordType) as LoadedSchema;
      const validate = createAjv(true).compile(schema);
      const envelope = sampleEnvelope(schema, recordType);
      const invalid = {
        ...envelope,
        payload: { ...envelope.payload, [field]: value },
      };
      expect(validate(invalid), `${recordType}.${field}: ${JSON.stringify(validate.errors)}`).toBe(
        false,
      );
    }

    const deliverySchema = getEvidenceRecordSchema(
      'node_control.telemetry_delivery',
    ) as LoadedSchema;
    const deliveryValidate = createAjv(true).compile(deliverySchema);
    const delivery = sampleEnvelope(deliverySchema, 'node_control.telemetry_delivery');
    const generationZero = { ...delivery };
    Reflect.deleteProperty(generationZero, 'observationGeneration');
    expect(deliveryValidate(generationZero)).toBe(false);
    expect(deliveryValidate({ ...delivery, observationGeneration: 2 })).toBe(false);

    const ackSchema = getEvidenceRecordSchema('node_control.telemetry_ack') as LoadedSchema;
    const ackValidate = createAjv(true).compile(ackSchema);
    const ack = sampleEnvelope(ackSchema, 'node_control.telemetry_ack');
    expect(
      ackValidate({
        ...ack,
        payload: { ...ack.payload, ackDisposition: 'rejected', errorCode: null },
      }),
    ).toBe(false);
    expect(
      ackValidate({
        ...ack,
        payload: {
          ...ack.payload,
          ackDisposition: 'rejected',
          acknowledgedSequence: '1',
          errorCode: 'ACK_RESPONSE_INVALID',
        },
      }),
    ).toBe(false);
    expect(
      ackValidate({
        ...ack,
        payload: {
          ...ack.payload,
          ackDisposition: 'rejected',
          acknowledgedSequence: null,
          errorCode: 'ACK_RESPONSE_INVALID',
        },
      }),
      JSON.stringify(ackValidate.errors),
    ).toBe(true);
  });

  it('validates all five Phase 10 Evidence infrastructure payloads and ACK states', () => {
    const recordTypes = [
      'evidence.episode_manifest',
      'evidence.quality_issue',
      'evidence.projection_issue',
      'evidence.source_checkpoint',
      'evidence.export_status',
    ] as const;
    for (const recordType of recordTypes) {
      const schema = getEvidenceRecordSchema(recordType) as LoadedSchema;
      const validate = createAjv(true).compile(schema);
      const value = sampleEnvelope(schema, recordType);
      expect(validate(value), `${recordType}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }

    const schema = getEvidenceRecordSchema('evidence.export_status') as LoadedSchema;
    const validate = createAjv(true).compile(schema);
    const attempted = sampleEnvelope(schema, 'evidence.export_status');
    expect(
      validate({
        ...attempted,
        payload: {
          ...attempted.payload,
          status: 'acknowledged',
          ackId: 'ack-1',
          acknowledgedSequence: '1',
          ackDisposition: 'accepted',
          errorCode: null,
          acknowledgedAt: '2026-08-10T00:00:01.000Z',
        },
      }),
      JSON.stringify(validate.errors),
    ).toBe(true);
    expect(
      validate({
        ...attempted,
        payload: {
          ...attempted.payload,
          status: 'rejected',
          ackId: 'ack-2',
          acknowledgedSequence: null,
          ackDisposition: 'rejected',
          errorCode: 'ACK_RESPONSE_INVALID',
          acknowledgedAt: '2026-08-10T00:00:02.000Z',
        },
      }),
      JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it('rejects zero for every Phase 8 positive-version payload field', async () => {
    const cases = [
      ['experience.episode', 'goalVersion'],
      ['experience.episode', 'revision'],
      ['experience.interaction_episode', 'revision'],
      ['experience.interaction_episode', 'goalVersion'],
      ['replay.dataset', 'datasetVersion'],
      ['replay.run', 'artifactVersion'],
      ['replay.run', 'datasetVersion'],
      ['replay.counterexample', 'artifactVersion'],
      ['artifact.lifecycle', 'version'],
      ['artifact.validation', 'artifactVersion'],
      ['artifact.validation', 'datasetVersion'],
      ['artifact.retrieval', 'artifactVersion'],
      ['artifact.usage', 'artifactVersion'],
      ['artifact.usage', 'goalVersion'],
      ['artifact.feedback', 'artifactVersion'],
      ['artifact.promotion', 'artifactVersion'],
    ] as const;

    for (const [recordType, field] of cases) {
      const schema = await readSchema(
        path.join(schemaRoot, 'records', `${recordType}.schema.json`),
      );
      const validate = createAjv(true).compile(schema);
      const envelope = sampleEnvelope(schema, recordType);
      const invalid = { ...envelope, payload: { ...envelope.payload, [field]: 0 } };
      expect(validate(invalid), `${recordType}.${field}: ${JSON.stringify(validate.errors)}`).toBe(
        false,
      );
    }

    const schema = await readSchema(
      path.join(schemaRoot, 'records', 'experience.activity.schema.json'),
    );
    const validate = createAjv(true).compile(schema);
    const envelope = sampleEnvelope(schema, 'experience.activity');
    expect(validate({ ...envelope, goalVersion: 0 }), JSON.stringify(validate.errors)).toBe(false);
    expect(validate({ ...envelope, planVersion: 0 }), JSON.stringify(validate.errors)).toBe(false);

    for (const [recordType, field] of [
      ['replay.case', 'artifactRef'],
      ['experience.process_variant', 'patternDefinitionArtifactRef'],
    ] as const) {
      const nestedSchema = await readSchema(
        path.join(schemaRoot, 'records', `${recordType}.schema.json`),
      );
      const nestedValidate = createAjv(true).compile(nestedSchema);
      const nestedEnvelope = sampleEnvelope(nestedSchema, recordType);
      const nestedRef = nestedEnvelope.payload[field] as Readonly<
        Record<string, EvidenceJsonValue>
      >;
      const invalid = {
        ...nestedEnvelope,
        payload: { ...nestedEnvelope.payload, [field]: { ...nestedRef, version: 0 } },
      };
      expect(
        nestedValidate(invalid),
        `${recordType}.${field}.version: ${JSON.stringify(nestedValidate.errors)}`,
      ).toBe(false);
    }
  }, 30_000);

  it('accepts canonical mapper-owned nested shapes and rejects raw DB or stale shapes', async () => {
    const sourceRef = {
      schemaVersion: '1.0',
      sourceRefId: 'source-task-1',
      sourceKind: 'task_request',
      sourceId: 'task-1',
      sourceRevision: 1,
      authority: 'runtime_fact',
      dataClassification: 'user_scoped',
      capturedAt: '2026-08-04T00:00:00.000Z',
      contentHash: `sha256:${'a'.repeat(64)}`,
    } as const;
    const rawDatabaseSourceRef = {
      source_ref_id: 'source-task-1',
      source_kind: 'agent_task',
      source_id: 'task-1',
      source_revision: 1,
      authority: 'runtime-postgresql',
      data_classification: 'user_scoped',
      captured_at: '2026-08-04T00:00:00.000Z',
    } as const;

    for (const recordType of [
      'experience.episode',
      'experience.planning_correction',
      'experience.interaction_episode',
    ]) {
      const schema = await readSchema(
        path.join(schemaRoot, 'records', `${recordType}.schema.json`),
      );
      const validate = createAjv(true).compile(schema);
      const envelope = sampleEnvelope(schema, recordType);
      const legal = { ...envelope, payload: { ...envelope.payload, sourceRefs: [sourceRef] } };
      expect(
        validate(legal),
        `${recordType} legal source ref: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
      expect(
        validate({
          ...envelope,
          payload: { ...envelope.payload, sourceRefs: [rawDatabaseSourceRef] },
        }),
        `${recordType} raw DB source ref: ${JSON.stringify(validate.errors)}`,
      ).toBe(false);
    }

    const correctionSchema = await readSchema(
      path.join(schemaRoot, 'records', 'experience.planning_correction.schema.json'),
    );
    const correctionValidate = createAjv(true).compile(correctionSchema);
    const correction = sampleEnvelope(correctionSchema, 'experience.planning_correction');
    expect(
      correctionValidate({
        ...correction,
        payload: { ...correction.payload, correctionType: 'replace_step' },
      }),
    ).toBe(false);
    expect(
      correctionValidate({
        ...correction,
        payload: { ...correction.payload, target: 'plan-1' },
      }),
    ).toBe(false);

    const retrievalSchema = await readSchema(
      path.join(schemaRoot, 'records', 'artifact.retrieval.schema.json'),
    );
    const retrievalValidate = createAjv(true).compile(retrievalSchema);
    const retrieval = sampleEnvelope(retrievalSchema, 'artifact.retrieval');
    const applicability = {
      artifactRef: 'artifact-1:1',
      applicable: true,
      confidence: 0.98,
      satisfiedConditionIds: ['required:0'],
      missingConditionIds: [],
      violatedConditionIds: [],
      uncertainConditionIds: [],
      outOfDistribution: false,
      disposition: 'eligible',
      reasonCodes: ['REQUIRED_CONDITION_SATISFIED'],
    } as const;
    const score = {
      intentScore: 0.98,
      structuredConditionScore: 0.97,
      parameterCoverageScore: 1,
      capabilityShapeScore: 1,
      environmentSimilarityScore: 0.95,
      validationConfidenceScore: 0.99,
      recentReliabilityScore: 0.96,
      riskPenalty: 0,
      totalScore: 0.97,
    } as const;
    const legalRetrieval = {
      ...retrieval,
      payload: { ...retrieval.payload, decision: 'template_adapt', applicability, score },
    };
    expect(
      retrievalValidate(legalRetrieval),
      `artifact.retrieval legal nested payload: ${JSON.stringify(retrievalValidate.errors)}`,
    ).toBe(true);
    expect(
      retrievalValidate({
        ...legalRetrieval,
        payload: {
          ...legalRetrieval.payload,
          applicability: { applicable: true, conditionScore: 0.98 },
        },
      }),
    ).toBe(false);
    expect(
      retrievalValidate({
        ...legalRetrieval,
        payload: { ...legalRetrieval.payload, score: { total: 0.97 } },
      }),
    ).toBe(false);
  }, 30_000);

  it('preserves authoritative Phase 8 collection bounds and canonical open JSON limits', async () => {
    const activitySchema = await readSchema(
      path.join(schemaRoot, 'records', 'experience.activity.schema.json'),
    );
    const validateActivity = createAjv(true).compile(activitySchema);
    const activity = sampleEnvelope(activitySchema, 'experience.activity');
    expect(
      validateActivity({
        ...activity,
        payload: { ...activity.payload, capabilityRefs: identifiers(64, 'capability') },
      }),
      JSON.stringify(validateActivity.errors),
    ).toBe(true);
    expect(
      validateActivity({
        ...activity,
        payload: { ...activity.payload, capabilityRefs: identifiers(65, 'capability') },
      }),
    ).toBe(false);

    const traceSchema = await readSchema(
      path.join(schemaRoot, 'records', 'experience.trace.schema.json'),
    );
    const validateTrace = createAjv(true).compile(traceSchema);
    const trace = sampleEnvelope(traceSchema, 'experience.trace');
    expect(
      validateTrace({
        ...trace,
        payload: { ...trace.payload, taskTypeRefs: identifiers(257, 'task-type') },
      }),
      JSON.stringify(validateTrace.errors),
    ).toBe(true);
    expect(
      validateTrace({
        ...trace,
        payload: { ...trace.payload, taskTypeRefs: identifiers(4097, 'task-type') },
      }),
    ).toBe(false);
    expect(
      validateTrace({
        ...trace,
        payload: { ...trace.payload, redactionCodes: identifiers(129, 'redaction') },
      }),
    ).toBe(false);

    const eventSchema = await readSchema(
      path.join(schemaRoot, 'records', 'experience.trace_event.schema.json'),
    );
    const validateEvent = createAjv(true).compile(eventSchema);
    const event = sampleEnvelope(eventSchema, 'experience.trace_event');
    for (const payloadSummary of [identifiers(257, 'json-item'), objectValue(129)] as const) {
      expect(
        validateEvent({ ...event, payload: { ...event.payload, payloadSummary } }),
        JSON.stringify(validateEvent.errors),
      ).toBe(true);
    }
    expect(
      validateEvent({
        ...event,
        payload: { ...event.payload, payloadSummary: identifiers(4097, 'json-item') },
      }),
    ).toBe(false);
    expect(
      validateEvent({ ...event, payload: { ...event.payload, payloadSummary: objectValue(1025) } }),
    ).toBe(false);

    const validationSchema = await readSchema(
      path.join(schemaRoot, 'records', 'artifact.validation.schema.json'),
    );
    const validateValidation = createAjv(true).compile(validationSchema);
    const validation = sampleEnvelope(validationSchema, 'artifact.validation');
    expect(
      validateValidation({
        ...validation,
        payload: {
          ...validation.payload,
          metrics: { evaluator: 'shadow-v1', nested: { observations: [true, 'accepted'] } },
        },
      }),
      JSON.stringify(validateValidation.errors),
    ).toBe(true);
  }, 30_000);

  it('fails closed for Phase 8 cross-field state and condition semantics', async () => {
    const dependencySchema = await readSchema(
      path.join(schemaRoot, 'records', 'experience.workflow_pattern_dependency.schema.json'),
    );
    const validateDependency = createAjv(true).compile(dependencySchema);
    const dependency = sampleEnvelope(dependencySchema, 'experience.workflow_pattern_dependency');
    const condition = {
      type: 'atomic',
      field: 'request.intent',
      operator: 'eq',
      value: 'schedule',
    } as const;
    expect(
      validateDependency({
        ...dependency,
        payload: { ...dependency.payload, dependencyType: 'conditional', condition },
      }),
      JSON.stringify(validateDependency.errors),
    ).toBe(true);
    expect(
      validateDependency({
        ...dependency,
        payload: { ...dependency.payload, dependencyType: 'conditional', condition: null },
      }),
    ).toBe(false);
    expect(
      validateDependency({
        ...dependency,
        payload: { ...dependency.payload, dependencyType: 'parallel', condition },
      }),
    ).toBe(false);
    expect(
      validateDependency({
        ...dependency,
        payload: {
          ...dependency.payload,
          dependencyType: 'conditional',
          condition: { ...condition, value: objectValue(129) },
        },
      }),
    ).toBe(false);

    const replaySchema = await readSchema(
      path.join(schemaRoot, 'records', 'replay.run.schema.json'),
    );
    const validateReplay = createAjv(true).compile(replaySchema);
    const replayRun = sampleEnvelope(replaySchema, 'replay.run');
    const replaySafety = {
      provider: 'ReplayNoPhysicalProvider',
      physicalAdapterInvocationCount: 0,
      sideEffectAttemptCount: 0,
      deniedBeforePhysicalBoundaryCount: 0,
      denialEvidenceRefs: [],
      physicalOutcomeClaim: 'none',
    } as const;
    expect(
      validateReplay({
        ...replayRun,
        payload: {
          ...replayRun.payload,
          status: 'passed',
          replaySafetyStatus: 'verified',
          replaySafety,
          noPhysicalSideEffects: true,
          resultHash: `sha256:${'c'.repeat(64)}`,
        },
      }),
      JSON.stringify(validateReplay.errors),
    ).toBe(true);
    expect(
      validateReplay({
        ...replayRun,
        payload: {
          ...replayRun.payload,
          status: 'passed',
          replaySafetyStatus: 'verified',
          replaySafety: null,
          noPhysicalSideEffects: true,
          resultHash: `sha256:${'c'.repeat(64)}`,
        },
      }),
    ).toBe(false);
    expect(
      validateReplay({
        ...replayRun,
        payload: { ...replayRun.payload, replaySafetyStatus: 'verified' },
      }),
    ).toBe(false);

    const datasetSchema = await readSchema(
      path.join(schemaRoot, 'records', 'replay.dataset.schema.json'),
    );
    const validateDataset = createAjv(true).compile(datasetSchema);
    const dataset = sampleEnvelope(datasetSchema, 'replay.dataset');
    expect(
      validateDataset({
        ...dataset,
        payload: { ...dataset.payload, invalidatedAt: null, invalidationReason: 'source_deleted' },
      }),
    ).toBe(false);

    const interactionSchema = await readSchema(
      path.join(schemaRoot, 'records', 'experience.interaction_episode.schema.json'),
    );
    const validateInteraction = createAjv(true).compile(interactionSchema);
    const interaction = sampleEnvelope(interactionSchema, 'experience.interaction_episode');
    expect(
      validateInteraction({
        ...interaction,
        payload: { ...interaction.payload, goalId: null, goalVersion: 1 },
      }),
    ).toBe(false);
  }, 30_000);

  it('binds Pattern descriptors and Runtime ArtifactRefs to their exact authority paths', async () => {
    const variantSchema = await readSchema(
      path.join(schemaRoot, 'records', 'experience.process_variant.schema.json'),
    );
    const validateVariant = createAjv(true).compile(variantSchema);
    const variant = sampleEnvelope(variantSchema, 'experience.process_variant');
    const patternRef = variant.payload['patternDefinitionArtifactRef'] as Readonly<
      Record<string, EvidenceJsonValue>
    >;
    const descriptor = {
      artifactRefUri: patternRef['uri'],
      jsonPointer: '/variants/0/activitySequence',
      count: 1,
      sha256: `sha256:${'b'.repeat(64)}`,
    } as const;
    expect(
      validateVariant({
        ...variant,
        payload: { ...variant.payload, activitySequence: descriptor },
      }),
      JSON.stringify(validateVariant.errors),
    ).toBe(true);
    expect(
      validateVariant({
        ...variant,
        payload: {
          ...variant.payload,
          activitySequence: { ...descriptor, jsonPointer: '/workflowPattern/activityPatterns' },
        },
      }),
    ).toBe(false);
    expect(
      validateVariant({
        ...variant,
        payload: { ...variant.payload, concurrencyGroups: [['repeat', 'repeat']] },
      }),
      JSON.stringify(validateVariant.errors),
    ).toBe(true);
    expect(
      validateVariant({
        ...variant,
        payload: { ...variant.payload, concurrencyGroups: [['single']] },
      }),
    ).toBe(false);
    for (const artifactRef of [
      { ...patternRef, mediaType: 'text/plain' },
      {
        ...patternRef,
        uri: 'artifact://runtime/v1/compiled_artifact/pattern-1/1/definition/artifact/definition',
      },
    ]) {
      expect(
        validateVariant({
          ...variant,
          payload: { ...variant.payload, patternDefinitionArtifactRef: artifactRef },
        }),
      ).toBe(false);
    }
    for (const uri of [
      'artifact://runtime/v1/pattern_candidate/pattern-1/1/definition?query=1',
      'artifact://runtime/v1/pattern_candidate/pattern-1/1/definition#fragment',
      'artifact://runtime/v1/pattern_candidate/pattern%2fescape/1/definition',
      'artifact://runtime/v1/pattern_candidate/pattern%2Fescape/1/definition',
      'artifact://runtime/v1/pattern_candidate/pattern%escape/1/definition',
      'artifact://runtime/v1/pattern_candidate/%41/1/definition',
    ]) {
      expect(
        validateVariant({
          ...variant,
          payload: {
            ...variant.payload,
            patternDefinitionArtifactRef: { ...patternRef, uri },
          },
        }),
        `non-canonical Pattern Artifact URI accepted: ${uri}`,
      ).toBe(false);
    }
    for (const uri of [
      'artifact://runtime/v1/pattern_candidate/pattern%3Aone/1/definition',
      'artifact://runtime/v1/pattern_candidate/pattern%20one/1/definition',
      'artifact://runtime/v1/pattern_candidate/%E4%B8%AD%E6%96%87/1/definition',
    ]) {
      expect(
        validateVariant({
          ...variant,
          payload: {
            ...variant.payload,
            patternDefinitionArtifactRef: { ...patternRef, uri },
          },
        }),
        `canonical encoded Pattern Artifact URI rejected: ${uri}: ${JSON.stringify(validateVariant.errors)}`,
      ).toBe(true);
    }

    for (const recordType of ['replay.case', 'replay.dataset', 'artifact.lifecycle'] as const) {
      const schema = await readSchema(
        path.join(schemaRoot, 'records', `${recordType}.schema.json`),
      );
      const validate = createAjv(true).compile(schema);
      const envelope = sampleEnvelope(schema, recordType);
      const artifactRef = envelope.payload['artifactRef'] as Readonly<
        Record<string, EvidenceJsonValue>
      >;
      expect(
        validate({
          ...envelope,
          payload: {
            ...envelope.payload,
            artifactRef: { ...artifactRef, mediaType: 'text/plain' },
          },
        }),
        `${recordType}: ${JSON.stringify(validate.errors)}`,
      ).toBe(false);
    }
  }, 30_000);

  it('compiles Batch, ACK, Manifest, Issue and ArtifactRef protocol schemas', async () => {
    const ajv = createAjv(true);
    for (const entry of EVIDENCE_RECORD_CATALOG) {
      ajv.addSchema(
        await readSchema(path.join(schemaRoot, 'records', `${entry.recordType}.schema.json`)),
      );
    }
    const commonNames = [
      'artifact-ref',
      'batch-request',
      'batch-acknowledgement',
      'canonical-evidence-envelope',
      'episode-evidence-manifest',
      'quality-issue',
      'projection-issue',
    ];
    const common = new Map<string, LoadedSchema>();
    for (const name of commonNames) {
      const schema = await readSchema(path.join(schemaRoot, `${name}.schema.json`));
      common.set(name, schema);
      ajv.addSchema(schema);
    }
    const goal = createCanonicalEvidenceEnvelope({
      sourceSystem: 'runtime',
      sourceTable: 'goal',
      sourceRecordId: 'goal-1:1',
      sourceRevision: '1',
      schemaName: 'sdar.evidence.runtime.goal',
      schemaVersion: 1,
      recordFamily: 'runtime',
      recordType: 'runtime.goal',
      environment: 'test',
      correlationId: 'correlation-1',
      occurredAt: '2026-08-04T00:00:00Z',
      recordedAt: '2026-08-04T00:00:01Z',
      deliveryGuarantee: 'durable_projection',
      evaluationRole: 'required',
      payload: { goalId: 'goal-1', goalVersion: 1, status: 'active' },
    });
    expect(ajv.getSchema(schemaId(common, 'canonical-evidence-envelope'))?.(goal)).toBe(true);
    expect(
      ajv.getSchema(schemaId(common, 'batch-request'))?.({
        contractVersion: 'sdar.evidence/v1',
        exportId: 'primary',
        sourceId: 'runtime-1',
        nodeId: 'node-1',
        revision: 1,
        firstSequence: '1',
        lastSequence: '1',
        batchHash: `sha256:${'b'.repeat(64)}`,
        records: [goal],
      }),
    ).toBe(true);
    const ack = ajv.getSchema(schemaId(common, 'batch-acknowledgement'));
    expect(ack?.({ lastAcknowledgedSequence: '1' })).toBe(true);
    expect(ack?.({ lastAcknowledgedSequence: -1 })).toBe(false);
    expect(
      ajv.getSchema(schemaId(common, 'artifact-ref'))?.({
        artifactId: 'artifact-1',
        version: 1,
        uri: 'artifact://artifact-1/1',
        sha256: `sha256:${'a'.repeat(64)}`,
        mediaType: 'application/json',
        byteSize: 42,
      }),
    ).toBe(true);
    expect(
      ajv.getSchema(schemaId(common, 'episode-evidence-manifest'))?.({
        manifestId: 'manifest-1',
        revision: 1,
        policyVersion: 'episode-evidence-policy/v1',
        episodeId: 'episode-1',
        taskId: 'task-1',
        terminalOutcomeId: 'outcome-1',
        expectedRequiredRecords: 1,
        projectedRequiredRecords: 1,
        pendingRequiredRecords: 0,
        failedRequiredRecords: 0,
        expectedFamilies: ['runtime'],
        completedFamilies: ['runtime'],
        missingFamilies: [],
        sourceCoverage: { runtime: { expected: 1, projected: 1, pending: 0, failed: 0 } },
        lastEvidenceSequence: '1',
        status: 'complete',
        qualityIssueIds: [],
        sourceSnapshotHash: `sha256:${'a'.repeat(64)}`,
        createdAt: '2026-08-04T00:00:00Z',
        recomputedAt: '2026-08-04T00:00:01Z',
        sealedAt: '2026-08-04T00:00:01Z',
      }),
    ).toBe(true);
  }, 30_000);
});

function sampleValue(schema: Record<string, unknown> | undefined): EvidenceJsonValue {
  if (schema?.['const'] !== undefined) return schema['const'] as EvidenceJsonValue;
  if (Array.isArray(schema?.['enum'])) return schema['enum'][0] as EvidenceJsonValue;
  if (Array.isArray(schema?.['oneOf'])) {
    return sampleValue(schema['oneOf'][0] as Record<string, unknown> | undefined);
  }
  if (schema?.['$ref'] !== undefined) return 'value';
  if (schema?.['format'] === 'date-time') return '2026-08-04T00:00:00.000Z';
  if (schema?.['pattern'] === '^sha256:[0-9a-f]{64}$') return `sha256:${'a'.repeat(64)}`;
  if (schema?.['pattern'] === '^(?:0|[1-9][0-9]{0,18})$') return '1';
  if (
    typeof schema?.['pattern'] === 'string' &&
    schema['pattern'].includes('/pattern_candidate/')
  ) {
    return 'artifact://runtime/v1/pattern_candidate/pattern-1/1/definition';
  }
  if (schema?.['pattern'] === '^/(?:[^~/]|~[01])*(?:/(?:[^~/]|~[01])*)*$') return '/value';
  if (
    typeof schema?.['pattern'] === 'string' &&
    schema['pattern'].includes('/artifact_replay_case/')
  ) {
    return 'artifact://runtime/v1/artifact_replay_case/replay-case-1/1/content';
  }
  if (
    typeof schema?.['pattern'] === 'string' &&
    schema['pattern'].includes('/replay_dataset_manifest/')
  ) {
    return 'artifact://runtime/v1/replay_dataset_manifest/dataset-1/1/content';
  }
  if (
    typeof schema?.['pattern'] === 'string' &&
    schema['pattern'].includes('/compiled_artifact/')
  ) {
    return 'artifact://runtime/v1/compiled_artifact/artifact-1/1/definition/artifact/definition';
  }
  if (schema?.['type'] === 'integer') return Number(schema['minimum'] ?? 1);
  if (schema?.['type'] === 'number') return Number(schema['minimum'] ?? 1);
  if (schema?.['type'] === 'boolean') return true;
  if (schema?.['type'] === 'array') {
    const item = sampleValue(schema['items'] as Record<string, unknown> | undefined);
    const length = Math.max(1, Number(schema['minItems'] ?? 1));
    return Array.from({ length }, () => item);
  }
  if (schema?.['type'] === 'object') {
    const properties = schema['properties'] as Record<string, Record<string, unknown>> | undefined;
    const required = Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];
    return Object.fromEntries(required.map((field) => [field, sampleValue(properties?.[field])]));
  }
  if (schema?.['type'] === 'string') return 'value';
  return 'value';
}

function createAjv(allErrors: boolean): Ajv2020 {
  const ajv = new Ajv2020({ allErrors, strict: true, formats: { 'date-time': true } });
  for (const keyword of [
    'x-sdar-compatibility',
    'x-sdar-maximum-inline-bytes',
    'x-sdar-redaction-policy',
    'x-sdar-artifact-policy',
  ]) {
    ajv.addKeyword({ keyword });
  }
  return ajv;
}

async function readSchema(file: string): Promise<LoadedSchema> {
  const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>)['$id'] !== 'string'
  ) {
    throw new Error(`Invalid JSON Schema ${file}.`);
  }
  return parsed as LoadedSchema;
}

function sampleEnvelope(schema: LoadedSchema, recordType: string) {
  const entry = EVIDENCE_RECORD_CATALOG.find((candidate) => candidate.recordType === recordType);
  if (entry === undefined) throw new Error(`Missing catalog entry ${recordType}.`);
  const properties = schema['properties'] as Record<string, unknown>;
  const payloadSchema = properties['payload'] as Record<string, unknown>;
  const payloadProperties = payloadSchema['properties'] as Record<string, Record<string, unknown>>;
  const payload = Object.fromEntries(
    entry.requiredPayloadFields.map((field) => [field, sampleValue(payloadProperties[field])]),
  ) as Record<string, EvidenceJsonValue>;
  normalizePhase8Sample(recordType, payload);
  return createCanonicalEvidenceEnvelope({
    sourceSystem: entry.sourceSystem,
    sourceTable: entry.sourceTable,
    sourceRecordId: `${entry.recordType}:source-1`,
    sourceRevision: 'revision-1',
    schemaName: entry.schemaName,
    schemaVersion: entry.schemaVersion,
    recordFamily: entry.recordFamily,
    recordType: entry.recordType,
    environment: 'contract-test',
    correlationId: 'correlation-1',
    occurredAt: '2026-08-04T00:00:00.000Z',
    recordedAt: '2026-08-04T00:00:01.000Z',
    deliveryGuarantee: entry.deliveryGuarantee,
    evaluationRole: entry.evaluationRole,
    ...(recordType === 'node_control.telemetry_delivery' ||
    recordType === 'node_control.telemetry_ack'
      ? { observationGeneration: 1 as const }
      : {}),
    evidenceRefs: [],
    artifactRefs:
      entry.artifactPolicy === 'artifact_ref_required'
        ? ['artifact://runtime/v1/contract-test/source-1/1/value']
        : [],
    payload,
  });
}

function normalizePhase8Sample(
  recordType: string,
  payload: Record<string, EvidenceJsonValue>,
): void {
  if (recordType === 'experience.workflow_pattern_dependency') payload['condition'] = null;
  if (recordType === 'replay.run') {
    payload['replaySafetyStatus'] = 'pending';
    payload['replaySafety'] = null;
    payload['noPhysicalSideEffects'] = null;
    payload['resultHash'] = null;
  }
  if (recordType === 'artifact.validation') payload['result'] = null;
  normalizePhase9Sample(recordType, payload);
}

function normalizePhase9Sample(
  recordType: string,
  payload: Record<string, EvidenceJsonValue>,
): void {
  if (recordType === 'node_control.skill_governance') payload['action'] = 'skill.published';
  if (recordType === 'node_control.plan_template_governance') {
    payload['action'] = 'plan-template.published';
  }
  if (
    recordType === 'node_control.configuration_revision' ||
    recordType === 'node_control.telemetry_configuration'
  ) {
    payload['publishedAt'] = null;
  }
  if (recordType === 'node_control.configuration_apply_ack') payload['acknowledgedAt'] = null;
  if (recordType === 'node_control.mcp_provider_binding_revision') {
    payload['smppSourceId'] = null;
    payload['externalProviderId'] = null;
    payload['externalServerId'] = null;
    payload['registryRevision'] = null;
    payload['registryChecksum'] = null;
  }
  if (recordType === 'node_control.management_operation') {
    payload['startedAt'] = null;
    payload['completedAt'] = null;
    payload['errorCode'] = null;
  }
  if (recordType === 'node_control.telemetry_ack') payload['errorCode'] = null;
  if (recordType === 'evidence.quality_issue' || recordType === 'evidence.projection_issue') {
    payload['resolvedAt'] = null;
  }
  if (recordType === 'evidence.episode_manifest') payload['sealedAt'] = null;
  if (recordType === 'evidence.export_status') {
    payload['status'] = 'attempted';
    payload['ackId'] = null;
    payload['acknowledgedSequence'] = null;
    payload['ackDisposition'] = null;
    payload['errorCode'] = null;
    payload['acknowledgedAt'] = null;
  }
}

function schemaId(schemas: ReadonlyMap<string, LoadedSchema>, name: string): string {
  const schema = schemas.get(name);
  if (schema === undefined) throw new Error(`Missing common schema ${name}.`);
  return schema.$id;
}

function identifiers(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index)}`);
}

function objectValue(count: number): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `field${String(index)}`,
      `value-${String(index)}`,
    ]),
  );
}
