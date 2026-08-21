#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { chmod, link, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const EXPECTED_STATE_ROOT = `/tmp/sdar-uap-p3-b01-${String(process.getuid?.() ?? 0)}`;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,95}$/u;

export class UapStateError extends Error {
  constructor(code) {
    super(code);
    this.name = 'UapStateError';
    this.code = code;
  }
}

export async function initializeState(stateRoot = EXPECTED_STATE_ROOT) {
  const root = resolve(stateRoot);
  await ensurePrivateDirectory(root);
  const pmsRoot = join(root, 'pms');
  const logsRoot = join(root, 'logs');
  await Promise.all([ensurePrivateDirectory(pmsRoot), ensurePrivateDirectory(logsRoot)]);

  const bootstrapRunId = await ensureRandomText(
    join(root, 'run-id'),
    () => `uap-p3-b01-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`,
    (value) => IDENTIFIER.test(value) && !value.includes('..'),
  );
  const simulationRunId = await ensureRandomText(
    join(root, 'simulation-run-id'),
    () => `uap-p3-b02-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`,
    (value) => IDENTIFIER.test(value) && !value.includes('..'),
  );
  if (bootstrapRunId === simulationRunId) throw new UapStateError('UAP_RUN_IDS_MUST_DIFFER');
  const registrationTokenPath = join(pmsRoot, 'runtime-registration.token');
  await ensureRandomText(
    registrationTokenPath,
    () => randomBytes(32).toString('base64url'),
    (value) => /^[A-Za-z0-9_-]{40,128}$/u.test(value),
  );
  for (const name of [
    'control-api.token',
    'control-operator-api.token',
    'control-viewer-api.token',
    'control-security-api.token',
    'control-organization-api.token',
    'runtime-control-service.token',
    'cognitive-management.token',
    'governed-control.token',
    'artifact-management.token',
  ])
    await ensureRandomText(
      join(root, name),
      () => randomBytes(32).toString('base64url'),
      (value) => /^[A-Za-z0-9_-]{40,128}$/u.test(value),
    );
  await ensureExactText(
    join(pmsRoot, 'pms-database-url'),
    'postgresql://uap_pms@ugv-agent-profile-pms-postgres:5432/uap_pms',
  );
  await ensureExactJson(join(pmsRoot, 'runtime-credentials.json'), {
    runtimeConfig: [],
    runtimeRegistration: [
      {
        subjectId: 'uap-p3-b01-runtime-registration',
        providerId: 'isr.vehicle.ugv.ugv1',
        deploymentId: 'uap-p3-b01-runtime',
        instanceId: 'uap-p3-b01-runtime-1',
        runtimeVersion: '2.0.0-rc.1',
        tokenFile: '/run/uap-pms/runtime-registration.token',
        protocolVersion: '2026-07-28',
        scopes: ['runtime:register', 'runtime:heartbeat'],
      },
    ],
  });
  await ensureProvisioningFile(join(pmsRoot, 'postgres-provisioning.json'));
  await ensureExactJson(join(root, 'state-manifest.json'), {
    schemaVersion: 'ugv-agent-profile.local-state/v1',
    owner: 'UAP-P3-B01',
    repositoryRoot: REPOSITORY_ROOT,
    smppComposeProject: 'sdar-uap-p3-b01-smpp',
    sdarComposeProject: 'sdar-uap-p3-b01-sdar',
    secretsIncluded: false,
  });
  return Object.freeze({
    root,
    pmsRoot,
    logsRoot,
    runId: bootstrapRunId,
    bootstrapRunId,
    simulationRunId,
  });
}

async function ensurePrivateDirectory(path) {
  try {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isDirectory())
      throw new UapStateError('UAP_STATE_PATH_INVALID');
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  const status = await lstat(path);
  if (status.isSymbolicLink() || !status.isDirectory())
    throw new UapStateError('UAP_STATE_PATH_INVALID');
  if (process.getuid !== undefined && status.uid !== process.getuid())
    throw new UapStateError('UAP_STATE_OWNER_INVALID');
  await chmod(path, 0o700);
}

async function ensureRandomText(path, create, validate) {
  try {
    const existing = await readPrivateFile(path);
    if (!validate(existing)) throw new UapStateError('UAP_STATE_FILE_INVALID');
    return existing;
  } catch (error) {
    if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
  }
  const value = create();
  if (!validate(value)) throw new UapStateError('UAP_STATE_GENERATION_INVALID');
  await writePrivateFirstWriter(path, `${value}\n`);
  const winner = await readPrivateFile(path);
  if (!validate(winner)) throw new UapStateError('UAP_STATE_FILE_INVALID');
  return winner;
}

async function ensureExactText(path, expected) {
  try {
    const value = await readPrivateFile(path);
    if (value !== expected) throw new UapStateError('UAP_STATE_FILE_DRIFT');
  } catch (error) {
    if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
    await writePrivateFirstWriter(path, `${expected}\n`);
    if ((await readPrivateFile(path)) !== expected) throw new UapStateError('UAP_STATE_FILE_DRIFT');
  }
}

async function ensureExactJson(path, expected) {
  try {
    const value = JSON.parse(await readPrivateFile(path));
    if (JSON.stringify(value) !== JSON.stringify(expected))
      throw new UapStateError('UAP_STATE_FILE_DRIFT');
  } catch (error) {
    if (error instanceof SyntaxError) throw new UapStateError('UAP_STATE_FILE_INVALID');
    if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
    await writePrivateFirstWriter(path, `${JSON.stringify(expected, null, 2)}\n`);
    const winner = JSON.parse(await readPrivateFile(path));
    if (JSON.stringify(winner) !== JSON.stringify(expected))
      throw new UapStateError('UAP_STATE_FILE_DRIFT');
  }
}

async function ensureProvisioningFile(path) {
  try {
    const value = JSON.parse(await readPrivateFile(path));
    validateProvisioning(value);
  } catch (error) {
    if (error instanceof SyntaxError) throw new UapStateError('UAP_PMS_PROVISIONING_FILE_INVALID');
    if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
    await writePrivateFirstWriter(
      path,
      `${JSON.stringify(
        {
          clusterRef: 'uap-pms-postgres',
          adminSecretRef: 'file/uap/postgres-admin',
          adminDatabaseUrl: 'postgresql://uap_pms@ugv-agent-profile-pms-postgres:5432/postgres',
          runtimePassword: randomBytes(32).toString('base64url'),
        },
        null,
        2,
      )}\n`,
    );
    try {
      validateProvisioning(JSON.parse(await readPrivateFile(path)));
    } catch (winnerError) {
      if (winnerError instanceof UapStateError) throw winnerError;
      throw new UapStateError('UAP_PMS_PROVISIONING_FILE_INVALID');
    }
  }
}

function validateProvisioning(value) {
  if (
    value?.clusterRef !== 'uap-pms-postgres' ||
    value?.adminSecretRef !== 'file/uap/postgres-admin' ||
    value?.adminDatabaseUrl !==
      'postgresql://uap_pms@ugv-agent-profile-pms-postgres:5432/postgres' ||
    typeof value?.runtimePassword !== 'string' ||
    !/^[A-Za-z0-9_-]{40,128}$/u.test(value.runtimePassword) ||
    Object.keys(value).length !== 4
  )
    throw new UapStateError('UAP_PMS_PROVISIONING_FILE_INVALID');
}

async function readPrivateFile(path) {
  const status = await lstat(path);
  if (status.isSymbolicLink() || !status.isFile() || (status.mode & 0o777) !== 0o600)
    throw new UapStateError('UAP_STATE_FILE_PERMISSIONS_INVALID');
  if (process.getuid !== undefined && status.uid !== process.getuid())
    throw new UapStateError('UAP_STATE_FILE_OWNER_INVALID');
  if (status.size > 65_536) throw new UapStateError('UAP_STATE_FILE_INVALID');
  return (await readFile(path, 'utf8')).trim();
}

async function writePrivateFirstWriter(path, content) {
  await ensurePrivateDirectory(dirname(path));
  const temporary = `${path}.${String(process.pid)}.${randomBytes(12).toString('hex')}.candidate`;
  let failure;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    try {
      await link(temporary, path);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
    }
  } catch (error) {
    failure = error;
  }
  try {
    await unlink(temporary);
  } catch (error) {
    if ((!isNodeError(error) || error.code !== 'ENOENT') && failure === undefined) failure = error;
  }
  if (failure !== undefined) throw failure;
}

function isNodeError(error) {
  return error instanceof Error && 'code' in error;
}

async function main() {
  const printRunId = process.argv.slice(2).includes('--print-run-id');
  const printSimulationRunId = process.argv.slice(2).includes('--print-simulation-run-id');
  if (
    (printRunId && printSimulationRunId) ||
    process.argv.length > (printRunId || printSimulationRunId ? 3 : 2)
  )
    throw new UapStateError('UAP_ARGUMENT_INVALID');
  const state = await initializeState();
  if (printRunId) process.stdout.write(`${state.runId}\n`);
  else if (printSimulationRunId) process.stdout.write(`${state.simulationRunId}\n`);
  else
    process.stdout.write(
      `${JSON.stringify({
        status: 'initialized',
        bootstrapRunId: state.bootstrapRunId,
        simulationRunId: state.simulationRunId,
        secretsIncluded: false,
      })}\n`,
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof UapStateError ? error.code : 'UAP_STATE_INITIALIZATION_FAILED'}\n`,
    );
    process.exitCode = 2;
  }
}
