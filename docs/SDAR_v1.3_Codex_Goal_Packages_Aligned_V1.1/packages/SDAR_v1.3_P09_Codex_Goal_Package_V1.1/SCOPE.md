# P09 Scope

## 允许修改

按仓库实际结构映射：

```text
packages/domain/**/runtime/decision-rule/**
packages/domain/**/runtime/rule-policy/**
packages/application/**/runtime/decision-rule/**
packages/application/**/runtime/rule-conflict/**
packages/application/**/runtime/rule-handoff/**
packages/persistence-postgres/**/rule-usage/**
packages/runtime-redis/**/rule-index/**
packages/management-api/**/rule-runtime/**
apps/server/**/rule-runtime/**
apps/console/**/rule-evidence/**
infra/postgres/migrations/**
scripts/**
tests/**
docs/execplans/**
reports/goal/**
```

## 可以新增的持久化对象

```text
rule_evaluation
rule_condition_result
rule_conflict_resolution
rule_decision
rule_plan_patch_candidate
rule_usage
rule_usage_outcome_link
rule_drift_signal
rule_runtime_feedback_outbox
```

如 P02 已有 Artifact Execution / Feedback 表，必须扩展而非建立第二权威。

## 禁止修改

```text
P07 Retrieval / Applicability
P08 Template Runtime / Formal Handoff Authority
P06 Approval / Active Pointer
P05 Validation Result
P04 Rule Candidate Definition
v1.2.2 Goal / Plan / Skill / Workflow / Outcome Authority
v1.2.3 Interactive Goal / Planning Authority
Fast Gateway Request Entry
Intent Route Runtime
Case Runtime
Model Cascade
Provider / MCP Protocol
A2A Public Protocol
```

## 禁止输出

P09 不得：

- 自己检索 Rule；
- 修改 Artifact Definition；
- 自动激活 Rule；
- 直接创建 Goal；
- 直接创建正式 Plan；
- 直接创建 Attempt；
- 调用 Skill / MCP；
- 写 Formal Outcome；
- 授予 Authorization；
- 自动确认高风险动作；
- 接管正式 Request 入口。

## 条件性兼容修复

若现有 Policy Guard 无法表达 Rule Runtime 所需的只读裁决：

1. 增加最薄的 Policy Query Adapter；
2. 不复制 Policy 规则；
3. 不创建第二 Policy Engine；
4. 保留现有 Deny / Confirm 语义；
5. 独立提交并重点 Review。
