import { EVIDENCE_CONTRACT_VERSION, EVIDENCE_RECORD_FAMILIES } from './canonical-evidence.js';
import type { EvidenceRecordCatalogEntry } from './catalog.js';

export type EvidenceJsonSchema = Readonly<Record<string, unknown>>;

const text = (maxLength = 4096): EvidenceJsonSchema => ({
  type: 'string',
  minLength: 1,
  maxLength,
});
const hash: EvidenceJsonSchema = { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' };
const nonNegativeInteger: EvidenceJsonSchema = { type: 'integer', minimum: 0 };
const positiveInteger: EvidenceJsonSchema = { type: 'integer', minimum: 1 };

function payloadProperty(field: string): EvidenceJsonSchema {
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
      artifactRefs: { type: 'array', maxItems: 256, uniqueItems: true, items: text() },
      payloadHash: hash,
      payload: {
        type: 'object',
        minProperties: entry.requiredPayloadFields.length,
        maxProperties: 128,
        required: entry.requiredPayloadFields,
        properties: Object.fromEntries(
          entry.requiredPayloadFields.map((field) => [field, payloadProperty(field)]),
        ),
        additionalProperties: { $ref: '#/$defs/evidenceValue' },
      },
      goalVersion: positiveInteger,
      planVersion: positiveInteger,
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
            maxItems: 256,
            items: { $ref: '#/$defs/evidenceValue' },
          },
          {
            type: 'object',
            maxProperties: 128,
            additionalProperties: { $ref: '#/$defs/evidenceValue' },
          },
        ],
      },
    },
    'x-sdar-compatibility': entry.compatibility,
    'x-sdar-maximum-inline-bytes': entry.maximumInlineBytes,
    'x-sdar-redaction-policy': entry.redactionPolicy,
    'x-sdar-artifact-policy': entry.artifactPolicy,
  };
}
