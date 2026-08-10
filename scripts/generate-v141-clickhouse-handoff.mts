import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createCatalogEvidenceEnvelope,
  hashCanonicalEvidenceJson,
} from '../packages/domain/src/index.js';

type JsonObject = Record<string, unknown>;

const root = path.resolve('.');
const outputRoot = path.join(root, 'reports', 'v1.4.1-evidence', 'clickhouse-handoff');
const samplesRoot = path.join(outputRoot, 'sample-batches');
const fullVerifyPassed = process.argv.includes('--full-verify-passed');

const registry = await readJson(path.join(root, 'schemas', 'evidence', 'v1', 'registry.json'));
const contract = await readJson(
  path.join(root, 'protocol', 'evidence', 'v1', 'evidence-contract.json'),
);
const matrix = await readJson(
  path.join(root, 'reports', 'v1.4.1-evidence', 'source-to-evidence-matrix.json'),
);
const phase12 = await readJson(path.join(root, 'reports', 'v1.4.1-evidence', 'phase-12-e2e.json'));
const records = requiredArray(registry, 'records');
const protocolSchemas = requiredArray(registry, 'protocolSchemas');
const mappings = requiredArray(matrix, 'records');
const scenarios = requiredArray(phase12, 'scenarios');
const registryHash = requiredString(registry, 'registryHash');

if (records.length !== 100 || mappings.length !== 100) {
  throw new Error('V141_CLICKHOUSE_HANDOFF_CATALOG_COUNT_INVALID');
}
if (mappings.some((entry) => entry['status'] !== 'implemented_and_verified')) {
  throw new Error('V141_CLICKHOUSE_HANDOFF_UNVERIFIED_MAPPING');
}
if (hashCanonicalEvidenceJson(withoutKey(registry, 'registryHash')) !== registryHash) {
  throw new Error('V141_CLICKHOUSE_HANDOFF_REGISTRY_HASH_INVALID');
}

await mkdir(samplesRoot, { recursive: true });
await writeJson(path.join(outputRoot, 'contract-manifest.json'), {
  schemaVersion: 1,
  handoffTarget: 'future ClickHouse adapter; no ClickHouse implementation in SDAR v1.4.1',
  contractVersion: requiredString(contract, 'contractVersion'),
  requestHeader: contract['requestHeader'],
  deliveryGuarantee: contract['deliveryGuarantee'],
  acknowledgement: contract['acknowledgement'],
  registryHash,
  contractHash: hashCanonicalEvidenceJson(contract),
  hashAlgorithm: 'sha256 over canonical Evidence JSON UTF-8 bytes',
  limits: {
    recordTypes: 100,
    requiredRecords: 95,
    diagnosticRecords: 5,
    maximumBatchRecords: 1_000,
    maximumCanonicalRecordBytes: 262_144,
    maximumReferences: 256,
  },
  generatedBy: 'scripts/generate-v141-clickhouse-handoff.mts',
});
await writeJson(path.join(outputRoot, 'record-catalog.json'), {
  contractVersion: 'sdar.evidence/v1',
  registryHash,
  recordCount: records.length,
  records,
});
await writeJson(path.join(outputRoot, 'schema-hashes.json'), {
  contractVersion: 'sdar.evidence/v1',
  registryHash,
  recordSchemas: records.map((entry) => ({
    recordType: entry['recordType'],
    schemaName: entry['schemaName'],
    schemaVersion: entry['schemaVersion'],
    schemaPath: entry['schemaPath'],
    schemaHash: entry['schemaHash'],
  })),
  protocolSchemas,
});
await writeJson(path.join(outputRoot, 'source-mapping.json'), {
  contractVersion: 'sdar.evidence/v1',
  registryHash,
  totals: {
    catalog: 100,
    implementedAndVerified: mappings.length,
    required: mappings.filter((entry) => entry['evaluation_role'] === 'required').length,
    diagnostic: mappings.filter((entry) => entry['evaluation_role'] === 'diagnostic').length,
  },
  records: mappings,
});

const sampleRecords = [
  sampleEpisode('handoff-episode-1', '1', '2026-08-10T05:00:00.000Z'),
  sampleEpisode('handoff-episode-2', '1', '2026-08-10T05:00:01.000Z'),
].map((record, index) => ({ ...record, evidenceSequence: String(index + 1) }));
const unsignedBatch = {
  contractVersion: 'sdar.evidence/v1',
  exportId: 'handoff-simulated-export',
  sourceId: 'handoff-simulated-runtime',
  nodeId: 'handoff-simulated-node',
  revision: 1,
  firstSequence: '1',
  lastSequence: '2',
  records: sampleRecords,
};
const batch = { ...unsignedBatch, batchHash: hashCanonicalEvidenceJson(unsignedBatch) };
await writeJson(path.join(samplesRoot, 'valid-batch.json'), batch);
await writeJson(path.join(samplesRoot, 'accepted-ack.json'), {
  lastAcknowledgedSequence: '2',
});
await writeJson(path.join(samplesRoot, 'partial-ack.json'), {
  lastAcknowledgedSequence: '1',
});
await writeJson(path.join(samplesRoot, 'duplicate-delivery.json'), {
  classification: 'simulated protocol fixture',
  rule: 'the retry preserves the exact batchHash and record identities; the receiver deduplicates',
  firstDelivery: batch,
  retryDelivery: batch,
});
await writeJson(path.join(samplesRoot, 'sample-manifest.json'), {
  classification: 'simulated deterministic protocol fixtures',
  realEvidenceBoundary:
    'Real PostgreSQL/Redis/HTTP execution evidence is retained in phase-12-e2e.json and phase reports; these files are adapter fixtures only.',
  files: ['valid-batch.json', 'accepted-ack.json', 'partial-ack.json', 'duplicate-delivery.json'],
});

await writeJson(path.join(outputRoot, 'readiness-policy.json'), {
  schemaVersion: 1,
  contractVersion: 'sdar.evidence/v1',
  registryHash,
  requiredSourceCoverage: { verified: 95, total: 95, ready: true },
  catalogCoverage: { verified: 100, total: 100, ready: true },
  phase12Scenarios: {
    passed: scenarios.filter((scenario) => scenario['status'] === 'passed').length,
    total: 44,
    ready:
      scenarios.length === 44 && scenarios.every((scenario) => scenario['status'] === 'passed'),
  },
  requiredDeferredItems: 0,
  fullVerify: fullVerifyPassed ? 'passed' : 'pending_phase14_final_gate',
  clickHouseImplementationAuthorized: false,
  readyForAdapterIntake: fullVerifyPassed,
});
await writeFile(
  path.join(outputRoot, 'known-limitations.md'),
  `# Known limitations\n\n- Delivery is at least once; duplicate batches and records are expected and must be deduplicated by stable identity and hash.\n- ACK is contiguous and partition-aware; it is not a distributed transaction with the receiver.\n- Diagnostic record exclusion is policy-controlled; all 95 Required record types remain mandatory.\n- PostgreSQL is the SDAR authority. This handoff contains no ClickHouse DDL, table, query, proxy or operational authority.\n- No production HA, throughput SLO, RTO or RPO is claimed by the local acceptance evidence.\n- Artifact payloads remain referenced by hash/size/URI and require an authorized resolver.\n- The sample batches are deterministic simulated adapter fixtures; real execution proof remains in the Phase 12 and Phase 14 reports.\n`,
  'utf8',
);

process.stdout.write(
  `${JSON.stringify({ records: records.length, mappings: mappings.length, registryHash, fullVerifyPassed })}\n`,
);

function sampleEpisode(episodeId: string, revision: string, timestamp: string) {
  return createCatalogEvidenceEnvelope({
    recordType: 'runtime.episode',
    sourceRecordId: episodeId,
    sourceRevision: revision,
    environment: 'handoff-simulated',
    correlationId: episodeId,
    occurredAt: timestamp,
    recordedAt: timestamp,
    taskId: `task-${episodeId}`,
    episodeId,
    payload: { episodeId, taskId: `task-${episodeId}`, status: 'completed' },
  });
}

async function readJson(filePath: string): Promise<JsonObject> {
  return JSON.parse(await readFile(filePath, 'utf8')) as JsonObject;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function requiredArray(value: JsonObject, field: string): JsonObject[] {
  const candidate = value[field];
  if (!Array.isArray(candidate) || candidate.some((entry) => !isObject(entry))) {
    throw new Error(`V141_CLICKHOUSE_HANDOFF_${field.toUpperCase()}_INVALID`);
  }
  return candidate as JsonObject[];
}

function requiredString(value: JsonObject, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error(`V141_CLICKHOUSE_HANDOFF_${field.toUpperCase()}_INVALID`);
  }
  return candidate;
}

function withoutKey(value: JsonObject, key: string): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([field]) => field !== key));
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
