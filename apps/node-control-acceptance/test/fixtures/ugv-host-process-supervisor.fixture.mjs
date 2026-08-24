#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  createOfflineHostProcessSupervisorTestFixture,
  parseRestartServerArguments,
  UapSupervisorError,
} from '../../../../scripts/ugv-agent-profile-simulation/host-process-supervisor.mjs';
import { captureB02SupervisorState } from '../../../../scripts/ugv-agent-profile-simulation/b02-supervisor-state.mjs';

const FIXTURE_ACKNOWLEDGEMENT =
  'I_ACKNOWLEDGE_INTERNAL_OFFLINE_HOST_PROCESS_SUPERVISOR_TEST_FIXTURE';
const CHILD_ACKNOWLEDGEMENT = 'I_ACKNOWLEDGE_INTERNAL_OFFLINE_HOST_PROCESS_SUPERVISOR_TEST_CHILD';
const PROCESS_NAMES = Object.freeze(['server', 'node-control-api', 'node-control-worker']);
const CAPTURE_MODES = Object.freeze({ pre: 'NO', execution: 'YES', final: 'NO' });
const FIXTURE_ENTRYPOINT = fileURLToPath(import.meta.url);
const FIXTURE_CAPABILITY_ENV = 'SDAR_UAP_OFFLINE_SUPERVISOR_FIXTURE_CAPABILITY';

function isChildInvocation() {
  return (
    process.argv.length === 2 &&
    process.env['SDAR_UAP_OFFLINE_SUPERVISOR_FIXTURE_CHILD'] === CHILD_ACKNOWLEDGEMENT &&
    PROCESS_NAMES.includes(process.env['SDAR_UAP_OFFLINE_SUPERVISOR_FIXTURE_PROCESS_NAME'])
  );
}

async function runChild() {
  const processName = process.env['SDAR_UAP_OFFLINE_SUPERVISOR_FIXTURE_PROCESS_NAME'];
  process.stdout.write(
    `${JSON.stringify({
      event: `offline_fixture.${String(processName)}.ready`,
      processName,
      secretsIncluded: false,
    })}\n`,
  );
  await new Promise((resolveExit) => {
    const interval = globalThis.setInterval(() => undefined, 1_000);
    const shutdown = () => {
      globalThis.clearInterval(interval);
      resolveExit();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

function printResult(result) {
  const source = `${JSON.stringify({ ...result, secretsIncluded: false })}\n`;
  writeFileSync(process.stdout.fd, source, { encoding: 'utf8' });
}

async function openFixture(fixtureRoot) {
  return createOfflineHostProcessSupervisorTestFixture({
    acknowledgement: FIXTURE_ACKNOWLEDGEMENT,
    fixtureCapability: process.env[FIXTURE_CAPABILITY_ENV],
    fixtureEntrypoint: FIXTURE_ENTRYPOINT,
    fixtureRoot,
  });
}

async function prepareCaptureOutput(fixtureRoot, captureName) {
  const capturesRoot = join(fixtureRoot, 'captures');
  try {
    await mkdir(capturesRoot, { mode: 0o700 });
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    )
      throw error;
  }
  const [status, canonical] = await Promise.all([lstat(capturesRoot), realpath(capturesRoot)]);
  if (
    status.isSymbolicLink() ||
    !status.isDirectory() ||
    canonical !== capturesRoot ||
    (status.mode & 0o777) !== 0o700 ||
    (process.getuid !== undefined && status.uid !== process.getuid())
  )
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CAPTURE_ROOT_INVALID');
  const outputPath = resolve(capturesRoot, `${captureName}.json`);
  if (!outputPath.startsWith(`${capturesRoot}/`))
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CAPTURE_PATH_INVALID');
  try {
    await lstat(outputPath);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return Object.freeze({ capturesRoot, outputPath });
    throw error;
  }
  throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CAPTURE_PATH_INVALID');
}

async function validateCaptureOutput(capturesRoot, outputPath) {
  const [rootStatus, rootCanonical, outputStatus, outputCanonical] = await Promise.all([
    lstat(capturesRoot),
    realpath(capturesRoot),
    lstat(outputPath),
    realpath(outputPath),
  ]);
  if (
    rootStatus.isSymbolicLink() ||
    !rootStatus.isDirectory() ||
    rootCanonical !== capturesRoot ||
    (rootStatus.mode & 0o777) !== 0o700 ||
    outputStatus.isSymbolicLink() ||
    !outputStatus.isFile() ||
    (outputStatus.mode & 0o777) !== 0o600 ||
    !outputCanonical.startsWith(`${capturesRoot}/`) ||
    (process.getuid !== undefined &&
      (rootStatus.uid !== process.getuid() || outputStatus.uid !== process.getuid()))
  )
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CAPTURE_PATH_INVALID');
}

async function runCli() {
  const arguments_ = process.argv.slice(2);
  if (
    arguments_.length === 3 &&
    arguments_[0] === '--acknowledge-offline-fixture' &&
    arguments_[1] === FIXTURE_ACKNOWLEDGEMENT &&
    arguments_[2] === 'init'
  ) {
    const fixture = await openFixture(null);
    await printResult({ status: 'initialized', fixtureRoot: fixture.fixtureRoot });
    return;
  }
  if (
    arguments_.length < 5 ||
    arguments_[0] !== '--acknowledge-offline-fixture' ||
    arguments_[1] !== FIXTURE_ACKNOWLEDGEMENT ||
    arguments_[2] !== '--fixture-root' ||
    typeof arguments_[3] !== 'string'
  )
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_ARGUMENT_INVALID');
  const fixture = await openFixture(arguments_[3]);
  const command = arguments_[4];
  const commandArguments = arguments_.slice(5);
  if (command === 'start' && commandArguments.length === 0) {
    await printResult(await fixture.startProcesses());
    return;
  }
  if (command === 'status' && commandArguments.length === 0) {
    await printResult(await fixture.processStatus());
    return;
  }
  if (command === 'issued-id' && commandArguments.length === 0) {
    await printResult({
      status: 'issued',
      simulationRunId: await fixture.issuedSimulationRunId(),
    });
    return;
  }
  if (command === 'restart-server') {
    const request = parseRestartServerArguments(commandArguments);
    await printResult(
      await fixture.restartServer(
        request.sideEffects,
        request.acknowledgement,
        request.simulationRunId,
      ),
    );
    return;
  }
  if (
    command === 'capture' &&
    commandArguments.length === 2 &&
    Object.hasOwn(CAPTURE_MODES, commandArguments[1]) &&
    CAPTURE_MODES[commandArguments[1]] === commandArguments[0]
  ) {
    const { capturesRoot, outputPath } = await prepareCaptureOutput(
      fixture.fixtureRoot,
      commandArguments[1],
    );
    const result = await captureB02SupervisorState(commandArguments[0], outputPath, {
      getStatus: fixture.processStatus,
      expectedSimulationRunId:
        commandArguments[0] === 'YES' ? await fixture.issuedSimulationRunId() : undefined,
      environment: Object.freeze({}),
    });
    await validateCaptureOutput(capturesRoot, outputPath);
    await printResult({
      status: 'captured',
      sideEffects: result.sideEffects,
      outputPath,
    });
    return;
  }
  if (command === 'stop' && commandArguments.length === 0) {
    await printResult(await fixture.stopProcesses());
    return;
  }
  throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_ARGUMENT_INVALID');
}

try {
  if (isChildInvocation()) await runChild();
  else await runCli();
} catch (error) {
  writeFileSync(
    process.stderr.fd,
    `${error instanceof Error ? error.message : 'UAP_OFFLINE_FIXTURE_FAILED'}\n`,
    { encoding: 'utf8' },
  );
  process.exitCode = 2;
}
