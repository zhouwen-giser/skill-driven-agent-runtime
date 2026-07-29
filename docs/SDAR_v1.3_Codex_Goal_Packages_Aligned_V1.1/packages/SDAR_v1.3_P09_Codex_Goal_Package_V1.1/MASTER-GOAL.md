# MASTER GOAL：SDAR v1.3 P09

## Goal ID

```text
SDAR-V1.3-P09
```

## 原子 Goal

```text
G16：Decision Rule 与 Policy Runtime
```

## 目标

建立：

```text
Active Decision Rule
+
P07 Applicability / Binding
+
Current Request / Goal / World / Policy
        |
        v
Deterministic Rule Evaluation
        |
        v
Conflict Resolution
        |
        v
Policy / Authorization Override
        |
        v
Advice / Confirm / Deny / Fallback / Plan Patch Candidate
        |
        v
Existing Formal Authority
```

## 输入权威

- P07 Artifact Ref / Hash / Version；
- P07 Applicability / Parameter Binding；
- P07 Capability / Skill / Readiness；
- P07 Policy Decision；
- Confirmed Goal Contract；
- Current Goal / Plan Version；
- Trusted World State；
- Current Business Event；
- Authorization；
- Active Rule Definition；
- P06 Active Pointer / Kill Switch；
- P05 Validation / Unsafe / Counterexample；
- P08 Formal Planner Handoff Port。

## 输出权威

P09 输出：

```text
RuleEvaluationResult
RuleConflictResolution
RuleDecision
RuleAdvice
RulePlanPatchCandidate
RuleUsageRecord
```

这些结果本身不是正式 Goal、Plan、Attempt、Workflow 或 Outcome。

## 权威边界

```text
Safety / Authorization Policy
> Rule Decision

Confirmed Goal Contract
> Rule Advice

Existing Plan Validator
> Rule Plan Patch

Existing Planning Authority
> Rule Confidence

Current Capability / Readiness
> Historical Rule Success

Formal Outcome
> Rule Usage Projection

P06 Active Pointer
> Cached Rule
```

## 完成合同

- 只评估 Active decision_rule；
- Rule Hash / Pointer / Goal / Policy / Catalog / Readiness 重检；
- Rule DSL 有严格类型；
- 相同输入产生相同结果；
- Unknown 不被当 True；
- Conflict Resolution 稳定且可解释；
- Safety / Authorization 覆盖 Rule；
- Rule 不能改变 Goal / Criterion；
- Rule Plan Patch 有界；
- Existing Validator / Planning Authority 被复用；
- Rule 不直接调用 Skill / MCP；
- Usage / Outcome 可关联；
- Drift 可触发 Revalidation；
- 未实现 Fast Gateway；
- P10 Handoff 完整。
