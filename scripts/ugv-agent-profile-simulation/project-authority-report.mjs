#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import {
  sha256CanonicalJson,
  writeCanonicalFirstPassIndex,
  writeImmutableAttemptJson,
} from './evidence-files.mjs';
import { initializeState } from './initialize-state.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CHECKSUM = /^[a-f0-9]{64}$/u;

export async function projectAuthorityReport(mode, inputPath, outputPath, options = {}) {
  if (!['bootstrap', 'verify', 'readiness'].includes(mode))
    throw new Error('UAP_AUTHORITY_MODE_INVALID');
  const source = await readFile(resolve(inputPath), 'utf8');
  if (Buffer.byteLength(source, 'utf8') > 4 * 1024 * 1024)
    throw new Error('UAP_AUTHORITY_REPORT_TOO_LARGE');
  let payload;
  try {
    payload = JSON.parse(source);
  } catch {
    throw new Error('UAP_AUTHORITY_REPORT_INVALID');
  }
  if (mode === 'readiness') validateReadinessPayload(payload);
  else validateBootstrapAuthorityPayload(payload, mode);
  const state = await initializeState(options.stateRoot);
  const authority =
    mode === 'readiness'
      ? {
          skillLifecycle: payload.skillLifecycle,
          profilePublicCardLifecycle: payload.profilePublicCardLifecycle,
          managedCardSeparation: payload.managedCardSeparation,
          driverActivity: payload.driverActivity,
        }
      : {
          source: payload.source,
          provider: payload.provider,
          skill: payload.skill,
          capability: payload.capability,
          readiness: payload.readiness,
          exposure: payload.exposure,
          managedCard: payload.managedCard,
          profilePublicCard: payload.profilePublicCard,
          driverActivity: payload.driverActivity,
        };
  const report = Object.freeze({
    schemaVersion: `sdar.ugv-agent-profile.authority-${mode}/v1`,
    status: 'passed',
    task: 'UAP-P3-B01',
    generatedAt: new Date().toISOString(),
    command: {
      bootstrap: 'deploy/ugv-agent-profile-simulation/bootstrap-authority.sh',
      verify: 'deploy/ugv-agent-profile-simulation/verify.sh',
      readiness: 'deploy/ugv-agent-profile-simulation/readiness.sh',
    }[mode],
    exitCode: 0,
    bootstrapRunId: state.bootstrapRunId,
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    authorityMode: mode,
    ...authority,
    navigationCallCount: 0,
    simulationSideEffectsEnabled: false,
    secretsIncluded: false,
    endpointsIncluded: false,
    modelConfigurationIncluded: false,
  });
  const repositoryRoot = resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  const attempt = await writeImmutableAttemptJson(
    resolve(dirname(outputPath), 'attempts'),
    `authority-${mode}-${state.bootstrapRunId}`,
    report,
  );
  await writeCanonicalFirstPassIndex(
    resolve(outputPath),
    {
      schemaVersion: `sdar.ugv-agent-profile.authority-${mode}-index/v1`,
      status: 'passed',
      task: report.task,
      bootstrapRunId: report.bootstrapRunId,
      evidenceClass: report.evidenceClass,
      canonicalSemantics: 'immutable_first_pass',
      firstPassAttemptFile: attempt.slice(repositoryRoot.length + 1),
      firstPassAttemptSha256: sha256CanonicalJson(report),
      productionEligible: false,
      physicalVehicleQualified: false,
      secretsIncluded: false,
      endpointsIncluded: false,
      modelConfigurationIncluded: false,
    },
    repositoryRoot,
  );
  return report;
}

function validateBootstrapAuthorityPayload(value, mode) {
  exactKeys(value, [
    'schemaVersion',
    'status',
    'mode',
    'evidenceClass',
    'productionEligible',
    'physicalVehicleQualified',
    'observedAt',
    'source',
    'provider',
    'skill',
    'capability',
    'readiness',
    'exposure',
    'managedCard',
    'profilePublicCard',
    'driverActivity',
    'redaction',
  ]);
  exactKeys(value?.source, [
    'action',
    'registryRevision',
    'registryChecksum',
    'sourceIdentitySha256',
  ]);
  exactKeys(value?.provider, [
    'action',
    'bindingRevision',
    'bindingIdentitySha256',
    'catalogRevision',
    'catalogChecksum',
    'toolCount',
    'navigateReplay',
  ]);
  exactKeys(value?.skill, [
    'skillId',
    'version',
    'runtimeStatus',
    'governedStatus',
    'packageChecksum',
    'exactVersionCount',
  ]);
  exactKeys(value?.capability, [
    'capabilityId',
    'version',
    'status',
    'definitionHash',
    'implementationBindingId',
    'implementationCount',
    'constraintCount',
  ]);
  exactKeys(value?.readiness, ['status', 'snapshotVersion', 'snapshotHash', 'validUntil']);
  exactKeys(value?.exposure, [
    'exposureId',
    'version',
    'agentSkillId',
    'status',
    'exposureHash',
    'exactExposureCount',
  ]);
  exactKeys(value?.managedCard, [
    'authority',
    'distinctFromProfilePublicCard',
    'status',
    'revision',
    'exposureRefs',
    'contentHash',
    'capabilityCatalogHash',
  ]);
  exactKeys(value?.profilePublicCard, ['authority', 'managedCardUsed', 'sourceSkillRef']);
  exactKeys(value?.driverActivity, [
    'navigationDispatchCount',
    'forbiddenOperationCallCount',
    'fireInvocationCount',
    'modelInvocationCount',
    'providerToolCallCount',
  ]);
  exactKeys(value?.redaction, [
    'secretsIncluded',
    'credentialReferencesIncluded',
    'endpointsIncluded',
  ]);
  if (
    value?.schemaVersion !== 'sdar.ugv-agent-profile-authority-bootstrap/v1' ||
    value?.status !== 'passed' ||
    value?.mode !== mode ||
    value?.evidenceClass !== 'external_simulation' ||
    value?.productionEligible !== false ||
    value?.physicalVehicleQualified !== false ||
    !Number.isFinite(Date.parse(value?.observedAt)) ||
    !['created', 'reused', 'verified'].includes(value?.source?.action) ||
    !positiveInteger(value?.source?.registryRevision) ||
    !checksum(value?.source?.registryChecksum) ||
    !checksum(value?.source?.sourceIdentitySha256) ||
    !['created', 'reconciled', 'verified'].includes(value?.provider?.action) ||
    !positiveInteger(value?.provider?.bindingRevision) ||
    !checksum(value?.provider?.bindingIdentitySha256) ||
    typeof value?.provider?.catalogRevision !== 'string' ||
    value.provider.catalogRevision === '' ||
    !checksum(value?.provider?.catalogChecksum) ||
    value?.provider?.toolCount !== 10 ||
    value?.provider?.navigateReplay !== 'simulation_only' ||
    value?.skill?.skillId !== 'embodied.move_to' ||
    value?.skill?.version !== 1 ||
    value?.skill?.runtimeStatus !== 'enabled' ||
    value?.skill?.governedStatus !== 'published' ||
    !checksum(value?.skill?.packageChecksum) ||
    value?.skill?.exactVersionCount !== 1 ||
    value?.capability?.capabilityId !== 'embodied.move' ||
    value?.capability?.version !== 1 ||
    value?.capability?.status !== 'published' ||
    !checksum(value?.capability?.definitionHash) ||
    value?.capability?.implementationBindingId !== 'capability-binding-embodied.move-v1' ||
    value?.capability?.implementationCount !== 1 ||
    value?.capability?.constraintCount !== 7 ||
    value?.readiness?.status !== 'available' ||
    !positiveInteger(value?.readiness?.snapshotVersion) ||
    !checksum(value?.readiness?.snapshotHash) ||
    !Number.isFinite(Date.parse(value?.readiness?.validUntil)) ||
    value?.exposure?.exposureId !== 'a2a.embodied.move' ||
    value?.exposure?.version !== 1 ||
    value?.exposure?.agentSkillId !== 'embodied.move_to' ||
    value?.exposure?.status !== 'published' ||
    !checksum(value?.exposure?.exposureHash) ||
    value?.exposure?.exactExposureCount !== 1 ||
    value?.managedCard?.authority !== 'node_control_exposure' ||
    value?.managedCard?.distinctFromProfilePublicCard !== true ||
    value?.managedCard?.status !== 'active' ||
    !positiveInteger(value?.managedCard?.revision) ||
    JSON.stringify(value?.managedCard?.exposureRefs) !== JSON.stringify(['a2a.embodied.move:1']) ||
    !checksum(value?.managedCard?.contentHash) ||
    !checksum(value?.managedCard?.capabilityCatalogHash) ||
    value?.profilePublicCard?.authority !== 'enabled_skill_version' ||
    value?.profilePublicCard?.managedCardUsed !== false ||
    value?.profilePublicCard?.sourceSkillRef !== 'embodied.move_to:1' ||
    value?.driverActivity?.navigationDispatchCount !== 0 ||
    value?.driverActivity?.forbiddenOperationCallCount !== 0 ||
    value?.driverActivity?.fireInvocationCount !== 0 ||
    value?.driverActivity?.modelInvocationCount !== 0 ||
    value?.driverActivity?.providerToolCallCount !== 0 ||
    value?.redaction?.secretsIncluded !== false ||
    value?.redaction?.credentialReferencesIncluded !== false ||
    value?.redaction?.endpointsIncluded !== false
  )
    throw new Error('UAP_AUTHORITY_REPORT_INVALID');
}

function validateReadinessPayload(value) {
  exactKeys(value, [
    'schemaVersion',
    'status',
    'mode',
    'evidenceClass',
    'productionEligible',
    'physicalVehicleQualified',
    'observedAt',
    'skillLifecycle',
    'profilePublicCardLifecycle',
    'managedCardSeparation',
    'driverActivity',
    'redaction',
  ]);
  exactKeys(value?.skillLifecycle, [
    'skillId',
    'version',
    'beforeRevision',
    'suspendedRevision',
    'restoredRevision',
    'finalGovernedStatus',
    'exactVersionCount',
  ]);
  exactKeys(value?.profilePublicCardLifecycle, [
    'authority',
    'managedCardUsed',
    'sourceSkillRef',
    'before',
    'suspended',
    'restored',
    'semanticRestored',
  ]);
  for (const phase of ['before', 'suspended', 'restored'])
    exactKeys(value?.profilePublicCardLifecycle?.[phase], [
      'exactSkillCount',
      'totalSkillCount',
      'capabilityCount',
      'managementContentHash',
      'a2aContentHash',
    ]);
  exactKeys(value?.managedCardSeparation, [
    'authority',
    'exposureRef',
    'revision',
    'contentHash',
    'unchangedAcrossSkillLifecycle',
  ]);
  exactKeys(value?.driverActivity, [
    'navigationDispatchCount',
    'forbiddenOperationCallCount',
    'fireInvocationCount',
    'modelInvocationCount',
    'providerToolCallCount',
  ]);
  exactKeys(value?.redaction, [
    'secretsIncluded',
    'credentialReferencesIncluded',
    'endpointsIncluded',
  ]);
  const lifecycle = value?.skillLifecycle;
  const card = value?.profilePublicCardLifecycle;
  const before = card?.before;
  const suspended = card?.suspended;
  const restored = card?.restored;
  if (
    value?.schemaVersion !== 'sdar.ugv-agent-profile-authority-readiness/v1' ||
    value?.status !== 'passed' ||
    value?.mode !== 'readiness' ||
    value?.evidenceClass !== 'external_simulation' ||
    value?.productionEligible !== false ||
    value?.physicalVehicleQualified !== false ||
    !Number.isFinite(Date.parse(value?.observedAt)) ||
    lifecycle?.skillId !== 'embodied.move_to' ||
    lifecycle?.version !== 1 ||
    !nonnegativeInteger(lifecycle?.beforeRevision) ||
    lifecycle?.suspendedRevision !== lifecycle.beforeRevision + 1 ||
    lifecycle?.restoredRevision !== lifecycle.suspendedRevision + 1 ||
    lifecycle?.finalGovernedStatus !== 'published' ||
    lifecycle?.exactVersionCount !== 1 ||
    card?.authority !== 'CapabilityCardPublisher' ||
    card?.managedCardUsed !== false ||
    card?.sourceSkillRef !== 'embodied.move_to:1' ||
    !profileCardPhase(before, 1, 1, 2) ||
    !profileCardPhase(suspended, 0, 0, 0) ||
    !profileCardPhase(restored, 1, 1, 2) ||
    card?.semanticRestored !== true ||
    value?.managedCardSeparation?.authority !== 'node_control_exposure' ||
    value?.managedCardSeparation?.exposureRef !== 'a2a.embodied.move:1' ||
    !positiveInteger(value?.managedCardSeparation?.revision) ||
    !checksum(value?.managedCardSeparation?.contentHash) ||
    value?.managedCardSeparation?.unchangedAcrossSkillLifecycle !== true ||
    !zeroDriverActivity(value?.driverActivity) ||
    value?.redaction?.secretsIncluded !== false ||
    value?.redaction?.credentialReferencesIncluded !== false ||
    value?.redaction?.endpointsIncluded !== false
  )
    throw new Error('UAP_AUTHORITY_REPORT_INVALID');
}

function profileCardPhase(value, exactSkillCount, totalSkillCount, capabilityCount) {
  return (
    value?.exactSkillCount === exactSkillCount &&
    value?.totalSkillCount === totalSkillCount &&
    value?.capabilityCount === capabilityCount &&
    checksum(value?.managementContentHash) &&
    checksum(value?.a2aContentHash)
  );
}

function zeroDriverActivity(value) {
  return (
    value?.navigationDispatchCount === 0 &&
    value?.forbiddenOperationCallCount === 0 &&
    value?.fireInvocationCount === 0 &&
    value?.modelInvocationCount === 0 &&
    value?.providerToolCallCount === 0
  );
}

function exactKeys(value, expected) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...expected].sort().join(',')
  )
    throw new Error('UAP_AUTHORITY_REPORT_INVALID');
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function checksum(value) {
  return typeof value === 'string' && CHECKSUM.test(value);
}

async function main() {
  if (process.argv.length !== 5) throw new Error('UAP_ARGUMENT_INVALID');
  const report = await projectAuthorityReport(process.argv[2], process.argv[3], process.argv[4]);
  process.stdout.write(
    `${JSON.stringify({ status: report.status, authorityMode: report.authorityMode, secretsIncluded: false })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error && /^UAP_/u.test(error.message) ? error.message : 'UAP_AUTHORITY_PROJECTION_FAILED'}\n`,
    );
    process.exitCode = 2;
  }
}
