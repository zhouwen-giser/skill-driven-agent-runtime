# EP-08 — SDAR v1.0.1–v1.0.13 Runtime Hardening

## Purpose / Outcome

Deliver the thirteen ordered Runtime Hardening versions defined by `docs/SDAR_v1.0.1-v1.0.13_Runtime_Hardening_Codex_Task_Package.md`. Each version must have one independently verified feature commit/tag and one independently verified bug-fixed commit/tag, pushed immediately to `release/v1.0-hardening`. The final observable outcome is a Skill-driven A2A Task Runtime with dynamic data binding, real nested Skills, resumable input, execution-mode isolation, transitive confirmation, atomic terminal outcomes, structured top-level Skill input, complete Goal contracts, graph-aware composition, terminal capability gaps, MCP execution semantics, production-safe Memory and notification-based A2A waiting.

This plan does not implement MCP Tasks, a v1.2 Experience Event Store, device locks, world-state authority, cross-task conflict arbitration, authentication or tenant isolation.

## Requirements Covered

| Version | Task-package scope                   | Baseline requirement families affected                  |
| ------- | ------------------------------------ | ------------------------------------------------------- |
| v1.0.1  | §4 Workflow dynamic data binding     | FR-WF, FR-MCP invocation validation, FR-SKL child input |
| v1.0.2  | §5 real `skill_call` child workflows | FR-SKL-008/010/011, FR-WF execution                     |
| v1.0.3  | §6 A2A `input-required` continuation | FR-A2A follow-up, FR-GOAL-006/007, FR-EXE lifecycle     |
| v1.0.4  | §7 simulation/replay MCP headers     | FR-MCP audit, FR-EVO simulation, replay isolation       |
| v1.0.5  | §8 nested Skill confirmation         | FR-EXE-002, Skill runtime policy                        |
| v1.0.6  | §9 atomic terminal consistency       | FR-A2A result, FR-GOAL terminal state, FR-RST, NFR-REL  |
| v1.0.7  | §10 top-level Skill input resolution | FR-SKL input contract, FR-LLM fixed stages, A2A input   |
| v1.0.8  | §11 complete Goal execution contract | FR-GOAL, FR-SKL selection, FR-WF planning/evaluation    |
| v1.0.9  | §12 graph-aware Skill composition    | FR-SKL-009, composition planning/audit                  |
| v1.0.10 | §13 capability-gap terminal contract | FR-RST-006, A2A terminal projection                     |
| v1.0.11 | §14 MCP Tool execution semantics     | FR-MCP metadata/planning/audit, management Console      |
| v1.0.12 | §15 Memory production hardening      | FR-MEM, NFR-DATA, terminal enhancement boundary         |
| v1.0.13 | §16 notification-based A2A waiting   | FR-A2A sync/streaming, NFR-PERF, shutdown reliability   |

Exact requirement IDs, implementation files, tests, commands and result evidence will be appended to `docs/21_V1_0_HARDENING_TRACEABILITY.md` and reconciled into `docs/17_TRACEABILITY_MATRIX.md` at each bug-fixed gate.

## Context and Orientation

- `packages/domain` owns Goal, Skill, Task, Workflow, MCP, Memory and evaluation/evolution models.
- `packages/application` owns orchestration and protocol-neutral ports.
- `packages/langgraph-runtime` is the only Workflow executor and compiles validated immutable DSL.
- `packages/a2a-adapter` and `packages/mcp-adapter` isolate official SDK/wire models.
- `packages/persistence-postgres` is the system-of-record adapter; migrations are forward-only under `infra/postgres/migrations`.
- `packages/runtime-redis` owns ephemeral BullMQ/context serialization only.
- `apps/server` is the one-process composition root.
- `packages/management-api` and `apps/console` expose operational projections without owning runtime state.
- Accepted baseline: `bc4b44a7c8187d8d5e3f589f7bb9490a67cf0ad6`; `pnpm verify` passed in operator-managed infrastructure mode, recorded in `reports/v1.0-hardening/00-baseline.*`.

## Architecture and Interfaces

Authoritative ownership for planned new types/state:

| Type/state                                       | Owner                         | Persistence/external boundary                                                           |
| ------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------- |
| `WorkflowBoundValue` and runtime reference paths | Workflow domain               | JSON Schema/Ajv validates DSL; LangGraph resolves immutable snapshots                   |
| child plan/instance/Skill version linkage        | Workflow/Skill domain         | application service plus PostgreSQL repository                                          |
| input request/response/execution attempt         | Task domain                   | application continuation service, PostgreSQL and BullMQ attempt jobs                    |
| `RuntimeExecutionContext`                        | application execution context | MCP invocation audit stores mode/ID snapshot; adapters only map headers                 |
| nested confirmation linkage/status               | Workflow/Skill domain         | PostgreSQL plan/instance records; A2A/management project it                             |
| terminal outcome models                          | Task/Goal/Workflow domains    | application repository port; one PostgreSQL transaction implementation                  |
| `SkillInputResolutionRecord`                     | Skill/Task domain evidence    | fixed model stage and PostgreSQL audit                                                  |
| `GoalExecutionContract`                          | Goal domain                   | immutable plan/model-audit snapshots                                                    |
| Skill relations                                  | Skill Graph domain            | bounded application composition context and PostgreSQL snapshot                         |
| capability-gap phase/evidence                    | Task/Goal domain              | terminal PostgreSQL state and A2A adapter projection                                    |
| MCP Tool execution semantics                     | MCP domain                    | discovery/admin precedence, PostgreSQL and invocation snapshot                          |
| Memory durability/authority                      | Memory domain                 | model refinement validation and PostgreSQL admission policy                             |
| `TaskStateNotifier`                              | application port              | in-process adapter only; PostgreSQL remains authoritative and safety polling reloads it |

Invariants for every increment:

- no second workflow runtime or mutable running graph;
- no SDK, LangGraph, ORM or transport type crossing into domain/application contracts;
- no executable LLM-generated source or unrestricted expression language;
- no Tool call before required confirmation;
- Goal Patch invalidates prior plan/confirmation/workflow/results;
- PostgreSQL remains authoritative; Redis and notifications are ephemeral;
- same-context serialization and one-attempt failure posture remain intact;
- MCP remains authoritative for live device state;
- all new external data is structurally validated and all secrets remain credential-safe.

## Progress

- [x] 2026-07-15 12:50 Baseline-only repair committed as `bc4b44a`; immutable Compose pins restored, `.env` recreated locally, operator-managed infrastructure mode added, and clean `pnpm verify` passed.
- [x] 2026-07-15 13:17 v1.0.1 feature commit `34c48a8` and annotated `v1.0.1` tag pushed after 196 unit, 57 contract and 41 Workflow E2E tests passed.
- [x] 2026-07-15 13:28 v1.0.1 bug-fixed commit `6417a6f` and annotated `v1.0.1-bug-fixed` tag pushed after the complete focused gate passed.
- [x] 2026-07-15 13:44 v1.0.2 feature commit `0e3122c` and annotated `v1.0.2` tag pushed after 204 unit, 57 contract, 36 integration and 41 E2E tests passed.
- [x] 2026-07-15 13:54 v1.0.2 bug-fixed commit `4ca15f0` and annotated `v1.0.2-bug-fixed` tag pushed after 206 unit, 57 contract, 37 integration, 41 E2E, build and migration paths passed.
- [x] 2026-07-15 16:01 v1.0.3 feature commit `c25e92b` and annotated `v1.0.3` tag published after 211 unit, 57 contract, 40 integration, 42 E2E, architecture and migration paths passed.
- [x] 2026-07-15 17:02 v1.0.3 bug-fixed commit `bb8c90a` and annotated `v1.0.3-bug-fixed` tag published after the complete operator-managed gate passed.
- [x] 2026-07-15 18:55 v1.0.4 feature commit `82a90ab` and annotated `v1.0.4` tag published after the complete feature gate passed.
- [x] 2026-07-15 19:07 v1.0.4 bug-fixed commit `fa4b050` and annotated `v1.0.4-bug-fixed` tag published after the final 218 unit, 58 contract, 42 integration and 42 E2E gates passed.
- [x] 2026-07-16 10:28 v1.0.5 feature commit `6decc5d` and annotated `v1.0.5` tag published after ADR-076, migration 0057, 229 unit, 58 contract, 43 integration, 43 E2E, architecture, build and migration paths passed.
- [x] 2026-07-16 11:12 v1.0.5 bug-fixed commit `8d82427` and annotated `v1.0.5-bug-fixed` published after 238 unit, 58 contract, 43 integration, 43 E2E and the complete operator-managed gate passed.
- [x] 2026-07-16 12:05 v1.0.6 feature commit `4df20a9` and annotated `v1.0.6` published after 242 unit, 58 contract, 52 integration, 44 E2E, 175-source architecture, build and migrations passed.
- [x] 2026-07-16 12:26 v1.0.6 bug-fixed commit `967d555` and annotated `v1.0.6-bug-fixed` published after the complete operator-managed `pnpm verify` passed in 82,005 ms.
- [x] 2026-07-16 v1.0.7 feature commit `9bf6ba3` and annotated `v1.0.7` published after format/lint/typecheck, 249 unit, 58 contract, 55 integration, 46 E2E, 178-source architecture, OpenAPI, build and empty/0049 migrations passed.
- [x] 2026-07-16 v1.0.7 bug-fixed commit `88d1d01` and annotated `v1.0.7-bug-fixed` published after exact plan-to-resolution authority, conflict/root-error normalization and pre-commit Goal Patch input resolution passed 251 unit, 58 contract, 56 integration, 46 E2E, architecture/OpenAPI/build/migrations.
- [x] 2026-07-16 v1.0.8 feature commit `f6501a9` and annotated `v1.0.8` published after ADR-079, migration 0061 and complete Goal Contract propagation passed 259 unit, 59 contract, 57 integration, 46 E2E, architecture/OpenAPI/build/migrations.
- [x] 2026-07-16 v1.0.8 bug-fixed commit `be4a50f` and annotated `v1.0.8-bug-fixed` published after runtime snapshots, registered active-Goal authority and exact Goal Patch source content passed 262 unit, 59 contract, 57 integration, 46 E2E, architecture/OpenAPI/build/migrations.
- [ ] 2026-07-16 v1.0.9 feature implements ADR-080 and migration 0062, bounded graph-aware initial composition and durable `skill_call` authority. Feature gate passes 270 unit, 59 contract, 58 integration, 46 E2E, architecture/OpenAPI/build/migrations; publication remains.
- [ ] Complete v1.0.9 bug-fixed audit and full `pnpm verify` before v1.0.10.
- [ ] Complete v1.0.10–v1.0.12 in order; run full gate at v1.0.12-bug-fixed.
- [ ] Complete v1.0.13 feature and bug-fixed increments; run full gate and both demos.
- [ ] Run independent acceptance audit, generate final reports, verify 26 remote tags and create release-to-main PR.

## Discoveries and Surprises

- 2026-07-10: the first frozen install was temporarily blocked by pnpm minimum release age.
- 2026-07-15: the release-age issue cleared, but main had merged a tag-only Compose change inconsistent with the accepted immutable-image verifier and containing `redis:latest`.
- 2026-07-15: the operator started real PostgreSQL/Redis but requested no further Docker operations. The baseline repair introduced explicit operator-managed infrastructure reuse; real migrations/integration/E2E/smoke execute through loopback ports while Docker lifecycle commands remain disabled.
- 2026-07-15: E2E must run after the production Console build because the documented-client scenario verifies `/console/` assets.
- 2026-07-15: TypeScript 6 rejects a recursive type alias routed directly through `Readonly<Record<...>>`; an explicit `WorkflowBoundObject` interface preserves the task-package data model and strict typing.
- 2026-07-15: referenced values originate at validated protocol boundaries in production, but the runtime port remains `unknown`; bounding both template traversal and detached cloning prevents a malformed or cyclic adapter value from exhausting the JavaScript stack.
- 2026-07-15: ADR-042's independent child instance existed, but its child plan was a single deterministic LLM node. v1.0.2 therefore supersedes it with ADR-073 and the existing normal planner; the first real MCP E2E exposed that child Tool policy must be scoped to the child graph rather than the parent `skill_call` graph.
- 2026-07-15: the v1.0.2 bug-fixed integration run exposed a test-bootstrap violation of ADR-072: an existing 0053 ledger attempted to replay 0002–0053 when 0054 was absent. The bootstrap now applies only the next forward migration, matching production monotonic behavior.
- 2026-07-15: BullMQ 5 rejects `:` in custom Job IDs. v1.0.3 keeps the required Task/attempt composite identity using URI-encoded segments and a BullMQ-safe `~` separator; real Redis proves an old completed Job does not suppress continuation.
- 2026-07-15: v1.0.3 feature audit found that PostgreSQL answer/attempt persistence could commit before Task projection or Redis enqueue. The bug-fixed design makes the Task phase part of the same PostgreSQL transaction and treats queued attempts as durable dispatch records; startup/periodic reconciliation can replace terminal stale Redis Jobs, while running/failed attempts remain non-recoverable and never retry.
- 2026-07-15: the first required `pnpm verify` invocation was blocked before gates because the shell default pnpm store differed from the Snap store recorded in `node_modules/.modules.yaml`. Pointing pnpm at that existing store required no dependency changes and the full gate then passed; verification remained operator-managed with Docker lifecycle disabled.
- 2026-07-15: v1.0.4 Header isolation creates separate official MCP SDK clients for different final Header sets. The original loopback Mock MCP used one server transport and rejected the second initialization. It now routes official `mcp-session-id` values to independent server/transport pairs, proving concurrent live, simulation and replay sessions rather than hiding the isolation.
- 2026-07-15: v1.0.4 bug-fixed review treated model-provided simulation case IDs as untrusted Header data. Domain normalization now rejects whitespace/control/non-ASCII and values longer than 256 characters before transport admission; generated candidate/history identities remain within the bound.
- 2026-07-16: the first real v1.0.5 E2E exposed that the v1.0.2 child-instance foreign key cannot accept a relation before the child instance exists. Migration 0057 preserves that foreign key and instead allows a null child instance during confirmation; the deterministic `call_id` supplies the planned identity and the final upsert attaches the materialized instance.
- 2026-07-16: A2A confirmation returns after the authoritative Task transition while Workflow execution continues in the background. Nested confirmation E2E therefore polls the Task projection and proves the persisted checkpoint rather than assuming the immediate response means the child node has already paused.
- 2026-07-16: the v1.0.5 bug-fixed audit found that invalidating a child version could produce a second LangGraph pause while `WorkflowControllerService` still waited only for a terminal status. Pause waiting now detects checkpoint identity changes and reprojects every fresh child plan; real v1-to-v2 E2E proves the second checkpoint is visible and executes no stale MCP call.
- 2026-07-16: the former top-level formal Skill path passed a generic request envelope and never enforced the selected Skill version's `inputSchema`; only child `skill_call` input had an independent validation boundary. The first new real MCP E2E also exposed an unreachable result node in its deterministic mock plan, proving the test uses the real Workflow validator before Tool execution.
- 2026-07-16: v1.0.7 adversarial review found that “latest matching resolution” was weaker than the required fixed input version, model unresolved markers could contradict authoritative metadata, and post-invalidation Goal Patch resolution could leave partial state. Migration 0060 pins exact identity; field reconciliation and preflight ordering close the other two gaps.
- 2026-07-16: v1.0.8 propagation exposed same-ID/version drift at repair, WorkflowControl and Goal Patch boundaries; the bug-fixed audit additionally found that TypeScript readonly did not stop caller mutation during async work and that management Skill selection did not reconcile registered Goal authority. Runtime snapshots plus active/full-content checks now fail before embedding, model or Tool invocation.
- 2026-07-16: adding full Skill snapshots to initial planner input exposed two real-E2E assumptions: former standalone `skill_call` tests had no graph authorization, and a mock LLM stage detector matched workflow guidance embedded as data. The tests now create real compatible graph relations and distinguish planner evidence from executable model instructions; persisted plan audit proves the intended boundary.
- 2026-07-15: continuation binding paths use string path segments (`"0"`) like the public DSL; numeric array indices are rejected at validation rather than reaching runtime. Both real MCP E2E paths assert the supplied value, preventing state-only false positives.

## Decision Log

- 2026-07-15: keep immutable OCI digest pins and `linux/amd64`; do not weaken the supply-chain verifier to accept mutable tags.
- 2026-07-15: external infrastructure reuse is a verification/operations concern, not domain state. No ADR is required because default self-managed Compose behavior and all runtime authority boundaries are unchanged.
- 2026-07-15: use one ExecPlan for all thirteen versions because the task package mandates strict ordering and cross-version dependencies; each version still has separate reports, commits and tags.
- 2026-07-15: `WorkflowBoundValue` is owned by the Workflow domain and resolved only inside the sole LangGraph Runtime. Planning validates the restricted template shape, while current MCP/Skill business schemas are enforced after resolution at their existing application boundaries. This preserves ADR-001/004/042 and requires no new ADR.
- 2026-07-15: accept ADR-074. Task input requests/responses/attempts are Task-domain state in PostgreSQL; Redis only schedules attempt-identified work. Evaluation continuation always creates an unconfirmed immutable plan outside LangGraph and never replays the completed prior instance.
- 2026-07-16: accept ADR-078. A versioned Task/Goal/Skill resolution record owns formal top-level input evidence; `structured_input` metadata is canonical, Memory is non-authoritative, and only a schema-valid structured value enters the sole LangGraph runtime. Goal Patch creates a new resolution for the patched Goal version.
- 2026-07-16: accept ADR-079. The Goal domain owns one six-field execution snapshot; selection, planning, evaluation and their audit records consume it unchanged, while all authority boundaries compare complete content rather than trusting identity alone.
- 2026-07-16: accept ADR-080. The Skill Graph bounds candidate composition but never replaces the model decision. Existing `composition` represents the task package's composable semantic; initial traversal excludes `alternative`, snapshots exact current versions, and persists allowlist authority outside the immutable running graph.

## Implementation Steps

For each version, in strict numeric order:

1. Re-read the version section, relevant baseline requirements/ADRs and current implementation/tests.
2. Record any ambiguity in `docs/18_KNOWN_ASSUMPTIONS_AND_GAPS.md`; add an ADR only for a significant new design decision.
3. Add only forward migrations, starting at the actual next sequence after 0053; include rollback and empty/upgrade tests.
4. Implement a runnable vertical increment with domain-owned types, application ports/services, adapter/persistence wiring and public API/Console changes where required.
5. Add required positive, negative, failure-injection, cancellation/concurrency and schema tests.
6. Update package version to `1.0.x`, CHANGELOG, version reports and both traceability matrices.
7. Run the specified focused gate, commit `feat(v1.0.x): ...`, create/push annotated `v1.0.x` tag and push the branch.
8. Perform the task-package bug-fixed audit, fix discovered issues, add at least one boundary/regression evidence item, update reports, rerun gates, commit `fix(v1.0.x): ...` (or the permitted verification-only message), create/push annotated `v1.0.x-bug-fixed`, then proceed.

## Validation

Every version:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
```

Add version-specific integration/E2E/LangGraph/management/Console tests. Run full `pnpm verify` at v1.0.3-, v1.0.6-, v1.0.9-, v1.0.12- and v1.0.13-bug-fixed. At v1.0.13-bug-fixed also run:

```bash
pnpm demo:local
pnpm demo:acceptance
```

The local `.env` sets `SDAR_REUSE_EXISTING_INFRA=true`; these commands use the operator-managed real PostgreSQL/Redis and never start/stop containers. Reports must classify Docker daemon/config validation as deferred while classifying direct database/Redis tests as real.

Before each milestone is closed, inspect for skipped tests, weakened assertions, static placeholders, new `any`, dynamic code, credential leakage, unhandled promises, resource leaks, unbounded recursion/loops, stale-worker terminal mutation and unauthorized MCP state ownership.

## Idempotence and Recovery

- Never amend, rebase or force-push a published version commit/tag.
- If a feature tag exposes a non-blocking defect, record it and repair only in the following bug-fixed commit.
- If a gate fails before a tag, fix forward in the untagged working tree and rerun; do not publish a failing core increment.
- Migrations are additive and rerunnable through the monotonic ledger; never edit migrations 0001–0053.
- Migration tests create/drop only `sdar_verify_empty` and `sdar_verify_upgrade`; ordinary tests use repository cleanup and do not stop operator services.
- If remote push/tag protection blocks publication, preserve local commits/evidence and issue the task-package blocker report.

## Artifacts and Evidence

- Baseline: `reports/v1.0-hardening/00-baseline.md` and `.json`.
- Per version: `reports/v1.0-hardening/v1.0.x/{implementation,test-results,changed-files,known-issues,bug-fixed,bug-fixed-test-results}.md`.
- Continuous hardening matrix: `docs/21_V1_0_HARDENING_TRACEABILITY.md`.
- Baseline matrix: `docs/17_TRACEABILITY_MATRIX.md`.
- Unified gate: `reports/verification/summary.md` and `.json`.
- Final: `reports/v1.0-hardening/{FINAL_REPORT,FINAL_TRACEABILITY,FINAL_TEST_RESULTS}.md`.

## Outcomes and Retrospective

In progress. This section will record delivered behavior, exact feature/bug-fixed SHAs and tags, migration/API/DSL deltas, evidence classification, remaining limitations and v1.1/v1.2 prerequisites after v1.0.13-bug-fixed.
