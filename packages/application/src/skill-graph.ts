import {
  createSkillRelation,
  type SkillRelation,
  type SkillRelationType,
} from '../../domain/src/index.js';

import type { Clock, SkillGraphRepository, SkillRepository } from './ports.js';

export interface CreateSkillRelationInput {
  readonly sourceSkillId: string;
  readonly targetSkillId: string;
  readonly relationType: SkillRelationType;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export class SkillGraphService {
  readonly #graph: SkillGraphRepository;
  readonly #skills: SkillRepository;
  readonly #clock: Clock;
  readonly #ids: Readonly<{ nextRelationId(): string }>;

  constructor(
    dependencies: Readonly<{
      graph: SkillGraphRepository;
      skills: SkillRepository;
      clock: Clock;
      ids: Readonly<{ nextRelationId(): string }>;
    }>,
  ) {
    this.#graph = dependencies.graph;
    this.#skills = dependencies.skills;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async create(input: CreateSkillRelationInput): Promise<SkillRelation> {
    if ((await this.#skills.find(input.sourceSkillId)) === undefined) {
      throw new SkillGraphError('SKILL_GRAPH_SOURCE_NOT_FOUND', 'Source Skill was not found.');
    }
    if ((await this.#skills.find(input.targetSkillId)) === undefined) {
      throw new SkillGraphError('SKILL_GRAPH_TARGET_NOT_FOUND', 'Target Skill was not found.');
    }
    const relation = createSkillRelation({
      relationId: this.#ids.nextRelationId(),
      ...input,
      createdAt: this.#clock.now(),
    });
    const relations = await this.#graph.listRelations();
    if (
      relations.some(
        (item) =>
          item.sourceSkillId === relation.sourceSkillId &&
          item.targetSkillId === relation.targetSkillId &&
          item.relationType === relation.relationType,
      )
    ) {
      throw new SkillGraphError('SKILL_GRAPH_RELATION_EXISTS', 'Skill relation already exists.');
    }
    if (
      (relation.relationType === 'parent_child' || relation.relationType === 'depends_on') &&
      reaches(relations, relation.relationType, relation.targetSkillId, relation.sourceSkillId)
    ) {
      throw new SkillGraphError(
        'SKILL_GRAPH_CYCLE_DETECTED',
        'Skill relation would create a cycle.',
      );
    }
    await this.#graph.saveRelation(relation);
    return relation;
  }

  list(): Promise<readonly SkillRelation[]> {
    return this.#graph.listRelations();
  }

  delete(relationId: string): Promise<void> {
    return this.#graph.deleteRelation(relationId);
  }
}

function reaches(
  relations: readonly SkillRelation[],
  relationType: SkillRelationType,
  from: string,
  target: string,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const relation of relations) {
    if (relation.relationType !== relationType) continue;
    adjacency.set(relation.sourceSkillId, [
      ...(adjacency.get(relation.sourceSkillId) ?? []),
      relation.targetSkillId,
    ]);
  }
  const pending = [from];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

export type SkillGraphErrorCode =
  | 'SKILL_GRAPH_CYCLE_DETECTED'
  | 'SKILL_GRAPH_RELATION_EXISTS'
  | 'SKILL_GRAPH_SOURCE_NOT_FOUND'
  | 'SKILL_GRAPH_TARGET_NOT_FOUND';

export class SkillGraphError extends Error {
  readonly code: SkillGraphErrorCode;
  constructor(code: SkillGraphErrorCode, message: string) {
    super(message);
    this.name = 'SkillGraphError';
    this.code = code;
  }
}
