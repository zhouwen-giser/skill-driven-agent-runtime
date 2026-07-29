# SDAR v1.3 P07 Codex Goal Package V1.1

## 任务定位

```text
P07：Artifact Retrieval / Applicability
原子 Goal：G13 + G14
阶段：Online Runtime Foundation
```

P07 接收 P06 已激活且治理有效的 Artifact，建立在线候选检索、渐进加载、候选排序、适用性、参数绑定、Capability / Readiness / Policy 硬门禁。

```text
Active Artifact
→ Exact / Structured / Semantic Retrieval
→ Progressive Loading
→ Candidate Ranking
→ Applicability
→ Parameter Binding
→ Capability / Readiness / Policy
→ Eligible / Adapt / Fallback / Confirm / Deny
```

本任务包不重复携带 v1.3 总体设计材料。

## 执行基线

```text
未来 v1.2.3 完成并冻结后的最新 origin/main
+
P01～P06 已合入
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

## P07 目标

交付：

- Active Artifact Index；
- Exact / Structured / Semantic Retrieval；
- Level-0 / Level-1 / Level-2 Progressive Loading；
- Tenant / Domain / Task Type / Risk / Status Filter；
- Candidate Ranking；
- Ambiguity Detection；
- Applicability Evaluator；
- Required / Optional / Forbidden Condition；
- Parameter Binding；
- Source / Confidence / Trust；
- Capability Shape Check；
- Current Skill Candidate Check；
- Provider Readiness Check；
- Safety Policy Check；
- Dependency Snapshot Validation；
- OOD / Uncertainty；
- Reason Codes；
- Cache / Invalidation；
- P08 Template Runtime Handoff。

## 不属于 P07

```text
Fast Gateway Orchestration
正式 Request 入口改造
Template Runtime
Plan Candidate 提交
Rule Runtime
Case Runtime
Model Cascade
正式 Skill / MCP 调用
Artifact Approval / Activation 修改
```
