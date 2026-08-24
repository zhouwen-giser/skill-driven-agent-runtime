#!/usr/bin/env node

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { processStatus } from './host-process-supervisor.mjs';
import { writePrivateLedger } from './provider-ledger.mjs';

const SUPERVISOR_STATUS_SCHEMA = 'sdar.ugv-agent-profile.host-process-status/v2';
const SUPERVISOR_STATUS_KEYS = Object.freeze([
  'schemaVersion',
  'status',
  'processCount',
  'sideEffects',
  'bootstrapRunId',
  'manifestRevision',
  'activeSimulationRunId',
  'processIdentitySha256',
]);
const PROCESS_IDENTITY_KEYS = Object.freeze(['server', 'nodeControlApi', 'nodeControlWorker']);
const PREFIXED_SHA256 = /^sha256:[a-f0-9]{64}$/u;
const B02_SIMULATION_RUN_ID = /^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u;

export function validateB02SupervisorState(value, expectedSideEffects, expectedSimulationRunId) {
  const expectedActiveSimulationRunId =
    expectedSideEffects === 'NO'
      ? null
      : typeof expectedSimulationRunId === 'string' &&
          B02_SIMULATION_RUN_ID.test(expectedSimulationRunId)
        ? expectedSimulationRunId
        : undefined;
  if (
    !['NO', 'YES'].includes(expectedSideEffects) ||
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('\u0000') !==
      [...SUPERVISOR_STATUS_KEYS].sort().join('\u0000') ||
    value.schemaVersion !== SUPERVISOR_STATUS_SCHEMA ||
    value.status !== 'running' ||
    value.processCount !== 3 ||
    value.sideEffects !== expectedSideEffects ||
    typeof value.bootstrapRunId !== 'string' ||
    value.bootstrapRunId.length < 1 ||
    value.bootstrapRunId.length > 256 ||
    !Number.isSafeInteger(value.manifestRevision) ||
    value.manifestRevision < 1 ||
    expectedActiveSimulationRunId === undefined ||
    value.activeSimulationRunId !== expectedActiveSimulationRunId ||
    typeof value.processIdentitySha256 !== 'object' ||
    value.processIdentitySha256 === null ||
    Array.isArray(value.processIdentitySha256) ||
    Object.keys(value.processIdentitySha256).sort().join('\u0000') !==
      [...PROCESS_IDENTITY_KEYS].sort().join('\u0000') ||
    PROCESS_IDENTITY_KEYS.some((name) => !PREFIXED_SHA256.test(value.processIdentitySha256[name]))
  )
    throw new Error('UAP_B02_SUPERVISOR_STATE_INVALID');
  return Object.freeze({
    schemaVersion: SUPERVISOR_STATUS_SCHEMA,
    status: 'running',
    processCount: 3,
    sideEffects: expectedSideEffects,
    bootstrapRunId: value.bootstrapRunId,
    manifestRevision: value.manifestRevision,
    activeSimulationRunId: expectedActiveSimulationRunId,
    processIdentitySha256: Object.freeze({
      server: value.processIdentitySha256.server,
      nodeControlApi: value.processIdentitySha256.nodeControlApi,
      nodeControlWorker: value.processIdentitySha256.nodeControlWorker,
    }),
  });
}

export async function captureB02SupervisorState(
  expectedSideEffects,
  outputPath,
  dependencies = {},
) {
  const getStatus = dependencies.getStatus ?? processStatus;
  const write = dependencies.write ?? writePrivateLedger;
  const environment = dependencies.environment ?? process.env;
  const expectedSimulationRunId =
    dependencies.expectedSimulationRunId ?? environment.UGV_SIMULATION_RUN_ID;
  const status = validateB02SupervisorState(
    await getStatus(),
    expectedSideEffects,
    expectedSimulationRunId,
  );
  await write(outputPath, status);
  return status;
}

async function main() {
  if (process.argv.length !== 5 || process.argv[2] !== 'capture')
    throw new Error('Usage: b02-supervisor-state.mjs capture <NO|YES> <private-output-file>');
  const result = await captureB02SupervisorState(process.argv[3], process.argv[4]);
  process.stdout.write(
    `${JSON.stringify({ status: 'captured', sideEffects: result.sideEffects, secretsIncluded: false })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'UAP_B02_SUPERVISOR_STATE_FAILED'}\n`,
    );
    process.exitCode = 1;
  });
}
