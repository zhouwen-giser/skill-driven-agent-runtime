# P10 Resilience Contract

## 1. Bulkhead

P07、P09、P08、Cognitive Fallback 使用独立并发与资源池。

一个阶段拥塞不能耗尽整个 Server。

## 2. Circuit Breaker

按：

- Tenant；
- Adapter；
- Failure Type；
- Time Window；

维护 Circuit。

Circuit Open：

```text
skip affected fast stage
record degraded reason
fallback or confirm
```

不能跳过 Policy / Authorization。

## 3. Load Shedding

高负载时优先级：

```text
formal runtime
> confirmation / deny
> exact retrieval
> deterministic rule
> template
> semantic retrieval
> optional explanation
> background feedback enrichment
```

## 4. Queue / Background

Gateway 主决策不依赖后台反馈队列成功。

Feedback Outbox 失败时：

- 正式结果不回滚；
- Outbox 在正式事务中可靠记录；
- 异步重试；
- Dead Letter；
- 运维告警。

## 5. Redis Failure

Redis 失败：

- Cache Miss；
- PostgreSQL Active Authority；
- 可降级为 Exact / Structured；
- Semantic Index 不可用时 Fallback；
- 不将 Redis 状态当 Active Authority。

## 6. Database Failure

无法读取正式 Active / Policy / Goal 权威时 Fail Closed 或 Cognitive Fallback，取决于原 Runtime 是否独立可用。

不得使用过期 Cache 直接执行。

## 7. Provider / Model Failure

Rule 确定性路径可以继续。

Semantic / Template Model 辅助失败：

- no-op；
- bounded retry；
- fallback；
- 不阻断 Deny / Confirmation。

## 8. Recovery

Gateway 本身不承担任务 Recovery。

正式 Plan 提交后的 Recovery 由现有 v1.2.2 Authority 负责。
