# SDAR v1.3 P05 Codex Goal Package V1.1

## 任务定位

```text
P05：Replay Dataset 与 Validation Engine
原子 Goal：G09 + G10
阶段：Validation
```

P05 接收 P04 生成的不可运行 Artifact Candidate 和 Plan Template Candidate，建立可重放的数据集与验证引擎。

```text
Artifact Candidate
→ Replay Dataset
→ Static / Plan / Rule / Counterfactual Replay
→ Validation Result
→ Counterexample
```

本任务包不重复携带 v1.3 总体设计材料。

## 执行基线

执行时必须满足：

```text
未来 v1.2.3 完成并冻结后的最新 origin/main
+
P01～P04 已合入
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

## P05 目标

交付：

- ReplayCase；
- Dataset Manifest；
- Discovery / Development / Holdout / Counterexample Split；
- Source Lineage；
- No-Physical Provider；
- Plan Replay；
- Rule Replay；
- Counterfactual Replay；
- 基础 Case Replay Contract；
- Validation Metric Catalog；
- Immutable Validation Result；
- Failure / Counterexample；
- Baseline Comparison；
- Performance / Capacity；
- P06 Shadow / Promotion Handoff。

## 不属于 P05

```text
Shadow Runtime
Human Approval
Promotion
Active Artifact
Active Pointer Switch
Fast Gateway
Template Runtime
Rule Runtime
Case Runtime
Model Cascade
正式 Skill/MCP 执行
```
