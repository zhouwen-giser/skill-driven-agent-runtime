import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_RECORD_CATALOG,
  createCanonicalEvidenceEnvelope,
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
      ) as Readonly<Record<string, EvidenceJsonValue>>;
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
        evidenceRefs: [],
        artifactRefs: [],
        payload,
      });
      const validate = ajv.getSchema(schema.$id);
      expect(validate?.(envelope), JSON.stringify(validate?.errors)).toBe(true);
    }
  });

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
      deliveryGuarantee: 'transactional',
      evaluationRole: 'required',
      payload: { goalId: 'goal-1', goalVersion: 1, status: 'active' },
    });
    expect(validate({ ...envelope, unknown: true })).toBe(false);
  });

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
      deliveryGuarantee: 'transactional',
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
        createdAt: '2026-08-04T00:00:00Z',
        sealedAt: '2026-08-04T00:00:01Z',
      }),
    ).toBe(true);
  });
});

function sampleValue(schema: Record<string, unknown> | undefined): EvidenceJsonValue {
  if (schema?.['$ref'] !== undefined) return 'value';
  if (schema?.['pattern'] === '^sha256:[0-9a-f]{64}$') return `sha256:${'a'.repeat(64)}`;
  if (schema?.['type'] === 'integer') return Number(schema['minimum'] ?? 1);
  if (schema?.['type'] === 'array') return ['ref-1'];
  if (schema?.['format'] === 'date-time') return '2026-08-04T00:00:00.000Z';
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

function schemaId(schemas: ReadonlyMap<string, LoadedSchema>, name: string): string {
  const schema = schemas.get(name);
  if (schema === undefined) throw new Error(`Missing common schema ${name}.`);
  return schema.$id;
}
