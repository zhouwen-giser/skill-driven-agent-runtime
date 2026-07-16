import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';

const root = process.cwd();
const runAllScenarios = process.argv.includes('--all');
const pnpmCli = process.env['npm_execpath'];
if (pnpmCli === undefined || pnpmCli === '') {
  throw new Error('PNPM_EXECUTABLE_UNAVAILABLE: run this demo through pnpm demo:local');
}

try {
  run(process.execPath, [pnpmCli, 'build'], 180_000);
  startInfrastructure(root);
  const testArguments = ['node_modules/vitest/vitest.mjs', 'run', '--project', 'e2e'];
  if (!runAllScenarios) {
    testArguments.push(
      '-t',
      'runs the documented example A2A client through plan confirmation and Mock MCP',
    );
  }
  run(process.execPath, testArguments, runAllScenarios ? 300_000 : 180_000);
  process.stdout.write(
    runAllScenarios
      ? 'Local acceptance demo passed: all E2E scenarios ran with PostgreSQL, Redis, Mock Model, Mock MCP, Server, Console bundle, and the example A2A Client.\n'
      : 'Local demo passed: PostgreSQL, Redis, Mock Model, Mock MCP, Server, Console bundle, and example A2A Client completed a confirmed task.\n',
  );
} finally {
  stopInfrastructure(root);
}

function run(command, args, timeout, ignoreFailure = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    timeout,
  });
  if (result.error !== undefined && !ignoreFailure) throw result.error;
  if (result.status !== 0 && !ignoreFailure) {
    throw new Error(`LOCAL_DEMO_COMMAND_FAILED:${command} ${args.join(' ')}`);
  }
}
