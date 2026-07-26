# SDAR v1.3 P04 Codex Goal Package V1.1

## 任务定位

```text
P04：Artifact Candidate 与 Plan Template Compiler
原子 Goal：G07 + G08
阶段：Offline Compiler
```

P04 接收 P03 输出的 Experience Trace、Process Pattern 与 Workflow Pattern，将其转换为结构化 Artifact Candidate，重点生成可供后续 Replay 验证的 Plan Template Candidate。

```text
Workflow Pattern
→ Pattern Generalization
→ Artifact Candidate
→ Plan Template Candidate
```

本任务包不重复携带 v1.3 总体设计材料。

## 执行基线

执行时必须满足：

```text
未来 v1.2.3 完成并冻结后的最新 origin/main
+
P01 已合入
+
P02 已合入
+
P03 已合入
```

## 执行模型

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Implementation Agent: 1
Review: 独立只读 Review Pass
```

## P04 目标

交付：

- Pattern Generalization；
- Variable / Invariant / Negative Condition；
- Pattern Fusion；
- CompiledArtifact Candidate Generator；
- Plan Template Candidate；
- Step Classification；
- Capability Mapping；
- Skill Goal DAG Template；
- Parameter Schema；
- Completion Contract Template；
- Recovery Branch Template；
- Static Validation；
- Candidate Lineage；
- Candidate Persistence；
- P05 Replay Handoff。

## 不属于 P04

```text
Replay Validation
Shadow
Promotion / Active
Fast Gateway
Template Runtime
Rule Runtime
Case Runtime
Model Cascade
正式 Goal / Plan 提交
MCP / Skill 执行
```
