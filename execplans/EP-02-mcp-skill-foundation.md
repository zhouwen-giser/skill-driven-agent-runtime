# EP-02 MCP 与 Skill 基础

## Purpose / Outcome

管理员可注册远程 MCP、发现/刷新 Tool、增强元数据；可创建 Skill 草案、生成 Schema、验证/发布/版本化，并动态投影到 Agent Card。

## Requirements Covered

FR-SKL-001, FR-SKL-002, FR-SKL-003, FR-SKL-004, FR-SKL-005, FR-SKL-006, FR-SKL-007, FR-SKL-008, FR-SKL-009, FR-SKL-010, FR-SKL-011, FR-SKL-012, FR-SKL-013, FR-SKL-014, FR-SKL-015, FR-MCP-001, FR-MCP-002, FR-MCP-003, FR-MCP-004, FR-MCP-005, FR-MCP-006, FR-MCP-007, FR-MCP-008, FR-MCP-009, FR-MCP-010, FR-MCP-011, FR-MCP-012, FR-MCP-013

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [ ] MCP registry and encrypted credentials
- [ ] Tool discovery/call envelope and mock server
- [ ] Skill model/version/relation/search
- [ ] LLM schema generation and validation
- [ ] management APIs and minimal real console pages

## Progress

- [x] 2026-07-12: verify global formal-Skill reuse across distinct user identities and replace direct `skill_call` model invocation with an independent LangGraph child plan/instance that records the actual current SkillVersion and evaluation summary.
- [x] 2026-07-12: reconcile provisional FR-SKL evidence against completed EP-03/04 paths and enforce selected-Skill required/forbidden Tool policy after planning and before execution.
- [x] 2026-07-12: persist Task selection identity and complete real failed-instance to enabled-alternative plan to mandatory reconfirmation to replacement execution.

- [ ] 读取材料并记录当前代码状态。
- [ ] 将具体文件、接口和步骤补充到本计划。
- [ ] 完成实现增量。
- [ ] 完成测试与验证。
- [ ] 更新 Traceability Matrix、PROJECT_STATUS、ADR 和 Outcomes。

## Discoveries and Surprises

执行期间持续追加，包含 SDK 实际行为、失败测试和与原假设不同之处。

## Decision Log

执行期间持续追加；重大决定另建 ADR。

## Implementation Steps

1. 建立或更新本阶段接口和数据设计。
2. 先实现确定性核心和测试替身。
3. 完成真实 Adapter/Repository/Runtime。
4. 打通最短端到端链路。
5. 扩展边界、失败、取消和可观测性。
6. 完成管理接口/UI（适用时）。
7. 运行完整验证并修复全部失败。

## Validation

- [ ] `MCP integration tests`
- [ ] `invalid Skill schema registration fails`
- [ ] `Skill enable/disable changes Agent Card`
- [ ] `tool schema refresh warning behavior`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-02-mcp-skill-foundation/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

## pgvector Skill Retrieval Progress Update - 2026-07-11

- [x] Add provider-neutral embedding and persistence ports.
- [x] Store current SkillVersion search projections in PostgreSQL pgvector with provider/dimension guards.
- [x] Use real cosine scores only as candidate context beside operational metrics.
- [x] Preserve the independent final-decider boundary and persist its selected version and summary.
- [x] Verify real PostgreSQL vector behavior and same-process selection e2e.
- [ ] Implement production embedding/model adapters and model-call audit in EP-03.

Decision: ADR-017 makes vector state rebuildable and prevents retrieval rank from becoming final selection.

## Structured Skill Authoring Progress Update - 2026-07-11

- [x] Add a vendor-neutral structured ModelProvider application port.
- [x] Validate generated metadata shape and explicit input/output JSON Schemas before registration.
- [x] Bound correction to two attempts and fail closed with a request for more description.
- [x] Persist only through the existing Skill registry and verify PostgreSQL plus Agent Card e2e.
- [x] Return an explicit error when no production model is configured; never use a static fallback.
- [ ] Implement and verify production Provider adapters, fixed stage routing, Prompt versions, and model-call audit in EP-03.

Decision: ADR-016 treats model output as untrusted data and keeps vendor objects outside core layers.

## Temporary Skill Progress Update - 2026-07-11

- [x] Add task/context-scoped Temporary Skill domain models outside the formal Skill registry.
- [x] Validate current enabled MCP Tool references and JSON Schemas before persistence.
- [x] Atomically expire completed Temporary Skills into Experience records.
- [x] Require two equivalent successes before creating an `awaiting_simulation` formalization candidate.
- [x] Verify PostgreSQL persistence and same-process management API with real loopback MCP e2e.
- [x] Wire automatic capability-gap detection, mandatory-confirmation Workflow execution, and task-completion callbacks.
- [ ] Route formalization candidates through EP-05 simulation/evaluation and governed Skill publication.

Decision: ADR-015 keeps temporary state out of the formal registry and prevents repeated success from bypassing simulation.

## Automatic Temporary Skill Execution Update — 2026-07-12

- [x] Resolve capability gaps through a fixed schema-constrained decision over enabled MCP Tool inventory.
- [x] Reject invented Tool references and create a Task/context-scoped Temporary Skill outside the formal registry.
- [x] Persist an exclusive Temporary Skill binding on the Task and compile its plan through the existing Workflow DSL/LangGraph path.
- [x] Enforce mandatory confirmation and prove zero Tool calls before confirmation.
- [x] Execute exactly one real loopback MCP call, finalize the Task, expire the Temporary Skill, and save Experience.
- [x] Prove the formal Skill registry and dynamic Agent Card remain unchanged.
- [ ] Complete FR-SKL-015 simulation and governed publication in EP-05.

Decision: ADR-045 connects the isolated lifecycle from ADR-015 to the single runtime without granting Temporary Skills auto-confirm or publication authority.

## Skill Selection Progress Update — 2026-07-11

- [x] Build candidate snapshots with semantic, success, latency, cost, failure and stability signals.
- [x] Require a structured decider result that references an enabled candidate.
- [x] Persist candidate snapshots, selected SkillVersion and displayable decision summary.
- [x] Restrict replacements to enabled `alternative` graph targets and persist only `awaiting_confirmation` plans.
- [x] Verify orchestration with a simulated decider and persistence with real PostgreSQL.
- [ ] Wire a production structured ModelProvider, pgvector retriever, management views and failure/reconfirmation e2e.

Decision: ADR-014 prevents retrieval scores from becoming the final selector and excludes private reasoning from persisted decisions.

## Skill Graph Progress Update — 2026-07-11

- [x] Add all six required typed directed Skill relations.
- [x] Reject missing endpoints, self-reference, duplicates, and parent/dependency cycles.
- [x] Persist graph edges and metadata in PostgreSQL with rollback migration.
- [x] Expose graph list/create/delete through management HTTP and OpenAPI.
- [x] Verify domain, real PostgreSQL, and real same-process e2e behavior.
- [ ] Consume graph relations in Skill selection and replacement planning.

Decision: ADR-013 keeps graph authority in the Skill domain and treats future React Flow state as a projection only.

## Registry Lifecycle Progress Update — 2026-07-11

- [x] Add remote MCP protocol health without Tool rediscovery and persist enabled/unreachable status.
- [x] Validate replacement registration credentials remotely, encrypt them, and disconnect the old session.
- [x] Expose immutable Skill history, top-level field diff, and rollback-as-new-version.
- [x] Verify real management e2e plus application tests for changed credentials and unreachable health.
- [ ] Add management operation audit records and Console views.

Test distinction: the official loopback server fixture supports one initialized session. Real e2e verifies same-value credential re-encryption through the full stack; changed-header validation is simulated at the application transport port. Production transport behavior for ping is covered with the official SDK contract session.

## Management API Progress Update — 2026-07-11

- [x] Add a same-process management listener isolated from A2A SDK routing.
- [x] Expose real MCP and Skill registry operations with Zod validation and redacted errors.
- [x] Mark every response and health output as unauthenticated trusted-intranet-only.
- [x] Add OpenAPI, contract tests, real PostgreSQL/Redis/Mock MCP e2e and built smoke coverage.
- [ ] Add MCP credential update/remote health, Skill rollback/diff, and the React console.

Decision: ADR-012 uses a second listener inside the same process so management DTOs do not contaminate A2A SDK routing or core modules.

## MCP Audit Progress Update — 2026-07-11

- [x] Persist successful/failed/canceled invocation inputs, displayable outputs/errors, correlation IDs and duration.
- [x] Atomically persist dependency warnings for current enabled SkillVersions on Tool removal/schema change without changing Skill status.
- [x] Validate/edit Tool enhancement metadata and preserve it across refresh by Tool name.
- [x] Verify V1 repeated calls are not deduplicated or protected by idempotency keys.
- [ ] Expose these records through management API/console and add LLM generation/decision ports.

Discovery: PostgreSQL inferred a reused polymorphic warning parameter as text; explicit parameter casts are required in the INSERT-SELECT. The failing transaction rolled back cleanly and the regression is covered by the real repository test.

## MCP Registry Progress Update — 2026-07-11

- [x] Added remote-only MCP Server/Tool domain models and application ports.
- [x] Added runtime register/delete/manual refresh and atomic PostgreSQL Tool replacement.
- [x] Added official SDK Streamable HTTP adapter with persistent sessions, calls, and cancellation.
- [x] Added AES-256-GCM credential encryption using an environment-only master key.
- [x] Enforced current original Tool input schema, including MCP draft-07 support.
- [x] Verified unit 28, integration 9, contract 14, e2e 6, architecture, typecheck, lint, and build.
- [ ] Persist/display dependency warnings and invocation audits; add metadata enhancement and management surfaces.

Discovery: official MCP SDK Tool schemas use draft-07. The validator supports draft-07 and 2020-12 while rejecting unknown dialects. The adapter reuses a client per endpoint/credential tuple and disconnects it on deletion.

Decision: ADR-011 defines MCP transport, current-schema, and AES-GCM secret boundaries.

## Progress Update — 2026-07-11

- [x] Added domain-owned Skill and immutable SkillVersion models with tool/runtime policies.
- [x] Added JSON Schema publication validation, enable/disable versioning, and rollback-as-new-version.
- [x] Added PostgreSQL migration and atomic repository for stable Skill pointers and immutable versions.
- [x] Replaced the in-memory Agent Card capability list with enabled current PostgreSQL SkillVersions.
- [x] Made current enabled SkillVersion.output_schema authoritative for result validation.
- [x] Verified unit (23), real PostgreSQL/Redis integration (8), and A2A end-to-end (5) tests.
- [ ] Complete MCP Registry, encrypted credentials, discovery refresh, and invocation envelope.
- [ ] Complete LLM-driven Schema generation and missing-description correction loop.
- [ ] Complete Skill graph, selection/search, temporary Skill lifecycle, management APIs, and console.

Discovery: node-postgres encodes JavaScript arrays as PostgreSQL arrays by default. JSONB repository parameters are now explicitly serialized with JSON.stringify; the regression is covered by the real PostgreSQL integration test.

Decision: ADR-010 makes persistent current SkillVersion the single authority for publication and result schemas. Concurrent writer locking remains required before management write APIs are exposed.

阶段完成后记录实际交付、未完成项、技术债、性能数据和对后续阶段的影响。
