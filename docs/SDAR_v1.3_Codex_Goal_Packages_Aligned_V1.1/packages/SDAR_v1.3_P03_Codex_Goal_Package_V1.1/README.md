# SDAR v1.3 P03 Codex Goal Package V1.1

## 任务定位

```text
P03：Experience Trace 与 Pattern Mining
原子 Goal：G05 + G06
阶段：Offline Compiler
```

P03 是 v1.3 首个真正进入“经验编译链”的任务包：

```text
v1.2.3 Experience Facts
→ Experience Trace
→ Cohort
→ Process Variant
→ Workflow Pattern
```

本任务包不重复携带 v1.3 总体材料。执行时必须读取：

- P00 Handoff；
- P01 Artifact Domain Handoff；
- P02 Persistence / Registry / Governance Handoff；
- 仓库中已经冻结的 v1.3 设计文档或其路径；
- v1.2.3 完成态的 Experience / Knowledge 接口与数据模型。

## 执行基线

真实执行基线必须是：

```text
未来 v1.2.3 完成并冻结后的最新 origin/main
+
P01 已合入
+
P02 已合入
```

当前仓库只可作为参考，不得在任务包中硬编码当前 SHA。

## 执行模型

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Implementation Agent: 1
Review: 独立只读 Review Pass
```

## P03 目标

交付：

- Experience Trace Domain；
- Trace Normalization；
- Source Lineage；
- Redaction / Classification；
- Cohort Fingerprint；
- Process Variant；
- Direct-Follows / Precedence；
- Mandatory / Optional / Recovery Pattern；
- 基础 Fitness / Precision / Coverage；
- PostgreSQL Trace / Pattern Candidate 持久化；
- 异步幂等 Worker；
- 离线验证与报告。

## 不属于 P03

```text
Artifact Candidate Generator
Plan Template Compiler
Decision Rule Candidate
Case Candidate
Model Route Candidate
Replay Promotion
Shadow Promotion
Fast Gateway
Artifact Runtime
```

这些属于 P04 及后续任务包。

## 最终输出

P03 必须输出可供 P04 使用的冻结合同：

```text
ExperienceTrace
DiscoveredProcessPattern
WorkflowPattern
CohortDefinition
PatternEvidence
PatternQuality
PatternLineage
```
