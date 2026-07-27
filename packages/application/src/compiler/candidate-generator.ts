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

    const nodes = classifySteps(structural, semantic);
    const dependencies = compileDependencies(structural, nodes);
    const parameterSchema = compileParameterSchema(generalizedPattern);
    const parameterBindings = compileParameterBindings(generalizedPattern);
    const goalPattern = compileGoalPattern(generalizedPattern, structural);
    const completionContract = compileCompletionContract(generalizedPattern, structural);
    const recoveryBranches = compileRecoveryBranches(structural);

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
): readonly SkillGoalNodeTemplate[] {
  return structural.activityPatterns.map((activity, index) => {
    const nodeKey = `node_${String(index)}_${activity.activity}`;
    const nodeType = inferNodeType(activity.activity);
    const capabilityMapping = semantic.capabilityMappings.find(
      (m) => m.sourceActivity === activity.activity,
    );
    const requiredCapabilities = capabilityMapping ? [capabilityMapping.capabilityId] : [];

    return Object.freeze({
      nodeKey,
      nodeType,
      objectiveTemplate: `Execute ${activity.activity}`,
      requiredCapabilities: Object.freeze(requiredCapabilities),
      requiredEffectRefs: Object.freeze([]),
      coveredCriterionTemplateIds: Object.freeze(
        activity.required ? [`criterion_${activity.activity}`] : [],
      ),
      evidenceRequirements: Object.freeze([`evidence:${activity.activity}`]),
      artifactRequirements: Object.freeze([]),
      inputTemplate: null,
      assumptionsAllowed: Object.freeze([]),
      constraints: Object.freeze([]),
    });
  });
}

function inferNodeType(activityName: string): SkillGoalNodeTemplate['nodeType'] {
  const lower = activityName.toLowerCase();
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
  const deps: SkillGoalDependencyTemplate[] = [];
  for (const pattern of structural.dependencyPatterns) {
    const predecessor = nodes.find((n) =>
      n.objectiveTemplate.includes(pattern.predecessorActivity),
    );
    const successor = nodes.find((n) => n.objectiveTemplate.includes(pattern.successorActivity));
    if (predecessor === undefined || successor === undefined) continue;
    deps.push(
      Object.freeze({
        dependencyKey: `dep_${predecessor.nodeKey}_${successor.nodeKey}`,
        predecessorNodeKey: predecessor.nodeKey,
        successorNodeKey: successor.nodeKey,
        predicate: pattern.relation === 'parallel' ? 'optional' : 'required',
      }),
    );
  }
  return Object.freeze(deps);
}

function compileParameterSchema(
  generalized: GeneralizedPattern,
): PlanTemplateArtifactDefinition['parameterSchema'] {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const variable of generalized.variables) {
    properties[variable.variableName] = { type: 'string' };
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
        schema: Object.freeze({ type: 'string' }),
        required: variable.required,
        allowedSources: 'request' as const,
        trustLevel: 'candidate' as const,
        defaultPolicy: 'none' as const,
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
        criterionTemplateId: `criterion_${a.activity}`,
        statementTemplate: `${a.activity} must be completed`,
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
            criterionTemplateId: `criterion_${a.activity}`,
            statementTemplate: `${a.activity} evidence recorded`,
            required: true,
          }),
        ),
    ),
    evidenceRequirements: Object.freeze(
      structural.activityPatterns.map((a) => `evidence:${a.activity}`),
    ),
    artifactRequirements: Object.freeze([]),
  });
}

function compileRecoveryBranches(structural: StructuralPattern): readonly RecoveryBranchTemplate[] {
  return Object.freeze(
    structural.recoveryPatterns.map((recovery) =>
      Object.freeze({
        trigger: {
          type: 'atomic' as const,
          field: `failure.${recovery.triggerActivity}`,
          operator: 'eq' as const,
          value: true,
        },
        requiredCapabilities: Object.freeze([]),
        planPatchTemplate: Object.freeze({}),
        maximumApplications: 1,
        sideEffectReplayPolicy: 'forbidden' as const,
      }),
    ),
  );
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

    const artifactKey = `plan_template:${fusedPattern.applicabilityCandidate.domain}:${generalizedPattern.taskTypeId}`;
    const artifactId = `artifact-${createHash('sha256')
      .update(artifactKey + ':' + generalizedPattern.contentHash, 'utf8')
      .digest('hex')
      .slice(0, 16)}`;
    const contentHash = `sha256:${createHash('sha256')
      .update(JSON.stringify(definition), 'utf8')
      .digest('hex')}`;

    const scope: ArtifactScope = Object.freeze({
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
      domain: fusedPattern.applicabilityCandidate.domain,
      taskTypeIds: Object.freeze([generalizedPattern.taskTypeId]),
    });

    const applicability: ArtifactApplicability = Object.freeze({
      requiredConditions: Object.freeze([...generalizedPattern.requiredConditions]),
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
      capabilityCatalogHash: `sha256:${createHash('sha256')
        .update(input.knownCapabilityIds.slice().sort().join(','), 'utf8')
        .digest('hex')}`,
      policyVersionRefs: Object.freeze([]),
      taskTypeVersionRefs: Object.freeze([generalizedPattern.taskTypeId]),
      schemaVersionRefs: Object.freeze([ARTIFACT_CONTRACT_VERSION]),
      requiredSkillVersionRefs: Object.freeze([]),
      compilerVersion: CANDIDATE_GENERATOR_VERSION,
    });

    const lineageId = `lineage-${createHash('sha256').update(artifactId, 'utf8').digest('hex').slice(0, 16)}`;

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
      requiredCapabilities: Object.freeze([]),
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
      sourceEpisodeRefs: Object.freeze([]),
      sourceKnowledgeRefs: Object.freeze([]),
      sourceCorrectionRefs: Object.freeze([]),
      sourcePatternRefs: Object.freeze([
        fusedPattern.sourceWorkflowPatternRef,
        fusedPattern.sourceProcessPatternRef,
        fusedPattern.fusedPatternId,
        generalizedPattern.generalizedPatternId,
      ]),
      generationMethods: Object.freeze(['process_mining', 'model_assisted_generalization']),
      validationRunRefs: Object.freeze([]),
      supersedesArtifactRefs: Object.freeze([]),
    });

    const fingerprint = candidateFingerprint({
      artifactType: 'plan_template',
      domain: fusedPattern.applicabilityCandidate.domain,
      taskTypeId: generalizedPattern.taskTypeId,
      generalizedDefinitionHash: generalizedPattern.contentHash,
      applicabilityHash: contentHash,
      requiredCapabilityShapeHash: dependencySnapshot.capabilityCatalogHash,
      generatorVersion: CANDIDATE_GENERATOR_VERSION,
    });

    const validation = this.#validator.validate({ artifact, fingerprint });

    return Object.freeze({ artifact, lineage, fingerprint, validation });
  }
}

// ---------------------------------------------------------------------------
// Static Validator
// ---------------------------------------------------------------------------

export interface StaticValidationInput {
  readonly artifact: CompiledArtifact;
  readonly fingerprint: string;
  readonly existingFingerprints?: readonly string[];
}

export class CandidateStaticValidator {
  validate(input: StaticValidationInput): CandidateStaticValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const schemaValid = validateSchema(input.artifact, errors);
    const dagValid = validateDag(input.artifact, errors);
    const requiredCriteriaCovered = validateCriteriaCoverage(input.artifact, errors);
    const capabilityShapeValid = validateCapabilityShape(input.artifact, errors, warnings);
    const parameterPolicyValid = validateParameterPolicy(input.artifact, errors);
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
      dagValid &&
      requiredCriteriaCovered &&
      capabilityShapeValid &&
      parameterPolicyValid &&
      sideEffectReplaySafe &&
      boundsValid &&
      duplicateFingerprint === undefined
        ? 'passed_static'
        : 'failed_static';

    return createCandidateStaticValidationResult({
      artifactRef: input.artifact.artifactId,
      schemaValid,
      dagValid,
      requiredCriteriaCovered,
      capabilityShapeValid,
      parameterPolicyValid,
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
    if (node.requiredCapabilities.some((c) => c.startsWith('skill:'))) {
      errors.push({
        code: 'EXACT_SKILL_BINDING',
        message: `Node ${node.nodeKey} binds an exact Skill ID, which is forbidden`,
      });
      valid = false;
    }
  }
  return valid;
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
