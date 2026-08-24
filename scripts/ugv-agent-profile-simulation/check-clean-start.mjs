#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PROJECTS = Object.freeze(['sdar-uap-p3-b01-sdar', 'sdar-uap-p3-b01-smpp']);
const VOLUMES = new Set([
  'sdar-uap-p3-b01-smpp-adapter-postgres-data',
  'sdar-uap-p3-b01-smpp-runtime-postgres-data',
  'sdar-uap-p3-b01-smpp-adapter-state',
  'sdar-uap-p3-b01-smpp-pms-postgres-data',
  'sdar-uap-p3-b01-smpp-pms-worker-state',
  'sdar-uap-p3-b01-runtime-postgres-data',
  'sdar-uap-p3-b01-control-postgres-data',
  'sdar-uap-p3-b01-redis-data',
]);
const NETWORKS = new Set([
  'sdar-uap-p3-b01-smpp-control',
  'sdar-uap-p3-b01-smpp-southbound',
  'sdar-uap-p3-b01-smpp-northbound',
  'sdar-uap-p3-b01-sdar-control',
  'sdar-uap-p3-b01-sdar-northbound',
]);

export function assertCleanStartInventory(run = docker, scope = 'all') {
  if (!['all', 'sdar'].includes(scope)) throw new Error('UAP_ARGUMENT_INVALID');
  const projects =
    scope === 'sdar' ? PROJECTS.filter((value) => value.endsWith('-sdar')) : PROJECTS;
  const volumes =
    scope === 'sdar' ? new Set([...VOLUMES].filter((value) => !value.includes('-smpp-'))) : VOLUMES;
  const networks =
    scope === 'sdar'
      ? new Set([...NETWORKS].filter((value) => value.startsWith('sdar-uap-p3-b01-sdar-')))
      : NETWORKS;
  for (const project of projects)
    if (
      lines(
        run([
          'ps',
          '-a',
          '--filter',
          `label=com.docker.compose.project=${project}`,
          '--format',
          '{{.ID}}',
        ]),
      ).length !== 0
    )
      throw new Error('UAP_CLEAN_START_CONTAINER_EXISTS');
  if (lines(run(['volume', 'ls', '--format', '{{.Name}}'])).some((name) => volumes.has(name)))
    throw new Error('UAP_CLEAN_START_VOLUME_EXISTS');
  if (lines(run(['network', 'ls', '--format', '{{.Name}}'])).some((name) => networks.has(name)))
    throw new Error('UAP_CLEAN_START_NETWORK_EXISTS');
  return Object.freeze({
    projectsAbsent: projects.length,
    volumesAbsent: volumes.size,
    networksAbsent: networks.size,
  });
}

function docker(arguments_) {
  try {
    return execFileSync('docker', arguments_, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    });
  } catch {
    throw new Error('UAP_DOCKER_INVENTORY_FAILED');
  }
}

function lines(value) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3 || (process.argv.length === 3 && process.argv[2] !== '--sdar'))
      throw new Error('UAP_ARGUMENT_INVALID');
    const result = assertCleanStartInventory(docker, process.argv[2] === '--sdar' ? 'sdar' : 'all');
    process.stdout.write(`${JSON.stringify({ status: 'passed', ...result })}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error && /^UAP_/u.test(error.message) ? error.message : 'UAP_CLEAN_START_CHECK_FAILED'}\n`,
    );
    process.exitCode = 2;
  }
}
