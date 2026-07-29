# Codex Goal Prompt：执行 SDAR v1.3 P04

你正在执行 SDAR v1.3 十四个正式任务包中的 P04。

## 配置

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Mode: Goal
Package: P04
Repository: zhouwen-giser/skill-driven-agent-runtime
```

## 唯一目标

将 P03 产生的结构化 Workflow Pattern 进行语义归一与泛化，生成不可运行的 Artifact Candidate，并重点实现 Plan Template Candidate Compiler。

## 开始前必须读取

1. 本任务包全部 Markdown；
2. P00、P01、P02、P03 Handoff；
3. P01 Artifact Domain；
4. P02 Artifact Repository / Governance；
5. P03 ExperienceTrace、ProcessPattern、WorkflowPattern；
6. v1.2.3 Goal Contract、Plan、Skill Goal、Capability Summary、Outcome Specification；
7. v1.3 设计中 Artifact、Plan Template Compiler、Validation 的章节。

## 强制工作顺序

```text
Baseline
→ Handoff Validation
→ Pattern Fusion
→ Generalization
→ Candidate Generator
→ Step Classification
→ Capability Mapping
→ Skill Goal DAG Template
→ Parameter Extraction
→ Completion Contract
→ Recovery Template
→ Static Validation
→ Persistence
→ Tests
→ Evidence
→ Read-only Review
→ Commit / Push / Draft PR
```

## 必须实现

- FusedPattern；
- GeneralizedPattern；
- VariableDefinition；
- Invariant；
- Required / Forbidden Condition；
- CompiledArtifact Candidate；
- PlanTemplateCandidate；
- Candidate Status = candidate；
- Step Classification；
- Capability Mapping；
- Skill Goal Node Template；
- Dependency Template；
- Parameter Schema；
- Trusted Source Policy；
- Completion Contract Template；
- Evidence / Artifact Requirements；
- Recovery Branch Template；
- Candidate Quality；
- Candidate Lineage；
- Static Validator；
- Duplicate Candidate Fingerprint；
- Model-assisted Generalization Audit；
- Candidate Persistence。

## 禁止实现

- Replay Result；
- Validation Pass/Fail；
- Approval；
- Active Artifact；
- Active Pointer；
- Fast Gateway；
- Plan Template Runtime；
- Rule Runtime；
- Case Runtime；
- Model Cascade；
- User Goal Plan Commit；
- Skill / MCP 调用。

## 模型边界

LLM 只允许生成：

- 名称候选；
- 参数抽象候选；
- Capability 语义映射候选；
- Negative Example 候选；
- Pattern 解释候选。

模型不能：

- 修改 P03 统计事实；
- 决定 Candidate 有效；
- 生成 Approval；
- 将 Candidate 激活；
- 绕过静态 Validator。

## 完成后

交付精确 P05 Handoff，使 P05 可以构建 Replay Dataset 和执行验证，而无需重新定义 Candidate Contract。
