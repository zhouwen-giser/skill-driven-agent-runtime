import console from 'node:console';
import process from 'node:process';
import { spawnSync, execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  initialize,
  readConfiguration,
  render,
  root,
  validateConfiguration,
  redactedConfiguration,
} from './config.mjs';

const [command = 'status', ...args] = process.argv.slice(2);
const envIndex = args.indexOf('--env-file');
const envPath = resolve(envIndex < 0 ? `${import.meta.dirname}/.env` : args[envIndex + 1]);
const overrides = Object.fromEntries(
  args
    .filter((x) => x.startsWith('--set='))
    .map((x) => {
      const pair = x.slice(6);
      const index = pair.indexOf('=');
      if (index < 1) throw new Error('DEVELOPMENT_OVERRIDE_INVALID');
      return [pair.slice(0, index), pair.slice(index + 1)];
    }),
);
function compose(file, argv, capture = false) {
  const result = spawnSync('docker', ['compose', '-f', file, ...argv], {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) throw new Error('DEVELOPMENT_COMPOSE_FAILED');
  return result.stdout;
}
try {
  if (command === 'init') {
    console.log(JSON.stringify(initialize(envPath)));
  } else {
    const config = readConfiguration(envPath, overrides);
    validateConfiguration(config);
    let revision = 'unknown';
    try {
      revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    } catch {
      const sourceFile = resolve(root, 'sdar-deployment-source.json');
      if (existsSync(sourceFile))
        revision = JSON.parse(readFileSync(sourceFile, 'utf8')).sourceRevision;
    }
    if (command === 'check') {
      console.log(
        JSON.stringify({
          status: 'valid',
          configuration: redactedConfiguration(config),
          secretsIncluded: false,
        }),
      );
    } else {
      const previousCompose = resolve(
        dirname(envPath),
        config.SDAR_DEPLOY_STATE_DIR,
        'compose.json',
      );
      if (command === 'upgrade') {
        if (!existsSync(previousCompose))
          throw new Error('DEVELOPMENT_UPGRADE_EXISTING_INSTALLATION_REQUIRED');
        compose(previousCompose, [
          'exec',
          '-T',
          'runtime',
          'node',
          'deploy/development/upgrade-preflight.mjs',
        ]);
      }
      if (!['up', 'upgrade', 'down', 'logs', 'status'].includes(command))
        throw new Error('DEVELOPMENT_COMMAND_INVALID');
      const current = ['up', 'upgrade'].includes(command)
        ? render(config, envPath, revision)
        : { composePath: previousCompose };
      if (command === 'up' || command === 'upgrade') {
        compose(current.composePath, ['build']);
        // Build can take minutes. Re-read durable execution/queue state immediately before rollout.
        if (
          compose(current.composePath, ['ps', '--status', 'running', '-q', 'runtime'], true).trim()
        )
          compose(current.composePath, [
            'exec',
            '-T',
            'runtime',
            'node',
            'deploy/development/upgrade-preflight.mjs',
          ]);
        compose(current.composePath, [
          'up',
          '--no-build',
          '--detach',
          '--wait',
          '--wait-timeout',
          '300',
        ]);
        compose(current.composePath, [
          'exec',
          '-T',
          'runtime',
          'node',
          'deploy/development/upgrade-preflight.mjs',
        ]);
        compose(current.composePath, [
          'exec',
          '-T',
          'runtime',
          'node',
          'deploy/development/bootstrap.mjs',
        ]);
        compose(current.composePath, ['images']);
        console.log(
          JSON.stringify({
            status:
              config.SDAR_UGV_BOOTSTRAP_ENABLED === 'YES'
                ? 'started'
                : 'started_governance_disabled',
            sourceRevision: revision,
            management: `http://${config.SDAR_DEPLOY_PUBLIC_HOST}:${config.SDAR_MANAGEMENT_PORT}`,
            a2a: `http://${config.SDAR_DEPLOY_PUBLIC_HOST}:${config.SDAR_A2A_PORT}`,
            control: `http://${config.SDAR_DEPLOY_PUBLIC_HOST}:${config.SDAR_CONTROL_API_PORT}`,
          }),
        );
      } else if (command === 'down') {
        compose(current.composePath, ['down']);
      } else if (command === 'logs') {
        compose(current.composePath, ['logs', '--tail', '80']);
      } else if (command === 'status') {
        compose(current.composePath, ['ps']);
      } else throw new Error('DEVELOPMENT_COMMAND_INVALID');
    }
  }
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'failed',
      code: error instanceof Error ? error.message : 'DEVELOPMENT_FAILED',
    }),
  );
  process.exitCode = 1;
}
