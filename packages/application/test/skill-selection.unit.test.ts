import { describe, expect, it } from 'vitest';

import type {
  GoalExecutionContract,
  Skill,
  SkillPerformanceMetrics,
  SkillRelation,
  SkillReplacementPlan,
  SkillSelectionRecord,
  SkillUsageSelectionContext,
  SkillVersion,
} from '../../domain/src/index.js';
import {
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
        source: 'legacy_projection',
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
      usageAware: true,
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
      usageAware: true,
      visibilityBySkillId: {
        'skill.a': { userSelectable: false, composable: true, internalOnly: true },
      },
    });

    await expect(service.select(goalContract)).resolves.toMatchObject({
      selectedSkillId: 'skill.b',
      candidates: [{ skillId: 'skill.b' }],
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

function createService(
  records: SkillSelectionRepository,
  relations: readonly SkillRelation[],
  selectedSkillId: string | ((contract: GoalExecutionContract) => string),
  options: Readonly<{
    toolPolicy?: SkillVersion['toolPolicy'];
    warnings?: Awaited<ReturnType<McpRegistryRepository['listDependencyWarnings']>>;
    usage?: SkillUsageCandidateAssessor;
    usageAware?: boolean;
    visibilityBySkillId?: Readonly<
      Record<string, NonNullable<SkillVersion['usageSpecification']>['visibility']>
    >;
  }> = {},
): SkillSelectionService {
  return new SkillSelectionService({
    skills: new SelectionSkillRepository(
      options.toolPolicy,
      options.usageAware,
      options.visibilityBySkillId,
    ),
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
    usageAware = false,
    visibilityBySkillId: Readonly<
      Record<string, NonNullable<SkillVersion['usageSpecification']>['visibility']>
    > = {},
  ) {
    this.versions = [
      skillVersion('skill.a', toolPolicy, usageAware, visibilityBySkillId['skill.a']),
      skillVersion('skill.b', toolPolicy, usageAware, visibilityBySkillId['skill.b']),
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
  usageAware = false,
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
    ...(usageAware
      ? {
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
        }
      : {}),
  };
}
