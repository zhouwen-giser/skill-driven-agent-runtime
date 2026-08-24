#!/usr/bin/env -S pnpm exec tsx

import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

import {
  UgvB02SourceRecoveryError,
  recoverUgvB02SourceAuthority,
  ugvB02SourceRecoveryConfigurationFromEnvironment,
  validateUgvB02SourceRecoveryReport,
  verifyUgvB02SourceRecoveryReplayAuthority,
} from '../../apps/node-control-acceptance/src/ugv-agent-profile-b02-source-recovery-driver.ts';
import { validateIssuedB02AttemptIdentity } from './b02-attempt-identity.mjs';
import { captureB02SupervisorState, validateB02SupervisorState } from './b02-supervisor-state.mjs';
import { sha256CanonicalJson } from './evidence-files.mjs';
import { processStatus } from './host-process-supervisor.mjs';
import { writePrivateLedger } from './provider-ledger.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const STATE_ROOT = `/tmp/sdar-uap-p3-b01-${String(process.getuid?.() ?? 0)}`;
const REPORT_ROOT = resolve(REPOSITORY_ROOT, 'reports/ugv-agent-profile-simulation');
const MAX_PRIVATE_EVIDENCE_BYTES = 2 * 1024 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REPORT_ENVELOPE_SCHEMA = 'sdar.ugv-agent-profile.b02-source-recovery-envelope/v1';

export async function runB02SourceAuthorityRecovery(environment = process.env, dependencies = {}) {
  if (environment.ALLOW_UGV_SIMULATION_SIDE_EFFECTS !== undefined)
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_SIDE_EFFECT_AUTHORITY_NOT_ISOLATED',
      'Invoke Source recovery with ALLOW_UGV_SIMULATION_SIDE_EFFECTS explicitly absent.',
    );
  const configuration = await ugvB02SourceRecoveryConfigurationFromEnvironment(environment);
  const stateRoot = resolve(dependencies.stateRoot ?? STATE_ROOT);
  const reportRoot = resolve(dependencies.reportRoot ?? REPORT_ROOT);
  const supervisorCapturePath = join(
    stateRoot,
    'b02',
    'source-recovery-supervisor',
    `${configuration.attemptId}.json`,
  );
  const reportPath = join(
    stateRoot,
    'b02',
    'source-recovery-reports',
    `${configuration.attemptId}.json`,
  );
  const validateIdentity =
    dependencies.validateIssuedAttemptIdentity ?? validateIssuedB02AttemptIdentity;
  let authorization;
  try {
    authorization = validateRunnerAuthorization(
      await validateIdentity(configuration.attemptId, { stateRoot, reportRoot }),
      configuration.attemptId,
    );
  } catch (error) {
    if (error instanceof UgvB02SourceRecoveryError) throw error;
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_ATTEMPT_NOT_AUTHORIZED',
      'The append-only issued B02 attempt identity could not be revalidated.',
      { cause: error },
    );
  }
  const supervisor = await establishSupervisorNo(
    supervisorCapturePath,
    authorization.bootstrapRunId,
    dependencies,
  );
  const existingEnvelope = await readPrivateJsonIfExists(reportPath);
  if (existingEnvelope !== undefined)
    return verifyExistingReplay(
      existingEnvelope,
      authorization,
      configuration,
      reportPath,
      dependencies,
    );

  const recoverSource = dependencies.recoverSource ?? recoverUgvB02SourceAuthority;
  const report = await recoverSource(configuration, {
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
    ...(dependencies.bootstrapSource === undefined
      ? {}
      : { bootstrapSource: dependencies.bootstrapSource }),
    validateIssuedAttemptIdentity: async (attemptId) => {
      if (attemptId !== configuration.attemptId)
        throw new UgvB02SourceRecoveryError(
          'UGV_B02_SOURCE_RECOVERY_ATTEMPT_NOT_AUTHORIZED',
          'The recovery core requested a different issued identity.',
        );
      return authorization;
    },
    captureSupervisorNo: async () => supervisor,
  });
  const reportSha256 = `sha256:${sha256CanonicalJson(report)}`;
  const envelope = Object.freeze({
    schemaVersion: REPORT_ENVELOPE_SCHEMA,
    reportSha256,
    report,
  });
  const writeReport = dependencies.writePrivateReport ?? writePrivateLedger;
  try {
    await writeReport(reportPath, envelope);
    return validatedReplay(envelope, authorization, configuration.attemptId, reportPath);
  } catch (error) {
    if (!isNodeError(error, 'EEXIST'))
      throw new UgvB02SourceRecoveryError(
        'UGV_B02_SOURCE_RECOVERY_REPORT_WRITE_FAILED',
        'The private Source recovery report could not be published first-writer.',
        { cause: error },
      );
    const winner = await readPrivateJsonIfExists(reportPath);
    if (winner === undefined) throw error;
    return verifyExistingReplay(winner, authorization, configuration, reportPath, dependencies);
  }
}

async function verifyExistingReplay(
  envelope,
  authorization,
  configuration,
  reportPath,
  dependencies,
) {
  const replay = validatedReplay(envelope, authorization, configuration.attemptId, reportPath);
  const verifyAuthority =
    dependencies.verifyReplayAuthority ?? verifyUgvB02SourceRecoveryReplayAuthority;
  await verifyAuthority(configuration, replay.report, {
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  });
  return replay;
}

async function establishSupervisorNo(capturePath, expectedBootstrapRunId, dependencies) {
  const existing = await readPrivateJsonIfExists(capturePath);
  const validateSupervisor = dependencies.validateSupervisorState ?? validateB02SupervisorState;
  if (existing !== undefined) {
    const prior = requireValidatedSupervisorNo(
      validateSupervisor,
      existing,
      expectedBootstrapRunId,
    );
    const getStatus = dependencies.currentSupervisorStatus ?? processStatus;
    const current = requireValidatedSupervisorNo(
      validateSupervisor,
      await getStatus(),
      expectedBootstrapRunId,
    );
    if (sha256CanonicalJson(prior) !== sha256CanonicalJson(current))
      throw new UgvB02SourceRecoveryError(
        'UGV_B02_SOURCE_RECOVERY_SUPERVISOR_CAPTURE_DRIFT',
        'The existing supervisor NO capture differs from current formal state.',
      );
    return current;
  }
  const captureSupervisor = dependencies.captureSupervisorNo ?? captureB02SupervisorState;
  try {
    return requireValidatedSupervisorNo(
      validateSupervisor,
      await captureSupervisor('NO', capturePath, dependencies.supervisorDependencies),
      expectedBootstrapRunId,
    );
  } catch (error) {
    if (!isNodeError(error, 'EEXIST')) {
      if (error instanceof UgvB02SourceRecoveryError) throw error;
      throw new UgvB02SourceRecoveryError(
        'UGV_B02_SOURCE_RECOVERY_SUPERVISOR_NOT_NO',
        'The formal supervisor NO capture failed.',
        { cause: error },
      );
    }
    const winner = await readPrivateJsonIfExists(capturePath);
    if (winner === undefined) throw error;
    const prior = requireValidatedSupervisorNo(validateSupervisor, winner, expectedBootstrapRunId);
    const getStatus = dependencies.currentSupervisorStatus ?? processStatus;
    const current = requireValidatedSupervisorNo(
      validateSupervisor,
      await getStatus(),
      expectedBootstrapRunId,
    );
    if (sha256CanonicalJson(prior) !== sha256CanonicalJson(current))
      throw new UgvB02SourceRecoveryError(
        'UGV_B02_SOURCE_RECOVERY_SUPERVISOR_CAPTURE_DRIFT',
        'The winning supervisor NO capture differs from current formal state.',
      );
    return current;
  }
}

function requireValidatedSupervisorNo(validateSupervisor, value, expectedBootstrapRunId) {
  try {
    const capture = validateSupervisor(value, 'NO');
    if (capture.bootstrapRunId !== expectedBootstrapRunId)
      throw new Error('UAP_B02_SUPERVISOR_BOOTSTRAP_IDENTITY_INVALID');
    return capture;
  } catch (error) {
    throw new UgvB02SourceRecoveryError(
      'UGV_B02_SOURCE_RECOVERY_SUPERVISOR_NOT_NO',
      'The current formal supervisor state is not exactly three running processes in NO mode.',
      { cause: error },
    );
  }
}

function validatedReplay(value, authorization, simulationId, reportPath) {
  if (!plainObject(value) || !exactKeys(value, ['report', 'reportSha256', 'schemaVersion']))
    failReplay('UGV_B02_SOURCE_RECOVERY_REPORT_INVALID');
  if (value.schemaVersion !== REPORT_ENVELOPE_SCHEMA || !SHA256.test(value.reportSha256))
    failReplay('UGV_B02_SOURCE_RECOVERY_REPORT_INVALID');
  const report = validateUgvB02SourceRecoveryReport(value.report);
  if (
    report.identityRecordSha256 !== authorization.identityRecordSha256 ||
    report.simulationIdSha256 !== sha256(simulationId) ||
    value.reportSha256 !== `sha256:${sha256CanonicalJson(report)}`
  )
    failReplay('UGV_B02_SOURCE_RECOVERY_REPORT_INVALID');
  return Object.freeze({
    report: Object.freeze(report),
    reportPath,
    reportSha256: value.reportSha256,
  });
}

function validateRunnerAuthorization(value, simulationId) {
  if (
    !plainObject(value) ||
    value.schemaVersion !== 'sdar.ugv-agent-profile.b02-attempt-authorization/v1' ||
    value.status !== 'authorized' ||
    value.task !== 'UAP-P3-B02' ||
    value.kind !== 'recovery_issued' ||
    value.simulationId !== simulationId ||
    typeof value.bootstrapRunId !== 'string' ||
    value.bootstrapRunId.length < 1 ||
    value.bootstrapRunId.length > 256 ||
    !SHA256.test(value.identityRecordSha256) ||
    !plainObject(value.record) ||
    value.record.simulationId !== simulationId ||
    value.record.bootstrapRunId !== value.bootstrapRunId ||
    value.record.recordSha256 !== value.identityRecordSha256
  )
    failReplay('UGV_B02_SOURCE_RECOVERY_ATTEMPT_NOT_AUTHORIZED');
  return Object.freeze(value);
}

async function readPrivateJsonIfExists(path) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return undefined;
    failReplay('UGV_B02_SOURCE_RECOVERY_PRIVATE_EVIDENCE_UNSAFE');
  }
  try {
    const metadata = await handle.stat();
    const getuid = process.getuid?.();
    if (
      !metadata.isFile() ||
      (getuid !== undefined && metadata.uid !== getuid) ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.nlink !== 1 ||
      metadata.size < 2 ||
      metadata.size > MAX_PRIVATE_EVIDENCE_BYTES
    )
      failReplay('UGV_B02_SOURCE_RECOVERY_PRIVATE_EVIDENCE_UNSAFE');
    const source = await handle.readFile({ encoding: 'utf8' });
    if (Buffer.byteLength(source, 'utf8') > MAX_PRIVATE_EVIDENCE_BYTES)
      failReplay('UGV_B02_SOURCE_RECOVERY_PRIVATE_EVIDENCE_UNSAFE');
    try {
      return JSON.parse(source);
    } catch {
      failReplay('UGV_B02_SOURCE_RECOVERY_PRIVATE_EVIDENCE_INVALID');
    }
  } finally {
    await handle.close();
  }
}

function plainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isNodeError(error, code) {
  return typeof error === 'object' && error !== null && error.code === code;
}

function failReplay(code) {
  throw new UgvB02SourceRecoveryError(code, 'Private Source recovery replay evidence is invalid.');
}

async function main() {
  try {
    const result = await runB02SourceAuthorityRecovery(process.env);
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', action: result.report.action, reportSha256: result.reportSha256, secretsIncluded: false })}\n`,
    );
  } catch (error) {
    const code =
      error instanceof UgvB02SourceRecoveryError ? error.code : 'UGV_B02_SOURCE_RECOVERY_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
