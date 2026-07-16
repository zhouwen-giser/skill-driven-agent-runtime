# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog, and planned commits use Conventional Commits.

## [Unreleased]

## [1.0.10] - 2026-07-16

### Changed

- `capability_gap` is now a terminal Task and WorkflowControl outcome; the original Task has no resume path and keeps `errorCode=CAPABILITY_GAP` with its structured missing-capability evidence.
- A2A now projects capability gaps as standard `TASK_STATE_FAILED` with `nextAction=register-capability-and-submit-new-task`, never as `input-required`.
- A new Task in the same Context uses the normal serialized queue and may continue the still-active Goal; Tool registration or refresh never scans, resumes, enqueues or executes the old Task.
- PostgreSQL terminal mutation guards, Goal/runtime cancellation and implicit-feedback terminal lookup now treat capability gap consistently.

### Verification

- Terminal transition/follow-up/cancellation, structured A2A projection, stale Worker persistence, active-Goal successor submission and wait-timeout exclusion regressions pass.
- The operator-managed feature gate passed 274 unit, 60 contract, 58 integration and 46 E2E tests, 181-source architecture enforcement, 104-operation OpenAPI verification, production build and empty/historical-0049 migration paths through 0062.

## [1.0.9] - 2026-07-16

### Added

- Domain-owned immutable `SkillCompositionContext` snapshots containing the selected exact Skill version, only graph-reachable related versions, accepted relations, allowed child IDs and a decision summary.
- Bounded initial composition traversal for `parent_child`, `depends_on`, `input_output_match`, `composition` and `capability_coverage`; `alternative` remains excluded from initial planning.
- Migration 0062 for composition and explicit capability-gap authority on every Workflow plan and planning attempt.
- Optional management `compositionRoot` input for authoritative standalone graph-aware planning.

### Changed

- Initial Task, child Skill, continuation, revision, Goal Patch and outer replan paths now establish, inherit or recompute exact composition authority before model planning.
- The Workflow validator, execution service and child Skill service reject `skill_call` targets outside the persisted allowed set unless an internal explicit capability-gap flow admits the ID.
- Transitive confirmation covers every initial-execution relation except `alternative`; the graph supplies bounded evidence while the LLM still decides which admitted Skill to call.

### Verification

- Required regressions cover dependency admission, composable planning, unrelated/alternative rejection, schema mismatch, multi-level composition, cycles, deep snapshot immutability, persistence audit and execution-time authorization.
- The operator-managed feature gate passed 270 unit, 59 contract, 58 integration and 46 E2E tests, 181-source architecture enforcement, 104-operation OpenAPI verification, production build and empty/historical-0049 migration paths through 0062.

## [1.0.9-bug-fixed] - 2026-07-16

### Fixed

- Inherited and persistence-loaded composition contexts now revalidate unique Skill/relation/allowlist IDs, selected-root reachability, cycles, depth and size before any model or execution authority is accepted.
- Skill/relation snapshot JSON is bounded to 64 levels, and accepted relation evidence is capped at 128 entries in addition to the existing 8-level/32-Skill traversal limits.
- Initial composition uses indexed source/type/limit PostgreSQL reads and requests only remaining capacity instead of loading and sorting the full Skill Graph.
- Corrupted PostgreSQL context, disconnected injected children, duplicate allowlist IDs, pathological JSON and relation floods fail closed with stable errors.

### Verification

- The required operator-managed `pnpm verify` passed in 87,491 ms with 273 unit, 59 contract, 58 integration and 46 E2E tests, 181-source architecture, A2A baseline, 104-operation OpenAPI, 18 acceptance scenarios, licenses/SBOM, production builds, empty/0049→0062 migrations and both smoke gates.

## [1.0.8] - 2026-07-16

### Added

- Domain-owned immutable `GoalExecutionContract` snapshots containing Goal identity, title, description, constraints and success criteria.
- Migration 0061 for exact Goal Contract evidence on Skill selection/replacement and Workflow plan/attempt records.
- Enriched Skill candidate snapshots with schema summaries, Tool and runtime policies, Workflow guidance, quality metrics, active MCP dependency warnings and semantic scores.

### Changed

- Skill retrieval, model selection, replacement, Temporary Skill resolution, top-level/replan/child Workflow planning and Goal Evaluation now receive the same complete Goal Contract.
- Planning, repair confirmation inheritance, Workflow execution and outer control reject stale or content-mismatched contracts before model or Tool execution.
- Registered management planning compares the complete submitted snapshot with the authoritative Goal; standalone planning still requires a complete explicit contract.
- Goal Patch plans only with the proposed new Goal version, while all model invocation and plan-attempt evidence retains the exact snapshot used.

### Verification

- Constraint-sensitive Skill selection, success-criteria-sensitive Workflow generation, safety constraint visibility, replacement retention, patched Goal versions, stale-plan rejection and exact model-audit snapshots are covered across unit, contract, real PostgreSQL migration/integration and real A2A/Model/MCP E2E tests.
- The operator-managed feature gate passed 259 unit, 59 contract, 57 integration and 46 E2E tests, 178-source architecture enforcement, 104-operation OpenAPI verification, production build and empty/historical-0049 migration paths through 0061.

## [1.0.8-bug-fixed] - 2026-07-16

### Fixed

- Every asynchronous selection/planning boundary now copies and freezes the complete Goal Contract, preventing caller mutation after invocation from changing retrieval, model input or persisted audit.
- Management Skill selection and Workflow planning reject content-drifted or terminal registered Goals before any embedding/model call; unregistered standalone contracts remain an explicit low-level capability.
- Goal Patch rejects a source plan whose complete contract differs from the active Goal even when ID/version match, before patch-model invocation or invalidation.
- Admin revision uses the same runtime-enforced snapshot as model-planned revisions and Temporary Skill resolution.

### Verification

- Mutation-during-Promise regressions cover formal selection, Workflow planning and Temporary Skill resolution; source-plan drift is rejected before the Goal Patch model.
- Real management E2E proves valid registered selection, same-version drift rejection, terminal Goal selection/planning rejection and unchanged model invocation counts.
- The operator-managed bug-fixed gate passed 262 unit, 59 contract, 57 integration, 46 E2E, 179-source architecture, 104-operation OpenAPI, production build and empty/historical-0049 migration paths through 0061.

## [1.0.7] - 2026-07-16

### Added

- Domain-owned immutable `SkillInputResolutionRecord` evidence tied to exact Task, Goal version and enabled Skill version.
- Fixed `skill_input_resolution` model stage with structured response validation, Provider/Prompt routing, invocation audit and Console configuration.
- Migration 0059 for resolution history and the durable `skill_input_resolution` Task input-request source.
- Management API and Console evidence links for Task-scoped and individual input-resolution records.

### Changed

- Formal top-level Skills now resolve and validate their `inputSchema` after selection and before planning.
- Missing or invalid required input uses the v1.0.3 same-Task continuation path; supplementary answers create a new immutable resolution.
- The schema-valid structured value becomes Workflow initial input, while raw request text remains auxiliary Task evidence.
- Ordinary replans retain the fixed structured value, and Goal Patch re-resolves against the new Goal version.

### Verification

- Unit, management contract, real PostgreSQL migration/history and real A2A/MCP E2E cover metadata, text, missing input, continuation, illegal types, source conflict, Goal Patch, child validation and structured MCP binding.

## [1.0.7-bug-fixed] - 2026-07-16

### Fixed

- Each formal Task plan now binds the exact immutable Skill input resolution used during planning; execution no longer selects a potentially newer record.
- Migration 0060 enforces the Task/Goal version/Skill version/resolution identity as one composite PostgreSQL foreign key and clears stale bindings on Skill replacement or Goal Patch.
- Authoritative metadata removes stale model-reported unresolved markers for fields it actually supplies, while root-level schema failures retain a stable `$` input request marker.
- Goal Patch preflights patched-Goal Skill input before committing invalidation, so unresolved input or model failure cannot leave an applied Patch without its promised replacement plan.

### Verification

- Regression evidence proves plan-bound input survives a newer resolution, cross-Task evidence is rejected by PostgreSQL, replacement clears stale authority, metadata wins stale model output, root errors remain resumable, and unresolved Goal Patch writes no Patch/plan.
- The operator-managed bug-fixed gate passed 251 unit, 58 contract, 56 integration, 46 E2E, 178-source architecture, OpenAPI, production build and empty/historical-0049 migration paths through 0060.

## [1.0.6] - 2026-07-16

### Added

- Domain-owned `RuntimeTerminalOutcome` records and an atomic PostgreSQL repository for achieved, unachievable and canceled runtime outcomes.
- Migration 0058 linking each WorkflowControl and terminal Round to one durable outcome with queryable post-commit enhancement warnings.
- Fault-injection coverage before Processed Result persistence and after Task, Goal, Control and Runtime Event writes.

### Changed

- Processed Result preparation now completes before the transaction, while Result Memory, evaluation Memory, Task Quality, Evolution Experience, Temporary Skill completion and Skill Evolution run independently after commit.
- Achieved/unachievable controller paths commit Processed Result, Task output/phase, Goal, Control, terminal Round and Runtime Event in one transaction.
- Cancellation of a Task with an active WorkflowControl uses the same atomic terminal boundary; early cancellation without a Control remains Task-local.
- Generic Task, Goal and WorkflowControl saves reject stale attempts to overwrite terminal state, and controller failure handling never reverses a committed terminal outcome.

### Verification

- Unit, real PostgreSQL fault-injection, migration and real A2A evidence prove full rollback, exact idempotent retry, stale-Worker rejection, canceled waiting Tasks, and completed A2A output despite a post-commit Memory failure.

## [1.0.6-bug-fixed] - 2026-07-16

### Fixed

- Generic Task, Goal and WorkflowControl repositories now reject every write once a terminal row exists, including same-status writes that previously could replace terminal output or pointers.
- Terminal Rounds must match the locked Control, current plan and evaluation decision; final Workflow instances must belong to the same Goal and valid current/prior Control evidence.
- Active-control cancellation closes waiting Task input inside the terminal transaction, so a cleanup failure cannot turn an already committed A2A cancellation into an error.
- Goal-wide cancellation creates canceled Runtime Terminal Outcomes for all active Controls, closes waiting input and emits terminal events inside its existing multi-Task cascade transaction.
- Completion/cancellation races return the already committed terminal Task instead of attempting a second terminal projection.

### Verification

- The complete operator-managed `pnpm verify` passed in 82,005 ms: 243 unit, 58 contract, 53 integration, 44 E2E, 175-source architecture enforcement, migration paths, production builds and both smoke gates.

## [1.0.5] - 2026-07-16

### Added

- One transitive Skill confirmation evaluator for initial Task planning, outer replanning and runtime child planning.
- Durable nested confirmation linkage across parent plan/instance/node, child plan, exact child Skill version and confirmation status.
- LangGraph `skill_confirmation` checkpoints that project the parent Task as A2A input-required and resume the same node after an explicit decision.
- Migration 0057 for pending/confirmed/rejected/invalidated child confirmation lifecycles.

### Changed

- `skill_call` no longer inherits parent confirmation; a child opts in independently through its current runtime policy.
- Top-level auto-confirm now requires every governing, directly planned and recursively reachable execution Skill to opt in.
- Child version changes invalidate a pending linkage and force a fresh child plan and confirmation.

### Verification

- Unit, real PostgreSQL migration/lifecycle and real A2A/MCP E2E evidence covers conservative transitive policy, independent pause/confirm/resume, rejection, cancellation, version drift and zero child MCP calls before confirmation.

## [1.0.5-bug-fixed] - 2026-07-16

### Fixed

- Task confirmation/rejection/cancellation decisions are serialized per Task, phase-checked before plan side effects, and carry an explicit top-level-versus-child confirmation target so duplicate child confirmations cannot start an outer execution path.
- Child decisions now match the complete parent checkpoint identity and revalidate the current Skill version plus immutable child-plan status immediately before confirmation and parent resume.
- Superseded child plans and changed Skill versions are invalidated and produce a newly projected child checkpoint instead of resuming stale authority or waiting invisibly.
- User cancellation is durably projected before releasing a child checkpoint; unified wait-timeout cancellation also rejects the nested wait and releases the in-memory parent execution.

### Verification

- Regression evidence covers parent/child pause state, concurrent duplicate confirmation, stale checkpoint metadata, confirmation on a canceled parent Task, superseded confirmed child plans, repeated fresh checkpoints and real version-drift/cancel A2A/MCP flows. The full operator-managed gate passes 238 unit, 58 contract, 43 integration and 43 E2E tests.

## [1.0.4] - 2026-07-15

### Added

- Domain-owned live/simulation/historical-replay execution context with stable non-live identity.
- Runtime-owned `X-SDAR-Execution-Mode` and `X-SDAR-Simulation-Id` Headers for simulation and historical replay MCP calls.
- Migration 0056 invocation audit fields for execution mode and simulation identity.

### Changed

- LangGraph MCP, Subworkflow and `skill_call` boundaries explicitly inherit execution context, including paused/resumed execution.
- Credential configuration rejects reserved Header names case-insensitively; runtime sanitization strips legacy conflicts and writes canonical reserved Headers last.
- The official-SDK loopback Mock MCP supports multiple isolated Streamable HTTP sessions so live and non-live Header sets are verified concurrently.

### Verification

- Unit, contract, real PostgreSQL migration/audit and real Skill Evolution E2E evidence prove live omission, simulation/replay Headers, stable IDs, child inheritance, credential merging/conflict rejection and sanitized invocation audit.

## [1.0.4-bug-fixed] - 2026-07-15

### Fixed

- Non-live simulation identities are limited to 256 visible ASCII characters before they can become an HTTP Header value.
- Duplicate case variants of reserved Headers in legacy decrypted credentials are stripped before canonical runtime values are written.
- Non-live transport failures retain execution mode and stable identity in sanitized invocation audit.

### Verification

- Regression evidence covers paused/resumed context retention, repeated stable-ID MCP session reuse, legacy Header conflict normalization and final 276 unit/contract, 42 integration and 42 E2E gates.

## [1.0.3] - 2026-07-15

### Added

- Durable Task input requests, responses and initial/input-response execution attempts in PostgreSQL, including exact Goal-control round linkage.
- Attempt-aware BullMQ Jobs with one-attempt execution and BullMQ-safe composite Task/attempt identity.
- `WorkflowControllerService.continueAfterInput` for a fresh, unconfirmed plan after Goal Evaluation requests more input.

### Changed

- `provide_input` now answers the original waiting request, queues continuation on the original Task/Context, and immediately projects working state.
- Goal deliberation uses persisted supplementary answers; Workflow controls merge the same data into execution input without replaying completed Workflow instances.

### Verification

- Unit, real PostgreSQL restart, real Redis serialization/job-identity, and real A2A/MCP tests cover both recovery paths and prove the supplied value reaches subsequent MCP arguments.

## [1.0.3-bug-fixed] - 2026-07-15

### Fixed

- Supplementary-input answer, response, continuation attempt and Task phase projection now commit in one PostgreSQL transaction.
- Durable queued attempts are reconciled to BullMQ at startup and on a bounded interval; terminal stale Redis Jobs can be replaced only while PostgreSQL still records the attempt as queued.
- Startup recovery marks interrupted running attempts failed with `PROCESS_EXECUTION_LOST` and never redispatches running or failed attempts.
- Supplementary input larger than 64,000 characters is rejected before any answer or continuation-attempt write.

### Verification

- The complete operator-managed `pnpm verify` gate passed without Docker lifecycle operations: 270 unit/contract tests, 41 real PostgreSQL/Redis integration tests, 42 real E2E tests, both migration paths, production builds and both smoke stages.

## [1.0.2] - 2026-07-15

### Added

- Real planned child Workflows for `skill_call`, using the current Skill definition, current MCP planning metadata, normal Workflow validation, independent plan/instance persistence and the sole LangGraph runtime.
- Bounded Skill-call ancestry with stable cycle and maximum-depth errors.

### Changed

- Child results must pass the executed Skill version's output schema; failed, canceled or invalid children propagate to the parent instead of returning a model-fabricated success.
- Child Skill Tool policy is enforced against its own child Workflow, while parent Workflows retain child version and budget evidence.

### Known issues at feature tag

- Nested confirmation policy will be finalized in v1.0.5.
- Repeated execution of the same parent `skill_call` node retains only the latest linkage under the current persistence key; the v1.0.2 bug-fixed audit covers this case.

## [1.0.2-bug-fixed] - 2026-07-15

### Fixed

- Repeated entry into the same parent `skill_call` node now persists append-only call history keyed by `call_id`; latest-call lookup remains deterministic.
- Child outputs must be finite JSON and no larger than 64,000 serialized characters before entering parent Workflow state.
- Integration bootstrap now advances an existing migration ledger monotonically instead of replaying older constraint migrations.

### Verification

- Migration 0054 passes empty and historical-0049 upgrade paths, rollback/reapply, and real PostgreSQL repeated-parent-node repository tests.
- Unit and real E2E evidence retain child failure/cancellation propagation, plan-save failure, recursion/depth rejection, real MCP audit and output validation.

## [1.0.1] - 2026-07-15

### Added

- Recursive Workflow runtime data binding for initial input, node outputs, errors, loop counts, and result state, including immutable execution snapshots and stable missing-reference errors.
- Dynamic `llm.context`, MCP arguments, Skill input, and Subworkflow input in the public Workflow DSL.

### Changed

- MCP and Skill business-schema checks are deferred for dynamic templates and enforced again after runtime resolution against the current registered schema.
- Subworkflows receive their resolved node input instead of the parent Workflow's original input.

### Known issues at feature tag

- No known correctness issue. Bindings intentionally support finite JSON data and restricted path segments only; JSONPath, string interpolation, and executable expressions remain unsupported.

## [1.0.1-bug-fixed] - 2026-07-15

### Fixed

- Bounded recursive template and referenced-value traversal at 64 levels with a stable depth error, preventing stack exhaustion on pathological runtime values.
- Missing optional `result` state now reports the stable missing-reference code, and error messages include an unambiguous JSON path for node IDs containing dots.

### Verification

- Boundary regression covers the maximum accepted depth, template and referenced-output overflow, missing result, dotted node IDs, error objects, null/empty arrays, immutable snapshots, parallel joins and live Schema rejection.

### Added

- Apache License 2.0 project licensing for copyright holder zhouwen, including canonical `LICENSE`, project `NOTICE`, package metadata, README disclosure, and license-ledger documentation.

- Signed V1 release checklist, isolated clean-checkout/frozen-install evidence, and machine/human release-posture reports.

- Configuration/operations/troubleshooting and contribution guides covering environment, lifecycle, health, failure posture, secrets, backups, release evidence, and engineering rules.

- Isolated empty-database and historical 0049→0053 PostgreSQL migration verification, included in the full gate with cleanup and current-constraint assertions.

- `pnpm demo:local` and `pnpm demo:acceptance`, plus a documented official-SDK A2A example client that streams a task, confirms its plan, polls to completion, and is exercised against Mock MCP.
- Product-oriented README quickstart, local endpoints, complete verification, safety posture, and architecture/operations links.

- Human and machine V1 acceptance audits mapping all AC-01..18 scenarios to the current full-gate evidence, plus a static verifier for exact scenario coverage and evidence classification.

- A true full `pnpm verify` orchestrator covering static/unit/contract/build, real integration, real E2E, infrastructure smoke, and Server/Console-bundle smoke, with machine-readable and Markdown summaries under `reports/verification/`.
- A documented `pnpm smoke` aggregate command.

- Current real PostgreSQL/Redis integration (2 files/36), full E2E (1 file/40), infrastructure smoke, Server/Console-bundle smoke, and unified 54-file/242-test gate; promoted FR-MCP-008, FR-MCP-012, NFR-PERF-002, NFR-OBS-001, and NFR-UX-001 with real evidence.
- Real production-Console browser navigation evidence for Task/Goal/Workflow/Skill/MCP/model/Memory/Evaluation associations and reverse Task links.
- ADR-072 monotonic migration-ledger high-water rule, preventing legacy startup replay from regressing later constraints.

### Fixed

- Runtime-hardening baseline verification can reuse operator-managed loopback PostgreSQL/Redis without issuing Docker lifecycle commands; Compose images are again pinned by immutable OCI digest, and the external-infrastructure mode is recorded in verification evidence.

- The 20-Job Redis concurrency test now observes completion in bounded batches, avoiding a false-positive Node EventEmitter warning from BullMQ's temporary `waitUntilFinished` listeners without reducing execution concurrency or assertions.

- SBOM/license generation now filters the pnpm virtual store through the current lockfile and records package-relative license locators, excluding stale packages and peer-layout paths left by prior installs so clean-checkout evidence is deterministic.

- Clean Windows checkouts now retain the repository LF formatting baseline through `.gitattributes`, so the frozen-install verification is independent of global `core.autocrlf` settings.

- Local Compose now publishes PostgreSQL and Redis only on `127.0.0.1`; the infrastructure verifier rejects non-loopback datastore port publishing.

- Graceful Runtime shutdown now waits for tracked confirmed-Task background controls before closing MCP transport and PostgreSQL, preventing pool-after-end failures after externally terminal Tasks.

- Console production assets now use the `/console/` base served by Express; Server smoke fetches the emitted JavaScript bundle and checks the trusted-intranet warning marker.
- Integration fixtures now satisfy current Task phase and Goal/Plan/model-invocation foreign-key constraints without weakening them.
- E2E MCP registration parsing retains generated enhancement metadata before asserting the production response.

- Reconciled NFR-REL-002 with historical real single-attempt Redis/BullMQ, startup-failure, MCP no-replay, and exactly-one model-failure evidence against the exact no-duplicate-side-effect acceptance.

- Repository-owned Workflow visual topology editing with data-only node, entry/exit, and edge controls; reconciled FR-ADM-004 against historical real immutable revision/execution/event evidence and current 54-file/242-test gate.

- Reconciled FR-ADM-006 with historical real Task-rooted execution evidence and current complete query/navigation/filter projections.

- Reconciled FR-ADM-003 by mapping every Skill Studio operation to its verified real Skill/evolution lifecycle plus current API/Console wiring.

- Reconciled FR-ADM-008 with real PostgreSQL/MCP/model analytics E2E and current complete operations-dashboard projections.

- Reconciled FR-ADM-007 with real management/model/PostgreSQL Memory lifecycle E2E and current Console controls.

- Reconciled FR-ADM-005 with real PostgreSQL/model/management Prompt lifecycle E2E and current traceability controls.

- Reconciled FR-ADM-002 with historical real MCP lifecycle and 31-test PostgreSQL/Redis operation-log evidence plus current management/Console contracts.

- Verified FR-ADM-001 against its exact unauthenticated-access and trusted-intranet deployment-warning acceptance, including real browser render/navigation evidence.

- Reconciled FR-MCP-011 with historical real PostgreSQL dependency-warning evidence and current no-auto-disable management/Console boundaries.

- Exact Skill-to-Task PostgreSQL inventory navigation and Task-to-MCP-Tool focus, closing two NFR-UX-001 identifier-chain gaps with executable click evidence.

- Reconciled NFR-PERF-001 with historical real BullMQ serialization and a deterministic ten-context no-crossover concurrency regression.

- Reconciled NFR-SEC-002 with historical real PostgreSQL/same-process MCP and Model encryption evidence plus the exact no-plaintext/environment-master-key acceptance criterion.

- Bounded semantic MCP exception recovery for retry, prevalidated changed arguments, alternative Tools, enabled Skills, or termination, with immutable LangGraph routing and replay counters.

- Reconciled FR-A2A-012 and FR-LLM-005 against later real PostgreSQL/pgvector, A2A, management, model-audit, and dynamic Agent Card evidence; both stale rows are now verified.

- Direct BullMQ Worker-failure integration evidence for single-attempt retained failure, plus NFR-REL-001 recovery traceability reconciliation.

- Verified NFR-MNT-001 against its interface-unit-test acceptance with executable port substitution and 165-file single-runtime architecture enforcement.

- Reconciled NFR-DATA-001 with the historical real migration/PostgreSQL/E2E gate and its exact no-automatic-deletion acceptance criterion.

- Verified NFR-OBS-002 with real loopback Provider sanitization, official A2A SDK projection, and management structured-audit contracts.

- Verified NFR-SEC-001 against its explicit trusted-intranet warning and deployment network-isolation checklist acceptance.

- Registration-time structured LLM enhancement for all MCP Tools, editable planning metadata with original-schema authority, fixed-stage migration, and fail-closed Server migration completeness enforcement.

- Machine-verifiable A2A 1.0.1 specification/SDK/TCK pins, direct patch media-type contracts, and a 100% official HTTP+JSON/MUST TCK result with explicit skip and beta-SDK boundaries.

- Expanded architecture enforcement across package source and the Server composition root, including fail-closed rejection of known second workflow runtimes.

- Task-rooted Plan-confirmation and Goal-Patch correlation with persisted confirmation Task/time, triggering Task identity, additive migration 0052, and full-chain observability evidence.

- Unified environment-owned AES-256-GCM Cipher injection for MCP and Model credentials with real-cipher database plaintext-rejection assertions.

- Fail-closed non-loopback A2A/management binding validation with explicit no-auth trusted-network acknowledgement and release network-isolation checks.

- Explicit ten-Job BullMQ default concurrency with deterministic ten-context overlap and strict same-context tail-isolation evidence.

- Machine-readable management health and Console warnings for indefinite V1 historical retention, advisory retention fields, and disabled automatic cleanup.

- Cross-boundary private-reasoning protection for OpenAI-compatible/Anthropic Provider responses, necessary-summary-only A2A projection, and displayable management audit evidence.

- Persisted monotonic Workflow terminal-node duration with management Trace/Console replay display and an additive rollback-capable PostgreSQL migration.

- Complete FR-ADM-001..008 traceability mappings to console/runtime implementation, tests, acceptance reports, and explicitly unverified real-E2E evidence.

- Independent Goal-to-Task-history navigation using an exact management filter over persisted `agent_task.goal_id`.

- Bidirectional Task/MCP/model/Evaluation links and explicit Memory-source-to-Task navigation using persisted identifiers only.

- Exact one-click Task-to-Workflow/Skill and Workflow-to-owning-Task navigation backed by persisted identifiers and a PostgreSQL `planId` Task query.

- PostgreSQL-derived MCP usage, model effects, Skill capability growth, and evidence-counted advisory optimization suggestions for the complete FR-ADM-008 dashboard.

- Machine-readable and human-readable EP-06 acceptance audit classifying unified verification and browser rendering as real, contract/SSR coverage as simulated, and Docker-backed gates as unverified.

- Operational Evaluation dashboard for real success, duration, cost, failure distribution, Skill-version stability, and ordered quality-trend evidence.

- Validated operational controls for Task wait timeout, Memory retention values, and Skill evolution threshold, preserving the V1 prohibition on automatic Memory cleanup.

- Filterable PostgreSQL Task inventory and optional two-second refresh of the complete Task-rooted Goal/Workflow/model/MCP/evaluation trace in the operational console.

- Credential-safe model Provider and fixed-stage route inventory APIs plus operational console views for encrypted Provider configuration, routing, system policies, evolution triggers, and sanitized model invocation audits.

- Complete Skill Studio controls for constrained authoring, full definition edits, persisted draft publication, simulation/correction, version diff, lifecycle actions, warnings, and typed Skill Graph relations.
- Real Prompt version/effect controls, source-linked Memory lifecycle management, and filterable Evaluation/quality-warning console views.
- Task-rooted correlated observability across Goal, Plan/Workflow, runtime events, model and MCP calls, results, inference, evaluation, feedback, evolution, and errors.
- Workflow DAG workbench with strict DSL validation, immutable administrator revisions, explicit confirmation, PostgreSQL node-event trace lookup, and progressive execution replay.
- Real MCP and Skill console lifecycle controls plus PostgreSQL-backed, credential-safe MCP management-operation history.
- React/Vite operational console foundation with real management-API views, persistent trusted-intranet warning, exact-version OSS intake, and same-process static delivery under `/console`.
- Route-complete management OpenAPI coverage for all 94 implemented API operations, enforced by an automated drift and duplicate-operation-id gate.
- Filterable PostgreSQL Evaluation analytics for success, duration, call cost, failure types, Skill-version stability, and quality trend, including explicit model-to-Task correlation.
- Report-linked Evaluation influence across Skill quality observations, quality-gated Workflow Template induction, and inactive stage-specific Prompt optimization candidates.
- Task-linked low-confidence implicit feedback for result acceptance, continued modification, repeated submission, redo requests, and failure-driven Skill switching.
- Five-component completed-Task quality reports with strict Goal/Workflow/Skill/result/Tool assessments, deterministic aggregation, PostgreSQL evidence linkage, and management retrieval.
- PostgreSQL-managed Memory review/archive/delete policy fields with V1 domain/database enforcement that automatic cleanup remains disabled.
- Source-linked evolution Memory projections for Skill/Prompt manual corrections, Task failure reasons, and Goal evaluation conclusions through the strict refinement boundary.
- Transactional Memory supersede/invalidate lifecycle with explicit replacement links, append-only status audit, conflict rejection, historical reads, and active-only retrieval.
- Stage-specific long-term Memory retrieval with distinct type allowlists/query templates and audited evidence injection for intent, Skill selection, Workflow generation, exception handling, and Goal evaluation.
- LLM-refined long-term Memory admission from valuable processed results, with normalized structured content, pgvector-assisted exact deduplication, Task/ProcessedResult provenance, and a refinement-only management boundary.
- Versioned Workflow-template induction from repeated successful Experiences, similarity-ranked planning reuse, immutable adjustment, confirmation preservation, and source/use/effect audit APIs.
- Version-specific Skill quality observations and persistent low-score/failure-rate warnings with an enforced warning-only policy and separate administrator disable, rollback, and correction controls.
- Source-governed Skill publication with fail-closed A2A drafts, dedicated management publication, persisted publisher/SkillVersion linkage, and dynamic Agent Card evidence.
- Administrator correction and full revalidation of failed evolution drafts, with immutable actor/before/after/diff/result Experience history and corrected-Schema simulation semantics.
- Real failed-simulation acceptance evidence proving the all-pass evolution publication gate retains a draft without changing the current formal Skill version.
- Tool-indexed historical Evolution Experience replay through the single LangGraph runtime, with successful/failed outcome matching and unified static/source/normal/boundary/exception simulation reports.
- Failure-driven alternative Skill replacement with persisted initial selection identity, immutable failed-instance evidence, forced fresh plan confirmation, and same-controller continuation.
- Fail-closed selected-Skill Tool-policy enforcement during generated plan preparation and confirmed execution, rejecting missing required and referenced forbidden MCP Tools before any call.
- Global formal-Skill reuse across user identities and independently persisted LangGraph child Workflows for `skill_call`, including actual current SkillVersion and schema-evaluation evidence.
- Task-owned initial Workflow planning with persisted selected-Skill identity, strict confirmation gating, Skill opt-in auto-confirmation, outer-controller execution, and equivalent synchronous/return-immediately A2A results.
- Task-level management confirm/reject/revise actions sharing the same authoritative lifecycle path as A2A follow-up messages.
- Explainable missing-Goal-input inference over conversation history, global pgvector memory, and existing results, with strict fixed-model decisions and persisted source snapshots.
- Domain-owned global MemoryItems with mandatory source references, PostgreSQL/pgvector semantic retrieval, management contracts, and cross-user local E2E evidence.
- Task-bound capability-gap outcomes with persisted missing-tool evidence, suggested contracts, authoritative A2A `INPUT_REQUIRED` reads, and real SDK-client E2E coverage.
- Seven strict Goal-evaluation action types with action-specific evidence, explicit input/capability waiting states, immutable external replanning, and PostgreSQL per-round replay.
- Two-stage MCP/result processing with downstream envelopes, context trimming, fixed-stage Skill-directed final output, strict schema validation, and persisted facts/value/memory candidates.
- Runtime-first Goal cancellation with Skill-policy execution control, atomic Goal/Task/Plan/instance cascade, immutable history, A2A/management APIs, and stale-Worker terminal guards.
- Context-wide active Goal reuse and fixed-stage terminal-Goal relationship decisions with atomic related/unrelated history and real multi-Task A2A evidence.
- LangGraph-native execution pause/resume/cancel controls with no-next-node guarantees, Skill threshold/policy resolution, long-pause fresh-confirmation replanning, and real MCP/A2A evidence.
- PostgreSQL-authoritative unified Task wait timeout with managed configuration, atomic cancellation/audit, restart-safe scheduler, and real A2A expiry evidence.
- Versioned Goal Patch processing with atomic old-state invalidation, immutable audit history, forced new-plan confirmation, A2A/management APIs, and explicit compensation guidance/warnings.
- Fail-closed process-start recovery that atomically terminates interrupted Tasks/Workflow instances while preserving queued BullMQ work with one attempt and no automatic retry.
- Explicit Model Provider API styles with composite OpenAI-compatible/local and non-OpenAI Messages adapters, PostgreSQL configuration, strict management contracts, and normalized cross-provider audit evidence.
- Fixed-stage structured LLM final decisions for intent, Goal, Skill selection, Workflow planning, execution exceptions and Goal evaluation, including queue-path failure without fallback and richer persisted Skill candidate evidence.
- Native LangGraph human-confirmation interrupt/resume with PostgreSQL paused state, ephemeral fail-closed checkpoints, continuous budgets/events, and real MCP no-replay evidence.
- Immutable natural-language and administrator DSL/DAG plan revisions with atomic confirmation invalidation, persisted lineage, real A2A Task binding, management APIs, and confirmed LangGraph execution evidence.
- PostgreSQL-authoritative outer Goal evaluation/replanning with strict structured decisions, immutable next-version plans, ordered round evidence, confirmation pause/continue, all-Skill auto-confirm gating, and max-replan termination.
- Workflow budget resolution from system defaults and current Skill overrides, concurrency-safe LangGraph duration/LLM/MCP/cost enforcement, deadline cancellation, stable termination reasons, and persisted Skill-version/limit/usage evidence.
- Confirmed-plan LangGraph.js compilation with a type-strict expression interpreter, all-ten-node execution coverage, immutable PostgreSQL Workflow instances/node events, management confirmation/execution APIs, subworkflow recursion guards, and real MCP execution including no-second-confirmation repair evidence.
- Workflow planning with authoritative JSON Schema output, bounded same-model validation correction, persisted candidate/error history, immutable Goal-version identity, and repository-proven confirmation inheritance.
- Domain-owned Workflow DSL, draft-2020-12 Schema, restricted expression AST, strict graph/catalog validator, negative security corpus, and real MCP/Skill validation e2e.
- PostgreSQL Prompt version lifecycle with inactive automatic candidates, administrator publication, disable/rollback-as-new-version, stage runtime resolution, invocation linkage, and effect summaries.
- Database-configured fixed-stage Model Runtime with AES-GCM Provider credentials, OpenAI-compatible/local HTTP structured and embedding calls, sanitized token/duration audits, and explicit no-fallback failure behavior.
- PostgreSQL/pgvector Skill projections and semantic candidate scoring with provider/dimension guards, same-process selection API, and a separately injected final-decider boundary.
- Fail-closed structured Skill authoring with a vendor-neutral ModelProvider port, bounded Schema correction, explicit-Schema validation, optional same-process management wiring, and PostgreSQL/Agent Card e2e evidence.
- Task-scoped Temporary Skills with enabled-MCP-Tool validation, atomic expiration/Experience persistence, canonical capability fingerprints, and a repeated-success `awaiting_simulation` formalization gate that cannot publish formal Skills.
- Skill candidate metric snapshots and an LLM-decision port that prevents semantic retrieval from becoming the final selector.
- Persistent Skill selection records and alternative-only replacement plans fixed at `awaiting_confirmation`.
- Domain-owned persistent Skill Graph with six typed relation kinds, hierarchical cycle prevention, management CRUD, OpenAPI, and real e2e evidence.
- MCP remote health checks that persist enabled/unreachable state, and remotely validated AES-GCM credential rotation without Tool rediscovery.
- Skill immutable version-chain, field-diff, and rollback-as-new-version management APIs.
- Same-process management HTTP API for real MCP and Skill operations, with OpenAPI, strict Zod input validation, credential-free responses, redacted errors, and explicit trusted-intranet/no-auth warnings.
- Persistent MCP invocation audit records with task/context correlation, arguments, displayable results/errors, status, timestamps, and duration.
- Persistent dependency warnings for enabled SkillVersions affected by removed or schema-changed MCP Tools, without automatic Skill disablement.
- Editable validated Tool enhancement metadata preserved across manual refreshes while original input schemas remain authoritative.
- Remote-only MCP Registry with runtime register/delete/manual refresh, official Streamable HTTP discovery/calls, current original-schema validation, and loopback contract/e2e coverage.
- AES-256-GCM credential envelopes backed by an environment master key and PostgreSQL MCP Server/Tool persistence.
- Explicit JSON Schema draft-07 support for official MCP Tool schemas alongside SDAR 2020-12 schemas.
- Persistent immutable Skill/SkillVersion registration, schema publication gates, enable/disable and rollback versioning.
- Enabled PostgreSQL SkillVersions as the dynamic Agent Card authority and selected SkillVersion output schema as the result-validation authority.
- Unit, PostgreSQL integration, and A2A end-to-end evidence for the first EP-02 vertical increment.
- EP-00 pnpm workspace with strict TypeScript, ESLint, Prettier, Vitest and unified bootstrap verification.
- Exact dependency pins and OSS Intake records for A2A JS SDK, LangGraph.js, MCP TypeScript SDK, esbuild and reference-only projects.
- A2A 1.0 wire-shape, MCP Streamable HTTP and LangGraph bounded-loop compatibility Spikes with reproducible tests.
- Machine-readable and human-readable EP-00 bootstrap verification reports.
- Digest-pinned PostgreSQL 17/pgvector 0.8.4 and Redis 8.2.7 Compose services with health checks, bootstrap migration and rollback notes.
- Real loopback A2A REST/streaming endpoint contracts and MCP remote cancellation propagation contract.
- CycloneDX SBOM, installed-package license report and generated third-party notices with freshness verification.
- A2A stream-disconnection contract proving task execution continues and can be polled to completion.
- LangGraph parallel-join and compiled-subgraph compatibility coverage.
- Reproducible `pnpm smoke:infra` command covering pgvector migration/vector operations and Redis write/read; current host Docker denial is reported as unverified evidence.
- EP-00 real infrastructure smoke passed unchanged after Docker access was restored: pgvector 0.8.4, migration, vector operation and Redis write/read verified.
- EP-01 domain-owned Task/ConversationContext/Goal models, deterministic task state machine, stable errors and application TaskService ports.
- Automated architecture gate enforcing Domain/Application independence from A2A, MCP, LangGraph, Express, ORM and queue SDK types.
- PostgreSQL Context/Task/Event repositories with idempotent protocol-domain migration and rollback.
- BullMQ queue/Worker adapter with attempts=1, in-process same-context serialization and queued-job restart retention verified against real Redis.
- Validated A2A message/domain mappings and a PostgreSQL-backed SDK TaskStore projection that keeps the domain task as the system of record.
- Single-process server composition root connecting the official A2A endpoint, TaskService, PostgreSQL repositories and BullMQ worker through the mandatory plan-confirmation boundary.
- Whitelisted A2A follow-up actions for plan revision/confirmation, supplementary input, pause and resume, persisted through the domain state machine and verified with the official client.
- ADR-008 documenting the domain-authoritative A2A projection and metadata-based follow-up command contract.
- Reproducible official A2A HTTP+JSON MUST TCK runner, test-only protocol SUT, production diagnostic reports, and TCK-driven fixes for JSON content types, AIP-193 errors, camelCase serialization and projection decoupling.
- Request-time dynamic Agent Card capability provider plus a unified EP-01 gate covering format, lint, typecheck, unit, integration, contract, e2e, build, built-server smoke and official TCK.
- Domain-owned Skill draft intake for explicit A2A create/update requests, persisted in PostgreSQL before queueing and excluded from dynamic Agent Card capabilities.
- Ajv-backed Result Processor boundary with strict Skill output-schema validation, stable errors, authoritative Task completion and dual text/data A2A artifacts.
- Production A2A stream-disconnect continuation, polling and standard resubscribe coverage, plus forced active-connection shutdown for deterministic server lifecycle.
- Automatic capability-gap resolution into a Task-bound Temporary Skill, mandatory-confirmation LangGraph execution, completion expiration/Experience recording, and real zero-before-confirmation MCP E2E evidence.
- Repeated-success Skill evolution with persisted induction/simulation reports, fail-closed drafts, all-pass automatic `experience_evolution` publication, management report endpoints, and dynamic Agent Card evidence.
- PostgreSQL-authoritative Evolution Experiences linking Goal, immutable Workflow, actual Skill versions, MCP Tools, input, result/errors, structured evaluation and duration, with Goal/Skill management retrieval.
- PostgreSQL-authoritative configurable Evolution success threshold with management GET/PUT and immutable per-Experience trigger audit records.
- Reproducible Skill induction reports covering consistency, stability, generalizability and duplication against the current formal Skill registry.
- Fail-closed capability-boundary evolution that creates either an immutable existing-Skill version or a distinct new Skill with a persisted decision reason.
