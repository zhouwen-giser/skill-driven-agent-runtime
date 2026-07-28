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

## P04R V1.2 Contract Addendum

本节替代本文件中同名 V1.1 结构；未列出的合同继续使用 V1.1。生命周期事实由 `eventType` 表示，真实工作流/业务活动身份由 `activity.activityKey` 表示，二者禁止互换。

```ts
interface ExperienceActivityRef {
  activityKey: string;
  activityKind:
    | "formal_plan_node"
    | "skill_goal"
    | "skill_attempt"
    | "provider_operation"
    | "recovery"
    | "human_gate";
  objectiveSummary: string;
  sourcePlanNodeRef?: string;
  sourceSkillGoalRef?: string;
  sourceAttemptRef?: string;
  operationRef?: string;
  capabilityRefs: string[];
  effectRefs: string[];
}

interface ExperienceTraceEventV12 extends ExperienceTraceEvent {
  activity: ExperienceActivityRef;
}

interface ProcessVariantV12 extends ProcessVariant {
  activitySequence: string[];
  activityKindSequence: ExperienceActivityRef["activityKind"][];
}

interface WorkflowPatternV12 extends WorkflowPattern {
  dependencyPatterns: Array<{
    fromActivityKey: string;
    toActivityKey: string;
    relation: "direct_follows" | "precedes" | "parallel" | "conditional";
    condition?: ConditionExpression;
  }>;
}
```

Process Mining 必须以 `activityKey` 聚合并保留重复 Activity、`A -> A` self-loop、parallel、branch、recovery trigger、resume activity 与 recovery sequence。
