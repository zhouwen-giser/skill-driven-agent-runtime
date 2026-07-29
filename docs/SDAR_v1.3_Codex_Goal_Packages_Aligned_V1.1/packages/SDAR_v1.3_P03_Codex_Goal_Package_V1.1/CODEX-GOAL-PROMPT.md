# Codex Goal Prompt：执行 SDAR v1.3 P03

你正在执行 SDAR v1.3 十四个正式任务包中的 P03。

## 配置

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Mode: Goal
Package: P03
Repository: zhouwen-giser/skill-driven-agent-runtime
```

## 唯一目标

把 v1.2.3 已冻结的 Experience / Planning / Outcome 事实转换为可重放的 Experience Trace，并从 Trace 中发现确定性的 Process Variant 与 Workflow Pattern。

## 开始前必须读取

1. 本任务包全部 Markdown；
2. P00 Handoff；
3. P01 Handoff；
4. P02 Handoff；
5. 仓库 AGENTS.md；
6. v1.2.3 Experience、Observer、Extractor、Outcome、Recovery、Business Event 代码；
7. PostgreSQL Migration、Repository、BullMQ Worker 和现有数据分类/删除机制；
8. v1.3 设计中 Experience Compilation 与 Plan Template Compiler 的相关章节。

## 强制工作顺序

```text
Baseline
→ Source Authority Inventory
→ Trace Contract
→ Normalization
→ Persistence
→ Worker
→ Cohort
→ Variant Mining
→ Workflow Pattern
→ Quality Metrics
→ Tests
→ Evidence
→ Read-only Review
→ Commit / Push / Draft PR
```

## 必须实现

- ExperienceTrace；
- ExperienceTraceEvent；
- SourceRef / AuthorityRef；
- Trace Completeness；
- Data Classification；
- Redaction Policy；
- Goal / Capability / Environment Fingerprint；
- Cohort Query；
- Process Variant；
- Direct-Follows；
- Precedence；
- Mandatory / Optional Activity；
- Parallel Candidate；
- Recovery Branch；
- Failure Variant；
- Pattern Quality；
- Pattern Repository；
- 幂等 Job；
- Dead Letter / bounded retry；
- 删除传播；
- 不阻断在线任务。

## 禁止实现

- Artifact Candidate；
- Plan Template；
- Rule Candidate；
- Case Candidate；
- Active Artifact；
- Promotion；
- Fast Gateway；
- Runtime Handoff；
- 新 Workflow Engine；
- 生产 Python Sidecar。

## 关键判断

LLM 只允许作为离线语义辅助候选，不允许覆盖结构化事件顺序、Process Mining 统计或权威 Outcome。

## 完成后

必须交付精确 P04 Handoff，P04 不得重新解释 Trace 或重新定义 Workflow Pattern。
