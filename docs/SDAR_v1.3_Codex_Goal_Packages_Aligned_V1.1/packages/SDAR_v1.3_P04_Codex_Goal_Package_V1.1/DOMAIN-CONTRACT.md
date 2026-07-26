# P04 Domain Contract

## FusedPattern

```ts
interface FusedPattern {
  fusedPatternId: string;
  sourceWorkflowPatternRef: string;
  sourceProcessPatternRef: string;
  sourceTraceRefs: string[];

  structuralPattern: StructuralPattern;
  semanticCandidate: SemanticPatternCandidate;
  applicabilityCandidate: ApplicabilityCandidate;

  supportRefs: string[];
  contradictionRefs: string[];
  confidence: number;

  fusionVersion: string;
  contentHash: string;
}
```

## GeneralizedPattern

```ts
interface GeneralizedPattern {
  generalizedPatternId: string;
  domain: string;
  taskTypeId: string;

  variables: GeneralizedVariable[];
  invariants: Invariant[];
  requiredConditions: ConditionExpression[];
  forbiddenConditions: ConditionExpression[];

  retainedExampleRefs: string[];
  counterexampleRefs: string[];

  sourceFusedPatternRef: string;
  generalizerVersion: string;
  contentHash: string;
}
```

## CompiledArtifact Candidate

```ts
interface CompiledArtifact Candidate {
  artifactId: string;
  artifactKey: string;
  version: number;
  artifactType:
    | "intent_route"
    | "plan_template"
    | "decision_rule"
    | "case_template"
    | "model_route";

  status: "candidate";
  executable: false;

  definition: unknown;
  applicability: ArtifactApplicabilityCandidate;
  requiredCapabilities: CapabilityRequirement[];

  lineageRef: string;
  staticValidationRef: string;
  dependencySnapshot: ArtifactDependencySnapshotCandidate;

  generatorVersion: string;
  contentHash: string;
}
```

P04 可以为全部 Artifact Type 建立 Candidate Generator 框架，但产品实现重点是 `plan_template`。

## PlanTemplateCandidateDefinition

```ts
interface PlanTemplateCandidateDefinition {
  goalPattern: {
    objectiveTemplate: string;
    criterionTemplates: CriterionTemplate[];
  };

  parameterSchema: JsonSchema;
  parameterBindings: ParameterBindingRule[];

  skillGoalGraph: {
    nodes: SkillGoalNodeTemplate[];
    dependencies: SkillGoalDependencyTemplate[];
  };

  completionContractTemplate: CompletionContractTemplate;
  recoveryBranches: RecoveryBranchTemplate[];
}
```

## SkillGoalNodeTemplate

```ts
interface SkillGoalNodeTemplate {
  nodeKey: string;
  nodeType:
    | "action"
    | "observation"
    | "reasoning"
    | "verification"
    | "recovery"
    | "human_gate";

  objectiveTemplate: string;
  requiredCapabilities: string[];

  requiredEffectRefs: string[];
  coveredCriterionTemplateIds: string[];
  evidenceRequirements: string[];
  artifactRequirements: string[];

  inputTemplate: unknown;
  assumptionsAllowed: string[];
  constraints: string[];
}
```

## ParameterDefinition

```ts
interface TemplateParameterDefinition {
  parameterName: string;
  schema: JsonSchema;
  required: boolean;

  allowedSources:
    | "user_confirmed"
    | "request"
    | "world_state"
    | "runtime_context"
    | "small_model_candidate";

  trustLevel: "authoritative" | "trusted" | "candidate";
  defaultPolicy: "none" | "low_risk_only";
}
```

## RecoveryBranchTemplate

```ts
interface RecoveryBranchTemplate {
  trigger: FailureCondition;
  requiredCapabilities: string[];
  planPatchTemplate: unknown;
  maximumApplications: number;
  sideEffectReplayPolicy: "forbidden" | "explicitly_safe";
}
```

## StaticValidationResult

```ts
interface CandidateStaticValidationResult {
  candidateRef: string;
  schemaValid: boolean;
  dagValid: boolean;
  requiredCriteriaCovered: boolean;
  capabilityShapeValid: boolean;
  parameterPolicyValid: boolean;
  sideEffectReplaySafe: boolean;
  boundsValid: boolean;
  duplicateFingerprint?: string;

  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  validatorVersion: string;

  result: "passed_static" | "failed_static";
}
```

`passed_static` 不等于验证通过或可激活。
