#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

import { writeImmutableAttemptJson } from './evidence-files.mjs';
import { authorizeB02SimulationId } from './b02-attempt-identity.mjs';
import { validateB02SupervisorState } from './b02-supervisor-state.mjs';
import { readExistingState } from './initialize-state.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export async function recordB02Failure(input, options = {}) {
  if (
    typeof input?.stage !== 'string' ||
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(input.stage) ||
    !Number.isSafeInteger(input.exitCode) ||
    input.exitCode < 1 ||
    input.exitCode > 255 ||
    typeof input.yesEntered !== 'boolean' ||
    typeof input.simulationId !== 'string'
  )
    throw new Error('UAP_B02_FAILURE_INPUT_INVALID');
  const state = await readExistingState(options.stateRoot);
  const reportRoot = resolve(
    options.reportRoot ?? resolve(REPOSITORY_ROOT, 'reports/ugv-agent-profile-simulation'),
  );
  const authorized = await authorizeB02SimulationId(input.simulationId, {
    stateRoot: state.root,
    reportRoot,
  });
  const restored = await optionalPrivateJson(input.finalSupervisorStatusPath);
  const restoreVerified = isB02SupervisorRestoredNo(restored, state.bootstrapRunId);
  const report = Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.a2a-move-failure/v1',
    status: 'failed',
    task: 'UAP-P3-B02',
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    generatedAt: new Date().toISOString(),
    bootstrapRunId: state.bootstrapRunId,
    simulationId: authorized.simulationId,
    stage: input.stage,
    exitCode: input.exitCode,
    sideEffectWindow: Object.freeze({
      yesEntered: input.yesEntered,
      restoreAttempted: true,
      restoredSideEffects: restoreVerified ? 'NO' : 'unknown',
      restoreVerified,
    }),
    activityAssessment: 'unknown_unless_private_ledgers_are_reconciled',
    secretsIncluded: false,
    endpointsIncluded: false,
    downstreamDeviceIdsIncluded: false,
    modelValuesIncluded: false,
    modelEndpointsIncluded: false,
    modelCredentialsIncluded: false,
  });
  const target = await writeImmutableAttemptJson(
    resolve(reportRoot, 'attempts'),
    `uap-p3-b02-failure-${authorized.simulationId}`,
    report,
  );
  return Object.freeze({ target, report });
}

export function isB02SupervisorRestoredNo(value, expectedBootstrapRunId) {
  if (typeof expectedBootstrapRunId !== 'string' || expectedBootstrapRunId === '') return false;
  try {
    return validateB02SupervisorState(value, 'NO').bootstrapRunId === expectedBootstrapRunId;
  } catch {
    return false;
  }
}

async function optionalPrivateJson(path) {
  if (typeof path !== 'string' || path === '') return undefined;
  const target = resolve(path);
  let status;
  try {
    status = await lstat(target);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    (status.mode & 0o777) !== 0o600 ||
    (process.getuid !== undefined && status.uid !== process.getuid()) ||
    status.size < 2 ||
    status.size > 16_384
  )
    return undefined;
  let handle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (opened.dev !== status.dev || opened.ino !== status.ino) return undefined;
    return JSON.parse(await handle.readFile({ encoding: 'utf8' }));
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

async function main() {
  if (process.argv.length !== 8 || process.argv[2] !== 'record')
    throw new Error(
      'Usage: record-b02-failure.mjs record <stage> <exit-code> <yes-entered> <final-status-file> <simulation-id>',
    );
  const yesEntered =
    process.argv[5] === 'true' ? true : process.argv[5] === 'false' ? false : undefined;
  if (yesEntered === undefined) throw new Error('UAP_B02_FAILURE_INPUT_INVALID');
  const result = await recordB02Failure({
    stage: process.argv[3],
    exitCode: Number.parseInt(process.argv[4], 10),
    yesEntered,
    finalSupervisorStatusPath: process.argv[6],
    simulationId: process.argv[7],
  });
  process.stdout.write(
    `${JSON.stringify({ status: 'recorded', attemptFile: result.target, secretsIncluded: false })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'UAP_B02_FAILURE_RECORD_FAILED'}\n`,
    );
    process.exitCode = 1;
  });
}
