#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { sha256CanonicalJson } from './evidence-files.mjs';
import { readExistingState } from './initialize-state.mjs';
import {
  assessUgvB02TerminalProviderSafeWindow,
  assessUgvB02ZeroDispatchWindow,
  UGV_B02_ZERO_DISPATCH_DELTA_KEYS,
  validateUgvB02ProviderLedger,
} from './provider-ledger.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEFAULT_REPORT_ROOT = resolve(REPOSITORY_ROOT, 'reports/ugv-agent-profile-simulation');
const SIMULATION_ID = /^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const PRECONFIRMATION_STRUCTURAL_DELTA_NAMES = new Set([
  'sdarInitialTaskAdmissions',
  'sdarCapabilityAttempts',
  'sdarTasks',
  'sdarGoals',
  'sdarGoalContracts',
  'sdarUserGoalPlans',
]);
const PRECONFIRMATION_PLANNED_DELTA_NAMES = new Set([
  'sdarWorkflowPlans',
  'sdarSkillExecutions',
  'sdarSkillExecutionEvents',
]);
const RECOVERABLE_FAILURE_STAGES = new Set([
  'validate-local-environment',
  'preflight-no',
  'create-official-run',
  'recover-source-under-no',
  'authority-runway-gate',
  'seal-authority-runway-gate',
  'provider-read-only-qualification',
  'capture-clean-pre-ledger',
  'validate-clean-pre-ledger',
  'enable-server-side-effects',
  'prepare-unique-admission',
  'confirm-and-observe',
  'execution-complete',
  'post-restore-log-scan',
  'post-restore-smpp-scan',
  'post-restore-sdar-scan',
  'validate-private-report',
  'publish-canonical-report',
  'incomplete',
]);

export class UapB02AttemptIdentityError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = 'UapB02AttemptIdentityError';
    this.code = code;
  }
}

export function deriveB02AdmissionIdempotencyKey(simulationId) {
  if (!SIMULATION_ID.test(simulationId)) fail('UAP_B02_SIMULATION_ID_REQUIRED');
  return `uap-p3-b02-a2a-${createHash('sha256').update(simulationId).digest('hex')}`;
}

export async function issueB02AttemptIdentity(input, options = {}) {
  if (
    !exactKeys(input, [
      'afterLedgerPath',
      'beforeLedgerPath',
      'failureReportPath',
      'predecessorSimulationId',
    ]) ||
    !SIMULATION_ID.test(input.predecessorSimulationId) ||
    typeof input.failureReportPath !== 'string' ||
    typeof input.beforeLedgerPath !== 'string' ||
    typeof input.afterLedgerPath !== 'string'
  )
    fail('UAP_B02_RECOVERY_INPUT_INVALID');
  const state = await readExistingState(options.stateRoot);
  const stateRoot = state.root;
  const reportRoot = resolve(options.reportRoot ?? DEFAULT_REPORT_ROOT);
  const attemptsRoot = resolve(reportRoot, 'attempts');
  const predecessor = input.predecessorSimulationId;
  const existingIdentities = await readIdentityInventory(state, reportRoot, predecessor);
  if (predecessor !== state.simulationRunId && !existingIdentities.bySimulation.has(predecessor))
    fail('UAP_B02_SIMULATION_ID_NOT_AUTHORIZED');
  await assertNoPassedB02Attempt(reportRoot);
  const predecessorRunRoot = resolve(stateRoot, 'b02', predecessor);
  await assertPrivateDirectory(predecessorRunRoot, 'UAP_B02_RECOVERY_PREDECESSOR_RUN_INVALID');
  const failure = await readFailureReport(
    input.failureReportPath,
    attemptsRoot,
    predecessor,
    state.bootstrapRunId,
  );
  const beforePath = resolve(input.beforeLedgerPath);
  const afterPath = resolve(input.afterLedgerPath);
  if (
    beforePath !== resolve(predecessorRunRoot, 'provider-ledger-pre.json') ||
    dirname(afterPath) !== predecessorRunRoot ||
    basename(afterPath) !== 'provider-ledger-recovery.json'
  )
    fail('UAP_B02_RECOVERY_LEDGER_PATH_INVALID');
  const [beforeLedgerSource, afterLedgerSource] = await Promise.all([
    readPrivateSource(beforePath, 32 * 1024 * 1024, 'UAP_B02_RECOVERY_LEDGER_INVALID'),
    readPrivateSource(afterPath, 32 * 1024 * 1024, 'UAP_B02_RECOVERY_LEDGER_INVALID'),
  ]);
  const beforeLedger = parseLedger(beforeLedgerSource);
  const afterLedger = parseLedger(afterLedgerSource);
  const assessment = assessRecoveryWindow(beforeLedger, afterLedger, predecessor);
  const createdAt = validNow(options.now);
  const createdAtMs = Date.parse(createdAt);
  const beforeAt = Date.parse(assessment.beforeCapturedAt);
  const afterAt = Date.parse(assessment.afterCapturedAt);
  const failureAt = Date.parse(failure.report.generatedAt);
  if (failureAt < beforeAt - 1_000 || failureAt > afterAt + 1_000 || createdAtMs < afterAt - 1_000)
    fail('UAP_B02_RECOVERY_LEDGER_WINDOW_INVALID');
  const simulationId = createSimulationId(options.randomBytes);
  if (
    simulationId === predecessor ||
    simulationId === state.simulationRunId ||
    (await pathExists(resolve(stateRoot, 'b02', simulationId)))
  )
    fail('UAP_B02_RECOVERY_ID_GENERATION_FAILED');
  const predecessorKey = deriveB02AdmissionIdempotencyKey(predecessor);
  const idempotencyKey = deriveB02AdmissionIdempotencyKey(simulationId);
  if (idempotencyKey === predecessorKey) fail('UAP_B02_RECOVERY_ID_GENERATION_FAILED');
  const publicReport = recoveryReconciliationReport({
    createdAt,
    predecessor,
    simulationId,
    failure,
    assessment,
  });
  const publicRelativePath = `attempts/uap-p3-b02-recovery-reconciliation-${simulationId}.redacted.json`;
  const unsignedRecord = Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.b02-attempt-identity/v1',
    status: 'issued',
    task: 'UAP-P3-B02',
    bootstrapRunId: state.bootstrapRunId,
    simulationId,
    predecessorSimulationId: predecessor,
    a2aIdempotencyKey: idempotencyKey,
    predecessorA2aIdempotencyKey: predecessorKey,
    createdAt,
    failureReport: Object.freeze({
      relativePath: failure.relativePath,
      sha256: failure.sha256,
      generatedAt: failure.report.generatedAt,
    }),
    zeroDispatchAssessment: Object.freeze({
      classification: assessment.classification,
      resultCode: assessment.resultCode,
      beforeLedgerRelativePath: relative(stateRoot, beforePath),
      afterLedgerRelativePath: relative(stateRoot, afterPath),
      beforeLedgerSha256: assessment.beforeLedgerSha256,
      afterLedgerSha256: assessment.afterLedgerSha256,
      deltas: assessment.deltas,
      beforeCapturedAt: assessment.beforeCapturedAt,
      afterCapturedAt: assessment.afterCapturedAt,
    }),
    reconciliationAttempt: Object.freeze({
      relativePath: publicRelativePath,
      sha256: `sha256:${sha256CanonicalJson(publicReport)}`,
    }),
  });
  const record = Object.freeze({
    ...unsignedRecord,
    recordSha256: `sha256:${sha256CanonicalJson(unsignedRecord)}`,
  });
  const identityRoot = resolve(stateRoot, 'b02', 'attempt-identities');
  const identityStagingRoot = resolve(stateRoot, 'b02', 'attempt-identity-staging');
  const publicStagingRoot = resolve(attemptsRoot, '.uap-p3-b02-recovery-staging');
  await ensurePrivateDirectory(resolve(stateRoot, 'b02'));
  await ensurePrivateDirectory(identityRoot);
  await ensurePrivateDirectory(identityStagingRoot);
  await ensurePrivateDirectory(publicStagingRoot);
  const recordPath = resolve(identityRoot, `${predecessor}.json`);
  await assertNoPassedB02Attempt(reportRoot);
  let published;
  try {
    published = await publishAttemptIdentityPair(
      {
        record,
        recordPath,
        identityStagingRoot,
        publicStagingRoot,
        stateRoot,
        reportRoot,
      },
      options,
    );
  } catch (error) {
    if (
      error instanceof UapB02AttemptIdentityError ||
      (error instanceof Error && error.message === 'UAP_B02_RECOVERY_ALREADY_ISSUED')
    )
      throw error;
    fail('UAP_B02_RECOVERY_PUBLICATION_FAILED', error);
  }
  const authorized = await authorizeB02SimulationId(published.record.simulationId, {
    stateRoot,
    reportRoot,
  });
  return Object.freeze({
    simulationId: authorized.simulationId,
    a2aIdempotencyKey: published.record.a2aIdempotencyKey,
    predecessorSimulationId: predecessor,
    recordPath,
    reconciliationAttemptPath: published.publicPath,
    record: published.record,
    publicReport: published.publicReport,
  });
}

export async function authorizeB02SimulationId(simulationId, options = {}) {
  if (typeof simulationId !== 'string' || !SIMULATION_ID.test(simulationId))
    fail('UAP_B02_SIMULATION_ID_REQUIRED');
  const state = await readExistingState(options.stateRoot);
  const reportRoot = resolve(options.reportRoot ?? DEFAULT_REPORT_ROOT);
  const identities = await readIdentityInventory(state, reportRoot);
  if (simulationId === state.simulationRunId)
    return Object.freeze({
      simulationId,
      kind: 'initial_reserved',
      bootstrapRunId: state.bootstrapRunId,
    });
  const selected = identities.bySimulation.get(simulationId);
  if (selected === undefined) fail('UAP_B02_SIMULATION_ID_NOT_AUTHORIZED');
  return Object.freeze({
    simulationId,
    kind: 'recovery_issued',
    bootstrapRunId: state.bootstrapRunId,
    identityRecordPath: resolve(
      identities.identityRoot,
      `${selected.predecessorSimulationId}.json`,
    ),
    record: selected,
  });
}

async function readIdentityInventory(state, reportRoot, pendingPredecessor) {
  const identityRoot = resolve(state.root, 'b02', 'attempt-identities');
  let entries;
  try {
    entries = await readdir(identityRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT')
      return Object.freeze({ identityRoot, bySimulation: new Map() });
    throw error;
  }
  if (
    entries.length > 1_024 ||
    entries.some(
      (entry) =>
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !/^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}\.json$/u.test(entry.name),
    )
  )
    fail('UAP_B02_ATTEMPT_IDENTITY_STATE_INVALID');
  const records = await Promise.all(
    entries.map((entry) =>
      readIdentityRecord(
        resolve(identityRoot, entry.name),
        state.root,
        reportRoot,
        entry.name !== `${String(pendingPredecessor)}.json`,
      ),
    ),
  );
  const bySimulation = new Map(records.map((record) => [record.simulationId, record]));
  if (
    bySimulation.size !== records.length ||
    records.some((record) => record.bootstrapRunId !== state.bootstrapRunId)
  )
    fail('UAP_B02_ATTEMPT_IDENTITY_STATE_INVALID');
  for (const record of records) validateIdentityChain(record, bySimulation, state.simulationRunId);
  return Object.freeze({ identityRoot, bySimulation });
}

export async function validateIssuedB02AttemptIdentity(simulationId, options = {}) {
  const authorized = await authorizeB02SimulationId(simulationId, options);
  if (authorized.kind !== 'recovery_issued') fail('UAP_B02_RECOVERY_ISSUED_IDENTITY_REQUIRED');
  return Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.b02-attempt-authorization/v1',
    status: 'authorized',
    task: 'UAP-P3-B02',
    kind: authorized.kind,
    bootstrapRunId: authorized.bootstrapRunId,
    simulationId: authorized.simulationId,
    predecessorSimulationId: authorized.record.predecessorSimulationId,
    a2aIdempotencyKey: authorized.record.a2aIdempotencyKey,
    identityRecordPath: authorized.identityRecordPath,
    identityRecordSha256: authorized.record.recordSha256,
    record: authorized.record,
  });
}

async function readIdentityRecord(path, stateRoot, reportRoot, validatePublic = true) {
  let record;
  try {
    record = JSON.parse(
      await readPrivateSource(path, 256 * 1024, 'UAP_B02_ATTEMPT_IDENTITY_STATE_INVALID'),
    );
  } catch (error) {
    if (error instanceof UapB02AttemptIdentityError) throw error;
    fail('UAP_B02_ATTEMPT_IDENTITY_STATE_INVALID', error);
  }
  validateIdentityRecord(record, basename(path));
  const unsigned = { ...record };
  delete unsigned.recordSha256;
  if (record.recordSha256 !== `sha256:${sha256CanonicalJson(unsigned)}`)
    fail('UAP_B02_ATTEMPT_IDENTITY_STATE_INVALID');
  const failure = await readFailureReport(
    resolveWithin(reportRoot, record.failureReport.relativePath),
    resolve(reportRoot, 'attempts'),
    record.predecessorSimulationId,
    record.bootstrapRunId,
    false,
  );
  if (
    failure.sha256 !== record.failureReport.sha256 ||
    failure.report.generatedAt !== record.failureReport.generatedAt
  )
    fail('UAP_B02_ATTEMPT_IDENTITY_EVIDENCE_INVALID');
  const beforeSource = await readPrivateSource(
    resolveWithin(stateRoot, record.zeroDispatchAssessment.beforeLedgerRelativePath),
    32 * 1024 * 1024,
    'UAP_B02_ATTEMPT_IDENTITY_EVIDENCE_INVALID',
  );
  const afterSource = await readPrivateSource(
    resolveWithin(stateRoot, record.zeroDispatchAssessment.afterLedgerRelativePath),
    32 * 1024 * 1024,
    'UAP_B02_ATTEMPT_IDENTITY_EVIDENCE_INVALID',
  );
  let assessment;
  try {
    const beforeLedger = parseLedger(beforeSource);
    const afterLedger = parseLedger(afterSource);
    assessment =
      record.zeroDispatchAssessment.classification === 'terminal_provider_safe'
        ? assessUgvB02TerminalProviderSafeWindow(beforeLedger, afterLedger, {
            simulationId: record.predecessorSimulationId,
          })
        : assessUgvB02ZeroDispatchWindow(beforeLedger, afterLedger, {
            simulationId: record.predecessorSimulationId,
          });
  } catch (error) {
    fail('UAP_B02_ATTEMPT_IDENTITY_EVIDENCE_INVALID', error);
  }
  if (
    assessment.beforeLedgerSha256 !== record.zeroDispatchAssessment.beforeLedgerSha256 ||
    assessment.afterLedgerSha256 !== record.zeroDispatchAssessment.afterLedgerSha256 ||
    sha256CanonicalJson(assessment.deltas) !==
      sha256CanonicalJson(record.zeroDispatchAssessment.deltas)
  )
    fail('UAP_B02_ATTEMPT_IDENTITY_EVIDENCE_INVALID');
  if (validatePublic) await validatePublicReconciliation(record, reportRoot);
  return Object.freeze(record);
}

function validateIdentityRecord(record, fileName) {
  if (
    !exactKeys(record, [
      'a2aIdempotencyKey',
      'bootstrapRunId',
      'createdAt',
      'failureReport',
      'predecessorA2aIdempotencyKey',
      'predecessorSimulationId',
      'reconciliationAttempt',
      'recordSha256',
      'schemaVersion',
      'simulationId',
      'status',
      'task',
      'zeroDispatchAssessment',
    ]) ||
    record.schemaVersion !== 'sdar.ugv-agent-profile.b02-attempt-identity/v1' ||
    record.status !== 'issued' ||
    record.task !== 'UAP-P3-B02' ||
    typeof record.bootstrapRunId !== 'string' ||
    !SIMULATION_ID.test(record.simulationId) ||
    !SIMULATION_ID.test(record.predecessorSimulationId) ||
    record.simulationId === record.predecessorSimulationId ||
    fileName !== `${record.predecessorSimulationId}.json` ||
    record.a2aIdempotencyKey !== deriveB02AdmissionIdempotencyKey(record.simulationId) ||
    record.predecessorA2aIdempotencyKey !==
      deriveB02AdmissionIdempotencyKey(record.predecessorSimulationId) ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    !SHA256.test(record.recordSha256) ||
    !exactKeys(record.failureReport, ['generatedAt', 'relativePath', 'sha256']) ||
    !/^attempts\/[A-Za-z0-9._-]+\.redacted\.json$/u.test(record.failureReport.relativePath) ||
    !SHA256.test(record.failureReport.sha256) ||
    !Number.isFinite(Date.parse(record.failureReport.generatedAt)) ||
    !exactKeys(record.reconciliationAttempt, ['relativePath', 'sha256']) ||
    record.reconciliationAttempt.relativePath !==
      `attempts/uap-p3-b02-recovery-reconciliation-${record.simulationId}.redacted.json` ||
    !SHA256.test(record.reconciliationAttempt.sha256) ||
    !validRecoveryAssessment(record.zeroDispatchAssessment, record.predecessorSimulationId) ||
    Date.parse(record.failureReport.generatedAt) <
      Date.parse(record.zeroDispatchAssessment.beforeCapturedAt) - 1_000 ||
    Date.parse(record.failureReport.generatedAt) >
      Date.parse(record.zeroDispatchAssessment.afterCapturedAt) + 1_000 ||
    Date.parse(record.createdAt) < Date.parse(record.zeroDispatchAssessment.afterCapturedAt) - 1_000
  )
    fail('UAP_B02_ATTEMPT_IDENTITY_STATE_INVALID');
}

function validRecoveryAssessment(value, predecessorSimulationId) {
  const classificationValid =
    (value?.classification === 'zero_dispatch' &&
      value?.resultCode === 'UAP_B02_RECOVERY_ZERO_DISPATCH_VERIFIED' &&
      validRecoveryDeltas(value?.deltas)) ||
    (value?.classification === 'terminal_provider_safe' &&
      value?.resultCode === 'UAP_B02_RECOVERY_TERMINAL_PROVIDER_SAFE_VERIFIED' &&
      validTerminalProviderSafeDeltas(value?.deltas));
  return (
    exactKeys(value, [
      'afterCapturedAt',
      'afterLedgerRelativePath',
      'afterLedgerSha256',
      'beforeCapturedAt',
      'beforeLedgerRelativePath',
      'beforeLedgerSha256',
      'classification',
      'deltas',
      'resultCode',
    ]) &&
    classificationValid &&
    value.beforeLedgerRelativePath === `b02/${predecessorSimulationId}/provider-ledger-pre.json` &&
    value.afterLedgerRelativePath ===
      `b02/${predecessorSimulationId}/provider-ledger-recovery.json` &&
    SHA256.test(value.beforeLedgerSha256) &&
    SHA256.test(value.afterLedgerSha256) &&
    exactKeys(value.deltas, UGV_B02_ZERO_DISPATCH_DELTA_KEYS) &&
    [value.beforeCapturedAt, value.afterCapturedAt].every(
      (timestamp) => typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp)),
    ) &&
    Date.parse(value.beforeCapturedAt) < Date.parse(value.afterCapturedAt)
  );
}

function validTerminalProviderSafeDeltas(deltas) {
  const expected = {
    runtimeIdempotencyRecords: 1,
    runtimeProviderTasks: 1,
    runtimeAdmissionIntents: 1,
    adapterExecutions: 1,
    adapterDeviceToolCalls: 4,
    adapterMutationJournal: 2,
    adapterCommandAcks: 0,
    sdarModelInvocations: 1,
    sdarMcpInvocations: 3,
    sdarStageModelRoutes: 0,
    sdarModelProviders: 0,
    sdarInitialTaskAdmissions: 1,
    sdarCapabilityAttempts: 1,
    sdarGovernedConfirmations: 1,
    sdarRemoteAdmissionIntents: 1,
    sdarContinuationSnapshots: 0,
    sdarContinuationAttempts: 0,
    sdarTerminalOutcomes: 0,
    sdarWorkflowNodeEvents: 0,
    sdarTasks: 1,
    sdarGoals: 1,
    sdarGoalContracts: 1,
    sdarUserGoalPlans: 1,
    sdarWorkflowPlans: 1,
    sdarWorkflowInstances: 1,
    sdarSkillExecutions: 1,
    sdarSkillExecutionEvents: 13,
    sdarProcessedResults: 0,
  };
  return Object.entries(expected).every(([name, count]) => deltas?.[name] === count);
}

function validRecoveryDeltas(deltas) {
  const deviceReads = deltas.adapterDeviceToolCalls;
  const registryReads = deltas.sdarMcpInvocations;
  const structuralCounts = [...PRECONFIRMATION_STRUCTURAL_DELTA_NAMES].map((name) => deltas[name]);
  const structuralCount = structuralCounts[0];
  const workflowPlanCount = deltas.sdarWorkflowPlans;
  const skillExecutionCount = deltas.sdarSkillExecutions;
  const skillExecutionEventCount = deltas.sdarSkillExecutionEvents;
  const plannedBoundary =
    workflowPlanCount === 0 && skillExecutionCount === 0 && skillExecutionEventCount === 0
      ? true
      : structuralCount === 1 &&
        workflowPlanCount === 1 &&
        skillExecutionCount === 1 &&
        skillExecutionEventCount === 11;
  const confirmedPretransportFailure =
    deviceReads === 2 &&
    registryReads === 2 &&
    deltas.sdarModelInvocations === 1 &&
    structuralCounts.every((count) => count === 1) &&
    workflowPlanCount === 1 &&
    skillExecutionCount === 1 &&
    skillExecutionEventCount === 13 &&
    deltas.sdarGovernedConfirmations === 1 &&
    deltas.sdarRemoteAdmissionIntents === 1 &&
    deltas.sdarWorkflowInstances === 1 &&
    Object.entries(deltas).every(([name, count]) =>
      [
        'adapterDeviceToolCalls',
        'sdarModelInvocations',
        'sdarMcpInvocations',
        'sdarGovernedConfirmations',
        'sdarRemoteAdmissionIntents',
        'sdarWorkflowInstances',
      ].includes(name) ||
      PRECONFIRMATION_STRUCTURAL_DELTA_NAMES.has(name) ||
      PRECONFIRMATION_PLANNED_DELTA_NAMES.has(name)
        ? true
        : count === 0,
    );
  if (confirmedPretransportFailure) return true;
  return (
    Number.isInteger(deviceReads) &&
    deviceReads >= 0 &&
    deviceReads <= 1 &&
    registryReads === deviceReads &&
    Number.isInteger(structuralCount) &&
    structuralCount >= 0 &&
    structuralCount <= 1 &&
    structuralCount <= deviceReads &&
    structuralCounts.every((count) => count === structuralCount) &&
    plannedBoundary &&
    Object.entries(deltas).every(([name, count]) =>
      name === 'adapterDeviceToolCalls' ||
      name === 'sdarMcpInvocations' ||
      PRECONFIRMATION_STRUCTURAL_DELTA_NAMES.has(name) ||
      PRECONFIRMATION_PLANNED_DELTA_NAMES.has(name)
        ? true
        : count === 0,
    )
  );
}

function validateIdentityChain(record, records, initialId, visiting = new Set()) {
  if (record.predecessorSimulationId === initialId) return;
  if (visiting.has(record.simulationId)) fail('UAP_B02_ATTEMPT_IDENTITY_STATE_INVALID');
  const predecessor = records.get(record.predecessorSimulationId);
  if (predecessor === undefined) fail('UAP_B02_ATTEMPT_IDENTITY_STATE_INVALID');
  visiting.add(record.simulationId);
  validateIdentityChain(predecessor, records, initialId, visiting);
  visiting.delete(record.simulationId);
}

async function validatePublicReconciliation(record, reportRoot) {
  const expected = reconciliationReportForRecord(record);
  const target = resolveWithin(reportRoot, record.reconciliationAttempt.relativePath);
  let actual;
  try {
    actual = JSON.parse(
      await readPrivateSource(target, 256 * 1024, 'UAP_B02_ATTEMPT_IDENTITY_EVIDENCE_INVALID'),
    );
  } catch (error) {
    if (error instanceof UapB02AttemptIdentityError) throw error;
    fail('UAP_B02_ATTEMPT_IDENTITY_EVIDENCE_INVALID', error);
  }
  if (
    `sha256:${sha256CanonicalJson(actual)}` !== record.reconciliationAttempt.sha256 ||
    sha256CanonicalJson(actual) !== sha256CanonicalJson(expected)
  )
    fail('UAP_B02_ATTEMPT_IDENTITY_EVIDENCE_INVALID');
}

function reconciliationReportForRecord(record) {
  return recoveryReconciliationReport({
    createdAt: record.createdAt,
    predecessor: record.predecessorSimulationId,
    simulationId: record.simulationId,
    failure: {
      relativePath: record.failureReport.relativePath,
      sha256: record.failureReport.sha256,
      generatedAt: record.failureReport.generatedAt,
    },
    assessment: record.zeroDispatchAssessment,
  });
}

function recoveryReconciliationReport({
  createdAt,
  predecessor,
  simulationId,
  failure,
  assessment,
}) {
  const terminalProviderSafe = assessment.classification === 'terminal_provider_safe';
  return Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.b02-recovery-reconciliation/v1',
    status: terminalProviderSafe ? 'verified_terminal_provider_safe' : 'verified_zero_dispatch',
    task: 'UAP-P3-B02',
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    generatedAt: createdAt,
    predecessorSimulationIdSha256: rawSha256(predecessor),
    issuedSimulationIdSha256: rawSha256(simulationId),
    failureReport: Object.freeze({
      relativePath: failure.relativePath,
      sha256: failure.sha256,
    }),
    privateLedgers: Object.freeze({
      beforeSha256: assessment.beforeLedgerSha256,
      afterSha256: assessment.afterLedgerSha256,
    }),
    [terminalProviderSafe ? 'terminalSafeAssessment' : 'zeroDispatchAssessment']: Object.freeze({
      classification: assessment.classification,
      resultCode: assessment.resultCode,
      deltas: assessment.deltas,
    }),
    ledgerObservationWindow: Object.freeze({
      beforeCapturedAt: assessment.beforeCapturedAt,
      failureGeneratedAt: failure.report?.generatedAt ?? failure.generatedAt,
      afterCapturedAt: assessment.afterCapturedAt,
      assessedAt: createdAt,
    }),
    supervisor: Object.freeze({ restoredSideEffects: 'NO', restoreVerified: true }),
    issuanceCode: 'UAP_B02_RECOVERY_IDENTITY_ISSUED',
    secretsIncluded: false,
    endpointsIncluded: false,
    simulationIdentifiersIncluded: true,
    downstreamDeviceIdentifiersIncluded: false,
    providerIdentifiersIncluded: false,
  });
}

async function readFailureReport(
  path,
  attemptsRoot,
  predecessor,
  bootstrapRunId,
  requireSoleReport = true,
) {
  const target = resolve(path);
  if (
    dirname(target) !== attemptsRoot ||
    !basename(target).startsWith(`uap-p3-b02-failure-${predecessor}-`) ||
    !basename(target).endsWith('.redacted.json')
  )
    fail('UAP_B02_RECOVERY_FAILURE_REPORT_PATH_INVALID');
  if (requireSoleReport) {
    const matching = (await readdir(attemptsRoot)).filter(
      (name) =>
        name.startsWith(`uap-p3-b02-failure-${predecessor}-`) && name.endsWith('.redacted.json'),
    );
    if (matching.length !== 1 || resolve(attemptsRoot, matching[0]) !== target)
      fail('UAP_B02_RECOVERY_FAILURE_REPORT_AMBIGUOUS');
  }
  const source = await readPrivateSource(
    target,
    256 * 1024,
    'UAP_B02_RECOVERY_FAILURE_REPORT_INVALID',
  );
  let report;
  try {
    report = JSON.parse(source);
  } catch (error) {
    fail('UAP_B02_RECOVERY_FAILURE_REPORT_INVALID', error);
  }
  if (
    report?.schemaVersion !== 'sdar.ugv-agent-profile.a2a-move-failure/v1' ||
    report?.status !== 'failed' ||
    report?.task !== 'UAP-P3-B02' ||
    report?.bootstrapRunId !== bootstrapRunId ||
    report?.simulationId !== predecessor ||
    !RECOVERABLE_FAILURE_STAGES.has(report?.stage) ||
    report?.sideEffectWindow?.restoredSideEffects !== 'NO' ||
    report?.sideEffectWindow?.restoreVerified !== true ||
    report?.activityAssessment !== 'unknown_unless_private_ledgers_are_reconciled' ||
    report?.productionEligible !== false ||
    report?.physicalVehicleQualified !== false ||
    report?.secretsIncluded !== false ||
    report?.endpointsIncluded !== false ||
    !Number.isFinite(Date.parse(report?.generatedAt))
  )
    fail('UAP_B02_RECOVERY_FAILURE_REPORT_INVALID');
  return Object.freeze({
    relativePath: `attempts/${basename(target)}`,
    sha256: rawSha256(source),
    report: Object.freeze(report),
  });
}

async function assertNoPassedB02Attempt(reportRoot) {
  const canonicalPath = resolve(reportRoot, 'uap-p3-b02-verification.json');
  const canonical = await optionalPrivateJson(canonicalPath);
  if (
    canonical?.schemaVersion === 'sdar.ugv-agent-profile.a2a-move-index/v1' &&
    canonical?.status === 'passed' &&
    canonical?.task === 'UAP-P3-B02'
  )
    fail('UAP_B02_RECOVERY_AFTER_PASS_FORBIDDEN');
  const attemptsRoot = resolve(reportRoot, 'attempts');
  let entries = [];
  try {
    entries = await readdir(attemptsRoot, { withFileTypes: true });
  } catch (error) {
    if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.redacted.json'))
      continue;
    const value = await optionalPrivateJson(resolve(attemptsRoot, entry.name));
    if (
      value?.schemaVersion === 'sdar.ugv-agent-profile.a2a-move/v1' &&
      value?.status === 'passed' &&
      value?.task === 'UAP-P3-B02'
    )
      fail('UAP_B02_RECOVERY_AFTER_PASS_FORBIDDEN');
  }
}

async function optionalPrivateJson(path) {
  try {
    return JSON.parse(
      await readPrivateSource(path, 8 * 1024 * 1024, 'UAP_B02_RECOVERY_PASS_STATE_INVALID'),
    );
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) fail('UAP_B02_RECOVERY_PASS_STATE_INVALID', error);
    throw error;
  }
}

function parseLedger(source) {
  try {
    return validateUgvB02ProviderLedger(JSON.parse(source));
  } catch (error) {
    if (error instanceof UapB02AttemptIdentityError) throw error;
    fail('UAP_B02_RECOVERY_LEDGER_INVALID', error);
  }
}

function assessRecoveryWindow(beforeLedger, afterLedger, predecessorSimulationId) {
  try {
    return assessUgvB02ZeroDispatchWindow(beforeLedger, afterLedger, {
      simulationId: predecessorSimulationId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UAP_B02_RECOVERY_NONZERO_DISPATCH') {
      try {
        return assessUgvB02TerminalProviderSafeWindow(beforeLedger, afterLedger, {
          simulationId: predecessorSimulationId,
        });
      } catch (terminalError) {
        if (
          terminalError instanceof Error &&
          terminalError.message === 'UAP_B02_RECOVERY_LEDGER_WINDOW_INVALID'
        )
          fail(terminalError.message, terminalError);
        if (
          terminalError instanceof Error &&
          terminalError.message === 'UAP_B02_RECOVERY_TERMINAL_SAFETY_INVALID'
        )
          fail('UAP_B02_RECOVERY_NONZERO_DISPATCH', terminalError);
        fail('UAP_B02_RECOVERY_LEDGER_INVALID', terminalError);
      }
    }
    if (
      error instanceof Error &&
      ['UAP_B02_RECOVERY_LEDGER_WINDOW_INVALID', 'UAP_B02_RECOVERY_NONZERO_DISPATCH'].includes(
        error.message,
      )
    )
      fail(error.message, error);
    fail('UAP_B02_RECOVERY_LEDGER_INVALID', error);
  }
}

async function readPrivateSource(path, maximumBytes, code) {
  const target = resolve(path);
  const before = await lstat(target);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    (before.mode & 0o777) !== 0o600 ||
    (process.getuid !== undefined && before.uid !== process.getuid()) ||
    before.size < 2 ||
    before.size > maximumBytes
  )
    fail(code);
  let handle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const after = await handle.stat();
    if (after.dev !== before.dev || after.ino !== before.ino) fail(code);
    return await handle.readFile({ encoding: 'utf8' });
  } catch (error) {
    if (error instanceof UapB02AttemptIdentityError) throw error;
    fail(code, error);
  } finally {
    await handle?.close();
  }
}

async function publishAttemptIdentityPair(input, options) {
  const transactionId = `${String(process.pid)}-${randomBytes(12).toString('hex')}`;
  const privateCandidate = resolve(
    input.identityStagingRoot,
    `${input.record.predecessorSimulationId}.${transactionId}.candidate`,
  );
  let privateCandidateExists = false;
  let winner;
  try {
    await publicationStep(options, 'write-private-candidate', async () => {
      await writeExclusivePrivateFile(privateCandidate, input.record, () => {
        privateCandidateExists = true;
      });
    });
    await publicationStep(options, 'link-private', async () => {
      try {
        await link(privateCandidate, input.recordPath);
      } catch (error) {
        if (isNodeError(error) && error.code === 'EEXIST') return;
        throw error;
      }
    });
    await publicationStep(options, 'fsync-private-after-link', () =>
      syncDirectory(dirname(input.recordPath)),
    );
    await publicationStep(options, 'unlink-private-candidate', async () => {
      await unlink(privateCandidate);
      privateCandidateExists = false;
    });
    await publicationStep(options, 'fsync-private-staging-after-cleanup', () =>
      syncDirectory(input.identityStagingRoot),
    );
    winner = await readIdentityRecord(input.recordPath, input.stateRoot, input.reportRoot, false);
    assertWinnerMatchesRequest(winner, input.record);
  } catch (error) {
    await recoverPublicationCandidate(
      options,
      'private',
      privateCandidate,
      input.identityStagingRoot,
      privateCandidateExists,
      error,
    );
    throw error;
  }

  const publicReport = reconciliationReportForRecord(winner);
  if (`sha256:${sha256CanonicalJson(publicReport)}` !== winner.reconciliationAttempt.sha256)
    fail('UAP_B02_ATTEMPT_IDENTITY_EVIDENCE_INVALID');
  const publicPath = resolveWithin(input.reportRoot, winner.reconciliationAttempt.relativePath);
  const publicCandidate = resolve(
    input.publicStagingRoot,
    `${winner.simulationId}.${transactionId}.candidate`,
  );
  let publicCandidateExists = false;
  try {
    await publicationStep(options, 'write-public-candidate', async () => {
      await writeExclusivePrivateFile(publicCandidate, publicReport, () => {
        publicCandidateExists = true;
      });
    });
    await publicationStep(options, 'link-public', async () => {
      try {
        await link(publicCandidate, publicPath);
      } catch (error) {
        if (isNodeError(error) && error.code === 'EEXIST') return;
        throw error;
      }
    });
    await publicationStep(options, 'fsync-public-after-link', () =>
      syncDirectory(dirname(publicPath)),
    );
    await validatePublicReconciliation(winner, input.reportRoot);
    await publicationStep(options, 'unlink-public-candidate', async () => {
      await unlink(publicCandidate);
      publicCandidateExists = false;
    });
    await publicationStep(options, 'fsync-public-staging-after-cleanup', () =>
      syncDirectory(input.publicStagingRoot),
    );
  } catch (error) {
    await recoverPublicationCandidate(
      options,
      'public',
      publicCandidate,
      input.publicStagingRoot,
      publicCandidateExists,
      error,
    );
    throw error;
  }
  return Object.freeze({ record: winner, publicReport, publicPath });
}

async function publicationStep(options, name, operation) {
  await options.publicationFault?.(name);
  return operation();
}

async function recoverPublicationCandidate(options, kind, path, directory, exists, cause) {
  const errors = [];
  if (exists) {
    try {
      await options.publicationFault?.(`recovery-unlink-${kind}-candidate`);
      await unlink(path);
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await options.publicationFault?.(`recovery-fsync-${kind}-staging`);
    await syncDirectory(directory);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length !== 0)
    fail(
      'UAP_B02_RECOVERY_ROLLBACK_FAILED',
      new AggregateError(errors, 'UAP_B02_RECOVERY_ROLLBACK_FAILED', { cause }),
    );
}

function assertWinnerMatchesRequest(winner, candidate) {
  if (
    winner.bootstrapRunId !== candidate.bootstrapRunId ||
    winner.predecessorSimulationId !== candidate.predecessorSimulationId ||
    winner.predecessorA2aIdempotencyKey !== candidate.predecessorA2aIdempotencyKey ||
    sha256CanonicalJson(winner.failureReport) !== sha256CanonicalJson(candidate.failureReport) ||
    sha256CanonicalJson(winner.zeroDispatchAssessment) !==
      sha256CanonicalJson(candidate.zeroDispatchAssessment)
  )
    fail('UAP_B02_RECOVERY_EXISTING_IDENTITY_CONFLICT');
}

async function writeExclusivePrivateFile(path, value, created) {
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    created();
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function syncDirectory(path) {
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function ensurePrivateDirectory(path) {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!(isNodeError(error) && error.code === 'EEXIST')) throw error;
  }
  await assertPrivateDirectory(path, 'UAP_B02_ATTEMPT_IDENTITY_STATE_INVALID');
  await chmod(path, 0o700);
}

async function assertPrivateDirectory(path, code) {
  const status = await lstat(path);
  if (
    status.isSymbolicLink() ||
    !status.isDirectory() ||
    (status.mode & 0o777) !== 0o700 ||
    (process.getuid !== undefined && status.uid !== process.getuid())
  )
    fail(code);
}

function resolveWithin(root, relativePath) {
  const base = resolve(root);
  const target = resolve(base, relativePath);
  if (!target.startsWith(`${base}/`)) fail('UAP_B02_ATTEMPT_IDENTITY_EVIDENCE_INVALID');
  return target;
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

function createSimulationId(random = randomBytes) {
  const value = `uap-p3-b02-${Date.now().toString(36)}-${random(10).toString('hex')}`;
  if (!SIMULATION_ID.test(value)) fail('UAP_B02_RECOVERY_ID_GENERATION_FAILED');
  return value;
}

function validNow(now = () => new Date().toISOString()) {
  const value = now();
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    fail('UAP_B02_RECOVERY_CLOCK_INVALID');
  return new Date(Date.parse(value)).toISOString();
}

function rawSha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function exactKeys(value, keys) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000')
  );
}

function isNodeError(error) {
  return error instanceof Error && 'code' in error;
}

function fail(code, cause) {
  throw new UapB02AttemptIdentityError(code, cause === undefined ? undefined : { cause });
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command === 'authorize' && arguments_.length === 1) {
    const authorized = await authorizeB02SimulationId(arguments_[0]);
    process.stdout.write(`${authorized.simulationId}\n`);
    return;
  }
  if (command === 'issue' && arguments_.length === 4) {
    const result = await issueB02AttemptIdentity({
      predecessorSimulationId: arguments_[0],
      failureReportPath: arguments_[1],
      beforeLedgerPath: arguments_[2],
      afterLedgerPath: arguments_[3],
    });
    process.stdout.write(
      `${JSON.stringify({
        status: 'issued',
        simulationId: result.simulationId,
        a2aIdempotencyKey: result.a2aIdempotencyKey,
        reconciliationAttemptFile: result.reconciliationAttemptPath,
        secretsIncluded: false,
      })}\n`,
    );
    return;
  }
  fail('UAP_B02_ATTEMPT_IDENTITY_USAGE_INVALID');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof UapB02AttemptIdentityError ? error.code : 'UAP_B02_ATTEMPT_IDENTITY_FAILED'}\n`,
    );
    process.exitCode = 2;
  });
}
