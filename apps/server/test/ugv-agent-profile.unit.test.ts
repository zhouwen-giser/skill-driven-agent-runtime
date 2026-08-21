import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { SkillRepository } from '../../../packages/application/src/index.js';
import type { Skill, SkillVersion } from '../../../packages/domain/src/index.js';
import { parseServerEnvironment } from '../src/environment.js';
import { startServerRuntime } from '../src/runtime.js';
import {
  UGV_AGENT_PROFILE_CAPABILITY_ID,
  UGV_AGENT_PROFILE_ID,
  UGV_AGENT_PROFILE_OPERATION_POLICY,
  UGV_AGENT_PROFILE_SKILL_REF,
  UgvAgentProfileSkillRepositoryView,
  assertUgvAgentProfileRuntimeConfiguration,
  projectUgvAgentProfileEnabledSkills,
  ugvAgentProfileTaskUnderstandingConfiguration,
  useManagedAgentCardForProfile,
} from '../src/ugv-agent-profile.js';
import { loadExactUgvProfileSkill } from './ugv-agent-profile-test-fixture.js';

describe('UGV Agent Profile composition', () => {
  it('declares one point-navigation capability while keeping reads contextual and safety operations forbidden', () => {
    expect(ugvAgentProfileTaskUnderstandingConfiguration()).toMatchObject({
      profile: UGV_AGENT_PROFILE_ID,
      entryPolicy: 'all_requests',
      skillSelectionMode: 'exact_compatible_only',
      taskTypes: [
        {
          taskTypeId: 'task-type.ugv-point-navigation',
          version: 1,
          capabilityRequirements: [UGV_AGENT_PROFILE_CAPABILITY_ID],
          requiredDimensions: ['target', 'side_effect_authorization'],
          risks: ['physical_side_effect', 'explicit_plan_confirmation'],
        },
      ],
    });
    expect(UGV_AGENT_PROFILE_OPERATION_POLICY).toEqual(
      expect.objectContaining({
        publicSkillAllowlist: [UGV_AGENT_PROFILE_SKILL_REF],
        contextAndEvidenceReadOperations: [
          { operationName: 'vehicle_get_state', purpose: 'initial_context' },
          { operationName: 'vehicle_get_state', purpose: 'final_position_evidence' },
        ],
        governedControlOperations: [
          expect.objectContaining({ operationName: 'vehicle_navigate', missionType: 'point' }),
        ],
        forbiddenPlannerOperations: [
          'vehicle_area_recon',
          'vehicle_track_target',
          'vehicle_control_gimbal',
          'vehicle_fire_weapon',
          'vehicle_emergency_stop',
        ],
        emergencyStopAuthority: 'manual_operator_only',
      }),
    );
  });

  it('projects only the enabled exact SkillVersion and never reverse-projects Provider or legacy operations', async () => {
    const exact = await exactSkill();
    const otherVersion = { ...exact, version: 2, previousVersion: 1 } as SkillVersion;
    const legacy = {
      ...exact,
      skillId: 'ugv.navigate',
      name: 'Legacy UGV navigate',
    } as SkillVersion;
    const unrelated = {
      ...exact,
      skillId: 'inspection.device',
      name: 'Inspect device',
    } as SkillVersion;

    expect(projectUgvAgentProfileEnabledSkills([legacy, otherVersion, unrelated, exact])).toEqual([
      exact,
    ]);
    expect(projectUgvAgentProfileEnabledSkills([legacy, otherVersion, unrelated])).toEqual([]);
    expect(projectUgvAgentProfileEnabledSkills([{ ...exact, status: 'disabled' }])).toEqual([]);
    expect(() =>
      projectUgvAgentProfileEnabledSkills([{ ...exact, capabilities: ['vehicle.ugv.navigate'] }]),
    ).toThrow('UGV_AGENT_PROFILE_SKILL_DECLARATION_INVALID');
  });

  it('uses a read-only exact-version repository view for selection', async () => {
    const exact = await exactSkill();
    const legacy = {
      ...exact,
      skillId: 'ugv.navigate',
      name: 'Legacy UGV navigate',
    } as SkillVersion;
    const source = new InMemorySkillRepository([legacy, exact]);
    const view = new UgvAgentProfileSkillRepositoryView(source);

    await expect(view.listEnabledVersions()).resolves.toEqual([exact]);
    await expect(view.findVersion('embodied.move_to', 1)).resolves.toEqual(exact);
    await expect(view.findVersion('embodied.move_to', 2)).resolves.toBeUndefined();
    await expect(view.findVersion('ugv.navigate', 1)).resolves.toBeUndefined();
    await expect(view.saveVersionAndSetCurrent(exact, exact.createdAt)).rejects.toThrow(
      'UGV_AGENT_PROFILE_SKILL_CATALOG_READ_ONLY',
    );
  });

  it('fails startup closed unless the canonical profile and existing governance authorities are composed', () => {
    const valid = validRuntimeConfiguration();
    expect(() => {
      assertUgvAgentProfileRuntimeConfiguration(valid);
    }).not.toThrow();
    expect(() => {
      assertUgvAgentProfileRuntimeConfiguration({
        ...valid,
        evidenceEnvironment: 'production',
      });
    }).toThrow('UGV_AGENT_PROFILE_SIMULATION_ENVIRONMENT_REQUIRED');
    expect(() => {
      assertUgvAgentProfileRuntimeConfiguration({
        ...valid,
        taskUnderstanding: {
          ...ugvAgentProfileTaskUnderstandingConfiguration(),
          taskTypes: [],
        },
      });
    }).toThrow('UGV_AGENT_PROFILE_CONFIGURATION_INVALID');
    const {
      currentMcpProviderBindingAuthorityReader: bindingAuthority,
      ...missingBindingAuthority
    } = valid;
    expect(bindingAuthority).toBeDefined();
    expect(() => {
      assertUgvAgentProfileRuntimeConfiguration(missingBindingAuthority);
    }).toThrow('UGV_AGENT_PROFILE_PROVIDER_BINDING_AUTHORITY_REQUIRED');
    const { governedControlPrincipalResolver: controlIdentity, ...missingControlIdentity } = valid;
    expect(controlIdentity).toBeDefined();
    expect(() => {
      assertUgvAgentProfileRuntimeConfiguration(missingControlIdentity);
    }).toThrow('UGV_AGENT_PROFILE_CONTROL_IDENTITY_REQUIRED');
    const { frozenMcpTasks, ...missingFrozenMcpTasks } = valid;
    expect(frozenMcpTasks).toBeDefined();
    expect(() => {
      assertUgvAgentProfileRuntimeConfiguration(missingFrozenMcpTasks);
    }).toThrow('UGV_AGENT_PROFILE_FROZEN_MCP_TASKS_REQUIRED');
    const { ugvMovePositionPolicy, ...missingPositionPolicy } = valid;
    expect(ugvMovePositionPolicy).toBeDefined();
    if (ugvMovePositionPolicy === undefined) throw new Error('TEST_POSITION_POLICY_REQUIRED');
    expect(() => {
      assertUgvAgentProfileRuntimeConfiguration(missingPositionPolicy);
    }).toThrow('explicit positive tolerance');
    expect(() => {
      assertUgvAgentProfileRuntimeConfiguration({
        ...valid,
        ugvMovePositionPolicy: { ...ugvMovePositionPolicy, toleranceM: 2.001 },
      });
    }).toThrow('explicit positive tolerance');
  });

  it('rejects a direct production start before opening infrastructure', async () => {
    await expect(
      startServerRuntime({
        postgresUrl: 'postgresql://unused.invalid/sdar',
        redis: { host: '127.0.0.1', port: 1 },
        masterKeyBase64: randomBytes(32).toString('base64'),
        ...validRuntimeConfiguration(),
        evidenceEnvironment: 'production',
      }),
    ).rejects.toThrow('UGV_AGENT_PROFILE_SIMULATION_ENVIRONMENT_REQUIRED');
  });

  it('parses only the explicit deterministic environment identity with governance credentials', () => {
    const environment = parseServerEnvironment({
      NODE_ENV: 'test',
      SDAR_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
      SDAR_TASK_UNDERSTANDING_PROFILE: UGV_AGENT_PROFILE_ID,
      SDAR_CONTROL_ENVIRONMENT: 'integration',
      SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:9997',
      SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN: 'n'.repeat(32),
      SDAR_GOVERNED_CONTROL_BEARER_TOKEN: 'g'.repeat(32),
      SDAR_GOVERNED_CONTROL_ACTOR_ID: 'ugv-simulation-operator',
      SDAR_GOVERNED_CONTROL_PERMISSIONS: 'physical_control.confirm',
    });

    expect(environment.SDAR_TASK_UNDERSTANDING_PROFILE).toBe(UGV_AGENT_PROFILE_ID);
    expect(environment).toMatchObject({
      UGV_TEST_TOLERANCE_M: 2,
      UGV_TEST_MINIMUM_DISPLACEMENT_M: 0.5,
      UGV_TEST_MAX_FINAL_STATE_AGE_MS: 3_000,
    });
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: 'test',
        SDAR_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
        UGV_TEST_TOLERANCE_M: '2.001',
      }),
    ).toThrow();
    expect(useManagedAgentCardForProfile(environment.SDAR_TASK_UNDERSTANDING_PROFILE)).toBe(false);
    expect(useManagedAgentCardForProfile('managed_capability')).toBe(true);

    expect(() => {
      parseServerEnvironment({
        NODE_ENV: 'production',
        SDAR_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
        SDAR_TASK_UNDERSTANDING_PROFILE: UGV_AGENT_PROFILE_ID,
        SDAR_CONTROL_ENVIRONMENT: 'production',
        SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:9997',
        SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN: 'n'.repeat(32),
        SDAR_GOVERNED_CONTROL_BEARER_TOKEN: 'g'.repeat(32),
        SDAR_GOVERNED_CONTROL_ACTOR_ID: 'ugv-simulation-operator',
        SDAR_GOVERNED_CONTROL_PERMISSIONS: 'physical_control.confirm',
      });
    }).toThrow('external-simulation-only');
  });
});

async function exactSkill(): Promise<SkillVersion> {
  return loadExactUgvProfileSkill();
}

function validRuntimeConfiguration(): Parameters<
  typeof assertUgvAgentProfileRuntimeConfiguration
>[0] {
  return {
    evidenceEnvironment: 'integration',
    taskUnderstanding: ugvAgentProfileTaskUnderstandingConfiguration(),
    capabilityAuthorityReader: {
      load: () => Promise.reject(new Error('startup validation must not query authority')),
    },
    currentMcpProviderBindingAuthorityReader: {
      loadCurrentMcpProviderBinding: () =>
        Promise.reject(new Error('startup validation must not query authority')),
    },
    frozenMcpTasks: { isolationAcknowledged: true },
    ugvMovePositionPolicy: {
      toleranceM: 2,
      minimumDisplacementM: 0.5,
      maxFinalStateAgeMs: 3_000,
    },
    governedControlPrincipalResolver: {
      resolve: () => Promise.reject(new Error('startup validation must not resolve identity')),
    },
  };
}

class InMemorySkillRepository implements SkillRepository {
  readonly #versions: readonly SkillVersion[];

  constructor(versions: readonly SkillVersion[]) {
    this.#versions = versions;
  }

  find(skillId: string): Promise<Skill | undefined> {
    const current = this.#versions.find((version) => version.skillId === skillId);
    return Promise.resolve(
      current === undefined
        ? undefined
        : {
            skillId,
            currentVersion: current.version,
            createdAt: current.createdAt,
            updatedAt: current.createdAt,
          },
    );
  }

  findCurrentVersion(skillId: string): Promise<SkillVersion | undefined> {
    return Promise.resolve(this.#versions.find((version) => version.skillId === skillId));
  }

  findVersion(skillId: string, version: number): Promise<SkillVersion | undefined> {
    return Promise.resolve(
      this.#versions.find(
        (candidate) => candidate.skillId === skillId && candidate.version === version,
      ),
    );
  }

  listVersions(skillId: string): Promise<readonly SkillVersion[]> {
    return Promise.resolve(this.#versions.filter((version) => version.skillId === skillId));
  }

  listEnabledVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve(this.#versions.filter((version) => version.status === 'enabled'));
  }

  listCurrentVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve(this.#versions);
  }

  saveVersionAndSetCurrent(): Promise<void> {
    return Promise.reject(new Error('unused'));
  }
}
