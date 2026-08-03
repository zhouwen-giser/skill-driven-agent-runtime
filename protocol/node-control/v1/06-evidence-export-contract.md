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
