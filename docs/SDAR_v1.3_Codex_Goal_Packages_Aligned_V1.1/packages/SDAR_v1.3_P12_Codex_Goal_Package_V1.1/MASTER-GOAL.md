# MASTER GOAL：SDAR v1.3 P12

## Goal ID

```text
SDAR-V1.3-P12
```

## 原子 Goal

```text
G21：Management API、Console 与 A2A Integration
```

## 目标

建立：

```text
P01～P11 Domain / Governance / Runtime
        |
        v
Management API
+
Console
+
A2A / SSE
+
Operations / Audit
```

## 输入权威

- Artifact Repository / Active Pointer；
- Validation / Shadow / Promotion / Approval；
- Revalidation / Rollback / Kill Switch；
- Retrieval / Applicability；
- Template / Rule / Gateway；
- Case / Model Route；
- Usage / Outcome / Cost / Drift；
- Operator Identity / RBAC；
- Formal Goal / Plan / Task / Outcome；
- A2A Task / SSE。

## 输出权威

P12 输出的是：

```text
Management Projection
Operator Command
Console Projection
A2A Projection
SSE Evidence Projection
Audit Record
```

领域事实仍由 P01～P11 对应服务和 PostgreSQL 权威维护。

## 权威边界

```text
Domain / Application Service
> Management Controller / Console

P02/P06 Governance
> Management Command

Authenticated Identity
> Request actor fields

Formal Goal / Plan / A2A Task
> Artifact Evidence Projection

Public Capability Allowlist
> Internal Artifact / Skill / Provider Data

PostgreSQL
> UI Cache / Browser State
```

## 完成合同

- 所有管理查询使用正式 Query Port；
- 所有治理写操作复用 P02/P06；
- RBAC / Tenant 隔离完整；
- Approval / Activation 分离；
- Expected Version / Idempotency；
- Console 可执行真实操作，不是 Fixture；
- Runtime / Feedback 可解释；
- A2A 正式状态语义不变；
- Public Projection 有严格 Allowlist；
- Candidate / Credential / Secret 不暴露；
- SSE 只投影 Evidence；
- OpenAPI 完整；
- Audit 可追溯；
- P13 Handoff 完整。
