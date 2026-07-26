# MASTER GOAL：SDAR v1.3 P11

## Goal ID

```text
SDAR-V1.3-P11
```

## 原子 Goal

```text
G19：Case Template Runtime
G20：Model Route 与模型级联
```

## 目标

建立：

```text
P10 Fast Gateway Adapter Registry
        |
        +→ Case Template Adapter
        |      |
        |      v
        |   Case Adaptation
        |      |
        |      v
        |   P08 Formal Handoff
        |
        +→ Model Route Adapter
               |
               v
           Model Selection / Cascade
               |
               v
           Existing Provider Adapter
               |
               v
           Existing Formal Authority
```

## 输入权威

### Case

- Active `case_template`；
- P07 Match / Applicability；
- Confirmed Goal Contract；
- Current World / Policy / Readiness；
- Historical Case Structure；
- Failure Boundary；
- Formal Outcome；
- P08 Formal Handoff。

### Model Route

- Active `model_route`；
- Request / Goal / Task Type；
- Risk / Data Classification；
- Deadline / Budget；
- Current Model Profile；
- Provider Readiness；
- Rate / Capacity；
- Existing Provider Adapter；
- Output Schema / Validator；
- Formal Outcome。

## 输出权威

P11 输出：

```text
CaseRuntimeResult
CasePlanCandidate
ModelRouteDecision
ModelCascadeRun
ModelInvocationUsage
```

它们不是正式 Goal、Plan、Workflow 或 Outcome。

## 权威边界

```text
Current Goal / Policy / Readiness
> Historical Case

Existing Plan Validator / Formal Planner
> Case Plan Candidate

Current Provider / Model Profile
> Artifact Historical Route

Output Schema / Policy
> Model Confidence

Formal Outcome
> Model Self-evaluation

P10 Deadline / Cancellation
> Cascade Continuation
```

## 完成合同

- Case 只使用 Active Artifact；
- Case 不复制实例标识 / PII；
- Case Adaptation 有边界；
- Case Failure Boundary 被保留；
- Case Plan 通过 P08 / Existing Validator；
- Model Route 无 Credential；
- Model 选择确定性、可审计；
- Budget / Deadline 有界；
- Current Provider Readiness 被检查；
- 输出 Schema / Safety 校验；
- 失败可以升级或回退；
- 无限级联被禁止；
- 正式 Outcome 与使用可关联；
- 未改变 P10 Gateway；
- 未建立第二 Planner；
- P12 Handoff 完整。
