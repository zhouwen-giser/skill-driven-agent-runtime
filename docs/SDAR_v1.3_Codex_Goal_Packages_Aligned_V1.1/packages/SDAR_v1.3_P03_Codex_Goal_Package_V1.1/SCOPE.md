# P03 Scope

## 允许修改

按仓库实际结构映射：

```text
packages/domain/**/compiler/experience-trace/**
packages/application/**/compiler/experience-trace/**
packages/application/**/compiler/mining/**
packages/persistence-postgres/**/compiler/**
packages/runtime-redis/**/compiler-jobs/**
infra/postgres/migrations/**
scripts/**
tests/**
docs/execplans/**
reports/goal/**
```

允许最小增加：

- Trace / Pattern Migration；
- BullMQ Queue/Worker Composition；
- Data Deletion / Retention Hook；
- Telemetry；
- 只读 Management Query Skeleton（仅在仓库既有模式要求时）。

## 禁止修改

```text
v1.2.2 Goal terminal authority
Skill execution semantics
Workflow compiler semantics
Provider / MCP protocol
A2A public protocol
Interactive Goal / Planning authority
Artifact lifecycle from P01/P02
Artifact active pointer
Fast Gateway
Template Runtime
Rule Runtime
Case Runtime
Model Cascade
```

## 条件性例外

若 v1.2.3 正式 Experience 数据缺少必要 Source Ref：

1. 不在 P03 新建第二 Experience Authority；
2. 记录 Contract Gap；
3. 创建兼容性修复最小 Patch；
4. 保持 v1.2.3 事实语义；
5. 单独提交；
6. 在 P03 Review 中标记。

## 数据库边界

P03 可以新增：

```text
experience_trace
experience_trace_source
pattern_candidate
pattern_candidate_support
compilation_run
```

不得新增：

```text
active_artifact
artifact_approval
fast_gateway_decision
template_execution
```
