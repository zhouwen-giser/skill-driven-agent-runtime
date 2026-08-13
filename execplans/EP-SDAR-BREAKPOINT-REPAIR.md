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
- [ ] Complete P01 Node Control Task Control.
- [ ] Complete P02 public operation implementation conformance.
- [ ] Complete P03 A2A terminal convergence.
- [ ] Complete P04 governed physical-control safety.
- [ ] Complete P05 in-flight recovery.
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

## Decision Log

- 2026-08-13: Treat the task package's observed SHA only as informational. The fetched
  `origin/main` SHA is authoritative.
- 2026-08-13: Keep all physical-device and fire gates closed. P04/P05 use deterministic providers
  and persistence-backed tests only.
- 2026-08-13: Preserve Runtime PostgreSQL authority. Node Control/A2A changes must be projections or
  commands through application ports, never direct cross-authority SQL.
- 2026-08-13: Preserve historical aggregate/performance failures as immutable attempts; no threshold,
  percentile, sample, or schema weakening is permitted.

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

In progress. This section will record the exact candidate, passed gates, breakpoint dispositions,
remaining external blockers, and protected-review handoff after P09.
