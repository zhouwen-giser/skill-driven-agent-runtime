# MASTER GOAL：SDAR v1.3 P08

## Goal ID

```text
SDAR-V1.3-P08
```

## 原子 Goal

```text
G15：Plan Template Runtime 与 Formal Planner Handoff
```

## 目标

建立：

```text
Active Plan Template
+
P07 Applicability / Binding
+
Confirmed Goal Contract
        |
        v
Materialized Plan Candidate
        |
        v
Existing Plan Validator
        |
        v
Existing Planning Session / Confirmation
        |
        v
Existing UserGoalPlan Authority
```

## 输入权威

- P07 Artifact Ref / Hash / Version；
- P07 Applicability；
- P07 Parameter Binding；
- P07 Capability / Skill / Readiness；
- P07 Policy Decision；
- P07 Dependency Snapshot；
- Confirmed Goal Contract；
- Current Goal Version；
- Active Artifact Pointer；
- Current Catalog / Policy / Readiness；
- P04 Template Definition；
- P06 Kill Switch / Revalidation State。

## 输出权威

P08 输出：

```text
TemplateInstantiationResult
MaterializedPlanCandidate
FormalPlanHandoffResult
ArtifactUsageRecord
```

其中只有现有正式规划权威接受后的 UserGoalPlan 才是正式 Plan。

## 权威边界

```text
Confirmed Goal Contract
> Template Objective

Existing Plan Validator
> Template Static Validation

Existing Planning Session / User Confirmation
> Template Confidence

UserGoalPlanController / Existing Formal Planner
> P08 Runtime

Current Policy / Readiness
> P07 Snapshot / Historical Validation

Active Pointer
> Cached Artifact
```

## 完成合同

- 只处理 Active `plan_template`；
- 重新检查 Active / Hash / Goal Version / Policy / Catalog / Readiness；
- 参数绑定来源不被篡改；
- Capability Requirement 不被替换为 Exact Skill；
- Completion Criterion 全覆盖；
- Recovery 不重复已完成副作用；
- Bounded Adaptation 有明确边界；
- Existing Plan Validator 被复用；
- Existing Planning Session / Confirmation 被复用；
- UserGoalPlan Authority 不变；
- Idempotency / CAS 正确；
- Stale 结果丢弃；
- Artifact Usage / Outcome 可关联；
- 不实现 Fast Gateway；
- P09 Handoff 完整。
