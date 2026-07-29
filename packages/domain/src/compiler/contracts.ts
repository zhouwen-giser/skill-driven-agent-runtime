export const ARTIFACT_CONTRACT_VERSION = '1.1' as const;

export const COMPILED_ARTIFACT_TYPES = Object.freeze([
  'intent_route',
  'plan_template',
  'decision_rule',
  'case_template',
  'model_route',
] as const);

export const COMPILED_ARTIFACT_STATUSES = Object.freeze([
  'discovered',
  'candidate',
  'validating',
  'awaiting_approval',
  'active',
  'revalidating',
  'deprecated',
  'archived',
  'rejected',
] as const);

export const ARTIFACT_CONTRACT_SCHEMA_HASHES = Object.freeze({
  CompiledArtifactType: '2dc5bd1322559c8ae0f5dabe945e69c01b6cb69ad379ceaa0f633f2e88072cea',
  CompiledArtifactStatus: '266a7448640bf17113b431919c1fb6113b022e1b9d8a932b9443404f620c8ba5',
  CompiledArtifact: '8afcafacad1085eb35d7b3fb0dd7715b05e7ff279f0d78b529a4b64fbe39bdcf',
  ArtifactApplicability: '4af9af86a57212d4120637a0c97484890eb6c34e729fd7d90d6d893c32bf47c8',
  ArtifactDependencySnapshot: 'ab5eb452c0299802016cf8771536a2796cf656c8117a67d0a8c6158aca2e127a',
  ConditionExpression: 'db033c6d65b1123fefd8185a8424eb6e227d8fea5978c599c48a7c835db5607e',
  IntentRouteArtifactDefinition: '7a95d4c0620a5623725cb5672d22433a47981f8b239997a3e872a597378b8f7a',
  PlanTemplateArtifactDefinition:
    'b089d44944f3db3c5fcfff016a5b56f5d3482d89088448697b5cd4f20d425d04',
  SkillGoalNodeTemplate: 'f8deaf1d8882195927d9c5070262fd14c8e894e084eaafc29e193dff8f3cb0a7',
  DecisionRuleArtifactDefinition:
    '5710c7a6e2aa4b76f19449776af894cf039140f3f35a88fc14525ecbef920e85',
  DecisionOutput: 'e1b890a30d853179f36092c01e1404c5b811f1cc54a63b98bf3eef9045877dc9',
  CaseArtifactDefinition: 'c1b03024222e19ed2834e25accdb8e4d841ae3e2d35ea28ecba056a79d585ea5',
  ModelRouteArtifactDefinition: '2f271f5b96f9d83675b2176ea8f7a8eea76a86f1e3cc5e52c255a42cb6016678',
  ArtifactLineage: 'aa6629a29c59194e6584813656dd3a0b930da324f2a8e9e3002d9580310b6f57',
  ArtifactRuntimeBinding: '52a678f6ef4de068f780d94aad27bcb4ae080f1ab3351b64c0f608719ba3a337',
} as const);

export type CompiledArtifactType = (typeof COMPILED_ARTIFACT_TYPES)[number];
export type CompiledArtifactStatus = (typeof COMPILED_ARTIFACT_STATUSES)[number];
export type ArtifactRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type JsonPrimitive = string | number | boolean | null;
// A recursive Record alias is rejected by TypeScript; the index signature is the equivalent form.
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export interface ArtifactScope {
  readonly tenantId?: string;
  readonly domain: string;
  readonly taskTypeIds: readonly string[];
}

export interface CapabilityRequirement {
  readonly capabilityId: string;
  readonly minimumVersion?: string;
}

export interface PolicyReference {
  readonly policyId: string;
  readonly version: string;
}

export type AtomicConditionOperator =
  'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists';

export type ConditionExpression =
  | {
      readonly type: 'all' | 'any';
      readonly children: readonly ConditionExpression[];
      readonly child?: never;
      readonly field?: never;
      readonly operator?: never;
      readonly value?: never;
    }
  | {
      readonly type: 'not';
      readonly children?: never;
      readonly child: ConditionExpression;
      readonly field?: never;
      readonly operator?: never;
      readonly value?: never;
    }
  | {
      readonly type: 'atomic';
      readonly children?: never;
      readonly child?: never;
      readonly field: string;
      readonly operator: AtomicConditionOperator;
      readonly value?: JsonValue;
    };

export interface ArtifactApplicability {
  readonly requiredConditions: readonly ConditionExpression[];
  readonly optionalConditions: readonly ConditionExpression[];
  readonly forbiddenConditions: readonly ConditionExpression[];
  readonly requiredParameters: readonly string[];
  readonly allowedEnvironmentClasses: readonly string[];
  readonly excludedEnvironmentClasses: readonly string[];
  readonly minimumIntentScore: number;
  readonly minimumConditionScore: number;
  readonly maximumUncertainty: number;
  readonly outOfDistributionPolicy: 'fallback_reasoning' | 'require_confirmation' | 'deny';
}

export interface ArtifactDependencySnapshot {
  readonly capabilityCatalogHash: string;
  readonly policyVersionRefs: readonly string[];
  readonly taskTypeVersionRefs: readonly string[];
  readonly schemaVersionRefs: readonly string[];
  readonly requiredSkillVersionRefs: readonly string[];
  readonly compilerVersion: string;
}

export interface ExactPattern {
  readonly pattern: string;
  readonly flags: readonly ('case_insensitive' | 'unicode' | 'whole_input')[];
}

export interface StructuredHint {
  readonly field: string;
  readonly operator: 'eq' | 'in' | 'exists';
  readonly value?: JsonValue;
}

export interface IntentRouteArtifactDefinition {
  readonly taskTypeId: string;
  readonly semanticExamples: readonly string[];
  readonly exactPatterns: readonly ExactPattern[];
  readonly structuredHints: readonly StructuredHint[];
  readonly nextPath: 'plan_template' | 'case_retrieval' | 'small_model' | 'cognitive_runtime';
}

export interface GoalPatternTemplate {
  readonly objectiveTemplate: string;
  readonly criterionTemplates: readonly CriterionTemplate[];
}

export interface CriterionTemplate {
  readonly criterionTemplateId: string;
  readonly statementTemplate: string;
  readonly required: boolean;
}

export interface TemplateParameterDefinition {
  readonly parameterName: string;
  readonly schema: JsonValue;
  readonly required: boolean;
  readonly allowedSources:
    'user_confirmed' | 'request' | 'world_state' | 'runtime_context' | 'small_model_candidate';
  readonly trustLevel: 'authoritative' | 'trusted' | 'candidate';
  readonly defaultPolicy: 'none' | 'low_risk_only';
}

export type SkillGoalNodeType =
  'action' | 'observation' | 'reasoning' | 'verification' | 'recovery' | 'human_gate';

export interface SkillGoalNodeTemplate {
  readonly nodeKey: string;
  readonly nodeType: SkillGoalNodeType;
  readonly objectiveTemplate: string;
  readonly requiredCapabilities: readonly string[];
  readonly requiredEffectRefs: readonly string[];
  readonly coveredCriterionTemplateIds: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly artifactRequirements: readonly string[];
  readonly inputTemplate: JsonValue;
  readonly assumptionsAllowed: readonly string[];
  readonly constraints: readonly string[];
}

export interface SkillGoalDependencyTemplate {
  readonly dependencyKey: string;
  readonly predecessorNodeKey: string;
  readonly successorNodeKey: string;
  readonly predicate: 'required' | 'optional';
  readonly condition?: ConditionExpression;
}

export interface SkillGoalGraphTemplate {
  readonly nodes: readonly SkillGoalNodeTemplate[];
  readonly dependencies: readonly SkillGoalDependencyTemplate[];
}

export interface CompletionContractTemplate {
  readonly titleTemplate: string;
  readonly descriptionTemplate: string;
  readonly criteria: readonly CriterionTemplate[];
  readonly evidenceRequirements: readonly string[];
  readonly artifactRequirements: readonly string[];
}

export interface RecoveryBranchTemplate {
  readonly trigger: ConditionExpression;
  readonly requiredCapabilities: readonly string[];
  readonly planPatchTemplate: JsonValue;
  readonly maximumApplications: number;
  readonly sideEffectReplayPolicy: 'forbidden' | 'explicitly_safe';
}

export interface PlanTemplateArtifactDefinition {
  readonly goalPattern: GoalPatternTemplate;
  readonly parameterSchema: JsonValue;
  readonly parameterBindings: readonly TemplateParameterDefinition[];
  readonly skillGoalGraph: SkillGoalGraphTemplate;
  readonly completionContractTemplate: CompletionContractTemplate;
  readonly recoveryBranches: readonly RecoveryBranchTemplate[];
}

export type DecisionRuleCategory =
  'risk' | 'routing' | 'confirmation' | 'recovery' | 'degradation' | 'model_selection';

export interface DecisionOutput {
  readonly decisionType:
    | 'set_risk'
    | 'select_template'
    | 'require_confirmation'
    | 'select_recovery'
    | 'select_model'
    | 'degrade';
  readonly parameters: JsonObject;
  readonly explanationCode: string;
}

export interface DecisionRuleArtifactDefinition {
  readonly category: DecisionRuleCategory;
  readonly condition: ConditionExpression;
  readonly decision: DecisionOutput;
  readonly priority: number;
  readonly conflictGroup?: string;
  readonly conflictPolicy: 'deny_overrides' | 'higher_priority' | 'most_specific' | 'require_human';
}

export interface StructuredConstraint {
  readonly field: string;
  readonly operator: AtomicConditionOperator;
  readonly value?: JsonValue;
}

export interface ProblemFingerprint {
  readonly taskTypeId: string;
  readonly goalFeatureHash: string;
  readonly entityClasses: readonly string[];
  readonly environmentClasses: readonly string[];
  readonly eventTypes: readonly string[];
  readonly failureTypes: readonly string[];
  readonly capabilityState: readonly string[];
  readonly constraints: readonly StructuredConstraint[];
  readonly riskLevel: ArtifactRiskLevel;
}

export interface CaseSolutionPattern {
  readonly planPatchTemplate?: JsonValue;
  readonly recoveryPlanTemplate?: JsonValue;
  readonly decisionSuggestions: readonly DecisionOutput[];
}

export interface CaseAdaptationRule {
  readonly condition: ConditionExpression;
  readonly action: 'bind_parameters' | 'plan_patch' | 'recovery_patch';
  readonly template: JsonValue;
}

export interface CaseApplicability {
  readonly contextRequirements: readonly ConditionExpression[];
  readonly minimumSimilarity: number;
}

export interface FailureBoundary {
  readonly condition: ConditionExpression;
  readonly action: 'fallback_reasoning' | 'require_confirmation' | 'deny';
  readonly reasonCode: string;
}

export interface PriorOutcomeSummary {
  readonly successRate: number;
  readonly sampleCount: number;
  readonly limitations: readonly string[];
}

export interface CaseArtifactDefinition {
  readonly problemFingerprint: ProblemFingerprint;
  readonly solutionPattern: CaseSolutionPattern;
  readonly adaptationRules: readonly CaseAdaptationRule[];
  readonly applicability: CaseApplicability;
  readonly failureBoundaries: readonly FailureBoundary[];
  readonly priorOutcomeSummary: PriorOutcomeSummary;
}

export interface ModelBudget {
  readonly maxTokens: number;
  readonly maxLatencyMs: number;
  readonly maxCostUnits: number;
}

export interface ModelRouteArtifactDefinition {
  readonly conditions: readonly ConditionExpression[];
  readonly route: 'none' | 'local_small' | 'cloud_medium' | 'cloud_reasoning' | 'human';
  readonly budget: ModelBudget;
  readonly fallbackRoutes: readonly (
    'none' | 'local_small' | 'cloud_medium' | 'cloud_reasoning' | 'human'
  )[];
}

export type CompiledArtifactDefinition =
  | IntentRouteArtifactDefinition
  | PlanTemplateArtifactDefinition
  | DecisionRuleArtifactDefinition
  | CaseArtifactDefinition
  | ModelRouteArtifactDefinition;

export interface CompiledArtifact {
  readonly artifactId: string;
  readonly artifactKey: string;
  readonly version: number;
  readonly artifactType: CompiledArtifactType;
  readonly name: string;
  readonly description: string;
  readonly scope: ArtifactScope;
  readonly definition: CompiledArtifactDefinition;
  readonly applicability: ArtifactApplicability;
  readonly requiredCapabilities: readonly CapabilityRequirement[];
  readonly requiredPolicies: readonly PolicyReference[];
  readonly dependencySnapshot: ArtifactDependencySnapshot;
  readonly riskLevel: ArtifactRiskLevel;
  readonly status: CompiledArtifactStatus;
  readonly lineageRef: string;
  readonly validationSummaryRef?: string;
  readonly contentHash: string;
  readonly createdAt: string;
}

export type ArtifactGenerationMethod =
  | 'process_mining'
  | 'workflow_induction'
  | 'rule_mining'
  | 'case_mining'
  | 'model_assisted_generalization'
  | 'human_authored';

export interface ArtifactLineage {
  readonly lineageId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly sourceEpisodeRefs: readonly string[];
  readonly sourceKnowledgeRefs: readonly string[];
  readonly sourceCorrectionRefs: readonly string[];
  readonly sourcePatternRefs: readonly string[];
  readonly generationMethods: readonly ArtifactGenerationMethod[];
  readonly validationRunRefs: readonly string[];
  readonly supersedesArtifactRefs: readonly string[];
}

export interface ArtifactRuntimeBinding {
  readonly bindingId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly runtimeType:
    'template_plan_builder' | 'decision_engine' | 'case_adapter' | 'model_router';
  readonly compilerVersion: string;
  readonly compiledPayloadHash: string;
  readonly compiledAt: string;
}

export interface ArtifactActivationEvidence {
  readonly validationPassed: boolean;
  readonly approvalRecorded: boolean;
}
