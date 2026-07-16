import { describe, expect, it } from 'vitest';

import type { Skill, SkillRelation, SkillVersion } from '../../domain/src/index.js';
import {
  SkillCompositionPlanner,
  type SkillGraphRepository,
  type SkillRepository,
} from '../src/index.js';

describe('SkillCompositionPlanner', () => {
  it('adds dependencies and composable Skills while excluding alternatives and unrelated Skills', async () => {
    const root = skill('skill.root', objectSchema(['dependency']), objectSchema(['payload']));
    const dependency = skill('skill.dependency', objectSchema([]), objectSchema(['dependency']));
    const composable = skill(
      'skill.composable',
      objectSchema(['payload']),
      objectSchema(['result']),
    );
    const alternative = skill('skill.alternative', objectSchema([]), objectSchema([]));
    const unrelated = skill('skill.unrelated', objectSchema([]), objectSchema([]));
    const planner = compositionPlanner(
      [root, dependency, composable, alternative, unrelated],
      [
        relation('depends', root.skillId, dependency.skillId, 'depends_on'),
        relation('compose', root.skillId, composable.skillId, 'composition'),
        relation('alternative', root.skillId, alternative.skillId, 'alternative'),
        relation('unrelated', unrelated.skillId, alternative.skillId, 'parent_child'),
      ],
    );

    const context = await planner.compose({ skillId: root.skillId, skillVersion: root.version });

    expect(context.allowedChildSkillIds).toEqual(['skill.composable', 'skill.dependency']);
    expect(context.relations.map(({ relationId }) => relationId).sort()).toEqual([
      'compose',
      'depends',
    ]);
    expect(context.decisionSummary).toContain('the model decides');
    expect(JSON.stringify(context)).not.toContain('skill.alternative');
    expect(JSON.stringify(context)).not.toContain('skill.unrelated');
  });

  it('rejects an input/output relation whose producer cannot satisfy child input', async () => {
    const root = skill('skill.root', objectSchema([]), objectSchema(['temperature']));
    const child = skill('skill.child', objectSchema(['pressure']), objectSchema([]));
    const planner = compositionPlanner(
      [root, child],
      [relation('mismatch', root.skillId, child.skillId, 'input_output_match')],
    );

    await expect(
      planner.compose({ skillId: root.skillId, skillVersion: root.version }),
    ).rejects.toMatchObject({ code: 'SKILL_COMPOSITION_SCHEMA_INCOMPATIBLE' });
  });

  it('captures a multi-level composition and rejects a cross-relation cycle', async () => {
    const versions = ['skill.root', 'skill.child', 'skill.grandchild'].map((skillId) =>
      skill(skillId, objectSchema(['value']), objectSchema(['value'])),
    );
    const acyclic = [
      relation('root-child', 'skill.root', 'skill.child', 'composition'),
      relation('child-grandchild', 'skill.child', 'skill.grandchild', 'input_output_match'),
    ];
    await expect(
      compositionPlanner(versions, acyclic).compose({ skillId: 'skill.root', skillVersion: 1 }),
    ).resolves.toMatchObject({
      allowedChildSkillIds: ['skill.child', 'skill.grandchild'],
    });

    await expect(
      compositionPlanner(versions, [
        ...acyclic,
        relation('grandchild-root', 'skill.grandchild', 'skill.root', 'capability_coverage'),
      ]).compose({ skillId: 'skill.root', skillVersion: 1 }),
    ).rejects.toMatchObject({ code: 'SKILL_COMPOSITION_CYCLE_DETECTED' });
  });

  it('rejects a stale or disabled exact composition root', async () => {
    const root = skill('skill.root', objectSchema([]), objectSchema([]));
    const repository = new MemorySkills([{ ...root, version: 2 }]);
    const planner = new SkillCompositionPlanner({
      skills: repository,
      graph: new MemoryGraph([]),
    });

    await expect(planner.compose({ skillId: root.skillId, skillVersion: 1 })).rejects.toMatchObject(
      { code: 'SKILL_COMPOSITION_ROOT_STALE' },
    );
  });

  it('deep-snapshots schemas and relation evidence before planning continues', async () => {
    const outputSchema = {
      type: 'object',
      properties: { payload: { type: 'string' } },
      required: ['payload'],
    };
    const metadata = { audit: { reason: 'verified' } };
    const root = skill('skill.root', objectSchema([]), outputSchema);
    const child = skill('skill.child', objectSchema(['payload']), objectSchema([]));
    const edge = {
      ...relation('compose', root.skillId, child.skillId, 'composition'),
      metadata,
    };

    const context = await compositionPlanner([root, child], [edge]).compose({
      skillId: root.skillId,
      skillVersion: root.version,
    });
    outputSchema.properties.payload.type = 'number';
    metadata.audit.reason = 'mutated';

    expect(context.selectedSkill.outputSchema).toMatchObject({
      properties: { payload: { type: 'string' } },
    });
    expect(context.relations[0]?.metadata).toEqual({ audit: { reason: 'verified' } });
    expect(Object.isFrozen(context.selectedSkill.outputSchema)).toBe(true);
    expect(Object.isFrozen(context.relations[0]?.metadata['audit'])).toBe(true);
  });
});

function compositionPlanner(
  skills: readonly SkillVersion[],
  relations: readonly SkillRelation[],
): SkillCompositionPlanner {
  return new SkillCompositionPlanner({
    skills: new MemorySkills(skills),
    graph: new MemoryGraph(relations),
  });
}

function objectSchema(required: readonly string[]) {
  return {
    type: 'object',
    properties: Object.fromEntries(required.map((field) => [field, { type: 'string' }])),
    required,
    additionalProperties: false,
  } as const;
}

function skill(skillId: string, inputSchema: unknown, outputSchema: unknown): SkillVersion {
  return {
    skillId,
    version: 1,
    name: skillId,
    summary: skillId,
    description: skillId,
    capabilities: [skillId],
    workflowGuidance: 'Use the composition graph.',
    outputInstruction: 'Return JSON.',
    inputSchema,
    outputSchema,
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-16T00:00:00.000Z',
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
    createdAt: '2026-07-16T00:00:00.000Z',
  };
}

class MemoryGraph implements SkillGraphRepository {
  readonly #relations: readonly SkillRelation[];
  constructor(relations: readonly SkillRelation[]) {
    this.#relations = relations;
  }
  listRelations() {
    return Promise.resolve(this.#relations);
  }
  saveRelation(): Promise<void> {
    return Promise.resolve();
  }
  deleteRelation(): Promise<void> {
    return Promise.resolve();
  }
}

class MemorySkills implements SkillRepository {
  readonly #versions: ReadonlyMap<string, SkillVersion>;
  constructor(versions: readonly SkillVersion[]) {
    this.#versions = new Map(versions.map((version) => [version.skillId, version]));
  }
  find(skillId: string): Promise<Skill | undefined> {
    const version = this.#versions.get(skillId);
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
    return Promise.resolve(this.#versions.get(skillId));
  }
  findVersion(skillId: string, version: number): Promise<SkillVersion | undefined> {
    const current = this.#versions.get(skillId);
    return Promise.resolve(current?.version === version ? current : undefined);
  }
  listVersions(skillId: string): Promise<readonly SkillVersion[]> {
    const version = this.#versions.get(skillId);
    return Promise.resolve(version === undefined ? [] : [version]);
  }
  listEnabledVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve(
      [...this.#versions.values()].filter((item) => item.status === 'enabled'),
    );
  }
  listCurrentVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve([...this.#versions.values()]);
  }
  saveVersionAndSetCurrent(): Promise<void> {
    return Promise.resolve();
  }
}
