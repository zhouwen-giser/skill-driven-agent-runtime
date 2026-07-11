import { spawnSync } from 'node:child_process';
import process from 'node:process';

try {
  run(
    'docker',
    ['compose', '-f', 'compose.yaml', 'up', '-d', '--wait', 'postgres', 'redis'],
    180_000,
  );
  run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--project', 'e2e'], 120_000);
} finally {
  run('docker', ['compose', '-f', 'compose.yaml', 'stop', 'postgres', 'redis'], 60_000, true);
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
    throw new Error(`E2E_COMMAND_FAILED: ${command} ${args.join(' ')}`);
  }
}
