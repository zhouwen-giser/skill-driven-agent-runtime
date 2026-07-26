# P10 Domain Contract

## GatewayRequestContext

```ts
interface GatewayRequestContext {
  gatewayRequestId: string;
  requestRef: string;

  tenantId: string;
  authenticatedActorRef: string;
  authorizationRefs: string[];

  requestSnapshotRef: string;
  conversationRef?: string;

  deadlineAt: string;
  cancellationRef: string;

  policySnapshotHash: string;
  catalogSnapshotHash: string;
  activePointerSnapshotHash: string;

  idempotencyKey: string;
  createdAt: string;
}
```

## GatewayStageResult

```ts
interface GatewayStageResult {
  stage:
    | "precheck"
    | "retrieval"
    | "rule"
    | "template"
    | "fallback"
    | "formal_handoff";

  status:
    | "not_run"
    | "succeeded"
    | "failed"
    | "timed_out"
    | "cancelled"
    | "discarded_stale"
    | "skipped";

  disposition?: string;
  resultRef?: string;
  reasonCodes: string[];

  startedAt?: string;
  completedAt?: string;
}
```

## GatewayDecision

```ts
interface FastGatewayDecision {
  gatewayDecisionId: string;
  gatewayRequestRef: string;

  route:
    | "rule"
    | "plan_template"
    | "cognitive_fallback"
    | "require_confirmation"
    | "deny"
    | "failed";

  selectedArtifactRefs: string[];

  stageResults: GatewayStageResult[];

  formalHandoffRequired: boolean;
  formalHandoffRef?: string;

  reasonCodes: string[];

  runtimeSnapshotHash: string;
  decisionHash: string;

  createdAt: string;
}
```

## GatewayResult

```ts
interface FastGatewayResult {
  gatewayRequestRef: string;
  gatewayDecisionRef: string;

  disposition:
    | "formal_handoff_committed"
    | "interaction_required"
    | "fallback_started"
    | "denied"
    | "cancelled"
    | "timed_out"
    | "failed";

  formalGoalRef?: string;
  formalPlanRef?: string;
  formalInteractionRef?: string;
  fallbackExecutionRef?: string;

  reasonCodes: string[];
  completedAt: string;
}
```

## GatewayFeedbackEnvelope

```ts
interface GatewayFeedbackEnvelope {
  feedbackId: string;
  gatewayRequestRef: string;
  gatewayDecisionRef: string;

  selectedArtifactRefs: string[];
  formalGoalRef?: string;
  formalPlanRef?: string;
  formalOutcomeRef?: string;

  feedbackType:
    | "route_selected"
    | "fallback"
    | "confirmation"
    | "denial"
    | "formal_handoff"
    | "outcome"
    | "correction"
    | "recovery"
    | "performance"
    | "drift";

  payload: unknown;
  sourceRefs: string[];
  createdAt: string;
}
```
