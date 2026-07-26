# SDAR v1.3 P12 Codex Goal Package V1.1

## 任务定位

```text
P12：Management API、Console 与 A2A Integration
原子 Goal：G21
阶段：Management / Operations / Integration
```

P12 将 P01～P11 已形成的 Artifact 生命周期、验证、Shadow、Promotion、Retrieval、Runtime、Feedback、Case 和 Model Route 统一投影到：

```text
Management API
Console
A2A
SSE / Evidence
Operations / Audit
```

本任务包不重复携带 v1.3 总体设计材料。

## 执行基线

```text
未来 v1.2.3 完成并冻结后的最新 origin/main
+
P01～P11 已合入
+
P00 = READY_FULL
```

## 执行模型

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Implementation Agent: 1
Review: 独立只读 Review Pass
```

## P12 主要交付

- Artifact Management API；
- Artifact Query / Detail / Version / Lineage；
- Validation / Shadow / Promotion / Approval / Activation 查询；
- Revalidation / Deprecation / Rollback / Kill Switch 操作；
- Runtime Match / Decision / Usage / Outcome / Drift 查询；
- Case / Model Route 运行证据；
- Console Artifact Registry；
- Console Candidate / Validation / Promotion / Active / Revalidating 视图；
- Console Runtime Decision / Feedback / Cost / Drift；
- A2A Artifact 能力投影；
- A2A Input-required / Confirmation / Evidence；
- SSE 实时运行和治理事件；
- OpenAPI；
- RBAC / Tenant Isolation；
- Redaction / Exposure Boundary；
- Audit / Idempotency / Expected Version；
- P13 Handoff。

## 不属于 P12

```text
重新实现 Artifact Runtime
重新实现 Retrieval / Rule / Template / Gateway
直接修改 Artifact Definition
自动 Approval / Activation
绕过 P02/P06 Governance
绕过 P08 Formal Planner
改变 A2A 正式任务状态权威
暴露 Credential / Secret / 私有知识
Hardening / Release 最终收口
```
