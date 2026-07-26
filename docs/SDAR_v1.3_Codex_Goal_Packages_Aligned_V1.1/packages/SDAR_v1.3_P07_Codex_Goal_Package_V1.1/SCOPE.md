# P07 Scope

## 允许修改

按仓库实际结构映射：

```text
packages/domain/**/compiler/retrieval/**
packages/domain/**/compiler/applicability/**
packages/application/**/compiler/retrieval/**
packages/application/**/compiler/applicability/**
packages/application/**/compiler/parameter-binding/**
packages/application/**/compiler/dependency-guard/**
packages/persistence-postgres/**/compiler/**
packages/runtime-redis/**/artifact-index/**
packages/model-provider-adapter/**/classification/**
apps/server/**/runtime-context/**
scripts/**
tests/**
docs/execplans/**
reports/goal/**
```

## 可以新增的持久化 / 投影对象

```text
artifact_index_projection
artifact_embedding_projection
artifact_match_log
artifact_applicability_log
parameter_binding_log
dependency_validation_log
runtime_candidate_decision
```

如 P02 / P06 已有表，必须扩展现有权威。

## 禁止修改

```text
P06 Approval / Activation / Active Pointer
P05 ValidationResult
P04 Candidate Definition
v1.2.2 Goal / Plan / Skill / Outcome authority
v1.2.3 Planning / Experience authority
Fast Gateway request entry
Template Runtime
Rule Runtime
Case Runtime
Model Cascade
Provider / MCP protocol
A2A public protocol
```

## 禁止输出

P07 不得：

- 创建 Goal；
- 创建 Plan；
- 创建 Attempt；
- 调用 Skill / MCP；
- 切换 Active Pointer；
- 自动确认；
- 执行 Artifact；
- 修改 Artifact Definition；
- 将 `active` 以外状态放入在线候选。

## 条件性兼容修复

若现有 Capability Summary 只暴露 Public Skill，不能因此把合法内部 Runtime Capability 判为缺失。

应：

1. 区分 Public Disclosure 与 Runtime Availability；
2. 复用正式内部 Capability Port；
3. 不泄露内部 Skill 到公共 Card；
4. 不在 P07 修改 A2A Public Contract；
5. 记录兼容映射与测试。
