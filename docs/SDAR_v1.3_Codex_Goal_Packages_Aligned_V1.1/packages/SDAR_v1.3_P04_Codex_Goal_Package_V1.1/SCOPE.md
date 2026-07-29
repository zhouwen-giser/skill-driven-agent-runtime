# P04 Scope

## 允许修改

按仓库实际结构映射：

```text
packages/domain/**/compiler/pattern/**
packages/domain/**/compiler/artifact-candidate/**
packages/domain/**/compiler/plan-template/**
packages/application/**/compiler/generalization/**
packages/application/**/compiler/candidate/**
packages/application/**/compiler/plan-template/**
packages/persistence-postgres/**/compiler/**
packages/model-provider-adapter/**/compiler/**
infra/postgres/migrations/**
scripts/**
tests/**
docs/execplans/**
reports/goal/**
```

## 可以新增的持久化对象

如 P02 未提供专表，可在不修改 P02 核心状态机的前提下增加：

```text
generalized_pattern
artifact_candidate_detail
plan_template_candidate_detail
candidate_static_validation
candidate_generation_run
candidate_model_invocation
candidate_fingerprint
```

P02 的 `compiled_artifact` Candidate Authority 不得被替换。

## 禁止修改

```text
P03 ExperienceTrace semantics
P03 Process statistics
P02 Active Pointer
P02 Approval semantics
v1.2.2 Goal / Plan / Skill / Outcome authority
v1.2.3 Interactive Goal / Planning authority
Fast Gateway
Runtime request entry
Template Runtime
Rule Runtime
Case Runtime
Model Cascade
Provider / MCP protocol
A2A public protocol
```

## 禁止输出

P04 不得生成：

- active artifact；
- replay passed；
- validation approved；
- shadow passed；
- promotion recommendation；
- live route；
- executable graph；
- exact Skill binding；
- actual MCP parameters。

## 条件性兼容修复

若 P01/P02/P03 Handoff 与实际代码存在非破坏性命名差异：

1. 适配现有合同；
2. 不重新定义上游语义；
3. 记录兼容映射；
4. 不在 P04 修改上游权威；
5. 必须在 Review 中检查。
