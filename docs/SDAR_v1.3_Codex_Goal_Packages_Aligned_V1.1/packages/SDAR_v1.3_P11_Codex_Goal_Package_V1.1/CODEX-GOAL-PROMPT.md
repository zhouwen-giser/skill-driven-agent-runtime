# Codex Goal Prompt：执行 SDAR v1.3 P11

你正在执行 SDAR v1.3 十四个正式任务包中的 P11。

## 配置

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Mode: Goal
Package: P11
Repository: zhouwen-giser/skill-driven-agent-runtime
```

## 唯一目标

在不改变 P10 Fast Gateway 核心权威顺序的前提下，新增 `case_template` 和 `model_route` 两类 Adapter，实现 Case 复用与模型级联，并将所有正式 Plan / Outcome 继续交由现有 v1.2.2/v1.2.3 权威处理。

## 开始前必须读取

1. 本任务包全部 Markdown；
2. P00～P10 Handoff；
3. P01 Artifact Domain；
4. P02 Artifact Repository / Usage / Audit；
5. P03 ExperienceTrace / Pattern；
6. P04 Case / Model Route Candidate Skeleton；
7. P05 Case / Counterfactual Replay Contract；
8. P06 Active / Revalidation / Kill Switch；
9. P07 Retrieval / Applicability / Binding / Policy / Readiness；
10. P08 Formal Planner Handoff；
11. P09 Rule Runtime；
12. P10 Fast Gateway / Adapter Registry / Deadline / Feedback；
13. 现有 Model Provider Adapter、Model Invocation Audit、Rate Limit、Credential、Retry、Token / Cost Telemetry；
14. v1.2.2/v1.2.3 Goal / Plan / Workflow / Outcome / Recovery。

## 强制执行顺序

```text
Baseline
→ Handoff Validation
→ P10 Adapter Registration
→ Case Runtime Contract
→ Case Retrieval / Applicability
→ Case Adaptation
→ Existing Validator / Formal Handoff
→ Case Usage / Outcome / Drift
→ Model Profile Contract
→ Model Route Policy
→ Cascade Runtime
→ Budget / Deadline / Capacity
→ Existing Provider Adapter
→ Output Validation / Escalation
→ Model Usage / Cost / Outcome / Drift
→ Tests
→ Evidence
→ Read-only Review
→ Commit / Push / Draft PR
```

## 必须实现

### G19

- CaseTemplateRuntime Port；
- CaseRuntimeRequest / Result；
- CaseQuery；
- Active Case Recheck；
- Case Similarity；
- Case Applicability；
- Case Failure Boundary；
- Case Adaptation；
- Parameter / Constraint Mapping；
- CasePlanCandidate；
- P08 Formal Planner Handoff；
- Case Usage / Outcome；
- Case Drift / Revalidation；
- Case Reason Codes。

### G20

- ModelRouteRuntime Port；
- ModelRouteContext；
- ModelProfile；
- ModelRouteArtifact Definition；
- ModelRouteDecision；
- Model Capability / Quality / Cost / Latency / Context Profile；
- Current Provider Readiness；
- Budget；
- Deadline；
- Risk；
- Data Classification；
- Deterministic Selection；
- Cascade Step；
- Output Schema Validation；
- Confidence / Failure Escalation；
- Rate Limit / Circuit / Bulkhead；
- Usage / Token / Cost；
- Formal Outcome Correlation；
- Route Drift / Revalidation；
- Model Reason Codes。

## 禁止实现

- 修改 P10 Gateway 核心顺序；
- 在 Gateway 内写 Case / Model 专用算法；
- 第二套 Retrieval / Applicability；
- 第二套 Plan Validator；
- 第二套 Planner / Workflow；
- Case 直接调用 Skill / MCP；
- Case 原样复制历史实例标识；
- 模型直接提交正式 Plan；
- 模型直接调用 Skill / MCP；
- 模型输出绕过 Schema / Policy / Validator；
- LLM 选择或解密 Credential；
- Artifact 存储 Credential / API Key；
- 模型自评直接决定成功；
- 自动 Approval / Activation；
- 自动修改 Artifact；
- 无预算无限升级；
- Deadline 后继续级联。

## 核心权威顺序

```text
Auth / Tenant / Policy / Deadline
> P10 Gateway

P07 Retrieval / Applicability
> Case / Model Adapter

Confirmed Goal / Current Context
> Historical Case

Existing Plan Validator / Formal Planner
> Case Adaptation / Model Output

Current Provider Readiness / Budget / Policy
> Historical Model Route Success

Formal Outcome
> Model / Case Self-evaluation
```

## 完成后

交付 P12 Handoff，用于 Management API、Console 和 A2A 集成。P12 不得改变 P11 Runtime 语义。
