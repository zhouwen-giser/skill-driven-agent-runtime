# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog, and planned commits use Conventional Commits.

## [1.2.1] - Unreleased

### Added

- Frozen MCP Tasks V1.0 source/derived protocol package pinned to MCP commit `26897cc322f356487da89113451bd16b520b9288`, schema blob `cc44564e33305dbc07e820cdd0a97648f3852019` and SHA-256 `9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708`.
- Frozen/Legacy Domain contracts, task-behavior outcome matrix, canonical runtime revision and Provider Evidence types plus a Workflow DSL union that keeps historical Legacy `mode` readable while rejecting it from Frozen plans.
- ADR-108 explicit Legacy/Frozen dual-protocol boundary, Phase 0 OSS Intake and Draft PR #6 upgrade evidence.
- Nine derived JSON Schemas, nine valid fixtures, twelve Legacy/invalid fixtures and an eleven-file drift lock verified by `pnpm verify:protocol` and the normal bootstrap gate.

### Changed

- PROJECT_STATUS and v1.2 sync state now reflect protected PR #5 merge commit `922f428`; historical v1.2 reports remain unchanged.
- The exact MCP source Schema is vendored unmodified with attribution; derived SDAR schemas are separate modified artifacts and Frozen traffic cannot use the Legacy SDK Bridge.

### Verification

- Phase 1 passes the focused protocol contract, `pnpm verify:protocol`, 20-source lock verification, format, lint and strict typecheck. The baseline contract remains 111/112 on this Windows host because the unchanged symlink fixture fails during setup with `EPERM`; Docker-backed baseline remains unverified while operator port 55432 is occupied.
- Phase 2 passes all 471 unit tests, focused Workflow unit/schema contracts, format, lint, strict typecheck and the 260-source architecture gate. The full contract suite is 112/113 because the unchanged Windows symlink setup still fails with `EPERM`.

## [1.2.0] - 2026-07-18

### Added

- Phase 14 adversarial coverage for prompt-injected self-attestation plus a 22-threat audit across package, selection, planning, Provider readiness, recursive execution, evidence, confirmation, restart and legacy behavior.
- Phase 13 formal `embodied.area_patrol` recursive acceptance across exact fixed/dynamic child versions, bounded depth/cycles, four failure policies, parallel external waits, restart/cancel/input continuation, distinct degradation and complete parent/child execution trees.
- Phase 12 formal `embodied.move_to` vertical acceptance across guidance/template/procedure modes, exact Task calls, V1.1 remote waiting/continuation/input/cancel/restart, final-position hard gates and complete execution records.
- Phase 11 append-only Skill execution records with exact Goal/Skill/selection/policy/Workflow/Task identity, ordered lifecycle evidence, parent/child lineage, thin Provider/resource/RemoteTaskBinding/evidence/hard-gate/intervention/outcome references and queryable management trees.
- Phase 10 exact selected Usage evidence, bounded composition/interpretation and immutable policy wiring through the existing Task→Workflow Planner→Validator→outer confirmation path, including policy persistence and replan/revision/Goal Patch inheritance.
- Phase 9 exact-version Skill Usage planning policy, bounded guidance context, deterministic template/procedure-to-Workflow compilation, explicit Skill failure-policy DSL metadata and post-plan compliance checks through the existing Validator.
- Phase 8 exact Skill Task Type resolution, deterministic validated-semantics candidate attributes, required/preferred/forbidden Provider policy filtering and immutable v1.1 live-readiness summaries in the production Skill selection path.
- Phase 7 migration 0105 persists native exact-version Skill Usage snapshots and checksum-bound package import audit through the existing Registry transaction, with real validate/import, exact-version and filtered catalog API/Console surfaces.
- Phase 6 regenerated main-baseline repository/symbol/overlap maps and ADR-097–103 for exact usage, three modes, normative authority, bounded composition, package import, V1.1 readiness/continuation reuse and minimal execution records.
- Phase 5 bounded exact-version recursive composition through the existing Skill Graph/planner, dynamic capability slots, declarative parent/child mappings, immutable plans, four failure projections and safe guidance/template/procedure IR.
- Phase 4 structured applicability/context/readiness/mode decisions, fixed context authority ordering, mock-only `SkillTaskReadinessPort` and fail-closed filtering before the existing Skill model decider.
- Phase 3B reviewed `embodied.move_to` and `embodied.area_patrol` packages with three modes, Provider bindings, bounded composition/failure policy, evidence gates and checksum-pinned golden import snapshots.
- Phase 3A immutable current/exact-version catalog summaries, native/legacy usage diff, package import continuity, lifecycle projection and visibility/mode/derived-domain/exact-capability-tag filters through the existing Skill Registry.
- Phase 2 strict Skill Package JSON Schema, checksum-bound bounded UTF-8 reader, path/symlink/type/size guards, embedded-schema validation and immutable import candidates behind a filesystem adapter.
- Phase 1 immutable `sdar.io/v1alpha1` Skill Usage contracts with native/legacy snapshots, normative/adaptive separation, three modes, bounded Provider/composition/evidence policies and candidate-only patches.
- Frozen SDAR v1.2 EP-10, exact Goal task package, normalized Skill-driven capability-usage design, v1.1 overlap/symbol maps and recoverable Phase 0 baseline evidence.
- Frozen SDAR v1.1 MCP Tasks EP-09, requirement/acceptance addendum, Provider extension contract, repository/symbol/hardening maps and exact OSS pins.
- Phase 1 domain-owned immediate/remote result union, official v2 beta Tasks adapter, five-state snapshots, capability negotiation and real modern/legacy loopback contracts.
- Phase 2 durable `RemoteTaskBinding`, ordered observations, idempotent controls/protocol attempts, isolated migration 0100, versioned PostgreSQL polling and one-attempt BullMQ reconciliation.
- Phase 3 domain-owned Task timing/readiness, strict bounded DSL, structured risk decisions, fail-closed confirmation guards, exact-argument pre-call refresh, append-only migration 0101 evidence and read-only management/Console projections.
- Phase 4 bounded persisted-frontier continuation, PostgreSQL control inbox claims/attempts, one-attempt BullMQ continuation scheduling, fresh LangGraph branch continuation, parallel join evidence, child Skill Workflow propagation and Goal Patch/cancellation invalidation through migration 0102.
- Phase 5 bounded remote form elicitation, A2A structured input mapping, exact `tasks/update`, multi-round/echo-safe polling, cooperative cancellation request/ack/uncertainty/Provider-terminal separation, one-attempt BullMQ cancellation delivery and structured Provider business outcomes through migration 0103.
- Phase 6 deterministic MCP Tasks Provider scenarios and a machine-readable 16-scenario acceptance report; real PostgreSQL/Redis vertical, restart, parallel/child and A2A continuation evidence is paired with explicitly classified Provider/model simulation.
- Real management API and Console remote-task lifecycle projections, observations, input/cancellation state and operator poll/cancel actions with trusted-intranet and Provider-authority warnings.
- Migration 0104 permits the durable `node_waiting_external` Workflow event required by remote continuation and includes a guarded rollback that refuses to discard existing external-wait evidence.

### Changed

- PR #5 review hardening now applies exact declarative child output mappings after Schema validation on both immediate and persisted-continuation paths, binds empty child mappings to `skillInput`, gates mapped object evidence with a restricted presence expression, and excludes non-user-selectable Skills before top-level scoring/model selection.
- Native Skill Usage child policy is now an exact recursive allowlist even without legacy composition context, while immutable legacy Usage projections continue to use the existing Skill Graph authority.
- Deterministic Skill Usage execution now receives explicit `skillInput`, trusted context and Provider-evidence roots; terminal Skill execution status is published only after its outcome reference is durable.
- The post-main released migration profile now applies the single monotonic chain through 0106; the disposable `v1.1-isolated` profile guard remains for compatibility tests and ledger gaps still fail closed.
- Skill execution status is an append-only evidence projection of existing Task/Workflow/Provider authority; terminal projections cannot transition, and evidence-write failure never rewrites an authoritative terminal outcome.
- Skill Usage confirmation uses the existing outer Workflow Plan boundary. The complete policy remains immutable review data and no duplicate in-graph confirmation node is generated.
- Usage-aware selection is always wired when Skill selection is enabled; deployments without v1.1 Task metadata return no candidates for native Task bindings and fail closed, while the existing exact-argument pre-invocation readiness guard remains final.
- V1.2 applied migration high-water is now 0106 for minimal Skill execution records.
- ADR-096 keeps capability classification and lifecycle single-authority: catalog domains/tags derive from exact capabilities and lifecycle derives from existing Skill status.
- v1.1 and the complete published `v1.0.13-bug-fixed` hardening chain are merged. V1.1 ADRs are renumbered above the hardening high-water mark to avoid ambiguous decision IDs.
- The V1.1 migration compatibility guard now requires the complete released 0064 chain before 0100.
- Local Task/Goal cancellation remains immediately authoritative locally while active remote bindings enter `cancel_observing`; only later Provider snapshots can establish remote `cancelled`, `completed` or `failed`.
- Startup recovery preserves only Tasks backed by an active, valid PostgreSQL external-wait continuation/binding; ordinary executing, paused and evaluating work still fails with `PROCESS_EXECUTION_LOST` and is never automatically retried.
- Cross-package acceptance helpers now live under their dependency-owning `test-support` boundaries so PostgreSQL, BullMQ and A2A SDK types remain within the architecture-enforced adapters.

### Verification

- PR #5 review-blocker fix `df65de4` is published and all three review threads are resolved. Its focused gate passed format, lint, strict typecheck, all 465 unit tests, the 3 Workflow DSL contracts, 256-source architecture and production build. Full contract reached 111/112; the unchanged symlink fixture is blocked by Windows `EPERM` even elevated. Integration startup is blocked by an operator container owning fixed port 55432 and was not forced.
- SDAR v1.2 Phase 15 clean release-candidate SHA `b3b6e67` passed every explicit final command and the 148,794 ms self-managed `pnpm verify`: 574 unit/contract, 82 integration, 59 E2E, 256-source architecture, 116-operation OpenAPI, 18+16 acceptance scenarios, A2A MUST 74/74, 70 migrations, fresh 1.2.0 SBOM, build and both smoke stages.
- SDAR v1.2 Phase 14 clean-feature-SHA self-managed `pnpm verify` passed at `74344ce` in 153,204 ms with 574 unit/contract, 82 integration, 59 E2E, 256-source architecture, 116 OpenAPI operations, 18+16 acceptance scenarios, A2A MUST 74/74, 70 migrations, production build and both smoke stages.
- SDAR v1.2 Phase 13 passed all 20 area-patrol scenarios at `83753db`: 569 unit/contract tests, 82 isolated real integration tests, 59 real PostgreSQL/Redis A2A E2E tests, empty/0049 migration verification, production smoke, format/lint/typecheck/build and 256-source architecture.
- SDAR v1.2 Phase 12 passed all 14 move-to scenarios at `873ee80`: 565 unit/contract tests, 55 real PostgreSQL/Redis A2A E2E tests, 11 restart/remote integration tests, format/lint/typecheck, production build and 256-source architecture.
- SDAR v1.2 Phase 11 clean-feature-SHA format/lint/typecheck, 562 unit/contract tests, 256-source architecture, 116-operation OpenAPI and production build passed at `dc55f47`; real PostgreSQL repositories passed 57/57, final remote continuation runtimes passed 10/10, and the 0106 released/rollback/reapply/gap path passed.
- SDAR v1.2 Phase 10 clean-tree `pnpm verify` passed at `efb03e8` in 106,796 ms with 556 unit/contract tests, 81 real integration tests, 50 real E2E tests, 251-source architecture, 69 migrations, production builds and both smoke stages.
- SDAR v1.2 Phase 9 passed 68 focused planning/Validator/schema/LangGraph tests, all 448 unit tests and all 107 contract tests, including bounded repair, outer-plan confirmation preservation and adversarial normative/Provider/depth/failure/context/evidence compliance rejection.
- SDAR v1.2 Phase 8 passed 23 focused readiness/usage/selection tests, 8 real MCP registry integration tests, 56 real PostgreSQL plan-snapshot repository tests and 48 real A2A/MCP E2E tests, including every required Provider policy/readiness edge and the selection-before-planning availability request.
- SDAR v1.2 Phase 7 passed full format/lint/typecheck, 83 focused unit/contract tests, 56 real PostgreSQL repository tests, 48 real Server E2E tests, 114-operation OpenAPI, 246-source architecture, 69 migration pairs through isolated 0105, and production builds.
- SDAR v1.2 Phase 6 post-main-sync self-managed Compose `pnpm verify` passed in 141,005 ms with 542 unit/contract, 80 integration, 49 E2E, 246-source architecture, 68 migration pairs, production builds and both smoke gates.
- SDAR v1.2 Phase 5 self-managed Compose `pnpm verify` passed in 139,408 ms with 542 unit/contract, 80 integration, 49 E2E, 246-source architecture, migrations/build and both smoke gates; targeted composition/formal-package regressions passed 20/20.
- SDAR v1.2 Phase 4 targeted application/formal-package regression tests passed 23/23, all 428 unit tests passed, strict typecheck/target lint passed and architecture verified 244 sources.
- SDAR v1.2 Phase 3B formal package schema/import/invalid/legacy/golden tests passed 5/5 and all 106 contract tests passed.
- SDAR v1.2 Phase 3A targeted catalog/selection tests passed 12/12, all 417 unit tests passed, strict typecheck passed and architecture verified 240 TypeScript sources.
- SDAR v1.2 Phase 2 self-managed Compose `pnpm verify` passed in 149,172 ms with 513 unit/contract, 80 integration, 49 E2E, 239-source architecture, migration/build and both smoke gates; the final package security suite passes 10/10.
- `pnpm demo:acceptance` passed production build, 10 Provider contract tests, 402 unit tests, 80 real PostgreSQL/Redis integration tests, 49 real E2E tests and the V1.1 acceptance report verifier.
- Clean self-managed Compose `pnpm verify` passed at `13194b8` in 162.0 seconds: 75 unit/contract files and 493 tests, 80 real integration tests, 49 real E2E tests, 232-source architecture, 110-operation OpenAPI, 68 migration pairs and both smoke stages.

### Known limitations

- Phase 1–6 functionality and clean local acceptance are verified against merged `v1.0.13-bug-fixed`; `v1.1.0-rc.1` and ready PR #4 are published. External production Provider interoperability, protected review/merge and stable `v1.1.0` remain pending; this entry is not a stable v1.1 release announcement.

## [1.0.13] - 2026-07-16

### Added

- A bounded process-local `TaskStateNotifier` wakes A2A synchronous/streaming waits after committed
  Task changes while retaining a low-frequency PostgreSQL safety read.
- Commit notifications now cover ordinary Task saves, input continuation, wait expiry, process
  recovery, Goal Patch, Goal cancellation and atomic Runtime Terminal Outcomes.

### Changed

- A2A synchronous waits no longer query PostgreSQL every 10 ms. The default safety interval is one
  second, configuration below 100 ms is rejected, and every wake reloads PostgreSQL authority.
- Wait-window expiry returns the current standard Task snapshot instead of throwing
  `A2A_TASK_WAIT_TIMEOUT`; working Tasks continue in the background and remain pollable/resubscribable.
- Runtime close releases all notifier waiters before the A2A endpoint and database are closed.

### Verification

- The complete operator-managed `pnpm verify` passed in 89,011 ms with 296 unit, 64 contract, 60
  integration and 46 E2E tests, 185-source architecture, production build, migrations and smoke.
- Actual local samples recorded 4 reads for one 250 ms wait, 83 reads for 20 concurrent 250 ms waits,
  94 ms missed-notification recovery at a 100 ms safety interval, and sub-millisecond rounded close
  release. These are test-environment measurements, not production throughput claims.

## [1.0.13-bug-fixed] - 2026-07-16

### Fixed

- The final safety wake now returns its already-reloaded Task snapshot without an extra deadline read.
- Runtime close finishes released waiters before another database read or status publication, and an
  executor already closed rejects new Task submission with `A2A_TASK_EXECUTOR_CLOSED`.
- Transaction rollback regressions now prove failed terminal commits emit no Task notification.
- Configuration tests prevent reintroducing the old 10 ms interval or a non-positive wait window.

### Verification

- Required `pnpm verify` passed in 88,363 ms with 298 unit, 64 contract, 60 integration and 46 E2E
  tests, 185-source architecture, production builds, migrations and both smoke gates.
- Required `pnpm demo:local` completed its confirmed real A2A task and `pnpm demo:acceptance` passed
  all 46 E2E scenarios. Operator-managed mode disabled Docker lifecycle commands throughout.
- Bug-fixed local samples recorded 3 reads for one 250 ms wait, 60 reads for 20 concurrent waits,
  85 ms missed-notification recovery and zero post-close reads.

## [1.0.12] - 2026-07-16

### Added

- Domain-owned Memory durability (`durable`, `volatile`, `unknown`) and authority (`mcp`, `skill_experience`, `admin`, `model_inferred`) evidence, including a strictly validated seven-field refinement result.
- Migration 0064 converts new Memory embeddings to generic positive-dimensional pgvector values, adds durability/authority evidence, conservatively classifies legacy rows, and supplies a guarded rollback.
- A credential-free terminal-outcome query exposes post-commit enhancement warnings without changing the committed Task result.

### Changed

- Automatic long-term admission now embeds, deduplicates and persists only model-refined durable Memory; volatile and unknown candidates are rejected before embedding, and live device state must be requeried from MCP.
- Similarity search compares only active durable rows with the exact embedding provider and vector dimension, supporting tested 3-, 8- and 1536-dimensional providers without cross-provider comparison.
- Memory creation, embedding, deduplication or persistence failure after the authoritative terminal transaction records an enhancement warning and never reverses a completed Task or fabricates Memory success.

### Verification

- The complete operator-managed `pnpm verify` passed in 86,193 ms with format, lint, strict TypeScript, 284 unit tests, 64 contract tests, 60 integration tests, 46 E2E tests, 182-source architecture, 106-operation OpenAPI, production build, empty/0049→0064 migrations and both smoke gates.
- Real PostgreSQL migration tests cover provider/dimension isolation, durable-only retrieval, legacy exclusion and guarded rollback. No Docker command ran.

## [1.0.12-bug-fixed] - 2026-07-16

### Fixed

- A structured model can no longer elevate a durable processed-result candidate to administrator or Skill-experience authority; durable authority must match the application-owned source path.
- Current coordinates, battery, online state, occupancy and device-task state are deterministically forced to `volatile`/`mcp` before embedding even when a model falsely claims they are durable; direct creation cannot bypass the same policy.
- Memory content is copied, finite-JSON validated, depth/cycle bounded and deeply frozen at the domain boundary; provider embeddings are copied and frozen after finite positive-dimension validation, preventing asynchronous caller mutation from changing persisted evidence.

### Verification

- The required bug-fixed `pnpm verify` passed in 85,277 ms with 287 unit tests, 64 contract tests, 60 integration tests, 46 E2E tests, 182-source architecture, 106-operation OpenAPI, production build, empty/0049→0064 migrations and both smoke gates.
- Adversarial regressions cover forged durable classifications for every named dynamic-state class, authority elevation, direct-create bypass, cyclic/non-finite content and post-validation vector/content mutation. No Docker command ran.

## [1.0.11] - 2026-07-16

### Added

- Domain-owned MCP Tool execution semantics for effect, execution, cancellation, idempotency, replay and authoritative source.
- Migration 0063 stores declared, administrator and effective Tool values, call-time Invocation snapshots, and immutable Planner-time Workflow plan/attempt snapshots.
- Credential-free management API and Console controls for retained administrator overrides, plus semantics display in MCP inventory, plan confirmation and Skill Tool Policy views.

### Changed

- Official MCP SDK annotations, task support and the validated `io.sdar/tool-execution-semantics` metadata extension are translated inside the adapter; SDK types never enter domain/application contracts.
- Workflow planning and repair use a frozen semantics snapshot. Refresh preserves administrator input, while an available MCP declaration remains higher priority per the task package.
- LLM Tool Enhancement remains descriptive data and cannot set real execution authority.

### Verification

- The complete operator-managed `pnpm verify` passed in 86,700 ms with format, lint, strict TypeScript, 281 unit tests, 62 contract tests, 59 integration tests, 46 E2E tests, 182-source architecture, 105-operation OpenAPI, build, empty/0049→0063 migrations and both smoke gates.
- Compose daemon/config validation was deferred by operator-managed mode and no Docker command was run.

## [1.0.11-bug-fixed] - 2026-07-16

### Fixed

- `default_unknown` semantics can no longer carry non-unknown values, and accepted semantics snapshots are frozen at the domain boundary.
- A malformed exact `io.sdar/tool-execution-semantics` declaration now fails discovery instead of silently falling back to weaker annotation or administrator authority.
- Administrator semantics override and its management audit now commit in one PostgreSQL transaction; concurrent Tool removal returns not-found without a phantom audit, and audit failure rolls back the override.
- Persisted Tool source fields and Invocation snapshots are revalidated through the domain invariant before becoming runtime evidence.

### Verification

- The operator-managed bug-fixed `pnpm verify` passed in 85,191 ms with 283 unit, 63 contract, 59 integration and 46 E2E tests, 182-source architecture, 105-operation OpenAPI, production build, empty/0049 migrations through 0063 and both smoke gates.
- Real MCP SDK and PostgreSQL regressions prove fail-closed malformed declarations and atomic override/audit rollback. No Docker command ran.

## [1.0.10] - 2026-07-16

### Changed

- `capability_gap` is now a terminal Task and WorkflowControl outcome; the original Task has no resume path and keeps `errorCode=CAPABILITY_GAP` with its structured missing-capability evidence.
- A2A now projects capability gaps as standard `TASK_STATE_FAILED` with `nextAction=register-capability-and-submit-new-task`, never as `input-required`.
- A new Task in the same Context uses the normal serialized queue and may continue the still-active Goal; Tool registration or refresh never scans, resumes, enqueues or executes the old Task.
- PostgreSQL terminal mutation guards, Goal/runtime cancellation and implicit-feedback terminal lookup now treat capability gap consistently.

### Verification

- Terminal transition/follow-up/cancellation, structured A2A projection, stale Worker persistence, active-Goal successor submission and wait-timeout exclusion regressions pass.
- The operator-managed feature gate passed 274 unit, 60 contract, 58 integration and 46 E2E tests, 181-source architecture enforcement, 104-operation OpenAPI verification, production build and empty/historical-0049 migration paths through 0062.

## [1.0.10-bug-fixed] - 2026-07-16

### Fixed

- A Goal Patch initiated by a newer Task can no longer invalidate an older terminal capability-gap Task sharing the active Goal.
- WorkflowControl round insertion locks and rechecks non-terminal authority, so a stale Worker cannot append evidence after capability gap.
- PostgreSQL reads and the A2A projection fail closed when a capability-gap row lacks `CAPABILITY_GAP` or structured evidence; domain evidence fields must be non-empty.

### Verification

- The operator-managed bug-fixed gate passed 274 unit, 61 contract, 58 integration and 46 E2E tests, 181-source architecture, 104-operation OpenAPI, production build and empty/0049 migration paths through 0062.

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
