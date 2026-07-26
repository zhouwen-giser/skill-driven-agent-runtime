# SDAR v1.3 P09 Codex Goal Package V1.1

## 任务定位

```text
P09：Decision Rule 与 Policy Runtime
原子 Goal：G16
阶段：Online Runtime
```

P09 接收 P07 已完成检索与适用性判定的 Active Decision Rule Artifact，在不创建第二执行权威的前提下完成确定性条件评估、冲突消解、策略门禁和正式规划交接。

```text
P07 Eligible Decision Rule
→ Rule Evaluation
→ Conflict Resolution
→ Safety / Authorization Policy
→ Advice / Confirm / Deny / Fallback / Plan Patch Candidate
→ Existing Formal Authority
```

本任务包不重复携带 v1.3 总体设计材料。

## 执行基线

```text
未来 v1.2.3 完成并冻结后的最新 origin/main
+
P01～P08 已合入
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

## P09 主要交付

- RuleRuntime Port；
- RuleDecisionContext；
- RuleCondition DSL；
- Active Rule Recheck；
- Required / Forbidden / Uncertain 条件评估；
- Deterministic Rule Evaluation；
- Rule Priority / Specificity / Scope；
- Rule Conflict Resolution；
- Safety / Authorization Policy Override；
- RuleDecision；
- Rule Advice；
- Confirmation Requirement；
- Deny / Fallback；
- Bounded Plan Patch Candidate；
- P08 Formal Handoff Adapter；
- Rule Usage / Outcome Correlation；
- Rule Drift / Revalidation Signal；
- P10 Handoff。

## 不属于 P09

```text
Fast Gateway Request Orchestration
Intent Routing
Artifact Retrieval / Ranking
Plan Template Instantiation
Case Runtime
Model Cascade
正式 Skill / MCP 执行
Rule 自动审批 / 激活
第二套 Policy Authority
第二套 Planner / Workflow
```
