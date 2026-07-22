import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'README.md',
  'CODEX-GOAL-PROMPT.md',
  'MASTER-GOAL.md',
  'EXECUTION-POLICY.md',
  'REPOSITORY-BASELINE.md',
  'EXTERNAL-DEPENDENCIES.md',
  'SOURCE-REUSE-POLICY.md',
  'manifest.json',
  'decisions/FROZEN-DECISIONS.md',
  'acceptance/ACCEPTANCE-MATRIX.md',
  'acceptance/REQUIREMENTS-TRACEABILITY.md',
  'sources/OPEN-SOURCE-SOURCES.lock.json',
];
for (let i = 0; i <= 17; i++) required.push(`goals/G${String(i).padStart(2, '0')}.md`);
const missing = required.filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) throw new Error(`Missing required files: ${missing.join(', ')}`);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.goals.length !== 18) throw new Error('manifest must contain 18 goals');
const ids = new Set(manifest.goals.map((g) => g.id));
for (const g of manifest.goals)
  for (const d of g.dependsOn) {
    if (!ids.has(d) && !String(d).startsWith('GATE-')) throw new Error(`Unknown dependency ${d}`);
  }
function visit(id, stack = new Set(), done = new Set()) {
  if (done.has(id)) return;
  if (stack.has(id)) throw new Error(`Goal dependency cycle at ${id}`);
  stack.add(id);
  const goal = manifest.goals.find((g) => g.id === id);
  for (const d of goal.dependsOn.filter((x) => ids.has(x))) visit(d, stack, done);
  stack.delete(id);
  done.add(id);
}
for (const id of ids) visit(id);
const sumsPath = path.join(root, 'SHA256SUMS.json');
if (fs.existsSync(sumsPath)) {
  const sums = JSON.parse(fs.readFileSync(sumsPath, 'utf8'));
  for (const [rel, expected] of Object.entries(sums.files)) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) throw new Error(`Hash file missing: ${rel}`);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    if (actual !== expected) throw new Error(`SHA mismatch: ${rel}`);
  }
}
process.stdout.write(
  `OK: ${manifest.package}; goals=${manifest.goals.length}; required=${required.length}\n`,
);
