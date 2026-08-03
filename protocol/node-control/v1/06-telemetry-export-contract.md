# 06. Telemetry Export 合同

## SDAR 负责

- endpointRef；
- sourceId/nodeId；
- credentialRef；
- recordFamilies；
- batching、retry、outbox/buffer 策略；
- TLS/Trust 配置引用；
- Runtime Apply/Ack；
- 本地 delivery watermark、pending、oldestPending 和 lastError。

## SDAR 不负责

- 查询 ClickHouse；
- 返回 Task Timeline；
- 返回 Capability Quality；
- 返回 Evaluation、DQ 或 ProviderOps Reconciliation；
- 代理 Telemetry Query API。

## 投递状态语义

```text
healthy
= 出口配置有效，最近 ACK 成功，积压低于阈值

degraded
= 可重试错误或积压超过 Warning Threshold

blocked
= Credential/Schema/Policy 永久失败，required records 无法投递

disabled
= 管理员关闭出口
```

投递状态不能改变 Task Terminal 或 Capability Readiness。
