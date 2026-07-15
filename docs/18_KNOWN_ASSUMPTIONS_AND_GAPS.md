# 已知假设、冲突与待验证项

## 必须在 EP-00 验证

1. A2A 规范锁定 1.0.1，但官方 JavaScript SDK 稳定渠道可能仍实现 0.3，1.0 支持可能来自 `@next`。必须锁定版本并做契约测试。
2. A2A SDK 内部 Task Store 是否可由本项目 PostgreSQL Repository 适配，不能让 SDK Store 成为第二系统记录。
3. MCP TypeScript SDK 的具体包名、版本和 Streamable HTTP 取消能力。
4. LangGraph.js 对动态 State Schema、并行汇合、子图、事件和 Redis Checkpoint 的可用边界。
5. Node 版本、ORM、Web 框架和前端版本的共同兼容性。

## 设计解释

- “MCP Tool 失败由 LLM 动态决策”不代表 LLM 可突破系统预算、Tool 权限或副作用事实。系统先生成允许动作集合，LLM 在集合内选择。
- “保存完整模型调用”不包括保存私有思维链。保存 Prompt、上下文、模型可见原始响应、结构化决策、Token 和耗时。
- “Skill 自动发布”只适用于系统从多次经验归纳且全部模拟用例通过的版本；A2A 用户请求创建的 Skill 仍是草案。
- “Redis 保存运行 Checkpoint”与“故障不恢复”并不冲突：Checkpoint 用于暂停/恢复和正常运行，不作为崩溃恢复承诺。
- FR-WF-009 的“费用预算”在 V1 中解释为系统配置的 LLM/MCP/Skill/子工作流调用计费单位，而不是未经配置便猜测供应商货币账单。模型 Token 仍独立审计；未来如增加 Provider 价格元数据，必须通过同一预算计量端口接入并保留执行时价格快照。
- 外层控制器达到 `maxReplans` 后采用 fail-closed 终止策略：保留最后实例和评估证据，将控制标记为 `replan_budget_exhausted`，并将 Goal 标记为 `unachievable`，避免保留一个没有剩余可执行路径的 active Goal。

Codex 发现新的缺口时在此追加，并通过 ADR 或阻塞报告处理。

## EP-00 执行发现

- 2026-07-11：当前目录不包含 Git 元数据，无法生成 Conventional Commit 证据，也无法基于 Git 恢复文件字节版本。首次建立格式门禁时，宽范围 Prettier 对部分 Markdown/JSON 基线执行了内容等价的排版重写；未改变需求文本或状态。格式脚本现已限制为代码与配置文件，后续不得格式化 `docs/`、`schemas/`、`examples/`、`source/`。如获得仓库原始 Git 历史，应恢复这些基线文件的原始排版后再重放明确的状态/缺口编辑。
- 2026-07-11：官方 `a2aproject/a2a-tck` commit `5996b79f9cefa6fc390980e383e358a66fb9e49e` 的顶层 `LICENSE` 和 README 声明 Apache-2.0，但 `pyproject.toml` metadata 声明 MIT。仓库提供精确 `uv.lock`，所以依赖可复现；许可证元数据冲突必须在正式纳入分发或 vendoring 前由上游修正或通过 ADR 明确解释。EP-01 可将其作为临时外部测试工具运行，但不得复制或作为生产依赖。
- 2026-07-11（2026-07-13 更新）：上述 TCK commit 内嵌 specification branch 为 `v1.0.0`。规范声明 patch 版本不参与 wire negotiation，因此 Agent Card/请求仍使用 `1.0`。当前确定性 TCK SUT 已补齐 input-required/history fixture，官方 HTTP+JSON/MUST 结果为 74 passed、161 scoped skips、0 failed/errors、100%；同时 production endpoint 合约直接覆盖 v1.0.1 的 `application/a2a+json`，并保留 TCK 所需 `application/json`。精确规范/SDK/TCK pin 与证据边界见 ADR-069；不声称 JSON-RPC/gRPC 或稳定 SDK。
- 2026-07-13：原始 SRS 的 A2A 版本描述内部冲突：多数正文、FR-A2A-002 与部署表写 1.0.0，但术语表和 NFR-COMP-001 验收文字指定 1.0.1。`docs/01_REQUIREMENTS_BASELINE.md` 已一致采用更严格的 1.0.1，ADR-069 将其作为规范基线，未修改原始 SRS。
- 2026-07-11（2026-07-13 最终更新）：Docker Desktop 的早期容器变更挂起已恢复。当前 `pnpm verify`、`pnpm demo:local` 和 `pnpm demo:acceptance` 均真实启动 PostgreSQL/pgvector 与 Redis；integration、41 场景 E2E、基础设施 smoke 和 Server/Console smoke 通过。早期不可用记录保留在历史报告中，但不再是当前阻塞。

## v1.1 MCP Tasks Phase 0 冻结项

- 2026-07-16：实施包引用的 `SDAR_v1.1_MCP_Tasks_升级方案.md` 不存在；仓库中 byte-frozen 的 `SDAR_v1.1_MCP_Tasks_升级设计文档.md` 与实施包内容匹配并作为对应设计输入。规范化实现设计写入 `docs/22_V1_1_MCP_TASKS_DESIGN.md`，未修改需求基线。
- 2026-07-16：所需 `tasks/get`、`tasks/update`、`tasks/cancel` 是官方 `io.modelcontextprotocol/tasks` extension 的形状，而 SDK 1.29.0 高层 `experimental.tasks` 是旧版 `tasks/result`、`tasks/list` 形状。ADR-076 锁定 SDK transport + adapter low-level request；该兼容性必须在 Phase 1 loopback 合约中真实验证。
- 2026-07-16：官方 extension 无 tag，当前为 draft/incubating source。锁定 commit `8966bea9c4f4e6d71060cc8284a539086e9e234f` 及两个 schema blobs；未通过新的 Intake/ADR/契约门禁不得漂移。
- 2026-07-16：当前领域只有 MCP `serverId`，没有独立 `providerId` 权威来源。v1.1 以 `serverId` 表示 Provider authority；外部 wire 文档中的 provider 概念在持久化/领域中映射到 `serverId`，避免重复身份。
- 2026-07-16：远程绑定必须使用稳定 `workflowNodeRunId`，不能只用 DSL `nodeId`，否则循环、重试或同节点多次运行会别名。
- 2026-07-16：绑定只持有 credential/session revision，不落库明文凭据；凭据轮换后的远程 Task session continuity 由 Adapter/Provider contract 验证，不能猜测旧凭据仍有效。
- 2026-07-16：`agentTaskId` 与 `remoteTaskId` 是不同字段；现有 `mcp_invocation.task_id` 继续表示本地 Agent Task，不得复用为 remote ID。
- 2026-07-16：remote observations/control inbox 使用专用 PostgreSQL authority records；`runtime_event` 只做可展示投影，不能作为协议幂等/排序来源。
- 2026-07-16：`waiting_external` 可在启动恢复中豁免 interrupted-running failure，只表示 PostgreSQL 可重建远程等待。它不恢复普通 running/evaluating Workflow，也不改变进程/Redis 故障后运行中任务不恢复不重试的 V1 约束。
- 2026-07-16：远程 continuation 不是 LangGraph interrupt/resume。当前 graph invocation 在持久化等待快照后结束；控制事件仅从持久 frontier 开启新的 continuation attempt，不修改旧图或从 START 重放。
- 2026-07-16：Provider 执行 `startToleranceMs` 和 `maxElapsedMs` 业务合同并产生 `start_window_missed`/`deadline_reached`。SDAR 不启动该业务 Timer，Provider 不可达也不得被解释为期限终态。
- 2026-07-16：v1.1 migration 预留 0100+，但当前 high-water runner 会跳过更低未应用编号。0100+ 在 v1.0.13 前只能进入 disposable isolated database；支持的最终路径必须是完整 v1.0.13-bug-fixed ledger 后再应用 0100+。
- 2026-07-16：DOCX 已完成结构提取，但当前环境缺少 `soffice`，无法生成页面渲染证据。Phase 0 不修改/交付 DOCX，因此记录为阅读工具限制而非功能完成证据。
