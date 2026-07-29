# SDAR v1.3 P11 Codex Goal Package V1.1

## 任务定位

```text
P11：Case Runtime 与 Model Route / Cascade
原子 Goal：G19 + G20
阶段：Online Runtime Extension
```

P11 在 P10 Fast Gateway 的 Adapter Registry 基础上新增两类 Runtime Artifact：

```text
case_template
model_route
```

形成：

```text
Active Case Template
→ Similar Case Retrieval
→ Constraint-safe Adaptation
→ Plan Candidate
→ P08 Formal Planner Handoff

Active Model Route
→ Task / Risk / Budget / Deadline
→ Model Tier Selection
→ Bounded Cascade
→ Existing Model Provider Adapter
→ Formal Cognitive / Planner Authority
```

本任务包不重复携带 v1.3 总体设计材料。

## 执行基线

```text
未来 v1.2.3 完成并冻结后的最新 origin/main
+
P01～P10 已合入
+
P00 = READY_FULL
```

## 执行模型

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Implementation Agent: 1
Review: 独立只读 Review Pass
```

## P11 主要交付

### Case Runtime

- CaseTemplateRuntime Port；
- Case Retrieval Query；
- Similarity / Applicability；
- Case Constraint / Failure Boundary；
- Case Adaptation；
- Case Plan Candidate；
- Case Evidence / Outcome Link；
- P08 Formal Planner Handoff；
- Case Usage / Drift。

### Model Route / Cascade

- ModelRouteRuntime Port；
- ModelRouteDecision；
- Model Capability / Quality / Cost / Latency Profile；
- Budget / Deadline；
- Deterministic Route Policy；
- Small→Medium→Large Cascade；
- Validation / Confidence Gate；
- Fallback；
- Provider Readiness；
- Rate / Capacity；
- Model Usage / Cost / Outcome；
- Model Route Drift。

## 不属于 P11

```text
修改 P10 Gateway 核心编排顺序
第二套 Artifact Retrieval
第二套 Planner / Workflow / Policy Engine
Case 直接执行 Skill/MCP
模型直接创建正式 Goal/Plan
模型绕过 Existing Validator
模型自动批准 Artifact
模型凭据进入 Artifact
模型自评替代正式 Outcome
```
