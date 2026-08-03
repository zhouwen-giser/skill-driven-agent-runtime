# 12. 验证与发布门禁

## Contract

- OpenAPI 3.1 YAML 可解析；
- operationId 全局唯一；
- 所有外部写操作具有 Idempotency-Key；
- 所有 Draft/Revision 写操作具有 If-Match；
- Problem Details 统一；
- JSON Schema Draft 2020-12；
- AsyncAPI 可解析；
- Fixture 全部通过 Schema。

## Boundary

- Node API 不出现 telemetry query、timeline、evaluation、reconciliation；
- Node API 不出现 ClickHouse 表名；
- Internal API 不出现在 Organization Profile；
- Schema 不出现 UI 字段；
- Secret 字段检查通过；
- Capability Summary 与 Capability Definition 不能共用 Schema。

## Runtime

- Control Backend 停机测试；
- LKG 冷启动；
- Reject/Restart Required；
- Capability Catalog 原子切换；
- Agent Card Candidate 失败不覆盖 Active；
- Task Binding 原子事务；
- Evidence Export 故障不影响 Task。
