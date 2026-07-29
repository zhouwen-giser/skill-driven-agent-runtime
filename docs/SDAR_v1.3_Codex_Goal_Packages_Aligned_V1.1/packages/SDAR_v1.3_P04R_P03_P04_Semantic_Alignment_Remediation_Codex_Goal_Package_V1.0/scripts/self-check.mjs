import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'README.md','CODEX-GOAL-PROMPT.md','MASTER-GOAL.md','EXECUTION-POLICY.md',
  'SCOPE.md','DEPENDENCY.md','FINDINGS-TO-CLOSE.md',
  'ACTIVITY-IDENTITY-CONTRACT.md','PROCESS-MINING-SEMANTICS-CONTRACT.md',
  'GENERALIZATION-SAFETY-CONTRACT.md',
  'PLAN-TEMPLATE-COMPILER-ALIGNMENT-CONTRACT.md',
  'CANDIDATE-GENERATION-RUNTIME-CONTRACT.md',
  'INTERFACE-VERSION-MIGRATION-CONTRACT.md','P05-CONSUMER-ALIGNMENT.md',
  'BUNDLE-INTEGRATION-PATCH.md','IMPLEMENTATION.md','ACCEPTANCE.md',
  'TEST-PLAN.md','EVIDENCE.md','HANDOFF.md','PACKAGE-CONSISTENCY-REVIEW.md',
  'CONTRACT-LOCK.json','manifest.json','schema-hashes.json',
  'bundle-patch/BUNDLE-INTEGRATION-PATCH.json',
  'templates/P04R-COMPLETION-REPORT.md','templates/P04R-HANDOFF.json',
  'schemas/experience-activity-ref-1.2.schema.json',
  'schemas/experience-trace-event-1.2.schema.json',
  'schemas/process-variant-1.2.schema.json',
  'schemas/workflow-pattern-1.2.schema.json',
  'schemas/fused-pattern-1.2.schema.json',
  'schemas/generalized-pattern-1.2.schema.json',
  'schemas/candidate-static-validation-result-1.2.schema.json',
  'SHA256SUMS.json'
];

const missing = required.filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) throw new Error(`Missing files: ${missing.join(', ')}`);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.packageId !== 'SDAR-V1.3-P04R') throw new Error('package id drift');
if (manifest.sequenceLabel !== 'P04R' || manifest.sortOrder !== 4.5) throw new Error('sequence drift');
if (manifest.packageClass !== 'mandatory_remediation') throw new Error('class drift');
if (manifest.formalPackage !== false) throw new Error('formal package count drift');
if (manifest.mandatoryReleaseGate !== true) throw new Error('release gate drift');
if (manifest.newAtomicGoal !== false) throw new Error('G23 drift');
if (manifest.originalFormalProductPackageCount !== 14) throw new Error('original formal count drift');
if (manifest.remediatesGoals.join(',') !== 'G05,G06,G07,G08') throw new Error('goal remediation drift');
if (manifest.nextPackage !== 'P05') throw new Error('next package drift');

const lock = JSON.parse(fs.readFileSync(path.join(root, 'CONTRACT-LOCK.json'), 'utf8'));
if (lock.targetContractRegistryVersion !== '1.2') throw new Error('registry target drift');
if (lock.targetContractRegistrySha256 !== '8aa828faf544b2cad3d3eb72bfc0935b02ba324a517de1563308862fc7d60dee') {
  throw new Error('registry target hash drift');
}

for (const item of lock.produces) {
  const schema = JSON.parse(fs.readFileSync(path.join(root, item.schemaFile), 'utf8'));
  const canonical = JSON.stringify(sortValue(schema));
  const actual = crypto.createHash('sha256').update(canonical).digest('hex');
  if (actual !== item.schemaHash) throw new Error(`schema hash mismatch: ${item.name}`);
}

const patch = JSON.parse(fs.readFileSync(
  path.join(root, 'bundle-patch/BUNDLE-INTEGRATION-PATCH.json'), 'utf8'
));
if (patch.insert.after !== 'P04' || patch.insert.before !== 'P05') {
  throw new Error('bundle order drift');
}
if (patch.insert.mandatoryReleaseGate !== true || patch.insert.newAtomicGoal !== false) {
  throw new Error('bundle class drift');
}
if (patch.counts.formalProductPackages !== 14 ||
    patch.counts.mandatoryRemediationPackages !== 1 ||
    patch.counts.optionalPostReleasePackages !== 1) {
  throw new Error('bundle counts drift');
}

const acceptance = fs.readFileSync(path.join(root, 'ACCEPTANCE.md'), 'utf8');
if (!acceptance.includes('P05 尚未实现')) throw new Error('P05 scope guard missing');
if (!acceptance.includes('P03 Handoff=COMPLETED')) throw new Error('P03 closure missing');
if (!acceptance.includes('P04 Handoff=COMPLETED')) throw new Error('P04 closure missing');

const allDocs = required.filter((f) => f.endsWith('.md')).map(
  (f) => fs.readFileSync(path.join(root, f), 'utf8')
).join('\n');
for (const forbidden of [
  'P04R creates G23',
  'P04R implements P05 replay',
  'lifecycle event type is the activity key',
  'Redis is the candidate authority'
]) {
  if (allDocs.includes(forbidden)) throw new Error(`forbidden claim: ${forbidden}`);
}

const sums = JSON.parse(fs.readFileSync(path.join(root, 'SHA256SUMS.json'), 'utf8'));
for (const [rel, expected] of Object.entries(sums.files)) {
  const actual = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, rel))).digest('hex');
  if (actual !== expected) throw new Error(`file hash mismatch: ${rel}`);
}

console.log(JSON.stringify({
  ok: true,
  packageId: manifest.packageId,
  packageClass: manifest.packageClass,
  position: 'P04 -> P04R -> P05',
  formalPackage: manifest.formalPackage,
  mandatoryReleaseGate: manifest.mandatoryReleaseGate,
  newAtomicGoal: manifest.newAtomicGoal,
  remediatesGoals: manifest.remediatesGoals,
  targetRegistryVersion: lock.targetContractRegistryVersion,
  schemaContracts: lock.produces.map(({name, version, schemaHash}) => ({name, version, schemaHash})),
  nextPackage: manifest.nextPackage,
  filesChecked: Object.keys(sums.files).length
}, null, 2));

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([a],[b]) => a.localeCompare(b))
        .map(([k,v]) => [k, sortValue(v)])
    );
  }
  return value;
}
