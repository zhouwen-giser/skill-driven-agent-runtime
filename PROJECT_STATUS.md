# Project Status

EP-03 Workflow DSL validation update (2026-07-12): approximately 40%. Ten whitelisted node kinds and restricted expressions are domain-owned and serializable; validation covers structure, references, reachability, bounded loops, current MCP Tool arguments, and current Skill inputs. Planner correction, persistence, compiler, and execution remain open.

EP-03 Prompt lifecycle update (2026-07-12): approximately 28%. Prompt versions are PostgreSQL-authoritative, immutable, stage-scoped, publishable/disableable/rollbackable, linked to real model invocations, and expose success/failure/latency/Token effects. AC-15 candidate-before-publish behavior passes e2e. Automatic candidate generation from failures/evaluations remains EP-05 work.

EP-03 Model Runtime update (2026-07-12): approximately 18%. PostgreSQL Provider configurations and fixed stage routes, AES-GCM credentials, OpenAI-compatible/local structured and embedding HTTP calls, sanitized invocation audit, token/duration capture, timeouts, and no-fallback failure semantics are implemented. Real local HTTP, PostgreSQL, and same-process e2e pass; Prompt versions and remaining decision stages/Workflow DSL remain open.

EP-02 pgvector selection update (2026-07-11): approximately 84%. Current enabled SkillVersion content is projected into PostgreSQL pgvector, provider/dimension drift fails closed, real cosine scores join persisted operational metrics, and only a separately injected decider can make the final selection. Unit, real PostgreSQL integration, and same-process e2e pass. Production embedding/model adapters and invocation audit remain EP-03 gaps.

EP-02 Skill authoring update (2026-07-11): approximately 79%. Structured model output is shape-checked, both generated Schemas are Ajv-validated and explicit, invalid output receives one bounded correction attempt, and failure persists no fallback Skill. PostgreSQL/Agent Card e2e uses an injected simulated provider; a production ModelProvider adapter, stage routing, Prompt versions, and invocation audit remain EP-03 gaps.

EP-02 Temporary Skill update (2026-07-11): approximately 74%. Task-scoped Temporary Skills are isolated from the formal registry, validate live MCP Tool references, expire into PostgreSQL Experience records, and produce only an `awaiting_simulation` candidate after two equivalent successes. Unit, integration, contract, and real same-process e2e pass. Automatic capability-gap generation/execution and EP-05 simulation/publication remain open.

EP-02 selection update (2026-07-11): approximately 68%. Candidate metric snapshots, LLM decision boundary, persistent selection evidence, and confirmation-bound alternative plans are implemented with simulated decider tests and real PostgreSQL persistence. Production ModelProvider/e2e remains open.

EP-02 graph update (2026-07-11): approximately 60%. The six-relation Skill Graph is domain-owned, persisted, cycle-checked, exposed through management API, and verified with real e2e. Selection, temporary Skills, LLM generation, and Console remain open.

EP-02 lifecycle update (2026-07-11): approximately 52%. MCP remote health/credential rotation and Skill version list/diff/rollback APIs are verified. Remaining core gaps are LLM Schema/metadata generation, Skill graph/search/selection, temporary Skills, and Console.

EP-02 management update (2026-07-11): approximately 45%. Same-process MCP/Skill management HTTP API, OpenAPI contract, trusted-intranet risk markers, and real e2e CRUD are implemented. Console, LLM generation, Skill graph/search/temporary Skills remain open.

EP-02 audit update (2026-07-11): approximately 38%. MCP invocation traces, persistent Skill dependency warnings, and editable refresh-stable Tool enhancement metadata are implemented. Management API/console and LLM-driven enhancement/failure decisions remain open.

EP-02 update (2026-07-11): approximately 30%. Persistent Skill Registry and remote MCP register/refresh/delete/call with AES-256-GCM credentials pass real integration, official SDK contract, and single-process e2e tests. Remaining: LLM Schema/metadata generation, Skill graph/search/temporary Skills, persisted warnings/audits, and management API/console.

更新时间：2026-07-11 19:04 +08:00

| 阶段                           | 状态   | 完成度 | 最近证据                                                                             | 阻塞                                                     |
| ------------------------------ | ------ | -----: | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| EP-00 仓库与兼容性基线         | 已完成 |   100% | `pnpm verify:bootstrap` 16/16；`pnpm smoke:infra`：pgvector 0.8.4、migration、Redis PONG/写读通过 | 当前目录缺少 Git 元数据，无法提供 Conventional Commit 证据 |
| EP-01 协议与领域骨架           | 进行中 |    94% | 生产断流继续/轮询/resubscribe 已验证；FR-A2A-001/004/005 已关闭；e2e 5/5 | 精确 1.0.1 标签、持久化 SkillVersion schema/Card provider、管理端草案查看为跨 EP 缺口 |
| EP-02 MCP 与 Skill 基础        | 进行中 |    15% | Skill/SkillVersion、原子版本仓储、发布门禁、动态 Agent Card 与权威结果 Schema 已接通 | MCP Registry、LLM Schema 生成、Skill 图谱/检索与管理 API |
| EP-03 Workflow 规划与运行时    | 未开始 |     0% | -                                                                                    | -                                                        |
| EP-04 任务生命周期与 Goal 闭环 | 未开始 |     0% | -                                                                                    | -                                                        |
| EP-05 记忆、评估与演化         | 未开始 |     0% | -                                                                                    | -                                                        |
| EP-06 控制台与可观测性         | 未开始 |     0% | -                                                                                    | -                                                        |
| EP-07 加固与完整验收           | 未开始 |     0% | -                                                                                    | -                                                        |

## 当前目标

将 A2A official SDK endpoint 接入 TaskService/PostgreSQL/BullMQ，覆盖 submit/query/list/cancel/stream/default metadata。

## 最近完成

- 已建立需求基线和 Codex 项目任务包。
- 已启动 Codex Goal，完整核对原始 SRS（226 个段落、38 张表）、DoD、追踪矩阵与 EP-00 前置材料。
- 已确认 A2A SDK 稳定通道仍为协议 v0.3，v1.0 支持需使用 beta 并进行 1.0.1 契约验证。
- 已建立 strict TypeScript pnpm workspace；`pnpm verify:bootstrap` 的 format、lint、typecheck、10 tests 和 build 全部通过。
- 已完成直接依赖与八个参考项目的 intake/pin；MCP 真实 loopback 和 LangGraph 真实执行 Spike 通过，A2A wire fixture 模拟验证通过。
- 已完成 A2A 官方 REST/streaming loopback endpoint、协议版本拒绝和 MCP 远端取消传播契约。
- 已完成 digest-pinned Compose、pgvector migration/rollback、CycloneDX SBOM、266 个 npm 包许可证清单和第三方通知；统一门禁为 16/16 tests。
- 已验证 A2A 客户端断流不终止任务且可轮询完成，以及 LangGraph 并行汇聚与 compiled subgraph。

## 当前风险

- A2A JavaScript SDK 对 1.0 的支持可能使用 beta 渠道，必须先做兼容性 Spike。
- 首版范围很大，必须坚持垂直增量和证据门禁，避免先搭空平台。
- 当前目录不是 Git 工作树，暂时无法提供 Conventional Commit 证据。
- Docker 阻塞已在恢复环境中解除，真实基础设施 smoke 通过；外部 A2A TCK 移交 EP-01。
- EP-01 已建立领域权威 Task/Context/Goal、application ports/TaskService 和自动 architecture boundary gate。
- EP-01 已完成真实 PostgreSQL Repository/migration、Redis/BullMQ context 串行队列和可重建 A2A 协议投影；专用 integration runner 6/6 通过。
