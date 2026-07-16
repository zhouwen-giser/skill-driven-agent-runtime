# 测试与验收策略

## 测试金字塔

### Unit

- Goal Patch、状态机、不变量；
- Skill Schema、版本和工具边界；
- Workflow DSL Validator 和表达式解释器；
- Result normalization、Memory versioning、Evaluation aggregation；
- Adapter mapping。

### Integration

- PostgreSQL repositories 和迁移；
- Redis/BullMQ 排队、context 串行、等待/超时；
- Mock MCP Streamable HTTP 发现、调用、错误、取消；
- LangGraph compile/execute；
- ModelProvider 结构化输出与修正循环。

### Contract

- A2A 1.0.1 Agent Card、message/send、tasks/get/list、cancel、streaming 和状态消息；
- Management OpenAPI；
- MCP tool schema 与 invocation envelope；
- JSON Schemas 的正反例。

### E2E

以真实 PostgreSQL、Redis、Mock Model Provider、Mock MCP Server、Server 和 Console 运行全部 AC 场景。

## 必须提供的统一命令

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:contract
pnpm test:e2e
pnpm build
pnpm smoke
pnpm verify
```

`pnpm verify` 是完整统一门禁：依次执行静态检查、unit/contract、架构与协议基线、生产构建、真实 PostgreSQL/Redis integration、真实 PostgreSQL/Redis/Mock Model/Mock MCP E2E、基础设施 smoke 和 Server/Console-bundle smoke。命令无论成功或失败都写入 `reports/verification/summary.json` 与 `summary.md`。

## 测试替身

- Deterministic Model Provider：按 fixture 输出意图、Skill、Workflow、评估和修正结果。
- Mock MCP Server：包含只读、失败、长调用、取消、Schema 变化和有副作用 Tool。
- A2A Test Client：覆盖非流式、流式、重连、多轮、确认和取消。

## 证据

测试报告必须输出：commit、环境、命令、开始/结束时间、通过/失败数、失败详情和关联需求。`pnpm verify` 生成 `reports/verification/summary.json` 与 Markdown 摘要。

## v1.1 Phase 3 readiness 证据

Phase 3 增加严格 DSL/metadata/availability 合约、确定性时钟与风险 Guard 单元、官方 Client 真实 loopback HTTP 合约、真实 PostgreSQL 追加证据集成，以及 planner→confirmation→LangGraph→pre-call→Provider 的垂直 E2E。Provider 资源状态和业务行为由确定性 Mock 模拟；PostgreSQL/Redis、HTTP transport、迁移 SQL 和生产构建是真实本地验证。远程 Binding/continuation 与 Provider 业务终态仍分别属于 Phase 4/5，不由本阶段测试冒充。
