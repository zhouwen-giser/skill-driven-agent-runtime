# P09 Domain Contract

## RuleDecisionContext

```ts
interface RuleDecisionContext {
  requestRef: string;

  goalContractRef?: string;
  goalVersion?: number;
  planRef?: string;
  planVersion?: number;

  artifactRef: string;
  artifactVersion: number;
  artifactHash: string;
  activePointerVersion: number;

  tenantId: string;
  authorizationRefs: string[];

  requestSnapshotRef: string;
  worldStateSnapshotRef?: string;
  businessEventRefs: string[];

  parameterBindingRef: string;
  capabilityReadinessRef: string;
  policyDecisionRef: string;
  dependencyValidationRef: string;

  runtimeSnapshotHash: string;
}
```

## RuleConditionResult

```ts
interface RuleConditionResult {
  conditionId: string;
  result: "true" | "false" | "unknown";

  operandRefs: string[];
  observedValues: unknown[];
  operator: string;

  reasonCodes: string[];
}
```

## RuleEvaluationResult

```ts
interface RuleEvaluationResult {
  evaluationId: string;
  ruleRef: string;
  ruleHash: string;

  matched: boolean;
  unknown: boolean;

  conditionResults: RuleConditionResult[];

  proposedAction:
    | "advise"
    | "require_confirmation"
    | "deny"
    | "fallback"
    | "suggest_parameter"
    | "propose_plan_patch"
    | "no_match";

  actionPayload?: unknown;

  evaluatorVersion: string;
  runtimeSnapshotHash: string;
  resultHash: string;

  createdAt: string;
}
```

## RuleConflictResolution

```ts
interface RuleConflictResolution {
  resolutionId: string;
  evaluationRefs: string[];

  selectedRuleRefs: string[];
  suppressedRuleRefs: string[];

  disposition:
    | "single_rule"
    | "combined_compatible"
    | "deny_overrides"
    | "confirmation_overrides"
    | "ambiguous_fallback"
    | "no_match";

  policySeverity: string;
  specificityOrder: string[];
  reasonCodes: string[];

  resolverVersion: string;
  resultHash: string;
}
```

## RuleDecision

```ts
interface RuleDecision {
  decisionId: string;
  requestRef: string;

  disposition:
    | "advice"
    | "require_confirmation"
    | "deny"
    | "fallback"
    | "plan_patch_candidate"
    | "no_match"
    | "discarded_stale"
    | "failed";

  selectedRuleRefs: string[];

  advice?: unknown;
  planPatchCandidateRef?: string;

  policyDecisionRef: string;
  authorizationCheckRef: string;

  reasonCodes: string[];
  runtimeSnapshotHash: string;

  createdAt: string;
}
```

## RulePlanPatchCandidate

```ts
interface RulePlanPatchCandidate {
  patchCandidateId: string;

  goalContractRef: string;
  goalVersion: number;
  planRef?: string;
  planVersion?: number;

  sourceRuleRefs: string[];

  patchOperations: RulePlanPatchOperation[];
  affectedCriterionRefs: string[];
  requiredConfirmations: string[];

  bounded: true;
  contentHash: string;
}
```
