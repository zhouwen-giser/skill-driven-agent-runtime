import { describe, expect, it, vi } from 'vitest';
import { runGovernanceBootstrap } from '../../../deploy/development/bootstrap-runner.mjs';
import { verifyPublishedInventory } from '../../../deploy/development/bootstrap-verification.mjs';
import { defaults } from '../../../deploy/development/config.mjs';

const configured = {
  SDAR_UGV_BOOTSTRAP_ENABLED: 'YES',
  SDAR_UGV_REGISTRY_ENDPOINT: 'http://registry.example/registry',
  SDAR_UGV_SOURCE_ID: 'source',
  SDAR_UGV_EXTERNAL_PROVIDER_ID: 'provider',
  SDAR_UGV_EXTERNAL_SERVER_ID: 'server',
};
function stages(): Record<string, () => Promise<unknown>> {
  return Object.fromEntries(
    ['source', 'provider', 'governance', 'builtins', 'verify'].map((name) => [
      name,
      vi.fn(() => Promise.resolve({ blocked: [] })),
    ]),
  );
}
describe('default capability bootstrap', () => {
  it('defaults to enabled governance and the approved non-weapon development policy', () => {
    expect(defaults).toMatchObject({
      SDAR_UGV_BOOTSTRAP_ENABLED: 'YES',
      SDAR_TASK_UNDERSTANDING_PROFILE: 'ugv-agent-profile',
      SDAR_DEVELOPMENT_CONFIRMATION_POLICY: 'auto_non_weapon',
      ALLOW_UGV_LIVE_SIDE_EFFECTS: 'YES',
    });
  });
  it('refuses missing registry configuration before any stage is invoked', async () => {
    const dependencies = stages();
    expect(
      await runGovernanceBootstrap({ SDAR_UGV_BOOTSTRAP_ENABLED: 'YES' }, dependencies),
    ).toMatchObject({
      status: 'failed',
      reasonCode: 'DEVELOPMENT_BOOTSTRAP_CONFIGURATION_MISSING',
      completedStages: [],
    });
    for (const stage of Object.values(dependencies)) expect(stage).not.toHaveBeenCalled();
  });
  it('honors an explicit disabled override without claiming successful governance', async () => {
    const dependencies = stages();
    expect(
      await runGovernanceBootstrap(
        { ...configured, SDAR_UGV_BOOTSTRAP_ENABLED: 'NO' },
        dependencies,
      ),
    ).toMatchObject({ status: 'disabled' });
    for (const stage of Object.values(dependencies)) expect(stage).not.toHaveBeenCalled();
  });
  it('stops after a failing stage and never includes private upstream errors', async () => {
    const dependencies = stages();
    dependencies['provider'] = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error('private-credential-in-url'), {
          code: 'PROVIDER_CONTRACT_MISMATCH',
        }),
      ),
    );
    const result = await runGovernanceBootstrap(configured, dependencies);
    expect(result).toMatchObject({
      status: 'failed',
      failedStage: 'provider',
      completedStages: ['source'],
      reasonCode: 'PROVIDER_CONTRACT_MISMATCH',
    });
    expect(JSON.stringify(result)).not.toContain('private-credential');
    expect(dependencies['governance']).not.toHaveBeenCalled();
  });
  it('reports missing builtin dependencies instead of accepting partial governance', async () => {
    const dependencies = stages();
    dependencies['builtins'] = vi.fn(() =>
      Promise.resolve({
        blocked: [{ dependency: 'embodied.inspect_area' }],
      }),
    );
    expect(await runGovernanceBootstrap(configured, dependencies)).toMatchObject({
      status: 'failed',
      failedStage: 'builtins',
    });
    expect(dependencies['verify']).not.toHaveBeenCalled();
  });
  it('fails deployment acceptance when the published resource and Runtime authority conflict', async () => {
    const dependencies = stages();
    dependencies['verify'] = vi.fn(() =>
      Promise.resolve({
        blocked: [
          { capabilityId: 'embodied.move', reasonCode: 'DEPLOYMENT_RESOURCE_IDENTITY_CONFLICT' },
        ],
      }),
    );
    expect(await runGovernanceBootstrap(configured, dependencies)).toMatchObject({
      status: 'failed',
      failedStage: 'verify',
      blocked: [
        { capabilityId: 'embodied.move', reasonCode: 'DEPLOYMENT_RESOURCE_IDENTITY_CONFLICT' },
      ],
    });
  });
  it('requires the final public inventory stage before successful completion', async () => {
    expect(await runGovernanceBootstrap(configured, stages())).toMatchObject({
      status: 'registered',
      completedStages: ['source', 'provider', 'governance', 'builtins', 'verify'],
      blocked: [],
      deviceCalls: 0,
    });
  });
  it('verifies exact official exposure catalog versions and hashes', () => {
    const exposure = {
      capabilityId: 'capability',
      capabilityVersion: 2,
      exposureId: 'exposure',
      version: 3,
      exposureHash: 'hash',
      status: 'published',
      visibility: 'public',
      agentSkillId: 'skill',
    };
    const entry = {
      capabilityId: 'capability',
      capabilityVersion: 2,
      exposureId: 'exposure',
      exposureVersion: 3,
      exposureHash: 'hash',
      agentSkillId: 'skill',
    };
    const inventory = {
      skills: [{ skillId: 'skill', status: 'enabled' }],
      capabilities: [{ capabilityId: 'capability', version: 2, status: 'published' }],
      exposures: [exposure],
      card: {
        skills: [{ id: 'skill' }],
        capabilities: {
          extensions: [
            {
              uri: 'io.sdar/capabilityExposureCatalog',
              params: { entries: [entry], version: '1.0' },
            },
          ],
        },
      },
    };
    const manifest = { skills: [{ skillId: 'skill', capabilityId: 'capability' }] };
    expect(verifyPublishedInventory(manifest, inventory).blocked).toEqual([]);
    entry.exposureHash = 'stale-hash';
    expect(verifyPublishedInventory(manifest, inventory).blocked).toEqual([
      { capabilityId: 'capability', reasonCode: 'PUBLIC_CAPABILITY_MISSING' },
    ]);
  });

  it('rejects a nonempty Card that omits the expected capability and skill', () => {
    const result = verifyPublishedInventory(
      { skills: [{ skillId: 'expected', capabilityId: 'expected-capability' }] },
      {
        skills: [{ skillId: 'expected', status: 'enabled' }],
        capabilities: [{ capabilityId: 'expected-capability', version: 2, status: 'published' }],
        exposures: [
          {
            exposureId: 'old',
            version: 1,
            exposureHash: 'old-hash',
            capabilityId: 'expected-capability',
            capabilityVersion: 1,
            status: 'published',
            visibility: 'public',
            agentSkillId: 'old',
          },
        ],
        card: {
          skills: [{ id: 'old' }],
          capabilities: {
            extensions: [
              {
                uri: 'io.sdar/capabilityExposureCatalog',
                params: {
                  entries: [
                    {
                      capabilityId: 'different-capability',
                      capabilityVersion: 1,
                      agentSkillId: 'old',
                      exposureId: 'old',
                      exposureVersion: 1,
                      exposureHash: 'old-hash',
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    );
    expect(result.blocked.map((item) => item.reasonCode)).toEqual([
      'PUBLIC_SKILL_MISSING',
      'PUBLIC_CAPABILITY_MISSING',
    ]);
  });
});
