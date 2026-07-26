# P10 Scope

## 允许修改

按仓库实际结构映射：

```text
packages/domain/**/runtime/fast-gateway/**
packages/application/**/runtime/fast-gateway/**
packages/application/**/runtime/gateway-feedback/**
packages/application/**/runtime/gateway-fallback/**
packages/persistence-postgres/**/gateway/**
packages/runtime-redis/**/gateway/**
packages/management-api/**/gateway/**
packages/a2a-adapter/**/gateway-evidence/**
apps/server/**/request-entry/**
apps/console/**/gateway-evidence/**
infra/postgres/migrations/**
scripts/**
tests/**
docs/execplans/**
reports/goal/**
```

## 可以新增的持久化对象

```text
fast_gateway_request
fast_gateway_decision
fast_gateway_stage
fast_gateway_fallback
fast_gateway_formal_handoff
fast_gateway_feedback
artifact_runtime_metric
artifact_runtime_drift
gateway_revalidation_signal
gateway_feedback_outbox
```

如 P02 已有 Artifact Usage / Feedback 表，必须复用或扩展。

## 禁止修改

```text
P07 Retrieval / Applicability Algorithms
P09 Rule DSL / Evaluator / Conflict
P08 Template Runtime / Formal Handoff Authority
P06 Approval / Active Pointer
P05 Validation Result
v1.2.2 Goal / Plan / Skill / Workflow / Outcome Authority
v1.2.3 Cognitive Runtime Semantics
Case Runtime
Model Cascade
Provider / MCP Protocol
A2A Public Protocol Semantics（只允许兼容投影）
```

## 禁止输出

P10 不得：

- 直接创建 Skill Attempt；
- 启动 Workflow；
- 调用 Skill / MCP；
- 写 Formal Outcome；
- 自动激活 Artifact；
- 修改 Artifact Definition；
- 将 Fallback 成功记为 Fast Path 成功；
- 到期后后台提交正式 Plan；
- 绕过 P07/P09/P08；
- 创建第二 Planner / Policy Engine。

## 条件性兼容修复

若当前 Request Entry 无法注入 Gateway：

1. 创建最薄 Gateway Adapter；
2. 保持原 Cognitive Runtime 为明确 Fallback；
3. 不复制原 Request Parser / Goal / Planner；
4. 不改变未启用 Feature Flag 时的行为；
5. 增加兼容 Contract / E2E；
6. 独立提交并重点 Review。
