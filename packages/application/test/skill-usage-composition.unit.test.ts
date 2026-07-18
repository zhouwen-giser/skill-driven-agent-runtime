import { describe, expect, it } from 'vitest';

import {
  createSkillVersion,
  projectSkillUsageFailure,
  snapshotSkillUsageCompositionPlan,
  type Skill,
  type SkillCompositionSpecification,
  type SkillModeDecision,
  type SkillRelation,
  type SkillVersion,
} from '../../domain/src/index.js';
import {
  SkillCompositionPlanner,
  type SkillGraphRepository,
  type SkillRepository,
} from '../src/index.js';

describe('Skill usage recursive composition and three-mode IR', () => {
  it('resolves fixed and dynamic edges into one immutable exact-version plan', async () => {
    const root = usageSkill('patrol', rootComposition());
    const move = usageSkill('move', undefined, {
      capabilities: ['embodied.move'],
      inputFields: ['resourceId', 'target'],
      outputFields: ['finalPosition'],
    });
    const inspect = usageSkill('inspect', undefined, {
      capabilities: ['embodied.inspect_area'],
      inputFields: ['area'],
      outputFields: ['anomalies'],
    });
    const planner = usagePlanner(
      [root, move, inspect],
      [
        relation('patrol-move', 'patrol', 'move', 'depends_on'),
        relation('patrol-inspect', 'patrol', 'inspect', 'capability_coverage'),
      ],
    );

    const plan = await planner.composeUsage({ skillId: 'patrol', skillVersion: 1 }, [
      slotChoice('patrol', 'inspection', 'inspect'),
    ]);

    expect(plan).toMatchObject({
      root: { skillId: 'patrol', skillVersion: 1 },
      maxDepth: 3,
      consumedDepth: 1,
      consumedSkills: 3,
      consumedNodes: 2,
      edges: [
        {
          kind: 'fixed_dependency',
          child: { skillId: 'move', skillVersion: 1 },
          failurePolicy: 'recoverable',
        },
        {
          kind: 'capability_slot',
          child: { skillId: 'inspect', skillVersion: 1 },
          candidateSet: [{ skillId: 'inspect', skillVersion: 1 }],
          failurePolicy: 'degraded',
        },
      ],
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.edges[0]?.inputMappings)).toBe(true);
    expect(Object.isFrozen(plan.edges[1]?.candidateSet)).toBe(true);
  });

  it('requires an exact compatible slot choice and filters incompatible candidates', async () => {
    const root = usageSkill('patrol', rootComposition({ fixedDependencies: [] }));
    const compatible = usageSkill('inspect.good', undefined, {
      capabilities: ['embodied.inspect_area'],
      inputFields: ['area'],
      outputFields: ['anomalies'],
    });
    const incompatible = usageSkill('inspect.bad', undefined, {
      capabilities: ['embodied.inspect_area'],
      inputFields: ['sensor'],
      outputFields: ['anomalies'],
    });
    const planner = usagePlanner(
      [root, compatible, incompatible],
      [
        relation('good', 'patrol', 'inspect.good', 'capability_coverage'),
        relation('bad', 'patrol', 'inspect.bad', 'capability_coverage'),
      ],
    );

    await expect(
      planner.composeUsage({ skillId: 'patrol', skillVersion: 1 }),
    ).rejects.toMatchObject({ code: 'SKILL_USAGE_COMPOSITION_SLOT_CHOICE_REQUIRED' });
    await expect(
      planner.composeUsage({ skillId: 'patrol', skillVersion: 1 }, [
        slotChoice('patrol', 'inspection', 'inspect.bad'),
      ]),
    ).rejects.toMatchObject({ code: 'SKILL_USAGE_COMPOSITION_SLOT_CHOICE_INVALID' });
    await expect(
      planner.composeUsage({ skillId: 'patrol', skillVersion: 1 }, [
        slotChoice('patrol', 'inspection', 'inspect.good'),
      ]),
    ).resolves.toMatchObject({
      edges: [
        {
          candidateSet: [{ skillId: 'inspect.good', skillVersion: 1 }],
        },
      ],
    });
    await expect(
      planner.composeUsage({ skillId: 'patrol', skillVersion: 1 }, [
        slotChoice('patrol', 'inspection', 'inspect.good'),
        slotChoice('patrol', 'inspection', 'inspect.good'),
      ]),
    ).rejects.toMatchObject({ code: 'SKILL_USAGE_COMPOSITION_SLOT_CHOICE_INVALID' });
  });

  it('freezes two different legal plans when context selects different compatible slot Skills', async () => {
    const root = usageSkill('patrol.contextual', rootComposition({ fixedDependencies: [] }));
    const visual = usageSkill('inspect.visual', undefined, {
      capabilities: ['embodied.inspect_area'],
      inputFields: ['area'],
      outputFields: ['anomalies'],
    });
    const thermal = usageSkill('inspect.thermal', undefined, {
      capabilities: ['embodied.inspect_area'],
      inputFields: ['area'],
      outputFields: ['anomalies'],
    });
    const planner = usagePlanner(
      [root, visual, thermal],
      [
        relation('visual', root.skillId, visual.skillId, 'capability_coverage'),
        relation('thermal', root.skillId, thermal.skillId, 'capability_coverage'),
      ],
    );

    const visualPlan = await planner.composeUsage({ skillId: root.skillId, skillVersion: 1 }, [
      slotChoice(root.skillId, 'inspection', visual.skillId),
    ]);
    const thermalPlan = await planner.composeUsage({ skillId: root.skillId, skillVersion: 1 }, [
      slotChoice(root.skillId, 'inspection', thermal.skillId),
    ]);

    expect(visualPlan.edges[0]?.child).toEqual({ skillId: visual.skillId, skillVersion: 1 });
    expect(thermalPlan.edges[0]?.child).toEqual({ skillId: thermal.skillId, skillVersion: 1 });
    expect(visualPlan).not.toEqual(thermalPlan);
    expect(Object.isFrozen(visualPlan)).toBe(true);
    expect(Object.isFrozen(thermalPlan)).toBe(true);
  });

  it('rejects missing graph authority and incompatible parent-child mappings', async () => {
    const composition = rootComposition({ capabilitySlots: [] });
    const root = usageSkill('patrol', composition);
    const move = usageSkill('move', undefined, {
      inputFields: ['resourceId', 'target'],
      outputFields: ['finalPosition'],
    });
    await expect(
      usagePlanner([root, move], []).composeUsage({ skillId: 'patrol', skillVersion: 1 }),
    ).rejects.toMatchObject({ code: 'SKILL_USAGE_COMPOSITION_RELATION_REQUIRED' });

    const broken = usageSkill('broken', {
      ...composition,
      fixedDependencies: [
        {
          ...requiredItem(composition.fixedDependencies, 0, 'fixed dependency'),
          inputMappings: [{ sourcePath: 'resourceId', targetPath: 'resourceId' }],
        },
      ],
    });
    await expect(
      usagePlanner(
        [broken, move],
        [relation('broken-move', 'broken', 'move', 'depends_on')],
      ).composeUsage({ skillId: 'broken', skillVersion: 1 }),
    ).rejects.toMatchObject({ code: 'SKILL_COMPOSITION_SCHEMA_INCOMPATIBLE' });

    const typedMove = usageSkill('typed.move', undefined, {
      inputFields: ['resourceId'],
      inputFieldType: 'number',
    });
    const typedRoot = usageSkill('typed.root', oneDependency('typed.move'));
    await expect(
      usagePlanner(
        [typedRoot, typedMove],
        [relation('typed-edge', 'typed.root', 'typed.move', 'depends_on')],
      ).composeUsage({ skillId: 'typed.root', skillVersion: 1 }),
    ).rejects.toMatchObject({ code: 'SKILL_COMPOSITION_SCHEMA_INCOMPATIBLE' });
  });

  it('rejects cycles and duplicate expansion across the shared recursion budget', async () => {
    const root = usageSkill('root', oneDependency('child'));
    const child = usageSkill('child', oneDependency('root'));
    await expect(
      usagePlanner(
        [root, child],
        [
          relation('root-child', 'root', 'child', 'depends_on'),
          relation('child-root', 'child', 'root', 'depends_on'),
        ],
      ).composeUsage({ skillId: 'root', skillVersion: 1 }),
    ).rejects.toMatchObject({ code: 'SKILL_USAGE_COMPOSITION_CYCLE_DETECTED' });

    const duplicateRoot = usageSkill('duplicate.root', {
      maxDepth: 3,
      fixedDependencies: [dependency('shared')],
      capabilitySlots: [
        {
          slotId: 'shared-slot',
          capability: 'shared.capability',
          required: true,
          candidateSkillIds: ['shared'],
          failurePolicy: 'optional',
          inputMappings: [{ sourcePath: 'resourceId', targetPath: 'resourceId' }],
          outputMappings: [{ sourcePath: 'status', targetPath: 'status' }],
        },
      ],
    });
    const shared = usageSkill('shared', undefined, { capabilities: ['shared.capability'] });
    await expect(
      usagePlanner(
        [duplicateRoot, shared],
        [
          relation('fixed', 'duplicate.root', 'shared', 'depends_on'),
          relation('slot', 'duplicate.root', 'shared', 'capability_coverage'),
        ],
      ).composeUsage({ skillId: 'duplicate.root', skillVersion: 1 }, [
        slotChoice('duplicate.root', 'shared-slot', 'shared'),
      ]),
    ).rejects.toMatchObject({ code: 'SKILL_USAGE_COMPOSITION_DUPLICATE_EXPANSION' });
  });

  it('enforces default-three depth and expanded-Skill size limits', async () => {
    expect(() =>
      usageSkill('depth.hard-limit', {
        maxDepth: 6,
        fixedDependencies: [],
        capabilitySlots: [],
      }),
    ).toThrow(expect.objectContaining({ code: 'SKILL_USAGE_SPEC_INVALID' }));

    const chain = ['depth.0', 'depth.1', 'depth.2', 'depth.3', 'depth.4'];
    const versions = chain.map((skillId, index) =>
      usageSkill(
        skillId,
        index === chain.length - 1
          ? undefined
          : oneDependency(requiredItem(chain, index + 1, 'next chain Skill')),
      ),
    );
    const relations = chain
      .slice(0, -1)
      .map((skillId, index) =>
        relation(
          `edge-${String(index)}`,
          skillId,
          requiredItem(chain, index + 1, 'next relation Skill'),
          'depends_on',
        ),
      );
    await expect(
      usagePlanner(versions, relations).composeUsage({
        skillId: requiredItem(chain, 0, 'root chain Skill'),
        skillVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'SKILL_USAGE_COMPOSITION_DEPTH_EXCEEDED' });

    const children = Array.from({ length: 32 }, (_, index) => `fanout.${String(index)}`);
    const fanout = usageSkill('fanout.root', {
      maxDepth: 3,
      fixedDependencies: children.map(dependency),
      capabilitySlots: [],
    });
    await expect(
      usagePlanner(
        [fanout, ...children.map((skillId) => usageSkill(skillId))],
        children.map((skillId) =>
          relation(`edge-${skillId}`, 'fanout.root', skillId, 'depends_on'),
        ),
      ).composeUsage({ skillId: 'fanout.root', skillVersion: 1 }),
    ).rejects.toMatchObject({ code: 'SKILL_USAGE_COMPOSITION_SIZE_EXCEEDED' });
  });

  it('generates immutable guidance, template and safe procedure IR without Workflow DSL', async () => {
    const root = usageSkill('patrol', rootComposition({ capabilitySlots: [] }));
    const move = usageSkill('move', undefined, {
      inputFields: ['resourceId', 'target'],
      outputFields: ['finalPosition'],
    });
    const planner = usagePlanner(
      [root, move],
      [relation('patrol-move', 'patrol', 'move', 'depends_on')],
    );
    const plan = await planner.composeUsage({ skillId: 'patrol', skillVersion: 1 });
    const guidance = planner.interpretUsage(root, selectedMode('guidance'), plan);
    const template = planner.interpretUsage(root, selectedMode('template'), plan);
    const procedure = planner.interpretUsage(root, selectedMode('procedure'), plan);

    expect(guidance).toMatchObject({ kind: 'guidance', constraints: ['Stay safe.'] });
    expect(template).toMatchObject({
      kind: 'template',
      templateId: 'patrol@1:template',
      parameterMappings: expect.arrayContaining([
        { sourcePath: 'resourceId', targetPath: 'resourceId' },
      ]),
    });
    expect(procedure).toMatchObject({
      kind: 'procedure',
      apiVersion: 'sdar.io/v1alpha1',
      steps: expect.arrayContaining([
        expect.objectContaining({ kind: 'context_gate' }),
        expect.objectContaining({ kind: 'confirmation_gate' }),
        expect.objectContaining({ kind: 'skill_call', failurePolicy: 'recoverable' }),
        expect.objectContaining({ kind: 'task_binding' }),
        expect.objectContaining({ kind: 'evidence_gate' }),
      ]),
    });
    expect(JSON.stringify(procedure)).not.toContain('workflowVersion');
    expect(JSON.stringify(procedure)).not.toContain('javascript');
    expect(Object.isFrozen(procedure)).toBe(true);
    if (procedure.kind !== 'procedure') throw new Error('procedure interpretation expected');
    expect(Object.isFrozen(procedure.steps)).toBe(true);
    expect(() =>
      planner.interpretUsage(root, { decision: 'blocked', reasonCodes: ['policy'] }, plan),
    ).toThrow(expect.objectContaining({ code: 'SKILL_USAGE_MODE_BLOCKED' }));
    expect(() =>
      planner.interpretUsage(usageSkill('different'), selectedMode('procedure'), plan),
    ).toThrow(expect.objectContaining({ code: 'SKILL_USAGE_MODE_INVALID' }));
  });

  it('rejects forged disconnected or candidate-inconsistent immutable plans', () => {
    expect(() =>
      snapshotSkillUsageCompositionPlan({
        root: { skillId: 'root', skillVersion: 1 },
        expandedSkills: [
          { skillId: 'root', skillVersion: 1 },
          { skillId: 'orphan', skillVersion: 1 },
        ],
        edges: [],
        maxDepth: 3,
        consumedDepth: 0,
        consumedSkills: 2,
        consumedNodes: 0,
      }),
    ).toThrow(expect.objectContaining({ code: 'SKILL_USAGE_COMPOSITION_PLAN_INVALID' }));

    expect(() =>
      snapshotSkillUsageCompositionPlan({
        root: { skillId: 'root', skillVersion: 1 },
        expandedSkills: [
          { skillId: 'root', skillVersion: 1 },
          { skillId: 'child', skillVersion: 1 },
        ],
        edges: [
          {
            edgeId: 'edge',
            kind: 'fixed_dependency',
            declarationId: 'dependency',
            parent: { skillId: 'root', skillVersion: 1 },
            child: { skillId: 'child', skillVersion: 1 },
            candidateSet: [{ skillId: 'different', skillVersion: 1 }],
            failurePolicy: 'fail_fast',
            inputMappings: [],
            outputMappings: [],
            depth: 1,
          },
        ],
        maxDepth: 3,
        consumedDepth: 1,
        consumedSkills: 2,
        consumedNodes: 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'SKILL_USAGE_COMPOSITION_PLAN_INVALID' }));
  });

  it('projects all four failure policies and hard-gates empty degraded evidence', () => {
    expect(projectSkillUsageFailure('fail_fast')).toMatchObject({
      parentStatus: 'failed',
      action: 'abort',
    });
    expect(projectSkillUsageFailure('recoverable')).toMatchObject({
      parentStatus: 'recovering',
      action: 'try_recovery',
    });
    expect(projectSkillUsageFailure('optional')).toMatchObject({
      parentStatus: 'continuing',
      action: 'record_optional_failure',
    });
    expect(
      projectSkillUsageFailure('degraded', {
        missingEffects: ['subregion.coverage'],
        missingEvidence: ['trajectory'],
      }),
    ).toMatchObject({ parentStatus: 'degraded', action: 'continue_degraded' });
    expect(() => projectSkillUsageFailure('degraded')).toThrow(
      expect.objectContaining({ code: 'SKILL_USAGE_DEGRADED_EVIDENCE_REQUIRED' }),
    );
    expect(() => projectSkillUsageFailure('degraded', { missingEvidence: ['   '] })).toThrow(
      expect.objectContaining({ code: 'SKILL_USAGE_DEGRADED_EVIDENCE_REQUIRED' }),
    );
  });
});

function usagePlanner(
  skills: readonly SkillVersion[],
  relations: readonly SkillRelation[],
): SkillCompositionPlanner {
  return new SkillCompositionPlanner({
    skills: new UsageSkills(skills),
    graph: new UsageGraph(relations),
  });
}

function usageSkill(
  skillId: string,
  composition?: SkillCompositionSpecification,
  options: Readonly<{
    capabilities?: readonly string[];
    inputFields?: readonly string[];
    inputFieldType?: 'string' | 'number';
    outputFields?: readonly string[];
  }> = {},
): SkillVersion {
  const inputFields = options.inputFields ?? ['resourceId'];
  const outputFields = options.outputFields ?? ['status'];
  return createSkillVersion({
    skillId,
    version: 1,
    name: skillId,
    summary: `${skillId} summary.`,
    description: `${skillId} description.`,
    capabilities: options.capabilities ?? [skillId],
    workflowGuidance: 'Use bounded composition.',
    outputInstruction: 'Return declared evidence.',
    inputSchema: objectSchema(inputFields, options.inputFieldType),
    outputSchema: objectSchema(outputFields),
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-17T00:00:00.000Z',
    usageSpecification: {
      apiVersion: 'sdar.io/v1alpha1',
      visibility: { userSelectable: true, composable: true, internalOnly: false },
      normative: {
        constraints: ['Stay safe.'],
        forbiddenActions: ['Bypass policy.'],
        requiredConfirmations: ['existing_plan_confirmation'],
        noApplicableSkill: 'reject',
      },
      adaptive: {
        instructions: ['Prefer bounded work.'],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [
        {
          requirementId: 'resource-state',
          description: 'Authoritative resource state.',
          required: true,
          sourceOrder: ['authoritative_context'],
        },
      ],
      modes: {
        supported: ['guidance', 'template', 'procedure'],
        defaultMode: 'procedure',
        guidance: { summary: 'Guidance.', instructions: ['Guide safely.'] },
        template: { summary: 'Template.', instructions: ['Bind declarative mappings.'] },
        procedure: { summary: 'Procedure.', instructions: ['Emit safe IR only.'] },
      },
      taskBindings: [
        {
          bindingId: `${skillId}.task`,
          taskType: `${skillId}.task`,
          providerPolicy: {
            selection: 'dynamic',
            preferredProviderIds: [],
            forbiddenProviderIds: [],
            requiredAttributes: [],
          },
        },
      ],
      ...(composition === undefined ? {} : { composition }),
      evidencePolicy: {
        requirements: [
          {
            requirementId: 'result',
            evidenceType: `${skillId}.result`,
            required: true,
            hardGate: true,
          },
        ],
        rejectSuccessWithoutRequiredEvidence: true,
      },
    },
  });
}

function rootComposition(
  overrides: Partial<SkillCompositionSpecification> = {},
): SkillCompositionSpecification {
  return {
    maxDepth: 3,
    fixedDependencies: [
      {
        dependencyId: 'move',
        skillId: 'move',
        skillVersion: 1,
        failurePolicy: 'recoverable',
        inputMappings: [
          { sourcePath: 'resourceId', targetPath: 'resourceId' },
          { sourcePath: 'context.target', targetPath: 'target' },
        ],
        outputMappings: [{ sourcePath: 'finalPosition', targetPath: 'evidence.trajectory' }],
      },
    ],
    capabilitySlots: [
      {
        slotId: 'inspection',
        capability: 'embodied.inspect_area',
        required: true,
        candidateSkillIds: [],
        failurePolicy: 'degraded',
        inputMappings: [{ sourcePath: 'context.subregion', targetPath: 'area' }],
        outputMappings: [{ sourcePath: 'anomalies', targetPath: 'evidence.anomalies' }],
      },
    ],
    ...overrides,
  };
}

function oneDependency(skillId: string): SkillCompositionSpecification {
  return { maxDepth: 3, fixedDependencies: [dependency(skillId)], capabilitySlots: [] };
}

function dependency(skillId: string) {
  return {
    dependencyId: `dependency-${skillId}`,
    skillId,
    skillVersion: 1,
    failurePolicy: 'fail_fast' as const,
    inputMappings: [{ sourcePath: 'resourceId', targetPath: 'resourceId' }],
    outputMappings: [{ sourcePath: 'status', targetPath: 'status' }],
  };
}

function slotChoice(parentSkillId: string, slotId: string, skillId: string) {
  return {
    parentSkillId,
    parentSkillVersion: 1,
    slotId,
    skillId,
    skillVersion: 1,
  };
}

function selectedMode(mode: 'guidance' | 'template' | 'procedure'): SkillModeDecision {
  return {
    decision: 'selected',
    mode,
    confirmationRequired: true,
    confirmationSatisfied: false,
    reasonCodes: ['test'],
  };
}

function objectSchema(fields: readonly string[], fieldType: 'string' | 'number' = 'string') {
  return {
    type: 'object',
    additionalProperties: false,
    required: fields,
    properties: Object.fromEntries(fields.map((field) => [field, { type: fieldType }])),
  };
}

function relation(
  relationId: string,
  sourceSkillId: string,
  targetSkillId: string,
  relationType: SkillRelation['relationType'],
): SkillRelation {
  return {
    relationId,
    sourceSkillId,
    targetSkillId,
    relationType,
    metadata: {},
    createdAt: '2026-07-17T00:00:00.000Z',
  };
}

class UsageGraph implements SkillGraphRepository {
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
          (item) =>
            item.sourceSkillId === sourceSkillId && relationTypes.includes(item.relationType),
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

class UsageSkills implements SkillRepository {
  readonly versions: ReadonlyMap<string, SkillVersion>;
  constructor(versions: readonly SkillVersion[]) {
    this.versions = new Map(versions.map((version) => [version.skillId, version]));
  }
  find(skillId: string): Promise<Skill | undefined> {
    const version = this.versions.get(skillId);
    return Promise.resolve(
      version === undefined
        ? undefined
        : {
            skillId,
            currentVersion: version.version,
            createdAt: version.createdAt,
            updatedAt: version.createdAt,
          },
    );
  }
  findCurrentVersion(skillId: string): Promise<SkillVersion | undefined> {
    return Promise.resolve(this.versions.get(skillId));
  }
  findVersion(skillId: string, version: number): Promise<SkillVersion | undefined> {
    const found = this.versions.get(skillId);
    return Promise.resolve(found?.version === version ? found : undefined);
  }
  listVersions(skillId: string): Promise<readonly SkillVersion[]> {
    const found = this.versions.get(skillId);
    return Promise.resolve(found === undefined ? [] : [found]);
  }
  listEnabledVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve(
      [...this.versions.values()].filter((version) => version.status === 'enabled'),
    );
  }
  listCurrentVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve([...this.versions.values()]);
  }
  saveVersionAndSetCurrent(): Promise<void> {
    return Promise.resolve();
  }
}

function requiredItem<T>(items: readonly T[], index: number, label: string): T {
  const item = items[index];
  if (item === undefined) throw new Error(`${label} fixture missing`);
  return item;
}
