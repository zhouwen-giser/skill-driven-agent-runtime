# EP-03 Workflow 规划与 LangGraph Runtime

## Purpose / Outcome

给定 Goal 和 Skill，系统可生成、自动修正、校验、编译并执行 Workflow DSL，完成第一个真实 MCP 任务闭环。

## Requirements Covered

FR-LLM-001, FR-LLM-002, FR-LLM-003, FR-LLM-004, FR-LLM-005, FR-LLM-006, FR-LLM-007, FR-LLM-008, FR-WF-001, FR-WF-002, FR-WF-003, FR-WF-004, FR-WF-005, FR-WF-006, FR-WF-007, FR-WF-008, FR-WF-009, FR-WF-010

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [x] ModelProvider and stage configuration
- [x] Prompt version management
- [x] Workflow JSON Schema and restricted expression engine
- [x] validator and auto-fix loop
- [x] LangGraph compiler for all node types
- [x] immutable workflow instances and events

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

- [x] `positive/negative DSL corpus`
- [x] `all node compiler tests`
- [x] `no dynamic code security tests`
- [x] `MCP workflow e2e`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-03-workflow-planner-runtime/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

## Workflow Planning Correction Progress Update - 2026-07-12

- [x] Send the authoritative Workflow JSON Schema to the fixed planning model stage.
- [x] Persist every raw candidate and structured validation error.
- [x] Feed errors back to the same model within a bounded correction loop.
- [x] Persist failed plans after exhaustion and immutable validated definitions on success.
- [x] Enforce exact Workflow identity and Goal version.
- [x] Keep initial corrected plans awaiting confirmation and require confirmed repository evidence for repair inheritance.
- [x] Compile and execute confirmed repaired plans without a redundant second confirmation.

Decision: ADR-021 separates initial confirmation from safe correction inheritance.

## Workflow DSL Validator Progress Update - 2026-07-12

- [x] Define all ten required node kinds and restricted expression AST.
- [x] Publish a draft-2020-12 Workflow DSL JSON Schema.
- [x] Reject unknown nodes/properties, invalid references, unreachable nodes and invalid entry/exits.
- [x] Enforce loop bounds and condition branch edges.
- [x] Validate current MCP Tool arguments and enabled Skill inputs against authoritative Schemas.
- [x] Add negative security corpus and real catalog e2e.
- [x] Add model correction, persistence, LangGraph compiler, and node execution.

Decision: ADR-020 separates validation from compilation/execution and forbids arbitrary source expressions.

## LangGraph Compiler and Immutable Execution Progress Update - 2026-07-12

- [x] Revalidate current Tool/Skill catalogs and reject unconfirmed plans before compilation.
- [x] Interpret only the restricted expression AST with strict references and operand types.
- [x] Compile all ten node types into the sole LangGraph.js StateGraph runtime.
- [x] Freeze each definition, preserve fixed identity/version, and persist instance transitions/node events.
- [x] Verify condition routing, bounded loops, parallel convergence and all three error strategies; implement the production subworkflow recursion/depth guard.
- [x] Execute a real local MCP plan only after confirmation.
- [x] Execute a corrected version inherited from a confirmed source without a second confirmation.
- [ ] Connect human_confirmation to persisted EP-04 pause/resume instead of the current explicit runtime stop.
- [ ] Add the outer replan controller with max-replan enforcement and natural-language/admin editing.

## Workflow Budget Enforcement Progress Update - 2026-07-12

- [x] Define and validate domain-owned limit, usage and termination records.
- [x] Resolve missing Skill fields from system defaults and conservatively merge composed Skills.
- [x] Pin current enabled Skill versions and the resolved limits before execution.
- [x] Atomically enforce LLM/MCP counts and configured accounted cost before parallel external calls.
- [x] Enforce duration before/after nodes and propagate the remaining deadline as AbortSignal.
- [x] Persist limits, usage, Skill versions and termination reason in PostgreSQL.
- [x] Prove a real enabled Skill with zero MCP budget produces zero real MCP invocations.
- [x] Enforce `maxReplans` in the FR-WF-008 outer controller.

## Outer Goal Evaluation and Replanning Progress Update - 2026-07-12

- [x] Persist the control state and ordered plan/instance/evaluation rounds in PostgreSQL.
- [x] Validate fixed-stage Goal evaluation as strict displayable structured data.
- [x] Evaluate successful and failed terminal instances from their latest persisted state.
- [x] Generate the next immutable WorkflowDefinition version only outside LangGraph.
- [x] Pause ordinary replans for repository-backed confirmation and continue the same control afterward.
- [x] Auto-confirm only when every named current enabled Skill opts in; empty Skill sets never auto-confirm.
- [x] Enforce `maxReplans`, persist exhaustion, retain the final instance and end the Goal fail-closed.
- [x] Verify a two-round real model + real MCP loop reaches an achieved Goal with replayable evidence.

Decision: ADR-024 defines the outer-loop, confirmation and replan-exhaustion semantics.

## Immutable Plan Revision Progress Update - 2026-07-12

- [x] Persist source-plan lineage and explicit natural/admin/replan revision kinds.
- [x] Atomically supersede the active source and insert the immutable revision.
- [x] Force every user/admin edit back to `awaiting_confirmation`.
- [x] Route A2A natural-language edits through the fixed schema-bound planner and rebind the real Task plan.
- [x] Validate administrator canonical DSL/DAG serialization through the same strict validator.
- [x] Verify invalid-edit isolation, transaction rollback, HTTP contracts, A2A revision, and confirmed administrator LangGraph execution.
- [ ] Build the browser visual DAG editor in EP-06 against the verified server contract.

Decision: ADR-025 defines immutable revision, source-confirmation invalidation, and Task binding semantics.

Decision: ADR-023 defines conservative Skill override resolution, fail-closed exhaustion and configured cost accounting.

Decision: ADR-022 confines LangGraph types to the runtime adapter and defines immutable execution/audit semantics.

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
