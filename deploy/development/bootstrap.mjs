import console from 'node:console';
import { readFile, writeFile } from 'node:fs/promises';
import { bootstrapUgvSmppSource } from '../../dist/apps/node-control-acceptance/src/ugv-smpp-source-bootstrap-driver.js';
import { materializeUgvSmppProvider } from '../../dist/apps/node-control-acceptance/src/ugv-smpp-provider-materialization-driver.js';
import { governUgvSmppCapabilities } from '../../dist/apps/node-control-acceptance/src/ugv-smpp-capability-governance-driver.js';

const c = JSON.parse(await readFile('/run/sdar/environment.json', 'utf8'));
const observedAt = new Date().toISOString();
let result;
if (c.SDAR_UGV_BOOTSTRAP_ENABLED !== 'YES') {
  result = { status: 'unavailable', reasonCode: 'DEVELOPMENT_PROVIDER_NOT_CONFIGURED', observedAt };
} else {
  const required = [
    'SDAR_UGV_REGISTRY_ENDPOINT',
    'SDAR_UGV_SOURCE_ID',
    'SDAR_UGV_EXTERNAL_PROVIDER_ID',
    'SDAR_UGV_EXTERNAL_SERVER_ID',
  ];
  const missing = required.filter((key) => !c[key]);
  if (missing.length)
    throw new Error(`DEVELOPMENT_BOOTSTRAP_CONFIGURATION_MISSING:${missing.join(',')}`);
  const runId = `development-${Date.now()}`;
  const shared = {
    nodeControlBaseUrl: 'http://control-api:10091',
    nodeControlBearerToken: c.SDAR_CONTROL_API_TOKEN,
    runtimeManagementBaseUrl: 'http://runtime:10998',
    runId,
  };
  try {
    const source = await bootstrapUgvSmppSource({
      nodeControlBaseUrl: shared.nodeControlBaseUrl,
      nodeControlAdminToken: c.SDAR_CONTROL_API_TOKEN,
      smppSourceId: c.SDAR_UGV_SOURCE_ID,
      smppEnvironment: c.SDAR_UGV_REGISTRY_ENVIRONMENT || 'development',
      registryEndpoint: c.SDAR_UGV_REGISTRY_ENDPOINT,
      registryCredentialRef: 'unauthenticated://none',
      syncMode: 'poll',
      snapshotTtlSeconds: 300,
      lkgPolicy: 'allow_unexpired',
      externalProviderId: c.SDAR_UGV_EXTERNAL_PROVIDER_ID,
      externalServerId: c.SDAR_UGV_EXTERNAL_SERVER_ID,
      runId,
    });
    const provider = await materializeUgvSmppProvider({
      ...shared,
      smppSourceId: c.SDAR_UGV_SOURCE_ID,
      externalProviderId: c.SDAR_UGV_EXTERNAL_PROVIDER_ID,
      externalServerId: c.SDAR_UGV_EXTERNAL_SERVER_ID,
      localServerId: c.SDAR_UGV_SERVER_ID,
      bindingId: c.SDAR_UGV_BINDING_ID,
      providerDisplayName: 'Development UGV',
      runtimeCredentialRef: 'unauthenticated://none',
    });
    const governance = await governUgvSmppCapabilities({
      ...shared,
      packageWorkspaceRoot: '/app/development-packages',
      initialPointSkillPackageRoot: '/app/skills/embodied.move_to',
      developmentComposeNetwork: true,
      excludeDeviceWeapons: true,
      bindingId: c.SDAR_UGV_BINDING_ID,
      resourceId: c.SDAR_UGV_RESOURCE_ID,
      activateNavigateControl: true,
      navigateControlMode: 'coordinate_point',
      runtimeExecutionContext:
        c.SDAR_UGV_EXECUTION_MODE === 'simulation'
          ? { mode: 'simulation', simulationId: c.UGV_SIMULATION_RUN_ID }
          : { mode: 'live' },
    });
    result = { status: 'registered', observedAt, source, provider, governance, deviceCalls: 0 };
  } catch (error) {
    // Only typed codes leave the process. Upstream error messages can contain URLs or credentials.
    result = {
      status: 'unavailable',
      reasonCode:
        typeof error?.code === 'string' ? error.code : 'DEVELOPMENT_GOVERNANCE_BOOTSTRAP_FAILED',
      observedAt,
    };
  }
}
await writeFile(
  '/app/development-packages/bootstrap-status.json',
  JSON.stringify(result, null, 2),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    status: result.status,
    reasonCode: result.reasonCode,
    observedAt,
    deviceCalls: 0,
  }),
);
