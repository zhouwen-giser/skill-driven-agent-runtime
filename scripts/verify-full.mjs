import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { reuseExistingInfrastructure } from './lib/infrastructure.mjs';

const root = process.cwd();
const reportDirectory = resolve(root, 'reports', 'verification');
const rawLogDirectory = resolve(reportDirectory, 'raw');
const startedAt = new Date();
const pnpmCli = process.env['npm_execpath'];
if (pnpmCli === undefined || pnpmCli === '') {
  throw new Error('PNPM_EXECUTABLE_UNAVAILABLE: run this gate through pnpm verify');
}
const childEnvironment = { ...process.env, NO_COLOR: '1' };
Reflect.deleteProperty(childEnvironment, 'FORCE_COLOR');
const steps = [
  ['static-unit-contract-build', 'verify:bootstrap', 600_000],
  ['cognitive-replay-no-physical-provider', 'verify:cognitive-replay', 60_000],
  ['clean-baseline-reset-seed', 'verify:migrations', 300_000],
  ['postgres-redis-integration', 'test:integration', 660_000],
  ['postgres-redis-model-mcp-e2e', 'test:e2e', 360_000],
  ['official-a2a-tck', 'test:a2a-tck', 300_000],
  ['canonical-evidence-demo', 'demo:evidence-e2e', 600_000],
  ['infrastructure-smoke', 'smoke:infra', 240_000],
  ['server-console-smoke', 'smoke:server', 300_000],
  ['node-control-api-worker-smoke', 'smoke:node-control', 300_000],
];
const results = [];
let failed = false;

await mkdir(rawLogDirectory, { recursive: true });
for (const [name, script, timeout] of steps) {
  const stepStartedAt = new Date();
  const result = spawnSync(process.execPath, [pnpmCli, script], {
    cwd: root,
    env: childEnvironment,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  const combinedOutput = `${stdout}${stderr}`;
  const relativeLogPath = `reports/verification/raw/${name}.log`;
  await writeFile(resolve(root, relativeLogPath), combinedOutput);
  const stepFinishedAt = new Date();
  const passed = result.status === 0 && result.error === undefined;
  results.push({
    name,
    command: `pnpm ${script}`,
    status: passed ? 'passed' : 'failed',
    startedAt: stepStartedAt.toISOString(),
    finishedAt: stepFinishedAt.toISOString(),
    durationMs: stepFinishedAt.getTime() - stepStartedAt.getTime(),
    logPath: relativeLogPath,
    outputSha256: createHash('sha256').update(combinedOutput).digest('hex'),
    metrics: parseMetrics(combinedOutput),
    ...(result.status === null ? {} : { exitCode: result.status }),
    ...(result.signal === null ? {} : { signal: result.signal }),
    ...(result.error === undefined ? {} : { error: result.error.message }),
  });
  if (!passed) {
    failed = true;
    break;
  }
}

const finishedAt = new Date();
const commit = capture('git', ['rev-parse', 'HEAD']).trim();
const dirty = capture('git', ['status', '--short']).trim() !== '';
const summary = {
  schemaVersion: 1,
  status: failed ? 'failed' : 'passed',
  commit,
  dirty,
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    infrastructureMode: reuseExistingInfrastructure ? 'operator-managed' : 'self-managed-compose',
  },
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  steps: results,
};

await mkdir(reportDirectory, { recursive: true });
await writeFile(resolve(reportDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(resolve(reportDirectory, 'summary.md'), renderMarkdown(summary));

if (failed) {
  process.exitCode = 1;
} else {
  process.stdout.write(`Full verification passed; reports written to ${reportDirectory}.\n`);
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout : 'unavailable';
}

function parseMetrics(value) {
  const testFiles = sumNumbers(value, /Test Files\s+(\d+)\s+passed/gu);
  const tests = sumNumbers(value, /Tests\s+(\d+)\s+passed/gu);
  const openapiOperations = lastNumber(value, /Verified\s+(\d+)\s+management API operations/gu);
  const migrationCount = lastNumber(
    value,
    /SDAR migration path verified:[\s\S]*?,\s+(\d+)\s+additive migrations/gu,
  );
  return {
    ...(testFiles === undefined ? {} : { testFiles }),
    ...(tests === undefined ? {} : { tests }),
    ...(openapiOperations === undefined ? {} : { openapiOperations }),
    ...(migrationCount === undefined ? {} : { migrationCount }),
  };
}

function lastNumber(value, pattern) {
  const matches = [...value.matchAll(pattern)];
  const matched = matches.at(-1)?.[1];
  return matched === undefined ? undefined : Number(matched);
}

function sumNumbers(value, pattern) {
  const matches = [...value.matchAll(pattern)];
  if (matches.length === 0) return undefined;
  return matches.reduce((sum, match) => sum + Number(match[1] ?? 0), 0);
}

function renderMarkdown(summaryValue) {
  const lines = [
    '# Verification Summary',
    '',
    `- Status: **${summaryValue.status}**`,
    `- Commit: \`${summaryValue.commit}\`${summaryValue.dirty ? ' (dirty working tree)' : ''}`,
    `- Started: ${summaryValue.startedAt}`,
    `- Finished: ${summaryValue.finishedAt}`,
    `- Duration: ${String(summaryValue.durationMs)} ms`,
    `- Environment: Node ${summaryValue.environment.node}, ${summaryValue.environment.platform}/${summaryValue.environment.architecture}`,
    `- Infrastructure mode: ${summaryValue.environment.infrastructureMode}`,
    '',
    '| Gate | Command | Result | Duration |',
    '| --- | --- | --- | ---: |',
  ];
  for (const step of summaryValue.steps) {
    lines.push(
      `| ${step.name} | \`${step.command}\` | ${step.status} | ${String(step.durationMs)} ms |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
