# P05 Domain Contract

## ArtifactReplayCase

```ts
interface ArtifactReplayCase {
  replayCaseId: string;
  tenantId: string;

  requestSnapshotRef: string;
  goalContractSnapshotRef: string;
  capabilityCatalogSnapshotRef: string;
  worldStateSnapshotRef?: string;
  policySnapshotRef: string;
  readinessSnapshotRef?: string;

  acceptedPlanSnapshotRef?: string;
  executionTraceSnapshotRef?: string;
  outcomeSnapshotRef: string;
  correctionRefs: string[];

  environmentClass: string;
  deviceClass?: string;
  taskTypeId: string;

  sourceEpisodeRefs: string[];
  goalLineageHash: string;
  snapshotCompleteness: number;
  contentHash: string;
}
```

## ReplayDatasetManifest

```ts
interface ReplayDatasetManifest {
  datasetId: string;
  datasetVersion: number;

  purpose:
    | "discovery"
    | "candidate_development"
    | "promotion_holdout"
    | "counterexample";

  tenantId: string;
  taskTypeIds: string[];
  caseRefs: string[];

  splitPolicyVersion: string;
  sourceRange: { from: string; to: string };
  sourceHash: string;
  contentHash: string;

  leakageCheckRef: string;
  createdAt: string;
}
```

## ReplayRun

```ts
interface ReplayRun {
  replayRunId: string;
  candidateRef: string;
  datasetRef: string;

  replayType:
    | "static"
    | "plan"
    | "rule"
    | "case"
    | "counterfactual";

  validatorVersion: string;
  metricCatalogVersion: string;

  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
}
```

## ValidationResult

```ts
interface ArtifactValidationResult {
  validationRunId: string;
  artifactRef: string;
  datasetRef: string;

  validationType:
    | "static"
    | "replay"
    | "counterfactual";

  metrics: Record<string, number>;
  failureRefs: string[];
  counterexampleRefs: string[];

  unsafe: boolean;
  result:
    | "passed"
    | "failed"
    | "needs_more_data"
    | "unsafe";

  validatorVersion: string;
  metricCatalogVersion: string;
  artifactHash: string;
  datasetHash: string;
  resultHash: string;

  completedAt: string;
}
```

## ValidationFailure

```ts
interface ValidationFailure {
  failureId: string;
  validationRunRef: string;
  replayCaseRef: string;

  category:
    | "schema"
    | "criterion_coverage"
    | "policy_violation"
    | "unsafe_allow"
    | "missed_confirmation"
    | "capability_gap"
    | "readiness_gap"
    | "side_effect_attempt"
    | "plan_invalid"
    | "outcome_regression"
    | "snapshot_incomplete"
    | "unknown";

  severity: "info" | "minor" | "major" | "critical";
  expectedRef?: string;
  actualRef?: string;
  evidenceRefs: string[];
  explanation: string;
}
```

## Counterexample

```ts
interface ArtifactCounterexample {
  counterexampleId: string;
  artifactRef: string;
  replayCaseRef: string;
  failureRef: string;

  conditionFingerprint: string;
  environmentClass: string;
  failureBoundaryCandidate: unknown;

  sourceRefs: string[];
  status: "recorded" | "reviewed" | "superseded";
  createdAt: string;
}
```
