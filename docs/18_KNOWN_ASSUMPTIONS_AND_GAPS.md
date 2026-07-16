# 已知假设、冲突与待验证项

## v1.1 MCP Tasks Phase 2 决策解释

- 2026-07-16：历史 released migration 并非每个文件都写入 `schema_migration`；0100 隔离升级以 released chain 的终点标记 `0056_mcp_execution_mode` 为前置条件，并通过空库、0056 升级、rollback/reapply 和非隔离库 fail-closed 测试证明路径，未伪造缺失 ledger 行。
- 2026-07-16：现有 `WorkflowPlanRecord` 没有独立 plan version。Binding 保存 `workflowPlanId`、`workflowDefinitionId`、`workflowDefinitionVersion` 和实际 `workflowNodeRunId`，不新增无权威来源的 plan version。
- 2026-07-16：credential revision 与 session revision 是非秘密引用；Phase 2 fixture 使用稳定测试值。真实凭据仍只存在于加密的 MCP Server 记录，Binding、观测、协议尝试和错误均不保存 Headers、明文凭据或堆栈。
- 2026-07-16：Phase 2 只实现远程观测和 control inbox 的可靠生产，不消费 control、不恢复 LangGraph、不豁免普通 running/evaluating Workflow。生产 Workflow admission、`waiting_external` 和 continuation 统一在 Phase 4 接线。

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
- v1.0.6 的 `commitCanceled` 适用于已拥有一个 active WorkflowControl 的单 Task 运行终态；显式 Goal-wide cancellation 仍由既有 PostgreSQL 多 Task/Plan/Instance cascade transaction 管理，并在该事务内为每个 active Control 创建 canceled Runtime Terminal Outcome。两条路径不得交叉单写同一 active Control；如未来合并 application Port，必须新增 ADR 说明批量锁顺序、幂等键和部分 Control 不存在时的语义。
- v1.0.7 将 A2A message metadata 的 `structured_input` 作为正式顶层 Skill 结构化输入的规范键，并兼容既有客户端可能发送的 `sdar_structured_input`；两者同时出现时规范键优先。请求文本、Goal Contract、同 Context 已处理数据、补充输入和长期 Memory 依次降级，长期 Memory 只能作为历史证据，不能声明设备当前状态。
- v1.0.7 的正式 Skill 重规划固定使用 WorkflowControl 已保存的结构化输入；仅新的持久化 Task input response 或 Goal Patch 触发新的输入解析记录。子 Skill 继续在各自调用边界独立校验，父级解析结果不授予子级输入权限。
- v1.0.7-bug-fixed 将 Goal Patch 后的输入解析解释为 Patch 提交前置条件：若新 Goal Contract 无法为同一正式 Skill 产生 schema-valid 输入，Patch 不改变 Goal/Task/Plan，调用方需先澄清请求再重试 Patch。这一 fail-closed 语义避免 `newPlanId` 指向不存在计划的部分提交。
- v1.0.8 的 0061 历史回填优先使用 Goal Patch 的 before/after snapshot，其次使用当前 Goal 行。若早期记录已失去全部可恢复 Goal 证据，则保存带明确 legacy 描述的兼容快照，仅用于历史可读性；任何新规划、替代、确认继承或执行都必须提交并匹配当前完整 Contract，不能把该兼容快照当作新权限。
- v1.0.8-bug-fixed 保留未注册 Goal 的管理端 standalone selection/planning 能力，用于低层验证与预注册编排；一旦相同 `goalId` 已在 PostgreSQL 注册，该 Goal 必须仍为 active 且六字段完全一致。终态或内容漂移均在 embedding/model 调用前拒绝。
- v1.0.9 将任务包的 `composable` 语义映射到仓库既有 `composition` 枚举，不新增同义关系。初始组合只沿 root 出站的 `parent_child`、`depends_on`、`input_output_match`、`composition`、`capability_coverage` 遍历，深度上限 8、相关 Skill 上限 32、关系上限 128、快照 JSON 深度上限 64；`alternative` 仍仅用于失败后替代。0062 前的历史计划保持可读/可执行兼容，但没有组合快照的旧行不得被当作新规划授权来源。
- v1.0.10 将 capability gap 解释为当前 Task/WorkflowControl 的不可恢复终态，而不是等待状态。注册或刷新 Tool 不扫描、不唤醒、不执行旧 Task；上游必须在同 Context 提交新 Task。旧 Task 和 Control 保留终态证据，Goal 独立保持 active，直至新 Task 推进或显式 Goal cancellation 结束它。后续 Task 的 Goal Patch/Goal cancellation 不改写旧终态，Round 追加按 PostgreSQL 非终态行锁授权。现有列与约束已表达该值和证据，因此无新增 Migration。
- v1.0.11 按任务包的字面优先级将可用 MCP 声明置于 Admin override 之前；override 会跨 refresh 保留，但在 MCP 声明存在时处于 dormant 状态，声明消失后才生效。SDK `execution.taskSupport` 与明确的 read-only/destructive annotation 被翻译为保守项目语义；精确五字段扩展使用 `_meta["io.sdar/tool-execution-semantics"]`，键存在但内容畸形时整个发现失败并保留旧注册快照，不静默降级。`idempotentHint` 不足以证明 request-key 或 server dedup，因此不会升级为 `server_managed`。LLM Enhancement 永远不是权威。Workflow plan/attempt 和 Invocation 保存发生时快照；本版本仍不实现 MCP Task Binding、远程 Task polling、设备状态权威或冲突控制。
- v1.0.12 将 0064 前的 Memory 行保守回填为 `unknown` / `model_inferred` 并排除在语义检索之外，直至未来通过显式再精炼生成新的 durable 证据；不会从旧文本猜测耐久性。模型必须返回严格七字段精炼结果，调用方的 `authorityHint` 只是候选来源上下文而非权限证明；bug-fixed 进一步要求 durable authority 与 application-owned 来源路径完全一致，模型不能自称 `admin` 或 `skill_experience` 提权。新 embedding 必须是有限数值的正维度向量，检索仅比较完全相同 provider 和维度，并在 repository handoff 前复制冻结。Memory content 只接受最大 64 层、无环、有限的 plain JSON 并深复制冻结。0064 down migration 仅在全部剩余向量都是三维时允许执行，否则以稳定错误拒绝潜在数据损失。动态坐标、电量、在线、占用、设备任务等状态即使被模型错误标成 durable，也由确定性策略强制为 `volatile` / `mcp`，当前值继续实时查询 MCP；终态后的 Memory 增强失败只形成可查询 warning，不改变已提交 Task/Goal/WorkflowControl。
- v1.0.13 的 Task 通知只适用于当前 V1 单进程 Runtime，是有界、易失的唤醒优化，不是系统记录、跨进程总线或崩溃恢复。所有通知必须发生在 PostgreSQL Task 写入提交后，A2A 被唤醒后仍必须回读 PostgreSQL；漏通知由默认 1,000ms 的安全轮询恢复，配置不得低于 100ms。当前 waiter 对每次 publish 都唤醒，以容纳同毫秒的有效状态变化；只允许时间戳严格更新的缓存快照直接唤醒后来者，避免陈旧缓存形成新 busy loop。未来多进程扩展需要独立 ADR 选择通知传输，并保留 PostgreSQL 权威回读。

Codex 发现新的缺口时在此追加，并通过 ADR 或阻塞报告处理。

## EP-00 执行发现

- 2026-07-11：当前目录不包含 Git 元数据，无法生成 Conventional Commit 证据，也无法基于 Git 恢复文件字节版本。首次建立格式门禁时，宽范围 Prettier 对部分 Markdown/JSON 基线执行了内容等价的排版重写；未改变需求文本或状态。格式脚本现已限制为代码与配置文件，后续不得格式化 `docs/`、`schemas/`、`examples/`、`source/`。如获得仓库原始 Git 历史，应恢复这些基线文件的原始排版后再重放明确的状态/缺口编辑。
- 2026-07-11：官方 `a2aproject/a2a-tck` commit `5996b79f9cefa6fc390980e383e358a66fb9e49e` 的顶层 `LICENSE` 和 README 声明 Apache-2.0，但 `pyproject.toml` metadata 声明 MIT。仓库提供精确 `uv.lock`，所以依赖可复现；许可证元数据冲突必须在正式纳入分发或 vendoring 前由上游修正或通过 ADR 明确解释。EP-01 可将其作为临时外部测试工具运行，但不得复制或作为生产依赖。
- 2026-07-11（2026-07-13 更新）：上述 TCK commit 内嵌 specification branch 为 `v1.0.0`。规范声明 patch 版本不参与 wire negotiation，因此 Agent Card/请求仍使用 `1.0`。当前确定性 TCK SUT 已补齐 input-required/history fixture，官方 HTTP+JSON/MUST 结果为 74 passed、161 scoped skips、0 failed/errors、100%；同时 production endpoint 合约直接覆盖 v1.0.1 的 `application/a2a+json`，并保留 TCK 所需 `application/json`。精确规范/SDK/TCK pin 与证据边界见 ADR-069；不声称 JSON-RPC/gRPC 或稳定 SDK。
- 2026-07-13：原始 SRS 的 A2A 版本描述内部冲突：多数正文、FR-A2A-002 与部署表写 1.0.0，但术语表和 NFR-COMP-001 验收文字指定 1.0.1。`docs/01_REQUIREMENTS_BASELINE.md` 已一致采用更严格的 1.0.1，ADR-069 将其作为规范基线，未修改原始 SRS。
- 2026-07-11（2026-07-13 最终更新）：Docker Desktop 的早期容器变更挂起已恢复。当前 `pnpm verify`、`pnpm demo:local` 和 `pnpm demo:acceptance` 均真实启动 PostgreSQL/pgvector 与 Redis；integration、41 场景 E2E、基础设施 smoke 和 Server/Console smoke 通过。早期不可用记录保留在历史报告中，但不再是当前阻塞。

## v1.1 MCP Tasks Phase 0 冻结项

- 2026-07-16：实施包引用的 `SDAR_v1.1_MCP_Tasks_升级方案.md` 不存在；仓库中 byte-frozen 的 `SDAR_v1.1_MCP_Tasks_升级设计文档.md` 与实施包内容匹配并作为对应设计输入。规范化实现设计写入 `docs/22_V1_1_MCP_TASKS_DESIGN.md`，未修改需求基线。
- 2026-07-16：所需 `tasks/get`、`tasks/update`、`tasks/cancel` 是官方 `io.modelcontextprotocol/tasks` extension 的形状，而 SDK 1.29.0 高层 `experimental.tasks` 是旧版 `tasks/result`、`tasks/list` 形状。Phase 1 Spike 进一步证明 v1 只协商到 `2025-11-25`，官方扩展禁止在该 legacy 协议启用，因此 ADR-090 覆盖 ADR-085 的客户端版本决策：生产 Adapter 精确使用官方 v2 beta.4 自动协商；v1 仅保留 legacy loopback Server fixture。
- 2026-07-16：官方 v2 beta.4 的 modern fixture 标注 `2026-07-28`，冻结 extension draft 标注 `2026-06-30`，且 SDK 未内建该扩展。实现必须保存协商修订并用本地冻结 Schema 做 exact-combination 合约测试；不得声称未测试 beta 或协议修订兼容。
- 2026-07-16：Phase 1 将远程 Task ID 限制为 1–512 个 visible ASCII 字符。该限制同时满足冻结 Schema 的非空标识语义、`Mcp-Name` Header 安全和有界输入要求；更宽字符集只有在上游 extension 明确编码规则并通过新的 Intake/ADR/契约门禁后才能接受。
- 2026-07-16：可执行 Spike 证明 beta.4 codec 会先于显式 Schema 拒绝 `resultType=task`，并把 `tasks/get`/`tasks/cancel` 当作 modern era 已删除的旧核心方法；transport 也不会从 `taskId` 派生 `Mcp-Name`。ADR-090 允许且仅允许 Adapter 内的临时 method/result/Header bridge；loopback 必须证明外部 wire 仍是官方方法、原始 payload 与精确 routing Headers。
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

## v1.1 MCP Tasks Phase 3 决策解释

- 2026-07-16：Phase 3 开始前已 fetch 所有远端，最新可用 hardening 仍为 `v1.0.4-bug-fixed`/`fa4b050`；未发现 v1.0.5 或 v1.0.11 发布标签。实现因此只增加 V1.1 Task metadata/readiness 接口，不改写 transitive Skill confirmation 核心或通用 Tool Semantics。后续标签合并时必须补做兼容收敛，当前不得声称覆盖其尚未发布语义。
- 2026-07-16：restricted 的既有计划确认只适用于同一节点规划时已经 restricted 且执行前风险未升级的刷新结果。available→restricted、风险等级/可能影响增加、预约减弱、有效期提前或最早开始推迟都要求重新确认，并在 Tool 网络调用前失败关闭。
- 2026-07-16：availability 结果是 Provider 预测证据。只有 `reservationMode=guaranteed` 且存在有效 `reservationRef` 才可展示为预约；best-effort/窗口永远不代表设备锁或 Provider 权威资源状态。
- 2026-07-16：0101 仍属于 disposable `sdar_v11_*` 隔离迁移链。受支持发布升级路径继续等待完整 `v1.0.13-bug-fixed` ledger；Phase 3 的真实 PostgreSQL 验证不等于最终发布迁移兼容声明。
## v1.1 MCP Tasks Phase 5 assumptions and gaps (2026-07-17)

- The exact pinned extension wire is `tasks/update({ taskId, inputResponses })`; it does not carry the design draft's `expectedRevision`. SDAR validates the binding revision locally and does not emit an unsupported field. See ADR-094.
- V1.1 accepts only bounded form-mode `elicitation/create` input. Sampling (`sampling/createMessage`), roots (`roots/list`) and URL elicitation fail closed until a separate UX, security and protocol decision exists.
- `tasks/update` and `tasks/cancel` return acknowledgements, not Provider state. A transport-uncertain running operation is recorded once and is not automatically retried; later `tasks/get` observations remain authoritative.
- Local Task/Goal cancellation is authoritative immediately for SDAR, while the remote binding remains `cancel_observing`. This deliberate split prevents a cooperative acknowledgement from being misreported as Provider `cancelled`.
- External production Provider interoperability remains unverified. Phase 5 uses exact protocol contracts, deterministic Provider simulation and real local PostgreSQL/Redis; Phase 6 owns composed loopback acceptance, API/Console completion and final release evidence.

## v1.1 MCP Tasks Phase 6 acceptance and release boundary (2026-07-17)

- `FR-MCPT-001..014`, `NFR-MCPT-001..004` and `AC-MCPT-01..16` are verified by the row-level mappings in `docs/17_TRACEABILITY_MATRIX.md`, the 16/16 machine acceptance inventory in `reports/v1.1-mcp-tasks/V11-ACCEPTANCE.json`, the real-infrastructure local acceptance run in `V11-LOCAL-DEMO.json`, and the unified gate in `reports/verification/summary.json`.
- Evidence classification is intentionally split. PostgreSQL/pgvector, Redis/BullMQ, HTTP, A2A, LangGraph, management API, Console bundle smoke, ServerRuntime restart and parallel/child composition are real local verification. Model decisions and MCP Tasks Provider business/state semantics are deterministic simulations. External production Provider interoperability remains unverified.
- The original SRS DOCX was checked through real OOXML structure extraction against the requirement identifiers and baseline. The current environment does not provide `soffice`, so page rendering, pagination, font substitution and visual layout are unverified. Structure extraction must not be described as DOCX visual QA.
- The latest `pnpm demo:acceptance` report records merge commit `df8b6e0` with `dirty=false`; the latest `pnpm verify` report records evidence commit `13194b8` with `dirty=false`. These are clean local attestations, while external production Provider interoperability and publication review remain outside the local evidence boundary.
- `v1.0.13-bug-fixed` (`91cd58ddcff57acf3ed846914feafaff603c69f2`) is an ancestor of the feature work and `origin/main`. `origin/main` contains the protected hardening merge at `6584bf0`. The final feature-to-main pull request and `v1.1.0-rc.1` tag have not been created and must remain pending until a committed exact tree passes the release gate.
- The Phase 6 management surface permits only bounded lifecycle reads and safe refresh/cancel requests. It does not convert cooperative acknowledgements into Provider terminal states, retry ambiguous side effects, or add an authentication/authorization model that conflicts with the trusted-intranet V1 baseline.
