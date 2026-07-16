import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';

try {
  startInfrastructure();
  run(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', '--project', 'integration'],
    120_000,
  );
} finally {
  stopInfrastructure();
}

function run(command, args, timeout, ignoreFailure = false) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: 'inherit',
    timeout,
  });
  if (result.error !== undefined && !ignoreFailure) throw result.error;
  if (result.status !== 0 && !ignoreFailure) {
    throw new Error(`INTEGRATION_COMMAND_FAILED: ${command} ${args.join(' ')}`);
  }
}
