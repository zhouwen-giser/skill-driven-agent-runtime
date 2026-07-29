# P05 Scope

## 允许修改

按仓库实际结构映射：

```text
packages/domain/**/compiler/replay/**
packages/domain/**/compiler/validation/**
packages/application/**/compiler/replay/**
packages/application/**/compiler/validation/**
packages/persistence-postgres/**/compiler/**
packages/runtime-redis/**/compiler-jobs/**
packages/provider-adapter/**/replay/**
infra/postgres/migrations/**
scripts/**
tests/**
docs/execplans/**
reports/goal/**
```

## 可以新增的持久化对象

```text
replay_dataset
replay_dataset_case
replay_dataset_membership
replay_run
replay_case_result
validation_metric_definition
artifact_validation_run
artifact_validation_failure
artifact_counterexample
```

若 P02 已存在对应表，必须扩展而非建立第二权威。

## 禁止修改

```text
P04 Candidate Definition
P02 Approval / Active Pointer
P03 Trace / Pattern
v1.2.2 Formal Goal / Plan / Attempt / Outcome
v1.2.3 Experience / Knowledge Authority
Runtime request entry
Fast Gateway
Template Runtime
Rule Runtime
Case Runtime
Model Cascade
A2A public protocol
MCP protocol
```

## 禁止输出

P05 不得生成：

- `approved`；
- `active`；
- Shadow Decision；
- Canary Policy；
- Runtime Route；
- Production Template Binding；
- Real Tool Result；
- Human Approval Record。

## 条件性修复

若历史快照缺失：

1. 不允许使用当前状态伪造；
2. 标记 `snapshot_incomplete`；
3. Case 进入不可用于 Promotion 的 Dataset；
4. 记录前置缺口；
5. 不在 P05 新建第二历史事实权威。
