import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { reuseExistingInfrastructure } from './lib/infrastructure.mjs';
import { runVerificationProcess, verificationProcessPassed } from './lib/verification-process.mjs';
import { bootstrapSteps, fullSteps } from './lib/verification-steps.mjs';

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
const steps = process.argv.includes('--bootstrap') ? bootstrapSteps : fullSteps;
const controller = new globalThis.AbortController();
const cancel = () => controller.abort();
process.on('SIGTERM', cancel);
process.on('SIGINT', cancel);
const results = [];
let failed = false;

await mkdir(rawLogDirectory, { recursive: true });
await saveSummary('running');
for (const [name, args, timeoutMs] of steps) {
  const stepStartedAt = new Date();
  const relativeLogPath = `reports/verification/raw/${name}.log`;
  process.stdout.write(
    `\n[verification] ${name}: pnpm ${args.join(' ')} (limit ${timeoutMs} ms)\n`,
  );
  const result = await runVerificationProcess({
    command: process.execPath,
    args: [pnpmCli, ...args],
    cwd: root,
    env: childEnvironment,
    logPath: resolve(root, relativeLogPath),
    timeoutMs,
    signal: controller.signal,
  });
  const combinedOutput = await readFile(resolve(root, relativeLogPath), 'utf8');
  const passed = verificationProcessPassed(result);
  const entry = {
    name,
    command: `pnpm ${args.join(' ')}`,
    status: passed ? 'passed' : 'failed',
    startedAt: stepStartedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    timeoutMs,
    logPath: relativeLogPath,
    outputSha256: createHash('sha256').update(combinedOutput).digest('hex'),
    metrics: parseMetrics(combinedOutput),
    ...result,
  };
  results.push(entry);
  await writeFile(resolve(reportDirectory, `${name}.json`), `${JSON.stringify(entry, null, 2)}\n`);
  failed = !passed;
  await saveSummary(failed ? 'failed' : 'running');
  process.stdout.write(`[verification] ${name}: ${entry.status}, ${entry.durationMs} ms\n`);
  if (failed) break;
}
await saveSummary(failed ? 'failed' : 'passed');
process.removeListener('SIGTERM', cancel);
process.removeListener('SIGINT', cancel);
if (failed) process.exitCode = 1;
else process.stdout.write(`Verification passed; reports written to ${reportDirectory}.\n`);

async function saveSummary(status) {
  const finishedAt = new Date();
  const commit =
    process.env.SDAR_VERIFY_SOURCE_COMMIT ?? capture('git', ['rev-parse', 'HEAD']).trim();
  const dirty =
    process.env.SDAR_VERIFY_ISOLATED === 'true' ||
    capture('git', ['status', '--short']).trim() !== '';
  const summary = {
    schemaVersion: 2,
    scope: process.argv.includes('--bootstrap') ? 'bootstrap' : 'full',
    dependencyMode: process.env.SDAR_VERIFY_DEPENDENCY_MODE ?? 'operator-managed',
    baselineSha256: process.env.SDAR_VERIFY_BASELINE_SHA256,
    status,
    commit,
    dirty,
    ...(process.env.SDAR_VERIFY_INPUT_SHA256 === undefined
      ? {}
      : { inputSha256: process.env.SDAR_VERIFY_INPUT_SHA256 }),
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
    pendingSteps: steps.slice(results.length).map(([name]) => name),
  };

  await mkdir(reportDirectory, { recursive: true });
  await writeFile(
    resolve(reportDirectory, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeFile(resolve(reportDirectory, 'summary.md'), renderMarkdown(summary));
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
