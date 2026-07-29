import { createHash } from 'node:crypto';

import {
  ARTIFACT_CONTRACT_VERSION,
  CANDIDATE_GENERATOR_VERSION,
  CANDIDATE_STATIC_VALIDATOR_VERSION,
  createArtifactLineage,
  createCandidateStaticValidationResult,
  createCompiledArtifact,
  type ArtifactApplicability,
  type ArtifactDependencySnapshot,
  type ArtifactLineage,
  type ArtifactScope,
  type CandidateStaticValidationResult,
  type CompiledArtifact,
  type CompletionContractTemplate,
  type CriterionTemplate,
  type GoalPatternTemplate,
  type PlanTemplateArtifactDefinition,
  type RecoveryBranchTemplate,
  type SkillGoalDependencyTemplate,
  type SkillGoalNodeTemplate,
  type TemplateParameterDefinition,
  type ValidationIssue,
} from '../../../domain/src/index.js';
import type {
  FusedPattern,
  GeneralizedPattern,
  SemanticPatternCandidate,
  StructuralPattern,
} from '../../../domain/src/index.js';

// ---------------------------------------------------------------------------
// Plan Template Compiler
// ---------------------------------------------------------------------------

export interface PlanTemplateCompilationInput {
  readonly generalizedPattern: GeneralizedPattern;
  readonly fusedPattern: FusedPattern;
  readonly knownCapabilityIds: readonly string[];
}

export class PlanTemplateCompiler {
  compile(input: PlanTemplateCompilationInput): PlanTemplateArtifactDefinition {
    const { generalizedPattern, fusedPattern } = input;
    const semantic = fusedPattern.semanticCandidate;
    const structural = fusedPattern.structuralPattern;

    const nodes = classifySteps(structural, semantic, input.knownCapabilityIds);
    const dependencies = compileDependencies(structural, nodes);
    const parameterSchema = compileParameterSchema(generalizedPattern);
    const parameterBindings = compileParameterBindings(generalizedPattern);
    const goalPattern = compileGoalPattern(generalizedPattern, structural);
    const completionContract = compileCompletionContract(generalizedPattern, structural);
    const recoveryBranches = compileRecoveryBranches(structural, nodes);

    const definition: PlanTemplateArtifactDefinition = Object.freeze({
      goalPattern,
      parameterSchema,
      parameterBindings,
      skillGoalGraph: Object.freeze({
        nodes: Object.freeze(nodes),
        dependencies: Object.freeze(dependencies),
      }),
      completionContractTemplate: completionContract,
      recoveryBranches: Object.freeze(recoveryBranches),
    });

    return definition;
  }
}

function classifySteps(
  structural: StructuralPattern,
  semantic: SemanticPatternCandidate,
  knownCapabilityIds: readonly string[],
): readonly SkillGoalNodeTemplate[] {
  const catalog = new Set(knownCapabilityIds);
  const baseNodes = structural.activityPatterns.map((activity, index) => {
    if (activity.activityKind === 'unknown') {
      throw new Error(`PLAN_TEMPLATE_ACTIVITY_IDENTITY_UNKNOWN:${activity.activityKey}`);
    }
    const nodeKey = `node_${String(index)}_${shortHash(activity.activityKey)}`;
    const nodeType = inferNodeType(activity.activityKind, activity.objectiveSummary);
    const capabilityMapping = semantic.capabilityMappings.find(
      (mapping) => mapping.sourceActivity === activity.activityKey,
    );
    const requiredCapabilities = uniqueSorted([
      ...activity.capabilityRefs,
      ...(capabilityMapping === undefined ? [] : [capabilityMapping.capabilityId]),
    ]);
    const forbiddenBinding = requiredCapabilities.find(isExactExternalBinding);
    if (forbiddenBinding !== undefined) {
      throw new Error(
        `PLAN_TEMPLATE_EXACT_BINDING_FORBIDDEN:${activity.activityKey}:${forbiddenBinding}`,
      );
    }
    const missing = requiredCapabilities.filter((capabilityId) => !catalog.has(capabilityId));
    if (missing.length > 0) {
      throw new Error(
        `PLAN_TEMPLATE_CAPABILITY_CATALOG_MISMATCH:${activity.activityKey}:${missing.join(',')}`,
      );
    }
    if (
      ['action', 'observation', 'recovery'].includes(nodeType) &&
      requiredCapabilities.length === 0
    ) {
      throw new Error(`PLAN_TEMPLATE_REQUIRED_CAPABILITY_MISSING:${activity.activityKey}`);
    }

    return Object.freeze({
      nodeKey,
      nodeType,
      objectiveTemplate: activity.objectiveSummary,
      requiredCapabilities: Object.freeze(requiredCapabilities),
      requiredEffectRefs: activity.effectRefs,
      coveredCriterionTemplateIds: Object.freeze(
        activity.required ? [`criterion_${shortHash(activity.activityKey)}`] : [],
      ),
      evidenceRequirements: Object.freeze([`evidence:${activity.activityKey}`]),
      artifactRequirements: Object.freeze([]),
      inputTemplate: null,
      assumptionsAllowed: Object.freeze([]),
      constraints: Object.freeze([`activity-key:${activity.activityKey}`]),
    });
  });
  const nodeByActivityKey = exactActivityNodeMap(structural, baseNodes);
  const parallelGroups = parallelGroupConstraints(structural, nodeByActivityKey);
  return Object.freeze(
    structural.activityPatterns.map((activity, index) => {
      const node = baseNodes[index];
      if (node === undefined) throw new Error('PLAN_TEMPLATE_NODE_INDEX_MISSING');
      return Object.freeze({
        ...node,
        constraints: Object.freeze([
          ...node.constraints,
          ...(parallelGroups.get(activity.activityKey) ?? []),
        ]),
      });
    }),
  );
}

function inferNodeType(
  activityKind: StructuralPattern['activityPatterns'][number]['activityKind'],
  objectiveSummary: string,
): SkillGoalNodeTemplate['nodeType'] {
  if (
    activityKind === 'observation' ||
    activityKind === 'verification' ||
    activityKind === 'reasoning' ||
    activityKind === 'human_gate'
  ) {
    return activityKind;
  }
  const lower = objectiveSummary.toLowerCase();
  if (lower.includes('verify') || lower.includes('check') || lower.includes('validate'))
    return 'verification';
  if (lower.includes('recover') || lower.includes('retry') || lower.includes('rollback'))
    return 'recovery';
  if (
    lower.includes('observe') ||
    lower.includes('sense') ||
    lower.includes('detect') ||
    lower.includes('scan')
  )
    return 'observation';
  if (
    lower.includes('reason') ||
    lower.includes('decide') ||
    lower.includes('plan') ||
    lower.includes('analyze')
  )
    return 'reasoning';
  if (
    lower.includes('approve') ||
    lower.includes('confirm') ||
    lower.includes('gate') ||
    lower.includes('review')
  )
    return 'human_gate';
  return 'action';
}

function compileDependencies(
  structural: StructuralPattern,
  nodes: readonly SkillGoalNodeTemplate[],
): readonly SkillGoalDependencyTemplate[] {
  const dependenciesByNodePair = new Map<string, SkillGoalDependencyTemplate>();
  const nodeByActivityKey = exactActivityNodeMap(structural, nodes);
  const relationsByUnorderedPair = new Map<
    string,
    Set<StructuralPattern['dependencyPatterns'][number]['relation']>
  >();
  for (const dependency of structural.dependencyPatterns) {
    const pair = unorderedActivityPairKey(
      dependency.predecessorActivityKey,
      dependency.successorActivityKey,
    );
    const relations = relationsByUnorderedPair.get(pair) ?? new Set();
    relations.add(dependency.relation);
    relationsByUnorderedPair.set(pair, relations);
  }
  for (const [pair, relations] of relationsByUnorderedPair) {
    if (relations.has('parallel') && [...relations].some((relation) => relation !== 'parallel')) {
      throw new Error(`PLAN_TEMPLATE_PARALLEL_DIRECT_CONFLICT:${pair}`);
    }
  }
  const parallelPairs = new Set(
    structural.dependencyPatterns
      .filter((dependency) => dependency.relation === 'parallel')
      .map((dependency) =>
        unorderedActivityPairKey(
          dependency.predecessorActivityKey,
          dependency.successorActivityKey,
        ),
      ),
  );
  const recoverySequencePairs = new Set(
    structural.recoveryPatterns.flatMap((recovery) =>
      recovery.activitySequence.slice(0, -1).flatMap((activityKey, index) => {
        const successor = recovery.activitySequence[index + 1];
        return successor === undefined ? [] : [`${activityKey}\u001f${successor}`];
      }),
    ),
  );
  for (const pattern of structural.dependencyPatterns) {
    const predecessor = nodeByActivityKey.get(pattern.predecessorActivityKey);
    const successor = nodeByActivityKey.get(pattern.successorActivityKey);
    if (predecessor === undefined || successor === undefined) {
      throw new Error(
        `PLAN_TEMPLATE_ACTIVITY_NODE_MISSING:${pattern.predecessorActivityKey}:${pattern.successorActivityKey}`,
      );
    }
    if (
      pattern.relation === 'parallel' ||
      predecessor.nodeKey === successor.nodeKey ||
      parallelPairs.has(
        unorderedActivityPairKey(pattern.predecessorActivityKey, pattern.successorActivityKey),
      ) ||
      recoverySequencePairs.has(
        `${pattern.predecessorActivityKey}\u001f${pattern.successorActivityKey}`,
      )
    ) {
      continue;
    }
    const dependencyKey = `dep_${predecessor.nodeKey}_${successor.nodeKey}`;
    const compiledDependency: SkillGoalDependencyTemplate =
      pattern.relation === 'conditional'
        ? Object.freeze({
            dependencyKey,
            predecessorNodeKey: predecessor.nodeKey,
            successorNodeKey: successor.nodeKey,
            predicate: 'optional',
            condition: requiredDependencyCondition(pattern),
          })
        : Object.freeze({
            dependencyKey,
            predecessorNodeKey: predecessor.nodeKey,
            successorNodeKey: successor.nodeKey,
            predicate: 'required',
          });
    const existing = dependenciesByNodePair.get(dependencyKey);
    if (existing === undefined) {
      dependenciesByNodePair.set(dependencyKey, compiledDependency);
    } else if (
      existing.predicate !== compiledDependency.predicate ||
      canonicalJson(existing.condition) !== canonicalJson(compiledDependency.condition)
    ) {
      throw new Error(
        `PLAN_TEMPLATE_DEPENDENCY_SEMANTICS_CONFLICT:${pattern.predecessorActivityKey}:${pattern.successorActivityKey}`,
      );
    }
  }
  for (const recovery of structural.recoveryPatterns) {
    const predecessor = nodeByActivityKey.get(recovery.triggerActivityKey);
    const targetActivityKey = recovery.activitySequence.find(
      (activityKey) => activityKey !== recovery.triggerActivityKey,
    );
    if (predecessor === undefined || targetActivityKey === undefined) {
      throw new Error(
        `PLAN_TEMPLATE_RECOVERY_CONDITIONAL_TARGET_MISSING:${recovery.triggerActivityKey}`,
      );
    }
    const successor = nodeByActivityKey.get(targetActivityKey);
    if (successor === undefined) {
      throw new Error(
        `PLAN_TEMPLATE_ACTIVITY_NODE_MISSING:${recovery.triggerActivityKey}:${targetActivityKey}`,
      );
    }
    const dependencyKey = `dep_${predecessor.nodeKey}_${successor.nodeKey}`;
    if (dependenciesByNodePair.has(dependencyKey)) {
      throw new Error(
        `PLAN_TEMPLATE_CONDITIONAL_EDGE_CONFLICT:${recovery.triggerActivityKey}:${targetActivityKey}`,
      );
    }
    dependenciesByNodePair.set(
      dependencyKey,
      Object.freeze({
        dependencyKey,
        predecessorNodeKey: predecessor.nodeKey,
        successorNodeKey: successor.nodeKey,
        predicate: 'optional',
        condition: recoveryCondition(recovery.triggerActivityKey),
      }),
    );
  }
  const dependencies = Object.freeze([...dependenciesByNodePair.values()]);
  for (const dependency of structural.dependencyPatterns) {
    if (dependency.relation !== 'parallel') continue;
    const left = nodeByActivityKey.get(dependency.predecessorActivityKey);
    const right = nodeByActivityKey.get(dependency.successorActivityKey);
    if (left === undefined || right === undefined) {
      throw new Error(
        `PLAN_TEMPLATE_ACTIVITY_NODE_MISSING:${dependency.predecessorActivityKey}:${dependency.successorActivityKey}`,
      );
    }
    if (
      hasDirectedPath(dependencies, left.nodeKey, right.nodeKey) ||
      hasDirectedPath(dependencies, right.nodeKey, left.nodeKey)
    ) {
      throw new Error(
        `PLAN_TEMPLATE_PARALLEL_ORDER_CONFLICT:${dependency.predecessorActivityKey}:${dependency.successorActivityKey}`,
      );
    }
  }
  return dependencies;
}

function unorderedActivityPairKey(left: string, right: string): string {
  return [left, right].sort().join('\u001f');
}

function requiredDependencyCondition(
  dependency: StructuralPattern['dependencyPatterns'][number],
): NonNullable<SkillGoalDependencyTemplate['condition']> {
  if (dependency.relation !== 'conditional' || dependency.condition === undefined) {
    throw new Error(
      `PLAN_TEMPLATE_CONDITIONAL_EXPRESSION_MISSING:${dependency.predecessorActivityKey}:${dependency.successorActivityKey}`,
    );
  }
  return dependency.condition;
}

function compileParameterSchema(
  generalized: GeneralizedPattern,
): PlanTemplateArtifactDefinition['parameterSchema'] {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const variable of generalized.variables) {
    properties[variable.variableName] = {
      ...(isRecord(variable.schema) ? variable.schema : { const: variable.schema }),
      'x-sdar-allowedSources': variable.allowedSources,
      'x-sdar-trustLevel': variable.trustLevel,
      'x-sdar-sourceField': variable.sourceField,
      'x-sdar-domainClass': variable.domainClass,
    };
    if (variable.required) required.push(variable.variableName);
  }
  const schema: Record<string, unknown> = { type: 'object', properties };
  if (required.length > 0) schema['required'] = required;
  return schema as PlanTemplateArtifactDefinition['parameterSchema'];
}

function compileParameterBindings(
  generalized: GeneralizedPattern,
): readonly TemplateParameterDefinition[] {
  return Object.freeze(
    generalized.variables.map((variable) =>
      Object.freeze({
        parameterName: variable.variableName,
        schema: variable.schema,
        required: variable.required,
        allowedSources: preferredParameterSource(variable.allowedSources),
        trustLevel: variable.trustLevel,
        defaultPolicy: parameterDefaultPolicy(variable.schema),
      }),
    ),
  );
}

function compileGoalPattern(
  generalized: GeneralizedPattern,
  structural: StructuralPattern,
): GoalPatternTemplate {
  const criteria: CriterionTemplate[] = structural.activityPatterns
    .filter((a) => a.required)
    .map((a) =>
      Object.freeze({
        criterionTemplateId: `criterion_${shortHash(a.activityKey)}`,
        statementTemplate: `${a.objectiveSummary} must be completed`,
        required: true,
      }),
    );
  return Object.freeze({
    objectiveTemplate: `Achieve goal for task type ${structural.taskTypeId}`,
    criterionTemplates: Object.freeze(criteria),
  });
}

function compileCompletionContract(
  generalized: GeneralizedPattern,
  structural: StructuralPattern,
): CompletionContractTemplate {
  return Object.freeze({
    titleTemplate: `Completion: ${structural.taskTypeId}`,
    descriptionTemplate: `Verify all mandatory activities completed for ${structural.taskTypeId}`,
    criteria: Object.freeze(
      structural.activityPatterns
        .filter((a) => a.required)
        .map((a) =>
          Object.freeze({
            criterionTemplateId: `criterion_${shortHash(a.activityKey)}`,
            statementTemplate: `${a.objectiveSummary} evidence recorded`,
            required: true,
          }),
        ),
    ),
    evidenceRequirements: Object.freeze(
      structural.activityPatterns.map((a) => `evidence:${a.activityKey}`),
    ),
    artifactRequirements: Object.freeze([]),
  });
}

function compileRecoveryBranches(
  structural: StructuralPattern,
  nodes: readonly SkillGoalNodeTemplate[],
): readonly RecoveryBranchTemplate[] {
  const nodeByActivityKey = exactActivityNodeMap(structural, nodes);
  return Object.freeze(
    structural.recoveryPatterns.map((recovery) => {
      for (const activityKey of [
        recovery.triggerActivityKey,
        ...(recovery.resumeActivityKey === undefined ? [] : [recovery.resumeActivityKey]),
        ...recovery.activitySequence,
      ]) {
        if (!nodeByActivityKey.has(activityKey)) {
          throw new Error(`PLAN_TEMPLATE_RECOVERY_ACTIVITY_NODE_MISSING:${activityKey}`);
        }
      }
      const forbiddenBinding = recovery.requiredCapabilityRefs.find(isExactExternalBinding);
      if (forbiddenBinding !== undefined) {
        throw new Error(
          `PLAN_TEMPLATE_EXACT_BINDING_FORBIDDEN:${recovery.triggerActivityKey}:${forbiddenBinding}`,
        );
      }
      return Object.freeze({
        trigger: recoveryCondition(recovery.triggerActivityKey),
        requiredCapabilities: recovery.requiredCapabilityRefs,
        planPatchTemplate: Object.freeze({
          triggerActivityKey: recovery.triggerActivityKey,
          ...(recovery.resumeActivityKey === undefined
            ? {}
            : { resumeActivityKey: recovery.resumeActivityKey }),
          activitySequence: recovery.activitySequence,
        }),
        maximumApplications: 1,
        sideEffectReplayPolicy: 'forbidden' as const,
      });
    }),
  );
}

function recoveryCondition(
  triggerActivityKey: string,
): NonNullable<SkillGoalDependencyTemplate['condition']> {
  return Object.freeze({
    type: 'atomic' as const,
    field: `runtime.failure.${shortHash(triggerActivityKey)}`,
    operator: 'eq' as const,
    value: true,
  });
}

function exactActivityNodeMap(
  structural: StructuralPattern,
  nodes: readonly SkillGoalNodeTemplate[],
): ReadonlyMap<string, SkillGoalNodeTemplate> {
  if (structural.activityPatterns.length !== nodes.length) {
    throw new Error('PLAN_TEMPLATE_ACTIVITY_NODE_CARDINALITY_MISMATCH');
  }
  const result = new Map<string, SkillGoalNodeTemplate>();
  for (const [index, activity] of structural.activityPatterns.entries()) {
    const node = nodes[index];
    if (node === undefined) throw new Error('PLAN_TEMPLATE_ACTIVITY_NODE_INDEX_MISSING');
    if (result.has(activity.activityKey)) {
      throw new Error(`PLAN_TEMPLATE_ACTIVITY_KEY_DUPLICATE:${activity.activityKey}`);
    }
    result.set(activity.activityKey, node);
  }
  return result;
}

function parallelGroupConstraints(
  structural: StructuralPattern,
  nodeByActivityKey: ReadonlyMap<string, SkillGoalNodeTemplate>,
): ReadonlyMap<string, readonly string[]> {
  const constraints = new Map<string, string[]>();
  for (const dependency of structural.dependencyPatterns) {
    if (
      !nodeByActivityKey.has(dependency.predecessorActivityKey) ||
      !nodeByActivityKey.has(dependency.successorActivityKey)
    ) {
      throw new Error(
        `PLAN_TEMPLATE_ACTIVITY_NODE_MISSING:${dependency.predecessorActivityKey}:${dependency.successorActivityKey}`,
      );
    }
    if (dependency.relation === 'parallel') {
      const groupId = shortHash(
        [dependency.predecessorActivityKey, dependency.successorActivityKey].sort().join('\u001f'),
      );
      for (const activityKey of [
        dependency.predecessorActivityKey,
        dependency.successorActivityKey,
      ]) {
        const current = constraints.get(activityKey) ?? [];
        current.push(`parallel-group:${groupId}`);
        constraints.set(activityKey, current);
      }
    } else if (dependency.predecessorActivityKey === dependency.successorActivityKey) {
      const current = constraints.get(dependency.predecessorActivityKey) ?? [];
      current.push(`repeat-evidence:${dependency.predecessorActivityKey}`);
      constraints.set(dependency.predecessorActivityKey, current);
    }
  }
  return new Map(
    [...constraints.entries()].map(([activityKey, values]) => [activityKey, uniqueSorted(values)]),
  );
}

function preferredParameterSource(
  sources: GeneralizedPattern['variables'][number]['allowedSources'],
): TemplateParameterDefinition['allowedSources'] {
  const preference: readonly TemplateParameterDefinition['allowedSources'][] = [
    'user_confirmed',
    'request',
    'world_state',
    'runtime_context',
    'small_model_candidate',
  ];
  const selected = preference.find((source) => sources.includes(source));
  if (selected === undefined) throw new Error('PLAN_TEMPLATE_PARAMETER_SOURCE_MISSING');
  return selected;
}

function parameterDefaultPolicy(
  schema: GeneralizedPattern['variables'][number]['schema'],
): TemplateParameterDefinition['defaultPolicy'] {
  const value = isRecord(schema) ? schema['x-sdar-defaultPolicy'] : undefined;
  if (value === 'none' || value === 'low_risk_only') return value;
  throw new Error('PLAN_TEMPLATE_PARAMETER_DEFAULT_POLICY_MISSING');
}

function isExactExternalBinding(capabilityId: string): boolean {
  return /^(?:skill|provider|mcp):/u.test(capabilityId);
}

function requiredSingleUserScope(sourceUserScopeIds: readonly string[]): string {
  if (sourceUserScopeIds.length !== 1 || sourceUserScopeIds[0] === undefined) {
    throw new Error('PLAN_TEMPLATE_SINGLE_USER_SCOPE_UNRESOLVED');
  }
  return sourceUserScopeIds[0];
}

function shortHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Candidate Fingerprint
// ---------------------------------------------------------------------------

export function candidateFingerprint(input: {
  readonly artifactType: string;
  readonly domain: string;
  readonly taskTypeId: string;
  readonly generalizedDefinitionHash: string;
  readonly applicabilityHash: string;
  readonly requiredCapabilityShapeHash: string;
  readonly generatorVersion: string;
}): string {
  return createHash('sha256')
    .update(
      [
        input.artifactType,
        input.domain,
        input.taskTypeId,
        input.generalizedDefinitionHash,
        input.applicabilityHash,
        input.requiredCapabilityShapeHash,
        input.generatorVersion,
      ].join(':'),
      'utf8',
    )
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Candidate Generator
// ---------------------------------------------------------------------------

export interface CandidateGenerationInput {
  readonly generalizedPattern: GeneralizedPattern;
  readonly fusedPattern: FusedPattern;
  readonly knownCapabilityIds: readonly string[];
  readonly sourceEpisodeRefs: readonly string[];
  readonly sourceCorrectionRefs: readonly string[];
  readonly sourceUserScopeIds?: readonly string[];
  readonly existingFingerprints?: readonly string[];
  readonly tenantId?: string;
  readonly createdAt: string;
}

export interface GeneratedCandidate {
  readonly artifact: CompiledArtifact;
  readonly lineage: ArtifactLineage;
  readonly fingerprint: string;
  readonly validation: CandidateStaticValidationResult;
}

export class ArtifactCandidateGenerator {
  readonly #compiler = new PlanTemplateCompiler();
  readonly #validator = new CandidateStaticValidator();

  generate(input: CandidateGenerationInput): GeneratedCandidate {
    const { generalizedPattern, fusedPattern } = input;
    const definition = this.#compiler.compile({
      generalizedPattern,
      fusedPattern,
      knownCapabilityIds: input.knownCapabilityIds,
    });

    const sourceUserScopeIds = uniqueSorted(input.sourceUserScopeIds ?? []);
    const singleUserScope =
      fusedPattern.applicabilityCandidate.userScope === 'single'
        ? requiredSingleUserScope(sourceUserScopeIds)
        : undefined;
    const artifactKey = `plan_template:${fusedPattern.applicabilityCandidate.domain}:${generalizedPattern.taskTypeId}${
      singleUserScope === undefined ? '' : `:user:${shortHash(singleUserScope)}`
    }`;
    const artifactId = `artifact-${createHash('sha256')
      .update(artifactKey + ':' + generalizedPattern.contentHash, 'utf8')
      .digest('hex')
      .slice(0, 16)}`;
    const contentHash = hashJson(definition);

    const scope: ArtifactScope = Object.freeze({
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
      domain: fusedPattern.applicabilityCandidate.domain,
      taskTypeIds: Object.freeze([generalizedPattern.taskTypeId]),
    });

    const applicability: ArtifactApplicability = Object.freeze({
      requiredConditions: Object.freeze([
        ...generalizedPattern.applicabilityPredicates.map((predicate) =>
          Object.freeze({
            type: 'atomic' as const,
            field: predicate.field,
            operator: predicate.operator,
            ...(predicate.value === undefined ? {} : { value: predicate.value }),
          }),
        ),
        ...(singleUserScope === undefined
          ? []
          : [
              Object.freeze({
                type: 'atomic' as const,
                field: 'request.userId',
                operator: 'eq' as const,
                value: singleUserScope,
              }),
            ]),
      ]),
      optionalConditions: Object.freeze([]),
      forbiddenConditions: Object.freeze([...generalizedPattern.forbiddenConditions]),
      requiredParameters: Object.freeze(
        generalizedPattern.variables.filter((v) => v.required).map((v) => v.variableName),
      ),
      allowedEnvironmentClasses: Object.freeze(
        fusedPattern.applicabilityCandidate.environmentClasses,
      ),
      excludedEnvironmentClasses: Object.freeze([]),
      minimumIntentScore: 0,
      minimumConditionScore: 0,
      maximumUncertainty: 1,
      outOfDistributionPolicy: 'require_confirmation',
    });

    const dependencySnapshot: ArtifactDependencySnapshot = Object.freeze({
      capabilityCatalogHash: hashJson(input.knownCapabilityIds.slice().sort()),
      policyVersionRefs: Object.freeze([]),
      taskTypeVersionRefs: Object.freeze([generalizedPattern.taskTypeId]),
      schemaVersionRefs: Object.freeze([ARTIFACT_CONTRACT_VERSION]),
      requiredSkillVersionRefs: Object.freeze([]),
      compilerVersion: CANDIDATE_GENERATOR_VERSION,
    });

    const lineageId = `lineage-${createHash('sha256').update(artifactId, 'utf8').digest('hex').slice(0, 16)}`;

    const requiredCapabilities = uniqueSorted(
      definition.skillGoalGraph.nodes.flatMap((node) => node.requiredCapabilities),
    );
    const artifact = createCompiledArtifact({
      artifactId,
      artifactKey,
      version: 1,
      artifactType: 'plan_template',
      name: `Plan Template Candidate for ${generalizedPattern.taskTypeId}`,
      description: fusedPattern.semanticCandidate.explanation,
      scope,
      definition,
      applicability,
      requiredCapabilities: Object.freeze(
        requiredCapabilities.map((capabilityId) => ({ capabilityId })),
      ),
      requiredPolicies: Object.freeze([]),
      dependencySnapshot,
      riskLevel: 'medium',
      status: 'candidate',
      lineageRef: lineageId,
      contentHash,
      createdAt: input.createdAt,
    });

    const lineage = createArtifactLineage({
      lineageId,
      artifactId,
      artifactVersion: 1,
      sourceEpisodeRefs: Object.freeze([...input.sourceEpisodeRefs]),
      sourceKnowledgeRefs: Object.freeze([]),
      sourceCorrectionRefs: Object.freeze([...input.sourceCorrectionRefs]),
      sourcePatternRefs: Object.freeze([
        fusedPattern.sourceWorkflowPatternRef,
        fusedPattern.sourceProcessPatternRef,
        ...fusedPattern.sourceTraceRefs,
        fusedPattern.fusedPatternId,
        generalizedPattern.generalizedPatternId,
      ]),
      generationMethods: Object.freeze(
        fusedPattern.semanticCandidate.modelInvocationRef === undefined
          ? (['process_mining'] as const)
          : (['process_mining', 'model_assisted_generalization'] as const),
      ),
      validationRunRefs: Object.freeze([]),
      supersedesArtifactRefs: Object.freeze([]),
    });

    const fingerprint = candidateFingerprint({
      artifactType: 'plan_template',
      domain: fusedPattern.applicabilityCandidate.domain,
      taskTypeId: generalizedPattern.taskTypeId,
      generalizedDefinitionHash: hashJson({
        domain: generalizedPattern.domain,
        taskTypeId: generalizedPattern.taskTypeId,
        variables: generalizedPattern.variables,
        invariants: generalizedPattern.invariants,
        requiredConditions: generalizedPattern.requiredConditions,
        forbiddenConditions: generalizedPattern.forbiddenConditions,
        applicabilityPredicates: generalizedPattern.applicabilityPredicates,
        failureBoundaries: generalizedPattern.failureBoundaries,
      }),
      applicabilityHash: hashJson(applicability),
      requiredCapabilityShapeHash: hashJson({
        nodes: definition.skillGoalGraph.nodes
          .map((node) => ({
            nodeType: node.nodeType,
            requiredCapabilities: [...node.requiredCapabilities].sort(),
          }))
          .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
        recovery: definition.recoveryBranches.map((branch) =>
          [...branch.requiredCapabilities].sort(),
        ),
      }),
      generatorVersion: CANDIDATE_GENERATOR_VERSION,
    });

    const validation = this.#validator.validate({
      artifact,
      lineage,
      generalizedPattern,
      fusedPattern,
      knownCapabilityIds: input.knownCapabilityIds,
      fingerprint,
      ...(input.existingFingerprints === undefined
        ? {}
        : { existingFingerprints: input.existingFingerprints }),
    });

    return Object.freeze({ artifact, lineage, fingerprint, validation });
  }
}

// ---------------------------------------------------------------------------
// Static Validator
// ---------------------------------------------------------------------------

export interface StaticValidationInput {
  readonly artifact: CompiledArtifact;
  readonly lineage: ArtifactLineage;
  readonly generalizedPattern: GeneralizedPattern;
  readonly fusedPattern: FusedPattern;
  readonly knownCapabilityIds: readonly string[];
  readonly fingerprint: string;
  readonly existingFingerprints?: readonly string[];
}

export class CandidateStaticValidator {
  validate(input: StaticValidationInput): CandidateStaticValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const schemaValid = validateSchema(input.artifact, errors);
    const activityIdentityValid = validateActivityIdentity(input.artifact, errors);
    const dagValid = validateDag(input.artifact, errors);
    const parallelSemanticsValid = validateParallelSemantics(input.artifact, errors);
    const requiredCriteriaCovered = validateCriteriaCoverage(input.artifact, errors);
    const capabilityShapeValid = validateCapabilityShape(input.artifact, errors, warnings);
    const capabilityCatalogAligned = validateCapabilityCatalog(
      input.artifact,
      input.knownCapabilityIds,
      errors,
    );
    const parameterPolicyValid = validateParameterPolicy(input.artifact, errors);
    const parameterSchemaAligned = validateParameterSchemaAlignment(input.artifact, errors);
    const applicabilityEvaluable = validateApplicability(input.artifact, errors);
    const lineageComplete = validateLineage(
      input.lineage,
      input.fusedPattern,
      input.generalizedPattern,
      errors,
    );
    const recoverySemanticsValid = validateRecoverySemantics(
      input.artifact,
      input.generalizedPattern,
      errors,
    );
    const sideEffectReplaySafe = validateReplaySafety(input.artifact, errors);
    const boundsValid = validateBounds(input.artifact, errors);

    let duplicateFingerprint: string | undefined;
    const existing = input.existingFingerprints ?? [];
    if (existing.includes(input.fingerprint)) {
      duplicateFingerprint = input.fingerprint;
      errors.push({
        code: 'DUPLICATE_FINGERPRINT',
        message: 'A candidate with the same fingerprint already exists',
      });
    }

    const result =
      errors.length === 0 &&
      schemaValid &&
      activityIdentityValid &&
      dagValid &&
      parallelSemanticsValid &&
      requiredCriteriaCovered &&
      capabilityShapeValid &&
      capabilityCatalogAligned &&
      parameterPolicyValid &&
      parameterSchemaAligned &&
      applicabilityEvaluable &&
      lineageComplete &&
      recoverySemanticsValid &&
      sideEffectReplaySafe &&
      boundsValid &&
      duplicateFingerprint === undefined
        ? 'passed_static'
        : 'failed_static';

    return createCandidateStaticValidationResult({
      artifactRef: input.artifact.artifactId,
      schemaValid,
      activityIdentityValid,
      dagValid,
      parallelSemanticsValid,
      requiredCriteriaCovered,
      capabilityShapeValid,
      capabilityCatalogAligned,
      parameterPolicyValid,
      parameterSchemaAligned,
      applicabilityEvaluable,
      lineageComplete,
      recoverySemanticsValid,
      sideEffectReplaySafe,
      boundsValid,
      ...(duplicateFingerprint === undefined ? {} : { duplicateFingerprint }),
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
      validatorVersion: CANDIDATE_STATIC_VALIDATOR_VERSION,
      result,
    });
  }
}

function getPlanTemplateDefinition(
  artifact: CompiledArtifact,
): PlanTemplateArtifactDefinition | undefined {
  if (artifact.artifactType !== 'plan_template') return undefined;
  return artifact.definition as PlanTemplateArtifactDefinition;
}

function validateSchema(artifact: CompiledArtifact, errors: ValidationIssue[]): boolean {
  if (artifact.status !== 'candidate') {
    errors.push({ code: 'STATUS_NOT_CANDIDATE', message: 'Candidate status must be candidate' });
  }
  const def = getPlanTemplateDefinition(artifact);
  if (def === undefined) {
    errors.push({ code: 'DEFINITION_TYPE_INVALID', message: 'Expected plan_template definition' });
    return false;
  }
  return true;
}

function validateActivityIdentity(artifact: CompiledArtifact, errors: ValidationIssue[]): boolean {
  const def = getPlanTemplateDefinition(artifact);
  if (def === undefined) return false;
  const keys = new Set<string>();
  for (const node of def.skillGoalGraph.nodes) {
    const constraints = node.constraints.filter((value) => value.startsWith('activity-key:'));
    if (constraints.length !== 1) {
      errors.push({
        code: 'ACTIVITY_IDENTITY_MISSING',
        message: `Node ${node.nodeKey} must carry exactly one Activity key`,
      });
      continue;
    }
    const activityKey = constraints[0]?.slice('activity-key:'.length) ?? '';
    if (
      activityKey.length === 0 ||
      [
        'goal_created',
        'plan_created',
        'skill_attempt_started',
        'skill_attempt_completed',
        'goal_completed',
      ].includes(activityKey)
    ) {
      errors.push({
        code: 'ACTIVITY_IDENTITY_LIFECYCLE_ALIAS',
        message: `Node ${node.nodeKey} uses a lifecycle event as Activity identity`,
      });
    }
    if (keys.has(activityKey)) {
      errors.push({
        code: 'ACTIVITY_IDENTITY_DUPLICATE',
        message: `Activity key ${activityKey} maps to multiple nodes`,
      });
    }
    keys.add(activityKey);
  }
  return !errors.some((error) => error.code.startsWith('ACTIVITY_IDENTITY_'));
}

function validateDag(artifact: CompiledArtifact, errors: ValidationIssue[]): boolean {
  const def = getPlanTemplateDefinition(artifact);
  if (def === undefined) return false;
  const { nodes, dependencies } = def.skillGoalGraph;
  const nodeKeys = new Set(nodes.map((n) => n.nodeKey));

  for (const dep of dependencies) {
    if (!nodeKeys.has(dep.predecessorNodeKey))
      errors.push({
        code: 'DAG_ORPHAN_PREDECESSOR',
        message: `Dangling predecessor: ${dep.predecessorNodeKey}`,
      });
    if (!nodeKeys.has(dep.successorNodeKey))
      errors.push({
        code: 'DAG_ORPHAN_SUCCESSOR',
        message: `Dangling successor: ${dep.successorNodeKey}`,
      });
  }

  if (hasCycle(nodes, dependencies)) {
    errors.push({ code: 'DAG_CYCLE', message: 'Skill goal graph contains a cycle' });
    return false;
  }
  return errors.filter((e) => e.code.startsWith('DAG_')).length === 0;
}

function validateParallelSemantics(artifact: CompiledArtifact, errors: ValidationIssue[]): boolean {
  const def = getPlanTemplateDefinition(artifact);
  if (def === undefined) return false;
  const groupMembers = new Map<string, Set<string>>();
  for (const node of def.skillGoalGraph.nodes) {
    for (const constraint of node.constraints) {
      if (!constraint.startsWith('parallel-group:')) continue;
      const groupId = constraint.slice('parallel-group:'.length);
      const members = groupMembers.get(groupId) ?? new Set<string>();
      members.add(node.nodeKey);
      groupMembers.set(groupId, members);
    }
  }
  for (const [groupId, members] of groupMembers) {
    if (groupId.length === 0 || members.size < 2) {
      errors.push({
        code: 'PARALLEL_GROUP_INVALID',
        message: `Parallel group ${groupId} requires at least two nodes`,
      });
      continue;
    }
    const orderedMembers = [...members].sort();
    for (const [index, left] of orderedMembers.entries()) {
      for (const right of orderedMembers.slice(index + 1)) {
        if (
          hasDirectedPath(def.skillGoalGraph.dependencies, left, right) ||
          hasDirectedPath(def.skillGoalGraph.dependencies, right, left)
        ) {
          errors.push({
            code: 'PARALLEL_ORDER_PATH_CONFLICT',
            message: `Parallel group ${groupId} contains an ordered path between ${left} and ${right}`,
          });
        }
      }
    }
  }
  for (const dependency of def.skillGoalGraph.dependencies) {
    if (dependency.predicate === 'optional' && dependency.condition === undefined) {
      errors.push({
        code: 'PARALLEL_DOWNGRADED_TO_OPTIONAL',
        message: `Optional dependency ${dependency.dependencyKey} lacks a condition`,
      });
    }
  }
  return !errors.some(
    (error) =>
      error.code === 'PARALLEL_GROUP_INVALID' ||
      error.code === 'PARALLEL_DOWNGRADED_TO_OPTIONAL' ||
      error.code === 'PARALLEL_ORDER_PATH_CONFLICT',
  );
}

function hasDirectedPath(
  dependencies: readonly SkillGoalDependencyTemplate[],
  from: string,
  to: string,
): boolean {
  const outgoing = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const next = outgoing.get(dependency.predecessorNodeKey) ?? [];
    next.push(dependency.successorNodeKey);
    outgoing.set(dependency.predecessorNodeKey, next);
  }
  const pending = [from];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    if (current === to) return true;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

function hasCycle(
  nodes: readonly SkillGoalNodeTemplate[],
  dependencies: readonly SkillGoalDependencyTemplate[],
): boolean {
  const adj = new Map<string, string[]>();
  for (const node of nodes) adj.set(node.nodeKey, []);
  for (const dep of dependencies) {
    const list = adj.get(dep.predecessorNodeKey);
    if (list !== undefined) list.push(dep.successorNodeKey);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(key: string): boolean {
    if (stack.has(key)) return true;
    if (visited.has(key)) return false;
    visited.add(key);
    stack.add(key);
    for (const next of adj.get(key) ?? []) if (dfs(next)) return true;
    stack.delete(key);
    return false;
  }
  for (const node of nodes) if (dfs(node.nodeKey)) return true;
  return false;
}

function validateCriteriaCoverage(artifact: CompiledArtifact, errors: ValidationIssue[]): boolean {
  const def = getPlanTemplateDefinition(artifact);
  if (def === undefined) return false;
  const requiredCriteria = def.goalPattern.criterionTemplates.filter((c) => c.required);
  if (requiredCriteria.length === 0) return true;
  const covered = new Set<string>();
  for (const node of def.skillGoalGraph.nodes)
    for (const id of node.coveredCriterionTemplateIds) covered.add(id);
  for (const criterion of requiredCriteria)
    if (!covered.has(criterion.criterionTemplateId))
      errors.push({
        code: 'CRITERION_UNCOVERED',
        message: `Required criterion ${criterion.criterionTemplateId} is not covered by any node`,
      });
  return errors.filter((e) => e.code === 'CRITERION_UNCOVERED').length === 0;
}

function validateCapabilityShape(
  artifact: CompiledArtifact,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): boolean {
  const def = getPlanTemplateDefinition(artifact);
  if (def === undefined) return false;
  let valid = true;
  for (const node of def.skillGoalGraph.nodes) {
    if (node.requiredCapabilities.length === 0 && node.nodeType !== 'human_gate') {
      warnings.push({
        code: 'CAPABILITY_EMPTY',
        message: `Node ${node.nodeKey} has no required capabilities`,
      });
    }
    const forbiddenBinding = node.requiredCapabilities.find(isExactExternalBinding);
    if (forbiddenBinding !== undefined) {
      errors.push({
        code: 'EXACT_EXTERNAL_BINDING',
        message: `Node ${node.nodeKey} binds forbidden exact Skill/Provider/MCP ID ${forbiddenBinding}`,
      });
      valid = false;
    }
  }
  for (const branch of def.recoveryBranches) {
    const forbiddenBinding = branch.requiredCapabilities.find(isExactExternalBinding);
    if (forbiddenBinding !== undefined) {
      errors.push({
        code: 'EXACT_EXTERNAL_BINDING',
        message: `Recovery branch binds forbidden exact Skill/Provider/MCP ID ${forbiddenBinding}`,
      });
      valid = false;
    }
  }
  return valid;
}

function validateCapabilityCatalog(
  artifact: CompiledArtifact,
  knownCapabilityIds: readonly string[],
  errors: ValidationIssue[],
): boolean {
  const catalog = new Set(knownCapabilityIds);
  const def = getPlanTemplateDefinition(artifact);
  if (def === undefined) return false;
  const required = uniqueSorted([
    ...artifact.requiredCapabilities.map((capability) => capability.capabilityId),
    ...def.skillGoalGraph.nodes.flatMap((node) => node.requiredCapabilities),
    ...def.recoveryBranches.flatMap((branch) => branch.requiredCapabilities),
  ]);
  for (const capabilityId of required) {
    if (catalog.has(capabilityId)) continue;
    errors.push({
      code: 'CAPABILITY_CATALOG_MISSING',
      message: `Capability ${capabilityId} is absent from the current Catalog`,
    });
  }
  return !errors.some((error) => error.code === 'CAPABILITY_CATALOG_MISSING');
}

function validateParameterPolicy(artifact: CompiledArtifact, errors: ValidationIssue[]): boolean {
  const def = getPlanTemplateDefinition(artifact);
  if (def === undefined) return false;
  for (const param of def.parameterBindings) {
    if (param.trustLevel === 'authoritative' && param.allowedSources === 'small_model_candidate') {
      errors.push({
        code: 'PARAMETER_TRUST_INVALID',
        message: `Parameter ${param.parameterName} cannot be authoritative from small_model_candidate`,
      });
    }
  }
  return errors.filter((e) => e.code === 'PARAMETER_TRUST_INVALID').length === 0;
}

function validateParameterSchemaAlignment(
  artifact: CompiledArtifact,
  errors: ValidationIssue[],
): boolean {
  const def = getPlanTemplateDefinition(artifact);
  if (def === undefined || !isRecord(def.parameterSchema)) return false;
  const properties = def.parameterSchema['properties'];
  if (!isRecord(properties)) return def.parameterBindings.length === 0;
  const requiredParameters = new Set(
    Array.isArray(def.parameterSchema['required'])
      ? def.parameterSchema['required'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [],
  );
  for (const binding of def.parameterBindings) {
    const schema = properties[binding.parameterName];
    if (!isRecord(schema)) {
      errors.push({
        code: 'PARAMETER_SCHEMA_MISSING',
        message: `Parameter ${binding.parameterName} has no schema`,
      });
      continue;
    }
    const allowedSources = schema['x-sdar-allowedSources'];
    const trustLevel = schema['x-sdar-trustLevel'];
    const defaultPolicy = schema['x-sdar-defaultPolicy'];
    const sourceField = schema['x-sdar-sourceField'];
    const domainClass = schema['x-sdar-domainClass'];
    if (
      !Array.isArray(allowedSources) ||
      !allowedSources.includes(binding.allowedSources) ||
      trustLevel !== binding.trustLevel ||
      defaultPolicy !== binding.defaultPolicy ||
      typeof sourceField !== 'string' ||
      sourceField.length === 0 ||
      typeof domainClass !== 'string' ||
      domainClass.length === 0 ||
      requiredParameters.has(binding.parameterName) !== binding.required
    ) {
      errors.push({
        code: 'PARAMETER_SCHEMA_POLICY_DRIFT',
        message: `Parameter ${binding.parameterName} schema/source/trust/default policy drifted during compilation`,
      });
    }
  }
  return !errors.some((error) => error.code.startsWith('PARAMETER_SCHEMA_'));
}

function validateApplicability(artifact: CompiledArtifact, errors: ValidationIssue[]): boolean {
  const allowedRoots = new Set([
    'request',
    'goal',
    'world',
    'runtime',
    'authorization',
    'policy',
    'capability',
    'readiness',
    'environment',
    'device',
  ]);
  const visit = (condition: ArtifactApplicability['requiredConditions'][number]): void => {
    if (condition.type === 'atomic') {
      const root = condition.field.split('.')[0] ?? '';
      if (!allowedRoots.has(root)) {
        errors.push({
          code: 'APPLICABILITY_FIELD_UNEVALUABLE',
          message: `Applicability field ${condition.field} is not runtime-evaluable`,
        });
      }
      return;
    }
    if (condition.type === 'not') visit(condition.child);
    else for (const child of condition.children) visit(child);
  };
  for (const condition of [
    ...artifact.applicability.requiredConditions,
    ...artifact.applicability.optionalConditions,
    ...artifact.applicability.forbiddenConditions,
  ]) {
    visit(condition);
  }
  return !errors.some((error) => error.code === 'APPLICABILITY_FIELD_UNEVALUABLE');
}

function validateLineage(
  lineage: ArtifactLineage,
  fusedPattern: FusedPattern,
  generalizedPattern: GeneralizedPattern,
  errors: ValidationIssue[],
): boolean {
  if (lineage.sourceEpisodeRefs.length === 0) {
    errors.push({
      code: 'LINEAGE_EPISODE_MISSING',
      message: 'Candidate lineage must resolve to a formal Episode',
    });
  }
  const expectedPatternRefs = uniqueSorted([
    fusedPattern.sourceWorkflowPatternRef,
    fusedPattern.sourceProcessPatternRef,
    ...fusedPattern.sourceTraceRefs,
    fusedPattern.fusedPatternId,
    generalizedPattern.generalizedPatternId,
  ]);
  if (
    canonicalJson(uniqueSorted(lineage.sourcePatternRefs)) !== canonicalJson(expectedPatternRefs)
  ) {
    errors.push({
      code: 'LINEAGE_PATTERN_TRACE_INCOMPLETE',
      message:
        'Candidate lineage must exactly retain Workflow/Process/Fused/Generalized Pattern and Trace references',
    });
  }
  if (generalizedPattern.sourceFusedPatternRef !== fusedPattern.fusedPatternId) {
    errors.push({
      code: 'LINEAGE_FUSED_PATTERN_DRIFT',
      message: 'Generalized Pattern does not resolve to the source FusedPattern',
    });
  }
  return !errors.some((error) => error.code.startsWith('LINEAGE_'));
}

function validateRecoverySemantics(
  artifact: CompiledArtifact,
  generalizedPattern: GeneralizedPattern,
  errors: ValidationIssue[],
): boolean {
  const def = getPlanTemplateDefinition(artifact);
  if (def === undefined) return false;
  if (def.recoveryBranches.length !== generalizedPattern.failureBoundaries.length) {
    errors.push({
      code: 'RECOVERY_BOUNDARY_CARDINALITY_DRIFT',
      message: 'Recovery branch count does not match preserved failure boundaries',
    });
    return false;
  }
  const activityNodeByKey = new Map<string, string>();
  for (const node of def.skillGoalGraph.nodes) {
    const activityConstraint = node.constraints.find((value) => value.startsWith('activity-key:'));
    if (activityConstraint !== undefined) {
      activityNodeByKey.set(activityConstraint.slice('activity-key:'.length), node.nodeKey);
    }
  }
  for (const boundary of generalizedPattern.failureBoundaries) {
    for (const activityKey of [
      boundary.triggerActivityKey,
      ...(boundary.resumeActivityKey === undefined ? [] : [boundary.resumeActivityKey]),
      ...boundary.activitySequence,
    ]) {
      if (!activityNodeByKey.has(activityKey)) {
        errors.push({
          code: 'RECOVERY_ACTIVITY_NODE_MISSING',
          message: `Recovery activity ${activityKey} does not resolve to a compiled graph node`,
        });
      }
    }
    const matched = def.recoveryBranches.some((branch) => {
      if (!isRecord(branch.planPatchTemplate)) return false;
      return (
        branch.planPatchTemplate['triggerActivityKey'] === boundary.triggerActivityKey &&
        branch.planPatchTemplate['resumeActivityKey'] === boundary.resumeActivityKey &&
        canonicalJson(branch.planPatchTemplate['activitySequence']) ===
          canonicalJson(boundary.activitySequence) &&
        canonicalJson(uniqueSorted(branch.requiredCapabilities)) ===
          canonicalJson(uniqueSorted(boundary.requiredCapabilityRefs))
      );
    });
    if (!matched) {
      errors.push({
        code: 'RECOVERY_BOUNDARY_LOST',
        message: `Recovery boundary ${boundary.triggerActivityKey} was not compiled losslessly`,
      });
    }
    const conditionalTarget = boundary.activitySequence.find(
      (activityKey) => activityKey !== boundary.triggerActivityKey,
    );
    const predecessorNodeKey = activityNodeByKey.get(boundary.triggerActivityKey);
    const successorNodeKey =
      conditionalTarget === undefined ? undefined : activityNodeByKey.get(conditionalTarget);
    const conditionalEdge =
      predecessorNodeKey === undefined || successorNodeKey === undefined
        ? undefined
        : def.skillGoalGraph.dependencies.find(
            (dependency) =>
              dependency.predecessorNodeKey === predecessorNodeKey &&
              dependency.successorNodeKey === successorNodeKey &&
              dependency.predicate === 'optional' &&
              canonicalJson(dependency.condition) ===
                canonicalJson(recoveryCondition(boundary.triggerActivityKey)),
          );
    if (conditionalEdge === undefined) {
      errors.push({
        code: 'RECOVERY_CONDITIONAL_EDGE_MISSING',
        message: `Recovery boundary ${boundary.triggerActivityKey} lacks an optional conditional DAG edge`,
      });
    }
  }
  return !errors.some((error) => error.code.startsWith('RECOVERY_'));
}

function validateReplaySafety(artifact: CompiledArtifact, errors: ValidationIssue[]): boolean {
  const def = getPlanTemplateDefinition(artifact);
  if (def === undefined) return false;
  for (const branch of def.recoveryBranches) {
    if (branch.sideEffectReplayPolicy === 'explicitly_safe' && branch.maximumApplications > 1) {
      errors.push({
        code: 'REPLAY_UNSAFE',
        message: `Recovery branch allows ${String(branch.maximumApplications)} applications with explicitly_safe replay`,
      });
    }
  }
  return errors.filter((e) => e.code === 'REPLAY_UNSAFE').length === 0;
}

function validateBounds(artifact: CompiledArtifact, errors: ValidationIssue[]): boolean {
  const def = getPlanTemplateDefinition(artifact);
  if (def === undefined) return false;
  if (def.skillGoalGraph.nodes.length > 256) {
    errors.push({ code: 'BOUNDS_NODES_EXCEEDED', message: 'Node count exceeds 256' });
  }
  if (def.parameterBindings.length > 128) {
    errors.push({ code: 'BOUNDS_PARAMS_EXCEEDED', message: 'Parameter count exceeds 128' });
  }
  if (def.recoveryBranches.length > 32) {
    errors.push({ code: 'BOUNDS_RECOVERY_EXCEEDED', message: 'Recovery branch count exceeds 32' });
  }
  return errors.filter((e) => e.code.startsWith('BOUNDS_')).length === 0;
}

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
