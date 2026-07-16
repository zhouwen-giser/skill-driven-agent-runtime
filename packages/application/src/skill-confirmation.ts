import type { SkillVersion, WorkflowDefinition } from '../../domain/src/index.js';

import type { SkillGraphRepository, SkillRepository } from './ports.js';

const TRANSITIVE_EXECUTION_RELATIONS = new Set([
  'parent_child',
  'depends_on',
  'input_output_match',
  'composition',
  'capability_coverage',
]);

export interface SkillConfirmationEvaluation {
  readonly autoConfirm: boolean;
  readonly skillVersions: readonly Readonly<{ skillId: string; version: number }>[];
  readonly blockingSkillIds: readonly string[];
}

export class TransitiveSkillConfirmationEvaluator {
  readonly #skills: SkillRepository;
  readonly #graph: SkillGraphRepository;

  constructor(dependencies: Readonly<{ skills: SkillRepository; graph: SkillGraphRepository }>) {
    this.#skills = dependencies.skills;
    this.#graph = dependencies.graph;
  }

  async evaluate(
    governingSkillIds: readonly string[],
    definition?: WorkflowDefinition,
  ): Promise<SkillConfirmationEvaluation> {
    const reachable = new Set(governingSkillIds);
    for (const node of definition?.nodes ?? [])
      if (node.type === 'skill_call') reachable.add(node.skillId);

    const relations = await this.#graph.listRelations();
    const pending = [...reachable];
    while (pending.length > 0) {
      const source = pending.pop();
      if (source === undefined) break;
      for (const relation of relations) {
        if (
          relation.sourceSkillId !== source ||
          !TRANSITIVE_EXECUTION_RELATIONS.has(relation.relationType) ||
          reachable.has(relation.targetSkillId)
        )
          continue;
        reachable.add(relation.targetSkillId);
        pending.push(relation.targetSkillId);
      }
    }

    const versions: SkillVersion[] = [];
    const blockingSkillIds: string[] = [];
    for (const skillId of [...reachable].sort()) {
      const skill = await this.#skills.findCurrentVersion(skillId);
      if (skill?.status === 'enabled') versions.push(skill);
      if (skill?.status !== 'enabled' || !skill.runtimePolicy.autoConfirmPlan)
        blockingSkillIds.push(skillId);
    }
    return {
      autoConfirm: reachable.size > 0 && blockingSkillIds.length === 0,
      skillVersions: versions.map((skill) => ({ skillId: skill.skillId, version: skill.version })),
      blockingSkillIds,
    };
  }
}
