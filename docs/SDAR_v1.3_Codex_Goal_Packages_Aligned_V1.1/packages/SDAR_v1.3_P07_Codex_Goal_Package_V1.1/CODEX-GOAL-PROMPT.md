# Codex Goal Prompt：执行 SDAR v1.3 P07

你正在执行 SDAR v1.3 十四个正式任务包中的 P07。

## 配置

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Mode: Goal
Package: P07
Repository: zhouwen-giser/skill-driven-agent-runtime
```

## 唯一目标

建立只面向 `active` Artifact 的在线检索与适用性判定基础设施，为 P08 Template Runtime 和 P10 Fast Gateway 提供确定性、可解释、Fail-closed 的候选与决策输入。

## 开始前必须读取

1. 本任务包全部 Markdown；
2. P00～P06 Handoff；
3. P01 Artifact Domain；
4. P02 Artifact Repository / Cache / Outbox；
5. P06 Active Query / Status / Revalidation / Kill Switch；
6. v1.2.3 Capability Summary / Task Type / Goal Contract；
7. v1.2.2 Skill Registry / Provider Readiness / Policy / Plan Validator；
8. 现有 Memory / Embedding / pgvector / FTS 基础设施；
9. 当前 Tenant / Authorization / World State / Request Context。

## 强制执行顺序

```text
Baseline
→ Handoff Validation
→ Active Index Contract
→ Exact / Structured Retrieval
→ Semantic Retrieval
→ Progressive Loading
→ Ranking / Ambiguity
→ Applicability
→ Parameter Binding
→ Dependency Validation
→ Capability / Skill / Readiness
→ Policy
→ OOD / Uncertainty
→ Cache / Invalidation
→ Performance
→ Tests
→ Evidence
→ Read-only Review
→ Commit / Push / Draft PR
```

## 必须实现

- ArtifactIndexEntry；
- Active-only Query；
- Tenant / Domain / Task Type / Risk Filter；
- Exact Pattern / Structured Hint；
- Semantic Embedding Retrieval；
- Progressive Level 0 / 1 / 2；
- Candidate Ranking；
- Deterministic Tie-break；
- Ambiguity Detection；
- ApplicabilityResult；
- Required / Optional / Forbidden Condition；
- ParameterBindingResult；
- Parameter Source / Trust / Confidence；
- Capability Requirement Check；
- Current Skill Candidate Check；
- Provider Readiness Check；
- Dependency Snapshot Check；
- Safety Policy Decision；
- OOD / Uncertainty；
- Reason Code Catalog；
- Cache Key / Invalidation；
- Performance Report；
- P08 Handoff。

## 禁止实现

- Fast Gateway Orchestrator；
- 正式 User Request 入口；
- Artifact 自动执行；
- Template Plan 实例化；
- Goal Contract 创建；
- UserGoalPlan 提交；
- Rule Runtime；
- Case Runtime；
- Model Cascade；
- Candidate / Revalidating / Deprecated 检索为在线候选；
- Score 覆盖硬拒绝条件；
- 历史成功替代当前 Readiness；
- Cache 替代 PostgreSQL；
- 模型静默补齐授权、目标、范围或完成标准。

## 关键判断

候选总分只用于排序，不能决定是否可执行。

以下必须作为硬门禁：

```text
non-active
tenant mismatch
forbidden condition
missing required parameter
dependency mismatch
capability gap
skill unavailable
provider not ready
policy deny
critical uncertainty
out-of-distribution
```

## 完成后

交付 P08 Handoff。P08 只允许消费 `eligible` 或明确 `requires_adaptation` 的 Plan Template Artifact，不得重新实现 Retrieval / Applicability。
