# 05. 合同实施策略

## 冻结版本

- Node Control API 1.0.0
- Runtime Control Contract 1.0.0
- Node Events 1.0.0
- Telemetry Export Contract 1.0.0

## 实施原则

- OpenAPI/AsyncAPI/JSON Schema 是可执行合同。
- 不将最新 main 的内部 Entity 直接暴露为公共 DTO。
- 公共 Node Control API 与内部 Runtime API 分开。
- 所有命令使用 Idempotency-Key。
- 可变资源使用 Revision、ETag、If-Match。
- 长时命令返回 ManagementOperation。
- Error 使用稳定 Code；前端/组织平台不得解析 Detail。
- Node Events 只提示变化，消费者重新 GET。
- Desired 和 Observed 显式分离。
- Secret 只返回 Ref 和状态。

## Telemetry 限制

允许：

- 出口 Endpoint；
- Source Identity；
- CredentialRef；
- TLS；
- Record Family；
- Batch/Retry/Buffer；
- Last ACK Sequence；
- Pending Count；
- Last Error。

禁止：

- Task Timeline；
- Evaluation；
- Reconciliation；
- ClickHouse；
- 遥测历史查询；
- Dashboard DTO。

## Breaking Change

冻结资源、动作、状态语义不可删除或改义。
确需变化必须：

1. 新 ADR；
2. 更新冻结合同副本；
3. Contract Diff；
4. 迁移和兼容报告；
5. 全链路测试。
