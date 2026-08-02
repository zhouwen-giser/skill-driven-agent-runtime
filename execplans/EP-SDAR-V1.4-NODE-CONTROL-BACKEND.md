# EP-SDAR-V1.4-NODE-CONTROL-BACKEND

## Purpose / Outcome

Implement the frozen SDAR v1.4 single-node control backend from the exact latest-main baseline. The
result is an independently deployable Node Control API and worker with its own PostgreSQL authority,
an internal desired/observed runtime-control boundary, durable configuration and capability
governance, and no second workflow runtime or telemetry-query authority.

## Requirements Covered

This plan covers the task package requirements assigned to P00 through P14 and the frozen acceptance
scenarios AC-V14-001 through AC-V14-010. The phase-to-requirement mapping is maintained in
`reports/v1.4-node-control/traceability.csv` and the task package matrix.

## Context and Orientation

- Baseline: `origin/main` at `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`.
- Product authority: the two v1.4 frozen ZIP inputs recorded in
  `reports/v1.4-node-control/baseline/source-lock.json`.
- Existing runtime authority remains in `packages/domain`, `packages/application`,
  `packages/persistence-postgres`, `packages/a2a-adapter`, and `apps/server`.
- The v1.4 control authority will be isolated in new Node Control packages and processes. It may
  request runtime application through a port but may not write runtime business tables.
- `apps/console` is outside this backend-only Goal.

## Architecture and Interfaces

Dependency direction is API/Worker -> Application -> Domain/Ports -> adapters. Domain packages do
not depend on Express, PostgreSQL clients, wire SDKs, or other adapters. PostgreSQL remains the sole
durable authority in each database; Redis/BullMQ is rebuildable wake/scheduling state. LangGraph.js
remains the only workflow execution runtime.

The planned packages and processes are calibrated in
`reports/v1.4-node-control/baseline/object-map.md` and
`reports/v1.4-node-control/baseline/symbol-map.md`. Public Node Control API 1.0.0, internal Runtime
Control 1.0.0, Node Events 1.0.0, and Telemetry Export 1.0.0 remain separate frozen contracts.

## Progress

- [x] 2026-08-02 00:13 +08:00 fetched and resolved latest `origin/main` to `a7a7c62`.
- [x] 2026-08-02 00:56 +08:00 preserved the first permission failure and the stale-volume collation
  failure, then started an isolated Compose project without deleting existing data.
- [x] 2026-08-02 01:01 +08:00 completed the exact-main `pnpm verify` baseline.
- [x] 2026-08-02 01:03 +08:00 validated the task package and both extracted frozen packages.
- [x] 2026-08-02 01:13 +08:00 P00: published baseline, source maps, Goal State, completion evidence,
  and handoff at remote evidence commit `c5ffbda`.
- [x] 2026-08-02 02:25 +08:00 P01: implementation `bf56489`, Evidence `ef93c26`, full verification,
  read-only review and remote reconciliation complete; P02 remains pending.
- [x] 2026-08-02 03:59 +08:00 P02: implementation `deaa555`, Evidence `9a283eb`, focused and full
  verification, real two-database integration, read-only review and remote reconciliation complete.
- [x] 2026-08-02 08:37 +08:00 P03 implementation and validation complete: Provider/Model Catalog,
  scoped Route/Fallback, Runtime Apply/Ack, immutable Task bindings and secret-safe audit semantics
  pass the full gate; implementation/evidence publication is in progress.
- [ ] P04: SMPP Registry federation.
- [ ] P05: MCP provider-binding governance.
- [ ] P06: capability definition and implementation-binding authority.
- [ ] P07: runtime capability readiness.
- [ ] P08: A2A exposure and Agent Card revision.
- [ ] P09: immutable Task capability binding and attempts.
- [ ] P10: Skill, Plan Template, and Artifact management adapters.
- [ ] P11: telemetry export only.
- [ ] P12: organization-facing node profile and events.
- [ ] P13: security, recovery, operations, and upgrade.
- [ ] P14: final integration, qualification, PR, checks, and protected merge.

## Discoveries and Surprises

- The latest main advanced to `a7a7c62` through externally merged PR #14 before P00 began.
- The repository Compose file has top-level name `sdar`; reusing its existing Debian-initialized data
  volume with the hardened Alpine PostgreSQL image causes PostgreSQL `XX000` on `template1` collation.
  P00 therefore uses a unique `COMPOSE_PROJECT_NAME` and preserves the existing volume.
- The full verifier writes its reports before calculating `dirty`; its isolated checkout summary
  reports `dirty=true` only because those gate-owned reports were created during the run.
- P01's first production smoke reached the Runtime build and exposed an Express declaration type
  portability error not detected by no-emit typecheck; an explicit public return type closed it.
- The second P01 smoke reused the default Runtime Compose name and encountered the preserved
  incompatible volume from P00. The P01 smoke now reserves ports and uses disposable, exact Control
  and Runtime Compose project names, cleaning only those projects.
- GitHub reports `main` as unprotected (REST 404). P14 still follows the task package's no-bypass,
  checks, review, and Merge Commit policy.
- P03's existing P10 latency assertions are deterministic only when their performance file runs
  outside the highly parallel Unit batch. The full gate now runs that unchanged 22-test file as an
  exclusive Unit sub-step and aggregates both Vitest result blocks.
- The first post-review P03 full gate exposed one stale E2E assertion for the old arbitrary upstream
  error code. That assertion terminated cleanup and caused seven serial cascade failures; after it
  was aligned to the stable redacted category, all 72 E2E tests passed.

## Decision Log

- 2026-08-02: Treat the user-authorized untracked v1.4 task package under `docs/` as immutable scoped
  input and commit it on the v1.4 branch.
- 2026-08-02: Use a detached isolated worktree for the pristine latest-main baseline so the authorized
  task package is not stashed, deleted, or moved.
- 2026-08-02: Use an isolated Compose project for real database verification; never destroy or reuse
  an unknown existing PostgreSQL data volume.
- 2026-08-02: Keep Control Plane and Runtime databases, migrations, APIs, and authority ledgers
  separate. Any proposed change to a frozen authority requires an ADR before implementation.
- 2026-08-02: P01 copies the already validated frozen API bundle byte-for-byte into
  `protocol/node-control/v1`; implementations consume it but do not modify frozen contract content.
- 2026-08-02: P01 implements only read projections and foundation bootstrap. Runtime configuration
  apply/ack/LKG semantics remain explicitly deferred to P02.
- 2026-08-02: P02 keeps Desired/Observed and application acknowledgements in Control PostgreSQL,
  while Active/LKG and immutable task pins live in Runtime PostgreSQL. The bridge is the frozen
  internal HTTP contract; neither side writes the other database.
- 2026-08-02: Runtime Watch carries hints only and Latest remains authoritative after disconnect or
  reordering. Target-specific appliers are deferred to their owning phases instead of representing a
  placeholder as production configuration application.
- 2026-08-02: P03 keeps Control-owned Provider/Route definitions secret-reference-only. Runtime
  continues to own credential resolution, clients, live health, route selection, invocations and
  fallback evidence; P03 must extend that authority rather than create a competing router.
- 2026-08-02: P03 applies Provider revisions with `reconnect_required` and Route revisions with
  `new_task_only`; Runtime pins exact Route and Provider revisions per Task/model stage so a new
  desired revision cannot mutate an in-flight Task.
- 2026-08-02: Runtime Apply replay is idempotent for an exact active configuration identity/checksum
  and fails closed for conflicting or stale replays. External transport/apply failures are reduced
  to explicit safe error-code allowlists before persistence or Ack.

## Implementation Steps

Execute P00 through P14 strictly in order. At every phase: fetch `origin/main`; merge it with
`--no-ff` if it advanced; update this plan; implement the bounded phase; run focused and mandated
gates; create an implementation commit; generate truthful evidence; create an evidence commit; push;
verify the remote SHA; and only then mark the phase complete in Goal State.

P14 re-fetches main, merges rather than rebases, runs the full release matrix from a clean exact
candidate checkout, opens the prescribed PR, waits for GitHub checks and review state, and uses an
explicit Merge Commit only when no protection or review blocker remains.

## Validation

P00 baseline command: `COMPOSE_PROJECT_NAME=sdar-v14-baseline-019fa7dc pnpm verify`.

Each phase runs the smallest affected unit/contract/integration/E2E tests plus architecture and
contract gates. Each milestone runs the repository implementation gate. P14 runs the full frozen
matrix including format, lint, typecheck, unit, contract, real PostgreSQL/Redis integration, E2E,
migrations, architecture, management OpenAPI, A2A baseline/TCK, build, smoke, and `pnpm verify`.

## Idempotence and Recovery

Goal recovery starts from `reports/v1.4-node-control/goal-state.json`, verifies the remote branch by
fast-forward only, reruns the last completed phase's key gate, and resumes from the first pending
phase. Published branch history is never rebased. Configuration and definition revisions are
immutable; idempotency keys and expected revisions protect commands; failed revisions never replace
active/LKG snapshots.

## Artifacts and Evidence

- Baseline and source maps: `reports/v1.4-node-control/baseline/`.
- Per-phase completion/handoff: `reports/v1.4-node-control/phases/`.
- Retained failed attempts: `reports/v1.4-node-control/failed-attempts/`.
- Machine-resumable state: `reports/v1.4-node-control/goal-state.json`.
- Repository-wide requirements: `docs/17_TRACEABILITY_MATRIX.md`.
- Status and release narrative: `PROJECT_STATUS.md` and `CHANGELOG.md`.

## Outcomes and Retrospective

P00 through P02 are complete and remotely evidenced. P03 implements bounded LLM Provider, Model
Catalog and scoped Route governance over the P02 apply/ack boundary, while preserving Runtime-owned
credentials, clients, selection, fallback and immutable Task bindings. Its final full gate passes
1140 Unit/Contract, 135 real Integration and 72 E2E tests with 29 Runtime migrations and all process
smokes; the final read-only review closes at 0 Blocking / 0 Major / 0 Minor. P04 and later behavior
are not claimed.
