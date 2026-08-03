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
- [x] 2026-08-02 08:43 +08:00 P03 complete: implementation `21c7a37`, Evidence `5980243`, remote
  SHA reconciliation, Provider/Model Catalog, scoped Route/Fallback, Runtime Apply/Ack, immutable
  Task bindings, secret-safe audit, full verification and read-only review are closed.
- [x] 2026-08-02 10:20 +08:00 P04 complete: implementation `11d13d0`, Evidence `7c9b733`, remote
  reconciliation, multi-source identity, immutable Snapshot/LKG, Latest/ETag refresh, outage
  isolation, full verification and repeated read-only review are closed.
- [x] 2026-08-02 17:31 +08:00 P05 complete: implementation `f409911`, Evidence `526155f`, remote
  reconciliation, real Discover/Tools Catalog, drift/freshness gates, terminal lifecycle safety,
  Remote Task retention, full verification and three read-only review passes are closed.
- [x] 2026-08-02 18:50 +08:00 P06 complete: implementation `f5be34f`, Evidence `f7692d0`, canonical Capability
  promises, exact Skill/Plan Template bindings, publication gates, ETag/idempotency, full
  verification and three read-only review passes are closed; remote reconciliation is complete.
- [x] 2026-08-02 22:41 +08:00 P07 complete: implementation `be9d01d`, Runtime-only immutable
  readiness snapshots, exact dependency/hash evidence, TTL expiry, stability window, authenticated
  recomputation, Outbox and restart recovery pass focused and full verification; final review is
  0 Blocking / 0 Major / 0 Minor.
- [x] 2026-08-03 00:15 +08:00 P08 complete: implementation `c76a4d0`, exact Capability Exposure,
  public/readiness filtering, deterministic Agent Card deployment, Active/LKG rollback, official
  A2A MUST TCK and full verification; final review is 0 Blocking / 0 Major / 0 Minor.
- [x] 2026-08-03 01:56 +08:00 P09 complete: implementation `39298c3`, immutable exact
  Capability/Exposure/Input/criteria/evidence/constraint/Provider-policy Binding, atomic Task
  acceptance, append-only replan/replacement/provider-failover/recovery attempts, terminal guard,
  full verification and final review 0 Blocking / 0 Major / 0 Minor.
- [x] 2026-08-03 06:23 +08:00 P10 complete: frozen
  public/internal Skill and Plan Template routes, distinct RuntimeServiceAuth identity mapping,
  Runtime HTTP adapter, exact Skill governance CAS/import recovery, Control operation/audit-only
  persistence, migrations 0140/0141, and real Control -> Runtime -> P02/P06 PostgreSQL/Outbox
  evidence pass. Independent read-only reviews close 1 Blocking and 5 Major findings; full verify
  passes with 952 Unit/performance, 218 Contract, 143 Integration and 72 E2E tests; implementation
  `9e53ebb` and Evidence `b75d1b1` are published to the phase branch.
- [x] 2026-08-03 08:17 +08:00 P11 complete: implementation `7f631fd`, frozen output-only
  Telemetry Export routes, P02-backed Control revisions/Operation/Audit, Runtime Active/LKG,
  durable outbox/retry/ACK/status, HTTPS SecretRef transport and real outage isolation pass. The
  final exact-commit gate passes 956 Unit/performance, 219 Contract, 146 Integration and 72 E2E
  tests; read-only Review closes 2 Major findings at 0 Blocking / 0 Major / 0 Minor.
- [x] 2026-08-03 11:04 +08:00 P12 complete: implementation `7eb5b83`, immutable Node Profile
  governance, separate organization read RBAC, durable hint-only 20-event stream, Runtime
  readiness/Task-binding bridge and safe TaskSummary reads pass. Exact-commit full verify passes
  959 Unit/performance, 220 Contract, 149 Integration and 72 E2E tests; final Review closes 3 Major
  and 2 Minor findings at 0 Blocking / 0 Major / 0 Minor.
- [x] 2026-08-03 13:00 +08:00 P13 complete: implementation `ee64870`, clean candidate `ec10587`,
  exact role/tenant RBAC, ingress/egress hardening, SecretRef preservation, real backup/restore,
  credential rotation, restart and Control-outage drills pass. Exact clean full verify passes 960
  Unit/performance, 220 Contract, 149 Integration and 72 E2E tests; final Review is 0 Blocking / 0
  Major / 0 Minor after two Major repairs.
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
- P05 independent review found terminal reactivation, repeated-drift approval, concurrent local
  Server identity, redirect SSRF and weak Remote Task evidence gaps. All were closed without moving
  Runtime authority into Control. The first full gate then correctly rejected the cross-authority
  test's package placement; moving it to a neutral acceptance app preserved the architecture rule.
- P10's first migration-path run correctly rejected migration 0140 because its initial draft did not
  write the repository's formal `schema_migration` marker. Adding the standard transaction and
  up/down ledger changes closed the failure; the full migration path then passed through 0140.
- P10's first PostgreSQL focused run exposed globally reused fixture hashes, followed by stale
  fixed idempotency keys from the retained immutable command ledger. Binding both values to each
  random test Skill preserved the production constraints and made reruns truthful.
- P10's first real Plan Template activation exposed a pre-existing management projection defect:
  PostgreSQL `Date` values were traversed as empty objects by generic redaction. Preserving them as
  ISO timestamps restored the existing query contract and is covered by unit and vertical tests.
- P10 review found that using the Runtime service bearer directly with the separately configured
  Artifact principal resolver made distinct valid credentials fail. RuntimeServiceAuth now maps
  through its own resolver to the same existing Artifact operator identity, without weakening
  either transport authentication or Artifact authorization.
- P11's first exact full gate exposed a real HTTP-receipt/durable-ACK observation race. Waiting for
  the authoritative status, rather than weakening the ACK assertion, made the test deterministic.
- P11 full-gate reruns exposed two older serial-suite isolation assumptions: Control tests replaced
  the single Node identity and a candidate test retained an active Capability Summary. The owning
  tests now preserve the NodeProfile and clear only their own authority state.
- P11 Review found that newest Revision was not synonymous with Active and that a near-full Outbox
  could overshoot its configured high watermark. Both were repaired with applied-only selection,
  remaining-capacity capture and real regressions before the final full gate.
- P12's default local Redis port was already owned by an authorized retained stack. Reusing that
  Redis while the repository harness created separate Runtime and Control test databases preserved
  all existing state and produced 149 passing integrations.
- P12's first exact full gate passed all code tests but the final infrastructure smoke read
  `SDAR_POSTGRES_URL`, not `SDAR_TEST_POSTGRES_URL`, and reached an unrelated service on port 55432.
  Supplying both variables to the isolated 55483 instance closed `28P01`; the clean rerun passed all
  smokes.
- P13's first clean-worktree gate exposed that four frozen CSV matrices were stored as normalized LF
  blobs while their MANIFEST locked the original CRLF bytes. Exact `-text` attributes and re-indexing
  restored reproducibility without changing a frozen byte.
- One P13 full-gate recovery smoke observed Healthy disposable containers whose Windows host ports
  were transiently unreachable. The immediate same-SHA recovery rerun and two later full smoke runs
  passed; the failure remains recorded and no timeout/assertion was weakened.

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
- 2026-08-02: P04 models SMPP only as a Provider candidate directory. Snapshot entries preserve
  Registry revision/checksum/ETag/expiry plus Catalog revision, while P05 owns approval/import and
  live Discover/Tools plus Availability remain their frozen authorities.
- 2026-08-02: P04 Source revisions activate atomically after an authoritative Latest response. A
  failed newer draft cannot hide the previous active Source/LKG, and scheduled poll/watch events are
  refresh hints rather than authoritative content.
- 2026-08-02: P05 requires explicit import plus real frozen MCP Discover/Tools before a Binding is
  selectable. Catalog drift remains measured against the last approved active checksum; suspend and
  remove are append-only new-selection gates and never mutate Runtime Remote Task authority.
- 2026-08-02: P05 Catalog HTTP calls reject redirects after exact authority allowlisting. Binding
  identity and localServerId are separately serialized, and Redis owns no P05 fact.
- 2026-08-02: P07 persists full evaluation input and stability candidates in Runtime PostgreSQL so
  expiry and restart recomputation remain deterministic. Control may request evaluation through the
  frozen boundary but has no readiness table or writer.
- 2026-08-03: P08 projects AgentSkill only from public, published Capability Exposures with current
  qualifying Runtime readiness. Runtime owns active Card bytes; a failed Control Ack restores the
  prior Runtime LKG. Node Event delivery remains deferred to P12's single frozen stream.
- 2026-08-03: P09 creates Task, generic initial attempt, immutable Capability Binding, Capability
  Attempt and created event in one Runtime PostgreSQL transaction. Later execution changes append
  attempts; Control receives only a read-only Binding view through the Runtime-Control adapter.
- 2026-08-03: P10 keeps Skill definition rows immutable. Exact publish/suspend/deprecate state is a
  Runtime-owned governance overlay with CAS and an immutable command ledger; repository reads map
  that overlay to existing Runtime statuses, and publication alone moves the exact current pointer.
- 2026-08-03: P10 maps Plan Template publish to existing Artifact activate, revalidate to existing
  revalidation, and suspend to deprecate or an explicit rollback target. Node Control stores only
  its proxy ManagementOperation and audit while Runtime P02/P06 services remain content authority.
- 2026-08-03: RuntimeServiceAuth and the optional Artifact management bearer may be distinct
  secrets. The composition root maps the authenticated internal credential to the configured
  existing Artifact identity; Plan publish remains gated by the existing human administrator RBAC
  and P06 promotion rollout flag.
- 2026-08-03: P11 reuses P02 Control desired/observed configuration revisions with target type
  `telemetry_link`, while Runtime PostgreSQL owns the applied Active/LKG snapshot, export outbox and
  delivery cursor. Export collection and delivery run outside Task transactions; endpoint failure
  degrades only export status and never Task execution.
- 2026-08-03: A public Telemetry connection test may reapply only the newest `applied` local-node
  Revision. Draft/validated/rejected revisions are never treated as Active, even when newer.
- 2026-08-03: The Runtime exporter treats `maxPendingRecords` as a hard durable ceiling. Capture is
  bounded by remaining capacity; reaching the ceiling preserves records and reports a blocked
  status without deleting Runtime events or affecting Task execution.
- 2026-08-03: P12 keeps one Control-owned Node Event stream. Control changes project locally;
  Runtime readiness and Task-binding facts cross through a durable source cursor as bounded hints.
  Organization clients must refetch authoritative GET resources after every hint or reconnect.
- 2026-08-03: Organization access is a separate service principal with an exact frozen GET
  allowlist. Conditional Task commands remain disabled in P12; no internal configuration, provider,
  Skill/Artifact, telemetry or Audit surface is opened.
- 2026-08-03: P13 maps each public service credential to one frozen role profile; only Node
  Administrator can write. Runtime identity remains separate, Organization tenant identity is
  credential-bound, and unsupported secret-management/task-control operations remain unavailable.
- 2026-08-03: P13 accepts only exact/CIDR-allowlisted outbound authorities and HTTPS outside actual
  loopback IPs. PostgreSQL remains authoritative; backup/restore drills use new isolated databases
  and never infer production HA, capacity, RTO or RPO.

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
smokes; the final read-only review closes at 0 Blocking / 0 Major / 0 Minor. P04 adds bounded
multi-source SMPP Registry federation, immutable Snapshot lineage, conditional Latest refresh and
policy-specific LKG while preserving Catalog/Availability/Runtime authority. Its final gate passes
1,143 Unit/Contract, 136 Integration and 72 E2E tests; its repeated read-only review closes at 0
Blocking / 0 Major / 0 Minor. P05 adds explicit Direct/SMPP Provider Binding import, real MCP
Discover/Tools Catalog verification, canonical drift and freshness gates, terminal lifecycle safety
and retained Runtime Remote Task control. Its full gate passes 1,146 Unit/Contract, 137 Integration
and 72 E2E tests; three independent read-only review passes close 5 Major and 1 Minor findings with a
  final 0 Blocking / 0 Major / 0 Minor verdict. P06 adds canonical Capability business promises,
  exact Skill/Plan Template bindings, publication gates, SQL immutability and safe idempotent/ETag
  lifecycle commands. Its full gate passes 1,150 Unit/Contract, 138 Integration and 72 E2E tests;
  three review passes close 3 Major and 2 Minor findings with a final 0 Blocking / 0 Major / 0 Minor
  verdict. P07 adds Runtime-authored readiness over exact Capability, implementation, Catalog,
  availability, model route, policy and node-operational inputs. Its full gate passes 938 Unit, 214
  Contract, 138 Integration and 72 E2E tests with 30 Runtime migrations; four review passes close 5
  Major and 2 Minor findings with a final 0 Blocking / 0 Major / 0 Minor verdict. P08 adds
  Capability-backed Exposure governance, managed Agent Card Candidate/Diff/Apply/Ack/LKG rollback
  and official A2A TCK evidence. Its full gate passes 941 Unit/performance, 215 Contract, 138
  Integration and 72 E2E tests with 31 Runtime and 7 Control migrations; review closes 3 Major
  findings with a final 0 Blocking / 0 Major / 0 Minor verdict. P09 adds immutable Task Capability
  Binding, atomic acceptance, complete Provider policy snapshots, append-only execution attempts,
  real Provider-failover recording and terminal criteria/evidence enforcement. Its full gate passes
  949 Unit/performance, 215 Contract, 138 Integration and 72 E2E tests with 32 Runtime migrations;
  review closes at 0 Blocking / 0 Major / 0 Minor. P10 adds exact Skill import/lifecycle governance
  and logical Plan Template adapters over the existing P02/P06 authority. Its full gate passes 930
  Unit, 22 performance, 218 Contract, 143 Integration and 72 E2E tests with 34 Runtime and 7 Control
  migrations; final review is 0 Blocking / 0 Major / 1 accepted Minor. P11 adds output-only
  Telemetry Export over P02 Control revisions and Runtime-owned Active/LKG/outbox/retry/ACK state.
  Its final exact-commit gate passes 934 Unit, 22 performance, 219 Contract, 146 Integration and 72
  E2E tests with 35 Runtime and 7 Control migrations; Review closes 2 Major findings with a final 0
  Blocking / 0 Major / 0 Minor verdict. P12 adds immutable Profile governance, separate organization
  RBAC, a durable hint-only event stream and safe Runtime TaskSummary reads. Its exact-commit gate
  passes 937 Unit, 22 performance, 220 Contract, 149 Integration and 72 E2E tests with 36 Runtime
  and 8 Control migrations; Review closes 3 Major and 2 Minor findings at 0 Blocking / 0 Major / 0
  Minor. P13 adds role/tenant RBAC, bounded ingress/egress, real backup/restore, credential rotation,
  restart/outage evidence and operational runbooks. Its exact clean gate passes 960 Unit/performance,
  220 Contract, 149 Integration and 72 E2E tests with 36 Runtime and 8 Control migrations; final
  Review is 0 Blocking / 0 Major / 0 Minor. P14 behavior is not yet claimed.
