import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { stdout } from 'node:process';

import {
  EVIDENCE_CONTRACT_VERSION,
  EVIDENCE_RECORD_CATALOG,
  EVIDENCE_RECORD_FAMILIES,
  getEvidenceRecordSchema,
  hashCanonicalEvidenceJson,
} from '../packages/domain/src/evidence/index.js';

const schemaRoot = path.resolve('schemas/evidence/v1');
const readJson = async (file: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
const registry = await readJson(path.join(schemaRoot, 'registry.json'));
const records = registry['records'];
if (!Array.isArray(records) || records.length !== 105) {
  throw new Error(
    `EVIDENCE_REGISTRY_COUNT_INVALID:${Array.isArray(records) ? records.length : 'not-array'}`,
  );
}
if (new Set(EVIDENCE_RECORD_CATALOG.map((entry) => entry.recordType)).size !== 105) {
  throw new Error('EVIDENCE_CATALOG_DUPLICATE_RECORD_TYPE');
}
const familyCounts = Object.fromEntries(
  EVIDENCE_RECORD_FAMILIES.map((family) => [
    family,
    EVIDENCE_RECORD_CATALOG.filter((entry) => entry.recordFamily === family).length,
  ]),
);
const expectedCounts = {
  runtime: 18,
  skill: 16,
  mcp_task: 16,
  capability: 7,
  experience: 10,
  replay: 6,
  artifact: 6,
  node_control: 21,
  evidence: 5,
};
if (JSON.stringify(familyCounts) !== JSON.stringify(expectedCounts)) {
  throw new Error(`EVIDENCE_FAMILY_COUNTS_INVALID:${JSON.stringify(familyCounts)}`);
}

const registryByType = new Map(
  records.map((record) => {
    if (typeof record !== 'object' || record === null)
      throw new Error('EVIDENCE_REGISTRY_ROW_INVALID');
    const typed = record as Record<string, unknown>;
    return [typed['recordType'], typed] as const;
  }),
);
for (const entry of EVIDENCE_RECORD_CATALOG) {
  const file = path.join(schemaRoot, 'records', `${entry.recordType}.schema.json`);
  const schema = await readJson(file);
  const expected = getEvidenceRecordSchema(entry.recordType);
  if (JSON.stringify(schema) !== JSON.stringify(expected)) {
    throw new Error(`EVIDENCE_SCHEMA_GENERATION_DRIFT:${entry.recordType}`);
  }
  if (schema['$schema'] !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error(`EVIDENCE_SCHEMA_DIALECT_INVALID:${entry.recordType}`);
  }
  const properties = schema['properties'] as Record<string, unknown> | undefined;
  const payload = properties?.['payload'] as Record<string, unknown> | undefined;
  if (!Array.isArray(payload?.['required']) || payload['required'].length < 2) {
    throw new Error(`EVIDENCE_PAYLOAD_SCHEMA_PLACEHOLDER:${entry.recordType}`);
  }
  const actualHash = hashCanonicalEvidenceJson(schema);
  const registryEntry = registryByType.get(entry.recordType);
  if (actualHash !== entry.schemaHash || registryEntry?.['schemaHash'] !== actualHash) {
    throw new Error(`EVIDENCE_SCHEMA_HASH_MISMATCH:${entry.recordType}`);
  }
  const registryContractFields = {
    sourceSystem: entry.sourceSystem,
    sourceTable: entry.sourceTable,
    authority: entry.authority,
    recordFamily: entry.recordFamily,
    recordType: entry.recordType,
    schemaName: entry.schemaName,
    schemaVersion: entry.schemaVersion,
    mapper: entry.mapper,
    deliveryGuarantee: entry.deliveryGuarantee,
    evaluationRole: entry.evaluationRole,
    requirementLevel: entry.requirementLevel,
    applicability: entry.applicability,
    redactionPolicy: entry.redactionPolicy,
    artifactPolicy: entry.artifactPolicy,
    expectedReferences: entry.expectedReferences,
  };
  for (const [field, expectedValue] of Object.entries(registryContractFields)) {
    if (JSON.stringify(registryEntry?.[field]) !== JSON.stringify(expectedValue)) {
      throw new Error(`EVIDENCE_REGISTRY_CATALOG_DRIFT:${entry.recordType}:${field}`);
    }
  }
}

const matrix = await readJson(
  path.resolve('reports/v1.4.1-evidence/source-to-evidence-matrix.json'),
);
if (matrix['registryHash'] !== registry['registryHash']) {
  throw new Error('EVIDENCE_SOURCE_MATRIX_REGISTRY_HASH_DRIFT');
}
const matrixRecords = matrix['records'];
if (!Array.isArray(matrixRecords) || matrixRecords.length !== 105) {
  throw new Error('EVIDENCE_SOURCE_MATRIX_INVALID');
}
const matrixByType = new Map(
  matrixRecords.map((record) => {
    if (typeof record !== 'object' || record === null)
      throw new Error('EVIDENCE_SOURCE_MATRIX_ROW_INVALID');
    const typed = record as Record<string, unknown>;
    return [typed['record_type'], typed] as const;
  }),
);
if (matrixByType.size !== 105) throw new Error('EVIDENCE_SOURCE_MATRIX_DUPLICATE_TYPE');
for (const entry of EVIDENCE_RECORD_CATALOG) {
  const matrixEntry = matrixByType.get(entry.recordType);
  if (matrixEntry === undefined) {
    throw new Error(`EVIDENCE_SOURCE_MATRIX_CATALOG_DRIFT:${entry.recordType}`);
  }
  const matrixContractFields = {
    source_system: entry.sourceSystem,
    source_table_or_aggregate: entry.sourceTable,
    source_authority: entry.authority,
    record_family: entry.recordFamily,
    schema_name: entry.schemaName,
    schema_version: entry.schemaVersion,
    delivery_guarantee: entry.deliveryGuarantee,
    evaluation_role: entry.evaluationRole,
    applicability: entry.applicability,
    mapper: entry.mapper,
    redaction_profile: entry.redactionPolicy,
    artifact_policy: entry.artifactPolicy,
    required_references: entry.expectedReferences.join(','),
  };
  for (const [field, expectedValue] of Object.entries(matrixContractFields)) {
    if (JSON.stringify(matrixEntry[field]) !== JSON.stringify(expectedValue)) {
      throw new Error(`EVIDENCE_SOURCE_MATRIX_FIELD_DRIFT:${entry.recordType}:${field}`);
    }
  }
}
const evaluationRoleCounts = Object.fromEntries(
  ['required', 'diagnostic'].map((role) => [
    role,
    matrixRecords.filter(
      (record) => (record as Record<string, unknown>)['evaluation_role'] === role,
    ).length,
  ]),
);
if (evaluationRoleCounts['required'] !== 100 || evaluationRoleCounts['diagnostic'] !== 5) {
  throw new Error(
    `EVIDENCE_SOURCE_MATRIX_ROLE_COUNTS_INVALID:${JSON.stringify(evaluationRoleCounts)}`,
  );
}
const deliveryGuaranteeCounts = Object.fromEntries(
  ['transactional', 'durable_projection'].map((guarantee) => [
    guarantee,
    matrixRecords.filter(
      (record) => (record as Record<string, unknown>)['delivery_guarantee'] === guarantee,
    ).length,
  ]),
);
const catalogDeliveryGuaranteeCounts = Object.fromEntries(
  ['transactional', 'durable_projection'].map((guarantee) => [
    guarantee,
    EVIDENCE_RECORD_CATALOG.filter((entry) => entry.deliveryGuarantee === guarantee).length,
  ]),
);
if (JSON.stringify(deliveryGuaranteeCounts) !== JSON.stringify(catalogDeliveryGuaranteeCounts)) {
  throw new Error(
    `EVIDENCE_SOURCE_MATRIX_DELIVERY_COUNTS_INVALID:${JSON.stringify(deliveryGuaranteeCounts)}`,
  );
}
if (
  deliveryGuaranteeCounts['transactional'] !== 0 ||
  deliveryGuaranteeCounts['durable_projection'] !== 105
) {
  throw new Error(
    `EVIDENCE_SOURCE_MATRIX_DURABILITY_INVALID:${JSON.stringify(deliveryGuaranteeCounts)}`,
  );
}

const contract = await readJson(path.resolve('protocol/evidence/v1/evidence-contract.json'));
if (
  contract['contractVersion'] !== EVIDENCE_CONTRACT_VERSION ||
  (contract['requestHeader'] as Record<string, unknown>)?.['name'] !== 'x-sdar-evidence-contract'
) {
  throw new Error('EVIDENCE_PROTOCOL_CONTRACT_INVALID');
}

stdout.write(
  `${JSON.stringify({ status: 'PASSED', records: 105, familyCounts, evaluationRoleCounts, deliveryGuaranteeCounts, registryHash: registry['registryHash'] })}\n`,
);
