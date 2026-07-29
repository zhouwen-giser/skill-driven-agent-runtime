# P11 Domain Contract

## CaseRuntimeRequest

```ts
interface CaseRuntimeRequest {
  gatewayRequestRef: string;
  requestRef: string;

  goalContextRef: string;
  goalVersion: number;

  artifactRef: string;
  artifactVersion: number;
  artifactHash: string;
  activePointerVersion: number;

  applicabilityRef: string;
  parameterBindingRef: string;
  policyDecisionRef: string;

  deadlineAt: string;
  cancellationRef: string;
  runtimeSnapshotHash: string;
}
```

## CaseRuntimeResult

```ts
interface CaseRuntimeResult {
  caseRunId: string;
  artifactRef: string;

  disposition:
    | "plan_candidate"
    | "requires_confirmation"
    | "fallback"
    | "deny"
    | "discarded_stale"
    | "failed";

  sourceCaseRefs: string[];
  adaptationRef?: string;
  planCandidateRef?: string;
  formalHandoffRef?: string;

  reasonCodes: string[];
  resultHash: string;
  completedAt: string;
}
```

## ModelRouteContext

```ts
interface ModelRouteContext {
  gatewayRequestRef: string;
  requestRef: string;
  tenantId: string;

  taskTypeId?: string;
  operationType: string;
  riskLevel: string;
  dataClassification: string;

  requiredCapabilities: string[];
  outputSchemaRef: string;

  deadlineAt: string;
  budget: {
    maxCostUnits: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxInvocations: number;
  };

  policySnapshotHash: string;
  providerProfileSnapshotHash: string;
}
```

## ModelRouteDecision

```ts
interface ModelRouteDecision {
  routeDecisionId: string;
  artifactRef: string;

  selectedProfileRefs: string[];
  cascadePolicyRef: string;

  disposition:
    | "selected"
    | "fallback"
    | "require_confirmation"
    | "deny"
    | "no_ready_model"
    | "budget_exhausted"
    | "discarded_stale"
    | "failed";

  reasonCodes: string[];
  decisionHash: string;
  createdAt: string;
}
```

## ModelCascadeRun

```ts
interface ModelCascadeRun {
  cascadeRunId: string;
  routeDecisionRef: string;

  status:
    | "running"
    | "completed"
    | "fallback"
    | "cancelled"
    | "timed_out"
    | "budget_exhausted"
    | "failed";

  stepRefs: string[];
  selectedOutputRef?: string;
  totalCostUnits: number;
  totalInputTokens: number;
  totalOutputTokens: number;

  completedAt?: string;
}
```
