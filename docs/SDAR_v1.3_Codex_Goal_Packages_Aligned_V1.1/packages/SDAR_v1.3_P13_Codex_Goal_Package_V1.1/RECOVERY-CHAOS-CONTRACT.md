# P13 Recovery / Chaos Contract

## 必测故障

- Redis flush；
- Redis restart；
- BullMQ worker restart；
- PostgreSQL restart；
- Server restart；
- Network partition；
- Model Provider failure；
- MCP / Provider degradation；
- SSE disconnect；
- Queue backlog；
- Outbox duplicate / delay；
- Cache stale；
- Artifact deactivation；
- Kill Switch；
- Concurrent activation；
- Deadline / cancellation；
- Partial transaction；
- Migration interruption。

## 恢复原则

- PostgreSQL 业务事实不丢；
- Redis / Cache / Queue 可重建；
- 重复事件幂等；
- 不重复 Formal Goal / Plan / Attempt；
- 不重复物理副作用；
- Stale Result 丢弃；
- Active Pointer 唯一；
- Audit 保留；
- Cognitive Fallback 可用；
- User Interaction 可恢复。

## RTO / RPO

依据系统基线冻结：

- Runtime；
- Artifact Projection；
- Worker；
- Management；
- SSE；
- Feedback。

不得凭空杜撰目标值，必须记录测量值与批准目标。

## Kill Switch Drill

验证：

- 全局；
- Tenant；
- Artifact Type；
- Artifact；
- Model Route；
- Fast Gateway；
- Shadow / Compiler。

## Rollback Drill

验证：

- Artifact 版本回滚；
- Compiled Path Disable；
- Application Release Rollback；
- Migration Rollback / Forward Fix；
- Cache Invalidation；
- Formal Runtime Continuity。

## 失败标准

无法证明不重复副作用、无法恢复 Active Projection、无法关闭 Fast Path 或无法回退 Cognitive Runtime：

```text
RELEASE_CANDIDATE_BLOCKED
```
