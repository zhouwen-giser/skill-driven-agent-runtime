# P14 Rollback / Recovery Drill Contract

## Drill 类型

- Fast Gateway Disable；
- Artifact Kill Switch；
- Artifact Version Rollback；
- Model Route Disable；
- Provider Disable；
- Cognitive Fallback；
- Redis Flush / Restart；
- Worker Restart；
- PostgreSQL Restart；
- Outbox Replay；
- SSE Reconnect；
- Queue Backlog Recovery。

## 演练环境

优先：

- Staging；
- Isolated Production-like；
- Approved Production Window。

不得未经授权在生产演练。

## 证明

每次演练记录：

- Preconditions；
- Commands；
- Approvals；
- Start / End；
- RTO / RPO；
- Data Integrity；
- Duplicate Side Effect；
- Formal Runtime Continuity；
- Rollback；
- Findings。

## 失败

以下必须创建高优先级改进项：

- 不能关闭 Fast Path；
- 不能恢复 Cognitive Fallback；
- 重复 Formal Plan / Attempt；
- 数据丢失；
- Active Pointer 错误；
- Redis 重建失败；
- Queue 无法恢复；
- Credential 暴露。
