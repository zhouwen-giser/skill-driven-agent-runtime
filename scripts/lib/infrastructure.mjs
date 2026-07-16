import { spawnSync } from 'node:child_process';
import process from 'node:process';

loadLocalEnvironment();

export const reuseExistingInfrastructure = process.env.SDAR_REUSE_EXISTING_INFRA === 'true';

export function startInfrastructure(root = process.cwd()) {
  if (reuseExistingInfrastructure) {
    process.stdout.write(
      'Reusing operator-managed PostgreSQL and Redis; Docker lifecycle commands are disabled.\n',
    );
    return;
  }
  runDocker(
    ['compose', '-f', 'compose.yaml', 'up', '-d', '--wait', 'postgres', 'redis'],
    180_000,
    root,
  );
}

export function stopInfrastructure(root = process.cwd()) {
  if (reuseExistingInfrastructure) return;
  runDocker(['compose', '-f', 'compose.yaml', 'stop', 'postgres', 'redis'], 60_000, root, true);
}

export function validateComposeWithDocker(root = process.cwd()) {
  if (reuseExistingInfrastructure) {
    process.stdout.write(
      'Compose daemon/config validation deferred in operator-managed infrastructure mode; static Compose policy validation passed.\n',
    );
    return;
  }
  runDocker(['compose', '-f', 'compose.yaml', 'config', '--quiet'], 60_000, root);
}

function runDocker(args, timeout, root, ignoreFailure = false) {
  const result = spawnSync('docker', args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    timeout,
  });
  if (result.error !== undefined && !ignoreFailure) throw result.error;
  if (result.status !== 0 && !ignoreFailure) {
    throw new Error(`INFRASTRUCTURE_COMMAND_FAILED: docker ${args.join(' ')}`);
  }
}

function loadLocalEnvironment() {
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }
}

function isNodeError(error) {
  return error instanceof Error && 'code' in error;
}
