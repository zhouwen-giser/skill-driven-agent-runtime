# EP-01 协议与领域骨架

## Purpose / Outcome

第三方 A2A 客户端可发现 Agent Card、提交/查询/取消/流式读取 Task；内部 Task/Context/Goal 和 BullMQ 串行调度真实运行。

## Requirements Covered

FR-A2A-001, FR-A2A-002, FR-A2A-003, FR-A2A-004, FR-A2A-005, FR-A2A-006, FR-A2A-007, FR-A2A-008, FR-A2A-009, FR-A2A-010, FR-A2A-011, FR-A2A-012

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [ ] domain entities and state machines
- [ ] A2A adapter and public capability projection
- [ ] Postgres repositories and migrations
- [ ] BullMQ queue and context serialization
- [ ] A2A test client and contract suite

## Progress

- [x] 2026-07-13: reconcile FR-A2A-012 with the later source-governed publication E2E; management draft visibility, bypass rejection, and post-publication Agent Card projection are verified.

- [x] 2026-07-11 20:21 +08:00 Production e2e now proves stream disconnect does not stop TaskService/BullMQ work, polling reaches INPUT_REQUIRED, standard resubscribe returns a Task snapshot, and active streams do not block shutdown. FR-A2A-001/004/005 moved to verified; e2e 5/5 passed.

- [x] 2026-07-11 20:15 +08:00 Added ADR-009 and Ajv 8.20.0 intake/pin, isolated JSON Schema adapter, application Result Processor, authoritative completion and A2A dual text/data artifact projection. Unit 21 and real e2e 4 passed; SkillVersion schema lookup remains EP-02.

- [x] 2026-07-11 20:04 +08:00 Implemented FR-A2A-012 draft-only intake: explicit Skill create/update intent maps to a domain SkillDraft, persists in PostgreSQL before queueing, and remains absent from Agent Card. Unit 18, integration 7, contract 13, e2e 3 passed; management visibility remains EP-06.

- [x] 2026-07-11 19:55 +08:00 Agent Card now reloads enabled capabilities per discovery request; e2e covers add/update/disable without restart. Added independent e2e and built-server smoke gates. `pnpm verify:ep01` passed: unit 17, integration 6, contract 12, e2e 2, build/smoke, official TCK 67 passed/0 failed.

- [x] 2026-07-11 19:47 +08:00 Ran official A2A TCK commit `5996b79...` with frozen lock. Protocol harness: 67 passed/0 failed/168 skipped; real production composition: 63 passed/5 failed/167 skipped, with only immediate artifact/message fixture cases open. Added reproducible `pnpm test:a2a-tck` and preserved raw reports.

- [x] 2026-07-11 19:28 +08:00 Added whitelisted A2A follow-up messages for revise/confirm/provide-input/pause/resume. Official-client multi-turn integration uses real PostgreSQL and Redis; bootstrap 29/29 and integration 7/7 passed. Final-result retrieval remains dependent on later runtime slices.

- [x] 2026-07-11 19:22 +08:00 Wired the official A2A HTTP endpoint through the server composition root to TaskService, PostgreSQL and BullMQ. Real-container submit/stream/get/list/cancel reaches the mandatory plan-confirmation boundary; bootstrap 28/28 and integration 7/7 passed.

- [x] 2026-07-11 19:13 +08:00 Added validated A2A message/task mappings and a PostgreSQL-backed rebuildable A2A `TaskStore` projection; unit 16/16, contract 12/12, and real-container integration 6/6 passed. Domain `agent_task` remains authoritative; endpoint lifecycle wiring is still open.

- [x] 2026-07-11 18:45 +08:00 读取 EP-01、领域/API/架构基线、accepted ADR 和 architecture guardian，确认 EP-00 真实 smoke 已通过。
- [x] 2026-07-11 18:46 +08:00 明确类型所有权与依赖方向，并将具体增量补充到本计划。
- [x] 2026-07-11 18:51 +08:00 实现 Task/ConversationContext/Goal 领域模型、状态机、稳定错误码、application ports 和 TaskService；25/25 tests 与 architecture gate 通过。
- [x] 2026-07-11 18:58 +08:00 实现 PostgreSQL Context/Task/Event repositories、0002 migration/down migration；真实容器 3/3 integration tests 通过。
- [x] 2026-07-11 19:01 +08:00 实现 BullMQ queue、Worker 和 keyed context serializer；真实 Redis 2/2 integration tests 覆盖同 context 串行、跨 context 并行、attempts=1 和排队 job 重启保留。
- [ ] 将 A2A Adapter 接入 TaskService，完成 submit/query/cancel/stream/list/default metadata e2e。
- [ ] 运行官方 A2A TCK HTTP+JSON MUST suite并保存报告。
- [ ] 完成实现增量。
- [ ] 完成测试与验证。
- [ ] 更新 Traceability Matrix、PROJECT_STATUS、ADR 和 Outcomes。

## Discoveries and Surprises

- 2026-07-11：EP-00 恢复环境中的 Docker Desktop 4.81.0 / Engine 29.6.1 可用，真实 pgvector/Redis smoke 通过，EP-01 可以按依赖顺序启动。
- 2026-07-11：领域 Task 需要比 A2A 标准状态更细的阶段；这些阶段由 Domain 持有，A2A Adapter 后续只投影到官方 TaskState 和可读状态消息。
- 2026-07-11：既有 context 的 userId 是 PostgreSQL 权威值，后续消息 metadata 不得静默改变 context 所有者；当前 TaskService 已固定该行为。
- 2026-07-11：BullMQ OSS 不原生提供满足本项目语义的 context group concurrency；V1 单进程 Worker 使用 application-independent keyed serializer，Redis仍只持久化排队 job。不同 context 可使用 Worker concurrency 并行。
- 2026-07-11：`vitest run` 在新增 integration project 后会隐式运行需要外部服务的测试；bootstrap gate 已显式限定 unit+contract，integration runner 负责 compose 生命周期，避免环境偶合与 skipped 测试。

## Decision Log

- 2026-07-11：`packages/domain` 拥有 Task/Context/Goal 和领域错误；`packages/application` 拥有 Repository/Queue/Event ports 和用例 DTO；Adapters 只能实现 ports，不能把 SDK/ORM/BullMQ 类型传入核心。
- 2026-07-11：新增 `verify:architecture` 自动拒绝 Domain/Application 的 SDK/Express/存储/队列导入，并限制 LangGraph/A2A/MCP 官方类型在各自 Adapter 内。
- 2026-07-11：选择直接 `pg` adapter 而非提前引入 ORM；SQL 和 row mapping 局限在 `persistence-postgres`，核心 ports 不暴露 driver 类型。
- 2026-07-11：BullMQ job 固定 attempts=1、removeOnComplete/removeOnFail=false，Worker maxStalledCount=0；运行中故障标记与归档在 EP-04 接入 Task lifecycle 后完成。

## Implementation Steps

1. 实现不可变 Task、ConversationContext、Goal 值模型与显式状态转换；错误使用稳定 code。
2. 定义 application-owned repository/queue/event/clock/id ports，TaskService 先持久化 PostgreSQL 权威对象再入队。
3. 添加 PostgreSQL migration 和 Repository adapter，覆盖空库/重复迁移/保存查询/事务失败。
4. 添加 Redis/BullMQ queue adapter，以 context_id 作为串行分组，attempts=1，验证同 context 串行、不同 context 可并行、排队任务重启保留。
5. 将 A2A official SDK handler 改接 TaskService，映射 metadata、缺省 context/user、内部阶段、文本+结构化输出。
6. 覆盖 submit/get/list/cancel/non-stream/stream/disconnect/resubscribe 和可信内网 warning；运行官方 TCK HTTP+JSON MUST suite。
7. 执行 implementation gate、真实 compose e2e，更新追踪、报告、ADR/CHANGELOG 和 Outcomes。

## Validation

- [ ] `A2A contract tests`
- [ ] `same context serial e2e`
- [ ] `stream disconnect task continues`
- [ ] `anonymous/default context behavior`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-01-protocol-domain-skeleton/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

阶段完成后记录实际交付、未完成项、技术债、性能数据和对后续阶段的影响。
