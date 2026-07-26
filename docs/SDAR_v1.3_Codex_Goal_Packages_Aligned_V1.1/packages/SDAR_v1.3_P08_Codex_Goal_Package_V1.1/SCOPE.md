# P08 Scope

## 允许修改

按仓库实际结构映射：

```text
packages/domain/**/runtime/plan-template/**
packages/application/**/runtime/plan-template/**
packages/application/**/runtime/formal-plan-handoff/**
packages/application/**/runtime/template-usage/**
packages/persistence-postgres/**/artifact-usage/**
packages/runtime-redis/**/template-jobs/**
packages/management-api/**/template-runtime/**
apps/server/**/template-runtime/**
apps/console/**/template-evidence/**
infra/postgres/migrations/**
scripts/**
tests/**
docs/execplans/**
reports/goal/**
```

## 可以新增的持久化对象

```text
template_instantiation
template_instantiation_node
template_adaptation
template_formal_handoff
artifact_usage
artifact_usage_outcome_link
template_runtime_feedback_outbox
```

如 P02 已存在 `artifact_execution` / `artifact_feedback`，必须扩展而非建立第二权威。

## 禁止修改

```text
P07 Retrieval / Applicability Semantics
P06 Approval / Active Pointer
P05 Validation Result
P04 Template Definition
v1.2.2 Goal / Plan / Skill / Workflow / Outcome Authority
v1.2.3 Interactive Goal / Planning Authority
Fast Gateway Request Entry
Intent Route Runtime
Decision Rule Runtime
Case Runtime
Model Cascade
Provider / MCP Protocol
A2A Public Protocol
```

## 禁止输出

P08 不得：

- 直接接受 User Request；
- 自己决定 Artifact Route；
- 自己检索 Artifact；
- 自动激活 Artifact；
- 直接调用 Skill / MCP；
- 创建正式 Attempt；
- 启动 Workflow；
- 修改 Goal Contract；
- 修改 Artifact Definition；
- 把 Plan Candidate 当正式 Plan。

## 条件性兼容修复

若现有 Plan Validator / Planning Session 缺少 Adapter Port：

1. 增加最薄 Adapter；
2. 不复制 Validator 规则；
3. 不绕过现有 Goal Version Lock；
4. 不建立第二状态机；
5. 保留现有错误与 Reason Code；
6. 独立提交并重点 Review。
