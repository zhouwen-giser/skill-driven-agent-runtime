#!/usr/bin/env node

import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { initializeState } from './initialize-state.mjs';
import { writeImmutableAttemptJson } from './evidence-files.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REPORT_ROOT = join(REPOSITORY_ROOT, 'reports/ugv-agent-profile-simulation/attempts');
const KINDS = new Set([
  'preflight',
  'smpp-up',
  'smpp-seed',
  'up',
  'smpp-qualification',
  'sdar-up',
  'bootstrap',
  'readiness',
  'verify',
  'down',
  'clean',
]);
const STAGES = new Set([
  'started',
  'environment',
  'local-baseline',
  'remote-baseline',
  'ports',
  'compose-render',
  'compose-validation',
  'service-start',
  'pms-seed',
  'read-only-qualification',
  'host-processes',
  'authority',
  'readiness',
  'verification',
  'shutdown',
  'volume-cleanup',
  'complete',
]);
const STATUSES = new Set(['passed', 'failed']);
const COMMANDS = new Set([
  'preflight',
  'up-smpp',
  'seed-smpp',
  'up',
  'qualify-smpp',
  'up-sdar',
  'bootstrap-authority',
  'bootstrap',
  'readiness',
  'verify',
  'down',
  'clean',
]);

export async function recordAttempt({
  kind,
  stage,
  status,
  exitCode,
  command,
  stateRoot = undefined,
  reportRoot = REPORT_ROOT,
}) {
  if (
    !KINDS.has(kind) ||
    !STAGES.has(stage) ||
    !STATUSES.has(status) ||
    !Number.isInteger(exitCode) ||
    exitCode < 0 ||
    exitCode > 255 ||
    !COMMANDS.has(command) ||
    (status === 'passed' && exitCode !== 0) ||
    (status === 'failed' && exitCode === 0)
  )
    throw new Error('UAP_ATTEMPT_ARGUMENT_INVALID');
  const state = await initializeState(stateRoot);
  const report = Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.attempt/v1',
    task: 'UAP-P3-B01',
    bootstrapRunId: state.bootstrapRunId,
    kind,
    command,
    stage,
    status,
    exitCode,
    observedAt: new Date().toISOString(),
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    externalPhysicalMutationAuthorized: false,
    activityAssessment: 'not_assessed',
    controlPlaneMutationAttempted: new Set([
      'smpp-up',
      'smpp-seed',
      'up',
      'sdar-up',
      'bootstrap',
      'readiness',
      'verify',
    ]).has(kind),
    localMutationAttempted: true,
    localMutationScope:
      kind === 'preflight'
        ? 'private_run_identity_credentials_and_evidence'
        : 'task_owned_state_process_compose_or_evidence',
    simulationSideEffectsEnabled: false,
    secretsIncluded: false,
    endpointsIncluded: false,
    modelConfigurationIncluded: false,
    ...(stage === 'remote-baseline' && status === 'failed'
      ? {
          minimumUnblock:
            'Restore read-only access to the configured SMPP origin, then rerun preflight.',
        }
      : {}),
  });
  const target = await writeImmutableAttemptJson(
    reportRoot,
    `${kind}-${state.bootstrapRunId}`,
    report,
  );
  return Object.freeze({ target, report });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 7) throw new Error('UAP_ATTEMPT_ARGUMENT_INVALID');
    const result = await recordAttempt({
      kind: process.argv[2],
      stage: process.argv[3],
      status: process.argv[4],
      exitCode: Number(process.argv[5]),
      command: process.argv[6],
    });
    process.stdout.write(
      `${JSON.stringify({ status: 'recorded', report: result.target, secretsIncluded: false })}\n`,
    );
  } catch {
    process.stderr.write('UAP_ATTEMPT_RECORD_FAILED\n');
    process.exitCode = 2;
  }
}
