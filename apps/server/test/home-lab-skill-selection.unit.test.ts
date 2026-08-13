import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type {
  GoalExecutionContract,
  McpTaskOperationCandidate,
  Skill,
  SkillPerformanceMetrics,
  SkillReplacementPlan,
  SkillSelectionRecord,
  SkillVersion,
} from '../../../packages/domain/src/index.js';
import type {
  SkillGraphRepository,
  SkillRepository,
  SkillSelectionRepository,
} from '../../../packages/application/src/index.js';
import { homeLabReadOnlyTaskUnderstandingConfiguration } from '../src/home-lab-task-understanding.js';
import { createHomeLabReadOnlySkillSelectionService } from '../src/home-lab-skill-selection.js';
import { resolveSkillUsageSelectionId, startServerRuntime } from '../src/runtime.js';

const now = '2026-08-10T12:00:00.000Z';
const validUntil = '2026-08-10T13:00:00.000Z';

describe('home-lab production Skill selection composition', () => {
  it('uses Usage evidence only for a real selection authority and keeps profile-off generic planning selectionless', () => {
    expect(
      resolveSkillUsageSelectionId({
        selectedSkill: true,
        skillSelectionConfigured: false,
      }),
    ).toBeUndefined();
    expect(
      resolveSkillUsageSelectionId({
        selectedSkill: true,
        skillSelectionConfigured: true,
        skillSelectionId: 'selection-authoritative',
      }),
    ).toBe('selection-authoritative');
    expect(() =>
      resolveSkillUsageSelectionId({
        selectedSkill: true,
        skillSelectionConfigured: true,
      }),
    ).toThrow('SKILL_USAGE_SELECTION_ID_REQUIRED');
  });

  it('persists the sole compatible composite candidate after both exact resource readiness checks', async () => {
    const records = new MemorySelectionRepository();
    const availabilityArguments: unknown[] = [];
    const providerBindingLoads: unknown[] = [];
    const service = createHomeLabReadOnlySkillSelectionService({
      skills: new SingleSkillRepository(compositeSkill()),
      graph: emptyGraph(),
      records,
      mcpWarnings: { listDependencyWarnings: () => Promise.resolve([]) },
      operations: { listTaskOperationCandidates: operationCandidates },
      availability: {
        checkTaskAvailability: (input) => {
          availabilityArguments.push(input.requests[0]?.arguments);
          const request = input.requests[0];
          if (request === undefined) throw new Error('AVAILABILITY_REQUEST_MISSING');
          return Promise.resolve({
            kind: 'results' as const,
            protocolRevision: '2026-01-26',
            availabilitySchemaRevision: '1.0',
            results: [
              {
                nodeId: request.nodeId,
                operationName: request.operationName,
                availability: 'available' as const,
                riskLevel: 'low' as const,
                validUntil,
                nextAvailableWindows: [],
                reservationMode: 'none' as const,
                possibleEffects: [],
              },
            ],
          });
        },
      },
      providerBindings: {
        loadCurrentMcpProviderBinding: (input) => {
          providerBindingLoads.push(input);
          return Promise.resolve(currentProviderBinding(input.bindingId, input.localServerId));
        },
      },
      clock: { now: () => now },
      ids: {
        nextSelectionId: () => 'selection-home-lab-1',
        nextReplacementPlanId: () => 'replacement-home-lab-1',
      },
    });

    const selection = await service.selectFromCandidates(
      goalContract,
      [compositeSkill()],
      usageContext,
    );

    expect(selection).toMatchObject({
      selectionId: 'selection-home-lab-1',
      selectedSkillId: 'home.living-room.get-state',
      candidates: [
        {
          usageCandidate: {
            applicability: { status: 'satisfied', readiness: { overall: 'ready' } },
            modeDecision: { decision: 'selected', mode: 'guidance' },
          },
        },
      ],
    });
    await expect(records.findSelection('selection-home-lab-1')).resolves.toEqual(selection);
    expect(availabilityArguments).toEqual([
      { unresolved: false, value: { resourceId: 'living-room-main-light' } },
      { unresolved: false, value: { resourceId: 'living-room-air-conditioner' } },
    ]);
    expect(providerBindingLoads).toEqual([
      { bindingId: 'mcp-binding-ha-light-lab', localServerId: 'home-lab-light-mcp' },
      { bindingId: 'mcp-binding-ha-climate-lab', localServerId: 'home-lab-climate-mcp' },
    ]);
  });

  it('records no selection and makes no availability call when current Binding authority fails', async () => {
    const records = new MemorySelectionRepository();
    const checkTaskAvailability = vi.fn();
    const service = createHomeLabReadOnlySkillSelectionService({
      skills: new SingleSkillRepository(compositeSkill()),
      graph: emptyGraph(),
      records,
      mcpWarnings: { listDependencyWarnings: () => Promise.resolve([]) },
      operations: { listTaskOperationCandidates: operationCandidates },
      availability: { checkTaskAvailability },
      providerBindings: {
        loadCurrentMcpProviderBinding: () => Promise.reject(new Error('BINDING_NOT_CURRENT')),
      },
      clock: { now: () => now },
      ids: {
        nextSelectionId: () => 'selection-must-not-exist',
        nextReplacementPlanId: () => 'replacement-must-not-exist',
      },
    });

    await expect(
      service.selectFromCandidates(goalContract, [compositeSkill()], usageContext),
    ).rejects.toMatchObject({ code: 'SKILL_SELECTION_NO_CANDIDATES' });
    expect(checkTaskAvailability).not.toHaveBeenCalled();
    expect(records.selection).toBeUndefined();
  });

  it('records no selection when a reader substitutes a different Binding ID', async () => {
    const records = new MemorySelectionRepository();
    const checkTaskAvailability = vi.fn();
    const service = createHomeLabReadOnlySkillSelectionService({
      skills: new SingleSkillRepository(compositeSkill()),
      graph: emptyGraph(),
      records,
      mcpWarnings: { listDependencyWarnings: () => Promise.resolve([]) },
      operations: { listTaskOperationCandidates: operationCandidates },
      availability: { checkTaskAvailability },
      providerBindings: {
        loadCurrentMcpProviderBinding: ({ localServerId }) =>
          Promise.resolve(currentProviderBinding('substituted-binding', localServerId)),
      },
      clock: { now: () => now },
      ids: {
        nextSelectionId: () => 'selection-must-not-exist',
        nextReplacementPlanId: () => 'replacement-must-not-exist',
      },
    });

    await expect(
      service.selectFromCandidates(goalContract, [compositeSkill()], usageContext),
    ).rejects.toMatchObject({ code: 'SKILL_SELECTION_NO_CANDIDATES' });
    expect(checkTaskAvailability).not.toHaveBeenCalled();
    expect(records.selection).toBeUndefined();
  });

  it('fails profile startup before infrastructure when Binding authority is absent or selection modes conflict', async () => {
    const base = {
      postgresUrl: 'postgresql://unused.invalid/sdar',
      redis: { host: '127.0.0.1', port: 1 },
      masterKeyBase64: randomBytes(32).toString('base64'),
      taskUnderstanding: homeLabReadOnlyTaskUnderstandingConfiguration(),
    };
    await expect(startServerRuntime(base)).rejects.toThrow(
      'HOME_LAB_READ_ONLY_PROVIDER_BINDING_AUTHORITY_REQUIRED',
    );
    await expect(
      startServerRuntime({
        ...base,
        currentMcpProviderBindingAuthorityReader: {
          loadCurrentMcpProviderBinding: ({ bindingId, localServerId }) =>
            Promise.resolve(currentProviderBinding(bindingId, localServerId)),
        },
        capabilityAuthorityReader: {
          load: () => Promise.reject(new Error('must not reach Capability authority')),
        },
        skillSelection: {
          embeddings: {
            embed: () => Promise.resolve({ providerId: 'unused', vector: [1] }),
          },
        },
      }),
    ).rejects.toThrow('HOME_LAB_READ_ONLY_SKILL_SELECTION_CONFIGURATION_CONFLICT');
  });
});

const goalContract: GoalExecutionContract = {
  goalId: 'goal-g08',
  version: 1,
  title: 'Read living room state',
  description: 'Read the current state of the living-room main light and climate device.',
  constraints: ['read-only'],
  successCriteria: ['Return both current public resource states.'],
};

const usageContext = {
  observations: [],
  risk: 'low' as const,
  humanConfirmation: 'pending' as const,
  systemPolicy: {
    allowedModes: ['guidance' as const],
    preferredMode: 'guidance' as const,
    requireProcedureForHighRisk: true,
    allowGuidanceWithIncompleteContext: false,
  },
};

function compositeSkill(): SkillVersion {
  return {
    skillId: 'home.living-room.get-state',
    version: 1,
    name: 'Read living-room state',
    summary: 'Read the main light and climate state.',
    description: 'Read two exact public resources with exact Providers.',
    capabilities: ['home.living-room.read-state'],
    workflowGuidance: 'Read both resources and preserve both Provider evidence records.',
    outputInstruction: 'Return mainLight and climate.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: {
      required: [
        { serverId: 'home-lab-light-mcp', toolName: 'light_get_state' },
        { serverId: 'home-lab-climate-mcp', toolName: 'climate_get_state' },
      ],
      optional: [],
      forbidden: [],
    },
    runtimePolicy: { autoConfirmPlan: false, maxLlmCalls: 0, maxMcpCalls: 2 },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: now,
    usageSpecification: {
      apiVersion: 'sdar.io/v1alpha1',
      visibility: { userSelectable: true, composable: true, internalOnly: false },
      normative: {
        constraints: ['Use both exact public resources.'],
        forbiddenActions: ['No device writes.'],
        requiredConfirmations: [],
        noApplicableSkill: 'reject',
      },
      adaptive: {
        instructions: ['Preserve both exact Provider authorities.'],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [],
      modes: {
        supported: ['guidance'],
        defaultMode: 'guidance',
        guidance: { summary: 'Exact reads.', instructions: ['Read each resource once.'] },
      },
      taskBindings: [
        taskBinding('light_get_state', 'home-lab-light-mcp'),
        taskBinding('climate_get_state', 'home-lab-climate-mcp'),
      ],
      evidencePolicy: {
        requirements: [
          {
            requirementId: 'evidence-light-state',
            evidenceType: 'light.state.observation',
            required: true,
            hardGate: true,
          },
          {
            requirementId: 'evidence-climate-state',
            evidenceType: 'climate.state.observation',
            required: true,
            hardGate: true,
          },
        ],
        rejectSuccessWithoutRequiredEvidence: true,
      },
    },
  };
}

function taskBinding(taskType: string, providerId: string) {
  return {
    bindingId: `task-binding-${taskType}`,
    taskType,
    providerPolicy: {
      selection: 'required' as const,
      preferredProviderIds: [],
      requiredProviderId: providerId,
      forbiddenProviderIds: [],
      requiredAttributes: ['task_behavior:synchronous_only'],
    },
  };
}

function operationCandidates(taskType: string): Promise<readonly McpTaskOperationCandidate[]> {
  const providerId =
    taskType === 'light_get_state'
      ? 'home-lab-light-mcp'
      : taskType === 'climate_get_state'
        ? 'home-lab-climate-mcp'
        : undefined;
  if (providerId === undefined) return Promise.resolve([]);
  return Promise.resolve([
    {
      providerId,
      operationName: taskType,
      protocolMode: 'frozen_v1',
      taskExecutionProfile: {
        profileVersion: '1.0',
        taskBehavior: 'synchronous_only',
        availability: 'dynamic',
        supportsScheduling: false,
        supportsMaxElapsed: false,
        supportsObservations: false,
        supportsInputRequired: false,
        idempotency: 'server_managed',
      },
      taskNotifications: false,
      attributes: ['task_behavior:synchronous_only', 'availability:dynamic'],
    },
  ]);
}

function currentProviderBinding(bindingId: string | undefined, localServerId: string) {
  return {
    observedAt: now,
    binding: {
      bindingId: bindingId ?? `binding-${localServerId}`,
      revision: 1,
      localServerId,
      originType: 'direct' as const,
      providerId: localServerId.includes('light') ? 'ha-light-lab' : 'ha-climate-lab',
      endpointRef: `https://${localServerId}.example.test/mcp`,
      catalogRevision: '1.0.0:1',
      catalogChecksum: 'a'.repeat(64),
      operationCount: 1,
      availabilityValidUntil: validUntil,
      catalogObservedAt: now,
    },
  };
}

class MemorySelectionRepository implements SkillSelectionRepository {
  selection: SkillSelectionRecord | undefined;
  findMetrics(): Promise<SkillPerformanceMetrics | undefined> {
    return Promise.resolve(undefined);
  }
  saveMetrics(): Promise<void> {
    return Promise.resolve();
  }
  saveSelection(record: SkillSelectionRecord): Promise<void> {
    this.selection = record;
    return Promise.resolve();
  }
  findSelection(selectionId: string): Promise<SkillSelectionRecord | undefined> {
    return Promise.resolve(
      this.selection?.selectionId === selectionId ? this.selection : undefined,
    );
  }
  saveReplacementPlan(plan: SkillReplacementPlan): Promise<void> {
    void plan;
    return Promise.resolve();
  }
}

class SingleSkillRepository implements SkillRepository {
  constructor(readonly version: SkillVersion) {}
  find(skillId: string): Promise<Skill | undefined> {
    return Promise.resolve(
      skillId === this.version.skillId
        ? { skillId, currentVersion: 1, createdAt: now, updatedAt: now }
        : undefined,
    );
  }
  findCurrentVersion(skillId: string): Promise<SkillVersion | undefined> {
    return this.findVersion(skillId, 1);
  }
  findVersion(skillId: string, version: number): Promise<SkillVersion | undefined> {
    return Promise.resolve(
      skillId === this.version.skillId && version === this.version.version
        ? this.version
        : undefined,
    );
  }
  listVersions(skillId: string): Promise<readonly SkillVersion[]> {
    return Promise.resolve(skillId === this.version.skillId ? [this.version] : []);
  }
  listEnabledVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve([this.version]);
  }
  listCurrentVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve([this.version]);
  }
  saveVersionAndSetCurrent(): Promise<void> {
    return Promise.resolve();
  }
}

function emptyGraph(): SkillGraphRepository {
  return {
    listRelations: () => Promise.resolve([]),
    listRelationsFrom: () => Promise.resolve([]),
    saveRelation: () => Promise.resolve(),
    deleteRelation: () => Promise.resolve(),
  };
}
