# 07. 版本、并发与幂等

## 版本轴

- Node Control API Version；
- Runtime Control Contract Version；
- Node Event Contract Version；
- Telemetry Export Contract Version；
- Resource Revision；
- Definition Version；
- Agent Card Revision；
- Runtime Version。

## ETag / If-Match

所有可变 Draft、Pointer 和期望状态写入要求 `If-Match`。不匹配返回 `412 PRECONDITION_FAILED`。

## Idempotency-Key

所有 POST 命令要求 `Idempotency-Key`：

- 同 Key + 同 Hash：返回原 Operation；
- 同 Key + 不同 Hash：`IDEMPOTENCY_KEY_REUSED`；
- Key 有受控保留时间；
- 超时重试不得重复发布、导入、暂停或取消。

## 发布后不可变

Published Capability、Exposure 和 Configuration Revision 不原地修改。Rollback 通过发布前一内容的新 Revision 完成。
