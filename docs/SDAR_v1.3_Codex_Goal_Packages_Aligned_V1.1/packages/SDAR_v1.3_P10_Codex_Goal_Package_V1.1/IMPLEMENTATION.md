# P10 Implementation Plan

## G17：Fast Gateway 与在线闭环编排

### 1. Handoff Validator

验证 P07/P08/P09 Port、Version、Reason Code、Feature Flag 和 Formal Authority Adapter。

### 2. Request Entry Adapter

在现有 Request Entry 中增加最薄 Gateway Adapter。

要求：

- Feature Flag Off 时行为与 v1.2.3 原路径一致；
- 不复制 Request Parser；
- 不改变 Auth / Tenant；
- 不改变 Response Envelope；
- 明确 Cognitive Fallback。

### 3. Gateway Context

冻结：

- Request；
- Authenticated Actor；
- Tenant；
- Authorization；
- Deadline；
- Cancellation；
- Policy / Catalog / Active Snapshot；
- Idempotency。

### 4. Precheck

Auth、Tenant、Schema、Deadline、Feature、Kill Switch、Base Policy。

### 5. P07 Adapter

调用 Retrieval / Applicability，不重算。

### 6. Intent Route

处理 Active `intent_route` 候选，只能选择 Rule / Template / Fallback / Confirm / Deny。

### 7. P09 Adapter

调用 Rule Runtime。

### 8. P08 Adapter

调用 Template Runtime / Formal Handoff。

### 9. Cognitive Fallback

复用现有 v1.3 Cognitive Runtime。

### 10. Decision State Machine

建议状态：

```text
received
prechecked
retrieving
evaluating_rule
instantiating_template
submitting_formal_handoff
falling_back
interaction_required
denied
completed
cancelled
timed_out
failed
```

必须防止非法并发状态。

### 11. Deadline / Cancellation

实现绝对 Deadline、阶段预算、预留、传播、取消、迟到丢弃。

### 12. Resilience

实现 Bulkhead、Circuit Breaker、Load Shedding、Adapter Timeout。

### 13. Idempotency

同一 Idempotency Key 不产生重复 Formal Handoff。

### 14. Formal Correlation

保存 Gateway→Formal Goal/Plan/Interaction/Fallback Ref。

### 15. API / A2A / SSE

保持现有协议兼容：

- 可追加 Gateway Evidence；
- 不改变正式 Task / Goal 状态语义；
- SSE 显示 route/fallback/confirm；
- A2A 输入仍进入正式权威。

## G18：Artifact Feedback、Drift 与再编译触发

### 16. Feedback Envelope

收集 Match、Applicability、Runtime、Outcome、Performance。

### 17. Outcome Link

通过 Formal Refs 关联，不能复制 Outcome 权威。

### 18. Attribution

区分 Fast Selected、Fast Committed、Fallback、Formal Outcome。

### 19. Metrics / Drift

按 Artifact / Tenant / Task Type / Environment 聚合。

### 20. Revalidation Signal

发送 normal / urgent / critical 到 P06。

### 21. Compiler Feedback

发送结构化事实给 P03 / P05，不直接重编译。

### 22. Outbox / Worker

- 同事务 Outbox；
- at-least-once；
- PostgreSQL 幂等；
- Redis rebuild；
- Dead Letter；
- Retention；
- Deletion Propagation。

### 23. Console / Management

展示：

- Route；
- Artifact；
- Reason；
- Stage；
- Fallback；
- Formal Handoff；
- Outcome；
- Drift；
- Feature / Circuit。

### 24. Performance / SLO

建立基线、压力测试、故障注入和发布阈值。

### 25. Tests / Evidence

完成 Unit、Contract、Integration、E2E、Concurrency、Chaos、Security、Performance、Migration 和只读 Review。
