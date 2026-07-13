import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const path = resolve(process.cwd(), 'reports', 'EP-07-hardening-acceptance', 'V1-ACCEPTANCE-AUDIT.json');
const report = JSON.parse(await readFile(path, 'utf8'));
const expectedIds = Array.from({ length: 18 }, (_, index) => `AC-${String(index + 1).padStart(2, '0')}`);
const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
const actualIds = scenarios.map((scenario) => scenario.id);

if (report.status !== 'passed') throw new Error('ACCEPTANCE_REPORT_NOT_PASSED');
if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
  throw new Error(`ACCEPTANCE_SCENARIO_SET_INVALID:${actualIds.join(',')}`);
}
for (const scenario of scenarios) {
  if (scenario.status !== 'passed') throw new Error(`ACCEPTANCE_SCENARIO_NOT_PASSED:${scenario.id}`);
  if (!Array.isArray(scenario.evidence) || scenario.evidence.length === 0) {
    throw new Error(`ACCEPTANCE_EVIDENCE_MISSING:${scenario.id}`);
  }
  if (!Array.isArray(scenario.classification) || scenario.classification.length === 0) {
    throw new Error(`ACCEPTANCE_CLASSIFICATION_MISSING:${scenario.id}`);
  }
}

process.stdout.write('Verified 18 passed acceptance scenarios with evidence and classification.\n');
