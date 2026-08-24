#!/usr/bin/env node

// This file runs only inside the pinned SMPP PMS Worker image. It uses the image's formal PMS
// application/UoW only for controlled Provider Package synchronization. ProviderType, Provider,
// Resource, Binding and Deployment mutations use the production public PMS HTTP API after a
// GET/compare; existing non-exact Resource metadata fails closed instead of being repaired here.
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

import { Pool } from 'pg';
import { synchronizeWorkspaceProviderPackages } from '/app/dist/packages/pms-application/src/index.js';
import { PostgresPmsUnitOfWork } from '/app/dist/packages/pms-persistence-postgres/src/index.js';

const EXPECTED = Object.freeze({
  packageId: 'builtin.isr.vehicle.ugv',
  packageVersion: '1.0.0',
  providerTypeId: 'isr.vehicle.ugv',
  providerId: 'isr.vehicle.ugv.ugv1',
  resourceId: 'vehicle:ugv1',
  resourceType: 'isr.vehicle.ugv',
  environment: 'simulation',
  deploymentId: 'uap-p3-b01-runtime',
  instanceId: 'uap-p3-b01-runtime-1',
  runtimeVersion: '2.0.0-rc.1',
  adapterEndpoint: 'ugv-agent-profile-adapter:7010',
  controlEndpoint: 'http://ugv-agent-profile-runtime:8080/',
  advertisedEndpoint: 'http://127.0.0.1:19131/',
});
const EXPECTED_TOOLS = Object.freeze([
  // The frozen protocol can describe vehicle_laser_range, but SMPP b5f3ba2 does not advertise it.
  // Keep the reviewed live Catalog exact; an added optional tool requires a new explicit review.
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

const actorId = exact('PMS_SEED_ACTOR_ID', 'uap-p3-b01-bootstrap');
for (const [name, expected] of [
  ['PMS_SEED_ENVIRONMENT', EXPECTED.environment],
  ['PMS_SEED_PROVIDER_ID', EXPECTED.providerId],
  ['PMS_SEED_RESOURCE_ID', EXPECTED.resourceId],
  ['PMS_SEED_ADAPTER_ENDPOINT', EXPECTED.adapterEndpoint],
  ['PMS_SEED_DEPLOYMENT_ID', EXPECTED.deploymentId],
  ['PMS_SEED_INSTANCE_ID', EXPECTED.instanceId],
  ['PMS_SEED_RUNTIME_VERSION', EXPECTED.runtimeVersion],
  ['PMS_SEED_RUNTIME_CONTROL_ENDPOINT', EXPECTED.controlEndpoint],
  ['PMS_SEED_RUNTIME_ADVERTISED_ENDPOINT', EXPECTED.advertisedEndpoint],
  ['PMS_SEED_RUNTIME_PUBLISHED_PORT', '19131'],
])
  exact(name, expected);
const apiBaseUrl = exactUrl('PMS_SEED_API_BASE_URL', 'http://pms-api:8090/');
const packageRoot = exact('PMS_SEED_PACKAGE_ROOT', '/app');
const databaseUrl = await secretText(
  exact('PMS_SEED_DATABASE_URL_FILE', '/run/uap-pms/pms-database-url'),
);
const waitTimeoutMs = positiveInteger('PMS_SEED_WAIT_TIMEOUT_MS', 180_000, 600_000);
const pollIntervalMs = positiveInteger('PMS_SEED_POLL_INTERVAL_MS', 2_000, 10_000);
const correlationId = `uap-p3-b01-seed-${randomUUID()}`;
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const unitOfWork = new PostgresPmsUnitOfWork(pool);

try {
  await ensureProviderType();
  const packageSync = await synchronizeWorkspaceProviderPackages(
    unitOfWork,
    { actorId, correlationId },
    packageRoot,
  );
  const packageProjection = await assertPackageProjection();
  const providerType = await assertProviderType();
  const providerAuthority = await ensureProvider();
  const resource = await ensureResource();
  const resourceBinding = await ensureResourceBinding();
  const deployment = await ensureDeployment();
  const authority = await waitForAuthority(deployment);
  process.stdout.write(
    `${JSON.stringify({
      status: 'seeded',
      packageId: EXPECTED.packageId,
      providerTypeId: EXPECTED.providerTypeId,
      providerId: EXPECTED.providerId,
      providerType,
      provider: providerAuthority,
      resourceId: EXPECTED.resourceId,
      environment: EXPECTED.environment,
      hostingMode: 'vendor_managed',
      runtimeAuthority: 'direct_container',
      registryAuthority: 'pms_worker',
      productionQualification: 'NOT_CLAIMED',
      deployment: authority.deployment,
      process: authority.process,
      registry: authority.registry,
      resource,
      resourceBinding,
      packageSync,
      packageProjection,
      comparisonBeforeMutation: true,
    })}\n`,
  );
} finally {
  await pool.end();
}

async function assertPackageProjection() {
  const projection = await api(
    'GET',
    `/api/v1/provider-packages/${encodeURIComponent(EXPECTED.packageId)}?version=${encodeURIComponent(EXPECTED.packageVersion)}`,
  );
  if (
    typeof projection !== 'object' ||
    projection === null ||
    Array.isArray(projection) ||
    Object.keys(projection).sort().join(',') !==
      Object.keys(EXPECTED_PACKAGE_PROJECTION).sort().join(',') ||
    canonicalJson(projection) !== canonicalJson(EXPECTED_PACKAGE_PROJECTION)
  )
    throw new Error('UAP_PMS_PACKAGE_PROJECTION_INVALID');
  const contentChecksum = createHash('sha256').update(canonicalJson(projection)).digest('hex');
  if (contentChecksum !== EXPECTED_PACKAGE_PROJECTION_SHA256)
    throw new Error('UAP_PMS_PACKAGE_PROJECTION_INVALID');
  return Object.freeze({ content: projection, contentChecksum });
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

async function ensureProviderType() {
  const path = `/api/v1/provider-types/${encodeURIComponent(EXPECTED.providerTypeId)}`;
  let current = await getOrNull(path);
  if (current === null) {
    await api('POST', '/api/v1/provider-types', {
      providerTypeId: EXPECTED.providerTypeId,
      displayName: 'UGV',
    });
    current = await api('GET', path);
  }
  if (current?.providerTypeId !== EXPECTED.providerTypeId || current?.displayName !== 'UGV')
    throw new Error('UAP_PMS_PROVIDER_TYPE_IDENTITY_MISMATCH');
  if (current.status !== 'active')
    await api('PATCH', `${path}/status`, {
      status: 'active',
      expectedUpdatedAt: current.updatedAt,
    });
  current = await api('GET', path);
  if (
    current?.providerTypeId !== EXPECTED.providerTypeId ||
    current?.displayName !== 'UGV' ||
    current?.status !== 'active'
  )
    throw new Error('UAP_PMS_PROVIDER_TYPE_NOT_ACTIVE');
}

async function assertProviderType() {
  const current = await api(
    'GET',
    `/api/v1/provider-types/${encodeURIComponent(EXPECTED.providerTypeId)}`,
  );
  if (
    current?.providerTypeId !== EXPECTED.providerTypeId ||
    current?.displayName !== 'UGV' ||
    current?.status !== 'active'
  )
    throw new Error('UAP_PMS_PROVIDER_TYPE_IDENTITY_MISMATCH');
  return {
    providerTypeId: current.providerTypeId,
    displayName: current.displayName,
    status: current.status,
  };
}

async function ensureProvider() {
  const path = `/api/v1/providers/${encodeURIComponent(EXPECTED.providerId)}`;
  let current = await getOrNull(path);
  const identity = {
    providerId: EXPECTED.providerId,
    providerTypeId: EXPECTED.providerTypeId,
    packageId: EXPECTED.packageId,
    packageVersion: EXPECTED.packageVersion,
    hostingMode: 'vendor_managed',
    adapterEndpoint: EXPECTED.adapterEndpoint,
  };
  if (current === null) {
    await api('POST', '/api/v1/providers', identity);
    current = await api('GET', path);
  }
  if (Object.entries(identity).some(([key, value]) => current?.[key] !== value))
    throw new Error('UAP_PMS_PROVIDER_IDENTITY_MISMATCH');
  if (current.status !== 'active') {
    if (!new Set(['draft', 'degraded']).has(current.status))
      throw new Error('UAP_PMS_PROVIDER_NOT_ACTIVATABLE');
    await api('PATCH', `${path}/status`, {
      status: 'active',
      expectedUpdatedAt: current.updatedAt,
    });
  }
  current = await api('GET', path);
  if (
    Object.entries(identity).some(([key, value]) => current?.[key] !== value) ||
    current.status !== 'active'
  )
    throw new Error('UAP_PMS_PROVIDER_NOT_ACTIVE');
  return { ...identity, status: current.status };
}

async function ensureResource() {
  const path = `/api/v1/resources/${encodeURIComponent(EXPECTED.environment)}/${encodeURIComponent(EXPECTED.resourceId)}`;
  let current = await getOrNull(path);
  if (current === null) {
    await api('POST', '/api/v1/resources', {
      environment: EXPECTED.environment,
      resourceId: EXPECTED.resourceId,
      resourceType: EXPECTED.resourceType,
      metadata: expectedResourceMetadata(),
    });
    current = await api('GET', path);
  }
  if (
    current?.environment !== EXPECTED.environment ||
    current?.resourceId !== EXPECTED.resourceId ||
    current?.resourceType !== EXPECTED.resourceType
  )
    throw new Error('UAP_PMS_RESOURCE_IDENTITY_MISMATCH');
  if (!resourceMetadataMatches(current.metadata))
    throw new Error('UAP_PMS_RESOURCE_METADATA_DRIFT');
  if (current.status !== 'available') {
    if (current.status === 'retired') throw new Error('UAP_PMS_RESOURCE_RETIRED');
    await api('PATCH', `${path}/status`, {
      status: 'available',
      expectedUpdatedAt: current.updatedAt,
    });
  }
  current = await api('GET', path);
  assertResourceExact(current);
  return {
    environment: current.environment,
    resourceId: current.resourceId,
    resourceType: current.resourceType,
    status: current.status,
    metadata: current.metadata,
  };
}

async function ensureResourceBinding() {
  const path = `/api/v1/providers/${encodeURIComponent(EXPECTED.providerId)}/resource-bindings`;
  const listed = await api('GET', path);
  if (!Array.isArray(listed?.items)) throw new Error('UAP_PMS_BINDING_LIST_INVALID');
  const matches = listed.items.filter(
    (binding) =>
      binding?.environment === EXPECTED.environment && binding?.resourceId === EXPECTED.resourceId,
  );
  if (
    listed.items.length > 1 ||
    matches.length > 1 ||
    (listed.items.length === 1 && matches.length === 0)
  )
    throw new Error('UAP_PMS_BINDING_NOT_UNIQUE');
  if (matches.length === 0)
    await api('POST', path, {
      environment: EXPECTED.environment,
      resourceId: EXPECTED.resourceId,
    });
  const after = await api('GET', path);
  if (!Array.isArray(after?.items) || after.items.length !== 1)
    throw new Error('UAP_PMS_BINDING_NOT_UNIQUE');
  const binding = after.items[0];
  if (
    binding?.providerId !== EXPECTED.providerId ||
    binding?.environment !== EXPECTED.environment ||
    binding?.resourceId !== EXPECTED.resourceId ||
    typeof binding?.boundAt !== 'string' ||
    !Number.isFinite(Date.parse(binding.boundAt)) ||
    Object.keys(binding).sort().join(',') !==
      ['boundAt', 'environment', 'providerId', 'resourceId'].sort().join(',')
  )
    throw new Error('UAP_PMS_BINDING_IDENTITY_MISMATCH');
  return binding;
}

async function ensureDeployment() {
  const path = `/api/v1/runtime-deployments/${EXPECTED.deploymentId}?providerId=${encodeURIComponent(EXPECTED.providerId)}`;
  let current = await getOrNull(path);
  if (current === null) {
    await api('POST', '/api/v1/runtime-deployments', {
      deploymentId: EXPECTED.deploymentId,
      providerId: EXPECTED.providerId,
      environment: EXPECTED.environment,
      runtimeVersion: EXPECTED.runtimeVersion,
      adapterEndpoint: EXPECTED.adapterEndpoint,
      desiredReplicas: 1,
      runtimeAuthority: 'direct_container',
      directContainer: {
        instanceId: EXPECTED.instanceId,
        controlEndpoint: EXPECTED.controlEndpoint,
        advertisedEndpoint: EXPECTED.advertisedEndpoint,
      },
    });
    current = await api('GET', path);
  }
  assertDeploymentIdentity(current);
  if (current.status === 'STOPPED' || current.desiredState !== 'running')
    throw new Error('UAP_PMS_DEPLOYMENT_LIFECYCLE_DRIFT');
  if (new Set(['FAILED', 'DEGRADED']).has(current.status))
    current = unwrapDeployment(
      await api('POST', `/api/v1/runtime-deployments/${EXPECTED.deploymentId}/reconcile`, {
        providerId: EXPECTED.providerId,
        expectedDesiredRevision: current.desiredRevision,
      }),
    );
  assertDeploymentIdentity(current);
  // waitForAuthority performs the post-reconcile public GET and is the only value projected.
  return current;
}

async function waitForAuthority(initial) {
  assertDeploymentIdentity(initial);
  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() <= deadline) {
    const deployment = await api(
      'GET',
      `/api/v1/runtime-deployments/${EXPECTED.deploymentId}?providerId=${encodeURIComponent(EXPECTED.providerId)}`,
    );
    assertDeploymentIdentity(deployment);
    const runtimeProcess = await getOrNull(
      `/api/v1/runtime-processes/${EXPECTED.instanceId}?providerId=${encodeURIComponent(EXPECTED.providerId)}`,
    );
    const registry = await getOrNull(`/api/v1/registry/${EXPECTED.environment}/latest`);
    const provider = Array.isArray(registry?.document?.providers)
      ? registry.document.providers.find((value) => value?.providerId === EXPECTED.providerId)
      : undefined;
    const toolNames = Array.isArray(provider?.tools)
      ? provider.tools.map((tool) => tool?.name).sort()
      : [];
    if (
      deployment.status === 'ACTIVE' &&
      processReady(runtimeProcess) &&
      registry?.document?.environment === EXPECTED.environment &&
      Array.isArray(registry.document.providers) &&
      registry.document.providers.length === 1 &&
      Number.isSafeInteger(registry.revision) &&
      registry.revision > 0 &&
      typeof registry.checksum === 'string' &&
      /^[a-f0-9]{64}$/u.test(registry.checksum) &&
      provider?.effectiveEndpoint === new URL('/mcp', EXPECTED.advertisedEndpoint).toString() &&
      provider?.serverId === EXPECTED.instanceId &&
      provider?.protocolMode === 'frozen_v1' &&
      toolNames.length === EXPECTED_TOOLS.length &&
      toolNames.every((name, index) => name === [...EXPECTED_TOOLS].sort()[index])
    )
      return {
        deployment: {
          deploymentId: EXPECTED.deploymentId,
          providerId: deployment.providerId,
          environment: deployment.environment,
          runtimeVersion: deployment.runtimeVersion,
          adapterEndpoint: deployment.adapterEndpoint,
          desiredReplicas: deployment.desiredReplicas,
          status: deployment.status,
          runtimeAuthority: deployment.runtimeAuthority,
          directContainer: {
            instanceId: deployment.directContainer.instanceId,
            controlEndpoint: deployment.directContainer.controlEndpoint,
            advertisedEndpoint: deployment.directContainer.advertisedEndpoint,
          },
        },
        process: {
          instanceId: EXPECTED.instanceId,
          deploymentId: runtimeProcess.deploymentId,
          observedHealth: runtimeProcess.observedHealth,
          readyForActive: runtimeProcess.readyForActive,
          registrationState: runtimeProcess.registrationState,
          registrationFreshness: runtimeProcess.registrationFreshness,
          lastHeartbeatAt: runtimeProcess.lastHeartbeatAt,
          configState: runtimeProcess.configState,
        },
        registry: {
          revision: registry.revision,
          checksum: registry.checksum,
          effectiveEndpoint: provider.effectiveEndpoint,
          catalogToolCount: provider.tools.length,
          catalogToolNames: toolNames,
        },
      };
    await delay(pollIntervalMs);
  }
  throw new Error('UAP_PMS_RUNTIME_AUTHORITY_TIMEOUT');
}

function assertDeploymentIdentity(value) {
  if (
    value?.deploymentId !== EXPECTED.deploymentId ||
    value?.providerId !== EXPECTED.providerId ||
    value?.environment !== EXPECTED.environment ||
    value?.runtimeVersion !== EXPECTED.runtimeVersion ||
    value?.adapterEndpoint !== EXPECTED.adapterEndpoint ||
    value?.desiredReplicas !== 1 ||
    value?.runtimeAuthority !== 'direct_container' ||
    value?.directContainer?.instanceId !== EXPECTED.instanceId ||
    value?.directContainer?.controlEndpoint !== EXPECTED.controlEndpoint ||
    value?.directContainer?.advertisedEndpoint !== EXPECTED.advertisedEndpoint
  )
    throw new Error('UAP_PMS_DEPLOYMENT_IDENTITY_MISMATCH');
}

function assertResourceExact(value) {
  if (
    value?.environment !== EXPECTED.environment ||
    value?.resourceId !== EXPECTED.resourceId ||
    value?.resourceType !== EXPECTED.resourceType ||
    value?.status !== 'available' ||
    !resourceMetadataMatches(value.metadata)
  )
    throw new Error('UAP_PMS_RESOURCE_IDENTITY_MISMATCH');
}

function processReady(value) {
  const age =
    typeof value?.lastHeartbeatAt === 'string'
      ? Date.now() - Date.parse(value.lastHeartbeatAt)
      : Number.NaN;
  return (
    value?.instanceId === EXPECTED.instanceId &&
    value?.deploymentId === EXPECTED.deploymentId &&
    value?.observedHealth === 'READY' &&
    value?.readyForActive === true &&
    value?.registrationState === 'registered' &&
    value?.registrationFreshness === 'registered' &&
    value?.configState === 'externally_managed' &&
    Number.isFinite(age) &&
    age >= -1_000 &&
    age < 45_000
  );
}

function expectedResourceMetadata() {
  return {
    displayName: 'UGV 1',
    hostingMode: 'vendor_managed',
    runtimeAuthority: 'direct_container',
    registryAuthority: 'pms_worker',
    productionQualification: 'NOT_CLAIMED',
  };
}

function resourceMetadataMatches(value) {
  const expected = expectedResourceMetadata();
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === Object.keys(expected).sort().join(',') &&
    Object.entries(expected).every(([key, item]) => value[key] === item)
  );
}

function unwrapDeployment(value) {
  return value?.deployment ?? value;
}

async function api(method, path, body = undefined) {
  const response = await globalThis.fetch(new URL(path, apiBaseUrl), {
    method,
    headers: {
      accept: 'application/json',
      'x-actor-id': actorId,
      'x-correlation-id': correlationId,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  const source = await response.text();
  if (Buffer.byteLength(source, 'utf8') > 1024 * 1024)
    throw new Error('UAP_PMS_API_RESPONSE_TOO_LARGE');
  let payload;
  try {
    payload = source === '' ? null : JSON.parse(source);
  } catch {
    throw new Error('UAP_PMS_API_RESPONSE_INVALID');
  }
  if (!response.ok) {
    const code = payload?.error?.code;
    throw new Error(
      typeof code === 'string' && /^[A-Z0-9_]{1,128}$/u.test(code)
        ? `UAP_PMS_API_${String(response.status)}_${code}`
        : `UAP_PMS_API_${String(response.status)}`,
    );
  }
  return payload;
}

async function getOrNull(path) {
  try {
    return await api('GET', path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('UAP_PMS_API_404')) return null;
    throw error;
  }
}

async function secretText(path) {
  const value = (await readFile(path, 'utf8')).trim();
  if (value.length < 16 || value.length > 8_192 || /[\0\r\n]/u.test(value))
    throw new Error('UAP_PMS_SECRET_FILE_INVALID');
  return value;
}

function exact(name, expected) {
  const value = process.env[name];
  if (value !== expected) throw new Error(`${name}_INVALID`);
  return value;
}

function exactUrl(name, expected) {
  const value = exact(name, expected);
  const parsed = new URL(value);
  if (parsed.username !== '' || parsed.password !== '') throw new Error(`${name}_INVALID`);
  return parsed;
}

function positiveInteger(name, fallback, maximum) {
  const source = process.env[name] ?? String(fallback);
  if (!/^[1-9][0-9]*$/u.test(source)) throw new Error(`${name}_INVALID`);
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value > maximum) throw new Error(`${name}_INVALID`);
  return value;
}
