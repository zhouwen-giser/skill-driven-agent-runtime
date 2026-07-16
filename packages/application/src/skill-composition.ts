import {
  snapshotSkillCompositionContext,
  snapshotSkillVersion,
  type SkillCompositionContext,
  type SkillRelation,
  type SkillRelationType,
  type SkillVersion,
} from '../../domain/src/index.js';

import type { SkillGraphRepository, SkillRepository } from './ports.js';

export const MAX_COMPOSITION_DEPTH = 8;
export const MAX_COMPOSITION_RELATED_SKILLS = 32;

const INITIAL_COMPOSITION_RELATIONS: ReadonlySet<SkillRelationType> = new Set([
  'parent_child',
  'depends_on',
  'input_output_match',
  'composition',
  'capability_coverage',
]);

export interface SkillCompositionRoot {
  readonly skillId: string;
  readonly skillVersion: number;
}

/** Builds a bounded, exact-version Skill Graph snapshot; the model still chooses a subset. */
export class SkillCompositionPlanner {
  readonly #skills: Pick<SkillRepository, 'findCurrentVersion' | 'findVersion'>;
  readonly #graph: Pick<SkillGraphRepository, 'listRelations'>;

  constructor(
    dependencies: Readonly<{
      skills: Pick<SkillRepository, 'findCurrentVersion' | 'findVersion'>;
      graph: Pick<SkillGraphRepository, 'listRelations'>;
    }>,
  ) {
    this.#skills = dependencies.skills;
    this.#graph = dependencies.graph;
  }

  async compose(root: SkillCompositionRoot): Promise<SkillCompositionContext> {
    const [selected, current, allRelations] = await Promise.all([
      this.#skills.findVersion(root.skillId, root.skillVersion),
      this.#skills.findCurrentVersion(root.skillId),
      this.#graph.listRelations(),
    ]);
    if (
      selected?.status !== 'enabled' ||
      current?.status !== 'enabled' ||
      current.version !== selected.version
    )
      throw new SkillCompositionError(
        'SKILL_COMPOSITION_ROOT_STALE',
        'Composition requires the exact current enabled selected Skill version.',
      );

    const relations = [...allRelations]
      .filter((relation) => INITIAL_COMPOSITION_RELATIONS.has(relation.relationType))
      .sort(compareRelations);
    const bySource = new Map<string, SkillRelation[]>();
    for (const relation of relations)
      bySource.set(relation.sourceSkillId, [
        ...(bySource.get(relation.sourceSkillId) ?? []),
        relation,
      ]);

    const related = new Map<string, SkillVersion>();
    const acceptedRelations: SkillRelation[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = async (source: SkillVersion, depth: number): Promise<void> => {
      if (depth > MAX_COMPOSITION_DEPTH)
        throw new SkillCompositionError(
          'SKILL_COMPOSITION_DEPTH_EXCEEDED',
          `Skill composition exceeds depth ${String(MAX_COMPOSITION_DEPTH)}.`,
        );
      if (visiting.has(source.skillId))
        throw new SkillCompositionError(
          'SKILL_COMPOSITION_CYCLE_DETECTED',
          `Skill composition contains a cycle at ${source.skillId}.`,
        );
      if (visited.has(source.skillId)) return;
      visiting.add(source.skillId);
      for (const relation of bySource.get(source.skillId) ?? []) {
        const target = await this.#skills.findCurrentVersion(relation.targetSkillId);
        if (target?.status !== 'enabled')
          throw new SkillCompositionError(
            'SKILL_COMPOSITION_RELATED_SKILL_UNAVAILABLE',
            `Related Skill ${relation.targetSkillId} is not current and enabled.`,
          );
        if (!schemasCompatibleForRelation(source, target, relation.relationType))
          throw new SkillCompositionError(
            'SKILL_COMPOSITION_SCHEMA_INCOMPATIBLE',
            `Relation ${relation.relationId} has incompatible Skill input/output schemas.`,
          );
        acceptedRelations.push(Object.freeze({ ...relation, metadata: { ...relation.metadata } }));
        if (visiting.has(target.skillId))
          throw new SkillCompositionError(
            'SKILL_COMPOSITION_CYCLE_DETECTED',
            `Skill composition contains a cycle through ${target.skillId}.`,
          );
        if (target.skillId !== selected.skillId && !related.has(target.skillId)) {
          if (related.size >= MAX_COMPOSITION_RELATED_SKILLS)
            throw new SkillCompositionError(
              'SKILL_COMPOSITION_SIZE_EXCEEDED',
              `Skill composition exceeds ${String(MAX_COMPOSITION_RELATED_SKILLS)} related Skills.`,
            );
          related.set(target.skillId, target);
        }
        await visit(target, depth + 1);
      }
      visiting.delete(source.skillId);
      visited.add(source.skillId);
    };

    await visit(selected, 0);
    const relatedSkills = [...related.values()]
      .sort((left, right) => left.skillId.localeCompare(right.skillId))
      .map(snapshotSkillVersion);
    const allowedChildSkillIds = relatedSkills.map((skill) => skill.skillId);
    const relationKinds = [...new Set(acceptedRelations.map((relation) => relation.relationType))];
    return snapshotSkillCompositionContext({
      selectedSkill: snapshotSkillVersion(selected),
      relatedSkills,
      relations: acceptedRelations,
      allowedChildSkillIds,
      decisionSummary:
        allowedChildSkillIds.length === 0
          ? `Skill Graph exposed no composable child for ${selected.skillId}; the model may not invent one.`
          : `Skill Graph admitted ${allowedChildSkillIds.join(', ')} through ${relationKinds.join(', ')}; the model decides which admitted Skills to call.`,
    });
  }
}

export function schemasCompatibleForRelation(
  source: Pick<SkillVersion, 'inputSchema' | 'outputSchema'>,
  target: Pick<SkillVersion, 'inputSchema' | 'outputSchema'>,
  relationType: SkillRelationType,
): boolean {
  if (relationType === 'alternative') return false;
  if (relationType === 'depends_on')
    return schemaAssignable(target.outputSchema, source.inputSchema);
  if (relationType === 'parent_child' || relationType === 'capability_coverage')
    return schemaAssignable(source.inputSchema, target.inputSchema);
  return schemaAssignable(source.outputSchema, target.inputSchema);
}

function schemaAssignable(producer: unknown, consumer: unknown, depth = 0): boolean {
  if (depth > 16 || consumer === false || producer === false) return false;
  if (consumer === true || isUnconstrainedSchema(consumer)) return true;
  if (producer === true || isUnconstrainedSchema(producer)) return false;
  if (!isSchemaObject(producer) || !isSchemaObject(consumer)) return false;

  const producerTypes = schemaTypes(producer);
  const consumerTypes = schemaTypes(consumer);
  if (
    consumerTypes.size > 0 &&
    (producerTypes.size === 0 || [...producerTypes].some((type) => !consumerTypes.has(type)))
  )
    return false;

  if (consumerTypes.has('object') || hasObjectShape(consumer)) {
    const producerRequired = stringSet(producer['required']);
    const consumerRequired = stringSet(consumer['required']);
    const producerProperties = schemaProperties(producer);
    const consumerProperties = schemaProperties(consumer);
    for (const field of consumerRequired) {
      if (!producerRequired.has(field)) return false;
      const produced = producerProperties[field];
      const accepted = consumerProperties[field];
      if (
        accepted !== undefined &&
        (produced === undefined || !schemaAssignable(produced, accepted, depth + 1))
      )
        return false;
    }
  }
  if (consumerTypes.has('array') && consumer['items'] !== undefined)
    return (
      producer['items'] !== undefined &&
      schemaAssignable(producer['items'], consumer['items'], depth + 1)
    );
  return enumAssignable(producer['enum'], consumer['enum']);
}

function isUnconstrainedSchema(value: unknown): boolean {
  return isSchemaObject(value) && Object.keys(value).length === 0;
}

function isSchemaObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaTypes(schema: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const type = schema['type'];
  if (typeof type === 'string') return new Set([type]);
  if (Array.isArray(type))
    return new Set(type.filter((value): value is string => typeof value === 'string'));
  return new Set();
}

function hasObjectShape(schema: Readonly<Record<string, unknown>>): boolean {
  return schema['properties'] !== undefined || schema['required'] !== undefined;
}

function stringSet(value: unknown): ReadonlySet<string> {
  return new Set(
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [],
  );
}

function schemaProperties(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return isSchemaObject(schema['properties']) ? schema['properties'] : {};
}

function enumAssignable(producer: unknown, consumer: unknown): boolean {
  if (!Array.isArray(consumer)) return true;
  if (!Array.isArray(producer)) return false;
  return producer.every((value) => consumer.some((accepted) => Object.is(value, accepted)));
}

function compareRelations(left: SkillRelation, right: SkillRelation): number {
  return (
    left.sourceSkillId.localeCompare(right.sourceSkillId) ||
    left.relationType.localeCompare(right.relationType) ||
    left.targetSkillId.localeCompare(right.targetSkillId) ||
    left.relationId.localeCompare(right.relationId)
  );
}

export type SkillCompositionErrorCode =
  | 'SKILL_COMPOSITION_CYCLE_DETECTED'
  | 'SKILL_COMPOSITION_DEPTH_EXCEEDED'
  | 'SKILL_COMPOSITION_RELATED_SKILL_UNAVAILABLE'
  | 'SKILL_COMPOSITION_ROOT_STALE'
  | 'SKILL_COMPOSITION_SCHEMA_INCOMPATIBLE'
  | 'SKILL_COMPOSITION_SIZE_EXCEEDED';

export class SkillCompositionError extends Error {
  readonly code: SkillCompositionErrorCode;
  constructor(code: SkillCompositionErrorCode, message: string) {
    super(message);
    this.name = 'SkillCompositionError';
    this.code = code;
  }
}
