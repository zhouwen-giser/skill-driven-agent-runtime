# P03 Domain Contract

## ExperienceTrace

```ts
interface ExperienceTrace {
  traceId: string;
  sourceEpisodeRef: string;
  tenantId: string;
  taskTypeRefs: string[];

  goalFingerprint: string;
  capabilityFingerprint: string;
  environmentFingerprint: string;

  events: ExperienceTraceEvent[];
  corrections: ExperienceCorrectionRef[];
  outcomeRef: string;

  completeness: number;
  classification: DataClassification;
  normalizerVersion: string;
  sourceHash: string;
  createdAt: string;
}
```

## ExperienceTraceEvent

```ts
interface ExperienceTraceEvent {
  eventId: string;
  sequence: number;
  occurredAt: string;

  eventType:
    | "goal_created"
    | "goal_contract_confirmed"
    | "plan_created"
    | "plan_confirmed"
    | "skill_goal_ready"
    | "skill_attempt_started"
    | "skill_attempt_completed"
    | "workflow_waiting"
    | "workflow_failed"
    | "recovery_started"
    | "human_intervention"
    | "plan_revised"
    | "business_event_observed"
    | "goal_completed"
    | "goal_failed";

  actorType: "user" | "agent" | "runtime" | "provider";
  capabilityRefs: string[];
  authorityRefs: string[];
  parentEventRefs: string[];
  concurrencyGroup?: string;
  branchRef?: string;
  payloadSummary: unknown;
}
```

具体类型需按仓库正式事件补充，不能凭本文件覆盖现有事实。

## CohortDefinition

```ts
interface CohortDefinition {
  tenantId: string;
  taskTypeId: string;
  goalFingerprint?: string;
  capabilityFingerprint?: string;
  environmentClass?: string;
  deviceClass?: string;
  timeRange?: { from: string; to: string };
  minimumCompleteness: number;
}
```

## Process Variant

```ts
interface ProcessVariant {
  variantId: string;
  activitySequence: string[];
  concurrencyGroups: string[][];
  branchSequence: string[];
  occurrenceCount: number;
  traceRefs: string[];
  successCount: number;
  failureCount: number;
}
```

## DiscoveredProcessPattern

```ts
interface DiscoveredProcessPattern {
  patternId: string;
  cohortHash: string;
  algorithmVersion: string;

  mandatoryActivities: string[];
  optionalActivities: string[];
  orderingConstraints: OrderingConstraint[];
  parallelCandidates: ParallelCandidate[];
  recoveryBranches: RecoveryPattern[];
  failureVariants: FailureVariant[];

  supportTraceRefs: string[];
  contradictionTraceRefs: string[];
  environmentCoverage: string[];

  quality: PatternQuality;
}
```

## WorkflowPattern

WorkflowPattern 是对 Process Pattern 的可供 P04 编译输入，不是 Plan Template：

```ts
interface WorkflowPattern {
  workflowPatternId: string;
  taskTypeId: string;
  activityPatterns: ActivityPattern[];
  dependencyPatterns: DependencyPattern[];
  recoveryPatterns: RecoveryPattern[];
  sourceProcessPatternRef: string;
  sourceTraceRefs: string[];
  quality: PatternQuality;
}
```
