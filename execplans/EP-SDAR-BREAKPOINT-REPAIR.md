# SDAR Breakpoint Repair ExecPlan

## Purpose / Outcome

Close the SDAR-owned authority mismatches recorded by the
`SDAR_Breakpoint_修复_Codex_Goal_任务包_V1.0` package. The observable outcome is a clean
`fix/sdar-breakpoint-repair` candidate, based on execution-time `origin/main`, whose Node Control
Task commands are real governed HTTP operations, whose public operation inventory cannot drift
from the production router/RBAC/contract suite, whose durable A2A projection converges from Runtime
Task authority, and whose governed control and remote recovery paths fail closed without duplicate
side effects. The candidate must pass the unchanged repository release and performance gates and be
published as a non-Draft PR to `main`; this plan never merges, tags, releases, deploys, or performs a
real physical write.

## Requirements Covered

- BP-SDAR-001: pause, resume, cancel, and Task Goal patch through Runtime authority.
- BP-SDAR-002: declared -> OpenAPI -> production route -> RBAC -> contract-test conformance.
- BP-SDAR-003: Runtime terminal -> durable A2A terminal convergence, including restart recovery.
- BP-SDAR-004: explicit governed physical-control authority; no discovery-derived authority and no
  `vehicle_fire_weapon` Capability, Skill, or execution authority.
- BP-SDAR-005: waiting-external and remote Task recovery without duplicate local or physical effects.
- BP-SDAR-006: current `pnpm verify` and unchanged Phase 13 performance thresholds.
- BP-SDAR-007: regression-only verification of credential-free SMPP and explicitly acknowledged
  RFC1918 private HTTP when confirmed on current Main.
- P00 through P09 exit criteria in the supplied task package.

## Context and Orientation

Runtime PostgreSQL is the Task lifecycle authority. Node Control is a management facade and must
invoke an application/Runtime port rather than write Runtime tables. A2A Task state is a projection
of Runtime Task state, not another state machine. Capability Definition belongs to Node Control;
Capability readiness and Task admission belong to Runtime. Remote MCP Task state belongs to the
Provider Runtime. Evidence and telemetry cannot mutate Task authority.

The execution-time baseline is `b7f02dcedc9680758e7e5f779a939a738d8de770`, version `1.4.1`,
created by merging PR #20. The repair branch was created from that exact `origin/main` and pushed
before implementation. SMPP and `sdar-organization-control-plane` are read-only SUTs.

## Architecture and Interfaces

- Node Control public operations remain defined by the frozen protocol and Management OpenAPI.
- Task commands enter through `apps/node-control-api`, pass authenticated/RBAC-controlled route
  composition, then use a protocol-neutral application port to reach Runtime Task authority.
- Public operation conformance will use explicit production metadata rather than source-text regexes.
- Runtime terminal events and restart reconciliation write A2A projection through the existing A2A
  persistence boundary, preserving monotonic terminal state.
- Governed control admission requires exact Capability/Skill/Plan/binding/risk/confirmation/readiness
  authority. MCP Catalog discovery is evidence only and grants no execution permission.
- Recovery treats Redis as wake-only and PostgreSQL as authoritative. Uncertain remote side effects
  reconcile or terminate explicitly; they are never blindly replayed.

## Progress

- [x] 2026-08-13 09:20 +08:00 validated and extracted the task package; read all P00-P09 rules.
- [x] 2026-08-13 09:20 +08:00 fetched `origin`, fast-forwarded `main` to `b7f02dc`, created and
      pushed `fix/sdar-breakpoint-repair`.
- [x] 2026-08-13 09:21 +08:00 verified frozen install; `pnpm typecheck`,
      `pnpm verify:node-control-contract` (131 operations), and `pnpm test:node-control`
      (33 files / 158 tests) passed.
- [x] 2026-08-13 09:45 +08:00 reproduced and classified BP-SDAR-001 through
      BP-SDAR-007; published the P00 source lock, baseline report, and breakpoint matrix.
- [x] 2026-08-13 completed P01 Node Control Task Control: four public/internal commands, durable
      replay/conflict/restart semantics, Runtime authority delegation, 9-file/108-test combined
      focused gate, isolated Runtime PostgreSQL 76/76, and combined P01/P02 Node Control foundation
      PostgreSQL 14/14.
- [x] 2026-08-13 completed P02 public operation implementation conformance: contract suite 41
      files/281 tests and production gate for 131 operations, 455 RBAC decisions, and 131 covered
      operation IDs.
- [x] 2026-08-13 completed P03 A2A terminal convergence: authoritative save canonicalization,
      monotonic PostgreSQL projection, startup/periodic reconciliation, PostgreSQL 75/75, and
      focused reconciler tests. A fresh Node Control foundation regression passed 11/11 at the P03
      stage before the later cancellation-authority additions; it is not A2A behavior evidence.
- [x] 2026-08-13 completed P04 governed physical-control authority: production trusted-human
      issue/revoke, exact one-dispatch confirmation consumption, compatible UGV policy, PostgreSQL
      plus loopback Provider positive chain 2/2, ungoverned A2A rejection 8/8, and
      `physicalDeviceWrites=0`. Exit: `GOVERNED_CONTROL_AUTHORITY_PASSED`.
- [ ] P05 partially implemented: cancel uncertainty, continuation reclaim, TTL, and explicit remote
      failure are repaired, while remote creation-to-admission and complete callback idempotence
      remain blocked.
- [ ] Complete P06 aggregate verification/performance.
- [ ] Complete P07 read-only SMPP and Console regression.
- [ ] Complete P08 release qualification.
- [ ] Complete P09 latest-main merge, exact-candidate rerun, evidence, push, and non-Draft PR.

## Discoveries and Surprises

- The current frozen Node Control package contains 131 operations rather than the historical 94.
  Existing frozen-contract verification and 158 focused tests pass; that does not by itself prove
  production route/RBAC/test implementation conformance.
- Execution-time Main already contains PR #20. BP-SDAR-007 must therefore remain regression-only
  unless current-source inspection contradicts the merged contract.
- Four frozen Task command routes are absent from the production Node Control and Runtime routers;
  the current 131-operation verifier validates frozen files rather than production registrations.
- A2A `getTask` can overlay Runtime terminal authority without repairing the durable projection;
  `listTasks` remains stale and an unconditional upsert permits terminal-to-WORKING regression.
- The latest checked-in aggregate and performance authority is failed. It is baseline evidence only,
  never candidate evidence or permission to change Phase 13 thresholds or the estimand.
- P01 required two durable, complementary idempotency boundaries: Node Control persists the public
  governance operation and audit, while Runtime's existing Cognitive Management Action gate fences
  the authoritative Task mutation. A recovered uncertain dispatch is rejected instead of replayed.
- The production conformance gate proves route, authentication/RBAC, and declared contract coverage;
  it does not prove every business mutation. Capability Catalog stage/activate routes are registered
  and service-authenticated but correctly return
  `503 RUNTIME_CAPABILITY_CATALOG_CONTROL_UNAVAILABLE` because no Runtime catalog control authority
  is composed.
- Durable A2A convergence required three cooperating safeguards: canonicalize saves from Runtime
  Task authority, reject terminal regression in PostgreSQL, and reconcile existing projections on
  startup and a bounded periodic schedule.
- P04 required both directions of proof: ungoverned discovery/Plan paths fail before Provider
  transport, while an exact trusted-human authority reaches one loopback Provider dispatch and
  durable `position.observation` terminal evidence. A second dispatch is rejected before transport.
- P05 can fence known cancel and continuation replay windows, but the remote Task may be created
  before SDAR durably learns its identity. Replaying that call would risk a duplicate external side
  effect, so this gap remains explicit rather than being hidden behind a retry.
- The P03 PostgreSQL 75/75 run predates the final keyset-pagination refinement. Unit and TypeScript
  coverage passed for that refinement; exact-final PostgreSQL evidence remains pending an isolated
  database environment.

## Decision Log

- 2026-08-13: Treat the task package's observed SHA only as informational. The fetched
  `origin/main` SHA is authoritative.
- 2026-08-13: Keep all physical-device and fire gates closed. P04/P05 use deterministic providers
  and persistence-backed tests only.
- 2026-08-13: Preserve Runtime PostgreSQL authority. Node Control/A2A changes must be projections or
  commands through application ports, never direct cross-authority SQL.
- 2026-08-13: Preserve historical aggregate/performance failures as immutable attempts; no threshold,
  percentile, sample, or schema weakening is permitted.
- 2026-08-13: Reuse Runtime `TaskService.cancel()`/`followUp()` and the PostgreSQL-backed Cognitive
  Management Action gate. Do not create a second Task phase or Plan authority in Node Control.
- 2026-08-13: Treat public operation conformance as route/auth/coverage evidence only. A registered
  fail-closed `503` handler is not evidence that Catalog staging or activation is functionally
  composed.
- 2026-08-13: Reconcile only existing `a2a-v1` projections from Runtime terminal authority. Do not
  let the repair admit new A2A Tasks or make A2A an independent state machine.
- 2026-08-13: Close P04 as `FIXED` only after the production management boundary derived the human
  actor and exact authority scope server-side, confirmation consumption became one-dispatch, and a
  PostgreSQL/loopback Provider positive chain proved terminal evidence. Do not trust actor/scope
  fields from request bodies or reuse artifact-approval authority.
- 2026-08-13: Keep P05 at `PARTIALLY_FIXED`. Never replay an external creation call when its result
  may exist but its local admission identity was not durably captured.

## Implementation Steps

1. P00: inventory the current operations and each breakpoint, capture first failures, and publish
   `reports/sdar-breakpoint-repair/P00-baseline.md`, `source-lock.json`, and
   `breakpoint-matrix.json`.
2. P01: add the four Task command routes and governed application handoff, with actor/reason,
   idempotency, controlled-action recheck, ManagementOperation, audit, stable Problem Details, and
   restart-safe command outcomes.
3. P02: establish a production route registry and verifier that compares every public operation to
   frozen inventory, OpenAPI, RBAC, and explicit contract-test coverage. Wire the verifier into the
   Node Control and full release gates.
4. P03: reproduce each terminal path in PostgreSQL, repair notifier/projection/reconciliation gaps,
   and prove monotonic convergence across notification loss and restart.
5. P04: add security regressions for ungoverned control, stale authority, untrusted confirmation,
   and `vehicle_fire_weapon`; implement only the minimum general hard-deny/authority repair needed.
6. P05: cover waiting-external, remote terminal/cancel uncertainty, duplicate continuation/poll,
   and restart/LKG boundaries with deterministic Provider Runtime behavior.
7. P06-P08: execute the aggregate, performance, cross-repository read-only, adversarial, build,
   integration, E2E, and release gates on clean candidates, preserving raw failures.
8. P09: fetch and merge latest Main without rebase, rerun P08 plus `pnpm verify`, publish final
   evidence, verify local/remote SHA equality, and create a non-Draft PR to `main`.

## Validation

Phase-local tests run first. Required final commands include:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm verify:node-control-contract
pnpm verify:node-control-implementation-conformance
pnpm verify:smpp-registry-projection
pnpm verify:v14-security
pnpm test:node-control
pnpm test:integration
pnpm test:contract
pnpm test:e2e
pnpm build
pnpm verify
git diff --check
```

P07 uses fetched SMPP and Console Main checkouts read-only. Any external defect becomes an `EXT-*`
report and is not patched here.

## Idempotence and Recovery

All test data uses isolated schemas/databases or deterministic in-memory providers as appropriate.
Repeated Task commands and reconciliation must be idempotent; conflicts are explicit. If a phase
fails, preserve the first failure, leave the branch recoverable, update this plan, and resume from the
failed phase. Never stash, reset, clean user work, rebase the pushed branch, or force-push.

## Artifacts and Evidence

All new evidence belongs under `reports/sdar-breakpoint-repair/`, including phase reports, immutable
failed attempts, source locks, operation conformance, A2A convergence, recovery, performance raw
data, cross-project regression, final acceptance, and PR body. Reports must identify exact SHAs and
separate real, deterministic, static, external, and unverified evidence.

## Outcomes and Retrospective

P01-P03 are functionally closed and committed locally, and BP-SDAR-001 through BP-SDAR-003 are
`FIXED`. Current shared evidence is: full TypeScript PASS; combined focused Vitest 9 files/108 tests; P01
isolated PostgreSQL 76/76; combined P01/P02 Node Control foundation PostgreSQL 14/14; P02 contract 41
files/281 tests plus 131-operation/455-RBAC conformance; and P03 PostgreSQL 75/75 on the pre-keyset
revision plus focused reconciler tests. The P03-stage foundation regression was 11/11 before later
P01/P02 cancellation changes. P04 is `FIXED`: trusted-human management/authority tests passed
150/150, UGV regressions passed 19/19, the PostgreSQL plus loopback Provider positive/restart suite
passed 2/2, and ungoverned A2A regressions passed 8/8. It proves exactly one governed Provider
dispatch with terminal `position.observation` evidence and zero transport for ungoverned controls;
`physicalDeviceWrites=0`. P05 has bounded uncertainty/reclaim repairs (56/56 focused tests) but
remains `PARTIALLY_FIXED` for its documented blockers. The exact-final P03 PostgreSQL tree remains
unexecuted in the current environment. P05-P09 are not complete, and no final candidate or
protected-review readiness is claimed.
