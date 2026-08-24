#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

import { sha256CanonicalJson, writeFirstPassPairTransactional } from './evidence-files.mjs';
import { readExistingState } from './initialize-state.mjs';
import { validateIssuedB02AttemptIdentity } from './b02-attempt-identity.mjs';
import {
  assertNoDotEnvMaterial,
  publicConfigurationMaterial,
  taskOwnedCredentialMaterial,
  validateDotEnv,
} from './validate-profile.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SHA256 = /^[a-f0-9]{64}$/u;
const PREFIXED_SHA256 = /^sha256:[a-f0-9]{64}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const ADMISSION_BUDGETS_MS = Object.freeze({
  source: 240_000,
  binding: 1_200_000,
  runtimeDiscovery: 1_200_000,
  readiness: 30_000,
});
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
const SOURCE_RECOVERY_BASE_CHECKS = Object.freeze([
  'issued_attempt_identity_authorized',
  'pre_command_authority_frozen',
  'registry_full_200_matches_binding',
  'binding_and_runtime_runway_not_less_than_20_minutes',
  'formal_supervisor_no_capture',
]);
const SOURCE_RECOVERY_NOT_REQUIRED_CHECKS = Object.freeze([
  ...SOURCE_RECOVERY_BASE_CHECKS,
  'source_refresh_runway_not_less_than_270_seconds',
  'no_materialize_or_rebind_port',
]);
const SOURCE_RECOVERY_REFRESHED_CHECKS = Object.freeze([
  ...SOURCE_RECOVERY_BASE_CHECKS,
  'formal_source_bootstrap_reused',
  'source_sync_not_modified',
  'source_pointer_validity_extended',
  'projected_and_native_lineage_unchanged',
  'binding_authority_byte_stable',
  'runtime_catalog_byte_stable',
  'capability_definition_and_policy_stable',
  'no_materialize_or_rebind_port',
]);
const AUTHORITY_ETAG_CHECKS = Object.freeze([
  'source_strong_etag_body_contract_valid',
  'capability_strong_etag_body_contract_valid',
  'readiness_strong_etag_canonical_body_hash_valid',
]);
const AUTHORITY_CHECKS = Object.freeze([
  'source_binding_candidate_lineage_exact',
  'runtime_discovery_catalog_exact',
  'capability_provider_policy_exact',
  'readiness_implementation_partition_exact',
  'same_round_observed_at',
]);

const INPUT_KEYS = Object.freeze([
  'schemaVersion',
  'status',
  'evidenceClass',
  'productionEligible',
  'physicalVehicleQualified',
  'observationClass',
  'generatedAt',
  'simulationId',
  'qualification',
  'admission',
  'execution',
  'lineage',
  'calls',
  'state',
  'providerLedger',
  'sdarInvocations',
  'modelRuntime',
  'safety',
  'redaction',
]);
const QUALIFICATION_KEYS = Object.freeze([
  'simulationId',
  'invocationId',
  'resultHash',
  'completedAt',
  'observedAt',
  'revision',
  'mqttIngressSequence',
  'serverId',
  'providerBindingId',
  'providerId',
  'operationName',
  'resourceId',
  'sourcePosition',
  'target',
]);
const LINEAGE_KEYS = Object.freeze([
  'goalId',
  'goalVersion',
  'goalContractHash',
  'userGoalPlanId',
  'userGoalPlanRevision',
  'workflowPlanId',
  'workflowDefinitionId',
  'workflowDefinitionVersion',
  'workflowInstanceId',
  'skillExecutionId',
  'skillId',
  'skillVersion',
  'confirmationId',
  'continuationId',
  'continuationSnapshotId',
  'continuationAttemptId',
  'terminalOutcomeId',
  'terminalEvidenceId',
  'navigateNodeStartedCount',
  'taskId',
  'capabilityAttemptId',
  'navigateInvocationId',
  'remoteBindingId',
  'remoteTaskId',
  'providerIdempotencyKey',
  'providerLedgerTaskId',
  'providerExternalExecutionId',
  'providerDeviceCallIds',
  'providerMutationRowIds',
  'providerExternalMissionId',
  'providerMissionCorrelationId',
  'providerIdentityValidated',
]);
const PROVIDER_LEDGER_KEYS = Object.freeze([
  'invocationId',
  'providerTaskId',
  'externalExecutionId',
  'externalExecutionIdSha256',
  'argumentHash',
  'deviceCallIds',
  'deviceCallIdsSha256',
  'mutationRowIds',
  'mutationRowIdsSha256',
  'externalMissionId',
  'externalMissionIdSha256',
  'correlationId',
  'providerIdentityValidated',
  'runtimeTaskCount',
  'runtimeIdempotencyCount',
  'adapterExecutionCount',
  'southboundDeviceCallCount',
  'southboundStateReadCount',
  'southboundMutationCallCount',
  'mutationStepCount',
  'forbiddenOperationCount',
  'uncertainMutationCount',
  'beforeSha256',
  'afterSha256',
]);

export async function projectA2aMoveReport(
  inputPath,
  preSupervisorStatusPath,
  executionSupervisorStatusPath,
  finalSupervisorStatusPath,
  sourceRecoveryReportPath,
  authorityGateReportPath,
  outputPath,
  options = {},
) {
  const input = await privateJson(inputPath);
  const preSupervisorInput = await privateJson(preSupervisorStatusPath);
  const executionSupervisorInput = await privateJson(executionSupervisorStatusPath);
  const finalSupervisorInput = await privateJson(finalSupervisorStatusPath);
  const sourceRecoveryEnvelope = await privateJson(sourceRecoveryReportPath);
  const authorityGate = await privateJson(authorityGateReportPath);
  validateInput(input);
  const state = await readExistingState(options.stateRoot);
  const authorized = await validateIssuedB02AttemptIdentity(input.simulationId, {
    stateRoot: state.root,
    reportRoot: dirname(resolve(outputPath)),
  });
  if (input.simulationId !== authorized.simulationId)
    throw new Error('UAP_B02_SIMULATION_ID_MISMATCH');
  const supervisor = validateB02SupervisorTransition(
    preSupervisorInput,
    executionSupervisorInput,
    finalSupervisorInput,
    Object.freeze({
      simulationId: authorized.simulationId,
      stateBootstrapRunId: state.bootstrapRunId,
      authorizedBootstrapRunId: authorized.bootstrapRunId,
    }),
  );
  const admissionAuthority = projectAdmissionAuthority(
    sourceRecoveryEnvelope,
    authorityGate,
    authorized,
    input.generatedAt,
  );
  const projected = projectInput(input);
  const report = Object.freeze({
    ...projected,
    task: 'UAP-P3-B02',
    bootstrapRunId: state.bootstrapRunId,
    admissionAuthority,
    supervisor,
    sideEffectWindow: Object.freeze({
      pre: 'NO',
      execution: 'YES',
      restored: 'NO',
      restoreVerified: true,
    }),
    secretsIncluded: false,
    endpointsIncluded: false,
    downstreamDeviceIdsIncluded: true,
    modelRouteIdentityHashesIncluded: true,
    modelValuesIncluded: false,
    modelEndpointsIncluded: false,
    modelCredentialsIncluded: false,
  });
  assertPublicProjection(report);
  const dotEnv = await validateDotEnv(options.dotEnvPath);
  const taskSecrets = await taskOwnedCredentialMaterial(options.stateRoot);
  assertNoDotEnvMaterial(
    JSON.stringify(report),
    publicConfigurationMaterial(dotEnv.values, [...dotEnv.secretValues, ...taskSecrets]),
    Object.keys(dotEnv.values),
  );
  const repositoryRoot = resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  await writeFirstPassPairTransactional({
    attemptDirectory: resolve(dirname(outputPath), 'attempts'),
    prefix: `uap-p3-b02-${authorized.simulationId}`,
    document: report,
    indexPath: resolve(outputPath),
    repositoryRoot,
    createIndex: (attemptPath) => ({
      schemaVersion: 'sdar.ugv-agent-profile.a2a-move-index/v1',
      status: 'passed',
      task: 'UAP-P3-B02',
      bootstrapRunId: state.bootstrapRunId,
      evidenceClass: 'external_simulation',
      canonicalSemantics: 'immutable_first_pass',
      firstPassAttemptFile: attemptPath.slice(repositoryRoot.length + 1),
      firstPassAttemptSha256: sha256CanonicalJson(report),
      productionEligible: false,
      physicalVehicleQualified: false,
      secretsIncluded: false,
      endpointsIncluded: false,
      downstreamDeviceIdsIncluded: true,
      modelRouteIdentityHashesIncluded: true,
      modelValuesIncluded: false,
      modelEndpointsIncluded: false,
      modelCredentialsIncluded: false,
    }),
  });
  return report;
}

function projectAdmissionAuthority(sourceEnvelope, gate, authorized, generatedAt) {
  const source = validateSourceRecoveryEnvelope(sourceEnvelope, authorized);
  const authority = validateAuthorityGateReport(gate, authorized);
  const generatedAtMs = timestamp(generatedAt, 'UAP_B02_ADMISSION_AUTHORITY_TIME_INVALID');
  if (source.observedAtMs > authority.observedAtMs || authority.observedAtMs > generatedAtMs)
    throw new Error('UAP_B02_ADMISSION_AUTHORITY_TIME_INVALID');
  return Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.b02-admission-authority/v1',
    issuedAttempt: Object.freeze({
      simulationIdSha256: authority.simulationIdSha256,
      admissionIdempotencyKeySha256: authority.admissionIdempotencyKeySha256,
      identityRecordSha256: authorized.identityRecordSha256,
    }),
    sourceRecovery: Object.freeze({
      reportSha256: source.reportSha256,
      evidenceClass: source.report.evidenceClass,
      observedAt: source.report.observedAt,
      action: source.report.action,
      sourceRemainingTtlMs: source.sourceRemainingTtlMs,
      bindingRemainingTtlMs: source.report.binding.remainingTtlMs,
      runtimeDiscoveryRemainingTtlMs: source.report.runtime.remainingTtlMs,
      checks: Object.freeze([...source.report.checks]),
    }),
    authorityGate: Object.freeze({
      reportSha256: authority.reportSha256,
      observedAt: gate.observedAt,
      budgetsMs: Object.freeze({ ...gate.budgetsMs }),
      minimumRemainingTtlMs: Object.freeze({ ...gate.minimumRemainingTtlMs }),
      etagChecks: Object.freeze([...gate.etagChecks]),
      authorityChecks: Object.freeze([...gate.authorityChecks]),
    }),
    redaction: Object.freeze({
      secretsIncluded: false,
      credentialReferencesIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    }),
  });
}

function validateSourceRecoveryEnvelope(value, authorized) {
  if (
    !exactKeys(value, ['report', 'reportSha256', 'schemaVersion']) ||
    value.schemaVersion !== 'sdar.ugv-agent-profile.b02-source-recovery-envelope/v1' ||
    !PREFIXED_SHA256.test(value.reportSha256)
  )
    throw new Error('UAP_B02_SOURCE_RECOVERY_REPORT_INVALID');
  const report = value.report;
  if (
    !exactKeys(report, [
      'action',
      'binding',
      'capability',
      'checks',
      'evidenceClass',
      'identityRecordSha256',
      'observedAt',
      'redaction',
      'runtime',
      'schemaVersion',
      'simulationIdSha256',
      'source',
      'status',
    ]) ||
    report.schemaVersion !== 'sdar.ugv-agent-profile.b02-source-recovery/v1' ||
    report.status !== 'passed' ||
    report.evidenceClass !== 'real_public_api' ||
    !['not_required', 'refreshed'].includes(report.action) ||
    report.identityRecordSha256 !== authorized.identityRecordSha256 ||
    report.simulationIdSha256 !== sha256(authorized.simulationId) ||
    value.reportSha256 !== `sha256:${sha256CanonicalJson(report)}` ||
    !PREFIXED_SHA256.test(report.identityRecordSha256) ||
    !SHA256.test(report.simulationIdSha256) ||
    !validateSourceRecoverySource(report.source, report.action) ||
    !validateSourceRecoveryBinding(report.binding) ||
    !validateSourceRecoveryRuntime(report.runtime) ||
    !validateSourceRecoveryCapability(report.capability) ||
    !exactKeys(report.redaction, [
      'credentialReferencesIncluded',
      'endpointsIncluded',
      'entityIdsIncluded',
      'secretsIncluded',
    ]) ||
    report.redaction.secretsIncluded !== false ||
    report.redaction.credentialReferencesIncluded !== false ||
    report.redaction.endpointsIncluded !== false ||
    report.redaction.entityIdsIncluded !== false
  )
    throw new Error('UAP_B02_SOURCE_RECOVERY_REPORT_INVALID');
  const expectedChecks =
    report.action === 'not_required'
      ? SOURCE_RECOVERY_NOT_REQUIRED_CHECKS
      : SOURCE_RECOVERY_REFRESHED_CHECKS;
  if (!exactStringArray(report.checks, expectedChecks))
    throw new Error('UAP_B02_SOURCE_RECOVERY_REPORT_INVALID');
  const observedAtMs = timestamp(report.observedAt, 'UAP_B02_SOURCE_RECOVERY_REPORT_INVALID');
  const sourceValidUntilBeforeMs = timestamp(
    report.source.validUntilBefore,
    'UAP_B02_SOURCE_RECOVERY_REPORT_INVALID',
  );
  const sourceValidUntilAfterMs = timestamp(
    report.source.validUntilAfter,
    'UAP_B02_SOURCE_RECOVERY_REPORT_INVALID',
  );
  const bindingValidUntilMs = timestamp(
    report.binding.availabilityValidUntil,
    'UAP_B02_SOURCE_RECOVERY_REPORT_INVALID',
  );
  const runtimeValidUntilMs = timestamp(
    report.runtime.discoveryValidUntil,
    'UAP_B02_SOURCE_RECOVERY_REPORT_INVALID',
  );
  const sourceRemainingTtlMs = sourceValidUntilAfterMs - observedAtMs;
  const bindingRemainingTtlMs = bindingValidUntilMs - observedAtMs;
  const runtimeRemainingTtlMs = runtimeValidUntilMs - observedAtMs;
  if (
    !nonnegativeInteger(sourceRemainingTtlMs) ||
    !nonnegativeInteger(bindingRemainingTtlMs) ||
    !nonnegativeInteger(runtimeRemainingTtlMs) ||
    sourceRemainingTtlMs < ADMISSION_BUDGETS_MS.source ||
    bindingRemainingTtlMs < ADMISSION_BUDGETS_MS.binding ||
    runtimeRemainingTtlMs < ADMISSION_BUDGETS_MS.runtimeDiscovery ||
    report.binding.remainingTtlMs !== bindingRemainingTtlMs ||
    report.runtime.remainingTtlMs !== runtimeRemainingTtlMs ||
    report.binding.revision !== report.runtime.toolRevision ||
    report.binding.catalogRevision !== report.runtime.catalogRevision ||
    report.binding.catalogChecksum !== report.runtime.catalogChecksum ||
    report.binding.operationCount !== report.runtime.operationCount ||
    (report.action === 'not_required' &&
      (sourceValidUntilBeforeMs !== sourceValidUntilAfterMs ||
        report.source.remainingTtlMsBefore !== sourceRemainingTtlMs)) ||
    (report.action === 'refreshed' &&
      (sourceValidUntilAfterMs <= sourceValidUntilBeforeMs ||
        report.source.remainingTtlMsBefore >= ADMISSION_BUDGETS_MS.source))
  )
    throw new Error('UAP_B02_SOURCE_RECOVERY_REPORT_INVALID');
  return Object.freeze({
    report,
    reportSha256: value.reportSha256,
    observedAtMs,
    sourceRemainingTtlMs,
  });
}

function validateSourceRecoverySource(value, action) {
  const keys = [
    'nativeChecksum',
    'nativeRevision',
    'projectionContract',
    'remainingTtlMsBefore',
    'revision',
    'snapshotChecksum',
    'snapshotRevision',
    'validUntilAfter',
    'validUntilBefore',
    ...(action === 'refreshed' ? ['syncOutcome'] : []),
  ];
  return (
    exactKeys(value, keys) &&
    positiveInteger(value.revision) &&
    positiveInteger(value.snapshotRevision) &&
    SHA256.test(value.snapshotChecksum) &&
    positiveInteger(value.nativeRevision) &&
    SHA256.test(value.nativeChecksum) &&
    value.projectionContract === 'sdar-registry-v1' &&
    nonnegativeInteger(value.remainingTtlMsBefore) &&
    (action === 'not_required'
      ? !Object.hasOwn(value, 'syncOutcome')
      : value.syncOutcome === 'not_modified')
  );
}

function validateSourceRecoveryBinding(value) {
  return (
    exactKeys(value, [
      'availabilityValidUntil',
      'catalogChecksum',
      'catalogRevision',
      'operationCount',
      'remainingTtlMs',
      'revision',
    ]) &&
    positiveInteger(value.revision) &&
    nonemptyString(value.catalogRevision) &&
    SHA256.test(value.catalogChecksum) &&
    nonnegativeInteger(value.remainingTtlMs) &&
    positiveInteger(value.operationCount) &&
    value.operationCount <= 1_024
  );
}

function validateSourceRecoveryRuntime(value) {
  return (
    exactKeys(value, [
      'catalogChecksum',
      'catalogRevision',
      'discoveryValidUntil',
      'operationCount',
      'remainingTtlMs',
      'toolRevision',
    ]) &&
    positiveInteger(value.toolRevision) &&
    nonemptyString(value.catalogRevision) &&
    SHA256.test(value.catalogChecksum) &&
    nonnegativeInteger(value.remainingTtlMs) &&
    positiveInteger(value.operationCount) &&
    value.operationCount <= 1_024
  );
}

function validateSourceRecoveryCapability(value) {
  return (
    exactKeys(value, ['definitionHash', 'policyHash', 'version']) &&
    value.version === 1 &&
    SHA256.test(value.definitionHash) &&
    PREFIXED_SHA256.test(value.policyHash)
  );
}

function validateAuthorityGateReport(value, authorized) {
  if (
    !exactKeys(value, [
      'admissionIdempotencyKeySha256',
      'authorityChecks',
      'budgetsMs',
      'etagChecks',
      'minimumRemainingTtlMs',
      'observedAt',
      'redaction',
      'schemaVersion',
      'simulationIdSha256',
      'status',
      'task',
    ]) ||
    value.schemaVersion !== 'sdar.ugv-agent-profile.b02-authority-gate/v1' ||
    value.status !== 'passed' ||
    value.task !== 'UAP-P3-B02' ||
    value.simulationIdSha256 !== `sha256:${sha256(authorized.simulationId)}` ||
    value.admissionIdempotencyKeySha256 !== `sha256:${sha256(authorized.a2aIdempotencyKey)}` ||
    !exactBudgetRecord(value.budgetsMs, false) ||
    !exactBudgetRecord(value.minimumRemainingTtlMs, true) ||
    !exactStringArray(value.etagChecks, AUTHORITY_ETAG_CHECKS) ||
    !exactStringArray(value.authorityChecks, AUTHORITY_CHECKS) ||
    !exactKeys(value.redaction, ['endpointsIncluded', 'entityIdsIncluded', 'secretsIncluded']) ||
    value.redaction.secretsIncluded !== false ||
    value.redaction.endpointsIncluded !== false ||
    value.redaction.entityIdsIncluded !== false
  )
    throw new Error('UAP_B02_AUTHORITY_GATE_REPORT_INVALID');
  return Object.freeze({
    observedAtMs: timestamp(value.observedAt, 'UAP_B02_AUTHORITY_GATE_REPORT_INVALID'),
    reportSha256: `sha256:${sha256CanonicalJson(value)}`,
    simulationIdSha256: value.simulationIdSha256,
    admissionIdempotencyKeySha256: value.admissionIdempotencyKeySha256,
  });
}

function exactBudgetRecord(value, remaining) {
  if (!exactKeys(value, Object.keys(ADMISSION_BUDGETS_MS))) return false;
  return Object.entries(ADMISSION_BUDGETS_MS).every(([key, budget]) =>
    remaining ? nonnegativeInteger(value[key]) && value[key] >= budget : value[key] === budget,
  );
}

function exactStringArray(value, expected) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4_096;
}

function timestamp(value, code) {
  const milliseconds =
    typeof value === 'string' && value.length <= 64 && ISO_TIMESTAMP.test(value)
      ? Date.parse(value)
      : Number.NaN;
  if (!Number.isFinite(milliseconds)) throw new Error(code);
  return milliseconds;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function projectInput(value) {
  projectExact(value.redaction, [
    'secretsIncluded',
    'endpointsIncluded',
    'downstreamDeviceIdsIncluded',
    'modelRouteIdentitiesIncluded',
    'modelEndpointsIncluded',
    'modelCredentialsIncluded',
  ]);
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    status: value.status,
    evidenceClass: value.evidenceClass,
    productionEligible: value.productionEligible,
    physicalVehicleQualified: value.physicalVehicleQualified,
    observationClass: value.observationClass,
    generatedAt: value.generatedAt,
    simulationId: value.simulationId,
    qualification: projectQualification(value.qualification),
    admission: projectExact(value.admission, [
      'taskId',
      'contextId',
      'messageId',
      'idempotencyKey',
      'exposureId',
      'initialRequestCount',
      'confirmationRequestCount',
    ]),
    execution: projectExact(value.execution, [
      'planId',
      'workflowInstanceId',
      'waitingExternalObserved',
      'activeContinuationObserved',
      'terminalContinuationObserved',
      'a2aTerminalState',
      'taskPhase',
    ]),
    lineage: projectLineage(value.lineage),
    calls: projectExact(value.calls, [
      'initialStateReads',
      'navigateInvocations',
      'finalStateReads',
      'forbiddenInvocations',
    ]),
    state: projectState(value.state),
    providerLedger: projectProviderLedger(value.providerLedger),
    sdarInvocations: projectExact(value.sdarInvocations, [
      'invocationCount',
      'qualificationInvocationId',
      'initialStateInvocationId',
      'navigateInvocationId',
      'finalStateInvocationId',
      'capabilityAttemptId',
      'admissionKeySeparatedFromProviderKey',
    ]),
    modelRuntime: projectModelRuntime(value.modelRuntime),
    safety: projectExact(value.safety, [
      'outerPlanConfirmations',
      'secondConfirmations',
      'automaticWriteRetries',
      'navigationDispatches',
      'forbiddenOperations',
    ]),
    redaction: Object.freeze({
      secretsIncluded: false,
      endpointsIncluded: false,
      downstreamDeviceIdsIncluded: true,
      modelRouteIdentityHashesIncluded: true,
      modelValuesIncluded: false,
      modelEndpointsIncluded: false,
      modelCredentialsIncluded: false,
    }),
  });
}

function projectQualification(value) {
  const projected = projectExact(value, QUALIFICATION_KEYS);
  return Object.freeze({
    ...projected,
    sourcePosition: projectExact(value.sourcePosition, ['longitude', 'latitude']),
    target: projectExact(value.target, ['x', 'y', 'frame']),
  });
}

function projectLineage(value) {
  const projected = projectExact(value, LINEAGE_KEYS);
  return Object.freeze({
    ...projected,
    providerDeviceCallIds: projectStringArray(value.providerDeviceCallIds),
    providerMutationRowIds: projectStringArray(value.providerMutationRowIds),
  });
}

function projectProviderLedger(value) {
  const projected = projectExact(value, PROVIDER_LEDGER_KEYS);
  return Object.freeze({
    ...projected,
    deviceCallIds: projectStringArray(value.deviceCallIds),
    mutationRowIds: projectStringArray(value.mutationRowIds),
  });
}

function projectState(value) {
  const projected = projectExact(value, [
    'initial',
    'provider',
    'final',
    'sourcePosition',
    'target',
    'providerPosition',
    'finalPosition',
    'targetErrorM',
    'displacementM',
  ]);
  return Object.freeze({
    ...projected,
    initial: projectExact(value.initial, ['observedAt', 'revision', 'mqttIngressSequence']),
    provider: projectExact(value.provider, [
      'observedAt',
      'revision',
      'mqttIngressSequence',
      'cursorSha256',
      'field',
      'topic',
    ]),
    final: projectExact(value.final, ['observedAt', 'revision', 'mqttIngressSequence']),
    sourcePosition: projectExact(value.sourcePosition, ['longitude', 'latitude']),
    target: projectExact(value.target, ['x', 'y', 'frame']),
    providerPosition: projectExact(value.providerPosition, ['longitude', 'latitude']),
    finalPosition: projectExact(value.finalPosition, ['longitude', 'latitude']),
  });
}

function projectModelRuntime(value) {
  const projected = projectExact(value, [
    'configurationLoaded',
    'invocationCount',
    'succeededCount',
    'failedCount',
    'workflowPlanningAttemptCount',
    'invocations',
    'routeProviderRefs',
  ]);
  if (!Array.isArray(value.invocations)) throw new Error('UAP_B02_PRIVATE_REPORT_INVALID');
  const invocations = value.invocations.map((invocation) => {
    const expectedKeys =
      invocation?.status === 'failed'
        ? ['invocationId', 'stage', 'status', 'providerId', 'model', 'operation', 'errorCode']
        : ['invocationId', 'stage', 'status', 'providerId', 'model', 'operation'];
    const exact = projectExact(invocation, expectedKeys);
    return Object.freeze({
      invocationId: exact.invocationId,
      stage: exact.stage,
      status: exact.status,
      operation: exact.operation,
      routeIdentitySha256: `sha256:${sha256CanonicalJson({
        providerId: exact.providerId,
        model: exact.model,
      })}`,
      ...(exact.status === 'failed' ? { errorCode: exact.errorCode } : {}),
    });
  });
  return Object.freeze({
    configurationLoaded: projected.configurationLoaded,
    invocationCount: projected.invocationCount,
    succeededCount: projected.succeededCount,
    failedCount: projected.failedCount,
    workflowPlanningAttemptCount: projected.workflowPlanningAttemptCount,
    invocations: Object.freeze(invocations),
    routeProviderRefsSha256: Object.freeze(
      projectStringArray(value.routeProviderRefs).map(
        (entry) => `sha256:${sha256CanonicalJson(entry)}`,
      ),
    ),
  });
}

function validateInput(value) {
  if (
    !exactKeys(value, INPUT_KEYS) ||
    value?.schemaVersion !== 'sdar.ugv-agent-profile.a2a-move/v1' ||
    value?.status !== 'passed' ||
    value?.evidenceClass !== 'external_simulation' ||
    value?.productionEligible !== false ||
    value?.physicalVehicleQualified !== false ||
    value?.observationClass !== 'external_runtime_and_postgresql' ||
    !Number.isFinite(Date.parse(value?.generatedAt)) ||
    value?.admission?.initialRequestCount !== 1 ||
    value?.admission?.confirmationRequestCount !== 1 ||
    value?.execution?.waitingExternalObserved !== true ||
    value?.execution?.activeContinuationObserved !== true ||
    value?.execution?.terminalContinuationObserved !== true ||
    value?.execution?.a2aTerminalState !== 'TASK_STATE_COMPLETED' ||
    value?.providerLedger?.providerIdentityValidated !== true ||
    value?.sdarInvocations?.invocationCount !== 4 ||
    value?.modelRuntime?.configurationLoaded !== true ||
    value?.modelRuntime?.invocationCount < 1 ||
    value?.safety?.automaticWriteRetries !== 0 ||
    value?.safety?.navigationDispatches !== 1 ||
    value?.redaction?.secretsIncluded !== false ||
    value?.redaction?.endpointsIncluded !== false ||
    value?.redaction?.downstreamDeviceIdsIncluded !== true ||
    value?.redaction?.modelRouteIdentitiesIncluded !== true ||
    value?.redaction?.modelEndpointsIncluded !== false ||
    value?.redaction?.modelCredentialsIncluded !== false
  )
    throw new Error('UAP_B02_PRIVATE_REPORT_INVALID');
  // Projection itself is the recursive strict-key gate. It runs before any public write.
  projectInput(value);
}

function validateSupervisorState(value, expectedSideEffects, expectedActiveSimulationRunId, code) {
  if (
    !exactKeys(value, SUPERVISOR_STATUS_KEYS) ||
    value.schemaVersion !== 'sdar.ugv-agent-profile.host-process-status/v2' ||
    value.status !== 'running' ||
    value.processCount !== 3 ||
    value.sideEffects !== expectedSideEffects ||
    !nonemptyString(value.bootstrapRunId) ||
    !positiveInteger(value.manifestRevision) ||
    value.activeSimulationRunId !== expectedActiveSimulationRunId ||
    !exactKeys(value.processIdentitySha256, PROCESS_IDENTITY_KEYS) ||
    PROCESS_IDENTITY_KEYS.some(
      (processName) => !PREFIXED_SHA256.test(value.processIdentitySha256[processName]),
    )
  )
    throw new Error(code);
  return Object.freeze({
    bootstrapRunId: value.bootstrapRunId,
    manifestRevision: value.manifestRevision,
    processIdentitySha256: Object.freeze({
      server: value.processIdentitySha256.server,
      nodeControlApi: value.processIdentitySha256.nodeControlApi,
      nodeControlWorker: value.processIdentitySha256.nodeControlWorker,
    }),
  });
}

export function validateB02SupervisorTransition(preInput, executionInput, finalInput, identity) {
  if (
    typeof identity !== 'object' ||
    identity === null ||
    Array.isArray(identity) ||
    !exactKeys(identity, ['simulationId', 'stateBootstrapRunId', 'authorizedBootstrapRunId'])
  )
    throw new Error('UAP_B02_SUPERVISOR_IDENTITY_INVALID');
  const pre = validateSupervisorState(
    preInput,
    'NO',
    null,
    'UAP_B02_SUPERVISOR_PRECONDITION_INVALID',
  );
  const execution = validateSupervisorState(
    executionInput,
    'YES',
    identity.simulationId,
    'UAP_B02_SUPERVISOR_EXECUTION_WINDOW_INVALID',
  );
  const final = validateSupervisorState(finalInput, 'NO', null, 'UAP_B02_SUPERVISOR_NOT_RESTORED');
  const bootstrapRunIds = new Set([
    pre.bootstrapRunId,
    execution.bootstrapRunId,
    final.bootstrapRunId,
    identity.stateBootstrapRunId,
    identity.authorizedBootstrapRunId,
  ]);
  const serverIdentities = new Set([
    pre.processIdentitySha256.server,
    execution.processIdentitySha256.server,
    final.processIdentitySha256.server,
  ]);
  if (
    bootstrapRunIds.size !== 1 ||
    execution.manifestRevision !== pre.manifestRevision + 1 ||
    final.manifestRevision !== execution.manifestRevision + 1 ||
    serverIdentities.size !== 3 ||
    execution.processIdentitySha256.nodeControlApi !== pre.processIdentitySha256.nodeControlApi ||
    final.processIdentitySha256.nodeControlApi !== pre.processIdentitySha256.nodeControlApi ||
    execution.processIdentitySha256.nodeControlWorker !==
      pre.processIdentitySha256.nodeControlWorker ||
    final.processIdentitySha256.nodeControlWorker !== pre.processIdentitySha256.nodeControlWorker
  )
    throw new Error('UAP_B02_SUPERVISOR_IDENTITY_INVALID');
  return Object.freeze({
    restoredSideEffects: 'NO',
    processCount: 3,
    identityVerified: true,
    revisions: Object.freeze({
      pre: pre.manifestRevision,
      execution: execution.manifestRevision,
      final: final.manifestRevision,
    }),
  });
}

function assertPublicProjection(value) {
  const strings = [];
  walkStrings(value, strings);
  if (
    strings.some((source) =>
      /(?:Bearer\s|https?:\/\/|password\s*[=:]|credential\s*[=:]|api[_-]?key\s*[=:])/iu.test(
        source,
      ),
    )
  )
    throw new Error('UAP_B02_PUBLIC_REPORT_REDACTION_INVALID');
}

function walkStrings(value, output) {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, output);
    return;
  }
  if (typeof value === 'object' && value !== null)
    for (const item of Object.values(value)) walkStrings(item, output);
}

function projectExact(value, keys) {
  if (!exactKeys(value, keys)) throw new Error('UAP_B02_PRIVATE_REPORT_INVALID');
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, value[key]])));
}

function projectStringArray(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === ''))
    throw new Error('UAP_B02_PRIVATE_REPORT_INVALID');
  return Object.freeze([...value]);
}

function exactKeys(value, keys) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000')
  );
}

async function privateJson(path) {
  const target = resolve(path);
  const status = await lstat(target);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    (status.mode & 0o777) !== 0o600 ||
    (process.getuid !== undefined && status.uid !== process.getuid()) ||
    status.size < 2 ||
    status.size > 16 * 1024 * 1024
  )
    throw new Error('UAP_B02_PRIVATE_FILE_UNSAFE');
  let handle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (opened.dev !== status.dev || opened.ino !== status.ino)
      throw new Error('UAP_B02_PRIVATE_FILE_UNSAFE');
    return JSON.parse(await handle.readFile({ encoding: 'utf8' }));
  } catch (error) {
    if (error instanceof Error && /^UAP_B02_PRIVATE_FILE_/u.test(error.message)) throw error;
    throw new Error('UAP_B02_PRIVATE_FILE_INVALID', { cause: error });
  } finally {
    await handle?.close();
  }
}

async function main() {
  if (process.argv.length !== 9)
    throw new Error(
      'Usage: project-a2a-move-report.mjs <private-report> <pre-status> <execution-status> <final-status> <source-recovery-report> <authority-gate-report> <canonical-index>',
    );
  await projectA2aMoveReport(
    process.argv[2],
    process.argv[3],
    process.argv[4],
    process.argv[5],
    process.argv[6],
    process.argv[7],
    process.argv[8],
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'UAP_B02_PROJECTION_FAILED'}\n`,
    );
    process.exitCode = 1;
  });
}
