import { z } from 'zod';

export const artifactIdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/u);
export const artifactHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const artifactTimestampSchema = z.iso.datetime({ offset: true });
export const probabilitySchema = z.number().min(0).max(1);
const uniqueArtifactIdentifiersSchema = z
  .array(artifactIdentifierSchema)
  .max(256)
  .refine((values) => new Set(values).size === values.length, 'Values must be unique.');

export const CompiledArtifactTypeSchema = z.enum([
  'intent_route',
  'plan_template',
  'decision_rule',
  'case_template',
  'model_route',
]);
export const CompiledArtifactStatusSchema = z.enum([
  'discovered',
  'candidate',
  'validating',
  'awaiting_approval',
  'active',
  'revalidating',
  'deprecated',
  'archived',
  'rejected',
]);
export const artifactRiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

type JsonData = string | number | boolean | null | JsonData[] | { [key: string]: JsonData };
export const JsonValueSchema: z.ZodType<JsonData> = z.lazy(() =>
  z
    .union([
      z.string().max(65_536),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(JsonValueSchema).max(256),
      z
        .record(z.string().min(1).max(128), JsonValueSchema)
        .refine(
          (value) =>
            !Object.keys(value).some((key) =>
              ['__proto__', 'constructor', 'prototype'].includes(key),
            ) && Object.keys(value).length <= 128,
          'JSON object is not bounded or contains an unsafe key.',
        ),
    ])
    .refine((value) => treeDepth(value) <= 12, 'JSON value exceeds the depth limit.'),
);

export const ConditionExpressionSchema: z.ZodType = z.lazy(() =>
  z
    .union([
      z
        .object({
          type: z.enum(['all', 'any']),
          children: z.array(ConditionExpressionSchema).min(1).max(256),
        })
        .strict(),
      z
        .object({
          type: z.literal('not'),
          child: ConditionExpressionSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('atomic'),
          field: artifactIdentifierSchema,
          operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']),
          value: JsonValueSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('atomic'),
          field: artifactIdentifierSchema,
          operator: z.literal('exists'),
        })
        .strict(),
    ])
    .superRefine((value, context) => {
      if (conditionDepth(value) > 12) {
        context.addIssue({ code: 'custom', message: 'Condition exceeds the depth limit.' });
      }
      if (conditionNodeCount(value) > 256) {
        context.addIssue({ code: 'custom', message: 'Condition exceeds the node limit.' });
      }
    }),
);

export const CapabilityRequirementSchema = z
  .object({
    capabilityId: artifactIdentifierSchema,
    minimumVersion: artifactIdentifierSchema.optional(),
  })
  .strict();

export const PolicyReferenceSchema = z
  .object({
    policyId: artifactIdentifierSchema,
    version: artifactIdentifierSchema,
  })
  .strict();

export const ArtifactApplicabilitySchema = z
  .object({
    requiredConditions: z.array(ConditionExpressionSchema).max(256),
    optionalConditions: z.array(ConditionExpressionSchema).max(256),
    forbiddenConditions: z.array(ConditionExpressionSchema).max(256),
    requiredParameters: uniqueArtifactIdentifiersSchema,
    allowedEnvironmentClasses: uniqueArtifactIdentifiersSchema,
    excludedEnvironmentClasses: uniqueArtifactIdentifiersSchema,
    minimumIntentScore: probabilitySchema,
    minimumConditionScore: probabilitySchema,
    maximumUncertainty: probabilitySchema,
    outOfDistributionPolicy: z.enum(['fallback_reasoning', 'require_confirmation', 'deny']),
  })
  .strict()
  .superRefine((value, context) => {
    const excluded = new Set(value.excludedEnvironmentClasses);
    if (value.allowedEnvironmentClasses.some((item) => excluded.has(item))) {
      context.addIssue({
        code: 'custom',
        path: ['allowedEnvironmentClasses'],
        message: 'Allowed and excluded environments must be disjoint.',
      });
    }
  });

export const ArtifactDependencySnapshotSchema = z
  .object({
    capabilityCatalogHash: artifactHashSchema,
    policyVersionRefs: uniqueArtifactIdentifiersSchema,
    taskTypeVersionRefs: uniqueArtifactIdentifiersSchema,
    schemaVersionRefs: uniqueArtifactIdentifiersSchema,
    requiredSkillVersionRefs: uniqueArtifactIdentifiersSchema,
    compilerVersion: artifactIdentifierSchema,
  })
  .strict();

const ExactPatternSchema = z
  .object({
    pattern: z.string().min(1).max(65_536),
    flags: z
      .array(z.enum(['case_insensitive', 'unicode', 'whole_input']))
      .max(3)
      .refine((values) => new Set(values).size === values.length, 'Flags must be unique.'),
  })
  .strict();

const StructuredHintSchema = z.discriminatedUnion('operator', [
  z
    .object({
      field: artifactIdentifierSchema,
      operator: z.enum(['eq', 'in']),
      value: JsonValueSchema,
    })
    .strict(),
  z
    .object({
      field: artifactIdentifierSchema,
      operator: z.literal('exists'),
    })
    .strict(),
]);

export const IntentRouteArtifactDefinitionSchema = z
  .object({
    taskTypeId: artifactIdentifierSchema,
    semanticExamples: z.array(z.string().min(1).max(65_536)).min(1).max(256),
    exactPatterns: z.array(ExactPatternSchema).max(256),
    structuredHints: z.array(StructuredHintSchema).max(256),
    nextPath: z.enum(['plan_template', 'case_retrieval', 'small_model', 'cognitive_runtime']),
  })
  .strict();

const CriterionTemplateSchema = z
  .object({
    criterionTemplateId: artifactIdentifierSchema,
    statementTemplate: z.string().min(1).max(65_536),
    required: z.boolean(),
  })
  .strict();

const TemplateParameterDefinitionSchema = z
  .object({
    parameterName: artifactIdentifierSchema,
    schema: JsonValueSchema,
    required: z.boolean(),
    allowedSources: z.enum([
      'user_confirmed',
      'request',
      'world_state',
      'runtime_context',
      'small_model_candidate',
    ]),
    trustLevel: z.enum(['authoritative', 'trusted', 'candidate']),
    defaultPolicy: z.enum(['none', 'low_risk_only']),
  })
  .strict();

export const SkillGoalNodeTemplateSchema = z
  .object({
    nodeKey: artifactIdentifierSchema,
    nodeType: z.enum([
      'action',
      'observation',
      'reasoning',
      'verification',
      'recovery',
      'human_gate',
    ]),
    objectiveTemplate: z.string().min(1).max(65_536),
    requiredCapabilities: uniqueArtifactIdentifiersSchema,
    requiredEffectRefs: uniqueArtifactIdentifiersSchema,
    coveredCriterionTemplateIds: uniqueArtifactIdentifiersSchema,
    evidenceRequirements: uniqueArtifactIdentifiersSchema,
    artifactRequirements: uniqueArtifactIdentifiersSchema,
    inputTemplate: JsonValueSchema,
    assumptionsAllowed: uniqueArtifactIdentifiersSchema,
    constraints: z.array(z.string().min(1).max(65_536)).max(256),
  })
  .strict();

const SkillGoalDependencyTemplateSchema = z
  .object({
    dependencyKey: artifactIdentifierSchema,
    predecessorNodeKey: artifactIdentifierSchema,
    successorNodeKey: artifactIdentifierSchema,
    predicate: z.enum(['required', 'optional']),
    condition: ConditionExpressionSchema.optional(),
  })
  .strict();

const RecoveryBranchTemplateSchema = z
  .object({
    trigger: ConditionExpressionSchema,
    requiredCapabilities: uniqueArtifactIdentifiersSchema,
    planPatchTemplate: JsonValueSchema,
    maximumApplications: z.number().int().min(1).max(16),
    sideEffectReplayPolicy: z.enum(['forbidden', 'explicitly_safe']),
  })
  .strict();

export const PlanTemplateArtifactDefinitionSchema = z
  .object({
    goalPattern: z
      .object({
        objectiveTemplate: z.string().min(1).max(65_536),
        criterionTemplates: z.array(CriterionTemplateSchema).min(1).max(256),
      })
      .strict(),
    parameterSchema: JsonValueSchema,
    parameterBindings: z
      .array(TemplateParameterDefinitionSchema)
      .max(256)
      .refine(
        (values) => new Set(values.map((value) => value.parameterName)).size === values.length,
        'Parameter names must be unique.',
      ),
    skillGoalGraph: z
      .object({
        nodes: z.array(SkillGoalNodeTemplateSchema).min(1).max(256),
        dependencies: z.array(SkillGoalDependencyTemplateSchema).max(256),
      })
      .strict(),
    completionContractTemplate: z
      .object({
        titleTemplate: z.string().min(1).max(65_536),
        descriptionTemplate: z.string().min(1).max(65_536),
        criteria: z.array(CriterionTemplateSchema).min(1).max(256),
        evidenceRequirements: uniqueArtifactIdentifiersSchema,
        artifactRequirements: uniqueArtifactIdentifiersSchema,
      })
      .strict(),
    recoveryBranches: z.array(RecoveryBranchTemplateSchema).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    const criterionIds = value.goalPattern.criterionTemplates.map(
      (criterion) => criterion.criterionTemplateId,
    );
    addDuplicateIssue(criterionIds, ['goalPattern', 'criterionTemplates'], context);
    const completionCriterionIds = value.completionContractTemplate.criteria.map(
      (criterion) => criterion.criterionTemplateId,
    );
    addDuplicateIssue(completionCriterionIds, ['completionContractTemplate', 'criteria'], context);
    for (const criterionId of completionCriterionIds) {
      if (!criterionIds.includes(criterionId)) {
        context.addIssue({
          code: 'custom',
          path: ['completionContractTemplate', 'criteria'],
          message: 'Completion criteria must reference goal criterion templates.',
        });
      }
    }

    const nodeKeys = value.skillGoalGraph.nodes.map((node) => node.nodeKey);
    addDuplicateIssue(nodeKeys, ['skillGoalGraph', 'nodes'], context);
    value.skillGoalGraph.nodes.forEach((node, index) => {
      if (
        node.coveredCriterionTemplateIds.some((criterionId) => !criterionIds.includes(criterionId))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['skillGoalGraph', 'nodes', index, 'coveredCriterionTemplateIds'],
          message: 'Covered criteria must reference goal criterion templates.',
        });
      }
    });

    const edgeKeys = new Set<string>();
    addDuplicateIssue(
      value.skillGoalGraph.dependencies.map((dependency) => dependency.dependencyKey),
      ['skillGoalGraph', 'dependencies'],
      context,
    );
    const outgoing = new Map(nodeKeys.map((nodeKey) => [nodeKey, [] as string[]]));
    value.skillGoalGraph.dependencies.forEach((dependency, index) => {
      const edgeKey = `${dependency.predecessorNodeKey}->${dependency.successorNodeKey}`;
      if (
        edgeKeys.has(edgeKey) ||
        dependency.predecessorNodeKey === dependency.successorNodeKey ||
        !nodeKeys.includes(dependency.predecessorNodeKey) ||
        !nodeKeys.includes(dependency.successorNodeKey)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['skillGoalGraph', 'dependencies', index],
          message: 'Dependencies require unique, distinct, known endpoints.',
        });
      }
      edgeKeys.add(edgeKey);
      outgoing.get(dependency.predecessorNodeKey)?.push(dependency.successorNodeKey);
    });
    if (!isAcyclic(nodeKeys, outgoing)) {
      context.addIssue({
        code: 'custom',
        path: ['skillGoalGraph', 'dependencies'],
        message: 'Skill Goal dependencies must be acyclic.',
      });
    }
  });

export const DecisionOutputSchema = z
  .object({
    decisionType: z.enum([
      'set_risk',
      'select_template',
      'require_confirmation',
      'select_recovery',
      'select_model',
      'degrade',
    ]),
    parameters: z.record(z.string().min(1).max(128), JsonValueSchema),
    explanationCode: artifactIdentifierSchema,
  })
  .strict();

export const DecisionRuleArtifactDefinitionSchema = z
  .object({
    category: z.enum([
      'risk',
      'routing',
      'confirmation',
      'recovery',
      'degradation',
      'model_selection',
    ]),
    condition: ConditionExpressionSchema,
    decision: DecisionOutputSchema,
    priority: z.number().int().min(0),
    conflictGroup: artifactIdentifierSchema.optional(),
    conflictPolicy: z.enum(['deny_overrides', 'higher_priority', 'most_specific', 'require_human']),
  })
  .strict();

const StructuredConstraintSchema = z.discriminatedUnion('operator', [
  z
    .object({
      field: artifactIdentifierSchema,
      operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']),
      value: JsonValueSchema,
    })
    .strict(),
  z
    .object({
      field: artifactIdentifierSchema,
      operator: z.literal('exists'),
    })
    .strict(),
]);

export const CaseArtifactDefinitionSchema = z
  .object({
    problemFingerprint: z
      .object({
        taskTypeId: artifactIdentifierSchema,
        goalFeatureHash: artifactHashSchema,
        entityClasses: uniqueArtifactIdentifiersSchema,
        environmentClasses: uniqueArtifactIdentifiersSchema,
        eventTypes: uniqueArtifactIdentifiersSchema,
        failureTypes: uniqueArtifactIdentifiersSchema,
        capabilityState: uniqueArtifactIdentifiersSchema,
        constraints: z.array(StructuredConstraintSchema).max(256),
        riskLevel: artifactRiskLevelSchema,
      })
      .strict(),
    solutionPattern: z
      .object({
        planPatchTemplate: JsonValueSchema.optional(),
        recoveryPlanTemplate: JsonValueSchema.optional(),
        decisionSuggestions: z.array(DecisionOutputSchema).max(256),
      })
      .strict()
      .refine(
        (value) =>
          value.planPatchTemplate !== undefined ||
          value.recoveryPlanTemplate !== undefined ||
          value.decisionSuggestions.length > 0,
        'A reusable solution is required.',
      ),
    adaptationRules: z
      .array(
        z
          .object({
            condition: ConditionExpressionSchema,
            action: z.enum(['bind_parameters', 'plan_patch', 'recovery_patch']),
            template: JsonValueSchema,
          })
          .strict(),
      )
      .max(256),
    applicability: z
      .object({
        contextRequirements: z.array(ConditionExpressionSchema).max(256),
        minimumSimilarity: probabilitySchema,
      })
      .strict(),
    failureBoundaries: z
      .array(
        z
          .object({
            condition: ConditionExpressionSchema,
            action: z.enum(['fallback_reasoning', 'require_confirmation', 'deny']),
            reasonCode: artifactIdentifierSchema,
          })
          .strict(),
      )
      .max(256),
    priorOutcomeSummary: z
      .object({
        successRate: probabilitySchema,
        sampleCount: z.number().int().min(0),
        limitations: z.array(z.string().min(1).max(65_536)).max(256),
      })
      .strict(),
  })
  .strict();

const ModelRouteSchema = z.enum([
  'none',
  'local_small',
  'cloud_medium',
  'cloud_reasoning',
  'human',
]);

export const ModelRouteArtifactDefinitionSchema = z
  .object({
    conditions: z.array(ConditionExpressionSchema).max(256),
    route: ModelRouteSchema,
    budget: z
      .object({
        maxTokens: z.number().int().min(0),
        maxLatencyMs: z.number().int().min(0),
        maxCostUnits: z.number().min(0),
      })
      .strict(),
    fallbackRoutes: z
      .array(ModelRouteSchema)
      .max(5)
      .refine((values) => new Set(values).size === values.length, 'Routes must be unique.'),
  })
  .strict();

const CompiledArtifactDefinitionSchema = z.union([
  IntentRouteArtifactDefinitionSchema,
  PlanTemplateArtifactDefinitionSchema,
  DecisionRuleArtifactDefinitionSchema,
  CaseArtifactDefinitionSchema,
  ModelRouteArtifactDefinitionSchema,
]);

export const CompiledArtifactSchema = z
  .object({
    artifactId: artifactIdentifierSchema,
    artifactKey: artifactIdentifierSchema,
    version: z.number().int().min(1),
    artifactType: CompiledArtifactTypeSchema,
    name: z.string().min(1).max(65_536),
    description: z.string().min(1).max(65_536),
    scope: z
      .object({
        tenantId: artifactIdentifierSchema.optional(),
        domain: artifactIdentifierSchema,
        taskTypeIds: uniqueArtifactIdentifiersSchema,
      })
      .strict(),
    definition: CompiledArtifactDefinitionSchema,
    applicability: ArtifactApplicabilitySchema,
    requiredCapabilities: z
      .array(CapabilityRequirementSchema)
      .max(256)
      .refine(
        (values) => new Set(values.map((value) => value.capabilityId)).size === values.length,
        'Capability identifiers must be unique.',
      ),
    requiredPolicies: z
      .array(PolicyReferenceSchema)
      .max(256)
      .refine(
        (values) =>
          new Set(values.map((value) => `${value.policyId}@${value.version}`)).size ===
          values.length,
        'Policy references must be unique.',
      ),
    dependencySnapshot: ArtifactDependencySnapshotSchema,
    riskLevel: artifactRiskLevelSchema,
    status: CompiledArtifactStatusSchema,
    lineageRef: artifactIdentifierSchema,
    validationSummaryRef: artifactIdentifierSchema.optional(),
    contentHash: artifactHashSchema,
    createdAt: artifactTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const signature = {
      intent_route: 'taskTypeId',
      plan_template: 'goalPattern',
      decision_rule: 'category',
      case_template: 'problemFingerprint',
      model_route: 'route',
    } as const;
    if (!(signature[value.artifactType] in value.definition)) {
      context.addIssue({
        code: 'custom',
        path: ['definition'],
        message: 'Artifact type does not match its definition.',
      });
    }
    if (value.status === 'active' && value.validationSummaryRef === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['validationSummaryRef'],
        message: 'Active artifacts require a validation summary reference.',
      });
    }
  });

export const ArtifactLineageSchema = z
  .object({
    lineageId: artifactIdentifierSchema,
    artifactId: artifactIdentifierSchema,
    artifactVersion: z.number().int().min(1),
    sourceEpisodeRefs: uniqueArtifactIdentifiersSchema,
    sourceKnowledgeRefs: uniqueArtifactIdentifiersSchema,
    sourceCorrectionRefs: uniqueArtifactIdentifiersSchema,
    sourcePatternRefs: uniqueArtifactIdentifiersSchema,
    generationMethods: z
      .array(
        z.enum([
          'process_mining',
          'workflow_induction',
          'rule_mining',
          'case_mining',
          'model_assisted_generalization',
          'human_authored',
        ]),
      )
      .min(1)
      .max(6)
      .refine((values) => new Set(values).size === values.length, 'Methods must be unique.'),
    validationRunRefs: uniqueArtifactIdentifiersSchema,
    supersedesArtifactRefs: uniqueArtifactIdentifiersSchema,
  })
  .strict();

export const ArtifactRuntimeBindingSchema = z
  .object({
    bindingId: artifactIdentifierSchema,
    artifactId: artifactIdentifierSchema,
    artifactVersion: z.number().int().min(1),
    runtimeType: z.enum([
      'template_plan_builder',
      'decision_engine',
      'case_adapter',
      'model_router',
    ]),
    compilerVersion: artifactIdentifierSchema,
    compiledPayloadHash: artifactHashSchema,
    compiledAt: artifactTimestampSchema,
  })
  .strict();

function treeDepth(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.length === 0 ? 1 : 1 + Math.max(...children.map(treeDepth));
}

function conditionNodeCount(value: unknown): number {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 0;
  const record = value as Readonly<Record<string, unknown>>;
  if (record['type'] === 'all' || record['type'] === 'any') {
    const children = record['children'];
    if (!Array.isArray(children)) return 1;
    let count = 1;
    for (const child of children as unknown[]) count += conditionNodeCount(child);
    return count;
  }
  if (record['type'] === 'not') return 1 + conditionNodeCount(record['child']);
  return record['type'] === 'atomic' ? 1 : 0;
}

function conditionDepth(value: unknown): number {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 0;
  const record = value as Readonly<Record<string, unknown>>;
  if (record['type'] === 'all' || record['type'] === 'any') {
    const children = record['children'];
    return Array.isArray(children) && children.length > 0
      ? 1 + Math.max(...(children as unknown[]).map(conditionDepth))
      : 0;
  }
  return record['type'] === 'not' ? 1 + conditionDepth(record['child']) : 0;
}

function addDuplicateIssue(
  values: readonly string[],
  path: PropertyKey[],
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', path, message: 'Identifiers must be unique.' });
  }
}

function isAcyclic(
  nodeKeys: readonly string[],
  outgoing: ReadonlyMap<string, readonly string[]>,
): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeKey: string): boolean => {
    if (visiting.has(nodeKey)) return false;
    if (visited.has(nodeKey)) return true;
    visiting.add(nodeKey);
    for (const successor of outgoing.get(nodeKey) ?? []) {
      if (!visit(successor)) return false;
    }
    visiting.delete(nodeKey);
    visited.add(nodeKey);
    return true;
  };
  return nodeKeys.every(visit);
}
