# EP-06 完整管理控制台与可观测性

## Purpose / Outcome

运营人员通过真实控制台管理 MCP/Skill/Prompt/Task/Workflow/Memory/Evaluation，并查看 DAG、Trace、回放和优化建议。

## Requirements Covered

FR-ADM-001, FR-ADM-002, FR-ADM-003, FR-ADM-004, FR-ADM-005, FR-ADM-006, FR-ADM-007, FR-ADM-008

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [x] complete management OpenAPI
- [x] React console navigation and real CRUD
- [x] workflow DAG editor and validation
- [x] live task/node/LLM/MCP trace
- [x] version diff and execution replay
- [x] metrics dashboards and warnings

## Progress

- [x] Read the requirement, architecture, OSS, status, and current management-boundary material; inventory the current routes and traceability gaps.
- [x] Complete exact-version OSS Intake and ADR-064 for the React/Vite console stack.
- [x] Build the first strict-TypeScript console increment and serve its production assets from the same management process.
- [x] Deliver real MCP lifecycle controls and PostgreSQL management-operation audit; expose current Skill enable/disable/version/warning/rollback controls.
- [x] Deliver a repository-owned Workflow DAG/DSL workbench, immutable revision/confirmation actions, and ordered instance-node replay.
- [x] Add Task-rooted deterministic navigation to Goal/Plan/Workflow/events/results/evaluation/model/MCP evidence using persisted identifiers only.
- [x] Add real Prompt version/effect controls, source-linked Memory lifecycle management, and filtered Evaluation/Skill-warning operations.
- [x] Complete the Skill Studio control surface for constrained authoring, definition edits, draft publication, simulation/correction, lifecycle, diff, warnings, and graph relations.
- [x] Add credential-safe Provider and fixed-stage route inventories plus real system-policy, evolution-trigger, and model-invocation operations to the console.
- [x] Add a filterable PostgreSQL Task inventory and optional two-second refresh of every Task-linked trace projection.
- [x] Complete validated Task-wait, Memory-retention, and Skill-evolution policy controls while keeping automatic cleanup domain-disabled.
- [x] Render real Evaluation KPIs, failure distribution, Skill-version stability, and ordered quality trends with raw evidence available for audit.
- [x] Complete FR-ADM-008 MCP usage, model effects, capability growth, and evidence-backed advisory optimization views.
- [x] Run `pnpm verify` and real-browser semantic navigation/render smoke; record real, simulated, and unverified evidence without closing the EP.
- [ ] Complete real CRUD, DAG editing, trace/replay, linked navigation, dashboards, and accessibility evidence.

- [ ] 读取材料并记录当前代码状态。
- [ ] 将具体文件、接口和步骤补充到本计划。
- [ ] 完成实现增量。
- [ ] 完成测试与验证。
- [ ] 更新 Traceability Matrix、PROJECT_STATUS、ADR 和 Outcomes。

## Discoveries and Surprises

- The backend already exposes broad real management operations, but route coverage substantially exceeds the current OpenAPI document and several resources are identifier lookups rather than filterable inventories.
- The OpenAPI was missing 24 newer operations. It now covers all 94 implemented `/api` method/path pairs, with a permanent route-drift gate in `pnpm verify`.
- MCP invocation audit did not satisfy administrator operation logging. ADR-065 adds a separate credential-safe immutable record that survives Server deletion; OpenAPI now covers 95 operations.
- The extended E2E scenario is implemented, but two full attempts and one isolated Compose-start retry hung before test output. Unit, contract, real PostgreSQL integration, and console build evidence pass; E2E remains explicitly unverified for this increment.
- The existing root ESLint ignore matched only the root `dist`; the console build exposed that nested generated assets must use `**/dist/**` to keep generated third-party bundles outside source linting.
- No console application existed at EP-06 start. The first production bundle is now independently buildable and contains no static operational records.
- Workflow node events were persisted but not readable through management operations. `WorkflowExecutionService.trace` now joins the immutable instance with ordered displayable events; the console stores only replay position and editor text.
- Model and MCP APIs previously supported stage-wide or Server-wide reads only. Task filters and Plan-to-latest-instance lookup now provide deterministic links without a second trace store.
- Prompt, Memory, and Evaluation application APIs were already authoritative; dedicated console panels now expose them without adding frontend persistence or static operational records.
- The Skill backend lifecycle was broad but fragmented across routes. `SkillStudio` composes those existing boundaries while preserving every validation/publication gate.
- Provider and stage-route writes existed without readable inventories. Credential-free PostgreSQL projections now close that gap without exposing encrypted headers or creating frontend state.
- A Task identifier lookup was insufficient for operations. The new bounded inventory makes traces discoverable; refresh re-queries authoritative projections and never mutates execution.
- The original SRS audit exposed that aggregate KPIs alone did not complete FR-ADM-008. ADR-063 now includes exact Task-linked MCP/model effects, observed capability growth, and advisory optimization suggestions.

执行期间持续追加，包含 SDK 实际行为、失败测试和与原假设不同之处。

## Decision Log

- ADR-064 accepts React/Vite only inside `apps/console`; the management API remains the sole operational authority.
- The console is mounted at `/console` by the existing management listener. Vite is development/build tooling, not another production process.
- The repository will implement the Workflow DAG UI itself instead of adding a second workflow or third-party console runtime.
- DAG edits always use the existing `WorkflowRevisionService.reviseAdmin` boundary and therefore supersede rather than mutate a Plan; validation remains read-only and replay never invokes LangGraph.
- ADR-066 makes Task the observability navigation root and prohibits timestamp/name inference or frontend-owned relationship state.
- ADR-018 remains authoritative for Provider ownership, encryption, fixed routing, and no fallback; the new read projections do not require another ADR.

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

- [ ] `UI e2e using real APIs`
- [x] `no static mock data in production build`
- [x] `accessibility smoke` (real browser render/navigation; backend unavailable)
- [ ] `trace and replay data consistency`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-06-console-observability/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

2026-07-13 acceptance audit: functional delivery is complete but the milestone remains open. `pnpm verify` and real-browser render/navigation smoke pass. Docker is unresponsive; PostgreSQL/Redis integration, real API browser E2E, full E2E, server smoke, and trace consistency are unverified. See `reports/EP-06-console-observability/acceptance-audit-2026-07-13.{md,json}`.

阶段完成后记录实际交付、未完成项、技术债、性能数据和对后续阶段的影响。
