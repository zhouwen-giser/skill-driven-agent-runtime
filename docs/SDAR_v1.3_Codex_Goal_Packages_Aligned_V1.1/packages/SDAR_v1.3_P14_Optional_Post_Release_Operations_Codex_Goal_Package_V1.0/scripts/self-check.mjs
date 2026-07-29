import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const required = [
  'README.md',
  'CODEX-GOAL-PROMPT.md',
  'MASTER-GOAL.md',
  'EXECUTION-POLICY.md',
  'SCOPE.md',
  'DEPENDENCY.md',
  'OPERATIONS-MONITORING-CONTRACT.md',
  'SLO-ERROR-BUDGET-CONTRACT.md',
  'ALERT-INCIDENT-CONTRACT.md',
  'ROLLBACK-RECOVERY-DRILL-CONTRACT.md',
  'DRIFT-REVALIDATION-REVIEW-CONTRACT.md',
  'COST-CAPACITY-REVIEW-CONTRACT.md',
  'FEEDBACK-QUALITY-CONTRACT.md',
  'CONTINUOUS-IMPROVEMENT-CONTRACT.md',
  'IMPLEMENTATION.md',
  'ACCEPTANCE.md',
  'TEST-PLAN.md',
  'EVIDENCE.md',
  'HANDOFF.md',
  'PACKAGE-CONSISTENCY-REVIEW.md',
  'manifest.json',
  'SHA256SUMS.json',
  'templates/P14-COMPLETION-REPORT.md',
  'templates/P14-HANDOFF.json'
];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) throw new Error(`Missing files: ${missing.join(', ')}`);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

if (manifest.packageId !== 'SDAR-V1.3-P14-OPTIONAL') {
  throw new Error('Wrong package id');
}
if (manifest.formalPackage !== false || manifest.formalPackageCount !== 14) {
  throw new Error('P14 must remain a non-formal extension');
}
if (manifest.extensionGoal !== 'X01') {
  throw new Error('P14 must not create G23');
}
if (manifest.model.name !== 'GPT-5.6 Sol' || manifest.model.reasoning !== 'medium') {
  throw new Error('Model drift');
}

const sums = JSON.parse(fs.readFileSync(path.join(root, 'SHA256SUMS.json'), 'utf8'));
for (const [rel, expected] of Object.entries(sums.files)) {
  const target = path.join(root, rel);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  if (actual !== expected) throw new Error(`Hash mismatch: ${rel}`);
}

const allDocs = required
  .filter((file) => file.endsWith('.md'))
  .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n');

for (const phrase of [
  'P14 is the fifteenth formal package',
  'P14 creates G23',
  'P14 changes the P13 release decision',
  'P14 automatically deploys production'
]) {
  if (allDocs.includes(phrase)) throw new Error(`Scope drift phrase: ${phrase}`);
}

console.log(JSON.stringify({
  ok: true,
  packageId: manifest.packageId,
  sequenceLabel: manifest.sequenceLabel,
  formalPackage: manifest.formalPackage,
  formalPackageCount: manifest.formalPackageCount,
  extensionGoal: manifest.extensionGoal,
  filesChecked: Object.keys(sums.files).length,
  model: manifest.model,
  allowedDecisions: manifest.allowedDecisions
}, null, 2));
