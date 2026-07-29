# P07 Domain Contract

## ArtifactIndexEntry

```ts
interface ArtifactIndexEntry {
  artifactRef: string;
  artifactKey: string;
  artifactVersion: number;
  artifactType: string;

  tenantId?: string;
  domain: string;
  taskTypeIds: string[];
  riskLevel: string;
  status: "active";

  exactPatterns: string[];
  structuredHints: StructuredHint[];
  embeddingRef?: string;

  activePointerVersion: number;
  contentHash: string;
}
```

## ArtifactMatchScore

```ts
interface ArtifactMatchScore {
  intentScore: number;
  structuredConditionScore: number;
  parameterCoverageScore: number;
  capabilityShapeScore: number;
  environmentSimilarityScore: number;
  validationConfidenceScore: number;
  recentReliabilityScore: number;
  riskPenalty: number;
  totalScore: number;
}
```

`totalScore` 只用于排序。

## ArtifactMatch

```ts
interface ArtifactMatch {
  artifactRef: string;
  rank: number;
  score: ArtifactMatchScore;
  retrievalSources: (
    | "exact"
    | "structured"
    | "semantic"
    | "small_model_candidate"
  )[];
  reasonCodes: string[];
}
```

## ArtifactApplicabilityResult

```ts
interface ArtifactApplicabilityResult {
  artifactRef: string;
  applicable: boolean;
  confidence: number;

  satisfiedConditionIds: string[];
  missingConditionIds: string[];
  violatedConditionIds: string[];
  uncertainConditionIds: string[];

  outOfDistribution: boolean;

  disposition:
    | "eligible"
    | "requires_adaptation"
    | "fallback"
    | "require_confirmation"
    | "deny";

  reasonCodes: string[];
}
```

## ParameterBindingResult

```ts
interface ParameterBindingResult {
  artifactRef: string;

  bindings: Record<string, {
    value: unknown;
    source:
      | "user_confirmed"
      | "request"
      | "world_state"
      | "runtime_context"
      | "user_preference"
      | "small_model_candidate";
    trust: "authoritative" | "trusted" | "candidate";
    confidence: number;
  }>;

  missingRequiredParameters: string[];
  rejectedCandidateBindings: string[];
  requiresConfirmation: string[];
}
```

## RuntimeExecutionDecision

```ts
interface RuntimeExecutionDecision {
  decisionId: string;
  requestRef: string;
  artifactRef?: string;

  disposition:
    | "eligible"
    | "requires_adaptation"
    | "fallback"
    | "require_confirmation"
    | "deny";

  matchRef?: string;
  applicabilityRef?: string;
  parameterBindingRef?: string;
  dependencyValidationRef?: string;
  capabilityReadinessRef?: string;
  policyDecisionRef?: string;

  matcherSnapshotHash: string;
  policySnapshotHash: string;
  reasonCodes: string[];

  createdAt: string;
}
```
