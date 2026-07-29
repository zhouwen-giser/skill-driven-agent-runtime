# Codex Goal Prompt：执行 SDAR v1.3 P09

你正在执行 SDAR v1.3 十四个正式任务包中的 P09。

## 配置

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Mode: Goal
Package: P09
Repository: zhouwen-giser/skill-driven-agent-runtime
```

## 唯一目标

实现 Active Decision Rule Artifact 的确定性评估、冲突消解与正式权威交接。规则可以产生建议、确认要求、拒绝、回退或受限 Plan Patch Candidate，但不能直接执行 Skill/MCP，也不能绕过现有 Goal、Plan、Policy、Authorization、Workflow 和 Outcome 权威。

## 开始前必须读取

1. 本任务包全部 Markdown；
2. P00～P08 Handoff；
3. P01 Decision Rule Artifact Domain；
4. P02 Artifact Repository / Usage / Audit；
5. P04 Decision Rule Candidate Skeleton / Lineage；
6. P05 Rule Replay / False Positive / Unsafe Allow；
7. P06 Active / Revalidating / Kill Switch；
8. P07 Retrieval / Applicability / Parameter Binding / Policy / Readiness；
9. P08 Formal Planner Handoff；
10. v1.2.2 Goal、Plan Validator、Policy Guard、Skill Goal、Workflow、Outcome、Recovery；
11. v1.2.3 Interactive Goal / Planning / Correction；
12. 当前 Authorization、Operator Identity、Tenant、World State、Business Event 和 Reason Code 约定。

## 强制执行顺序

```text
Baseline
→ Handoff Validation
→ Runtime Contract
→ Active / Version / Policy Recheck
→ Evaluation Context
→ Rule DSL
→ Deterministic Evaluation
→ Conflict Resolution
→ Policy / Authorization Override
→ Decision / Advice
→ Plan Patch Candidate
→ Existing Validator / Planning Handoff
→ Usage / Outcome
→ Drift / Revalidation Signal
→ Tests
→ Evidence
→ Read-only Review
→ Commit / Push / Draft PR
```

## 必须实现

- RuleRuntime Port；
- RuleDecisionContext；
- Active Rule Recheck；
- Rule Condition DSL；
- Typed Operand / Operator；
- Required / Forbidden / Unknown 语义；
- Deterministic Evaluation；
- Rule Priority；
- Specificity；
- Scope；
- Conflict Resolution；
- Safety Policy Override；
- Authorization Check；
- RuleDecision；
- RuleAdvice；
- Require Confirmation；
- Deny；
- Fallback；
- Bounded Parameter Suggestion；
- Bounded Plan Patch Candidate；
- Existing Plan Validator Adapter；
- Existing Planning Session / P08 Formal Handoff Adapter；
- Idempotency / CAS；
- Rule Usage Record；
- Formal Outcome Correlation；
- False Positive / Correction / Fallback Drift；
- Revalidation Signal；
- P10 Handoff。

## 禁止实现

- Fast Gateway Orchestrator；
- 正式 Request 入口改造；
- Intent Route Runtime；
- Artifact Retrieval / Ranking；
- Plan Template Runtime 重实现；
- Case Runtime；
- Model Cascade；
- 自动 Skill Selection；
- 直接创建 Skill Attempt；
- 直接调用 Skill / MCP；
- Rule 直接修改 Goal / Criterion / Authorization；
- Rule 绕过现有 Plan Validator；
- Rule 绕过 Existing Planning Authority；
- Rule 覆盖 Safety Policy；
- LLM 动态生成生产 Rule；
- Rule 自动批准 / 激活。

## 核心判断

Rule Match 不等于允许执行。

最终决策必须按以下权威顺序：

```text
Safety / Authorization Policy
> Confirmed Goal Contract
> Current Capability / Readiness
> Active Rule Hard Conditions
> Rule Priority / Specificity
> Rule Ranking / Confidence
```

任何 Deny、Forbidden Condition、Missing Authorization、Stale Rule、Policy Mismatch、Critical Uncertainty 都必须硬阻断。

## 完成后

交付 P10 Handoff。P10 可以编排 P07/P08/P09 的确定性端口，但不得重新实现规则评估或改变 P09 的权威顺序。
