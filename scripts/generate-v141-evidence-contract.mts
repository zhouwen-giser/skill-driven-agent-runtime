import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stdout } from 'node:process';
import { format } from 'prettier';

import {
  EVIDENCE_CONTRACT_VERSION,
  EVIDENCE_ISSUE_CODES,
  EVIDENCE_RECORD_CATALOG,
  EVIDENCE_RECORD_FAMILIES,
  getEvidenceRecordSchema,
  hashCanonicalEvidenceJson,
} from '../packages/domain/src/evidence/index.js';

const schemaRoot = path.resolve('schemas/evidence/v1');
const recordRoot = path.join(schemaRoot, 'records');
const protocolRoot = path.resolve('protocol/evidence/v1');
const json = (value: unknown): Promise<string> =>
  format(JSON.stringify(value), { parser: 'json', endOfLine: 'lf', printWidth: 100 });
const schemaId = (name: string): string =>
  `https://schemas.sdar.local/evidence/v1/${name}.schema.json`;

if (EVIDENCE_RECORD_CATALOG.length !== 100) {
  throw new Error(`EVIDENCE_CATALOG_COUNT_INVALID:${String(EVIDENCE_RECORD_CATALOG.length)}`);
}
const catalogEvaluationRoles = Object.fromEntries(
  ['required', 'diagnostic'].map((role) => [
    role,
    EVIDENCE_RECORD_CATALOG.filter((entry) => entry.evaluationRole === role).length,
  ]),
);
const catalogDeliveryGuarantees = Object.fromEntries(
  ['transactional', 'durable_projection'].map((guarantee) => [
    guarantee,
    EVIDENCE_RECORD_CATALOG.filter((entry) => entry.deliveryGuarantee === guarantee).length,
  ]),
);
if (catalogEvaluationRoles['required'] !== 95 || catalogEvaluationRoles['diagnostic'] !== 5) {
  throw new Error(`EVIDENCE_CATALOG_ROLE_COUNTS_INVALID:${JSON.stringify(catalogEvaluationRoles)}`);
}
if (
  catalogDeliveryGuarantees['transactional'] !== 0 ||
  catalogDeliveryGuarantees['durable_projection'] !== 100
) {
  throw new Error(
    `EVIDENCE_CATALOG_DELIVERY_COUNTS_INVALID:${JSON.stringify(catalogDeliveryGuarantees)}`,
  );
}

const artifactRefSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: schemaId('artifact-ref'),
  title: 'Canonical evidence artifact reference',
  type: 'object',
  additionalProperties: false,
  required: ['artifactId', 'version', 'uri', 'sha256', 'mediaType', 'byteSize'],
  properties: {
    artifactId: { type: 'string', minLength: 1, maxLength: 512 },
    version: { type: 'integer', minimum: 1 },
    uri: { type: 'string', minLength: 1, maxLength: 4096 },
    sha256: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
    mediaType: { type: 'string', minLength: 1, maxLength: 256 },
    byteSize: { type: 'integer', minimum: 0, maximum: 1_073_741_824 },
  },
} as const;

const batchSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: schemaId('batch-request'),
  title: 'sdar.evidence/v1 batch request',
  type: 'object',
  additionalProperties: false,
  required: [
    'contractVersion',
    'exportId',
    'sourceId',
    'nodeId',
    'revision',
    'firstSequence',
    'lastSequence',
    'batchHash',
    'records',
  ],
  properties: {
    contractVersion: { const: EVIDENCE_CONTRACT_VERSION },
    exportId: { type: 'string', minLength: 1, maxLength: 256 },
    sourceId: { type: 'string', minLength: 1, maxLength: 256 },
    nodeId: { type: 'string', minLength: 1, maxLength: 256 },
    revision: { type: 'integer', minimum: 1 },
    firstSequence: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
    lastSequence: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
    batchHash: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
    records: {
      type: 'array',
      minItems: 1,
      maxItems: 1000,
      items: {
        oneOf: EVIDENCE_RECORD_CATALOG.map((entry) => ({
          $ref: `records/${entry.recordType}.schema.json`,
        })),
      },
    },
  },
} as const;

const acknowledgementSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: schemaId('batch-acknowledgement'),
  title: 'sdar.evidence/v1 contiguous acknowledgement',
  type: 'object',
  additionalProperties: false,
  required: ['lastAcknowledgedSequence'],
  properties: {
    lastAcknowledgedSequence: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
  },
} as const;

const manifestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: schemaId('episode-evidence-manifest'),
  title: 'Episode evidence manifest',
  type: 'object',
  additionalProperties: false,
  required: [
    'manifestId',
    'revision',
    'policyVersion',
    'episodeId',
    'taskId',
    'terminalOutcomeId',
    'expectedRequiredRecords',
    'projectedRequiredRecords',
    'pendingRequiredRecords',
    'failedRequiredRecords',
    'expectedFamilies',
    'completedFamilies',
    'missingFamilies',
    'sourceCoverage',
    'lastEvidenceSequence',
    'status',
    'qualityIssueIds',
    'sourceSnapshotHash',
    'createdAt',
    'recomputedAt',
  ],
  properties: {
    manifestId: { type: 'string', minLength: 1, maxLength: 512 },
    revision: { type: 'integer', minimum: 1 },
    policyVersion: { const: 'episode-evidence-policy/v1' },
    episodeId: { type: 'string', minLength: 1, maxLength: 512 },
    taskId: { type: 'string', minLength: 1, maxLength: 512 },
    terminalOutcomeId: { type: 'string', minLength: 1, maxLength: 512 },
    expectedRequiredRecords: { type: 'integer', minimum: 0 },
    projectedRequiredRecords: { type: 'integer', minimum: 0 },
    pendingRequiredRecords: { type: 'integer', minimum: 0 },
    failedRequiredRecords: { type: 'integer', minimum: 0 },
    expectedFamilies: { $ref: '#/$defs/families' },
    completedFamilies: { $ref: '#/$defs/families' },
    missingFamilies: { $ref: '#/$defs/families' },
    sourceCoverage: {
      type: 'object',
      maxProperties: 256,
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['expected', 'projected', 'pending', 'failed'],
        properties: {
          expected: { type: 'integer', minimum: 0 },
          projected: { type: 'integer', minimum: 0 },
          pending: { type: 'integer', minimum: 0 },
          failed: { type: 'integer', minimum: 0 },
          lastSourceRevision: { type: 'string', minLength: 1, maxLength: 1024 },
        },
      },
    },
    lastEvidenceSequence: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
    status: { enum: ['projecting', 'complete', 'degraded', 'incomplete'] },
    qualityIssueIds: {
      type: 'array',
      maxItems: 256,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 512 },
    },
    sourceSnapshotHash: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
    createdAt: { type: 'string', format: 'date-time' },
    recomputedAt: { type: 'string', format: 'date-time' },
    sealedAt: { type: 'string', format: 'date-time' },
  },
  $defs: {
    families: {
      type: 'array',
      maxItems: EVIDENCE_RECORD_FAMILIES.length,
      uniqueItems: true,
      items: { enum: EVIDENCE_RECORD_FAMILIES },
    },
  },
} as const;

const issueProperties = {
  issueId: { type: 'string', minLength: 1, maxLength: 512 },
  issueCode: { enum: EVIDENCE_ISSUE_CODES },
  severity: { enum: ['diagnostic', 'degraded', 'blocking'] },
  recordType: { type: 'string', minLength: 1, maxLength: 256 },
  recordId: { type: 'string', pattern: '^evidence_[0-9a-f]{64}$' },
  episodeId: { type: 'string', minLength: 1, maxLength: 512 },
  sourceSystem: { enum: ['runtime', 'node_control'] },
  sourceTable: { type: 'string', minLength: 1, maxLength: 1024 },
  sourceRecordId: { type: 'string', minLength: 1, maxLength: 1024 },
  detail: { type: 'object', maxProperties: 64 },
  createdAt: { type: 'string', format: 'date-time' },
} as const;

const qualityIssueSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: schemaId('quality-issue'),
  title: 'Canonical evidence quality issue',
  type: 'object',
  additionalProperties: false,
  required: [
    'issueId',
    'issueCode',
    'severity',
    'sourceSystem',
    'sourceTable',
    'sourceRecordId',
    'detail',
    'createdAt',
  ],
  properties: issueProperties,
} as const;

const projectionIssueSchema = {
  ...qualityIssueSchema,
  $id: schemaId('projection-issue'),
  title: 'Canonical evidence projection issue',
  required: [...qualityIssueSchema.required, 'projectorVersion', 'sourcePartition', 'retryable'],
  properties: {
    ...issueProperties,
    projectorVersion: { type: 'string', minLength: 1, maxLength: 256 },
    sourcePartition: { type: 'string', minLength: 1, maxLength: 512 },
    retryable: { type: 'boolean' },
  },
} as const;

const canonicalEnvelopeSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: schemaId('canonical-evidence-envelope'),
  title: 'Canonical evidence envelope union',
  oneOf: EVIDENCE_RECORD_CATALOG.map((entry) => ({
    $ref: `records/${entry.recordType}.schema.json`,
  })),
} as const;

const protocolSchemas = {
  'artifact-ref': artifactRefSchema,
  'batch-request': batchSchema,
  'batch-acknowledgement': acknowledgementSchema,
  'canonical-evidence-envelope': canonicalEnvelopeSchema,
  'episode-evidence-manifest': manifestSchema,
  'quality-issue': qualityIssueSchema,
  'projection-issue': projectionIssueSchema,
} as const;

await mkdir(recordRoot, { recursive: true });
await mkdir(protocolRoot, { recursive: true });
for (const entry of EVIDENCE_RECORD_CATALOG) {
  await writeFile(
    path.join(recordRoot, `${entry.recordType}.schema.json`),
    await json(getEvidenceRecordSchema(entry.recordType)),
    'utf8',
  );
}
for (const [name, schema] of Object.entries(protocolSchemas)) {
  await writeFile(path.join(schemaRoot, `${name}.schema.json`), await json(schema), 'utf8');
}

const registryCore = {
  contractVersion: EVIDENCE_CONTRACT_VERSION,
  schemaDialect: 'https://json-schema.org/draft/2020-12/schema',
  compatibilityPolicy: 'backward_compatible_additive',
  records: EVIDENCE_RECORD_CATALOG.map((entry) => ({
    sourceSystem: entry.sourceSystem,
    sourceTable: entry.sourceTable,
    authority: entry.authority,
    recordFamily: entry.recordFamily,
    recordType: entry.recordType,
    schemaName: entry.schemaName,
    schemaVersion: entry.schemaVersion,
    schemaPath: `records/${entry.recordType}.schema.json`,
    schemaHash: entry.schemaHash,
    compatibility: entry.compatibility,
    maximumInlineBytes: entry.maximumInlineBytes,
    mapper: entry.mapper,
    deliveryGuarantee: entry.deliveryGuarantee,
    evaluationRole: entry.evaluationRole,
    requirementLevel: entry.requirementLevel,
    applicability: entry.applicability,
    redactionPolicy: entry.redactionPolicy,
    artifactPolicy: entry.artifactPolicy,
    expectedReferences: entry.expectedReferences,
  })),
  protocolSchemas: Object.entries(protocolSchemas).map(([name, schema]) => ({
    name,
    schemaPath: `${name}.schema.json`,
    schemaHash: hashCanonicalEvidenceJson(schema),
  })),
};
const registryHash = hashCanonicalEvidenceJson(registryCore);
await writeFile(
  path.join(schemaRoot, 'registry.json'),
  await json({ ...registryCore, registryHash }),
  'utf8',
);

const protocolContract = {
  contractVersion: EVIDENCE_CONTRACT_VERSION,
  requestHeader: { name: 'x-sdar-evidence-contract', value: EVIDENCE_CONTRACT_VERSION },
  deliveryGuarantee: 'at_least_once',
  acknowledgement: 'contiguous_with_partial_ack',
  recordFamilies: EVIDENCE_RECORD_FAMILIES,
  recordTypeCount: EVIDENCE_RECORD_CATALOG.length,
  registryPath: '../../../schemas/evidence/v1/registry.json',
  registryHash,
  requestSchema: '../../../schemas/evidence/v1/batch-request.schema.json',
  acknowledgementSchema: '../../../schemas/evidence/v1/batch-acknowledgement.schema.json',
  forbiddenLegacyHeader: 'x-sdar-telemetry-contract',
};
const protocolContractJson = await json(protocolContract);
await writeFile(path.join(protocolRoot, 'evidence-contract.json'), protocolContractJson, 'utf8');

const contractHash = `sha256:${createHash('sha256').update(protocolContractJson).digest('hex')}`;
stdout.write(
  `${JSON.stringify({ records: EVIDENCE_RECORD_CATALOG.length, registryHash, contractHash })}\n`,
);
