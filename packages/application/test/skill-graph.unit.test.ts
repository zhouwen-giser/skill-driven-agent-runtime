import { describe, expect, it } from 'vitest';

import type { Skill, SkillRelation, SkillVersion } from '../../domain/src/index.js';
import {
  SkillGraphService,
  type SkillGraphRepository,
  type SkillRepository,
} from '../src/index.js';

describe('SkillGraphService', () => {
  it('stores all six domain relation types and exposes protocol-neutral graph data', async () => {
    const graph = new MemoryGraphRepository();
    const service = createService(graph);
    const types = [
      'parent_child',
      'depends_on',
      'input_output_match',
      'alternative',
      'composition',
      'capability_coverage',
    ] as const;
    for (const relationType of types) {
      await service.create({
        sourceSkillId: 'skill.a',
        targetSkillId: 'skill.b',
        relationType,
        metadata: { evidence: relationType },
      });
    }
    expect((await service.list()).map((item) => item.relationType)).toEqual(types);
  });

  it('rejects duplicate, missing endpoint, self-reference, and hierarchical cycles', async () => {
    const graph = new MemoryGraphRepository();
    const service = createService(graph);
    await service.create({
      sourceSkillId: 'skill.a',
      targetSkillId: 'skill.b',
      relationType: 'depends_on',
      metadata: {},
    });
    await service.create({
      sourceSkillId: 'skill.b',
      targetSkillId: 'skill.c',
      relationType: 'depends_on',
      metadata: {},
    });
    await expect(
      service.create({
        sourceSkillId: 'skill.c',
        targetSkillId: 'skill.a',
        relationType: 'depends_on',
        metadata: {},
      }),
    ).rejects.toMatchObject({ code: 'SKILL_GRAPH_CYCLE_DETECTED' });
    await expect(
      service.create({
        sourceSkillId: 'skill.a',
        targetSkillId: 'skill.b',
        relationType: 'depends_on',
        metadata: {},
      }),
    ).rejects.toMatchObject({ code: 'SKILL_GRAPH_RELATION_EXISTS' });
    await expect(
      service.create({
        sourceSkillId: 'skill.a',
        targetSkillId: 'skill.missing',
        relationType: 'alternative',
        metadata: {},
      }),
    ).rejects.toMatchObject({ code: 'SKILL_GRAPH_TARGET_NOT_FOUND' });
    await expect(
      service.create({
        sourceSkillId: 'skill.a',
        targetSkillId: 'skill.a',
        relationType: 'alternative',
        metadata: {},
      }),
    ).rejects.toMatchObject({ code: 'SKILL_RELATION_SELF_REFERENCE' });
  });
});

function createService(graph: SkillGraphRepository): SkillGraphService {
  let sequence = 0;
  return new SkillGraphService({
    graph,
    skills: new SkillLookupRepository(['skill.a', 'skill.b', 'skill.c']),
    clock: { now: () => '2026-07-11T10:00:00.000Z' },
    ids: { nextRelationId: () => `relation-${String(++sequence)}` },
  });
}

class MemoryGraphRepository implements SkillGraphRepository {
  relations: readonly SkillRelation[] = [];
  listRelations() {
    return Promise.resolve(this.relations);
  }
  saveRelation(relation: SkillRelation) {
    this.relations = [...this.relations, relation];
    return Promise.resolve();
  }
  deleteRelation(relationId: string) {
    this.relations = this.relations.filter((item) => item.relationId !== relationId);
    return Promise.resolve();
  }
}

class SkillLookupRepository implements SkillRepository {
  readonly #ids: ReadonlySet<string>;
  constructor(ids: readonly string[]) {
    this.#ids = new Set(ids);
  }
  find(skillId: string): Promise<Skill | undefined> {
    return Promise.resolve(
      this.#ids.has(skillId)
        ? {
            skillId,
            currentVersion: 1,
            createdAt: '2026-07-11T10:00:00.000Z',
            updatedAt: '2026-07-11T10:00:00.000Z',
          }
        : undefined,
    );
  }
  findCurrentVersion(): Promise<SkillVersion | undefined> {
    return Promise.resolve(undefined);
  }
  findVersion(): Promise<SkillVersion | undefined> {
    return Promise.resolve(undefined);
  }
  listVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve([]);
  }
  listEnabledVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve([]);
  }
  listCurrentVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve([]);
  }
  saveVersionAndSetCurrent(): Promise<void> {
    return Promise.resolve();
  }
}
