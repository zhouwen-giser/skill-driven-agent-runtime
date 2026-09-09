// Run inside the qualified PMS API image. All writes use official PMS services/APIs.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import pg from '/app/node_modules/pg/lib/index.js';
const { Pool } = pg;
import { synchronizeWorkspaceProviderPackages } from '/app/dist/packages/pms-application/src/index.js';
import { PostgresPmsUnitOfWork } from '/app/dist/packages/pms-persistence-postgres/src/index.js';
const identity = JSON.parse(await readFile('/run/pms-site/identity.json', 'utf8'));
const correlationId = 'sdar-site-registry-' + randomUUID();
const actorId = 'sdar-site-deployment-owner';
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await globalThis.fetch('http://127.0.0.1:8090/api/v1/' + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-actor-id': actorId,
      'x-correlation-id': correlationId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: globalThis.AbortSignal.timeout(30000),
  });
  if (response.status === 404 && method === 'GET') return undefined;
  if (!response.ok) throw new Error('PMS_REGISTER_API_' + response.status);
  return response.json();
}
const pool = new Pool({
  connectionString: (await readFile('/run/pms-site/database-url', 'utf8')).trim(),
});
try {
  await synchronizeWorkspaceProviderPackages(
    new PostgresPmsUnitOfWork(pool),
    { actorId, correlationId },
    '/app',
  );
} finally {
  await pool.end();
}
const typeId = 'isr.vehicle.ugv';
let type = await api('provider-types/' + typeId);
if (!type) type = await api('provider-types', { providerTypeId: typeId, displayName: 'UGV' });
if (type.status !== 'active')
  await api(
    'provider-types/' + typeId + '/status',
    { status: 'active', expectedUpdatedAt: type.updatedAt },
    'PATCH',
  );
let provider = await api('providers/' + identity.providerId);
if (!provider)
  provider = await api('providers', {
    providerId: identity.providerId,
    providerTypeId: typeId,
    packageId: 'builtin.isr.vehicle.ugv',
    packageVersion: '1.0.0',
    hostingMode: 'vendor_managed',
    adapterEndpoint: identity.adapterEndpoint,
  });
if (provider.adapterEndpoint !== identity.adapterEndpoint || provider.providerTypeId !== typeId)
  throw new Error('PMS_PROVIDER_IDENTITY_DRIFT');
if (provider.status !== 'active') {
  if (!['draft', 'degraded'].includes(provider.status))
    throw new Error('PMS_PROVIDER_NOT_ACTIVATABLE');
  await api(
    'providers/' + identity.providerId + '/status',
    { status: 'active', expectedUpdatedAt: provider.updatedAt },
    'PATCH',
  );
}
const resourcePath =
  'resources/' + identity.environment + '/' + encodeURIComponent(identity.resourceId);
let resource = await api(resourcePath);
if (!resource)
  resource = await api('resources', {
    environment: identity.environment,
    resourceId: identity.resourceId,
    resourceType: typeId,
    metadata: {
      displayName: 'sz-gowm UGV',
      hostingMode: 'vendor_managed',
      runtimeAuthority: 'direct_container',
      registryAuthority: 'pms_worker',
      productionQualification: 'NOT_CLAIMED',
    },
  });
if (resource.resourceType !== typeId) throw new Error('PMS_RESOURCE_IDENTITY_DRIFT');
if (resource.status !== 'available') {
  if (resource.status === 'retired') throw new Error('PMS_RESOURCE_RETIRED');
  await api(
    resourcePath + '/status',
    { status: 'available', expectedUpdatedAt: resource.updatedAt },
    'PATCH',
  );
}
const bindingPath = 'providers/' + identity.providerId + '/resource-bindings';
const bindings = await api(bindingPath);
if (
  !bindings.items.some(
    (entry) =>
      entry.environment === identity.environment && entry.resourceId === identity.resourceId,
  )
)
  await api(bindingPath, { environment: identity.environment, resourceId: identity.resourceId });
const deploymentPath =
  'runtime-deployments/' + identity.deploymentId + '?providerId=' + identity.providerId;
let deployment = await api(deploymentPath);
if (!deployment)
  deployment = await api('runtime-deployments', {
    deploymentId: identity.deploymentId,
    providerId: identity.providerId,
    environment: identity.environment,
    runtimeVersion: '2.0.0-rc.1',
    adapterEndpoint: identity.adapterEndpoint,
    desiredReplicas: 1,
    runtimeAuthority: 'direct_container',
    directContainer: {
      instanceId: identity.instanceId,
      controlEndpoint: identity.controlEndpoint,
      advertisedEndpoint: identity.advertisedEndpoint,
    },
  });
const state = deployment.deployment ?? deployment;
if (state.runtimeAuthority !== 'direct_container' || state.deploymentId !== identity.deploymentId)
  throw new Error('PMS_DEPLOYMENT_IDENTITY_DRIFT');
console.log(
  JSON.stringify({
    status: 'PMS_RUNTIME_REGISTERED',
    providerId: identity.providerId,
    deploymentId: identity.deploymentId,
    instanceId: identity.instanceId,
    deviceCalls: 0,
  }),
);
