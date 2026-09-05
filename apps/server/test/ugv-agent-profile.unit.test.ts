import { describe, expect, it } from 'vitest';

import type { SkillRepository } from '../../../packages/application/src/index.js';
import type { Skill, SkillVersion } from '../../../packages/domain/src/index.js';
import { parseServerEnvironment } from '../src/environment.js';
import {
  UGV_AGENT_PROFILE_CAPABILITY_ID,
  UGV_AGENT_PROFILE_ID,
  UGV_AGENT_PROFILE_OPERATION_POLICY,
  UGV_AGENT_PROFILE_SKILL_ID,
  UgvAgentProfileSkillRepositoryView,
  assertUgvAgentProfileRuntimeConfiguration,
  prepareUgvAgentProfileReadOnlyResult,
  projectUgvAgentProfileEnabledSkills,
  ugvAgentProfileTaskUnderstandingConfiguration,
  useManagedAgentCardForProfile,
  verifiedUgvAgentProfileOutcomeRefs,
} from '../src/ugv-agent-profile.js';
import { loadExactUgvProfileSkill } from './ugv-agent-profile-test-fixture.js';

describe('UGV Agent Profile composition', () => {
  it('declares all reviewed UGV Capability task types and authority classes', () => {
    const taskUnderstanding = ugvAgentProfileTaskUnderstandingConfiguration();
    expect(taskUnderstanding).toMatchObject({
      profile: UGV_AGENT_PROFILE_ID,
      entryPolicy: 'all_requests',
      skillSelectionMode: 'exact_compatible_only',
    });
    expect(taskUnderstanding.taskTypes).toHaveLength(13);
    expect(taskUnderstanding.taskTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskTypeId: 'task-type.ugv-point-navigation',
          capabilityRequirements: [UGV_AGENT_PROFILE_CAPABILITY_ID],
          requiredDimensions: ['side_effect_authorization'],
        }),
        expect.objectContaining({
          taskTypeId: 'task-type.vehicle.read-state',
          capabilityRequirements: ['vehicle.ugv.read-state'],
          requiredDimensions: [],
        }),
        expect.objectContaining({
          taskTypeId: 'task-type.vehicle.emergency-stop',
          capabilityRequirements: ['vehicle.ugv.emergency-stop'],
        }),
        expect.objectContaining({
          taskTypeId: 'task-type.vehicle.fire-weapon',
          capabilityRequirements: ['vehicle.ugv.fire-weapon'],
          requiredDimensions: ['target', 'side_effect_authorization', 'human_confirmation_policy'],
        }),
      ]),
    );
    expect(UGV_AGENT_PROFILE_OPERATION_POLICY).toEqual(
      expect.objectContaining({
        publicSkillAllowlist: expect.arrayContaining([
          UGV_AGENT_PROFILE_SKILL_ID,
          'ugv.get-state',
          'ugv.navigate-route',
          'ugv.emergency-stop',
          'ugv.fire-weapon',
        ]),
        emergencyStopAuthority: 'explicit_human_instruction_or_physical_confirmation',
        weaponAuthority: 'plan_then_exact_weapon_confirmation',
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

    const development = projectUgvAgentProfileEnabledSkills(
      [legacy, otherVersion, unrelated, exact],
      'all_enabled',
    );
    expect(development).toHaveLength(4);
    expect(development).toEqual(expect.arrayContaining([legacy, otherVersion, unrelated, exact]));
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

    const developmentView = new UgvAgentProfileSkillRepositoryView(source, 'all_enabled');
    await expect(developmentView.listEnabledVersions()).resolves.toEqual(
      expect.arrayContaining([legacy, exact]),
    );
    await expect(developmentView.findVersion('ugv.navigate', 1)).resolves.toEqual(legacy);
  });

  it('fails startup closed unless the canonical profile and existing governance authorities are composed', () => {
    const valid = validRuntimeConfiguration();
    expect(() => {
      assertUgvAgentProfileRuntimeConfiguration(valid);
    }).not.toThrow();
    expect(() => {
      assertUgvAgentProfileRuntimeConfiguration({
        ...valid,
        evidenceEnvironment: 'development',
      });
    }).not.toThrow();
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
    expect(useManagedAgentCardForProfile(environment.SDAR_TASK_UNDERSTANDING_PROFILE)).toBe(true);
    expect(useManagedAgentCardForProfile('managed_capability')).toBe(true);

    expect(
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
        SDAR_TASK_UNDERSTANDING_PROFILE: UGV_AGENT_PROFILE_ID,
        SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:9997',
        SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN: 'n'.repeat(32),
        SDAR_GOVERNED_CONTROL_AUTHENTICATION_MODE: 'trusted_intranet',
        SDAR_GOVERNED_CONTROL_ACTOR_ID: 'ugv-development-operator',
        SDAR_GOVERNED_CONTROL_PERMISSIONS: 'physical_control.confirm',
      }),
    ).toMatchObject({
      NODE_ENV: 'development',
      SDAR_CONTROL_ENVIRONMENT: 'development',
      SDAR_TASK_UNDERSTANDING_PROFILE: UGV_AGENT_PROFILE_ID,
    });
  });

  it('projects non-point outcome refs only after the exact Capability terminal proof', async () => {
    const point = await exactSkill();
    const read = {
      ...point,
      skillId: 'ugv.get-state',
      capabilities: ['vehicle.ugv.read-state'],
      usageSpecification: {
        ...point.usageSpecification,
        evidencePolicy: {
          requirements: [
            {
              requirementId: 'evidence-1',
              evidenceType: 'vehicle.state.observation',
              required: true,
              hardGate: true,
            },
          ],
          rejectSuccessWithoutRequiredEvidence: true,
        },
      },
      outcomeSpecification: {
        schemaVersion: '1.0',
        skillId: 'ugv.get-state',
        skillVersion: 1,
        effects: ['effect.vehicle.ugv.read-state.observed'],
        evidence: ['vehicle.state.observation'],
        artifacts: [],
        taskGoalPolicy: { requestedCapabilityId: 'vehicle.ugv.read-state' },
        confidencePolicy: {},
        sideEffectPolicy: { sideEffecting: false },
        specificationHash: `sha256:${'a'.repeat(64)}`,
      },
    } as SkillVersion;
    const proof = {
      taskId: 'task-read-state',
      bindingId: 'binding-read-state',
      bindingHash: 'b'.repeat(64),
      attemptId: 'attempt-read-state',
      requestedCapabilityId: 'vehicle.ugv.read-state',
      capabilityVersion: 1,
    } as const;

    const authority = {
      taskId: proof.taskId,
      selectedSkillId: read.skillId,
      selectedSkillVersion: read.version,
      workflowSkillVersions: [{ skillId: read.skillId, version: read.version }],
      skill: read,
      proof,
    } as const;

    expect(verifiedUgvAgentProfileOutcomeRefs(authority)).toEqual({
      effectRefs: ['effect.vehicle.ugv.read-state.observed'],
      evidenceRefs: ['vehicle.state.observation'],
      artifactRefs: [],
    });
    expect(() =>
      verifiedUgvAgentProfileOutcomeRefs({
        ...authority,
        proof: { ...proof, requestedCapabilityId: 'vehicle.ugv.read-targets' },
      }),
    ).toThrow('UGV_AGENT_PROFILE_OUTCOME_AUTHORITY_INVALID');
    expect(() =>
      verifiedUgvAgentProfileOutcomeRefs({
        ...authority,
        selectedSkillId: point.skillId,
        selectedSkillVersion: point.version,
        workflowSkillVersions: [{ skillId: point.skillId, version: point.version }],
        skill: point,
      }),
    ).toThrow('UGV_AGENT_PROFILE_OUTCOME_AUTHORITY_INVALID');
    expect(() =>
      verifiedUgvAgentProfileOutcomeRefs({ ...authority, taskId: 'task-other' }),
    ).toThrow('UGV_AGENT_PROFILE_OUTCOME_AUTHORITY_INVALID');
    expect(() =>
      verifiedUgvAgentProfileOutcomeRefs({
        ...authority,
        workflowSkillVersions: [
          ...authority.workflowSkillVersions,
          { skillId: 'ugv.get-targets', version: 1 },
        ],
      }),
    ).toThrow('UGV_AGENT_PROFILE_OUTCOME_AUTHORITY_INVALID');
  });

  it('preserves the exact Provider result for a governed read-only Skill', () => {
    const result = Object.freeze({
      resourceId: 'vehicle:ugv1',
      deviceReported: Object.freeze({ entity_id: 'ugv', additiveField: 'preserved' }),
      observedAt: '2026-09-05T05:00:00.000Z',
    });
    const skill = {
      skillId: 'ugv.get-capabilities',
      version: 1,
      status: 'enabled',
      outputSchema: { type: 'object' },
    } as SkillVersion;
    const processor = {
      process: (candidate: Readonly<{ text: string; structured: unknown }>) => ({
        text: candidate.text,
        structured: candidate.structured,
      }),
    };

    expect(
      prepareUgvAgentProfileReadOnlyResult({
        taskId: 'task-read-capabilities',
        selectedSkillId: skill.skillId,
        selectedSkillVersion: skill.version,
        skill,
        processor,
        instance: {
          instanceId: 'instance-read-capabilities',
          planId: 'plan-read-capabilities',
          workflowDefinitionId: 'workflow-read-capabilities',
          workflowVersion: 1,
          goalId: 'goal-read-capabilities',
          goalVersion: 1,
          skillVersions: [{ skillId: skill.skillId, version: skill.version }],
          budgetLimits: {
            maxReplans: 0,
            maxDurationSeconds: 60,
            maxLlmCalls: 0,
            maxMcpCalls: 1,
            maxCost: 0,
          },
          budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 1, cost: 0 },
          status: 'succeeded',
          input: { resourceId: 'vehicle:ugv1' },
          result,
          errors: {},
          startedAt: '2026-09-05T04:59:59.000Z',
          completedAt: '2026-09-05T05:00:00.000Z',
        },
      }),
    ).toMatchObject({
      taskId: 'task-read-capabilities',
      output: { structured: result },
      normalized: { data: result, contextValue: result },
    });
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
