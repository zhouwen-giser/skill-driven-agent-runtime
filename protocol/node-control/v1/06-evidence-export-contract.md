# 06. Canonical Evidence Export 合同

## SDAR 负责

- `sdar.evidence/v1` 和 `x-sdar-evidence-contract: sdar.evidence/v1`；
- endpointRef、sourceId/nodeId 和 CredentialRef-only；
- 强类型 Evidence Family、仅 Diagnostic 类型排除；
- 有界 Batch、Body、retry 和 outbox 策略；
- Runtime Apply/Ack/LKG；
- PostgreSQL delivery watermark、pending、oldestPending、lease/fencing 和 lastError；
- 至少一次投递、显式连续 ACK 与合法 Partial ACK。

Required Evidence 不得通过 `includedFamilies` 或 `excludedDiagnosticTypes` 关闭。旧
`x-sdar-telemetry-contract`、旧 Batch Payload 和任意 `recordFamilies: string[]` 均不再是产品合同。

## SDAR 不负责

- 查询 ClickHouse；
- 返回 Task Timeline；
- 返回 Capability Quality；
- 返回 Evaluation、DQ 或 ProviderOps Reconciliation；
- 代理 Evidence/Telemetry Query API；
- 将 Sink 响应作为 Runtime 业务权威。

## 投递状态语义

```text
healthy   = 配置有效，最近 ACK 成功，积压低于 High Watermark
degraded  = Endpoint/ACK/Credential 等可恢复投递错误
blocked   = durable High Watermark 或 required Evidence 无法继续捕获
disabled  = 没有 Active Evidence Export 配置
```

投递状态和 Endpoint 故障不能改变 Task Terminal、Capability Readiness 或任何来源业务事实。

## v1.4.1 Operations and Recovery addendum

Evidence Operations 是 Runtime PostgreSQL 权威上的有界管理投影。Node Control 查询只公开
identifier、revision、status、timestamp、counter 和 hash。Canonical Evidence payload、凭据、
Secret 解析值、任意 SQL 和 ClickHouse proxy/query 均不属于该 API。

Public API 提供 Outbox metadata、source checkpoint、projection issue、quality issue、dead letter
的有界分页，以及一个精确 Episode Manifest。页大小为 `1..200`，cursor/filter 使用 closed schema。
`organization_service` 不得访问任何 Evidence Operations 路由；`node_viewer`、`node_operator`、
`security_admin` 可读取 metadata；恢复命令只允许 `node_admin` 或 `security_admin`。

Replay 每次只接受一种范围：稳定 record ID、精确 `sourceFamily + sourcePartition` 或 Episode ID。
Partition/Episode replay 只选择精确 active configuration 下 eligible 的记录；对被排除的单记录
Replay 必须 fail closed。Dead-letter retry 保留原 immutable DLQ 行。Coverage reconcile 从 source
fact、Outbox/ACK 和 unresolved issue 重新计算，不能直接把 Manifest 改成 completed。

每个写操作携带稳定 `Idempotency-Key` 和非空 reason。Node Control 生成绑定真实 principal 的
`ManagementOperation` 与 immutable Audit；Runtime 在工作开始前持久化权威 Recovery Run。
Runtime PostgreSQL 独占 run 状态与终态结果；Redis 只可唤醒 requested run。
