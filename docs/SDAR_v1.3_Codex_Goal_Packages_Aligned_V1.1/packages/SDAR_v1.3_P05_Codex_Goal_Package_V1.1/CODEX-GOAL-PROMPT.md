# Codex Goal Prompt：执行 SDAR v1.3 P05

你正在执行 SDAR v1.3 十四个正式任务包中的 P05。

## 配置

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Mode: Goal
Package: P05
Repository: zhouwen-giser/skill-driven-agent-runtime
```

## 唯一目标

建立安全、可重放、数据集无泄漏的 Artifact Replay 与 Validation Engine，为 P06 Shadow / Promotion 提供不可变验证证据。

## 开始前必须读取

1. 本任务包全部 Markdown；
2. P00～P04 Handoff；
3. P02 Validation Persistence / Governance；
4. P03 ExperienceTrace / Pattern；
5. P04 ArtifactCandidate / PlanTemplateCandidate / StaticValidation；
6. v1.2.2 Goal / Plan Validator / Workflow / Provider / Outcome / Recovery；
7. v1.2.3 Experience / Interaction / Accepted Plan / Outcome / Replay 基础；
8. 当前测试、Simulation/Replay Header、租户与删除传播机制。

## 强制工作顺序

```text
Baseline
→ Handoff Validation
→ Replay Safety Boundary
→ ReplayCase Contract
→ Dataset Builder
→ Dataset Split / Leakage Guard
→ No-Physical Provider
→ Plan Replay
→ Rule Replay
→ Counterfactual Replay
→ Metrics
→ Immutable Validation Result
→ Counterexample
→ Performance / Capacity
→ Tests
→ Evidence
→ Read-only Review
→ Commit / Push / Draft PR
```

## 必须实现

- ArtifactReplayCase；
- Replay Dataset Manifest；
- Discovery Set；
- Candidate Development Set；
- Promotion Holdout Set；
- Counterexample Set；
- Tenant / Goal / Episode / Time Leakage Guard；
- Snapshot Version；
- No-Physical Provider；
- Side-effect Deny；
- Plan Replay；
- Rule Replay；
- Counterfactual Replay；
- Validation Metric Catalog；
- Baseline Planner Comparison；
- Criterion Coverage；
- Fitness / Precision / Generalization Proxy；
- False Positive / False Negative；
- Unsafe Allow / Missed Confirmation；
- Latency / Token / Model Call Cost；
- Immutable Validation Result；
- Validation Failure；
- Counterexample；
- Dataset / Artifact / Validator Hash；
- bounded worker；
- deterministic re-run。

## 禁止实现

- Shadow 线上旁路；
- Human Approval；
- Promotion；
- Active Artifact；
- Runtime Route；
- Active Pointer；
- Fast Gateway；
- Template Runtime；
- Rule Runtime；
- 真实 Skill / MCP 副作用；
- 自动修改 Candidate Definition；
- 模型自评替代 Outcome。

## 核心判断

历史 Accepted Plan 和历史 Outcome 是重要证据，但不是自动 Gold Standard。验证必须同时检查：

- Goal Contract；
- Required Criterion；
- Evidence / Artifact；
- Policy；
- Capability / Readiness Snapshot；
- User Correction；
- Final Outcome；
- Counterexample。

## 完成后

交付精确 P06 Handoff。P06 只能消费 P05 的不可变 Validation Result，不得让 Promotion Worker 重算或篡改 P05 指标。
