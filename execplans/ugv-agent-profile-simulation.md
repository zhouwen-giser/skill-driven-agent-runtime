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
- The sibling SMPP baseline is the user-selected latest relevant branch `codex/goal-ugv-runtime-telemetry-joint-integration@ce57d3d7ac2f99c0c95fa61bd9746abe862ed507`, not a forced checkout of the package reference.

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
- [ ] Complete `UAP-P1-B01` through `UAP-P2-B03`: qualify SMPP, add the governed Task Binding, DSL/evidence gates, and remaining tests.
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

## Decision Log

- 2026-08-21: Honor the user override by using the latest relevant SMPP branch at `ce57d3d7`, retaining `f8c37e6` only as a drift reference.
- 2026-08-21: Reuse existing semantic owners and add only a Profile/binding adapter or policy projection where the current runtime lacks one; no second registry, workflow runtime, remote-task state machine, or evidence authority.
- 2026-08-21: Treat old reports as historical reuse evidence. New Goal reports use `evidenceClass=external_simulation`, `productionEligible=false`, and never rewrite historical failures.
- 2026-08-21: Do not authorize navigation until the package safety switches, exact target, fresh state, no active/uncertain task, confirmed exact plan, current readiness, and unused run/idempotency identity all pass.
- 2026-08-21: Profile version semantics are exact: only immutable `embodied.move_to@1` is public/selectable. A disable/enable lifecycle-derived version does not silently replace it; exact v1 unavailability disables the Profile.
- 2026-08-21: Mock Device MCP contract fallback remains false because the real external `tools/list` satisfies the point-navigation prerequisites.
- 2026-08-21: All Profile consumers share one read-only projection of PostgreSQL-authoritative enabled Skills. The projection admits only exact `embodied.move_to@1`, while an empty projection remains valid so the normal disable/catalog-rebuild path produces an empty Card instead of preventing startup.
- 2026-08-21: Use the Profile-specific generation policy `capability-policy-v1:ugv-agent-profile-v1` and Card identity `ugv-agent-profile`; this prevents a same-catalog generic Card from being reused under a different deployment identity.
- 2026-08-21: Keep the P0 Skill Package checksum as offline provisioning/freeze corroboration. Runtime Card authority is the current enabled PostgreSQL SkillVersion plus exact source ref `embodied.move_to:1`; neither Card publication nor active-Card reads claim to revalidate the package checksum.
- 2026-08-21: Add `CapabilityCardPublisher.requireCurrentCatalogOnRead` as an opt-in compatibility guard and enable it only for `ugv-agent-profile`. Other Agent Cards retain their existing read behavior, satisfying the no-unrelated-Card constraint.

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

## Idempotence and Recovery

Read-only probes are bounded and exact-topic only. Every write run has a unique A2A idempotency key and one unused simulation run ID. An ambiguous navigation admission or transport failure triggers Provider reconciliation and blocks redispatch. Continuation resumes the persisted frontier and never invokes `START`. Cleanup may remove only Goal-owned containers/volumes and must not touch the external simulator or unrelated worktrees.

## Artifacts and Evidence

New evidence lives under `reports/ugv-agent-profile-simulation/`. SMPP-owned southbound evidence remains in the sibling repository and is referenced by immutable hash/commit. Required reports preserve nullable missing identifiers with explanations and end with a frozen `SHA256SUMS.txt` plus cross-repository handoff.

## Outcomes and Retrospective

In progress for the cross-repository Goal. P0 contract freeze and P2-B01 local Profile/Card composition are complete. P2-B01 made no external simulator, Device MCP, MQTT, Provider, governed-control, or navigation call and grants no side-effect authority. Its evidence is the Goal-mandated external-simulation class but explicitly limited to deterministic/local PostgreSQL Runtime observation; P3 owns external movement qualification.
