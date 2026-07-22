import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { reuseExistingInfrastructure } from './lib/infrastructure.mjs';

const root = process.cwd();
const reportDirectory = resolve(root, 'reports', 'verification');
const startedAt = new Date();
const pnpmCli = process.env['npm_execpath'];
if (pnpmCli === undefined || pnpmCli === '') {
  throw new Error('PNPM_EXECUTABLE_UNAVAILABLE: run this gate through pnpm verify');
}
const steps = [
  ['static-unit-contract-build', 'verify:bootstrap', 180_000],
  ['clean-baseline-reset-seed', 'verify:migrations', 300_000],
  ['postgres-redis-integration', 'test:integration', 300_000],
  ['postgres-redis-model-mcp-e2e', 'test:e2e', 300_000],
  ['infrastructure-smoke', 'smoke:infra', 240_000],
  ['server-console-smoke', 'smoke:server', 300_000],
];
const results = [];
let failed = false;

for (const [name, script, timeout] of steps) {
  const stepStartedAt = new Date();
  const result = spawnSync(process.execPath, [pnpmCli, script], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    timeout,
  });
  const stepFinishedAt = new Date();
  const passed = result.status === 0 && result.error === undefined;
  results.push({
    name,
    command: `pnpm ${script}`,
    status: passed ? 'passed' : 'failed',
    startedAt: stepStartedAt.toISOString(),
    finishedAt: stepFinishedAt.toISOString(),
    durationMs: stepFinishedAt.getTime() - stepStartedAt.getTime(),
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
