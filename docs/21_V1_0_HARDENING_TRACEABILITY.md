# SDAR v1.0.1–v1.0.13 Runtime Hardening Traceability

Authoritative task package: `docs/SDAR_v1.0.1-v1.0.13_Runtime_Hardening_Codex_Task_Package.md`  
Active ExecPlan: `execplans/EP-08-runtime-hardening-v1.0.1-v1.0.13.md`  
Accepted baseline: `bc4b44a7c8187d8d5e3f589f7bb9490a67cf0ad6` (`pnpm verify` passed, operator-managed real PostgreSQL/Redis)

The table is updated only from reproducible implementation/test evidence. `pending` never means implicitly satisfied by older V1 behavior.

| Version | Problem / target                      | Design decision | Implementation | Migration | Tests   | Feature commit / tag | Bug-fixed commit / tag | Gate                        | Known limitations                       | Status  |
| ------- | ------------------------------------- | --------------- | -------------- | --------- | ------- | -------------------- | ---------------------- | --------------------------- | --------------------------------------- | ------- |
| v1.0.1  | Workflow runtime data binding         | domain-owned bound value; LangGraph-only resolver; boundary revalidation | `packages/domain/src/workflow.ts`; `packages/langgraph-runtime/src/bound-value-resolver.ts`; compiler/application/runtime wiring | none | unit+contract+Workflow E2E | `34c48a8` / `v1.0.1` | `6417a6f` / `v1.0.1-bug-fixed` | feature: 196 unit, 57 contract, 41 E2E; bug-fixed: format, lint, typecheck, architecture, 197 unit, 57 contract, 41 E2E passed | finite JSON; maximum depth 64; restricted path segments | bug-fixed gate passed |
| v1.0.2  | real `skill_call` child workflows     | ADR-073; normal planner/validator/executor; child-scoped Tool policy; bounded ancestry/output | application/runtime plus append-only relation repository | `0054_skill_call_history` in bug-fixed | unit+integration+migration+real MCP E2E | `0e3122c` / `v1.0.2` | `4ca15f0` / `v1.0.2-bug-fixed` | feature: 204 unit, 57 contract, 36 integration, 41 E2E; bug-fixed: format/lint/typecheck/architecture, 206 unit, 57 contract, 37 integration, 41 E2E, build+migrations passed | nested confirmation finalized in v1.0.5; output max 64,000 chars | bug-fixed gate passed |
| v1.0.3  | A2A input-required continuation       | ADR-074; PostgreSQL request/response/attempt authority; attempt Job; round-bound fresh plan; queued-attempt reconciliation | Task/application/controller/A2A/runtime/Redis/PostgreSQL vertical path | `0055_task_input_continuation` | unit+contract+restart/Redis integration+two real MCP E2E+full verify | `c25e92b` / `v1.0.3` | `bb8c90a` / `v1.0.3-bug-fixed` | feature: 211 unit, 57 contract, 40 integration, 42 E2E; bug-fixed full gate: 271 unit+contract, 41 integration, 42 E2E, migrations, builds and smoke passed | only PostgreSQL `queued` attempts are redispatched; running/failed attempts never retry; input max 64,000 chars | bug-fixed gate passed |
| v1.0.4  | Simulation/replay MCP Header isolation | ADR-075; explicit domain execution context; runtime-owned reserved Headers; stable evolution identity | domain/application/LangGraph/MCP adapter/runtime/PostgreSQL vertical path | `0056_mcp_execution_mode` | unit+contract+real migration/audit+Evolution MCP E2E | this feature commit / `v1.0.4` | pending | feature: format/lint/typecheck/architecture, 217 unit, 58 contract, 42 integration, 42 E2E, build and migrations passed | MCP Server must implement compatible non-live behavior; SDAR supplies metadata, not device isolation | feature gate passed |
| v1.0.4  | simulation/replay MCP headers         | pending         | pending        | pending   | pending | pending              | pending                | pending                     | MCP Server enforcement remains external | pending |
| v1.0.5  | nested Skill confirmation             | pending         | pending        | pending   | pending | pending              | pending                | pending                     | pending                                 | pending |
| v1.0.6  | atomic authoritative terminal outcome | pending         | pending        | pending   | pending | pending              | pending                | full `pnpm verify` required | pending                                 | pending |
| v1.0.7  | top-level Skill input resolution      | pending         | pending        | pending   | pending | pending              | pending                | pending                     | pending                                 | pending |
| v1.0.8  | complete Goal execution contract      | pending         | pending        | pending   | pending | pending              | pending                | pending                     | pending                                 | pending |
| v1.0.9  | Skill Graph composition planning      | pending         | pending        | pending   | pending | pending              | pending                | full `pnpm verify` required | pending                                 | pending |
| v1.0.10 | terminal capability-gap contract      | pending         | pending        | pending   | pending | pending              | pending                | pending                     | original Task never resumes             | pending |
| v1.0.11 | MCP Tool execution semantics          | pending         | pending        | pending   | pending | pending              | pending                | pending                     | MCP Tasks not implemented               | pending |
| v1.0.12 | Memory durability/embedding hardening | pending         | pending        | pending   | pending | pending              | pending                | full `pnpm verify` required | pending                                 | pending |
| v1.0.13 | A2A state notification wait           | pending         | pending        | pending   | pending | pending              | pending                | `pnpm verify` + both demos  | pending                                 | pending |

## Baseline Evidence

| Command                          | Result                                                             | Evidence classification                                 |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | passed; 348 entries satisfy supply-chain policy                    | real local install                                      |
| `pnpm verify:bootstrap`          | passed; 54 files / 242 unit+contract tests plus build/static gates | real local execution; Compose daemon/config deferred    |
| `pnpm verify:migrations`         | passed; empty and historical 0049 upgrade paths                    | real PostgreSQL                                         |
| `pnpm test:integration`          | passed; 2 files / 36 tests                                         | real PostgreSQL/Redis                                   |
| `pnpm test:e2e`                  | passed; 1 file / 41 tests                                          | real PostgreSQL/Redis with deterministic Mock Model/MCP |
| `pnpm smoke:infra`               | passed; pgvector 0.8.5 and Redis read/write                        | real PostgreSQL/Redis                                   |
| `pnpm smoke:server`              | passed                                                             | real Server/Console bundle over loopback                |
| `pnpm verify`                    | passed in 74065 ms at `bc4b44a`                                    | aggregate of the above                                  |

## v1.0.1 Feature Evidence

- Design: recursive `WorkflowBoundValue` templates use only exact `{ "op": "ref", "path": [...] }` references. The resolver accepts the six documented state roots, makes detached frozen snapshots, and never evaluates source or JSONPath.
- Runtime: LLM context, MCP arguments, Skill input and Subworkflow input resolve immediately before their node call. MCP and Skill values then pass the current registered schema boundary.
- Tests: `bound-value-resolver.unit.test.ts`, `workflow-compiler.unit.test.ts`, `workflow-validator.unit.test.ts`, `skill-call-workflow.unit.test.ts`, `workflow-dsl-schema.contract.test.ts`, and the real MCP execution scenario in `task-service-endpoint.e2e.test.ts`.
- Migration: none; Workflow definitions already persist as JSON and this increment changes validated DSL/runtime semantics without new authoritative columns.

## v1.0.2 Feature Evidence

- Design: ADR-073 supersedes the LLM-only child template from ADR-042. The child uses the existing planner, validator, Workflow execution service and LangGraph runtime; no second executor exists.
- Runtime: current Skill version input is validated, its complete planning fields and current MCP metadata enter planning, the real child plan receives v1.0.1 dynamic input, output is schema-validated, and failure/cancellation propagates.
- Safety: parent/child Tool policies are scoped to their governing graph; async ancestry rejects cycles and depth beyond eight.
- Evidence: application tests cover input/output rejection, child failed/canceled outcomes, plan persistence failure, signal propagation, policy scoping, cycle and depth. Real E2E proves current v2 planning, dynamic input, remote MCP invocation audit, independent child plan/instance linkage and actual version.
- Known dependency: Nested confirmation policy will be finalized in v1.0.5.

### v1.0.2 Bug-fixed Evidence

- Migration 0054 changes the relation key from parent/node to independent `call_id`, retains deterministic latest lookup and documents rollback loss of older repeated relations.
- Child output admission rejects non-finite/non-JSON, cyclic and larger-than-64,000-character values before parent-state return.
- Real PostgreSQL tests retain two children from one parent node and verify latest lookup; migration rollback/reapply and empty/0049 upgrade paths pass.
