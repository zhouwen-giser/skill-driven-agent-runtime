import { access, readFile } from 'node:fs/promises';
import process from 'node:process';

const packageRoot =
  'docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/packages/SDAR_v1.3_P02_Codex_Goal_Package_V1.1';
const [handoff, template, lock, verification, completion, review] = await Promise.all([
  readJson('reports/goal/v1.3-p02-handoff.json'),
  readJson(`${packageRoot}/templates/STANDARD-HANDOFF.json`),
  readJson(`${packageRoot}/CONTRACT-LOCK.json`),
  readJson('reports/v1.3-orchestration/p02-verification-summary.json'),
  readFile('reports/goal/v1.3-p02-completion.md', 'utf8'),
  readFile('reports/goal/v1.3-p02-review.md', 'utf8'),
]);

assertExactKeys(handoff, lock.handoffEnvelope.fields, 'HandoffEnvelope');
assert(handoff.schemaVersion === '1.1', 'handoff schemaVersion');
assert(handoff.packageId === 'SDAR-V1.3-P02', 'handoff packageId');
assert(handoff.packageVersion === '1.1', 'handoff packageVersion');
assert(handoff.sequence === 2, 'handoff sequence');
assert(handoff.status === 'COMPLETED', 'handoff status');
assert(handoff.contractRegistrySha256 === lock.registrySha256, 'registry hash');
assertJsonEqual(handoff.consumedContracts, template.consumedContracts, 'consumed contracts');
assertJsonEqual(handoff.producedContracts, template.producedContracts, 'produced contracts');
assertExactKeys(handoff.packageOutputs, Object.keys(template.packageOutputs), 'packageOutputs');
for (const contract of template.producedContracts) {
  const output = handoff.packageOutputs[contract.name];
  assert(output.contractVersion === contract.version, `${contract.name} version`);
  assert(output.schemaHash === contract.schemaHash, `${contract.name} schema hash`);
  assert(Array.isArray(output.refs) && output.refs.length > 0, `${contract.name} refs`);
}

assertJsonEqual(handoff.migrations, ['0125_v13_artifact_authority'], 'migration');
assertJsonEqual(
  handoff.repositoryPorts,
  ['ArtifactRepository', 'ArtifactValidationRepository', 'ArtifactExecutionRepository'],
  'repository ports',
);
assertJsonEqual(
  handoff.applicationPorts,
  ['ArtifactRegistryService', 'OperatorIdentityPort', 'ArtifactGovernancePort'],
  'application ports',
);
assertJsonEqual(handoff.runtimePorts, [], 'runtime ports');
assertJsonEqual(handoff.events, lock.events, 'events');
assertJsonEqual(handoff.queues, lock.queues, 'queues');
assertJsonEqual(handoff.featureFlags, Object.keys(lock.featureFlags), 'feature flags');
assert(handoff.reasonCodeCatalogVersion === '', 'reason-code catalog');
assertJsonEqual(handoff.acceptanceSummary, { passed: 7, failed: 0, blocked: 0 }, 'acceptance');
assertJsonEqual(handoff.openBlockers, [], 'open blockers');
assert(handoff.nextPackage === 'P03', 'next package');
assert(/^[0-9a-f]{40}$/u.test(handoff.commits.completion), 'completion commit');
assert(verification.status === 'passed' && verification.dirty === false, 'clean verification');
assert(verification.verificationCommit === handoff.commits.completion, 'verification commit');
assert(verification.results.unitAndContract.passed === 795, 'unit/contract count');
assert(verification.results.realIntegration.passed === 92, 'integration count');
assert(verification.results.realE2E.passed === 62, 'E2E count');
assert(verification.results.postBaselineMigrations === 18, 'migration count');
assert(completion.includes('Status: `COMPLETED`'), 'completion status');
assert(review.includes('Decision: `ACCEPTED`'), 'accepted review');

const refs = new Set([
  ...handoff.evidenceRefs,
  ...Object.values(handoff.packageOutputs).flatMap((output) => output.refs),
]);
for (const ref of refs) await access(ref);

process.stdout.write(
  `P02 evidence verified: ${String(lock.handoffEnvelope.fields.length)} exact Handoff fields, ` +
    `${String(template.producedContracts.length)} frozen outputs, 7 acceptance rows, zero blockers.\n`,
);

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function assertExactKeys(value, expected, label) {
  assertJsonEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields`);
}

function assertJsonEqual(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} mismatch`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`P02_EVIDENCE_INVALID: ${message}`);
}
