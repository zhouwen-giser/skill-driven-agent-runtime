import console from 'node:console';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import { runGovernanceBootstrap } from './bootstrap-runner.mjs';
import { verifyPublishedInventory } from './bootstrap-verification.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { bootstrapUgvSmppSource } from '../../dist/apps/node-control-acceptance/src/ugv-smpp-source-bootstrap-driver.js';
import { materializeUgvSmppProvider } from '../../dist/apps/node-control-acceptance/src/ugv-smpp-provider-materialization-driver.js';
import { governUgvSmppCapabilities } from '../../dist/apps/node-control-acceptance/src/ugv-smpp-capability-governance-driver.js';

const c = JSON.parse(await readFile('/run/sdar/environment.json', 'utf8'));
const manifest = JSON.parse(
  await readFile(new URL('./capability-manifest.json', import.meta.url), 'utf8'),
);
const runId = `development-${Date.now()}`;
const shared = {
  nodeControlBaseUrl: 'http://control-api:10091',
  nodeControlBearerToken: c.SDAR_CONTROL_API_TOKEN,
  runtimeManagementBaseUrl: 'http://runtime:10998',
  runId,
};
async function get(base, path) {
  const response = await globalThis.fetch(base + path, {
    headers: { authorization: 'Bearer ' + c.SDAR_CONTROL_API_TOKEN },
    redirect: 'manual',
    signal: globalThis.AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Object.assign(new Error('Governance read failed'), {
      code: 'DEVELOPMENT_GOVERNANCE_READ_FAILED',
    });
  return response.json();
}
async function verifyInventory() {
  const inventory = verifyPublishedInventory(manifest, {
    skills: (await get(shared.runtimeManagementBaseUrl, '/api/v1/skills')).items,
    capabilities: (await get(shared.nodeControlBaseUrl, '/api/v1/node-capabilities?pageSize=200'))
      .items,
    exposures: (await get(shared.nodeControlBaseUrl, '/api/v1/a2a-exposures?pageSize=200')).items,
    card: await get('http://runtime:10999', '/.well-known/agent-card.json'),
  });
  if (c.SDAR_TASK_UNDERSTANDING_PROFILE !== 'ugv-agent-profile') return inventory;
  let resourceIdentity;
  try {
    resourceIdentity = JSON.parse(
      execFileSync(
        process.execPath,
        [new URL('./verify-resource-identity.mjs', import.meta.url).pathname],
        { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    );
  } catch {
    resourceIdentity = { status: 'FAILED', reasonCode: 'DEPLOYMENT_RESOURCE_IDENTITY_CONFLICT' };
  }
  return {
    ...inventory,
    resourceIdentity,
    blocked: [
      ...inventory.blocked,
      ...(resourceIdentity.status === 'PASS'
        ? []
        : [{ capabilityId: 'embodied.move', reasonCode: 'DEPLOYMENT_RESOURCE_IDENTITY_CONFLICT' }]),
    ],
  };
}
const result = await runGovernanceBootstrap(c, {
  source: async () => {
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
    return source;
  },
  provider: async () => {
    const provider = await materializeUgvSmppProvider({
      ...shared,
      smppSourceId: c.SDAR_UGV_SOURCE_ID,
      externalProviderId: c.SDAR_UGV_EXTERNAL_PROVIDER_ID,
      externalServerId: c.SDAR_UGV_EXTERNAL_SERVER_ID,
      localServerId: c.SDAR_UGV_SERVER_ID,
      bindingId: c.SDAR_UGV_BINDING_ID,
      providerDisplayName: 'Development UGV',
      developmentComposeNetwork: true,
      catalogProfile: c.SDAR_UGV_CATALOG_PROFILE || 'ugv-v1-11',
      runtimeCredentialRef: 'unauthenticated://none',
    });
    return provider;
  },
  governance: async () => {
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
    return governance;
  },
  builtins: async () => {
    const skills = (await get(shared.runtimeManagementBaseUrl, '/api/v1/skills')).items;
    const capabilities = (
      await get(shared.nodeControlBaseUrl, '/api/v1/node-capabilities?pageSize=200')
    ).items;
    const blocked = [];
    for (const item of manifest.skills.filter((entry) => entry.requiredCapabilities)) {
      for (const id of item.requiredCapabilities) {
        if (
          !capabilities.some((entry) => entry.capabilityId === id && entry.status === 'published')
        )
          blocked.push({
            skillId: item.skillId,
            dependency: id,
            reasonCode: 'BUILTIN_CAPABILITY_DEPENDENCY_MISSING',
          });
      }
      for (const id of item.requiredSkills ?? []) {
        if (!skills.some((entry) => entry.skillId === id && entry.status === 'enabled'))
          blocked.push({
            skillId: item.skillId,
            dependency: id,
            reasonCode: 'BUILTIN_SKILL_DEPENDENCY_MISSING',
          });
      }
    }
    return { blocked };
  },
  verify: verifyInventory,
});
result.expected = {
  skills: manifest.skills.map((item) => item.skillId),
  capabilities: manifest.skills.map((item) => item.capabilityId),
};
if (result.failedStage === 'builtins') result.inventory = await verifyInventory();

await writeFile(
  '/app/development-packages/bootstrap-status.json',
  JSON.stringify(result, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(result));
if (result.status === 'failed') process.exitCode = 1;
