import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';

export type SkillRelationType =
  | 'parent_child'
  | 'depends_on'
  | 'input_output_match'
  | 'alternative'
  | 'composition'
  | 'capability_coverage';

export interface SkillRelation {
  readonly relationId: string;
  readonly sourceSkillId: string;
  readonly targetSkillId: string;
  readonly relationType: SkillRelationType;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export function createSkillRelation(input: SkillRelation): SkillRelation {
  const relationId = requireIdentifier(input.relationId, 'SKILL_RELATION_ID_REQUIRED');
  const sourceSkillId = requireIdentifier(input.sourceSkillId, 'SKILL_ID_REQUIRED');
  const targetSkillId = requireIdentifier(input.targetSkillId, 'SKILL_ID_REQUIRED');
  if (sourceSkillId === targetSkillId) {
    throw new DomainError(
      'SKILL_RELATION_SELF_REFERENCE',
      'A Skill relation cannot reference itself.',
    );
  }
  return { ...input, relationId, sourceSkillId, targetSkillId };
}
