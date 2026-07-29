import { access, readFile } from 'node:fs/promises';
import process from 'node:process';

const packageRoot =
  'docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/packages/SDAR_v1.3_P01_Codex_Goal_Package_V1.1';
const handoffPath = 'reports/goal/v1.3-p01-handoff.json';
const templatePath = `${packageRoot}/templates/STANDARD-HANDOFF.json`;
const lockPath = `${packageRoot}/CONTRACT-LOCK.json`;

const [handoff, template, lock, contractsSource, fixture, verification, traceability, completion] =
  await Promise.all([
    readJson(handoffPath),
    readJson(templatePath),
    readJson(lockPath),
    readFile('packages/domain/src/compiler/contracts.ts', 'utf8'),
    readJson('schemas/v1.3/fixtures/artifact-domain.golden.json'),
    readJson('reports/v1.3-orchestration/p01-verification-summary.json'),
    readFile('docs/17_TRACEABILITY_MATRIX.md', 'utf8'),
    readFile('reports/goal/v1.3-p01-completion.md', 'utf8'),
  ]);

const expectedTopFields = lock.handoffEnvelope.fields;
assertArray(expectedTopFields, 'lock handoff fields');
assertExactKeys(handoff, expectedTopFields, 'HandoffEnvelope');
assert(handoff.schemaVersion === '1.1', 'handoff schemaVersion');
assert(handoff.packageId === 'SDAR-V1.3-P01', 'handoff packageId');
assert(handoff.packageVersion === '1.1', 'handoff packageVersion');
assert(handoff.sequence === 1, 'handoff sequence');
assert(['READY_REVIEW', 'READY_FULL'].includes(handoff.status), 'handoff status');
assert(
  handoff.contractRegistrySha256 ===
    'd7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb',
  'registry hash',
);
assertJsonEqual(handoff.consumedContracts, template.consumedContracts, 'consumed contracts');
assertJsonEqual(handoff.producedContracts, template.producedContracts, 'produced contracts');
assertExactKeys(
  handoff.packageOutputs,
  Object.keys(template.packageOutputs),
  'packageOutputs contracts',
);
for (const contract of template.producedContracts) {
  const output = handoff.packageOutputs[contract.name];
  assert(output.contractVersion === contract.version, `${contract.name} version`);
  assert(output.schemaHash === contract.schemaHash, `${contract.name} schema hash`);
  assertArray(output.refs, `${contract.name} refs`);
  assert(output.refs.length > 0, `${contract.name} refs non-empty`);
  assert(
    contractsSource.includes(contract.schemaHash),
    `${contract.name} hash absent from Domain source`,
  );
}

assertJsonEqual(handoff.migrations, [], 'no migrations');
assertJsonEqual(handoff.repositoryPorts, [], 'no repository ports');
assertJsonEqual(handoff.applicationPorts, [], 'no application ports');
assertJsonEqual(handoff.runtimePorts, [], 'no runtime ports');
assertJsonEqual(handoff.events, [], 'no events');
assertJsonEqual(handoff.queues, [], 'no queues');
assertJsonEqual(handoff.featureFlags, [], 'no feature flags');
assert(handoff.reasonCodeCatalogVersion === '', 'no reason-code catalog version');
assert(handoff.acceptanceSummary.failed === 0, 'zero failed acceptance');
assert(
  handoff.acceptanceSummary.passed + handoff.acceptanceSummary.blocked === 9,
  'nine acceptance rows',
);
if (handoff.status === 'READY_FULL') {
  assert(handoff.acceptanceSummary.passed === 9, 'nine passed acceptance rows');
  assert(handoff.acceptanceSummary.blocked === 0, 'zero blocked acceptance');
  assertJsonEqual(handoff.openBlockers, [], 'zero blockers');
} else {
  assert(handoff.acceptanceSummary.blocked > 0, 'review state must retain a blocker');
  assert(handoff.openBlockers.length > 0, 'review state must name its blocker');
}
assert(handoff.nextPackage === 'P02', 'next package P02');

const artifactTypes = fixture.artifacts.map((artifact) => artifact.artifactType);
assertJsonEqual(artifactTypes, lock.artifactTypes, 'golden artifact type coverage');
assert(['passed', 'superseded'].includes(verification.status), 'verification status');
assert(verification.results.unitAndContract.passed === 785, 'unit/contract count');
assert(verification.results.realIntegration.passed === 84, 'integration count');
assert(verification.results.realE2E.passed === 62, 'E2E count');
assert(verification.results.a2aMust.passed === 74, 'A2A MUST count');
assert(verification.results.postBaselineMigrations === 17, 'migration count');
assert(
  traceability
    .split('\n')
    .filter((line) => line.startsWith('| G01 ') && !line.startsWith('| G01 acceptance')).length ===
    9,
  'traceability must contain nine G01 acceptance rows',
);
assert(
  completion.includes('Status: `READY_REVIEW`') || completion.includes('Status: `READY_FULL`'),
  'completion status',
);

const refs = new Set([
  ...handoff.evidenceRefs,
  ...Object.values(handoff.packageOutputs).flatMap((output) => output.refs),
]);
for (const ref of refs) await access(ref);

if (handoff.status === 'READY_FULL') {
  assert(/^[0-9a-f]{40}$/u.test(handoff.commits.completion), 'completion commit');
  assert(handoff.evidenceRefs.includes('reports/goal/v1.3-p01-review.md'), 'review evidence ref');
  assert(verification.dirty === false, 'clean verification required');
  assert(
    verification.verificationCommit === handoff.commits.completion,
    'verification commit match',
  );
}

process.stdout.write(
  `P01 evidence verified: ${String(expectedTopFields.length)} exact Handoff fields, ${String(template.producedContracts.length)} frozen outputs, 9 acceptance rows, ${String(handoff.openBlockers.length)} blocker(s).\n`,
);

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function assertArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assertJsonEqual(actual, wanted, `${label} fields`);
}

function assertJsonEqual(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} mismatch`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`P01_EVIDENCE_INVALID: ${message}`);
}
