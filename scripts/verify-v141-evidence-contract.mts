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
if (!Array.isArray(records) || records.length !== 100) {
  throw new Error(
    `EVIDENCE_REGISTRY_COUNT_INVALID:${Array.isArray(records) ? records.length : 'not-array'}`,
  );
}
if (new Set(EVIDENCE_RECORD_CATALOG.map((entry) => entry.recordType)).size !== 100) {
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
  mcp_task: 11,
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
}

const matrix = await readJson(
  path.resolve('reports/v1.4.1-evidence/source-to-evidence-matrix.json'),
);
const matrixRecords = matrix['records'];
if (!Array.isArray(matrixRecords)) throw new Error('EVIDENCE_SOURCE_MATRIX_INVALID');
const matrixTypes = new Set(
  matrixRecords.map((record) => (record as Record<string, unknown>)['record_type']),
);
for (const entry of EVIDENCE_RECORD_CATALOG) {
  if (!matrixTypes.has(entry.recordType)) {
    throw new Error(`EVIDENCE_SOURCE_MATRIX_CATALOG_DRIFT:${entry.recordType}`);
  }
}

const contract = await readJson(path.resolve('protocol/evidence/v1/evidence-contract.json'));
if (
  contract['contractVersion'] !== EVIDENCE_CONTRACT_VERSION ||
  (contract['requestHeader'] as Record<string, unknown>)?.['name'] !== 'x-sdar-evidence-contract'
) {
  throw new Error('EVIDENCE_PROTOCOL_CONTRACT_INVALID');
}

stdout.write(
  `${JSON.stringify({ status: 'PASSED', records: 100, familyCounts, registryHash: registry['registryHash'] })}\n`,
);
