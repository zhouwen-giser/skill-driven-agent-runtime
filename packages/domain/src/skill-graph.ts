import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';
import type { SkillRuntimePolicy, SkillToolPolicy, SkillVersion } from './skill.js';

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

/** Immutable planning fields for one exact Skill version in a graph decision. */
export interface SkillVersionSnapshot {
  readonly skillId: string;
  readonly version: number;
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly workflowGuidance: string;
  readonly outputInstruction: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly toolPolicy: SkillToolPolicy;
  readonly runtimePolicy: SkillRuntimePolicy;
  readonly createdAt: string;
}

export interface SkillCompositionContext {
  readonly selectedSkill: SkillVersionSnapshot;
  readonly relatedSkills: readonly SkillVersionSnapshot[];
  readonly relations: readonly SkillRelation[];
  readonly allowedChildSkillIds: readonly string[];
  readonly decisionSummary: string;
}

export function snapshotSkillVersion(skill: SkillVersion): SkillVersionSnapshot {
  return copySkillVersionSnapshot(skill);
}

export function snapshotSkillCompositionContext(
  context: SkillCompositionContext,
): SkillCompositionContext {
  const selectedSkill = copySkillVersionSnapshot(context.selectedSkill);
  const relatedSkills = context.relatedSkills.map(copySkillVersionSnapshot);
  const relatedIds = new Set(relatedSkills.map((skill) => skill.skillId));
  const allowedIds = new Set(context.allowedChildSkillIds);
  if (
    context.decisionSummary.trim() === '' ||
    context.allowedChildSkillIds.includes(selectedSkill.skillId) ||
    allowedIds.size !== relatedIds.size ||
    context.allowedChildSkillIds.some((skillId) => !relatedIds.has(skillId)) ||
    relatedSkills.some((skill) => !allowedIds.has(skill.skillId)) ||
    context.relations.some(
      (relation) =>
        relation.relationType === 'alternative' ||
        (!relatedIds.has(relation.sourceSkillId) &&
          relation.sourceSkillId !== selectedSkill.skillId) ||
        !relatedIds.has(relation.targetSkillId),
    )
  )
    throw new DomainError(
      'SKILL_COMPOSITION_CONTEXT_INVALID',
      'Skill composition context does not match its bounded related Skill snapshot.',
    );
  return Object.freeze({
    selectedSkill,
    relatedSkills: Object.freeze(relatedSkills),
    relations: Object.freeze(
      context.relations.map((relation) =>
        Object.freeze({
          ...relation,
          metadata: snapshotJsonValue(relation.metadata) as Readonly<Record<string, unknown>>,
        }),
      ),
    ),
    allowedChildSkillIds: Object.freeze([...context.allowedChildSkillIds]),
    decisionSummary: context.decisionSummary,
  });
}

function copySkillVersionSnapshot(skill: SkillVersionSnapshot): SkillVersionSnapshot {
  return Object.freeze({
    skillId: skill.skillId,
    version: skill.version,
    name: skill.name,
    summary: skill.summary,
    description: skill.description,
    capabilities: Object.freeze([...skill.capabilities]),
    workflowGuidance: skill.workflowGuidance,
    outputInstruction: skill.outputInstruction,
    inputSchema: snapshotJsonValue(skill.inputSchema),
    outputSchema: snapshotJsonValue(skill.outputSchema),
    toolPolicy: Object.freeze({
      required: Object.freeze(
        skill.toolPolicy.required.map((reference) => Object.freeze({ ...reference })),
      ),
      optional: Object.freeze(
        skill.toolPolicy.optional.map((reference) => Object.freeze({ ...reference })),
      ),
      forbidden: Object.freeze(
        skill.toolPolicy.forbidden.map((reference) => Object.freeze({ ...reference })),
      ),
    }),
    runtimePolicy: Object.freeze({ ...skill.runtimePolicy }),
    createdAt: skill.createdAt,
  });
}

function snapshotJsonValue(value: unknown, active = new WeakSet()): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (typeof value !== 'object')
    throw new DomainError(
      'SKILL_COMPOSITION_CONTEXT_INVALID',
      'Skill composition snapshots must contain finite JSON data.',
    );
  if (active.has(value))
    throw new DomainError(
      'SKILL_COMPOSITION_CONTEXT_INVALID',
      'Skill composition snapshots may not contain cyclic JSON data.',
    );
  active.add(value);
  try {
    if (Array.isArray(value))
      return Object.freeze(value.map((item) => snapshotJsonValue(item, active)));
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new DomainError(
        'SKILL_COMPOSITION_CONTEXT_INVALID',
        'Skill composition snapshots must contain plain JSON objects.',
      );
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, snapshotJsonValue(item, active)]),
      ),
    );
  } finally {
    active.delete(value);
  }
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
