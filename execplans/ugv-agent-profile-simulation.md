# UGV Agent Profile external-simulation ExecPlan

## Purpose / Outcome

Deliver a reproducible `ugv-agent-profile` whose public capabilities are projected from the enabled exact `embodied.move_to@1` SkillVersion. A structured A2A request must traverse Goal and Skill selection, a governed `embodied.move` Task Binding, validated Workflow DSL, the sole LangGraph.js runtime, MCP Tasks external wait, SMPP Provider authority, persisted continuation, and an objective final-position gate. The result is external-simulation evidence only and is never production or physical-vehicle qualification.

## Requirements Covered

- Package tasks `UAP-P0-B01` through `UAP-P4-B01` and success criteria `SC-01` through `SC-07`.
- Existing SDAR requirements governing SkillVersion publication, exact Skill selection, immutable confirmed plans, Workflow validation/execution, MCP Task readiness, Provider authority, persisted-frontier continuation, cancellation, and A2A terminal projection.
- Safety contract: one permitted `vehicle_navigate(point)` dispatch for `vehicle:ugv1`; no recon, tracking, gimbal, emergency-stop planning, or weapon authority.

## Context and Orientation

- Repository branch/HEAD: `codex/sdar-ugv-smpp-integration@928c645702f9e05e32cc001335898b79444ef9f6`; the initial worktree was clean.
- Task-package reference `2275bc52759914bc80113358a9083e6f00d59e6d` is a sibling history with a one-file `.gitignore` tree difference. The reviewed drift is recorded under `reports/ugv-agent-profile-simulation/`.
- Reuse `skills/embodied.move_to/**`, the v1.2 Skill Usage path, the existing governed UGV/Home-Lab adapters, Workflow DSL validator/compiler, MCP Task readiness, `RemoteTaskBinding`, `WorkflowContinuationSnapshot`, A2A adapter, and existing UGV integration drivers.
- The sibling SMPP authority is the user-selected latest relevant branch `codex/goal-ugv-runtime-telemetry-joint-integration`. Work began from `ce57d3d7ac2f99c0c95fa61bd9746abe862ed507`; its accepted P1-B02 discovery/protocol/qualification checkpoint is now `90466127`, not a forced checkout of the package reference.

## Architecture and Interfaces

Skill Registry/PostgreSQL owns exact `SkillVersion` and capability publication. SDAR Domain/Application owns the semantic Task Type demand and immutable governed binding snapshot; the MCP registry owns concrete Server/operation/schema authority and live readiness. The Planner may consume only that frozen projection. Workflow DSL remains data and compiles only into LangGraph.js. PostgreSQL owns the active external-wait snapshot, binding, observations, control claim, continuation attempts, and final runtime evidence. The A2A adapter only projects the authoritative Task/Goal result.

SMPP remains the only southbound owner of `mqtt://192.168.2.63:1883` and `http://192.168.2.63:19000/mcp`. SDAR communicates only with the governed SMPP Runtime MCP endpoint. No external SDK, ORM, SMPP wire, or LangGraph type may cross into Domain models.

## Progress

- [x] 2026-08-21 01:22Z validated and read the Goal package, repository rules, architecture/domain/DSL baselines, relevant accepted ADRs, existing UGV Skill/deployment/reports, and the first task card.
- [x] 2026-08-21 01:23Z captured the clean SDAR baseline and reviewed the non-linear one-commit drift without reset, clean, stash, or overwrite.
- [x] 2026-08-21 01:23Z observed the sibling SMPP read-only preflight pass with the negotiated Device MCP protocol captured, upstream MQTT topic/QoS drift disclosed, and zero mutation.
- [x] 2026-08-21 01:36Z completed `UAP-P0-B01`: normalized cross-repository external-simulation evidence, froze both ExecPlans, passed package validation, focused 6/6 preflight tests, SMPP typecheck, both format/diff gates, runtime-version checks, and explicit zero-call assertions.
- [x] 2026-08-21 01:57Z completed `UAP-P0-B02`: froze the exact `embodied.move_to@1` Profile contract, point coordinate adapter, full Binding/readiness fields, external Device MCP schemas, explicit MQTT wire/time/freshness contract and objective final-position gate. SMPP freezer replay, both focused 3/3 suites, both typechecks and both diff gates passed with zero side effects.
- [x] 2026-08-21 03:12Z completed `UAP-P2-B01`: added the external-simulation-only `ugv-agent-profile`, exact-current enabled `embodied.move_to@1` catalog view, deterministic Profile Card identity, managed-Card precedence isolation, exact selection admission, direct/environment startup gates, and strict active-Card current-catalog reads. A real isolated PostgreSQL/Redis `startServerRuntime` test proved formal package import/audit, historical `ugv.navigate` retention without exposure, same-catalog Card hash stability with failing Provider readers never called, normal disabled-v2 lifecycle, stale Card fail-closed after injected projection failure, pending-outbox recovery, and final empty Card/A2A projection. Focused tests passed 27/27, expanded Profile regression passed 65/65, real integration passed 1/1, typecheck/build/architecture/scoped lint passed, and no external simulator or control action occurred. Repository-wide lint and format retain separately recorded unrelated baseline gaps.
- [x] 2026-08-21 04:47Z implemented and verified `UAP-P2-B02` local authority contract: the Profile-only exact semantic alias resolves through the current Skill/package audit, Node Provider Binding, persisted Frozen Runtime catalog and live ready-only Task availability; post-read expiry is fail-closed. The recursively frozen self-hashed selection covers navigate and final-state lifecycle/schema/lineage plus reservation invariants. Deterministic input and outcome adapters enforce the frozen CRS/axis contract, exact SMPP terminal field/topic and `oc1` authority, strict `initial < provider <= final` cursors, 3000 ms chassis freshness, Haversine tolerance and explicit displacement. Expanded focused tests pass 117/117, typecheck/build/architecture/scoped lint pass, and the serialized full contract replay passes 317/317; the mandatory default-concurrency contract command retains one unrelated 5000 ms timeout and repository lint/format retain disclosed baseline gaps. The PostgreSQL integration assertion is present but its isolated runner is environment-blocked before test start by the operator template1 collation defect, so no real external Provider materialization or execution is claimed.
- [ ] Complete `UAP-P2-B03`: connect the frozen binding to the governed DSL/Planner/evidence workflow without adding another Runtime.
- [ ] Complete `UAP-P3-B01` through `UAP-P3-B03`: isolated dual-repository startup, one authorized A2A simulation movement, external wait/continuation, negative/recovery scenarios.
- [ ] Complete `UAP-P4-B01`: full gates, traceability, changelog/status, final evidence hashes and handoff.

## Discoveries and Surprises

- The current SDAR feature branch and task-package reference are not in an ancestor chain, but their trees differ only in `.gitignore`; no runtime rollback is needed.
- The existing `embodied.move_to@1` package already declares dynamic `embodied.move`, exact-version usage policy and a final-position hard gate, but its production import/wiring and UGV Profile exposure must be proven rather than inferred from package files.
- Existing historical UGV integration used `ugv.navigate`, was blocked at external execution-mode/readiness boundaries, and cannot substitute for this Skill-driven Profile.
- Current external preflight proves Device MCP `1.26.0` and 15 tools plus bounded MQTT samples. The southbound Device MCP successfully negotiates `2025-11-25`; this is distinct from SMPP's northbound frozen protocol. Missing canonical `status/ugv` and `/ugv/speed` QoS 0 remain upstream MQTT drift and must stay visible.
- The current formal Skill package schema is wider than the frozen Profile contract: resource identity, frame and coordinate ranges still need a Profile guard/package narrowing in P2. P0 records that gap instead of claiming implementation.
- The documented SMPP freezer must be invoked with the repository-pinned `tsx` loader. A direct Node ESM attempt cannot resolve TypeScript source-internal `.js` specifiers; the failed invocation is preserved under the SMPP report `attempts/` directory.
- The generic A2A endpoint gives an activated managed Agent Card precedence over the Capability Card. The Profile therefore omits that optional authority only under `ugv-agent-profile`; every other deployment retains the existing precedence unchanged.
- A repository-wide Prettier check currently reports three untouched baseline files. All P2-B01 files pass a scoped Prettier check; the baseline failure and ownership check are preserved under `reports/ugv-agent-profile-simulation/attempts/`.
- The initial real integration run found the repository PostgreSQL container stopped, then exposed a host/template1 collation defect. The existing isolated database helper now accepts only the narrow optional literal `template0`; its default is unchanged, identifiers remain quoted, no shared-cluster repair was attempted, and the UAP integration creates and drops only its named database.
- A Skill lifecycle commit can succeed while Capability Summary/Card projection fails. For this Profile only, active Card reads therefore revalidate the Card `catalogHash` and `generationPolicyVersion` against the current exact Profile catalog; a mismatch returns unavailable rather than serving the stale capability. The existing catalog outbox remains pending and recovers through the normal projector.
- The official A2A SDK owns Agent Card handler failures and returns its stable 500 JSON body. The management API preserves the more specific `CAPABILITY_CARD_NOT_AVAILABLE` domain code; no custom A2A route or handler fork was retained.
- The Goal master requires every report to retain `evidenceClass=external_simulation`. P2 evidence additionally records `qualificationLayer=P2_local_integration` and `observationClass=local_runtime_and_postgresql` (or `deterministic` for attempts), so the Goal scope cannot be mistaken for completed external/P3 qualification.
- The latest SMPP discovery contract retains an optional strict `io.sdar/providerCatalog` identity and optional cancellation/pause-resume lifecycle booleans. Legacy Runtime snapshots may omit them, but the UGV resolver requires their exact values and fails closed; Provider readiness does not enter the catalog identity hash.
- The Provider position cursor is an opaque SMPP `oc1` v1 authority token containing the MQTT ingest sequence. The outcome gate accepts only the frozen exact pairs `chassis.position.geodetic`→`/ugv/gnss` and `chassis.position.local`→`/ugv/nav_state`, requires the outer authority to equal the token, and enforces `initial < provider <= final`; arbitrary lexical cursor ordering is not accepted. Skill success still uses the final `vehicle_get_state` WGS84 position.
- A Vehicle state aggregate `observedAt` can advance for non-chassis updates. Position freshness therefore uses only `freshness.chassisObservedAt`, for both the pre-dispatch baseline and final evidence, with the frozen 3000 ms maximum.
- The local PostgreSQL integration runner reached PostgreSQL on the approved host but failed before repository tests began with `XX000` because the operator-managed `template1` has no determinable collation version. No database/system repair or external service action was attempted.

## Decision Log

- 2026-08-21: Honor the user override by following the latest relevant SMPP branch. Its initial frozen source was `ce57d3d7`; the accepted post-qualification branch checkpoint is `90466127`, while `f8c37e6` remains only a drift reference.
- 2026-08-21: Reuse existing semantic owners and add only a Profile/binding adapter or policy projection where the current runtime lacks one; no second registry, workflow runtime, remote-task state machine, or evidence authority.
- 2026-08-21: Treat old reports as historical reuse evidence. New Goal reports use `evidenceClass=external_simulation`, `productionEligible=false`, and never rewrite historical failures.
- 2026-08-21: Do not authorize navigation until the package safety switches, exact target, fresh state, no active/uncertain task, confirmed exact plan, current readiness, and unused run/idempotency identity all pass.
- 2026-08-21: Profile version semantics are exact: only immutable `embodied.move_to@1` is public/selectable. A disable/enable lifecycle-derived version does not silently replace it; exact v1 unavailability disables the Profile.
- 2026-08-21: Mock Device MCP contract fallback remains false because the real external `tools/list` satisfies the point-navigation prerequisites.
- 2026-08-21: All Profile consumers share one read-only projection of PostgreSQL-authoritative enabled Skills. The projection admits only exact `embodied.move_to@1`, while an empty projection remains valid so the normal disable/catalog-rebuild path produces an empty Card instead of preventing startup.
- 2026-08-21: Use the Profile-specific generation policy `capability-policy-v1:ugv-agent-profile-v1` and Card identity `ugv-agent-profile`; this prevents a same-catalog generic Card from being reused under a different deployment identity.
- 2026-08-21: Keep the P0 Skill Package checksum as offline provisioning/freeze corroboration. Runtime Card authority is the current enabled PostgreSQL SkillVersion plus exact source ref `embodied.move_to:1`; neither Card publication nor active-Card reads claim to revalidate the package checksum.
- 2026-08-21: Add `CapabilityCardPublisher.requireCurrentCatalogOnRead` as an opt-in compatibility guard and enable it only for `ugv-agent-profile`. Other Agent Cards retain their existing read behavior, satisfying the no-unrelated-Card constraint.
- 2026-08-21: Keep the `embodied.move` → `vehicle_navigate` alias inside `UgvMoveTaskBindingResolver`; query the existing catalog only by the native operation and require exactly one authority-compatible candidate. Generic Task matching remains unchanged.
- 2026-08-21: Include validated Provider Catalog identity in the Frozen catalog canonical hash when present while preserving byte-compatible legacy omission. For UGV, cross-check that persisted Runtime identity/catalog against the current Node Control Binding.
- 2026-08-21: Persist no B02 selection and invoke no Provider. `SelectedTaskOperation` is a Domain-owned immutable value returned to the future B03 workflow integration; its canonical self-hash includes both operation lifecycle profiles, schemas, arguments, readiness, risk and confirmation.
- 2026-08-21: Require final-state evidence from the same frozen Runtime catalog and exact `vehicle_get_state` read contract. Provider terminal success remains necessary but insufficient, and freshness/displacement configuration may only be stricter than the P0 limits.

## Implementation Steps

1. Finish P0 baseline/preflight evidence and freeze the exact Device MCP/MQTT/point-move contract hashes. (Completed.)
2. Qualify the SMPP development simulation profile and northbound Provider read surface without enabling control.
3. Implement and test the additive `ugv-agent-profile`, deterministic Agent Card projection, exact Skill selection and semantic Task Binding to the governed `vehicle_navigate` operation.
4. Compile the minimum initial-state → remote navigate → continuation → final-state/evidence-gate workflow through the existing planner/validator/runtime and reject every forbidden operation.
5. Start isolated infrastructure, import/register exact authorities, execute read-only qualification, then open the one-dispatch simulation gate only when all safety predicates pass.
6. Capture the complete A2A-to-device lineage, final Haversine error, continuation/no-replay evidence, negative/recovery cases, and final gates.

## Validation

Run the smallest affected unit/contract tests after every increment. Protocol or cross-module changes require MCP/A2A contract and E2E coverage. Final validation includes `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm verify`, with real PostgreSQL/Redis and the external simulator for acceptance. Record exact commands, exit codes, test counts and report paths; do not weaken assertions or replace external evidence with mocks.

`UAP-P2-B01` final local validation:

- `pnpm install --frozen-lockfile`: PASS, already up to date.
- focused UGV Profile/Card/Skill Package/A2A command: PASS, 5 files and 27 tests.
- expanded Profile compatibility command: PASS, 9 files and 65 tests.
- `pnpm exec vitest run apps/server/test/ugv-agent-profile-runtime.integration.test.ts`: PASS, 1 real isolated PostgreSQL/Redis Runtime test; the emitted `P0001` line is the expected injected projection failure.
- `pnpm typecheck`: PASS after the preserved failed/fixed signature attempt.
- `pnpm verify:architecture`: PASS across 802 TypeScript source files.
- `pnpm build`: PASS.
- scoped ESLint for every P2-B01 TypeScript file: PASS.
- `pnpm lint`: BASELINE FAILURE, 22 errors in seven unchanged Home-Lab/Node-Control files; exact ownership and minimum unblock condition are preserved in `attempts/uap-p2-b01-lint-baseline.json`.
- repository format/diff and final scoped-format results are recorded in `uap-p2-b01-verification.json`.

`UAP-P2-B02` validation snapshot:

- focused binding/input/outcome command: PASS, 3 files and 76 tests; expanded B02 protocol/persistence/profile command: PASS, 9 files and 117 tests.
- `pnpm test:contract`: default concurrency reached 50 files/316 tests before the unrelated Node Control conformance test exceeded its fixed 5000 ms timeout; that file passes 6/6 alone and the same full suite passes 51 files/317 tests with `--maxWorkers=1`. No timeout or assertion was weakened.
- `pnpm typecheck`, `pnpm build`, `pnpm verify:architecture`, scoped ESLint/scoped format and `git diff --check`: PASS.
- `pnpm lint`: BASELINE FAILURE, the same 22 errors in seven non-B02 Home-Lab/Node-Control files. `pnpm format:check`: BASELINE FAILURE in three non-B02 files. Exact failures and scoped passes are preserved under `attempts/`.
- repository PostgreSQL integration: BLOCKED before test start by `XX000` template1 collation metadata; the persistence integration assertion remains present but is not reported as executed evidence.

## Idempotence and Recovery

Read-only probes are bounded and exact-topic only. Every write run has a unique A2A idempotency key and one unused simulation run ID. An ambiguous navigation admission or transport failure triggers Provider reconciliation and blocks redispatch. Continuation resumes the persisted frontier and never invokes `START`. Cleanup may remove only Goal-owned containers/volumes and must not touch the external simulator or unrelated worktrees.

## Artifacts and Evidence

New evidence lives under `reports/ugv-agent-profile-simulation/`. SMPP-owned southbound evidence remains in the sibling repository and is referenced by immutable hash/commit. Required reports preserve nullable missing identifiers with explanations and end with a frozen `SHA256SUMS.txt` plus cross-repository handoff.

## Outcomes and Retrospective

In progress for the cross-repository Goal. P0 contract freeze, P2-B01 local Profile/Card composition and the P2-B02 governed binding/adapter contract are implemented. Neither P2 task made an external simulator, Device MCP, MQTT, Provider, governed-control, or navigation call or granted side-effect authority. B02 deliberately stops before DSL/Planner/runtime wiring and persistence; B03 owns that integration, while P3 owns real external movement qualification.
