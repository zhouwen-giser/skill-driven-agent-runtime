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

## v1.1 Phase 6 集成与发布前证据

Phase 6 使用机器可读的 `reports/v1.1-mcp-tasks/V11-ACCEPTANCE.json` 和人工可读 Markdown 将 AC-MCPT-01–16 映射到测试。真实验证包括本地 PostgreSQL/pgvector、Redis/BullMQ、HTTP、单进程 Server、LangGraph 继续执行、管理 API、A2A、迁移与生产构建；Provider 状态序列和模型决策来自确定性本地替身，必须标记为 `simulated`，不得描述为生产 Provider 验证。

干净提交 `df8b6e0` 上的 `pnpm demo:acceptance` 已通过生产 build、10 个 Provider contract、402 个 unit、80 个真实 integration、49 个真实 E2E 和 acceptance report verifier。干净提交 `13194b8` 上的 self-managed Compose `pnpm verify` 已在 162.0 秒内通过：75 个 unit/contract 文件共 493 个测试、80 integration、49 E2E、232-source architecture、110-operation OpenAPI、68 migration pairs 和两阶段 smoke。

重启场景必须删除 Redis/BullMQ 临时队列，再由 PostgreSQL 的有效 external-wait continuation/binding 恢复观察与继续执行，并断言 `tools/call` 不重放；同一测试另插入普通 running Task，证明其仍以 `PROCESS_EXECUTION_LOST` 失败。迁移 0104 验证 `node_waiting_external` 可持久化，并验证存在此类证据时回滚 fail closed。

架构门禁同样覆盖测试支撑代码。需要 `pg`、`bullmq` 或官方 A2A SDK 的复用 helper 必须分别位于 Server/PostgreSQL 允许边界、runtime-redis、a2a-adapter 的 `test-support` 目录；不得为验收测试增加跨 Adapter 例外。

以上 Phase 6 结果来自尚未提交的 dirty worktree，属于功能和发布前证据，不等于 clean-commit、RC tag、最终 PR 或正式发布证据。
