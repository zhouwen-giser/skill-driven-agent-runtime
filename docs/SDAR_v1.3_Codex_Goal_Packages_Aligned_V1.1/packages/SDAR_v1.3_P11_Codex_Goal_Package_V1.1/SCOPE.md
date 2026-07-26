# P11 Scope

## 允许修改

按仓库实际结构映射：

```text
packages/domain/**/runtime/case-template/**
packages/domain/**/runtime/model-route/**
packages/application/**/runtime/case-template/**
packages/application/**/runtime/model-route/**
packages/application/**/runtime/model-cascade/**
packages/application/**/runtime/model-usage/**
packages/model-provider-adapter/**/routing/**
packages/persistence-postgres/**/case-model-usage/**
packages/runtime-redis/**/model-capacity/**
packages/management-api/**/case-model-runtime/**
apps/server/**/gateway-adapters/**
apps/console/**/case-model-evidence/**
infra/postgres/migrations/**
scripts/**
tests/**
docs/execplans/**
reports/goal/**
```

## 可以新增的持久化对象

```text
case_runtime_run
case_adaptation
case_plan_candidate
case_usage
case_usage_outcome_link
model_profile_snapshot
model_route_decision
model_cascade_run
model_cascade_step
model_invocation_usage
model_route_outcome_link
model_route_drift
case_model_feedback_outbox
```

如已有 Model Invocation Audit / Artifact Usage，必须扩展现有权威。

## 禁止修改

```text
P10 Gateway Core Semantics
P07 Retrieval / Applicability
P08 Formal Planner Handoff Authority
P09 Rule Runtime
P06 Approval / Active Pointer
P05 Validation Result
P04 Artifact Definition
v1.2.2 Goal / Plan / Workflow / Outcome Authority
v1.2.3 Cognitive Runtime Authority
Provider Credential Store
MCP Protocol
A2A Public Protocol Semantics
```

## 禁止输出

P11 不得：

- 将 Case 直接变成 Formal Plan；
- Case 直接执行 Skill / MCP；
- 复制历史实体 ID / Credential / PII；
- Model Route 直接创建 Goal / Plan；
- 模型直接启动 Workflow；
- Artifact 持有 Credential；
- 模型选择绕过 Policy / Readiness；
- 无限重试 / 无限升级；
- Deadline 后继续模型调用；
- 自动 Approval / Activation；
- 修改 P10 Route Order。

## 条件性兼容修复

若现有 Model Provider Adapter 缺少 Profile / Usage Port：

1. 增加只读 Profile / Invocation Adapter；
2. 不迁移 Credential 权威；
3. 不让 Artifact 读取 Secret；
4. 复用现有 Provider Error / Retry；
5. 独立提交并重点 Review。
