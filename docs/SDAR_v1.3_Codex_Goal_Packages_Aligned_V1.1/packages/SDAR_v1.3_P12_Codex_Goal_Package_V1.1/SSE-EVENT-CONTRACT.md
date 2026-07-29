# P12 SSE / Event Projection Contract

## 事件类别

### Governance

```text
artifact.candidate_created
artifact.validation_completed
artifact.shadow_completed
artifact.promotion_ready
artifact.approval_recorded
artifact.activated
artifact.revalidation_requested
artifact.deprecated
artifact.rollback_completed
artifact.kill_switch_changed
```

### Runtime

```text
gateway.route_selected
gateway.confirmation_required
gateway.fallback_started
gateway.formal_handoff
rule.evaluated
template.instantiated
case.adapted
model_route.selected
model_cascade.escalated
```

### Feedback

```text
artifact.outcome_linked
artifact.correction_observed
artifact.drift_detected
artifact.revalidation_signalled
```

## 投影原则

- Event Source 来自正式 Outbox；
- SSE 不直接订阅内部 Redis 临时事实作为权威；
- 按 Tenant / Authorization 过滤；
- Event ID 可恢复；
- Last-Event-ID；
- 去重；
- 顺序；
- Snapshot / replay；
- Size Bound；
- Redaction。

## SSE 不拥有状态

SSE 只是投影。

断开、丢失或重连不得改变 Artifact / Goal / Task 状态。

## 敏感字段

不得包含：

- Credential；
- Secret；
- 完整 Prompt；
- 私有 Experience；
- 未授权 Lineage；
- 用户 PII。

## Backpressure

- Client 缓慢时有界缓冲；
- Overflow 明确；
- 可重连；
- 不阻断正式事务；
- 运维指标。
