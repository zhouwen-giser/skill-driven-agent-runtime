import { access, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const reportPath = resolve(root, 'reports', 'v1.1-mcp-tasks', 'V11-ACCEPTANCE.json');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const expectedIds = Array.from(
  { length: 16 },
  (_, index) => `AC-MCPT-${String(index + 1).padStart(2, '0')}`,
);
const requiredRuns = [
  'production-build',
  'mcp-tasks-sixteen-scenario-contract',
  'acceptance-unit-evidence',
  'postgres-redis-integration-including-restart',
  'full-e2e',
];
const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
const commandRuns = Array.isArray(report.commandRuns) ? report.commandRuns : [];
const actualIds = scenarios.map((scenario) => scenario.id);

if (report.schemaVersion !== 1) throw new Error('V11_ACCEPTANCE_SCHEMA_VERSION_INVALID');
if (report.status !== 'passed') throw new Error('V11_ACCEPTANCE_REPORT_NOT_PASSED');
if (typeof report.generatedAt !== 'string' || !Number.isFinite(Date.parse(report.generatedAt))) {
  throw new Error('V11_ACCEPTANCE_GENERATED_AT_INVALID');
}
if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
  throw new Error(`V11_ACCEPTANCE_SCENARIO_SET_INVALID:${actualIds.join(',')}`);
}
if (new Set(actualIds).size !== expectedIds.length) {
  throw new Error('V11_ACCEPTANCE_SCENARIO_DUPLICATE');
}
if (!Array.isArray(report.unverified) || report.unverified.length !== 0) {
  throw new Error('V11_ACCEPTANCE_UNVERIFIED_SET_NOT_EMPTY');
}
const commandRunNames = commandRuns.map((run) => run.name);
if (new Set(commandRunNames).size !== commandRunNames.length) {
  throw new Error('V11_ACCEPTANCE_COMMAND_RUN_DUPLICATE');
}
for (const run of commandRuns) {
  if (run.status !== 'passed' || run.exitCode !== 0) {
    throw new Error(`V11_ACCEPTANCE_COMMAND_RUN_FAILED:${String(run.name)}`);
  }
}

for (const requiredRun of requiredRuns) {
  const run = commandRuns.find((candidate) => candidate.name === requiredRun);
  if (run === undefined) throw new Error(`V11_ACCEPTANCE_COMMAND_RUN_MISSING:${requiredRun}`);
  if (run.status !== 'passed') {
    throw new Error(`V11_ACCEPTANCE_COMMAND_RUN_NOT_PASSED:${requiredRun}`);
  }
  if (typeof run.command !== 'string' || run.command.trim() === '') {
    throw new Error(`V11_ACCEPTANCE_COMMAND_RUN_INVALID:${requiredRun}`);
  }
  if (!Number.isInteger(run.exitCode) || run.exitCode !== 0) {
    throw new Error(`V11_ACCEPTANCE_COMMAND_RUN_EXIT_INVALID:${requiredRun}`);
  }
}

for (const scenario of scenarios) {
  if (scenario.status !== 'passed') {
    throw new Error(`V11_ACCEPTANCE_SCENARIO_NOT_PASSED:${scenario.id}`);
  }
  if (!Array.isArray(scenario.commands) || scenario.commands.length === 0) {
    throw new Error(`V11_ACCEPTANCE_COMMAND_MISSING:${scenario.id}`);
  }
  for (const commandName of scenario.commands) {
    const run = commandRuns.find((candidate) => candidate.name === commandName);
    if (run === undefined || run.status !== 'passed') {
      throw new Error(`V11_ACCEPTANCE_COMMAND_NOT_PASSED:${scenario.id}:${String(commandName)}`);
    }
  }
  if (!Array.isArray(scenario.evidence) || scenario.evidence.length === 0) {
    throw new Error(`V11_ACCEPTANCE_EVIDENCE_MISSING:${scenario.id}`);
  }
  if (!Array.isArray(scenario.classification) || scenario.classification.length === 0) {
    throw new Error(`V11_ACCEPTANCE_CLASSIFICATION_MISSING:${scenario.id}`);
  }
  if (new Set(scenario.classification).size !== scenario.classification.length) {
    throw new Error(`V11_ACCEPTANCE_CLASSIFICATION_DUPLICATE:${scenario.id}`);
  }
  if (scenario.classification.some((value) => value === 'unverified')) {
    throw new Error(`V11_ACCEPTANCE_UNVERIFIED_EVIDENCE:${scenario.id}`);
  }
  for (const value of scenario.classification) {
    if (value !== 'real' && value !== 'simulated') {
      throw new Error(`V11_ACCEPTANCE_CLASSIFICATION_INVALID:${scenario.id}:${String(value)}`);
    }
  }
  for (const evidence of scenario.evidence) {
    if (
      typeof evidence !== 'object' ||
      evidence === null ||
      typeof evidence.path !== 'string' ||
      typeof evidence.assertion !== 'string' ||
      evidence.path.trim() === '' ||
      evidence.assertion.trim() === ''
    ) {
      throw new Error(`V11_ACCEPTANCE_EVIDENCE_INVALID:${scenario.id}`);
    }
    const absoluteEvidencePath = resolve(root, evidence.path);
    const relativeEvidencePath = relative(root, absoluteEvidencePath);
    if (
      isAbsolute(relativeEvidencePath) ||
      relativeEvidencePath === '..' ||
      relativeEvidencePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    ) {
      throw new Error(`V11_ACCEPTANCE_EVIDENCE_OUTSIDE_REPOSITORY:${scenario.id}`);
    }
    await access(absoluteEvidencePath);
  }
}

process.stdout.write(
  'Verified 16 passed MCP Tasks acceptance scenarios with reproducible evidence and real/simulated classification.\n',
);
