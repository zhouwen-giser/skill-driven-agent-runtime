# P12 Scope

## 允许修改

按仓库实际结构映射：

```text
packages/management-api/**/artifact/**
packages/management-api/**/runtime-evidence/**
packages/a2a-adapter/**/artifact/**
packages/a2a-adapter/**/runtime-evidence/**
packages/domain/**/management-projection/**
packages/application/**/management-query/**
packages/application/**/management-command/**
apps/server/**/management/**
apps/server/**/a2a/**
apps/console/**/artifact/**
apps/console/**/runtime-evidence/**
apps/console/**/governance/**
protocol/openapi/**
scripts/**
tests/**
docs/execplans/**
reports/goal/**
```

## 条件允许修改

如需 Audit / Projection Migration：

```text
infra/postgres/migrations/**
```

只能新增管理投影或审计支持，不得建立第二业务权威。

## 禁止修改

```text
P01～P11 Domain Semantics
P02/P06 Governance State Machine
P07 Retrieval / Applicability
P08/P09/P10/P11 Runtime Decision
v1.2.2/v1.2.3 Formal Goal / Plan / Outcome
Provider Credential Store
MCP Protocol
A2A Formal Task State Semantics
```

## 禁止输出

P12 不得：

- 在 Controller 中写业务状态；
- UI 直接控制数据库；
- UI 自动 Approve / Activate；
- A2A 自动 Approve；
- Public Card 暴露 Candidate；
- 暴露 Credential / API Key / Secret；
- 暴露跨 Tenant 数据；
- 暴露私有思维链；
- 自动修改 Feature Flag；
- 重实现 Runtime；
- 发布 Release Tag。

## 条件性兼容修复

若现有 Management API / Console 缺少统一错误或分页模式：

1. 复用现有约定；
2. 做最小兼容扩展；
3. 不创建独立风格；
4. 更新 OpenAPI / Contract Test；
5. 不修改业务语义。
