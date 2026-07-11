# EP-03 Workflow 规划与 LangGraph Runtime

## Purpose / Outcome

给定 Goal 和 Skill，系统可生成、自动修正、校验、编译并执行 Workflow DSL，完成第一个真实 MCP 任务闭环。

## Requirements Covered

FR-LLM-001, FR-LLM-002, FR-LLM-003, FR-LLM-004, FR-LLM-005, FR-LLM-006, FR-LLM-007, FR-LLM-008, FR-WF-001, FR-WF-002, FR-WF-003, FR-WF-004, FR-WF-005, FR-WF-006, FR-WF-007, FR-WF-008, FR-WF-009, FR-WF-010

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [ ] ModelProvider and stage configuration
- [ ] Prompt version management
- [ ] Workflow JSON Schema and restricted expression engine
- [ ] validator and auto-fix loop
- [ ] LangGraph compiler for all node types
- [ ] immutable workflow instances and events

## Progress

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

- [ ] `positive/negative DSL corpus`
- [ ] `all node compiler tests`
- [ ] `no dynamic code security tests`
- [ ] `MCP workflow e2e`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-03-workflow-planner-runtime/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

## Workflow DSL Validator Progress Update - 2026-07-12

- [x] Define all ten required node kinds and restricted expression AST.
- [x] Publish a draft-2020-12 Workflow DSL JSON Schema.
- [x] Reject unknown nodes/properties, invalid references, unreachable nodes and invalid entry/exits.
- [x] Enforce loop bounds and condition branch edges.
- [x] Validate current MCP Tool arguments and enabled Skill inputs against authoritative Schemas.
- [x] Add negative security corpus and real catalog e2e.
- [ ] Add model correction, persistence, LangGraph compiler, and node execution.

Decision: ADR-020 separates validation from compilation/execution and forbids arbitrary source expressions.

## Prompt Lifecycle Progress Update - 2026-07-12

- [x] Add stage-scoped PostgreSQL Prompt and immutable PromptVersion authority.
- [x] Add create, publish, disable, rollback and effect management operations.
- [x] Prevent `auto_candidate` from publishing or changing the current version.
- [x] Require current enabled PromptVersion before structured model calls and audit the actual version.
- [x] Verify AC-15 candidate/publish behavior through same-process e2e.
- [ ] Generate candidates automatically from failure/evaluation evidence in EP-05.

Decision: ADR-019 defines immutable Prompt publication and runtime linkage.

## Model Runtime Progress Update - 2026-07-12

- [x] Add domain-owned Provider configuration, fixed stage route, and invocation audit records.
- [x] Encrypt Provider credentials and persist configuration/routes/audits in PostgreSQL.
- [x] Add OpenAI-compatible/local HTTP structured-generation and embedding Adapter.
- [x] Fail the configured stage on timeout/upstream/shape errors without fallback.
- [x] Sanitize raw response audit to exclude provider reasoning/private fields.
- [x] Verify local HTTP contract, PostgreSQL integration, and same-process success/failure e2e.
- [ ] Add Prompt version lifecycle and associate active PromptVersion with every invocation.
- [ ] Route all final decision stages and implement Workflow DSL planning.

Decision: ADR-018 fixes stage routing and audit/credential boundaries.

阶段完成后记录实际交付、未完成项、技术债、性能数据和对后续阶段的影响。
