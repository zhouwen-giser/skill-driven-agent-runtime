import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { stdout } from 'node:process';

const registryPath = path.resolve('schemas/evidence/v1/registry.json');
const matrixPath = path.resolve('reports/v1.4.1-evidence/source-to-evidence-matrix.json');
const proofPath = path.resolve('reports/v1.4.1-evidence/verification-proof-manifest.json');
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
const proof = JSON.parse(await readFile(proofPath, 'utf8'));
const fileContents = new Map();

const registryRecords = requireRecords(registry, 'registry');
const matrixRecords = requireRecords(matrix, 'matrix');
const proofRecords = requireRecords(proof, 'verification proof');
assertExactCount(registryRecords, 'registry');
assertExactCount(matrixRecords, 'matrix');
assertExactCount(proofRecords, 'verification proof');

if (matrix.contract !== registry.contractVersion) {
  fail(`contract mismatch: registry=${registry.contractVersion} matrix=${matrix.contract}`);
}
if (matrix.registryHash !== registry.registryHash) {
  fail(`registryHash mismatch: registry=${registry.registryHash} matrix=${matrix.registryHash}`);
}
if (proof.contract !== registry.contractVersion) {
  fail(`proof contract mismatch: registry=${registry.contractVersion} proof=${proof.contract}`);
}
if (
  matrix.verificationProof !== 'reports/v1.4.1-evidence/verification-proof-manifest.json' ||
  matrix.verificationProofVersion !== proof.schemaVersion
) {
  fail('matrix does not identify the current verification proof manifest');
}

const registryByType = uniqueByRecordType(registryRecords, 'registry', 'recordType');
const matrixByType = uniqueByRecordType(matrixRecords, 'matrix', 'record_type');
const proofByType = uniqueByRecordType(proofRecords, 'verification proof', 'recordType');
const proofAnchors = new Set();
if (
  typeof proof.profiles !== 'object' ||
  proof.profiles === null ||
  Array.isArray(proof.profiles)
) {
  fail('verification proof profiles must be an object');
}

const alignments = [
  ['sourceSystem', 'source_system'],
  ['sourceTable', 'source_table_or_aggregate'],
  ['authority', 'source_authority'],
  ['recordFamily', 'record_family'],
  ['evaluationRole', 'evaluation_role'],
  ['deliveryGuarantee', 'delivery_guarantee'],
  ['schemaName', 'schema_name'],
  ['schemaVersion', 'schema_version'],
  ['schemaPath', 'schema_path'],
  ['schemaHash', 'schema_hash'],
  ['mapper', 'mapper'],
];

for (const [recordType, catalog] of registryByType) {
  const inventory = matrixByType.get(recordType);
  if (inventory === undefined) fail(`${recordType}: missing from source matrix`);
  const recordProof = proofByType.get(recordType);
  if (recordProof === undefined) fail(`${recordType}: missing from verification proof`);
  for (const [catalogField, matrixField] of alignments) {
    if (inventory[matrixField] !== catalog[catalogField]) {
      fail(
        `${recordType}: ${matrixField} mismatch: registry=${JSON.stringify(catalog[catalogField])} matrix=${JSON.stringify(inventory[matrixField])}`,
      );
    }
  }
  const expectedReferences = catalog.expectedReferences.join(',');
  if (inventory.required_references !== expectedReferences) {
    fail(
      `${recordType}: required_references mismatch: registry=${JSON.stringify(expectedReferences)} matrix=${JSON.stringify(inventory.required_references)}`,
    );
  }
  if (inventory.status !== 'implemented_and_verified') {
    fail(`${recordType}: status must be implemented_and_verified, found ${inventory.status}`);
  }
  if (recordProof.verificationStatus !== inventory.status) {
    fail(
      `${recordType}: matrix status is not derived from its verification proof: proof=${recordProof.verificationStatus} matrix=${inventory.status}`,
    );
  }
  await verifyRecordProof(recordType, recordProof, proof.profiles);
}

for (const recordType of matrixByType.keys()) {
  if (!registryByType.has(recordType))
    fail(`${recordType}: source matrix record is absent from registry`);
}
for (const recordType of proofByType.keys()) {
  if (!registryByType.has(recordType)) {
    fail(`${recordType}: verification proof record is absent from registry`);
  }
}

const required = registryRecords.filter(({ evaluationRole }) => evaluationRole === 'required');
const diagnostic = registryRecords.filter(({ evaluationRole }) => evaluationRole === 'diagnostic');
const durable = registryRecords.filter(
  ({ deliveryGuarantee }) => deliveryGuarantee === 'durable_projection',
);
assertPolicyCount(required, 100, 'Required');
assertPolicyCount(diagnostic, 5, 'Diagnostic');
assertPolicyCount(durable, 105, 'durable_projection');

const verifiedRequired = matrixRecords.filter(
  ({ evaluation_role, status }) =>
    evaluation_role === 'required' && status === 'implemented_and_verified',
);
const verifiedDiagnostic = matrixRecords.filter(
  ({ evaluation_role, status }) =>
    evaluation_role === 'diagnostic' && status === 'implemented_and_verified',
);
assertPolicyCount(verifiedRequired, 100, 'implemented Required');
assertPolicyCount(verifiedDiagnostic, 5, 'implemented Diagnostic');

stdout.write(
  `${JSON.stringify({ total: 105, unique: 105, implementedAndVerified: 105, required: '100/100', diagnostic: '5/5', durableProjection: '105/105' })}\n`,
);

function requireRecords(document, label) {
  if (!Array.isArray(document.records)) fail(`${label}.records must be an array`);
  return document.records;
}

function assertExactCount(records, label) {
  if (records.length !== 105)
    fail(`${label} must contain exactly 105 records, found ${records.length}`);
}

function uniqueByRecordType(records, label, field) {
  const byType = new Map();
  for (const record of records) {
    const recordType = record[field];
    if (typeof recordType !== 'string' || recordType.length === 0) {
      fail(`${label} contains a record without ${field}`);
    }
    if (byType.has(recordType)) fail(`${label} contains duplicate recordType ${recordType}`);
    byType.set(recordType, record);
  }
  return byType;
}

function assertPolicyCount(records, expected, label) {
  if (records.length !== expected)
    fail(`${label} count must be ${expected}, found ${records.length}`);
}

async function verifyRecordProof(recordType, recordProof, profiles) {
  if (typeof recordProof.profile !== 'string' || recordProof.profile.length === 0) {
    fail(`${recordType}: proof profile is missing`);
  }
  const profile = profiles[recordProof.profile];
  if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) {
    fail(`${recordType}: unknown proof profile ${recordProof.profile}`);
  }
  const sourceFiles = requireFileList(profile, 'sourceFiles', recordType);
  const projectorFiles = requireFileList(profile, 'projectorFiles', recordType);
  const mapperFiles = requireFileList(profile, 'mapperFiles', recordType);
  const storeFiles = requireFileList(profile, 'storeFiles', recordType);
  const sourceAnchor = requireAnchor(recordProof.sourceAnchor, recordType, 'sourceAnchor');
  const mapperAnchor = requireAnchor(recordProof.mapperAnchor, recordType, 'mapperAnchor');
  const proofIdentity = `${recordProof.profile}\u0000${sourceAnchor}\u0000${mapperAnchor}`;
  if (proofAnchors.has(proofIdentity)) {
    fail(`${recordType}: source and mapper anchor pair is not unique`);
  }
  proofAnchors.add(proofIdentity);

  await requireMarker(sourceFiles, sourceAnchor, recordType, 'source query/symbol');
  await requireMarker(
    projectorFiles,
    requireAnchor(profile.projectorAnchor, recordType, 'projectorAnchor'),
    recordType,
    'projector',
  );
  await requireMarker(mapperFiles, mapperAnchor, recordType, 'mapper branch/function');
  await requireMarker(
    storeFiles,
    requireAnchor(profile.storeAnchor, recordType, 'storeAnchor'),
    recordType,
    'PostgreSQL store',
  );
  await requireMarker(
    [requirePath(profile.focusedTestFile, recordType, 'focusedTestFile')],
    requireAnchor(profile.focusedTestAnchor, recordType, 'focusedTestAnchor'),
    recordType,
    'focused test',
  );
  await requireMarker(
    [requirePath(profile.phaseEvidenceFile, recordType, 'phaseEvidenceFile')],
    requireAnchor(profile.phaseEvidenceAnchor, recordType, 'phaseEvidenceAnchor'),
    recordType,
    'phase evidence',
  );
}

function requireFileList(profile, field, recordType) {
  const files = profile[field];
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.some((file) => typeof file !== 'string' || file.length === 0)
  ) {
    fail(`${recordType}: ${field} must contain at least one file`);
  }
  return files;
}

async function requireMarker(files, marker, recordType, evidenceKind) {
  const contents = await Promise.all(files.map((file) => readProofFile(file, recordType)));
  if (!contents.some((content) => content.includes(marker))) {
    fail(`${recordType}: ${evidenceKind} files do not contain marker ${marker}`);
  }
}

function requireAnchor(value, recordType, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${recordType}: ${field} must be non-empty`);
  }
  if (value === recordType) {
    fail(`${recordType}: ${field} cannot be the bare recordType`);
  }
  return value;
}

function requirePath(value, recordType, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${recordType}: ${field} must identify one file`);
  }
  return value;
}

async function readProofFile(file, recordType) {
  const repositoryRoot = path.resolve('.');
  const resolved = path.resolve(file);
  if (!resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    fail(`${recordType}: proof path escapes repository root: ${file}`);
  }
  if (!fileContents.has(resolved)) {
    try {
      fileContents.set(resolved, await readFile(resolved, 'utf8'));
    } catch (error) {
      fail(
        `${recordType}: proof file cannot be read: ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return fileContents.get(resolved);
}

function fail(message) {
  throw new Error(`EVIDENCE_COVERAGE_INVALID: ${message}`);
}
