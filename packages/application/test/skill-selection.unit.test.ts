import { describe, expect, it } from 'vitest';

import type {
  GoalExecutionContract,
  McpTaskOperationCandidate,
  Skill,
  SkillPerformanceMetrics,
  SkillRelation,
  SkillReplacementPlan,
  SkillSelectionRecord,
  SkillUsageSelectionContext,
  SkillVersion,
} from '../../domain/src/index.js';
import {
  FrozenSkillTaskReadinessAdapter,
  SkillApplicabilityAssessor,
  SkillContextRequirementResolver,
  SkillModeSelector,
  SkillSelectionService,
  SkillUsageCandidateAssessor,
  type McpRegistryRepository,
  type SkillGraphRepository,
  type SkillRepository,
  type SkillSelectionRepository,
} from '../src/index.js';

describe('SkillSelectionService', () => {
  it('persists an LLM-decided selection with all required metric snapshots', async () => {
    const records = new MemorySelectionRepository();
    const service = createService(records, [], 'skill.a');
    const selection = await service.select(goalContract);

    expect(selection).toMatchObject({
      selectedSkillId: 'skill.a',
      selectedSkillVersion: 1,
      decisionSummary: 'Skill A balances semantic fit and operational history.',
    });
    expect(selection.candidates[0]).toMatchObject({
      skillId: 'skill.a',
      skillVersion: 1,
      name: 'skill.a',
      summary: 'Candidate.',
      capabilities: ['inspection'],
      inputSchemaSummary: { type: 'object' },
      outputSchemaSummary: { type: 'object' },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      workflowGuidanceSummary: 'Inspect.',
      runtimePolicy: { autoConfirmPlan: false },
      usageSummary: {
        source: 'native',
        supportedModes: ['guidance'],
        defaultMode: 'guidance',
      },
      activeMcpDependencyWarnings: [],
      autoConfirmPlan: false,
      createdAt: '2026-07-11T10:00:00.000Z',
      semanticScore: 0.9,
      metrics: expect.objectContaining({
        successRate: 0.8,
        averageDurationMs: 120,
        averageCost: 0.02,
        failureCount: 2,
        stabilityScore: 0.95,
      }),
    });
    expect(records.selection).toEqual(selection);
  });

  it('uses only enabled alternative graph targets and creates a confirmation-bound replacement plan', async () => {
    const records = new MemorySelectionRepository();
    const relations: readonly SkillRelation[] = [
      {
        relationId: 'alternative-1',
        sourceSkillId: 'skill.a',
        targetSkillId: 'skill.b',
        relationType: 'alternative',
        metadata: {},
        createdAt: '2026-07-11T10:00:00.000Z',
      },
    ];
    const initial = createService(records, relations, 'skill.a');
    const selection = await initial.select(goalContract);
    const replacement = createService(records, relations, 'skill.b');
    const plan = await replacement.planReplacement(selection.selectionId, 'skill.a', goalContract);

    expect(plan).toMatchObject({
      failedSkillId: 'skill.a',
      replacementSkillId: 'skill.b',
      replacementSkillVersion: 1,
      status: 'awaiting_confirmation',
    });
    expect(records.replacement).toEqual(plan);
  });

  it('rejects a decider result that is not one of the enabled candidates', async () => {
    const service = createService(new MemorySelectionRepository(), [], 'skill.missing');
    await expect(service.select(goalContract)).rejects.toMatchObject({
      code: 'SKILL_SELECTION_INVALID_DECISION',
    });
  });

  it('does not expose candidates rejected by the owning scheduler policy to the decider', async () => {
    const records = new MemorySelectionRepository();
    const service = createService(records, [], 'skill.b');
    await expect(
      service.selectFromCandidates(goalContract, [skillVersion('skill.a')]),
    ).rejects.toMatchObject({ code: 'SKILL_SELECTION_INVALID_DECISION' });
    expect(records.selection).toBeUndefined();
  });

  it('rejects replacement after the Goal contract changes', async () => {
    const records = new MemorySelectionRepository();
    const relations: readonly SkillRelation[] = [
      {
        relationId: 'alternative-1',
        sourceSkillId: 'skill.a',
        targetSkillId: 'skill.b',
        relationType: 'alternative',
        metadata: {},
        createdAt: '2026-07-11T10:00:00.000Z',
      },
    ];
    const service = createService(records, relations, 'skill.a');
    const selection = await service.select(goalContract);
    await expect(
      service.planReplacement(selection.selectionId, 'skill.a', {
        ...goalContract,
        version: 2,
        constraints: ['read-only', 'no network'],
      }),
    ).rejects.toMatchObject({ code: 'SKILL_SELECTION_GOAL_CONTRACT_STALE' });
  });

  it('changes the selected Skill when the Goal safety constraint changes', async () => {
    const service = createService(new MemorySelectionRepository(), [], (contract) =>
      contract.constraints.includes('offline-only') ? 'skill.b' : 'skill.a',
    );
    await expect(service.select(goalContract)).resolves.toMatchObject({
      selectedSkillId: 'skill.a',
    });
    await expect(
      service.select({ ...goalContract, constraints: ['read-only', 'offline-only'] }),
    ).resolves.toMatchObject({ selectedSkillId: 'skill.b' });
  });

  it('retains an immutable snapshot when the caller mutates its contract during selection', async () => {
    const service = createService(new MemorySelectionRepository(), [], 'skill.a');
    const mutableContract = {
      ...goalContract,
      constraints: ['read-only'],
      successCriteria: ['status returned'],
    };

    const pending = service.select(mutableContract);
    mutableContract.constraints.push('caller mutation');
    mutableContract.successCriteria.push('caller mutation');

    await expect(pending).resolves.toMatchObject({
      goalContract: {
        constraints: ['read-only'],
        successCriteria: ['status returned'],
      },
    });
  });

  it('includes active matching MCP dependency warnings in candidate evidence', async () => {
    const service = createService(new MemorySelectionRepository(), [], 'skill.a', {
      toolPolicy: {
        required: [{ serverId: 'mcp.devices', toolName: 'read_status' }],
        optional: [],
        forbidden: [],
      },
      warnings: [
        {
          warningId: 'warning-active',
          serverId: 'mcp.devices',
          toolName: 'read_status',
          reason: 'schema_changed',
          skillId: 'skill.a',
          skillVersion: 1,
          toolRevision: 2,
          createdAt: '2026-07-11T10:00:00.000Z',
        },
        {
          warningId: 'warning-acknowledged',
          serverId: 'mcp.devices',
          toolName: 'read_status',
          reason: 'removed',
          skillId: 'skill.a',
          skillVersion: 1,
          toolRevision: 3,
          createdAt: '2026-07-11T10:00:00.000Z',
          acknowledgedAt: '2026-07-11T10:01:00.000Z',
        },
      ],
    });
    const selection = await service.select(goalContract);
    expect(selection.candidates.find((candidate) => candidate.skillId === 'skill.a')).toMatchObject(
      { activeMcpDependencyWarnings: [{ warningId: 'warning-active' }] },
    );
  });

  it('keeps unknown usage candidates out of the existing model decider', async () => {
    const usage = new SkillUsageCandidateAssessor({
      applicability: new SkillApplicabilityAssessor({
        contexts: new SkillContextRequirementResolver(),
        readiness: { inspect: () => Promise.resolve({ overall: 'ready', bindings: [] }) },
      }),
      modes: new SkillModeSelector(),
    });
    const service = createService(new MemorySelectionRepository(), [], 'skill.b', {
      usage,
    });
    await expect(service.select(goalContract)).rejects.toMatchObject({
      code: 'SKILL_SELECTION_USAGE_CONTEXT_REQUIRED',
    });
    const context: SkillUsageSelectionContext = {
      observations: [
        {
          requirementId: 'skill.b.context',
          source: 'authoritative_context',
          status: 'available',
          evidenceRef: 'context:skill-b',
        },
      ],
      risk: 'low',
      humanConfirmation: 'not_requested',
      systemPolicy: {
        allowedModes: ['guidance'],
        preferredMode: 'guidance',
        requireProcedureForHighRisk: false,
        allowGuidanceWithIncompleteContext: false,
      },
    };
    const selection = await service.select(goalContract, context);

    expect(selection.selectedSkillId).toBe('skill.b');
    expect(selection.candidates).toHaveLength(1);
    expect(selection.candidates[0]).toMatchObject({
      skillId: 'skill.b',
      usageCandidate: {
        applicability: { status: 'satisfied' },
        modeDecision: { decision: 'selected', mode: 'guidance' },
      },
    });
    await expect(
      service.select(goalContract, {
        ...context,
        systemPolicy: { ...context.systemPolicy, allowedModes: ['procedure'] },
      }),
    ).rejects.toMatchObject({ code: 'SKILL_SELECTION_NO_CANDIDATES' });
  });

  it('excludes non-user-selectable Skills from top-level selection', async () => {
    const service = createService(new MemorySelectionRepository(), [], 'skill.b', {
      visibilityBySkillId: {
        'skill.a': { userSelectable: false, composable: true, internalOnly: true },
      },
    });

    await expect(service.select(goalContract)).resolves.toMatchObject({
      selectedSkillId: 'skill.b',
      candidates: [{ skillId: 'skill.b' }],
    });
  });

  it('keeps the exact G07 procedure candidate when availability sees its public resource', async () => {
    const availabilityArguments: unknown[] = [];
    let availability: 'available' | 'disabled' = 'available';
    const readiness = new FrozenSkillTaskReadinessAdapter({
      operations: {
        listTaskOperationCandidates: () => Promise.resolve([g07OperationCandidate()]),
      },
      availability: {
        checkTaskAvailability: (input) => {
          availabilityArguments.push(input.requests[0]?.arguments);
          return Promise.resolve({
            kind: 'results' as const,
            protocolRevision: '2026-01-26',
            availabilitySchemaRevision: '1.0',
            results: [
              {
                nodeId: 'task-binding-home.light.get-state-v1',
                operationName: 'light_get_state',
                availability,
                riskLevel: 'low' as const,
                ...(availability === 'disabled' ? { reasonCode: 'UGV_CHASSIS_TRACK_BUSY' } : {}),
                validUntil: '2026-07-11T10:01:00.000Z',
                nextAvailableWindows: [],
                reservationMode: 'none' as const,
                possibleEffects: [],
              },
            ],
          });
        },
      },
      clock: { now: () => '2026-07-11T10:00:00.000Z' },
      providerBindings: {
        loadCurrentMcpProviderBinding: (input) =>
          Promise.resolve({
            observedAt: '2026-07-11T10:00:00.000Z',
            binding: {
              bindingId: 'mcp-binding-ha-light-lab',
              revision: 1,
              localServerId: input.localServerId,
              originType: 'direct' as const,
              providerId: 'ha-light-lab',
              endpointRef: 'https://provider.test/mcp',
              catalogRevision: '1.0.0:1',
              catalogChecksum: 'a'.repeat(64),
              operationCount: 1,
              availabilityStatus: 'available' as const,
              availabilityValidUntil: '2026-07-11T11:00:00.000Z',
            },
          }),
      },
      resolveArguments: (binding) => {
        expect(binding.taskType).toBe('light_get_state');
        return {
          unresolved: false,
          value: { resourceId: 'living-room-main-light' },
        };
      },
    });
    const usage = new SkillUsageCandidateAssessor({
      applicability: new SkillApplicabilityAssessor({
        contexts: new SkillContextRequirementResolver(),
        readiness,
      }),
      modes: new SkillModeSelector(),
    });
    const service = createService(new MemorySelectionRepository(), [], 'home.light.get-state', {
      usage,
    });

    const selection = await service.selectFromCandidates(goalContract, [g07Skill()], {
      observations: [
        {
          requirementId: 'public-resource-id',
          source: 'authoritative_context',
          status: 'available',
          evidenceRef: 'public-resource:living-room-main-light',
        },
        {
          requirementId: 'provider-binding-freshness',
          source: 'authoritative_context',
          status: 'available',
          evidenceRef: 'node-control-provider-binding:mcp-binding-ha-light-lab',
        },
      ],
      risk: 'low',
      humanConfirmation: 'confirmed',
      systemPolicy: {
        allowedModes: ['procedure'],
        preferredMode: 'procedure',
        requireProcedureForHighRisk: true,
        allowGuidanceWithIncompleteContext: false,
      },
    });

    expect(selection).toMatchObject({
      selectedSkillId: 'home.light.get-state',
      candidates: [
        {
          usageCandidate: {
            applicability: { status: 'satisfied', readiness: { overall: 'ready' } },
            modeDecision: { decision: 'selected', mode: 'procedure' },
          },
        },
      ],
    });
    expect(availabilityArguments).toEqual([
      { unresolved: false, value: { resourceId: 'living-room-main-light' } },
    ]);

    availability = 'disabled';
    await expect(
      service.selectFromCandidates(goalContract, [g07Skill()], {
        observations: [
          {
            requirementId: 'public-resource-id',
            source: 'authoritative_context',
            status: 'available',
            evidenceRef: 'public-resource:living-room-main-light',
          },
          {
            requirementId: 'provider-binding-freshness',
            source: 'authoritative_context',
            status: 'available',
            evidenceRef: 'node-control-provider-binding:mcp-binding-ha-light-lab',
          },
        ],
        risk: 'low',
        humanConfirmation: 'confirmed',
        systemPolicy: {
          allowedModes: ['procedure'],
          preferredMode: 'procedure',
          requireProcedureForHighRisk: true,
          allowGuidanceWithIncompleteContext: false,
        },
      }),
    ).rejects.toMatchObject({
      code: 'SKILL_SELECTION_NO_CANDIDATES',
      message: expect.stringContaining('UGV_CHASSIS_TRACK_BUSY'),
    });
  });
});

const goalContract = {
  goalId: 'goal-1',
  version: 1,
  title: 'Inspect device',
  description: 'Inspect the device safely.',
  constraints: ['read-only'],
  successCriteria: ['status returned'],
} as const;

function g07OperationCandidate(): McpTaskOperationCandidate {
  return {
    providerId: 'home-lab-light-mcp',
    operationName: 'light_get_state',
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
  };
}

function g07Skill(): SkillVersion {
  return {
    ...skillVersion('home.light.get-state'),
    capabilities: ['home.light.read-state'],
    toolPolicy: {
      required: [{ serverId: 'home-lab-light-mcp', toolName: 'light_get_state' }],
      optional: [],
      forbidden: [],
    },
    runtimePolicy: { autoConfirmPlan: false, maxLlmCalls: 0, maxMcpCalls: 1 },
    usageSpecification: {
      apiVersion: 'sdar.io/v1alpha1',
      visibility: { userSelectable: true, composable: true, internalOnly: false },
      normative: {
        constraints: ['Use the exact public resource.'],
        forbiddenActions: ['Do not resolve an HA entity ID.'],
        requiredConfirmations: [],
        noApplicableSkill: 'reject',
      },
      contextRequirements: [
        {
          requirementId: 'public-resource-id',
          description: 'Exact public resource.',
          required: true,
          sourceOrder: ['authoritative_context'],
        },
        {
          requirementId: 'provider-binding-freshness',
          description: 'Fresh exact Provider Binding.',
          required: true,
          sourceOrder: ['authoritative_context'],
        },
      ],
      taskBindings: [
        {
          bindingId: 'task-binding-home.light.get-state-v1',
          taskType: 'light_get_state',
          providerPolicy: {
            selection: 'required',
            preferredProviderIds: [],
            requiredProviderId: 'home-lab-light-mcp',
            forbiddenProviderIds: [],
            requiredAttributes: ['task_behavior:synchronous_only'],
          },
        },
      ],
      adaptive: {
        instructions: ['Preserve exact Provider authority.'],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      modes: {
        supported: ['procedure'],
        defaultMode: 'procedure',
        procedure: { summary: 'Exact read.', instructions: ['Read once.'] },
      },
      evidencePolicy: {
        requirements: [
          {
            requirementId: 'evidence-1',
            evidenceType: 'light.state.observation',
            required: true,
            hardGate: true,
          },
        ],
        rejectSuccessWithoutRequiredEvidence: true,
      },
    },
  };
}

function createService(
  records: SkillSelectionRepository,
  relations: readonly SkillRelation[],
  selectedSkillId: string | ((contract: GoalExecutionContract) => string),
  options: Readonly<{
    toolPolicy?: SkillVersion['toolPolicy'];
    warnings?: Awaited<ReturnType<McpRegistryRepository['listDependencyWarnings']>>;
    usage?: SkillUsageCandidateAssessor;
    visibilityBySkillId?: Readonly<
      Record<string, NonNullable<SkillVersion['usageSpecification']>['visibility']>
    >;
  }> = {},
): SkillSelectionService {
  return new SkillSelectionService({
    skills: new SelectionSkillRepository(options.toolPolicy, options.visibilityBySkillId),
    graph: new SelectionGraphRepository(relations),
    records,
    retriever: { score: () => Promise.resolve({ 'skill.a': 0.9, 'skill.b': 0.7 }) },
    decider: {
      decide: ({ mode, goalContract: contract }) =>
        Promise.resolve({
          selectedSkillId:
            typeof selectedSkillId === 'string' ? selectedSkillId : selectedSkillId(contract),
          decisionSummary:
            mode === 'initial'
              ? 'Skill A balances semantic fit and operational history.'
              : 'Skill B is the enabled declared alternative.',
        }),
    },
    ...(options.warnings === undefined
      ? {}
      : { mcpWarnings: { listDependencyWarnings: () => Promise.resolve(options.warnings ?? []) } }),
    ...(options.usage === undefined ? {} : { usage: options.usage }),
    clock: { now: () => '2026-07-11T10:00:00.000Z' },
    ids: {
      nextSelectionId: () => 'selection-1',
      nextReplacementPlanId: () => 'replacement-1',
    },
  });
}

class MemorySelectionRepository implements SkillSelectionRepository {
  selection: SkillSelectionRecord | undefined;
  replacement: SkillReplacementPlan | undefined;
  findMetrics(skillId: string): Promise<SkillPerformanceMetrics | undefined> {
    return Promise.resolve(
      skillId === 'skill.a'
        ? {
            sampleCount: 10,
            successRate: 0.8,
            averageDurationMs: 120,
            averageCost: 0.02,
            failureCount: 2,
            stabilityScore: 0.95,
          }
        : undefined,
    );
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
    this.replacement = plan;
    return Promise.resolve();
  }
}

class SelectionGraphRepository implements SkillGraphRepository {
  constructor(readonly relations: readonly SkillRelation[]) {}
  listRelations(): Promise<readonly SkillRelation[]> {
    return Promise.resolve(this.relations);
  }
  listRelationsFrom(
    sourceSkillId: string,
    relationTypes: readonly SkillRelation['relationType'][],
    limit: number,
  ): Promise<readonly SkillRelation[]> {
    return Promise.resolve(
      this.relations
        .filter(
          (relation) =>
            relation.sourceSkillId === sourceSkillId &&
            relationTypes.includes(relation.relationType),
        )
        .slice(0, limit),
    );
  }
  saveRelation(): Promise<void> {
    return Promise.resolve();
  }
  deleteRelation(): Promise<void> {
    return Promise.resolve();
  }
}

class SelectionSkillRepository implements SkillRepository {
  readonly versions: readonly SkillVersion[];
  constructor(
    toolPolicy?: SkillVersion['toolPolicy'],
    visibilityBySkillId: Readonly<
      Record<string, NonNullable<SkillVersion['usageSpecification']>['visibility']>
    > = {},
  ) {
    this.versions = [
      skillVersion('skill.a', toolPolicy, visibilityBySkillId['skill.a']),
      skillVersion('skill.b', toolPolicy, visibilityBySkillId['skill.b']),
    ];
  }
  find(skillId: string): Promise<Skill | undefined> {
    return Promise.resolve(
      this.versions.some((item) => item.skillId === skillId)
        ? {
            skillId,
            currentVersion: 1,
            createdAt: '2026-07-11T10:00:00.000Z',
            updatedAt: '2026-07-11T10:00:00.000Z',
          }
        : undefined,
    );
  }
  findCurrentVersion(skillId: string) {
    return Promise.resolve(this.versions.find((item) => item.skillId === skillId));
  }
  findVersion(skillId: string, version: number) {
    return Promise.resolve(
      this.versions.find((item) => item.skillId === skillId && item.version === version),
    );
  }
  listVersions(skillId: string) {
    return Promise.resolve(this.versions.filter((item) => item.skillId === skillId));
  }
  listEnabledVersions() {
    return Promise.resolve(this.versions);
  }
  listCurrentVersions() {
    return Promise.resolve(this.versions);
  }
  saveVersionAndSetCurrent(): Promise<void> {
    return Promise.resolve();
  }
}

function skillVersion(
  skillId: string,
  toolPolicy?: SkillVersion['toolPolicy'],
  visibility: NonNullable<SkillVersion['usageSpecification']>['visibility'] = {
    userSelectable: true,
    composable: false,
    internalOnly: false,
  },
): SkillVersion {
  return {
    skillId,
    version: 1,
    name: skillId,
    summary: 'Candidate.',
    description: 'Selection candidate.',
    capabilities: ['inspection'],
    workflowGuidance: 'Inspect.',
    outputInstruction: 'Return result.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: toolPolicy ?? { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-11T10:00:00.000Z',
    usageSpecification: {
      apiVersion: 'sdar.io/v1alpha1' as const,
      visibility,
      normative: {
        constraints: [],
        forbiddenActions: [],
        requiredConfirmations: [],
        noApplicableSkill: 'reject' as const,
      },
      adaptive: {
        instructions: ['Inspect safely.'],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [
        {
          requirementId: `${skillId}.context`,
          description: 'Authoritative candidate context.',
          required: true,
          sourceOrder: ['authoritative_context' as const],
        },
      ],
      modes: {
        supported: ['guidance' as const],
        defaultMode: 'guidance' as const,
        guidance: { summary: 'Guidance.', instructions: ['Inspect safely.'] },
      },
      taskBindings: [],
      evidencePolicy: {
        requirements: [],
        rejectSuccessWithoutRequiredEvidence: false,
      },
    },
  };
}
