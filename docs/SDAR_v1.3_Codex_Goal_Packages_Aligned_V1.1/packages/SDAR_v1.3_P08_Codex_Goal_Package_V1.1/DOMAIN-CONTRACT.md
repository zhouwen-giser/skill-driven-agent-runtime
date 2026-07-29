# P08 Domain Contract

## TemplateInstantiationInput

```ts
interface TemplateInstantiationInput {
  requestRef: string;
  goalContractRef: string;
  goalVersion: number;

  artifactRef: string;
  artifactVersion: number;
  artifactHash: string;
  activePointerVersion: number;

  applicabilityRef: string;
  parameterBindingRef: string;
  dependencyValidationRef: string;
  capabilityReadinessRef: string;
  policyDecisionRef: string;

  matcherSnapshotHash: string;
  policySnapshotHash: string;

  idempotencyKey: string;
}
```

## GoalContextSnapshot

```ts
interface GoalContextSnapshot {
  goalContractRef: string;
  goalVersion: number;

  objective: string;
  requiredCriterionRefs: string[];
  optionalCriterionRefs: string[];
  evidenceRequirementRefs: string[];
  artifactRequirementRefs: string[];

  targetScope: unknown;
  constraints: unknown[];
  authorizationRefs: string[];
  riskLevel: string;

  contentHash: string;
}
```

## MaterializedPlanCandidate

```ts
interface MaterializedPlanCandidate {
  planCandidateId: string;

  sourceArtifactRef: string;
  sourceArtifactHash: string;

  goalContractRef: string;
  goalVersion: number;

  parameterBindings: Record<string, unknown>;

  nodes: MaterializedSkillGoalNode[];
  dependencies: MaterializedDependency[];
  completionContract: MaterializedCompletionContract;
  recoveryBranches: MaterializedRecoveryBranch[];

  adaptationRefs: string[];

  criterionCoverage: {
    requiredCriterionRefs: string[];
    coveredCriterionRefs: string[];
    missingCriterionRefs: string[];
  };

  runtimeSnapshotHash: string;
  contentHash: string;
}
```

## TemplateInstantiationResult

```ts
interface TemplateInstantiationResult {
  instantiationId: string;
  requestRef: string;
  artifactRef: string;

  disposition:
    | "ready_for_validation"
    | "requires_confirmation"
    | "fallback"
    | "deny"
    | "discarded_stale"
    | "failed";

  planCandidateRef?: string;
  missingParameters: string[];
  requiredConfirmations: string[];
  reasonCodes: string[];

  createdAt: string;
}
```

## FormalPlanHandoffResult

```ts
interface FormalPlanHandoffResult {
  handoffId: string;
  planCandidateRef: string;

  disposition:
    | "submitted_to_planning_session"
    | "confirmed_and_committed"
    | "requires_confirmation"
    | "rejected_by_validator"
    | "discarded_stale"
    | "fallback"
    | "failed";

  formalPlanningSessionRef?: string;
  formalPlanRef?: string;
  formalPlanVersion?: number;

  validationRef?: string;
  goalLockRef?: string;

  reasonCodes: string[];
  completedAt: string;
}
```
