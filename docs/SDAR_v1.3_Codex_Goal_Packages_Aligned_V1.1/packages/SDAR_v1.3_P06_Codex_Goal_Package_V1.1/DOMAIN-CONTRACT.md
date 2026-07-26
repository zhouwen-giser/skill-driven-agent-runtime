# P06 Domain Contract

## ArtifactShadowRun

```ts
interface ArtifactShadowRun {
  shadowRunId: string;
  artifactRef: string;
  artifactHash: string;
  formalRequestRef: string;
  formalGoalRef?: string;
  formalPlanRef?: string;
  formalGoalVersion?: number;
  formalPlanVersion?: number;
  status: "queued" | "running" | "completed" | "discarded_stale" | "failed" | "cancelled";
  shadowMode: "decision_only" | "plan_only" | "decision_and_plan";
  startedAt: string;
  completedAt?: string;
}
```

## ArtifactShadowResult

```ts
interface ArtifactShadowResult {
  shadowRunRef: string;
  artifactRef: string;
  shadowDecisionRef?: string;
  shadowPlanRef?: string;
  formalPlanRef?: string;
  formalOutcomeRef?: string;
  comparison: Record<string, number | undefined>;
  policyViolation: boolean;
  unsafeAttempt: boolean;
  stale: boolean;
  resultHash: string;
  evaluatorVersion: string;
  completedAt: string;
}
```

## ArtifactPromotionPackage

```ts
interface ArtifactPromotionPackage {
  promotionPackageId: string;
  artifactRef: string;
  artifactHash: string;
  validationSummaryRef: string;
  validationSummaryHash: string;
  shadowSummaryRef: string;
  shadowSummaryHash: string;
  counterexampleSummaryRef: string;
  counterexampleSummaryHash: string;
  riskReviewRef: string;
  riskReviewHash: string;
  dependencySnapshotRef: string;
  dependencySnapshotHash: string;
  promotionPolicyVersion: string;
  eligibility: "eligible_for_review" | "needs_more_data" | "ineligible" | "unsafe";
  contentHash: string;
  createdAt: string;
}
```

## Approval / Activation / Revalidation

Approval 绑定精确 PromotionPackage Hash；Activation 绑定 Approval Hash 和 Active Pointer Version；RevalidationTrigger 必须包含 triggerType、sourceRefs、severity 和时间。
