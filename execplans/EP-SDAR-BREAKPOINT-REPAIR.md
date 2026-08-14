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
- [x] 2026-08-13 completed P05 remote/in-flight recovery: pre-dispatch admission journal, atomic
      receipt/invocation/continuation checkpoint, no-replay uncertainty, hierarchy re-entry,
      terminal CapabilityAttempt closure, failed Redis wake reconstruction, and exact Runtime/SMPP
      Provider polling authority. Real PostgreSQL recovery passed 2/2, isolated Redis recovery
      passed 7/7, and `physicalDeviceWrites=0`. Exit: `REMOTE_IN_FLIGHT_RECOVERY_PASSED`.
- [x] 2026-08-14 completed P06 aggregate verification/performance. The official `pnpm verify` at
      `aa4231d2` passed all ten stages in 918423 ms; Phase 13 passed unchanged limits with
      `-10.596%` Runtime P95 regression, `6.833%` baseline drift, and `4.402 ms` append P95.
      Generated evidence is committed at `9ab42ac`; `physicalDeviceWrites=0`.
- [x] 2026-08-14 completed P07 read-only SMPP and Console regression. The isolated
      PostgreSQL-backed SMPP controlled consumer passed 1/1, and the candidate-built production
      Runtime/Node Control/Console BFF journey passed 98/98 assertions across pause/resume, Goal
      Patch, stale-revision rejection, idempotent cancel replay, and A2A/BFF/Console terminal
      convergence. `physicalDeviceWrites=0`; `fireCalls=0`. Exit:
      `CROSS_PROJECT_REGRESSION_PASSED`.
- [x] 2026-08-14 closed the pre-P08 durable Task revision/reconciliation review. Runtime
      revision-authority PostgreSQL passed 10/10, Runtime management contracts passed 79/79, Node
      Control Task-control unit tests passed 22/22, Node Control API contracts passed 6/6, and Node
      Control PostgreSQL foundation passed 15/15. Current-tree TypeScript, lint, format, and diff
      hygiene checks are green. This is focused implementation-closure evidence, not P08.
- [x] 2026-08-14 completed P08 release qualification from a clean worktree at
      `9841e6527330920d44f19c68214988b56db3c6eb`. All twelve required commands passed. The final
      `pnpm verify` passed 10/10 stages in 948706 ms with bootstrap 272 files/1965 tests, 55
      migrations, integration 36 files/215 tests, E2E 7 files/73 tests, A2A TCK 74 passed/161
      skipped/100% applicable coverage, and Phase 12 Evidence 44/44. Exit:
      `RELEASE_QUALIFICATION_PASSED`.
- [x] 2026-08-14 completed P09 latest-main synchronization and exact-candidate qualification. A
      fresh fetch resolved live `origin/main` to `b7f02d`; `git merge --no-ff origin/main` reported
      `Already up to date`. At tested SHA `c2622c`, all twelve required commands passed and final
      `pnpm verify` passed 10/10 stages in 1000343 ms. `physicalDeviceWrites=0`; `fireCalls=0`.
- [ ] Complete P09 publication: final evidence/document commit, push, remote/local SHA equality,
      and creation and inspection of the required non-Draft PR.

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
- Historical aggregate and performance failures remain immutable diagnostic evidence. The current
  checked-in authority passes all ten stages and the unchanged Phase 13 thresholds; no percentile,
  sample count, baseline-drift limit, Runtime-regression limit, or estimand was weakened.
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
- P05 required a journal before Provider transport and an atomic receipt/invocation/continuation
  commit after it. A crash before that commit is explicit uncertainty with no replay; a crash after
  it reconstructs the same remote binding and Workflow wait. Redis failed jobs are wake records,
  not dead-letter outcome authority.
- Long-running `tasks/get` must retain the admitted remote Provider identity, not merely its local
  endpoint and Catalog. The frozen authority now includes Binding origin, external Server, and SMPP
  source lineage while allowing a normal readiness revision refresh with stable identity.
- The earlier P03 PostgreSQL 75/75 run predates the final keyset-pagination refinement. The final
  aggregate candidate subsequently passed the exact-tree PostgreSQL/Redis integration gate at
  35 files / 201 tests, so the earlier qualification gap is no longer pending.
- Every public Task command needs a durable revision claim, including callers that omit
  `expectedRevision`; an in-memory preflight cannot fence a queued writer after its lease is lost.
  The repair now binds action/lease identity, actual revision, and pre-dispatch state and treats
  dispatch/completion ambiguity as reconciliation-pending.
- The `aa4231d2` full gate and `9ab42ac` evidence commit predate the final revision-fence changes and
  remain historical P06 evidence. Current P08 qualification instead comes from the clean-start run
  at `9841e652`: all twelve exact commands and the final aggregate verifier passed.
- The current verification summary reports `dirty=true` because the verifier writes its managed
  evidence after the clean-start check and before sampling Git status. This is a post-start evidence
  effect, not permission to begin a release gate from a dirty worktree.
- Fresh P09 synchronization did not require a merge commit: live `origin/main` remained `b7f02d`,
  and the required no-rebase merge reported `Already up to date`. The synchronized candidate at
  `c2622c` independently passed 12/12 commands and final verify 10/10; the older `9841e652` run
  remains historical P08 evidence.

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
- 2026-08-13: Close P05 as `FIXED` only after the pre-dispatch journal, atomic remote receipt,
  continuation activation order, hierarchy re-entry, failed-wake reconstruction, terminal attempt
  closure, and stale polling authority all passed focused real persistence gates and independent
  review. Never replay an external creation call whose durable receipt is absent.
- 2026-08-14: Close the revision-fence review only after omitted- and explicit-revision commands
  share a durable action/lease claim, stale owners and queued writers fail closed, and ambiguous
  Runtime/outer-operation completion remains reconciliation-pending. Keep this focused evidence
  separate from the repository release sequence.
- 2026-08-14: Issue `RELEASE_QUALIFICATION_PASSED` only after all twelve exact P08 commands passed
  from clean preflight SHA `9841e652`, including the standalone 5391-file zero-finding secret scan,
  current integration/E2E suites, unchanged Phase 13 gates, build, and final 10/10 aggregate verify.
  Keep protected-review readiness pending through P09 qualification and publication.
- 2026-08-14: Close P09 qualification only after a fresh fetch/no-rebase merge check and an
  independent 12/12 rerun at `c2622c`, including final `pnpm verify` 10/10 in 1000343 ms. Do not
  treat the tested SHA as the final PR head until publication commit, push equality, and PR
  inspection are complete. P09 standalone security scanned 5396 files with zero findings, and
  Phase 13 passed with baseline P95 536.321 ms, enabled P95 529.503 ms, -1.271% regression,
  10.355% baseline median drift, 5.339 ms append P95, 1736 received records, and physical side
  effects disabled.

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
pnpm verify:smpp-registry-projection
pnpm verify:v14-security
pnpm test:node-control
pnpm test:integration
pnpm test:contract
pnpm test:e2e
pnpm build
pnpm verify
```

The exact P08 command list above passed from clean preflight SHA `9841e652`. Standalone evidence was:
format/lint/typecheck PASS; Node Control contract 77 files/29 schemas/131 operations/20 events/7
fixtures; SMPP projection 10 vectors; v1.4 security 5391 files/0 findings plus licenses; Node Control
36 files/194 tests; integration 35 files/214 tests plus isolated PostgreSQL 1/1; contract 47
files/303 tests; E2E 6 files/72 passed/1 skipped plus Phase 13 1/1; build PASS; and final
`pnpm verify` 10/10 in 948706 ms.

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

P01-P03 are functionally closed and committed, and BP-SDAR-001 through BP-SDAR-003 are
`FIXED`. Current shared evidence is: full TypeScript PASS; combined focused Vitest 9 files/108 tests; P01
isolated PostgreSQL 76/76; combined P01/P02 Node Control foundation PostgreSQL 14/14; P02 contract 41
files/281 tests plus 131-operation/455-RBAC conformance; and P03 PostgreSQL 75/75 on the pre-keyset
revision plus focused reconciler tests. The P03-stage foundation regression was 11/11 before later
P01/P02 cancellation changes. P04 is `FIXED`: trusted-human management/authority tests passed
150/150, UGV regressions passed 19/19, the PostgreSQL plus loopback Provider positive/restart suite
passed 2/2, and ungoverned A2A regressions passed 8/8. It proves exactly one governed Provider
dispatch with terminal `position.observation` evidence and zero transport for ungoverned controls;
`physicalDeviceWrites=0`. P05 is `FIXED`: current focused recovery/authority gates passed 123/123
and 69/69, real PostgreSQL recovery passed 2/2, isolated Redis failed-wake reconstruction passed
7/7, and migrations passed through 0160. A single monolithic Runtime A-to-B drill remains
transparently `NOT RUN`; the same boundaries were exercised separately and two independent final
audits found no remaining P05 P0/P1. P06 and BP-SDAR-006 are now `FIXED`: the official full gate
passed 10/10 stages and unchanged Phase 13 performance limits at `aa4231d2`; this remains historical
P06 evidence. P07 and BP-SDAR-007 are `FIXED`: the controlled SMPP
database-backed consumer passed 1/1 and the live candidate-built Console nonterminal journey passed
98/98 assertions with terminal convergence and zero physical writes or fire calls. The durable
revision-fence review is `CLOSED/CLEAN` with Runtime PostgreSQL 10/10, Runtime contracts 79/79, Node
Control unit 22/22, API contract 6/6, and PostgreSQL foundation 15/15; current-tree TypeScript, lint,
format, and diff hygiene are green. P08 is `COMPLETE`: all twelve exact commands passed from clean
preflight SHA `9841e652`, final verify passed 10/10 in 948706 ms, and current Phase 13 recorded
baseline P95 445.599 ms, enabled P95 453.681 ms, +1.814% regression, 6.786% median drift, and
5.043 ms append P95 with physical Provider disabled. P09 synchronization and qualification are also
complete: live Main remained `b7f02d`, the required merge was already up to date, and tested SHA
`c2622c` passed 12/12 plus final verify 10/10 in 1000343 ms. Publication commit, push equality, and
the non-Draft PR remain pending. Its standalone security run scanned 5396 files with zero findings;
final Phase 13 recorded baseline P95 536.321 ms, enabled P95 529.503 ms, -1.271% regression,
10.355% baseline median drift, 5.339 ms append P95, 1736 received records, and physical side effects
disabled. The older P08 5391-file scan and 445.599 ms baseline remain historical P08 evidence.
`RELEASE_QUALIFICATION_PASSED` is issued; no final PR head SHA or protected-review readiness is
claimed.
