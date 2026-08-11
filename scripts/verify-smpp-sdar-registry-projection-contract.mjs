import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import Ajv2020Import from 'ajv/dist/2020.js';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const VENDORED_ROOT = path.join(
  REPOSITORY_ROOT,
  'protocol/external/smpp-sdar-registry-projection/v1',
);
const ASSET_NAMES = [
  'CONTRACT.md',
  'MANIFEST.json',
  'SOURCE_LOCK.json',
  'checksum-vectors.json',
  'error-catalog.json',
  'projection.schema.json',
];
const EXPECTED_MANIFEST_SHA256 = '863dfd9046aa12a17dfa4751e63f2660c15b8472f9a162b94dddc04541138cd8';
const EXPECTED_BUNDLE_SHA256 = '6668573cae45954bc1fc008243a7684949ff936c1cb8acf91512825a0d5f1e9e';
const EXPECTED_SCHEMA_SHA256 = '425cd331f7ee7e4294919ea307f05edb222b99fe5bbc9d320ae71959ed6ab34e';
const EXPECTED_SDAR_COMMIT = 'a9957c82c17ca01e77528f3817c03d86224aaf88';
const EXPECTED_SMPP_BASELINE = '981792b9cb22f8b3117fe3ab26f639de71487d1f';
const EXPECTED_SDAR_BLOBS = new Map([
  [
    'packages/node-control-domain/src/configuration-revision.ts',
    '1dd13ece28842a01b98dc37d60900190095076fb212bb135e830299984f0e990',
  ],
  [
    'packages/node-control-domain/src/smpp-registry.ts',
    'ae90e55cccd7e7263d7442c1179ceafc6c59757c84ebec5544260266c7487448',
  ],
  [
    'packages/node-control-domain/test/smpp-registry.unit.test.ts',
    'dbdb97b3c556cb4bb84808c4a0f69a27ce1be510327193b75227dc35f3bd5d66',
  ],
]);
const EXPECTED_SMPP_BLOBS = new Map([
  [
    'packages/registry-snapshot/src/model.ts',
    '7e59ea8486f4c4d669853b5c8a00daaa74d74910cb9f4ddf6f4ee88f2e794083',
  ],
  [
    'packages/registry-snapshot/src/builder.ts',
    'ac4d3eeaaa662b5a0d4b0cc46b42a43fe568879a2c7c9b6165c4eb5d6af8949b',
  ],
  [
    'packages/pms-persistence-postgres/src/registry-snapshot-repository.ts',
    '5aa606e442e516f5871ec86d40684a1f846de1634eef09d65f4c76810bd4d81a',
  ],
  [
    'apps/pms-api/src/registry-routes.ts',
    'd5321f69cd1685607a605e2477beb4e0a393fe9050ebe6feafe7bf6f2f1b0bf0',
  ],
  [
    'migrations/pms/008_registry_snapshot.sql',
    '98097e7b8ddc1ea51e006a6e8f8b1671f453f07118949591d577ec1347e0cc73',
  ],
]);

await assertAssetInventory(VENDORED_ROOT, 'VENDORED');
const manifestBytes = await readFile(path.join(VENDORED_ROOT, 'MANIFEST.json'));
assertEqual(sha256(manifestBytes), EXPECTED_MANIFEST_SHA256, 'MANIFEST_SHA256_DRIFT');
const manifest = parseJson(manifestBytes, 'MANIFEST_JSON_INVALID');
assertManifestShape(manifest);

const verifiedEntries = [];
for (const entry of manifest.files) {
  const content = await readFile(path.join(VENDORED_ROOT, entry.path));
  const digest = sha256(content);
  assertEqual(digest, entry.sha256, `MANIFEST_ASSET_SHA256_DRIFT:${entry.path}`);
  verifiedEntries.push({ path: entry.path, sha256: digest });
}

const bundleSource = [...verifiedEntries]
  .sort((left, right) => left.path.localeCompare(right.path))
  .map((entry) => `${entry.path}:${entry.sha256}\n`)
  .join('');
const bundleSha256 = sha256(Buffer.from(bundleSource, 'utf8'));
assertEqual(bundleSha256, manifest.bundleSha256, 'MANIFEST_BUNDLE_SHA256_DRIFT');
assertEqual(bundleSha256, EXPECTED_BUNDLE_SHA256, 'EXPECTED_BUNDLE_SHA256_DRIFT');
assertEqual(
  manifest.projectionSchemaSha256,
  EXPECTED_SCHEMA_SHA256,
  'EXPECTED_SCHEMA_SHA256_DRIFT',
);
assertEqual(
  verifiedEntries.find((entry) => entry.path === 'projection.schema.json')?.sha256,
  manifest.projectionSchemaSha256,
  'MANIFEST_SCHEMA_SHA256_DRIFT',
);

for (const jsonAsset of [
  'SOURCE_LOCK.json',
  'checksum-vectors.json',
  'error-catalog.json',
  'projection.schema.json',
]) {
  parseJson(await readFile(path.join(VENDORED_ROOT, jsonAsset)), `${jsonAsset}:JSON_INVALID`);
}

const vectorsDocument = parseJson(
  await readFile(path.join(VENDORED_ROOT, 'checksum-vectors.json')),
  'CHECKSUM_VECTORS_JSON_INVALID',
);
const projectionSchema = parseJson(
  await readFile(path.join(VENDORED_ROOT, 'projection.schema.json')),
  'PROJECTION_SCHEMA_JSON_INVALID',
);
const vectorCount = executeChecksumVectors(vectorsDocument, projectionSchema);

const sourceLock = parseJson(
  await readFile(path.join(VENDORED_ROOT, 'SOURCE_LOCK.json')),
  'SOURCE_LOCK_JSON_INVALID',
);
assertSourceLock(sourceLock);
for (const [lockedPath, expectedDigest] of EXPECTED_SDAR_BLOBS) {
  const blob = readGitBlob(REPOSITORY_ROOT, EXPECTED_SDAR_COMMIT, lockedPath, 'SDAR');
  assertEqual(sha256(blob), expectedDigest, `SDAR_LOCKED_BLOB_DRIFT:${lockedPath}`);
}

let canonicalRoot = null;
const requireCanonical =
  process.argv.includes('--require-canonical') ||
  process.env.SMPP_REQUIRE_CANONICAL_CONTRACT?.trim() === 'YES';
const canonicalArgumentIndex = process.argv.indexOf('--canonical-root');
const canonicalArgument =
  canonicalArgumentIndex === -1 ? undefined : process.argv[canonicalArgumentIndex + 1];
let canonicalSetting =
  canonicalArgument?.trim() ?? process.env.SMPP_CANONICAL_CONTRACT_ROOT?.trim();
if (requireCanonical && (canonicalSetting === undefined || canonicalSetting.length === 0)) {
  canonicalSetting = path.resolve(
    REPOSITORY_ROOT,
    '../sdar-mcp-provider-platform/protocol/consumer-projections/sdar-registry/v1',
  );
}
if (canonicalSetting !== undefined && canonicalSetting.length > 0) {
  canonicalRoot = path.resolve(canonicalSetting);
  await assertAssetInventory(canonicalRoot, 'CANONICAL');
  for (const assetName of ASSET_NAMES) {
    const [vendored, canonical] = await Promise.all([
      readFile(path.join(VENDORED_ROOT, assetName)),
      readFile(path.join(canonicalRoot, assetName)),
    ]);
    if (!vendored.equals(canonical)) throw new Error(`CANONICAL_BYTE_DRIFT:${assetName}`);
  }
  const smppRepositoryRoot = path.resolve(canonicalRoot, '../../../..');
  for (const [lockedPath, expectedDigest] of EXPECTED_SMPP_BLOBS) {
    const blob = readGitBlob(smppRepositoryRoot, EXPECTED_SMPP_BASELINE, lockedPath, 'SMPP_NATIVE');
    assertEqual(sha256(blob), expectedDigest, `SMPP_NATIVE_LOCKED_BLOB_DRIFT:${lockedPath}`);
  }
}
if (requireCanonical && canonicalRoot === null) throw new Error('CANONICAL_ROOT_REQUIRED');

process.stdout.write(
  `${JSON.stringify(
    {
      contract: manifest.contract,
      vendoredAssetCount: ASSET_NAMES.length,
      manifestSha256: sha256(manifestBytes),
      bundleSha256,
      projectionSchemaSha256: manifest.projectionSchemaSha256,
      executedChecksumVectors: vectorCount,
      sdarLockedCommit: EXPECTED_SDAR_COMMIT,
      smppNativeBaseline: EXPECTED_SMPP_BASELINE,
      canonicalByteIdentical: canonicalRoot !== null,
      smppNativeAuthorityVerified: canonicalRoot !== null,
    },
    null,
    2,
  )}\n`,
);

function assertManifestShape(value) {
  if (!isRecord(value)) throw new Error('MANIFEST_SHAPE_INVALID');
  assertEqual(value.schemaVersion, '1.0', 'MANIFEST_SCHEMA_VERSION_INVALID');
  assertEqual(value.contract, 'sdar-registry-v1', 'MANIFEST_CONTRACT_INVALID');
  assertEqual(value.hashAlgorithm, 'sha256', 'MANIFEST_HASH_ALGORITHM_INVALID');
  assertEqual(
    value.bundleAlgorithm,
    'sha256 of UTF-8 path:sha256\\n records sorted by path with localeCompare',
    'MANIFEST_BUNDLE_ALGORITHM_INVALID',
  );
  assertEqual(value.bundleSha256, EXPECTED_BUNDLE_SHA256, 'MANIFEST_BUNDLE_LOCK_INVALID');
  assertEqual(value.projectionSchemaSha256, EXPECTED_SCHEMA_SHA256, 'MANIFEST_SCHEMA_LOCK_INVALID');
  if (!Array.isArray(value.files) || value.files.length !== ASSET_NAMES.length - 1) {
    throw new Error('MANIFEST_FILE_COUNT_INVALID');
  }
  const expectedPaths = ASSET_NAMES.filter((name) => name !== 'MANIFEST.json').sort((left, right) =>
    left.localeCompare(right),
  );
  const actualPaths = [];
  for (const entry of value.files) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== 'string' ||
      !expectedPaths.includes(entry.path) ||
      typeof entry.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(entry.sha256)
    ) {
      throw new Error('MANIFEST_FILE_ENTRY_INVALID');
    }
    actualPaths.push(entry.path);
  }
  actualPaths.sort((left, right) => left.localeCompare(right));
  if (actualPaths.some((entry, index) => entry !== expectedPaths[index])) {
    throw new Error('MANIFEST_FILE_INVENTORY_INVALID');
  }
}

function assertSourceLock(value) {
  if (!isRecord(value)) throw new Error('SOURCE_LOCK_SHAPE_INVALID');
  assertEqual(value.schemaVersion, '1.0', 'SOURCE_LOCK_SCHEMA_VERSION_INVALID');
  assertEqual(value.contract, 'sdar-registry-v1', 'SOURCE_LOCK_CONTRACT_INVALID');
  if (!isRecord(value.sdar) || !isRecord(value.smppNativeRegistry)) {
    throw new Error('SOURCE_LOCK_REPOSITORY_SHAPE_INVALID');
  }
  assertEqual(value.sdar.repository, 'skill-driven-agent-runtime', 'SOURCE_LOCK_SDAR_REPO_INVALID');
  assertEqual(value.sdar.commit, EXPECTED_SDAR_COMMIT, 'SOURCE_LOCK_SDAR_COMMIT_INVALID');
  assertLockedEntries(value.sdar.algorithmFiles, EXPECTED_SDAR_BLOBS, 'SOURCE_LOCK_SDAR');
  assertEqual(
    value.smppNativeRegistry.repository,
    'sdar-mcp-provider-platform',
    'SOURCE_LOCK_SMPP_REPO_INVALID',
  );
  assertEqual(
    value.smppNativeRegistry.baselineCommit,
    EXPECTED_SMPP_BASELINE,
    'SOURCE_LOCK_SMPP_BASELINE_INVALID',
  );
  assertLockedEntries(
    value.smppNativeRegistry.authorityFiles,
    EXPECTED_SMPP_BLOBS,
    'SOURCE_LOCK_SMPP',
  );
}

function executeChecksumVectors(document, schema) {
  if (!isRecord(document) || !Array.isArray(document.vectors) || document.vectors.length !== 10) {
    throw new Error('CHECKSUM_VECTOR_INVENTORY_INVALID');
  }
  const Ajv2020 = Ajv2020Import.default ?? Ajv2020Import;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat(
    'date-time',
    (value) => /(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value) && Number.isFinite(Date.parse(value)),
  );
  ajv.addFormat('uri', (value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  });
  const validateProjection = ajv.compile(schema);
  const outcomes = new Map();
  for (const vector of document.vectors) {
    if (!isRecord(vector) || typeof vector.id !== 'string' || !isRecord(vector.input)) {
      throw new Error('CHECKSUM_VECTOR_SHAPE_INVALID');
    }
    if (typeof vector.expectedChecksum === 'string') {
      const checksum = computeProjectionChecksum(vector.input);
      assertEqual(checksum, vector.expectedChecksum, `CHECKSUM_VECTOR_MISMATCH:${vector.id}`);
      const projection = projectionFromInput(vector.input, checksum);
      if (!validateProjection(projection)) {
        throw new Error(`CHECKSUM_VECTOR_SCHEMA_REJECTED:${vector.id}`);
      }
      outcomes.set(vector.id, checksum);
    } else if (typeof vector.expectedErrorCode === 'string') {
      let errorCode;
      try {
        computeProjectionChecksum(vector.input);
      } catch (error) {
        errorCode = isRecord(error) ? error.code : undefined;
      }
      assertEqual(errorCode, vector.expectedErrorCode, `CHECKSUM_REJECTION_MISMATCH:${vector.id}`);
      if (validateProjection(projectionFromInput(vector.input, '0'.repeat(64)))) {
        throw new Error(`CHECKSUM_REJECTION_SCHEMA_ACCEPTED:${vector.id}`);
      }
    } else {
      throw new Error(`CHECKSUM_VECTOR_EXPECTATION_MISSING:${vector.id}`);
    }
  }
  for (const vector of document.vectors) {
    if (typeof vector.sameChecksumAs === 'string') {
      assertEqual(
        outcomes.get(vector.id),
        outcomes.get(vector.sameChecksumAs),
        `CHECKSUM_VECTOR_EQUALITY_MISMATCH:${vector.id}`,
      );
    }
    if (
      typeof vector.differentChecksumFrom === 'string' &&
      outcomes.get(vector.id) === outcomes.get(vector.differentChecksumFrom)
    ) {
      throw new Error(`CHECKSUM_VECTOR_DIFFERENCE_MISMATCH:${vector.id}`);
    }
    if (
      vector.id === 'catalog-revision-number-to-string' &&
      (!isRecord(vector.mappingInput) ||
        String(vector.mappingInput.catalogRevision) !== vector.expectedProjectedCatalogRevision)
    ) {
      throw new Error('CHECKSUM_VECTOR_CATALOG_MAPPING_MISMATCH');
    }
    if (vector.id === 'normalized-endpoint') {
      if (
        !isRecord(vector.mappingInput) ||
        typeof vector.mappingInput.effectiveEndpoint !== 'string' ||
        normalizeEndpoint(vector.mappingInput.effectiveEndpoint) !==
          vector.expectedNormalizedEndpoint
      ) {
        throw new Error('CHECKSUM_VECTOR_ENDPOINT_MAPPING_MISMATCH');
      }
    }
  }
  return document.vectors.length;
}

function computeProjectionChecksum(input) {
  assertExactKeys(input, ['smppSourceId', 'revision', 'generatedAt', 'expiresAt', 'candidates']);
  if (
    typeof input.smppSourceId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.smppSourceId) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    typeof input.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(input.generatedAt)) ||
    typeof input.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= Date.parse(input.generatedAt) ||
    !Array.isArray(input.candidates)
  ) {
    throw projectionError('SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID');
  }
  const candidates = input.candidates
    .map(normalizeCandidate)
    .sort((left, right) =>
      `${input.smppSourceId}::${left.externalProviderId}::${left.externalServerId}`.localeCompare(
        `${input.smppSourceId}::${right.externalProviderId}::${right.externalServerId}`,
      ),
    );
  const identities = candidates.map(
    (candidate) =>
      `${input.smppSourceId}::${candidate.externalProviderId}::${candidate.externalServerId}`,
  );
  if (new Set(identities).size !== identities.length) {
    throw projectionError('SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID');
  }
  return sha256(
    Buffer.from(
      canonicalJson({
        smppSourceId: input.smppSourceId,
        revision: input.revision,
        generatedAt: input.generatedAt,
        expiresAt: input.expiresAt,
        candidates,
      }),
      'utf8',
    ),
  );
}

function normalizeCandidate(value) {
  if (!isRecord(value)) throw projectionError('SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID');
  assertExactKeys(value, [
    'externalProviderId',
    'externalServerId',
    'serverEndpoint',
    'catalogRevision',
    'labels',
  ]);
  if (
    typeof value.externalProviderId !== 'string' ||
    value.externalProviderId.length < 1 ||
    value.externalProviderId.length > 256 ||
    typeof value.externalServerId !== 'string' ||
    value.externalServerId.length < 1 ||
    value.externalServerId.length > 256 ||
    typeof value.serverEndpoint !== 'string' ||
    typeof value.catalogRevision !== 'string' ||
    !/^[1-9][0-9]*$/u.test(value.catalogRevision) ||
    !isRecord(value.labels)
  ) {
    throw projectionError('SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID');
  }
  assertExactKeys(value.labels, ['environment', 'protocolMode']);
  if (
    typeof value.labels.environment !== 'string' ||
    !/^[a-z][a-z0-9-]{0,62}$/u.test(value.labels.environment) ||
    value.labels.protocolMode !== 'frozen_v1'
  ) {
    throw projectionError('SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID');
  }
  return {
    externalProviderId: value.externalProviderId,
    externalServerId: value.externalServerId,
    serverEndpoint: normalizeEndpoint(value.serverEndpoint),
    catalogRevision: value.catalogRevision,
    labels: {
      environment: value.labels.environment,
      protocolMode: value.labels.protocolMode,
    },
  };
}

function normalizeEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw projectionError('SDAR_REGISTRY_PROJECTION_ENDPOINT_INVALID');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username !== '' ||
    endpoint.password !== ''
  ) {
    throw projectionError('SDAR_REGISTRY_PROJECTION_ENDPOINT_INVALID');
  }
  endpoint.hash = '';
  return endpoint.toString().replace(/\/$/u, '');
}

function projectionFromInput(input, checksum) {
  return {
    revision: input.revision,
    checksum,
    generatedAt: input.generatedAt,
    expiresAt: input.expiresAt,
    providers: input.candidates,
  };
}

function assertExactKeys(value, expected) {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const canonicalExpected = [...expected].sort((left, right) => left.localeCompare(right));
  if (
    actual.length !== canonicalExpected.length ||
    actual.some((entry, index) => entry !== canonicalExpected[index])
  ) {
    throw projectionError('SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID');
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function projectionError(code) {
  return Object.assign(new Error(code), { code });
}

function assertLockedEntries(value, expected, errorPrefix) {
  if (!Array.isArray(value) || value.length !== expected.size) {
    throw new Error(`${errorPrefix}_FILE_COUNT_INVALID`);
  }
  const actual = new Map();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== 'string' ||
      typeof entry.sha256 !== 'string' ||
      actual.has(entry.path)
    ) {
      throw new Error(`${errorPrefix}_ENTRY_INVALID`);
    }
    actual.set(entry.path, entry.sha256);
  }
  for (const [lockedPath, expectedDigest] of expected) {
    assertEqual(
      actual.get(lockedPath),
      expectedDigest,
      `${errorPrefix}_HASH_INVALID:${lockedPath}`,
    );
  }
}

async function assertAssetInventory(root, prefix) {
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) throw new Error(`${prefix}_NON_FILE_ASSET_INVALID`);
  const actual = entries
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const expected = [...ASSET_NAMES].sort((left, right) => left.localeCompare(right));
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(`${prefix}_ASSET_INVENTORY_INVALID`);
  }
}

function readGitBlob(repositoryRoot, commit, relativePath, authority) {
  const result = spawnSync('git', ['cat-file', 'blob', `${commit}:${relativePath}`], {
    cwd: repositoryRoot,
    encoding: null,
    windowsHide: true,
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(`${authority}_LOCKED_BLOB_UNAVAILABLE:${relativePath}`);
  }
  return result.stdout;
}

function parseJson(content, errorCode) {
  try {
    return JSON.parse(content.toString('utf8'));
  } catch {
    throw new Error(errorCode);
  }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function assertEqual(actual, expected, errorCode) {
  if (actual !== expected) throw new Error(errorCode);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
