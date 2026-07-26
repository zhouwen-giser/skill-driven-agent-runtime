import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const packageRoot = path.join(
  root,
  'docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/packages/SDAR_v1.3_P00_Codex_Goal_Package_V1.1',
);
const lock = readJson(path.join(packageRoot, 'CONTRACT-LOCK.json'));
const template = readJson(path.join(packageRoot, 'templates/STANDARD-HANDOFF.json'));
const actual = readJson(path.join(root, 'reports/goal/v1.3-p00-actual-contract.json'));
const handoff = readJson(path.join(root, 'reports/goal/v1.3-p00-handoff.json'));
const matrix = readJson(path.join(root, 'reports/goal/v1.3-p00-prerequisite-matrix.json'));

assertExactKeys(handoff, Object.keys(template), 'HANDOFF_TOP_LEVEL_FIELDS');
assert(handoff.packageId === lock.packageId, 'HANDOFF_PACKAGE_ID');
assert(handoff.contractRegistryVersion === lock.registryVersion, 'HANDOFF_REGISTRY_VERSION');
assert(handoff.contractRegistrySha256 === lock.registrySha256, 'HANDOFF_REGISTRY_HASH');
assert(
  ['READY_FULL', 'BLOCKED_BASELINE'].includes(handoff.status),
  'HANDOFF_STATUS_NOT_ALLOWED',
);

const expectedConsumed = Object.values(lock.consumedContracts);
assertContractMetadata(handoff.consumedContracts, expectedConsumed, 'HANDOFF_CONSUMED');
const expectedProduced = Object.values(lock.producedContracts);
assertContractMetadata(handoff.producedContracts, expectedProduced, 'HANDOFF_PRODUCED');
assertExactKeys(actual.contracts, Object.keys(lock.producedContracts), 'ACTUAL_CONTRACT_NAMES');
assertExactKeys(
  handoff.packageOutputs,
  Object.keys(lock.producedContracts),
  'HANDOFF_PACKAGE_OUTPUT_NAMES',
);

for (const [name, contract] of Object.entries(lock.producedContracts)) {
  const actualContract = actual.contracts[name];
  assert(actualContract.version === contract.version, `ACTUAL_VERSION:${name}`);
  assert(actualContract.schemaHash === contract.schemaHash, `ACTUAL_SCHEMA_HASH:${name}`);
  assertExactKeys(actualContract.value, contract.fields, `ACTUAL_FIELDS:${name}`);

  const output = handoff.packageOutputs[name];
  assert(output.contractVersion === contract.version, `OUTPUT_VERSION:${name}`);
  assert(output.schemaHash === contract.schemaHash, `OUTPUT_SCHEMA_HASH:${name}`);
  assert(Array.isArray(output.refs) && output.refs.length > 0, `OUTPUT_REFS:${name}`);
  validatePaths(output.refs, `OUTPUT_REF:${name}`);
}

assert(
  actual.contracts.BaselineGateResult.value.status === handoff.status,
  'BASELINE_STATUS_MISMATCH',
);
assert(matrix.decision === handoff.status, 'MATRIX_DECISION_MISMATCH');
assert(
  actual.contracts.V123PrerequisiteMatrix.value.decision === handoff.status,
  'ACTUAL_MATRIX_DECISION_MISMATCH',
);
assert(
  JSON.stringify(actual.contracts.V123PrerequisiteMatrix.value.items) ===
    JSON.stringify(matrix.items.map((item) => item.id)),
  'ACTUAL_MATRIX_ITEMS_MISMATCH',
);

if (handoff.status === 'READY_FULL') {
  assert(handoff.openBlockers.length === 0, 'READY_HANDOFF_HAS_BLOCKERS');
  assert(
    actual.contracts.BaselineGateResult.value.openBlockers.length === 0,
    'READY_CONTRACT_HAS_BLOCKERS',
  );
} else {
  assert(handoff.openBlockers.length > 0, 'BLOCKED_HANDOFF_MISSING_BLOCKER');
  assert(
    actual.contracts.BaselineGateResult.value.openBlockers.length > 0,
    'BLOCKED_CONTRACT_MISSING_BLOCKER',
  );
}

validatePaths(handoff.evidenceRefs, 'HANDOFF_EVIDENCE_REF');
for (const item of matrix.items) {
  assert(['verified', 'blocked'].includes(item.status), `MATRIX_ITEM_STATUS:${item.id}`);
  validatePaths(item.implementationRefs, `MATRIX_IMPLEMENTATION_REF:${item.id}`);
  validatePaths(item.testRefs, `MATRIX_TEST_REF:${item.id}`);
  validatePaths(item.evidenceRefs, `MATRIX_EVIDENCE_REF:${item.id}`);
}

for (const [name, commit] of Object.entries(handoff.commits)) {
  assert(typeof commit === 'string' && /^[0-9a-f]{7,40}$/u.test(commit), `COMMIT_SHA:${name}`);
  execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root, stdio: 'ignore' });
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      packageId: handoff.packageId,
      status: handoff.status,
      handoffFields: Object.keys(handoff).length,
      contracts: Object.keys(actual.contracts),
      matrixItems: matrix.items.length,
      openBlockers: handoff.openBlockers.length,
    },
    null,
    2,
  )}\n`,
);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertContractMetadata(actualContracts, expectedContracts, code) {
  assert(actualContracts.length === expectedContracts.length, `${code}_COUNT`);
  for (const expected of expectedContracts) {
    const found = actualContracts.find((candidate) => candidate.name === expected.name);
    assert(found !== undefined, `${code}_NAME:${expected.name}`);
    assert(found.version === expected.version, `${code}_VERSION:${expected.name}`);
    assert(found.schemaHash === expected.schemaHash, `${code}_HASH:${expected.name}`);
  }
}

function assertExactKeys(value, expected, code) {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  assert(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys), code);
}

function validatePaths(refs, code) {
  for (const ref of refs) {
    if (ref === 'v1.2.3-final') {
      execFileSync('git', ['rev-parse', '--verify', ref], { cwd: root, stdio: 'ignore' });
      continue;
    }
    assert(fs.existsSync(path.join(root, ref)), `${code}:${ref}`);
  }
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}
