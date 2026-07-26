import {
  COMPILED_ARTIFACT_STATUSES,
  COMPILED_ARTIFACT_TYPES,
  type ArtifactLineage,
  type ArtifactRuntimeBinding,
  type ArtifactActivationEvidence,
  type CaseArtifactDefinition,
  type CompiledArtifact,
  type CompiledArtifactDefinition,
  type ConditionExpression,
  type DecisionOutput,
  type DecisionRuleArtifactDefinition,
  type IntentRouteArtifactDefinition,
  type ModelRouteArtifactDefinition,
  type PlanTemplateArtifactDefinition,
  type SkillGoalGraphTemplate,
} from './contracts.js';
import { ArtifactDomainError } from './errors.js';
import {
  assertArrayLimit,
  assertArtifactApplicability,
  assertArtifactHash,
  assertArtifactIdentifier,
  assertArtifactRiskLevel,
  assertArtifactText,
  assertArtifactTimestamp,
  assertArtifactVersion,
  assertBoundedJson,
  assertCapabilityRequirements,
  assertConditionExpression,
  assertDefinitionMatchesType,
  assertDependencySnapshot,
  assertFiniteNonNegative,
  assertPolicyReferences,
  assertProbability,
  assertUniqueIdentifiers,
  deepFreeze,
} from './validation.js';

const artifactFields = [
  'artifactId',
  'artifactKey',
  'version',
  'artifactType',
  'name',
  'description',
  'scope',
  'definition',
  'applicability',
  'requiredCapabilities',
  'requiredPolicies',
  'dependencySnapshot',
  'riskLevel',
  'status',
  'lineageRef',
  'validationSummaryRef',
  'contentHash',
  'createdAt',
] as const;

export function createCompiledArtifact(
  input: CompiledArtifact,
  activationEvidence?: ArtifactActivationEvidence,
): CompiledArtifact {
  assertExactKeys(input, artifactFields, ['validationSummaryRef'], 'CompiledArtifact');
  assertArtifactIdentifier(input.artifactId, 'artifactId');
  assertArtifactIdentifier(input.artifactKey, 'artifactKey');
  assertArtifactVersion(input.version, 'version');
  assertArtifactText(input.name, 'name');
  assertArtifactText(input.description, 'description');
  if (!COMPILED_ARTIFACT_TYPES.includes(input.artifactType)) {
    artifactInvalid('artifactType is invalid.', 'artifactType');
  }
  if (!COMPILED_ARTIFACT_STATUSES.includes(input.status)) {
    artifactInvalid('status is invalid.', 'status');
  }
  assertArtifactIdentifier(input.scope.domain, 'scope.domain');
  if (input.scope.tenantId !== undefined) {
    assertArtifactIdentifier(input.scope.tenantId, 'scope.tenantId');
  }
  assertExactKeys(input.scope, ['tenantId', 'domain', 'taskTypeIds'], ['tenantId'], 'scope');
  assertUniqueIdentifiers(input.scope.taskTypeIds, 'scope.taskTypeIds');
  assertDefinitionMatchesType(input.artifactType, input.definition);
  assertCompiledArtifactDefinition(input.definition);
  assertExactKeys(
    input.applicability,
    [
      'requiredConditions',
      'optionalConditions',
      'forbiddenConditions',
      'requiredParameters',
      'allowedEnvironmentClasses',
      'excludedEnvironmentClasses',
      'minimumIntentScore',
      'minimumConditionScore',
      'maximumUncertainty',
      'outOfDistributionPolicy',
    ],
    [],
    'ArtifactApplicability',
  );
  assertArtifactApplicability(input.applicability);
  assertCapabilityRequirements(input.requiredCapabilities, 'requiredCapabilities');
  assertPolicyReferences(input.requiredPolicies, 'requiredPolicies');
  assertExactKeys(
    input.dependencySnapshot,
    [
      'capabilityCatalogHash',
      'policyVersionRefs',
      'taskTypeVersionRefs',
      'schemaVersionRefs',
      'requiredSkillVersionRefs',
      'compilerVersion',
    ],
    [],
    'ArtifactDependencySnapshot',
  );
  assertDependencySnapshot(input.dependencySnapshot);
  assertArtifactRiskLevel(input.riskLevel);
  assertArtifactIdentifier(input.lineageRef, 'lineageRef');
  if (input.validationSummaryRef !== undefined) {
    assertArtifactIdentifier(input.validationSummaryRef, 'validationSummaryRef');
  }
  if (
    input.status === 'active' &&
    (input.validationSummaryRef === undefined ||
      !activationEvidence?.validationPassed ||
      !activationEvidence.approvalRecorded)
  ) {
    throw new ArtifactDomainError(
      'ARTIFACT_ACTIVATION_EVIDENCE_REQUIRED',
      'Direct active construction requires a validation summary and activation evidence.',
      { artifactId: input.artifactId },
    );
  }
  assertArtifactHash(input.contentHash, 'contentHash');
  assertArtifactTimestamp(input.createdAt, 'createdAt');
  return deepFreeze({ ...input });
}

export function createConditionExpression(input: ConditionExpression): ConditionExpression {
  assertConditionExpression(input);
  return deepFreeze(input);
}

export function createArtifactLineage(input: ArtifactLineage): ArtifactLineage {
  assertExactKeys(
    input,
    [
      'lineageId',
      'artifactId',
      'artifactVersion',
      'sourceEpisodeRefs',
      'sourceKnowledgeRefs',
      'sourceCorrectionRefs',
      'sourcePatternRefs',
      'generationMethods',
      'validationRunRefs',
      'supersedesArtifactRefs',
    ],
    [],
    'ArtifactLineage',
  );
  assertArtifactIdentifier(input.lineageId, 'lineageId');
  assertArtifactIdentifier(input.artifactId, 'artifactId');
  assertArtifactVersion(input.artifactVersion, 'artifactVersion');
  for (const [field, refs] of [
    ['sourceEpisodeRefs', input.sourceEpisodeRefs],
    ['sourceKnowledgeRefs', input.sourceKnowledgeRefs],
    ['sourceCorrectionRefs', input.sourceCorrectionRefs],
    ['sourcePatternRefs', input.sourcePatternRefs],
    ['validationRunRefs', input.validationRunRefs],
    ['supersedesArtifactRefs', input.supersedesArtifactRefs],
  ] as const) {
    assertUniqueIdentifiers(refs, field);
  }
  assertArrayLimit(input.generationMethods, 'generationMethods', 1);
  input.generationMethods.forEach((method) => {
    assertAllowed(
      method,
      [
        'process_mining',
        'workflow_induction',
        'rule_mining',
        'case_mining',
        'model_assisted_generalization',
        'human_authored',
      ],
      'generationMethods',
    );
  });
  if (new Set(input.generationMethods).size !== input.generationMethods.length) {
    lineageInvalid('generationMethods must be unique.', 'generationMethods');
  }
  return deepFreeze({ ...input });
}

export function createArtifactRuntimeBinding(
  input: ArtifactRuntimeBinding,
): ArtifactRuntimeBinding {
  assertExactKeys(
    input,
    [
      'bindingId',
      'artifactId',
      'artifactVersion',
      'runtimeType',
      'compilerVersion',
      'compiledPayloadHash',
      'compiledAt',
    ],
    [],
    'ArtifactRuntimeBinding',
  );
  assertArtifactIdentifier(input.bindingId, 'bindingId');
  assertArtifactIdentifier(input.artifactId, 'artifactId');
  assertArtifactVersion(input.artifactVersion, 'artifactVersion');
  if (
    !['template_plan_builder', 'decision_engine', 'case_adapter', 'model_router'].includes(
      input.runtimeType,
    )
  ) {
    bindingInvalid('runtimeType is invalid.', 'runtimeType');
  }
  assertArtifactIdentifier(input.compilerVersion, 'compilerVersion');
  assertArtifactHash(input.compiledPayloadHash, 'compiledPayloadHash');
  assertArtifactTimestamp(input.compiledAt, 'compiledAt');
  return deepFreeze({ ...input });
}

function assertCompiledArtifactDefinition(definition: CompiledArtifactDefinition): void {
  if ('taskTypeId' in definition) assertIntentRouteDefinition(definition);
  else if ('goalPattern' in definition) assertPlanTemplateDefinition(definition);
  else if ('category' in definition) assertDecisionRuleDefinition(definition);
  else if ('problemFingerprint' in definition) assertCaseDefinition(definition);
  else assertModelRouteDefinition(definition);
}

function assertIntentRouteDefinition(definition: IntentRouteArtifactDefinition): void {
  assertExactKeys(
    definition,
    ['taskTypeId', 'semanticExamples', 'exactPatterns', 'structuredHints', 'nextPath'],
    [],
    'IntentRouteArtifactDefinition',
  );
  assertArtifactIdentifier(definition.taskTypeId, 'taskTypeId');
  assertArrayLimit(definition.semanticExamples, 'semanticExamples', 1);
  definition.semanticExamples.forEach((value) => {
    assertArtifactText(value, 'semanticExamples');
  });
  assertArrayLimit(definition.exactPatterns, 'exactPatterns');
  definition.exactPatterns.forEach((value) => {
    assertExactKeys(value, ['pattern', 'flags'], [], 'exactPattern');
    assertArtifactText(value.pattern, 'exactPattern.pattern');
    assertArrayLimit(value.flags, 'exactPattern.flags');
    value.flags.forEach((flag) => {
      assertAllowed(flag, ['case_insensitive', 'unicode', 'whole_input'], 'exactPattern.flags');
    });
    if (new Set(value.flags).size !== value.flags.length) {
      artifactInvalid('exactPattern flags must be unique.', 'exactPatterns');
    }
  });
  assertArrayLimit(definition.structuredHints, 'structuredHints');
  definition.structuredHints.forEach((value) => {
    assertExactKeys(value, ['field', 'operator', 'value'], ['value'], 'structuredHint');
    assertArtifactIdentifier(value.field, 'structuredHint.field');
    assertAllowed(value.operator, ['eq', 'in', 'exists'], 'structuredHint.operator');
    if (value.operator === 'exists' && 'value' in value) {
      artifactInvalid('exists hints cannot carry a value.', 'structuredHints');
    }
    if (value.operator !== 'exists' && !('value' in value)) {
      artifactInvalid('non-exists hints require a value.', 'structuredHints');
    }
    if (value.value !== undefined) assertBoundedJson(value.value, 'structuredHint.value');
  });
  assertAllowed(
    definition.nextPath,
    ['plan_template', 'case_retrieval', 'small_model', 'cognitive_runtime'],
    'nextPath',
  );
}

function assertPlanTemplateDefinition(definition: PlanTemplateArtifactDefinition): void {
  assertExactKeys(
    definition,
    [
      'goalPattern',
      'parameterSchema',
      'parameterBindings',
      'skillGoalGraph',
      'completionContractTemplate',
      'recoveryBranches',
    ],
    [],
    'PlanTemplateArtifactDefinition',
  );
  assertExactKeys(
    definition.goalPattern,
    ['objectiveTemplate', 'criterionTemplates'],
    [],
    'goalPattern',
  );
  assertArtifactText(definition.goalPattern.objectiveTemplate, 'goalPattern.objectiveTemplate');
  assertArrayLimit(definition.goalPattern.criterionTemplates, 'criterionTemplates', 1);
  const criterionIds = definition.goalPattern.criterionTemplates.map(
    (item) => item.criterionTemplateId,
  );
  assertUniqueIdentifiers(criterionIds, 'criterionTemplateIds');
  definition.goalPattern.criterionTemplates.forEach((item) => {
    assertExactKeys(
      item,
      ['criterionTemplateId', 'statementTemplate', 'required'],
      [],
      'criterionTemplate',
    );
    assertArtifactText(item.statementTemplate, 'criterionTemplate.statementTemplate');
    if (typeof item.required !== 'boolean') {
      artifactInvalid('criterionTemplate.required must be boolean.', 'criterionTemplate.required');
    }
  });
  assertBoundedJson(definition.parameterSchema, 'parameterSchema');
  assertArrayLimit(definition.parameterBindings, 'parameterBindings');
  const parameterNames = definition.parameterBindings.map((item) => item.parameterName);
  assertUniqueIdentifiers(parameterNames, 'parameterBindings.parameterName');
  definition.parameterBindings.forEach((item) => {
    assertExactKeys(
      item,
      ['parameterName', 'schema', 'required', 'allowedSources', 'trustLevel', 'defaultPolicy'],
      [],
      'parameterBinding',
    );
    assertBoundedJson(item.schema, 'parameterBinding.schema');
    if (typeof item.required !== 'boolean') {
      artifactInvalid('parameterBinding.required must be boolean.', 'parameterBinding.required');
    }
    assertAllowed(
      item.allowedSources,
      ['user_confirmed', 'request', 'world_state', 'runtime_context', 'small_model_candidate'],
      'parameterBinding.allowedSources',
    );
    assertAllowed(
      item.trustLevel,
      ['authoritative', 'trusted', 'candidate'],
      'parameterBinding.trustLevel',
    );
    assertAllowed(item.defaultPolicy, ['none', 'low_risk_only'], 'parameterBinding.defaultPolicy');
  });
  assertSkillGoalGraph(definition.skillGoalGraph, criterionIds);
  const completion = definition.completionContractTemplate;
  assertExactKeys(
    completion,
    [
      'titleTemplate',
      'descriptionTemplate',
      'criteria',
      'evidenceRequirements',
      'artifactRequirements',
    ],
    [],
    'completionContractTemplate',
  );
  assertArtifactText(completion.titleTemplate, 'completionContractTemplate.titleTemplate');
  assertArtifactText(
    completion.descriptionTemplate,
    'completionContractTemplate.descriptionTemplate',
  );
  assertArrayLimit(completion.criteria, 'completionContractTemplate.criteria', 1);
  const completionCriterionIds = completion.criteria.map((criterion) => {
    assertExactKeys(
      criterion,
      ['criterionTemplateId', 'statementTemplate', 'required'],
      [],
      'completionContractTemplate.criteria',
    );
    assertArtifactText(criterion.statementTemplate, 'completion criterion statementTemplate');
    if (typeof criterion.required !== 'boolean') {
      artifactInvalid(
        'Completion criterion required must be boolean.',
        'completionContractTemplate.criteria.required',
      );
    }
    return criterion.criterionTemplateId;
  });
  assertUniqueIdentifiers(completionCriterionIds, 'completionContractTemplate.criteria');
  completionCriterionIds.forEach((criterionId) => {
    if (!criterionIds.includes(criterionId)) {
      artifactInvalid(
        'Completion contract references an unknown criterion template.',
        'completionContractTemplate',
      );
    }
  });
  assertUniqueIdentifiers(completion.evidenceRequirements, 'completion evidenceRequirements');
  assertUniqueIdentifiers(completion.artifactRequirements, 'completion artifactRequirements');
  assertArrayLimit(definition.recoveryBranches, 'recoveryBranches');
  definition.recoveryBranches.forEach((item) => {
    assertExactKeys(
      item,
      [
        'trigger',
        'requiredCapabilities',
        'planPatchTemplate',
        'maximumApplications',
        'sideEffectReplayPolicy',
      ],
      [],
      'recoveryBranch',
    );
    assertConditionExpression(item.trigger, 'recoveryBranch.trigger');
    assertUniqueIdentifiers(item.requiredCapabilities, 'recoveryBranch.requiredCapabilities');
    assertBoundedJson(item.planPatchTemplate, 'recoveryBranch.planPatchTemplate');
    if (
      !Number.isSafeInteger(item.maximumApplications) ||
      item.maximumApplications < 1 ||
      item.maximumApplications > 16
    ) {
      artifactInvalid(
        'Recovery maximumApplications must be between one and sixteen.',
        'maximumApplications',
      );
    }
    assertAllowed(
      item.sideEffectReplayPolicy,
      ['forbidden', 'explicitly_safe'],
      'recoveryBranch.sideEffectReplayPolicy',
    );
  });
}

function assertSkillGoalGraph(
  graph: SkillGoalGraphTemplate,
  criterionTemplateIds: readonly string[],
): void {
  assertExactKeys(graph, ['nodes', 'dependencies'], [], 'skillGoalGraph');
  assertArrayLimit(graph.nodes, 'skillGoalGraph.nodes', 1);
  assertArrayLimit(graph.dependencies, 'skillGoalGraph.dependencies');
  const nodeKeys = graph.nodes.map((node) => node.nodeKey);
  assertUniqueIdentifiers(nodeKeys, 'skillGoalGraph.nodeKeys');
  graph.nodes.forEach((node) => {
    assertExactKeys(
      node,
      [
        'nodeKey',
        'nodeType',
        'objectiveTemplate',
        'requiredCapabilities',
        'requiredEffectRefs',
        'coveredCriterionTemplateIds',
        'evidenceRequirements',
        'artifactRequirements',
        'inputTemplate',
        'assumptionsAllowed',
        'constraints',
      ],
      [],
      'skillGoalNodeTemplate',
    );
    assertAllowed(
      node.nodeType,
      ['action', 'observation', 'reasoning', 'verification', 'recovery', 'human_gate'],
      'node.nodeType',
    );
    assertArtifactText(node.objectiveTemplate, 'node.objectiveTemplate');
    assertUniqueIdentifiers(node.requiredCapabilities, 'node.requiredCapabilities');
    assertUniqueIdentifiers(node.requiredEffectRefs, 'node.requiredEffectRefs');
    assertUniqueIdentifiers(node.coveredCriterionTemplateIds, 'node.coveredCriterionTemplateIds');
    node.coveredCriterionTemplateIds.forEach((criterionId) => {
      if (!criterionTemplateIds.includes(criterionId)) {
        artifactInvalid('Node covers an unknown criterion template.', 'skillGoalGraph.nodes');
      }
    });
    assertUniqueIdentifiers(node.evidenceRequirements, 'node.evidenceRequirements');
    assertUniqueIdentifiers(node.artifactRequirements, 'node.artifactRequirements');
    assertBoundedJson(node.inputTemplate, 'node.inputTemplate');
    assertUniqueIdentifiers(node.assumptionsAllowed, 'node.assumptionsAllowed');
    assertArrayLimit(node.constraints, 'node.constraints');
    node.constraints.forEach((constraint) => {
      assertArtifactText(constraint, 'node.constraints');
    });
  });
  const edgeKeys = new Set<string>();
  const dependencyKeys = graph.dependencies.map((edge) => edge.dependencyKey);
  assertUniqueIdentifiers(dependencyKeys, 'skillGoalGraph.dependencyKeys');
  const outgoing = new Map(nodeKeys.map((key) => [key, [] as string[]]));
  graph.dependencies.forEach((edge) => {
    assertExactKeys(
      edge,
      ['dependencyKey', 'predecessorNodeKey', 'successorNodeKey', 'predicate', 'condition'],
      ['condition'],
      'skillGoalDependency',
    );
    if (
      !nodeKeys.includes(edge.predecessorNodeKey) ||
      !nodeKeys.includes(edge.successorNodeKey) ||
      edge.predecessorNodeKey === edge.successorNodeKey
    ) {
      artifactInvalid(
        'Skill Goal dependency endpoints are invalid.',
        'skillGoalGraph.dependencies',
      );
    }
    assertArtifactIdentifier(edge.dependencyKey, 'skillGoalDependency.dependencyKey');
    assertAllowed(edge.predicate, ['required', 'optional'], 'skillGoalDependency.predicate');
    const edgeKey = `${edge.predecessorNodeKey}->${edge.successorNodeKey}`;
    if (edgeKeys.has(edgeKey)) {
      artifactInvalid('Skill Goal dependencies must be unique.', 'skillGoalGraph.dependencies');
    }
    edgeKeys.add(edgeKey);
    outgoing.get(edge.predecessorNodeKey)?.push(edge.successorNodeKey);
    if (edge.condition !== undefined) {
      assertConditionExpression(edge.condition, 'skillGoalDependency.condition');
    }
  });
  assertAcyclic(nodeKeys, outgoing);
}

function assertDecisionRuleDefinition(definition: DecisionRuleArtifactDefinition): void {
  assertExactKeys(
    definition,
    ['category', 'condition', 'decision', 'priority', 'conflictGroup', 'conflictPolicy'],
    ['conflictGroup'],
    'DecisionRuleArtifactDefinition',
  );
  assertAllowed(
    definition.category,
    ['risk', 'routing', 'confirmation', 'recovery', 'degradation', 'model_selection'],
    'category',
  );
  assertConditionExpression(definition.condition);
  assertDecisionOutput(definition.decision);
  if (!Number.isSafeInteger(definition.priority) || definition.priority < 0) {
    artifactInvalid('Decision priority must be a non-negative integer.', 'priority');
  }
  if (definition.conflictGroup !== undefined) {
    assertArtifactIdentifier(definition.conflictGroup, 'conflictGroup');
  }
  assertAllowed(
    definition.conflictPolicy,
    ['deny_overrides', 'higher_priority', 'most_specific', 'require_human'],
    'conflictPolicy',
  );
}

function assertDecisionOutput(value: DecisionOutput): void {
  assertExactKeys(value, ['decisionType', 'parameters', 'explanationCode'], [], 'DecisionOutput');
  assertAllowed(
    value.decisionType,
    [
      'set_risk',
      'select_template',
      'require_confirmation',
      'select_recovery',
      'select_model',
      'degrade',
    ],
    'decisionType',
  );
  assertBoundedJson(value.parameters, 'decision.parameters');
  assertArtifactIdentifier(value.explanationCode, 'explanationCode');
}

function assertCaseDefinition(definition: CaseArtifactDefinition): void {
  assertExactKeys(
    definition,
    [
      'problemFingerprint',
      'solutionPattern',
      'adaptationRules',
      'applicability',
      'failureBoundaries',
      'priorOutcomeSummary',
    ],
    [],
    'CaseArtifactDefinition',
  );
  const fingerprint = definition.problemFingerprint;
  assertExactKeys(
    fingerprint,
    [
      'taskTypeId',
      'goalFeatureHash',
      'entityClasses',
      'environmentClasses',
      'eventTypes',
      'failureTypes',
      'capabilityState',
      'constraints',
      'riskLevel',
    ],
    [],
    'problemFingerprint',
  );
  assertArtifactIdentifier(fingerprint.taskTypeId, 'problemFingerprint.taskTypeId');
  assertArtifactHash(fingerprint.goalFeatureHash, 'problemFingerprint.goalFeatureHash');
  for (const [field, values] of [
    ['entityClasses', fingerprint.entityClasses],
    ['environmentClasses', fingerprint.environmentClasses],
    ['eventTypes', fingerprint.eventTypes],
    ['failureTypes', fingerprint.failureTypes],
    ['capabilityState', fingerprint.capabilityState],
  ] as const) {
    assertUniqueIdentifiers(values, `problemFingerprint.${field}`);
  }
  assertArrayLimit(fingerprint.constraints, 'problemFingerprint.constraints');
  fingerprint.constraints.forEach((constraint) => {
    assertExactKeys(constraint, ['field', 'operator', 'value'], ['value'], 'constraint');
    assertArtifactIdentifier(constraint.field, 'constraint.field');
    assertAllowed(
      constraint.operator,
      ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'exists'],
      'constraint.operator',
    );
    if (constraint.operator === 'exists' && 'value' in constraint) {
      artifactInvalid('exists constraints cannot carry a value.', 'constraints');
    }
    if (constraint.operator !== 'exists' && !('value' in constraint)) {
      artifactInvalid('non-exists constraints require a value.', 'constraints');
    }
    if (constraint.value !== undefined) assertBoundedJson(constraint.value, 'constraint.value');
  });
  assertArtifactRiskLevel(fingerprint.riskLevel);

  const solution = definition.solutionPattern;
  assertExactKeys(
    solution,
    ['planPatchTemplate', 'recoveryPlanTemplate', 'decisionSuggestions'],
    ['planPatchTemplate', 'recoveryPlanTemplate'],
    'solutionPattern',
  );
  if (
    solution.planPatchTemplate === undefined &&
    solution.recoveryPlanTemplate === undefined &&
    solution.decisionSuggestions.length === 0
  ) {
    artifactInvalid('A case solution pattern must contain a reusable solution.', 'solutionPattern');
  }
  if (solution.planPatchTemplate !== undefined) {
    assertBoundedJson(solution.planPatchTemplate, 'solutionPattern.planPatchTemplate');
  }
  if (solution.recoveryPlanTemplate !== undefined) {
    assertBoundedJson(solution.recoveryPlanTemplate, 'solutionPattern.recoveryPlanTemplate');
  }
  assertArrayLimit(solution.decisionSuggestions, 'solutionPattern.decisionSuggestions');
  solution.decisionSuggestions.forEach(assertDecisionOutput);

  assertArrayLimit(definition.adaptationRules, 'adaptationRules');
  definition.adaptationRules.forEach((rule) => {
    assertExactKeys(rule, ['condition', 'action', 'template'], [], 'adaptationRule');
    assertAllowed(
      rule.action,
      ['bind_parameters', 'plan_patch', 'recovery_patch'],
      'adaptationRule.action',
    );
    assertConditionExpression(rule.condition, 'adaptationRule.condition');
    assertBoundedJson(rule.template, 'adaptationRule.template');
  });
  assertExactKeys(
    definition.applicability,
    ['contextRequirements', 'minimumSimilarity'],
    [],
    'caseApplicability',
  );
  assertArrayLimit(definition.applicability.contextRequirements, 'contextRequirements');
  definition.applicability.contextRequirements.forEach((condition) => {
    assertConditionExpression(condition, 'contextRequirements');
  });
  assertProbability(definition.applicability.minimumSimilarity, 'minimumSimilarity');

  assertArrayLimit(definition.failureBoundaries, 'failureBoundaries');
  definition.failureBoundaries.forEach((boundary) => {
    assertExactKeys(boundary, ['condition', 'action', 'reasonCode'], [], 'failureBoundary');
    assertAllowed(
      boundary.action,
      ['fallback_reasoning', 'require_confirmation', 'deny'],
      'failureBoundary.action',
    );
    assertConditionExpression(boundary.condition, 'failureBoundary.condition');
    assertArtifactIdentifier(boundary.reasonCode, 'failureBoundary.reasonCode');
  });
  assertExactKeys(
    definition.priorOutcomeSummary,
    ['successRate', 'sampleCount', 'limitations'],
    [],
    'priorOutcomeSummary',
  );
  assertProbability(definition.priorOutcomeSummary.successRate, 'successRate');
  if (
    !Number.isSafeInteger(definition.priorOutcomeSummary.sampleCount) ||
    definition.priorOutcomeSummary.sampleCount < 0
  ) {
    artifactInvalid('sampleCount must be a non-negative safe integer.', 'sampleCount');
  }
  assertArrayLimit(definition.priorOutcomeSummary.limitations, 'limitations');
  definition.priorOutcomeSummary.limitations.forEach((item) => {
    assertArtifactText(item, 'limitations');
  });
}

function assertModelRouteDefinition(definition: ModelRouteArtifactDefinition): void {
  assertExactKeys(
    definition,
    ['conditions', 'route', 'budget', 'fallbackRoutes'],
    [],
    'ModelRouteArtifactDefinition',
  );
  assertArrayLimit(definition.conditions, 'conditions');
  definition.conditions.forEach((condition) => {
    assertConditionExpression(condition);
  });
  assertAllowed(
    definition.route,
    ['none', 'local_small', 'cloud_medium', 'cloud_reasoning', 'human'],
    'route',
  );
  assertExactKeys(
    definition.budget,
    ['maxTokens', 'maxLatencyMs', 'maxCostUnits'],
    [],
    'modelBudget',
  );
  assertFiniteNonNegative(definition.budget.maxTokens, 'maxTokens');
  assertFiniteNonNegative(definition.budget.maxLatencyMs, 'maxLatencyMs');
  assertFiniteNonNegative(definition.budget.maxCostUnits, 'maxCostUnits');
  if (
    !Number.isSafeInteger(definition.budget.maxTokens) ||
    !Number.isSafeInteger(definition.budget.maxLatencyMs)
  ) {
    artifactInvalid('Token and latency budgets must be safe integers.', 'budget');
  }
  assertArrayLimit(definition.fallbackRoutes, 'fallbackRoutes');
  definition.fallbackRoutes.forEach((route) => {
    assertAllowed(
      route,
      ['none', 'local_small', 'cloud_medium', 'cloud_reasoning', 'human'],
      'fallbackRoutes',
    );
  });
  if (new Set(definition.fallbackRoutes).size !== definition.fallbackRoutes.length) {
    artifactInvalid('fallbackRoutes must be unique.', 'fallbackRoutes');
  }
}

function assertAcyclic(nodeKeys: readonly string[], outgoing: ReadonlyMap<string, string[]>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeKey: string): void => {
    if (visiting.has(nodeKey)) {
      artifactInvalid('Skill Goal graph must be acyclic.', 'skillGoalGraph.dependencies');
    }
    if (visited.has(nodeKey)) return;
    visiting.add(nodeKey);
    outgoing.get(nodeKey)?.forEach(visit);
    visiting.delete(nodeKey);
    visited.add(nodeKey);
  };
  nodeKeys.forEach(visit);
}

function assertExactKeys(
  value: object,
  allowed: readonly string[],
  optional: readonly string[],
  field: string,
): void {
  const keys = Object.keys(value);
  const required = allowed.filter((key) => !optional.includes(key));
  if (
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    artifactInvalid(`${field} fields do not match the contract.`, field);
  }
}

function assertAllowed(
  value: unknown,
  allowed: readonly string[],
  field: string,
): asserts value is string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    artifactInvalid(`${field} is invalid.`, field);
  }
}

function artifactInvalid(message: string, field: string): never {
  throw new ArtifactDomainError('ARTIFACT_INVALID', message, { field });
}

function lineageInvalid(message: string, field: string): never {
  throw new ArtifactDomainError('ARTIFACT_LINEAGE_INVALID', message, { field });
}

function bindingInvalid(message: string, field: string): never {
  throw new ArtifactDomainError('ARTIFACT_RUNTIME_BINDING_INVALID', message, { field });
}
