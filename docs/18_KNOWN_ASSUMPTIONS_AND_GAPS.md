# 已知假设、冲突与待验证项

## v1.2.2 G00 decisions and external gates (2026-07-22)

- The frozen clean-slate decision conflicts intentionally with ADR-108's retained `legacy_v11` product
  path and ADR-097's `legacy_guidance` compatibility projection. ADR-109 supersedes those product
  behaviors for v1.2.2; historical ADR/report/migration evidence remains readable but is not a runtime
  compatibility promise.
- A Skill Goal DAG is planning/scheduling data, not an executable Workflow. LangGraph.js remains the
  only executor; every attempt uses the existing immutable Workflow path.
- The existing atomic Runtime Terminal Outcome mechanism may be reused only behind the new
  UserGoalPlanController port. Existing public terminal writers do not retain independent authority.
- The local operator `sdar` database has the already-recorded 0100–0104 ledger gap and was not repaired.
  G00 verification used explicit disposable database `sdar_v122_baseline_20260722`; G02 will provide a
  guarded clean v1.2.2 baseline/reset rather than migrate operator data.
- The read-only Provider worktree at source `196620a` contains clean Business Events schemas/fixtures and
  runtime source but modified generated reports. EXT-BE-SKELETON remains pending exact file/review lock;
  modified reports cannot prove conformance.
- The Provider's own interop-blocker report states `interopCertified=false` and lists all 13 SDAR interop
  scenarios unexecuted. EXT-BE-RUNTIME-CANDIDATE is present but G10 remains externally gated until a
  reproducible exact candidate and real public-interface run pass.
- No Provider defect is inferred from dirty reports or missing SDAR interop command. A Provider defect is
  filed only after an exact request/response contradicts V0.5.2.

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

## v1.2.2 final acceptance boundary (2026-07-22)

- The external Provider source worktree advanced independently during the Goal. SDAR used a byte-exact
  isolated archive of commit `8a81b1b02971fb124ed96372c440c449f9087c99`; it did not edit, branch,
  commit or submit a PR to the Provider repository. A moving external HEAD is not implicitly qualified.
- Provider Requirements Contract Frozen, Provider Runtime Candidate, SDAR Client Contract Passed, Real
  Interop Passed and arbitrary Profile 1.0 freeze are separate claims. Only the first four exact claims
  in the final reports passed; future Provider commits require requalification.
- The repository `.env` points at an unavailable historical port 54329. Final acceptance uses explicit
  disposable database URLs on the operator-managed test service at 55432. No operator ledger was
  repaired. Failed runs caused by the stale port and a historical smoke fixture are retained.
- Model decisions and Frozen Mock Provider scenarios are deterministic simulations. PostgreSQL/Redis,
  HTTP/A2A/LangGraph, Management API, production bundle/smoke, database restart and exact external
  Provider interop are real local evidence.
- Original SRS content was audited by complete OOXML extraction. Visual pagination/rendering remains
  unverified because no DOCX renderer is installed; v1.2.2 does not modify or publish the DOCX.

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

## v1.2 Skill usage Phase 3A assumptions (2026-07-17)

- The frozen Goal requires `domain` and `tag` catalog filters but neither the baseline `SkillVersion`
  nor the suggested `SkillUsageSpecification` introduces independent domain/tag authority. Phase 3A
  therefore derives a domain from the first dot, colon or slash-delimited capability segment and uses
  each exact capability as a tag. Matching is exact and case-sensitive. This preserves one catalog
  classification authority; an independent taxonomy requires an additive ADR and migration in Phase 7
  or later.
- Lifecycle is an operational projection, not a second state machine: `enabled → active`,
  `disabled → inactive`, and the other existing `SkillStatus` values project without translation.

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
- `v1.0.13-bug-fixed` (`91cd58ddcff57acf3ed846914feafaff603c69f2`) is an ancestor of the feature work and `origin/main`. `origin/main` contains the protected hardening merge at `6584bf0`. Exact commit `38356ea` passed isolated frozen install, unified verification and local demo; ready PR #4 and annotated `v1.1.0-rc.1` are published. Protected review/merge and stable `v1.1.0` remain pending.
- The Phase 6 management surface permits only bounded lifecycle reads and safe refresh/cancel requests. It does not convert cooperative acknowledgements into Provider terminal states, retry ambiguous side effects, or add an authentication/authorization model that conflicts with the trusted-intranet V1 baseline.

## v1.2 Phase 6 main baseline and adapter boundary (2026-07-17)

- Current `origin/main` `667146a` was already an ancestor of the V1.2 branch at Phase 6 entry; no empty
  integration merge was created.
- The Phase 4 `SkillTaskReadinessPort` remains mock-only. ADR-102 requires the Phase 8 production adapter
  to directly reuse V1.1 operation discovery and Task availability/timing/window/reservation contracts.
  Production Provider readiness is therefore not claimed by Phases 4–6.
- Phase 8 closes the mock-only gap with `V11SkillTaskReadinessAdapter` and exact registered operation
  discovery. Task Type is the case-sensitive operation name and Provider identity is the existing
  `serverId`; no separate certification source was supplied, so required attributes are limited to the
  deterministic validated Task-semantics projection. Unknown certifications have no evidence and fail
  closed. External production Provider interoperability remains unverified.
- Applied migration high-water remains 0104. Numbers 0105 and 0106 are allocated but no migration file
  exists until Phase 7 and Phase 11 respectively.

## v1.2 Phase 10 runtime and migration integration (2026-07-17)

- V1.1 is merged into `origin/main`, so the pre-main rule that only disposable `sdar_v11_*` databases
  may apply 0100+ can no longer remain the production profile. ADR-106 advances the default released
  chain through 0105 while retaining the isolated-profile acknowledgement/name guard for tests and
  rejecting any gap inside 0100..0105.
- The operator-owned local `sdar` volume currently contains 0064 and 0105 but not 0100–0104. This is an
  invalid historical ledger, not an authorized upgrade path. Verification proved the new runner rejects
  it and did not mutate the volume; a disposable bootstrap database supplied clean released-path
  evidence and was removed afterward.
- Required dynamic capability slots still require an exact choice before Usage composition. Phase 10
  wires the composition authority but does not let the model invent a choice; Phase 12–13 must add and
  verify the bounded choice path before claiming the formal area-patrol vertical.

## v1.2 final acceptance boundary (2026-07-18)

- The task package referenced a separately named overall design document that was not supplied. The
  exact task package and SRS were frozen, the missing input was recorded, and
  `docs/24_V1_2_SKILL_DRIVEN_CAPABILITY_USAGE_DESIGN.md` is the normalized implementation design. No
  requirement was silently invented or removed.
- Native v1.2 Usage intentionally freezes exact Skill/version authority from selection through
  execution. This is a versioned addendum to the SRS legacy current-version behavior; legacy Skills
  retain the existing current/graph projection and native plans fail closed on drift.
- Real local evidence covers PostgreSQL/pgvector, Redis/BullMQ, HTTP/A2A, LangGraph, MCP adapter wire,
  management API, Console build/smoke, migrations, restart and parent/child continuation. Model choices
  and MCP Tasks Provider business/state semantics are deterministic simulations. External production
  MCP Tasks Provider interoperability remains unverified and is not a required v1.2 deferred item.
- The operator-owned historical `sdar` database has a nonconforming 0100–0104 ledger gap. The runner
  rejects it without mutation. Empty and supported upgrade paths are verified in disposable databases,
  which is the release evidence; repairing operator data is an explicit future operator migration,
  not permission to falsify ledger rows.
- Original DOCX content was audited by complete OOXML extraction. Visual pagination/rendering remains
  unverified because `soffice` is unavailable; v1.2 does not modify or publish that DOCX.
- As of Phase 14 there are zero open required findings. Phase 15 completion remains conditional on its
  explicit command matrix, final reports, pushed evidence and Ready-for-Review transition.

## v1.2.1 Frozen MCP Tasks release blockers (2026-07-19)

- Real interop against `sdar-mcp-tasks-provider-runtime origin/main@c5594e4` found four external wire
  mismatches despite its 74/74 self-report: missing required Availability `reservationMode`; MRTR
  `inputRequests` embedded in CreateTaskResult; terminal `result/error` embedded in CreateTaskResult; and
  different `tasks/get`/Notification content for the same Runtime Revision. SDAR remains strict and is not
  Interop Certified. See `reports/v1.2.1-frozen-mcp-tasks/11-real-provider-interop.{md,json}`.
- The 2026-07-22 refresh of Provider Draft PR #15 at exact `65ac78a` fixes the get/Notification projection,
  but still omits `reservationMode` and emits MRTR/terminal-only fields in CreateTaskResult. Its green CI
  and 13/13 focused tests do not exercise the strict SDAR consumer schema, so they do not close G3/G4/G5.
- The frozen dependency tree is restored. A Windows junction fixture preserves the symlink-rejection
  security assertion without privileged file-link creation; the Frozen migration verifier now owns its
  default Compose lifecycle; Mock Task TTL and Availability windows are startup-relative. The complete
  `pnpm verify` passes 648/648 unit+contract, 84/84 integration, 60/60 E2E, migrations, build and both
  smoke stages. Clean exact commit `f7bdd7b` repeats the full gate with `dirty=false` in 212,915 ms; this
  still cannot substitute for the blocked real interop gate.
- The isolated `sdar-codex-phase9` Compose resources and extracted external archive were removed on
  2026-07-22 after independently verifying that the archive's junction target remained intact. External
  Provider fixes, real interop requalification and publication of its evidence are the remaining required
  deferred items; v1.2.1 is not release-ready.

### 2026-07-22 closure update

- Provider PR #15 merged as `main@217e089`. Independent Provider implementation `b30d839` corrects the
  remaining Availability and CreateTaskResult mismatches plus strict `tools/list`; complete `verify:v2`
  and the real SDAR HTTP matrix pass. PR #16 publishes the change at final evidence head `4d90b199`, and
  Actions run `29882714727` passes its `runtime-ci` and `runtime-compose` jobs.
- SDAR projection-aware admission corrects the discovered base CreateTaskResult/first DetailedTask false
  mismatch while requiring identical Task base fields. Clean exact commit `61142f9` passes the refreshed
  full gate with `dirty=false` in 184,634 ms.
- The only required deferred item is protected review and merge of Provider PR #16. Automatic merge is not
  authorized; G5 and PR #6 Ready status remain pending for that reason.

## v1.2.3 G00 normalization (2026-07-23)

- The task-package self-check used URL pathname handling that treated a Windows drive path as a URL
  pathname and reported all files missing; `eslint .` also rejected its browser globals. G00 changed the
  package support script to `fileURLToPath`/`process.stdout`, updated only its declared package hash and
  retained both failed attempts. All 50 declared hashes and 18 Goal records now verify.
- `Best_Implementation_Design` contains an earlier ten-item KD numbering, while `Overall_Design`, Frozen
  Decisions, G00 and the acceptance package define final KD-01–KD-20. ADR-111–113 and
  `docs/27_V1_2_3_COGNITIVE_RUNTIME_DESIGN.md` explicitly use the final twenty-item register.
- The AutoSkill locked commit has no LICENSE/NOTICE despite its README MIT badge. It remains behavior
  reference only, with source and long-prompt copying prohibited. The other five source licenses and
  absence of root NOTICE were checked at their exact commits; G00 copies no upstream code.

## v1.2.3 G12 Promotion boundary (2026-07-26)

- G12 provides the strict Shadow report contract and requires a passing report for Task Type and all
  high-risk activation, but the production Shadow harness is intentionally not supplied until G16.
  The runtime source therefore returns no report and those candidates fail closed; no Mock or static
  report is accepted as final evidence.
- Promotion replay in G12 is a side-effect-free evaluation over persisted authoritative Episode
  outcomes. G16 must add the richer holdout/replay/shadow comparison harness without changing G12's
  lifecycle, PostgreSQL authority or manual activation gates.

## v1.2.3 G13 Retrieval boundary (2026-07-26)

- G13 composes the governed Retriever but intentionally does not inject it into formal planning;
  decorator/fallback behavior and injection-mode rollout belong to G14.
- Task-scoped Knowledge is fail-closed unless its authoritative definition carries the exact `taskId`;
  the shared v1.2.3 knowledge skeleton has no separate task-scope column. Tenant and user scopes use
  dedicated columns and are exact-match filtered.
- Reflection automatically projects `related` and revision `supersedes` edges. The reader supports all
  five frozen relation types, while `requires`, `contradicts` and `supported_by` rows require a
  governed structured knowledge producer; G13 adds no public relation-mutation API.
- The P95 result is a reproducible local PostgreSQL integration measurement, not a production capacity
  claim. G17 must repeat capacity/soak measurement in its release environment.

## v1.2.3 G14 Planning injection boundary (2026-07-26)

- The frozen public name `active` is represented by the existing Domain value `active_low_risk`;
  G14 does not add a second spelling or permit medium/high-risk automatic injection.
- G14's default deployment mode is the frozen `shadow`. G15 owns operational exposure/configuration;
  G16 owns independent Replay/Shadow comparison reports. Neither may convert a shadow hash or usage row
  into a formal Plan or Promotion decision.
- Timeout abandons the decorator wait but cannot cancel an already running read-only retrieval Promise.
  `PlanningKnowledgeRetriever.prepare` performs no durable write, so late completion cannot reserve
  usage or mutate planning state.
- Fallback rows record retrieved provenance and the exact fallback reason with no affected Skill Goal.
  Only a validated enriched plan or completed shadow plan receives affected-goal attribution.
- Final Outcome linkage is Goal-version scoped because the v1.2.2 terminal authority commits at that
  boundary. G17 must repeat the lineage query under release-capacity concurrency.

## v1.2.3 G15 management authentication and audit boundary (2026-07-26)

- The authoritative V1 baseline remains trusted-intranet/no-auth. In the default mode `actorId` is an
  operator-supplied audit label, not authenticated identity. ADR-115 adds an optional bearer guard for
  cognitive management writes without claiming multi-tenant authentication or changing A2A access.
- A pending/failed PostgreSQL management action claim is deliberately not auto-retried after restart.
  This fail-closed posture avoids duplicating a write whose authority may have committed before a
  process failure; operator review and a new idempotency key are required.
- Cognitive management audit stores displayable API results but is not Plan, Knowledge, Experience or
  Capability authority. A private-reasoning key is rejected before persistence.
- G15 does not add tenant identity or cross-tenant authorization. Production exposure beyond a trusted
  network still requires a separately reviewed authentication/authorization architecture.

## v1.2.3 G16 Replay and Shadow boundary (2026-07-26)

- The default production evaluator is intentionally conservative and emits neutral
  Baseline/Champion/Candidate results from immutable recorded metrics. The fixture's improved verdict
  validates comparison mechanics only; it is not a production model-efficacy claim.
- Replay includes only complete Goal Experience Episodes referenced by the exact Candidate evidence.
  It never fabricates missing Contract, Plan, Outcome or catalog data. Fewer than three usable cases
  remains `incubating` and cannot activate Knowledge.
- The deterministic last-one-third holdout is reproducible and disjoint, but it is not randomized or
  stratified. Larger production datasets may require a separately versioned split policy without
  reinterpreting existing report hashes.
- `promotion_provenance_report` is audit/evaluation evidence, not Active Knowledge or a file-based
  knowledge authority. Rollback refuses to discard a populated report table.
- `NoPhysicalProvider` rejects every nonzero Provider/MCP/device receipt. G16 performs no live device
  interoperability or production Shadow efficacy run; G17 owns the frozen rollout and release
  environment evidence.

## v1.2.3 G17 release evidence boundary (2026-07-26)

- Capacity figures are local release measurements, not a production soak claim. Twenty concurrent
  waiters and PostgreSQL P95 evidence exceed the specified single-instance 1–10 active-task target,
  but production sizing still requires deployment-specific observation.
- Model/MCP E2E uses deterministic local services through the real product path. External physical
  Provider execution is deliberately excluded from Replay and is not claimed.
- The v1.2.2 disposable real database-restart audit remains the service-restart evidence for unchanged
  execution authorities. v1.2.3 adds startup reconstruction tests and real persistence integration;
  it does not restart the operator-managed PostgreSQL service.
- Deletion propagation invalidates user-scoped search/Memory projections. Immutable audit/source facts
  follow the configured legal retention boundary and are not silently physically erased.
- G17 does not add external authentication or tenant authorization. Trusted-intranet warnings remain
  release requirements.

## v1.3 P01 Runtime Artifact Domain boundary (2026-07-26)

- The frozen P01 registry fixes all top-level fields but does not separately freeze every nested
  helper type used by plan templates and cases. ADR-116 adopts the exact shared-design/P04 Plan
  Template nested shapes and the smallest bounded pure-data shapes for the remaining helpers; later
  packages must version any incompatible nested-field change instead of silently widening these
  definitions.
- JSON Schema uses five SDAR extension keywords implemented by the isolated AJV adapter for recursive
  JSON depth, expression depth, condition-node count, keyed uniqueness and Plan DAG/cross-reference
  semantics. Consumers that validate the portable schema must use the SDAR adapter or implement these
  documented keywords; generic validators that ignore annotation-like extensions do not prove the
  complete Domain acceptance boundary.
- The documented lifecycle arrow is treated as the primary promotion/revalidation spine, with an
  explicit Domain transition table for rejection, deprecation, and archival. Activation requires
  validation plus recorded approval; P01 deliberately does not implement an active-pointer write.
- `requiredSkillVersionRefs` is implemented as a required array because it is an exact frozen
  `ArtifactDependencySnapshot` field. An artifact with no direct version dependency uses an empty
  array; omission is schema-invalid.
- P01 provides only domain and schema contracts. It makes no persistence, compilation quality,
  online routing, Skill execution, MCP/Provider interoperability, API, Console, or rollout claim.

## v1.3 P02 Artifact authority boundary (2026-07-27)

- The frozen relational columns do not enumerate every P01 top-level Artifact and Lineage field.
  ADR-117 therefore stores the complete validated P01 aggregate in the bounded
  `compiled_artifact.definition` envelope and treats the other frozen columns/tables as checked,
  indexed projections. Projection drift fails closed.
- `cognitive_runtime_outbox.aggregate_version` is the event aggregate revision. Activation and
  deprecation use the Active Pointer revision so the same immutable Artifact version can be
  reactivated by a governed rollback without colliding with prior events; payloads retain the exact
  Artifact version.
- P02 provides an in-process rebuildable projection and a durable PostgreSQL consumer cursor. Later
  retrieval/runtime packages may add Redis/FTS/vector projection adapters, but Redis cannot become
  Artifact or Active Pointer authority.
- The non-production identity adapter accepts only an explicitly constructed operator context.
  Production construction requires an external identity provider and fails closed without one. P02
  adds no public authentication/API endpoint and does not change the trusted-intranet V1 baseline.
- G04 establishes governance mechanics only. Full promotion/revalidation policy and Shadow evidence
  remain P06; online retrieval/routing remain P07/P10. P02 performs no User Request, Skill, MCP,
  Provider, A2A or LangGraph execution.
