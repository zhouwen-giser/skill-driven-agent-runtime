import {
  MAX_SKILL_COMPOSITION_DEPTH,
  MAX_SKILL_COMPOSITION_RELATED_SKILLS,
  MAX_SKILL_COMPOSITION_RELATIONS,
  DEFAULT_SKILL_USAGE_DEPTH,
  MAX_SKILL_USAGE_EXPANDED_SKILLS,
  MAX_SKILL_USAGE_PLAN_NODES,
  snapshotSkillUsageCompositionPlan,
  snapshotSkillCompositionContext,
  snapshotSkillVersion,
  type SkillCompositionContext,
  type SkillRelation,
  type SkillRelationType,
  type SkillVersion,
  type SkillCapabilitySlot,
  type SkillModeDecision,
  type SkillModeInterpretation,
  type SkillProcedureStep,
  type SkillUsageCompositionEdge,
  type SkillUsageCompositionPlan,
  type SkillUsageSpecification,
  type SkillValueMapping,
} from '../../domain/src/index.js';

import type { SkillGraphRepository, SkillRepository } from './ports.js';

export const MAX_COMPOSITION_DEPTH = MAX_SKILL_COMPOSITION_DEPTH;
export const MAX_COMPOSITION_RELATED_SKILLS = MAX_SKILL_COMPOSITION_RELATED_SKILLS;
export const MAX_COMPOSITION_RELATIONS = MAX_SKILL_COMPOSITION_RELATIONS;

const INITIAL_COMPOSITION_RELATION_TYPES: readonly SkillRelationType[] = [
  'parent_child',
  'depends_on',
  'input_output_match',
  'composition',
  'capability_coverage',
];
const INITIAL_COMPOSITION_RELATIONS: ReadonlySet<SkillRelationType> = new Set(
  INITIAL_COMPOSITION_RELATION_TYPES,
);

export interface SkillCompositionRoot {
  readonly skillId: string;
  readonly skillVersion: number;
}

function usageOf(skill: SkillVersion): SkillUsageSpecification {
  if (skill.usageSpecification === undefined)
    throw usageCompositionError(
      'SKILL_USAGE_REQUIRED',
      `Skill ${skill.skillId}@${String(skill.version)} requires a native usage specification.`,
    );
  return skill.usageSpecification;
}

function exactReference(skill: SkillVersion) {
  return Object.freeze({ skillId: skill.skillId, skillVersion: skill.version });
}

function versionKey(skill: SkillVersion): string {
  return `${skill.skillId}@${String(skill.version)}`;
}

function freezeMappings(mappings: readonly SkillValueMapping[]): readonly SkillValueMapping[] {
  return Object.freeze(mappings.map((mapping) => Object.freeze({ ...mapping })));
}

function requireUsageRelation(
  parentSkillId: string,
  childSkillId: string,
  relations: readonly SkillRelation[],
  kind: SkillUsageCompositionEdge['kind'],
): void {
  if (!hasUsageRelation(parentSkillId, childSkillId, relations, kind))
    throw usageCompositionError(
      'SKILL_USAGE_COMPOSITION_RELATION_REQUIRED',
      `Existing Skill Graph does not admit ${parentSkillId} -> ${childSkillId}.`,
    );
}

function hasUsageRelation(
  parentSkillId: string,
  childSkillId: string,
  relations: readonly SkillRelation[],
  kind: SkillUsageCompositionEdge['kind'],
): boolean {
  const allowed: ReadonlySet<SkillRelationType> =
    kind === 'fixed_dependency'
      ? new Set(['depends_on', 'parent_child', 'composition', 'input_output_match'])
      : new Set(['capability_coverage', 'parent_child', 'composition']);
  return relations.some(
    (relation) =>
      relation.sourceSkillId === parentSkillId &&
      relation.targetSkillId === childSkillId &&
      allowed.has(relation.relationType),
  );
}

function assertMappingsCompatible(
  parent: SkillVersion,
  child: SkillVersion,
  inputMappings: readonly SkillValueMapping[],
  outputMappings: readonly SkillValueMapping[],
): void {
  if (!mappingsCompatible(parent, child, inputMappings, outputMappings))
    throw usageCompositionError(
      'SKILL_COMPOSITION_SCHEMA_INCOMPATIBLE',
      `Declarative mappings cannot satisfy ${child.skillId}@${String(child.version)}.`,
    );
}

function mappingsCompatible(
  parent: SkillVersion,
  child: SkillVersion,
  inputMappings: readonly SkillValueMapping[],
  outputMappings: readonly SkillValueMapping[],
): boolean {
  const childRequired = schemaFieldSet(child.inputSchema, 'required');
  const mappedTargets = new Set(inputMappings.map((mapping) => firstPathPart(mapping.targetPath)));
  if ([...childRequired].some((field) => !mappedTargets.has(field))) return false;
  if (
    inputMappings.some((mapping) => {
      const source = firstPathPart(mapping.sourcePath);
      const targetSchema = schemaAtPropertyPath(child.inputSchema, mapping.targetPath);
      if (targetSchema === undefined) return true;
      if (source === 'context') return false;
      const sourceSchema = schemaAtPropertyPath(parent.inputSchema, mapping.sourcePath);
      return sourceSchema === undefined || !schemaAssignable(sourceSchema, targetSchema);
    })
  )
    return false;
  return !outputMappings.some((mapping) => {
    const target = firstPathPart(mapping.targetPath);
    const sourceSchema = schemaAtPropertyPath(child.outputSchema, mapping.sourcePath);
    if (sourceSchema === undefined) return true;
    if (target === 'evidence') return false;
    const targetSchema = schemaAtPropertyPath(parent.outputSchema, mapping.targetPath);
    return targetSchema === undefined || !schemaAssignable(sourceSchema, targetSchema);
  });
}

function schemaAtPropertyPath(schema: unknown, path: string): unknown {
  let current = schema;
  for (const segment of path.split('.')) {
    if (!isSchemaObject(current)) return undefined;
    const properties = current['properties'];
    if (!isSchemaObject(properties) || !(segment in properties)) return undefined;
    current = properties[segment];
  }
  return current;
}

function schemaFieldSet(schema: unknown, key: 'properties' | 'required'): ReadonlySet<string> {
  if (!isSchemaObject(schema)) return new Set();
  const value = schema[key];
  if (key === 'required')
    return new Set(
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [],
    );
  return new Set(isSchemaObject(value) ? Object.keys(value) : []);
}

function firstPathPart(value: string): string {
  return value.split('.')[0] ?? '';
}

function usageCompositionError(
  code: SkillCompositionErrorCode,
  message: string,
): SkillCompositionError {
  return new SkillCompositionError(code, message);
}

export interface SkillUsageSlotChoice {
  readonly parentSkillId: string;
  readonly parentSkillVersion: number;
  readonly slotId: string;
  readonly skillId: string;
  readonly skillVersion: number;
}

/** Builds a bounded, exact-version Skill Graph snapshot; the model still chooses a subset. */
export class SkillCompositionPlanner {
  readonly #skills: Pick<
    SkillRepository,
    'findCurrentVersion' | 'findVersion' | 'listEnabledVersions'
  >;
  readonly #graph: Pick<SkillGraphRepository, 'listRelationsFrom'>;

  constructor(
    dependencies: Readonly<{
      skills: Pick<SkillRepository, 'findCurrentVersion' | 'findVersion' | 'listEnabledVersions'>;
      graph: Pick<SkillGraphRepository, 'listRelationsFrom'>;
    }>,
  ) {
    this.#skills = dependencies.skills;
    this.#graph = dependencies.graph;
  }

  async compose(root: SkillCompositionRoot): Promise<SkillCompositionContext> {
    const [selected, current] = await Promise.all([
      this.#skills.findVersion(root.skillId, root.skillVersion),
      this.#skills.findCurrentVersion(root.skillId),
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
      const remainingRelationCapacity = MAX_COMPOSITION_RELATIONS - acceptedRelations.length;
      const boundedRelations = await this.#graph.listRelationsFrom(
        source.skillId,
        INITIAL_COMPOSITION_RELATION_TYPES,
        remainingRelationCapacity + 1,
      );
      if (boundedRelations.length > remainingRelationCapacity)
        throw new SkillCompositionError(
          'SKILL_COMPOSITION_SIZE_EXCEEDED',
          `Skill composition exceeds ${String(MAX_COMPOSITION_RELATIONS)} accepted relations.`,
        );
      const relations = boundedRelations
        .filter((relation) => INITIAL_COMPOSITION_RELATIONS.has(relation.relationType))
        .sort(compareRelations);
      for (const relation of relations) {
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

  async composeUsage(
    root: SkillCompositionRoot,
    slotChoices: readonly SkillUsageSlotChoice[] = [],
  ): Promise<SkillUsageCompositionPlan> {
    const choiceKeys = slotChoices.map(
      (choice) => `${choice.parentSkillId}@${String(choice.parentSkillVersion)}:${choice.slotId}`,
    );
    if (new Set(choiceKeys).size !== choiceKeys.length)
      throw usageCompositionError(
        'SKILL_USAGE_COMPOSITION_SLOT_CHOICE_INVALID',
        'Capability slot choices must be unique by exact parent and slot.',
      );
    const selected = await this.#requireExactCurrent(root.skillId, root.skillVersion, true);
    const rootUsage = usageOf(selected);
    const maxDepth = rootUsage.composition?.maxDepth ?? DEFAULT_SKILL_USAGE_DEPTH;
    const expanded: SkillVersion[] = [selected];
    const expandedKeys = new Set([versionKey(selected)]);
    const active = new Set<string>();
    const edges: SkillUsageCompositionEdge[] = [];
    const usedChoices = new Set<string>();
    let consumedDepth = 0;

    const addChild = async (
      parent: SkillVersion,
      child: SkillVersion,
      edge: Omit<SkillUsageCompositionEdge, 'parent' | 'child' | 'depth'>,
      depth: number,
    ): Promise<void> => {
      if (depth > maxDepth)
        throw usageCompositionError(
          'SKILL_USAGE_COMPOSITION_DEPTH_EXCEEDED',
          `Skill usage composition exceeds shared depth ${String(maxDepth)}.`,
        );
      const key = versionKey(child);
      if (active.has(key))
        throw usageCompositionError(
          'SKILL_USAGE_COMPOSITION_CYCLE_DETECTED',
          `Skill usage composition contains a cycle through ${key}.`,
        );
      if (expandedKeys.has(key))
        throw usageCompositionError(
          'SKILL_USAGE_COMPOSITION_DUPLICATE_EXPANSION',
          `Skill usage composition expands ${key} more than once.`,
        );
      if (
        expanded.length >= MAX_SKILL_USAGE_EXPANDED_SKILLS ||
        edges.length >= MAX_SKILL_USAGE_PLAN_NODES
      )
        throw usageCompositionError(
          'SKILL_USAGE_COMPOSITION_SIZE_EXCEEDED',
          'Skill usage composition exceeds its shared Skill or node budget.',
        );
      assertMappingsCompatible(parent, child, edge.inputMappings, edge.outputMappings);
      expanded.push(child);
      expandedKeys.add(key);
      consumedDepth = Math.max(consumedDepth, depth);
      edges.push(
        Object.freeze({
          ...edge,
          parent: exactReference(parent),
          child: exactReference(child),
          depth,
        }),
      );
      await expand(child, depth);
    };

    const expand = async (parent: SkillVersion, depth: number): Promise<void> => {
      const key = versionKey(parent);
      if (active.has(key))
        throw usageCompositionError(
          'SKILL_USAGE_COMPOSITION_CYCLE_DETECTED',
          `Skill usage composition contains a cycle at ${key}.`,
        );
      active.add(key);
      try {
        const composition = usageOf(parent).composition;
        if (composition === undefined) return;
        const relations = await this.#usageRelations(parent.skillId);
        for (const dependency of composition.fixedDependencies) {
          const child =
            dependency.skillVersion === undefined
              ? await this.#requireCurrentEnabled(dependency.skillId)
              : await this.#requireExactCurrent(dependency.skillId, dependency.skillVersion, false);
          requireUsageRelation(parent.skillId, child.skillId, relations, 'fixed_dependency');
          await addChild(
            parent,
            child,
            {
              edgeId: `${versionKey(parent)}:dependency:${dependency.dependencyId}`,
              kind: 'fixed_dependency',
              declarationId: dependency.dependencyId,
              candidateSet: Object.freeze([exactReference(child)]),
              failurePolicy: dependency.failurePolicy,
              inputMappings: Object.freeze([...(dependency.inputMappings ?? [])]),
              outputMappings: Object.freeze([...(dependency.outputMappings ?? [])]),
            },
            depth + 1,
          );
        }
        for (const slot of composition.capabilitySlots) {
          const candidates = await this.#slotCandidates(parent, slot, relations);
          if (candidates.length === 0) {
            if (slot.required)
              throw usageCompositionError(
                'SKILL_USAGE_COMPOSITION_SLOT_UNRESOLVED',
                `Required capability slot ${slot.slotId} has no compatible candidate.`,
              );
            continue;
          }
          const choiceKey = `${versionKey(parent)}:${slot.slotId}`;
          const choice = slotChoices.find(
            (item) =>
              item.parentSkillId === parent.skillId &&
              item.parentSkillVersion === parent.version &&
              item.slotId === slot.slotId,
          );
          if (choice === undefined) {
            if (slot.required)
              throw usageCompositionError(
                'SKILL_USAGE_COMPOSITION_SLOT_CHOICE_REQUIRED',
                `Required capability slot ${slot.slotId} requires an exact-version choice.`,
              );
            continue;
          }
          const child = candidates.find(
            (item) => item.skillId === choice.skillId && item.version === choice.skillVersion,
          );
          if (child === undefined)
            throw usageCompositionError(
              'SKILL_USAGE_COMPOSITION_SLOT_CHOICE_INVALID',
              `Capability slot ${slot.slotId} choice is outside its exact-version candidate set.`,
            );
          await this.#requireExactCurrent(child.skillId, child.version, false);
          usedChoices.add(choiceKey);
          await addChild(
            parent,
            child,
            {
              edgeId: `${versionKey(parent)}:slot:${slot.slotId}`,
              kind: 'capability_slot',
              declarationId: slot.slotId,
              candidateSet: Object.freeze(candidates.map(exactReference)),
              failurePolicy: slot.failurePolicy,
              inputMappings: Object.freeze([...(slot.inputMappings ?? [])]),
              outputMappings: Object.freeze([...(slot.outputMappings ?? [])]),
            },
            depth + 1,
          );
        }
      } finally {
        active.delete(key);
      }
    };

    await expand(selected, 0);
    if (
      slotChoices.some(
        (choice) =>
          !usedChoices.has(
            `${choice.parentSkillId}@${String(choice.parentSkillVersion)}:${choice.slotId}`,
          ),
      )
    )
      throw usageCompositionError(
        'SKILL_USAGE_COMPOSITION_SLOT_CHOICE_INVALID',
        'A slot choice does not match an expanded declared capability slot.',
      );
    return snapshotSkillUsageCompositionPlan({
      root: exactReference(selected),
      expandedSkills: expanded.map(exactReference),
      edges,
      maxDepth,
      consumedDepth,
      consumedSkills: expanded.length,
      consumedNodes: edges.length,
    });
  }

  interpretUsage(
    skill: SkillVersion,
    decision: SkillModeDecision,
    composition: SkillUsageCompositionPlan,
  ): SkillModeInterpretation {
    if (decision.decision !== 'selected')
      throw usageCompositionError(
        'SKILL_USAGE_MODE_BLOCKED',
        'A blocked mode decision cannot be interpreted.',
      );
    const usage = usageOf(skill);
    if (
      composition.root.skillId !== skill.skillId ||
      composition.root.skillVersion !== skill.version
    )
      throw usageCompositionError(
        'SKILL_USAGE_MODE_INVALID',
        'Mode interpretation must use the composition plan for the same exact Skill version.',
      );
    if (!usage.modes.supported.includes(decision.mode) || usage.modes[decision.mode] === undefined)
      throw usageCompositionError(
        'SKILL_USAGE_MODE_INVALID',
        'Selected mode is not supported by the exact Skill version.',
      );
    const descriptor = usage.modes[decision.mode];
    if (descriptor === undefined)
      throw usageCompositionError('SKILL_USAGE_MODE_INVALID', 'Mode descriptor is missing.');
    const reference = exactReference(skill);
    if (decision.mode === 'guidance')
      return Object.freeze({
        kind: 'guidance',
        skill: reference,
        constraints: Object.freeze([...usage.normative.constraints]),
        forbiddenActions: Object.freeze([...usage.normative.forbiddenActions]),
        instructions: Object.freeze([...descriptor.instructions]),
        requiredEvidenceTypes: Object.freeze(
          usage.evidencePolicy.requirements
            .filter((item) => item.required)
            .map((item) => item.evidenceType),
        ),
        composition,
      });
    const parameterMappings = composition.edges.flatMap((edge) => edge.inputMappings);
    const outputMappings = composition.edges.flatMap((edge) => edge.outputMappings);
    if (decision.mode === 'template')
      return Object.freeze({
        kind: 'template',
        skill: reference,
        templateId: `${versionKey(skill)}:template`,
        instructions: Object.freeze([...descriptor.instructions]),
        parameterMappings: freezeMappings(parameterMappings),
        outputMappings: freezeMappings(outputMappings),
        composition,
      });
    const steps: SkillProcedureStep[] = [];
    if (usage.contextRequirements.length > 0)
      steps.push(
        Object.freeze({
          stepId: 'context-gate',
          kind: 'context_gate',
          requirementIds: Object.freeze(
            usage.contextRequirements
              .filter((item) => item.required)
              .map((item) => item.requirementId),
          ),
        }),
      );
    if (decision.confirmationRequired || usage.normative.requiredConfirmations.length > 0)
      steps.push(
        Object.freeze({
          stepId: 'confirmation-gate',
          kind: 'confirmation_gate',
          confirmationIds: Object.freeze(
            usage.normative.requiredConfirmations.length === 0
              ? ['mode_policy_confirmation']
              : [...usage.normative.requiredConfirmations],
          ),
        }),
      );
    for (const edge of composition.edges)
      steps.push(
        Object.freeze({
          stepId: `skill-call:${edge.edgeId}`,
          kind: 'skill_call',
          edgeId: edge.edgeId,
          child: edge.child,
          failurePolicy: edge.failurePolicy,
          inputMappings: freezeMappings(edge.inputMappings),
          outputMappings: freezeMappings(edge.outputMappings),
        }),
      );
    if (usage.taskBindings.length > 0)
      steps.push(
        Object.freeze({
          stepId: 'task-bindings',
          kind: 'task_binding',
          bindingIds: Object.freeze(usage.taskBindings.map((item) => item.bindingId)),
        }),
      );
    steps.push(
      Object.freeze({
        stepId: 'evidence-gate',
        kind: 'evidence_gate',
        requirementIds: Object.freeze(
          usage.evidencePolicy.requirements
            .filter((item) => item.required)
            .map((item) => item.requirementId),
        ),
        rejectSuccessWithoutRequiredEvidence:
          usage.evidencePolicy.rejectSuccessWithoutRequiredEvidence,
      }),
    );
    if (steps.length + composition.consumedNodes > MAX_SKILL_USAGE_PLAN_NODES)
      throw usageCompositionError(
        'SKILL_USAGE_COMPOSITION_SIZE_EXCEEDED',
        'Procedure IR exceeds the shared node budget.',
      );
    return Object.freeze({
      kind: 'procedure',
      apiVersion: 'sdar.io/v1alpha1',
      skill: reference,
      instructions: Object.freeze([...descriptor.instructions]),
      steps: Object.freeze(steps),
      composition,
    });
  }

  async #requireExactCurrent(
    skillId: string,
    version: number,
    root: boolean,
  ): Promise<SkillVersion> {
    const [exact, current] = await Promise.all([
      this.#skills.findVersion(skillId, version),
      this.#skills.findCurrentVersion(skillId),
    ]);
    if (
      exact?.status !== 'enabled' ||
      current?.status !== 'enabled' ||
      exact.version !== current.version
    )
      throw usageCompositionError(
        root ? 'SKILL_COMPOSITION_ROOT_STALE' : 'SKILL_USAGE_COMPOSITION_VERSION_STALE',
        `Composition requires exact current enabled Skill ${skillId}@${String(version)}.`,
      );
    return exact;
  }

  async #requireCurrentEnabled(skillId: string): Promise<SkillVersion> {
    const current = await this.#skills.findCurrentVersion(skillId);
    if (current?.status !== 'enabled')
      throw usageCompositionError(
        'SKILL_COMPOSITION_RELATED_SKILL_UNAVAILABLE',
        `Related Skill ${skillId} is not current and enabled.`,
      );
    return current;
  }

  async #usageRelations(skillId: string): Promise<readonly SkillRelation[]> {
    const relations = await this.#graph.listRelationsFrom(
      skillId,
      INITIAL_COMPOSITION_RELATION_TYPES,
      MAX_SKILL_USAGE_PLAN_NODES + 1,
    );
    if (relations.length > MAX_SKILL_USAGE_PLAN_NODES)
      throw usageCompositionError(
        'SKILL_USAGE_COMPOSITION_SIZE_EXCEEDED',
        'Skill usage relation candidates exceed the shared node budget.',
      );
    return relations;
  }

  async #slotCandidates(
    parent: SkillVersion,
    slot: SkillCapabilitySlot,
    relations: readonly SkillRelation[],
  ): Promise<readonly SkillVersion[]> {
    return (await this.#skills.listEnabledVersions())
      .filter(
        (candidate) =>
          candidate.skillId !== parent.skillId &&
          candidate.capabilities.includes(slot.capability) &&
          (slot.candidateSkillIds.length === 0 ||
            slot.candidateSkillIds.includes(candidate.skillId)) &&
          hasUsageRelation(parent.skillId, candidate.skillId, relations, 'capability_slot') &&
          mappingsCompatible(
            parent,
            candidate,
            slot.inputMappings ?? [],
            slot.outputMappings ?? [],
          ),
      )
      .sort(
        (left, right) => left.skillId.localeCompare(right.skillId) || left.version - right.version,
      );
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
  | 'SKILL_COMPOSITION_SIZE_EXCEEDED'
  | 'SKILL_USAGE_COMPOSITION_CYCLE_DETECTED'
  | 'SKILL_USAGE_COMPOSITION_DEPTH_EXCEEDED'
  | 'SKILL_USAGE_COMPOSITION_DUPLICATE_EXPANSION'
  | 'SKILL_USAGE_COMPOSITION_RELATION_REQUIRED'
  | 'SKILL_USAGE_COMPOSITION_SIZE_EXCEEDED'
  | 'SKILL_USAGE_COMPOSITION_SLOT_CHOICE_INVALID'
  | 'SKILL_USAGE_COMPOSITION_SLOT_CHOICE_REQUIRED'
  | 'SKILL_USAGE_COMPOSITION_SLOT_UNRESOLVED'
  | 'SKILL_USAGE_COMPOSITION_VERSION_STALE'
  | 'SKILL_USAGE_MODE_BLOCKED'
  | 'SKILL_USAGE_MODE_INVALID'
  | 'SKILL_USAGE_REQUIRED';

export class SkillCompositionError extends Error {
  readonly code: SkillCompositionErrorCode;
  constructor(code: SkillCompositionErrorCode, message: string) {
    super(message);
    this.name = 'SkillCompositionError';
    this.code = code;
  }
}
