# MASTER GOAL：SDAR v1.3 P03

## Goal ID

```text
SDAR-V1.3-P03
```

## 原子 Goal

```text
G05：Experience Trace Normalization
G06：Process Variant 与 Workflow Pattern Mining
```

## 目标

形成如下离线编译基础：

```text
GoalExperienceEpisode
PlanningInteraction
SkillAttempt
Workflow
Outcome
Recovery
Business Event
Artifact Feedback（未来）
        |
        v
ExperienceTrace
        |
        v
Cohort
        |
        v
Process Variant
        |
        v
Workflow Pattern
```

## 输入权威

P03 只能读取正式权威：

- v1.2.3 GoalExperienceEpisode；
- PlanningInteraction / Correction；
- Skill Goal / Attempt；
- Workflow / MCP Task；
- Outcome Judgment；
- Recovery Assessment；
- Business Event Impact；
- Capability / Task Type 已激活知识；
- P02 Artifact Feedback 接口若已经存在。

## 输出权威

P03 输出的是：

```text
Trace Fact
Pattern Candidate Fact
```

它们不是 Active Artifact，也不具有执行权限。

## 完成合同

P03 完成必须同时满足：

- Trace 可从来源事实确定性重建；
- 顺序、并行、分支、失败、恢复不丢失；
- PII、Credential、私有思维链不进入 Trace；
- Cohort 作用域和租户隔离明确；
- Variant / Pattern 算法有版本；
- Pattern 含支持、反例和环境覆盖；
- Worker 幂等、可重放、可恢复；
- PostgreSQL 为持久化权威；
- 不修改正式在线任务；
- 不生成 Artifact Candidate；
- P04 Handoff 完整。
