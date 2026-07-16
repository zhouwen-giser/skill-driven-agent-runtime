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
| v1.0.4  | Simulation/replay MCP Header isolation | ADR-075; explicit domain execution context; runtime-owned reserved Headers; stable evolution identity | domain/application/LangGraph/MCP adapter/runtime/PostgreSQL vertical path | `0056_mcp_execution_mode` | unit+contract+real migration/audit+Evolution MCP E2E | `82a90ab` / `v1.0.4` | `fa4b050` / `v1.0.4-bug-fixed` | feature: 217 unit, 58 contract, 42 integration, 42 E2E; bug-fixed: 218 unit, 58 contract, 42 integration, 42 E2E, architecture/build passed | MCP Server must implement compatible non-live behavior; ID max 256 visible ASCII; SDAR supplies metadata, not device isolation | bug-fixed gate passed |
| v1.0.5  | nested Skill confirmation             | ADR-076; one conservative transitive evaluator; exact serialized child decisions | domain/application/LangGraph/Task/runtime/PostgreSQL vertical path | `0057_nested_skill_confirmation` | unit+real migration+real A2A/MCP E2E | `6decc5d` / `v1.0.5` | `8d82427` / `v1.0.5-bug-fixed` | feature: 229 unit, 58 contract, 43 integration, 43 E2E; bug-fixed full gate: 238 unit, 58 contract, 43 integration, 43 E2E, architecture/build/migrations/smoke passed | paused checkpoints remain process-local per V1 non-recovery rule | bug-fixed gate passed |
| v1.0.6  | atomic authoritative terminal outcome | ADR-077; one PostgreSQL authority transaction; isolated enhancements | domain/application/runtime/PostgreSQL vertical path | `0058_runtime_terminal_outcome` | unit+fault-injection integration+migration+real A2A E2E | `4df20a9` / `v1.0.6` | `967d555` / `v1.0.6-bug-fixed` | feature: 242 unit, 58 contract, 52 integration, 44 E2E; bug-fixed full gate: 243 unit, 58 contract, 53 integration, 44 E2E, 175-source architecture, build+migrations+smoke passed in 82,005 ms | Goal-wide cancellation retains its cascade transaction and creates per-Control outcomes | bug-fixed gate passed |
| v1.0.7  | top-level Skill input resolution      | ADR-078; exact versioned input evidence; metadata priority; Memory non-authority | domain/application/runtime/PostgreSQL/management/Console vertical path | `0059_skill_input_resolution`; `0060_task_skill_input_resolution_binding` | unit+contract+integration+migration+real A2A/MCP E2E | `9bf6ba3` / `v1.0.7` | this bug-fixed commit / `v1.0.7-bug-fixed` | feature: 249 unit, 58 contract, 55 integration, 46 E2E; bug-fixed: 251 unit, 58 contract, 56 integration, 46 E2E, 178-source architecture, OpenAPI, build+migrations passed | canonical metadata key `structured_input`; alias accepted | bug-fixed gate passed |
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

## v1.0.5 Feature Evidence

- ADR-076 makes `TransitiveSkillConfirmationEvaluator` the shared authority for initial Task plans, outer replans and dynamically planned child Workflows. Governing, direct and recursively reachable execution Skills must all opt in; missing/disabled Skills fail closed and alternatives never grant authority.
- `skill_call` persists the exact parent plan/instance/node, child plan, current Skill version and confirmation lifecycle. LangGraph pauses with a typed child checkpoint and Task projection uses standard A2A input-required.
- Real A2A/MCP E2E confirms the parent first, observes the child pause and zero MCP invocations, confirms the child, resumes the same parent node, then observes one successful child Tool invocation and a succeeded linkage.
- Unit coverage includes parent-true/child-false, parent-false/child-true, multi-level reachability, rejection, waiting cancellation and child version invalidation. Initial and replan code paths call the same evaluator.
- Migration 0057 preserves the final child-instance foreign key, supports pending linkage before instance creation, and passes rollback/reapply plus empty/0049 verification.

### v1.0.5 Bug-fixed Evidence

- Task confirmation, rejection and cancellation decisions use one per-Task single-process critical section. `TASK_PLAN_DECISION_NOT_AWAITING` rejects duplicate, stale and canceled-parent decisions before any plan mutation, while an explicit confirmation target prevents a duplicate child action from falling through to outer Workflow start.
- Child confirmation requires an exact parent plan/instance/node plus child plan/Skill/version checkpoint match. Current Skill and immutable plan status are checked before both confirmation and resume; superseded/invalid authority is recorded and the parent resumes only to generate a fresh child plan.
- Workflow pause waiting now returns on checkpoint identity change and the controller projects each new child checkpoint. Unified timeout expiration releases every canceled nested checkpoint and reports aggregate release failures without skipping later Tasks.
- Real A2A/MCP E2E cancels a child-waiting parent, observes rejected linkage and rejects a later confirmation with zero extra MCP calls. A separate v1-to-v2 drift flow observes an invalidated v1 linkage, a fresh visible v2 checkpoint, zero stale calls, then exactly one new MCP call after v2 confirmation.
- The full operator-managed `pnpm verify` passes 238 unit, 58 contract, 43 integration and 43 E2E tests, 174-source architecture enforcement, empty/0049 migrations, production builds and both smoke gates without Docker lifecycle operations.

## v1.0.6 Feature Evidence

- ADR-077 separates authoritative terminal state from non-authoritative learning. `PostgresRuntimeTerminalOutcomeRepository` locks Task, Goal and Control, validates exact identities/state, and commits Processed Result, Task output/phase, Goal, Control, terminal Round and Runtime Event in one transaction.
- Exact retry returns the same outcome; a conflicting retry and generic stale Task/Goal/Control writes fail without changing the committed terminal state. `#advanceOrFail` reads current authority and cannot invert a committed control to failed.
- Result preparation/model audit occurs before the transaction. Evolution Experience, evaluation/Result Memory, Task Quality, Temporary Skill and Skill Evolution run after commit in isolated warning boundaries.
- Real PostgreSQL triggers inject failures before Processed Result and after Task, Goal, Control and Runtime Event writes; all authoritative rows roll back. Separate tests prove achieved/unachievable/canceled outcomes, warning deduplication and waiting-stage cancellation.
- Real A2A E2E injects a post-commit Memory model failure and still observes completed output, achieved Goal/Control, terminal outcome linkage and the Processed Result. Feature gates pass 242 unit, 58 contract, 52 integration, 44 E2E, 175-source architecture, build and empty/0049 migrations without Docker lifecycle operations.

### v1.0.6 Bug-fixed Evidence

- Generic Task, Goal and WorkflowControl saves now stop at every terminal row rather than allowing same-status field replacement. Regression attempts to forge completed output, achieved Goal content and terminal Control round pointers all fail.
- The terminal repository validates Round-to-Control, current plan, achieved/unachievable decision and final Workflow instance Goal/plan identity before any write. Mismatched evidence leaves Result, Task, Goal, Control, Round and Event unchanged.
- Active-Control cancellation closes a waiting Task input inside `commitCanceled`. Goal-wide cancellation preserves its multi-Task cascade transaction while creating a canceled Runtime Terminal Outcome and terminal event for each active Control.
- Enhancement-warning persistence failure is itself non-authoritative: both warning failures are logged while committed Task/Goal/Control remain achieved.
- Complete operator-managed `pnpm verify` passes 243 unit, 58 contract, 53 integration and 44 E2E tests, 175-source architecture enforcement, empty/0049 migrations, production builds and both smoke gates in 82,005 ms. Infrastructure mode is operator-managed and no Docker command ran.

## v1.0.7 Feature Evidence

- ADR-078 makes `SkillInputResolutionRecord` the immutable authority for one Task, Goal version and selected formal Skill version. Migration 0059 persists the structured candidate, unresolved fields, cited sources, decision summary and resolved/input-required/failed status.
- The fixed `skill_input_resolution` stage uses normal Provider routing, Prompt versioning, structured response validation and Task-linked invocation audit. Management API and Console expose both stage configuration and Task resolution history.
- Evidence reaches the model in the required metadata, request-text, Goal Contract, same-context processed data, supplementary-input and long-term-Memory order. Explicit `structured_input` metadata is overlaid after the model decision; Memory is labeled non-authoritative evidence.
- Schema-valid structured input becomes the formal Workflow initial input and can bind directly into real MCP arguments. Missing or illegal required values create a durable v1.0.3 input request, and a same-Task follow-up creates a new immutable resolution before planning.
- Ordinary WorkflowControl replans retain their input snapshot. Goal Patch re-resolves against the patched Goal version, while child Skill input remains independently validated at the existing `skill_call` boundary.
- The feature gate passes format, lint, strict typecheck, 249 unit tests, 58 contract tests, 55 real PostgreSQL/Redis integration tests, 46 real A2A/Model/MCP E2E scenarios, 178-source architecture enforcement, management OpenAPI, production build and empty/historical-0049 migration paths. Infrastructure was operator-managed and no Docker command ran.

### v1.0.7 Bug-fixed Evidence

- AgentTask now binds the exact resolution used by its plan. Migration 0060 adds a composite foreign key over resolution ID, Task, Goal version, Skill ID and Skill version; another Task or changed authority cannot reuse the record.
- Confirmation-time execution loads that exact ID. A deliberately newer same-version record does not change the planned Workflow input, while Skill replacement and Goal Patch remove stale bindings.
- Metadata-supplied fields remove contradictory model unresolved markers after the priority overlay. JSON Schema errors without a field path produce a stable `$` unresolved marker instead of turning an input request into a failed resolution.
- Goal Patch runs patched-Goal Skill input resolution before committing invalidation. Input-required or failed model resolution writes no Patch and creates no dangling replacement-plan identity.
- Bug-fixed gates pass format, lint, strict typecheck, 251 unit, 58 contract, 56 real integration, 46 real E2E, 178-source architecture, management OpenAPI, production build and empty/historical-0049 migrations through 0060. No Docker command ran.
