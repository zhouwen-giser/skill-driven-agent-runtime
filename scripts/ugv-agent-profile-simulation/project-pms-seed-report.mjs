#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { initializeState } from './initialize-state.mjs';
import {
  sha256CanonicalJson,
  writeCanonicalFirstPassIndex,
  writeImmutableAttemptJson,
} from './evidence-files.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const EXPECTED_TOOLS = Object.freeze([
  // Exact latest SMPP live projection. vehicle_laser_range remains unadvertised and optional.
  'vehicle_area_recon',
  'vehicle_control_gimbal',
  'vehicle_emergency_stop',
  'vehicle_fire_weapon',
  'vehicle_get_capabilities',
  'vehicle_get_payload_status',
  'vehicle_get_state',
  'vehicle_get_targets',
  'vehicle_navigate',
  'vehicle_track_target',
]);
const EXPECTED_PACKAGE_PROJECTION = Object.freeze({
  packageId: 'builtin.isr.vehicle.ugv',
  packageVersion: '1.0.0',
  providerType: 'isr.vehicle.ugv',
  hostingModes: Object.freeze(['vendor_managed', 'platform_managed']),
  configSchemaId: 'provider.ugv',
  compatibleRuntimeVersion: '2.0.0-rc.1',
  protocolMode: 'frozen_v1',
  qualification: Object.freeze({ componentStatus: 'passed', realResourceStatus: 'pending' }),
});
const EXPECTED_PACKAGE_PROJECTION_SHA256 =
  'ef3a3a2b61e1cc3a6d8136d8df3ddc1ccc4c336f1b1350ad62a2cd2988619c52';

export async function projectPmsSeedReport(inputPath, outputPath, options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  const source = await readFile(resolve(inputPath), 'utf8');
  if (Buffer.byteLength(source, 'utf8') > 4 * 1024 * 1024)
    throw new Error('UAP_PMS_SEED_OUTPUT_TOO_LARGE');
  const lines = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'));
  let payload;
  for (const line of lines.toReversed()) {
    try {
      const candidate = JSON.parse(line);
      if (candidate?.status === 'seeded') {
        payload = candidate;
        break;
      }
    } catch {
      // Ignore non-JSON container prefixes; only the formal Profile seed projection is accepted.
    }
  }
  const heartbeatAgeMs =
    typeof payload?.process?.lastHeartbeatAt === 'string'
      ? Date.now() - Date.parse(payload.process.lastHeartbeatAt)
      : Number.NaN;
  const packageSync = payload?.packageSync;
  const registry = payload?.registry;
  if (
    payload?.status !== 'seeded' ||
    payload.packageId !== 'builtin.isr.vehicle.ugv' ||
    payload.providerTypeId !== 'isr.vehicle.ugv' ||
    payload.providerId !== 'isr.vehicle.ugv.ugv1' ||
    !providerTypeExact(payload.providerType) ||
    !providerExact(payload.provider) ||
    payload.resourceId !== 'vehicle:ugv1' ||
    payload.environment !== 'simulation' ||
    payload.hostingMode !== 'vendor_managed' ||
    payload.deployment?.deploymentId !== 'uap-p3-b01-runtime' ||
    payload.deployment?.providerId !== 'isr.vehicle.ugv.ugv1' ||
    payload.deployment?.environment !== 'simulation' ||
    payload.deployment?.runtimeVersion !== '2.0.0-rc.1' ||
    payload.deployment?.adapterEndpoint !== 'ugv-agent-profile-adapter:7010' ||
    payload.deployment?.desiredReplicas !== 1 ||
    payload.deployment?.status !== 'ACTIVE' ||
    payload.deployment?.runtimeAuthority !== 'direct_container' ||
    payload.deployment?.directContainer?.instanceId !== 'uap-p3-b01-runtime-1' ||
    payload.deployment?.directContainer?.controlEndpoint !==
      'http://ugv-agent-profile-runtime:8080/' ||
    payload.deployment?.directContainer?.advertisedEndpoint !== 'http://127.0.0.1:19131/' ||
    payload.process?.instanceId !== 'uap-p3-b01-runtime-1' ||
    payload.process?.deploymentId !== 'uap-p3-b01-runtime' ||
    payload.process?.observedHealth !== 'READY' ||
    payload.process?.readyForActive !== true ||
    payload.process?.registrationState !== 'registered' ||
    payload.process?.registrationFreshness !== 'registered' ||
    payload.process?.configState !== 'externally_managed' ||
    !Number.isFinite(heartbeatAgeMs) ||
    heartbeatAgeMs < -1_000 ||
    heartbeatAgeMs > 45_000 ||
    payload.runtimeAuthority !== 'direct_container' ||
    payload.registryAuthority !== 'pms_worker' ||
    payload.productionQualification !== 'NOT_CLAIMED' ||
    payload.comparisonBeforeMutation !== true ||
    typeof packageSync !== 'object' ||
    packageSync === null ||
    Array.isArray(packageSync) ||
    Object.keys(packageSync).sort().join(',') !== ['inserted', 'unchanged', 'updated'].join(',') ||
    !nonNegativeInteger(packageSync?.inserted) ||
    !nonNegativeInteger(packageSync?.updated) ||
    !nonNegativeInteger(packageSync?.unchanged) ||
    packageSync.inserted + packageSync.updated + packageSync.unchanged !== 1 ||
    !packageProjectionExact(payload?.packageProjection) ||
    !Number.isSafeInteger(registry?.revision) ||
    registry.revision < 1 ||
    typeof registry?.checksum !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(registry.checksum) ||
    registry?.effectiveEndpoint !== 'http://127.0.0.1:19131/mcp' ||
    registry?.catalogToolCount !== 10 ||
    !Array.isArray(registry?.catalogToolNames) ||
    registry.catalogToolNames.length !== EXPECTED_TOOLS.length ||
    registry.catalogToolNames.some((name, index) => name !== EXPECTED_TOOLS[index]) ||
    payload?.resource?.environment !== 'simulation' ||
    payload?.resource?.resourceId !== 'vehicle:ugv1' ||
    payload?.resource?.resourceType !== 'isr.vehicle.ugv' ||
    payload?.resource?.status !== 'available' ||
    !resourceMetadataExact(payload?.resource?.metadata) ||
    payload?.resourceBinding?.providerId !== 'isr.vehicle.ugv.ugv1' ||
    payload?.resourceBinding?.environment !== 'simulation' ||
    payload?.resourceBinding?.resourceId !== 'vehicle:ugv1' ||
    typeof payload?.resourceBinding?.boundAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.resourceBinding.boundAt)) ||
    Object.keys(payload.resourceBinding).sort().join(',') !==
      ['boundAt', 'environment', 'providerId', 'resourceId'].sort().join(',')
  )
    throw new Error('UAP_PMS_SEED_AUTHORITY_INVALID');
  const state = await initializeState(options.stateRoot);
  const report = Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.pms-seed/v1',
    status: 'passed',
    task: 'UAP-P3-B01',
    generatedAt: new Date().toISOString(),
    command: 'deploy/ugv-agent-profile-simulation/seed-smpp.sh',
    exitCode: 0,
    bootstrapRunId: state.bootstrapRunId,
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    formalPmsProfileSeed: true,
    environment: 'simulation',
    providerTypeIdentityValidated: true,
    providerIdentityValidated: true,
    resourceIdentityValidated: true,
    resourceMetadataSha256: sha256CanonicalJson(payload.resource.metadata),
    exactProviderResourceBindingValidated: true,
    resourceBindingTimestampValid: true,
    directContainerDeploymentIdentityValidated: true,
    runtimeInstanceIdentityValidated: true,
    packageSynchronization: {
      controlledPackageCount: 1,
      inserted: packageSync.inserted,
      updated: packageSync.updated,
      unchanged: packageSync.unchanged,
      packageProjectionSha256: payload.packageProjection.contentChecksum,
    },
    publicApiComparedBeforeMutation: true,
    runtimeAuthority: 'direct_container',
    registryAuthority: 'pms_worker',
    deploymentStatus: payload.deployment.status,
    runtimeProcess: {
      observedHealth: payload.process.observedHealth,
      readyForActive: payload.process.readyForActive,
      registrationState: payload.process.registrationState,
      registrationFreshness: payload.process.registrationFreshness,
      configState: payload.process.configState,
      heartbeatFresh: true,
    },
    registry: {
      revision: registry.revision,
      checksum: registry.checksum,
      catalogToolCount: registry.catalogToolCount,
      catalogToolNamesSha256: sha256CanonicalJson(registry.catalogToolNames),
      effectiveEndpointSha256: createHash('sha256')
        .update(registry.effectiveEndpoint)
        .digest('hex'),
    },
    productionQualificationClaimed: false,
    navigationCallCount: 0,
    secretsIncluded: false,
    endpointsIncluded: false,
    modelConfigurationIncluded: false,
  });
  const attempt = await writeImmutableAttemptJson(
    resolve(dirname(outputPath), 'attempts'),
    `pms-seed-${state.bootstrapRunId}`,
    report,
  );
  await writeCanonicalFirstPassIndex(
    resolve(outputPath),
    {
      schemaVersion: 'sdar.ugv-agent-profile.pms-seed-index/v1',
      status: 'passed',
      task: report.task,
      bootstrapRunId: report.bootstrapRunId,
      evidenceClass: 'external_simulation',
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

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function packageProjectionExact(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === ['content', 'contentChecksum'].join(',') &&
    value.contentChecksum === EXPECTED_PACKAGE_PROJECTION_SHA256 &&
    sha256CanonicalJson(value.content) === EXPECTED_PACKAGE_PROJECTION_SHA256 &&
    typeof value.content === 'object' &&
    value.content !== null &&
    !Array.isArray(value.content) &&
    Object.keys(value.content).sort().join(',') ===
      Object.keys(EXPECTED_PACKAGE_PROJECTION).sort().join(',')
  );
}

function resourceMetadataExact(value) {
  const expected = {
    displayName: 'UGV 1',
    hostingMode: 'vendor_managed',
    runtimeAuthority: 'direct_container',
    registryAuthority: 'pms_worker',
    productionQualification: 'NOT_CLAIMED',
  };
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === Object.keys(expected).sort().join(',') &&
    Object.entries(expected).every(([key, item]) => value[key] === item)
  );
}

function providerTypeExact(value) {
  const expected = {
    providerTypeId: 'isr.vehicle.ugv',
    displayName: 'UGV',
    status: 'active',
  };
  return exactObject(value, expected);
}

function providerExact(value) {
  const expected = {
    providerId: 'isr.vehicle.ugv.ugv1',
    providerTypeId: 'isr.vehicle.ugv',
    packageId: 'builtin.isr.vehicle.ugv',
    packageVersion: '1.0.0',
    hostingMode: 'vendor_managed',
    adapterEndpoint: 'ugv-agent-profile-adapter:7010',
    status: 'active',
  };
  return exactObject(value, expected);
}

function exactObject(value, expected) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === Object.keys(expected).sort().join(',') &&
    Object.entries(expected).every(([key, item]) => value[key] === item)
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('UAP_ARGUMENT_INVALID');
    await projectPmsSeedReport(process.argv[2], process.argv[3]);
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', formalSeedProjected: true, secretsIncluded: false })}\n`,
    );
  } catch {
    process.stderr.write('UAP_PMS_SEED_PROJECTION_FAILED\n');
    process.exitCode = 2;
  }
}
