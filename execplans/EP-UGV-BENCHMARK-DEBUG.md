# Benchmark passive evaluation in UGV debug

## Purpose / Outcome

Implement the user-approved 2026-08-26 plan: `pnpm ugv:debug` manages the five
Benchmark roles and persistent PostgreSQL, consuming only subsequent scoped real
Evidence through the existing external warehouse. No automatic Run, A2A Task or
device invocation. Commander/NPC configuration remains optional and unclaimed.

## Requirements Covered

- BENCH-DEBUG-001: passive five-role deployment, anonymous LAN API, lifecycle and failure safety.
- BENCH-DEBUG-002: frozen registry initialization and durable scoped ingestion origin.
- BENCH-DEBUG-003 / V141-EVIDENCE-PERSIST-001: frozen Remote Task Binding provenance.
- BENCH-DEBUG-004: ProviderOps v2 durable closure, manifest-last publication and recovery.
- BENCH-DEBUG-005 / FR-ADM-001: truthful readiness, blocked evaluation and operational documentation.

## Context and Orientation

SDAR owns the debug shell and Runtime Evidence. Adjacent `sdar-benchmark-server`
owns evaluation PostgreSQL and immutable Bundles. `sdar-telemetry-platform` owns
Canonical/Provider projections and Control PostgreSQL. Previous Telemetry debug
changes are uncommitted and must be preserved. External ClickHouse is
192.168.1.7:8123; no new warehouse, Redis, UI or Grafana is introduced.

## Architecture and Interfaces

ADR-144 records ownership. Runtime exports the remote task's frozen authority,
never a latest Binding lookup. Benchmark consumes bounded scoped warehouse facts;
its PostgreSQL owns first boundary, registry, jobs and checkpoints. Telemetry
Control PostgreSQL owns closure work/leases/checkpoints; ClickHouse only publishes
immutable closure snapshots, with the manifest committed last. Diagnostics never
advance business state or synthesize scores. Passive mode is independent of YES.

## Progress

- [x] 2026-08-26 Read repository/skill instructions and identify existing dirty changes.
- [x] 2026-08-27 Implement Benchmark passive mode, registry bootstrap and immutable ingestion boundary.
- [x] 2026-08-27 Export frozen Binding provenance and consistent future observation scope.
- [x] 2026-08-27 Implement Provider v2 production source, durable closure and deployment contracts.
- [x] 2026-08-27 Extend debug orchestration, status, credentials and optional domain configuration.
- [x] 2026-08-27 Apply additive Provider v2 warehouse migration and exact Benchmark grants.
- [x] 2026-08-27 Start the real passive stack and verify readiness/waiting-source/blocked-scoring truthfulness.
- [x] 2026-08-27 Repair and audit-reconcile the Projector global metadata scope defect.
- [x] 2026-08-27 Publish the Telemetry producer commit and update the Benchmark source lock to its immutable commit/blob/hash.

## Discoveries and Surprises

- 2026-08-27 The user explicitly authorized the two external ClickHouse users and
  frozen grants. Ordinary ClickHouse views execute using caller privileges, so
  granting only the public views was insufficient. The provisioning preflight now
  recursively freezes their exact dependency closure: both users have 132 exact
  SELECT relations; only Projector has INSERT on the 40 tables exported by
  `WRITABLE_PROJECTION_TABLES`. There are no wildcard/database grants, roles,
  grant options, DDL, UPDATE or DELETE privileges.
- The first real Projector run exposed an invalid local-scope override for global
  PostgreSQL registry metadata. Sixty-eight outbox rows failed before ClickHouse
  writes. The default was restored to `global/global`; an exact one-defect recovery
  validated every payload with the production mapper, requeued all 68, retained and
  resolved all audit rows, and was idempotent on a second invocation.
- The runtime image originally could not resolve emitted workspace packages. The
  image preparation now publishes package links at the compiled application root.
- Schema release authority is global while actual Evidence/Domain/Provider episode
  reads stay bound to `tenant-local/ugv-debug/integration` and the persisted
  `notBefore`. Service health, data availability, and formal scoring eligibility
  are intentionally separate.

- Benchmark API Provider preflight omits the required environment.
- Existing manifest intake has a moving lookback but no immutable first boundary.
- Provider v2 has a deterministic calculator but lacks production views/consumer.
- Canonical remote-binding payload omits Provider identity already held in the
  immutable Runtime snapshot; the legacy wide Binding table cannot be populated
  honestly from that evidence. Use explicit Canonical provenance instead.
- Frozen review profile is canonical-only and has no executable rule implementation;
  startup must not claim formal score eligibility.

## Decision Log

- 2026-08-26 User approved passive mode, completing Provider v2, and leaving
  SDAR-to-Commander/NPC empty. Missing producer configuration is waiting configuration,
  not generic-service failure. Real contract drift remains a blocker.
- Preserve all historical Evidence, hashes, data volumes and existing export origins.
  Future debug records use tenant-local / ugv-debug / integration observation scope.
- 2026-08-27 User approved creation of `ugv_debug_benchmark_reader` and
  `ugv_debug_benchmark_projector` on `192.168.1.7:8123` with exact contract SELECT
  and Projector-only frozen 40-table INSERT. Credentials remain private state only.

## Implementation Steps

1. Add typed passive configuration and reject active Run creation before persistence.
2. Add idempotent frozen registry import and immutable PostgreSQL source origin;
   bind all manifest and bundle reads to that origin/scope.
3. Extend future Runtime Binding evidence with safe frozen provenance.
4. Add Canonical-to-v2 adapter, leased persistent closure work, manifest-last views.
5. Add Benchmark image/assets/Compose/secrets/least-privilege deployment and debug wiring.
6. Exercise offline and isolated real persistence, then read-only live telemetry.

## Validation

Executed during the current implementation slice:

- External migration 015 SHA-256
  `dba7693c2ee3fe52bc4ea61182cce87244c6f83dbf2f5a94048da9fb9ed9740a`
  applied and verified ten ProviderOps v2 objects without destructive DDL.
- Exact warehouse provisioning rerun:
  `readerSelectRelations=132`, `projectorSelectRelations=132`,
  `projectorInsertRelations=40`; exact/idempotent with no permission drift.
- Benchmark focused Projector/recovery/passive tests: 4 files / 35 tests PASS;
  Projector scope subset 2 files / 25 PASS; recovery rerun reports
  `already_reconciled`. Typecheck and production build PASS.
- Real Compose: PostgreSQL plus API, Reconciler, Evaluation Worker, passive
  Benchmark Worker and Projector are running; anonymous `/ready` is HTTP 200.
  Bootstrap reused exact `notBefore=2026-08-27T01:24:49.420Z`.
- PostgreSQL projection authority: `published=68`, unresolved dead letters `0`,
  resolved audit rows `68`, one `benchmark.meta/v1` checkpoint. The current status
  remains `waiting_source`; scoring is ineligible with
  `EXECUTABLE_RULESET_NOT_CONFIGURED`.
- SDAR debug command regression includes the recovery stage and preserves final
  YES ordering. No Benchmark Run, A2A Task or device Tool was created.
- `pnpm check:telemetry-handoffs` PASS pins Telemetry commit
  `4d1dd58697a6deb6e2efabd6c21aa0c8097703c8`, Provider v2 manifest blob
  `80cc80c39a870b7a483d1952a0068e53d522d6a7`, and byte SHA-256
  `69afb3df6240da2f6e6e3109c53abf29cccab3123ba61aa972e0a6908d6966f9`.
  The complete Benchmark contract gate passes 6 files / 64 tests.

Run smallest relevant tests after each slice; final format/lint/typecheck/build,
contract/integration and architecture gates in affected projects. New migrations
need isolated PostgreSQL/ClickHouse tests and rollback notes. Check no skip/only,
new any debt, secret output, Task creation or device calls. Live data absence is
reported as waiting, never replaced with test fixtures in the shared warehouse.

## Idempotence and Recovery

Registry identity/content conflicts fail. Origins never reset. Restart/stop retains
volumes and Bundle artifacts. Closure leases fence stale workers; unpublished detail
rows cannot be read as a committed snapshot. Startup failure preserves data and keeps
new SDAR in NO. Existing healthy SDAR is not replaced by repeated start.

## Artifacts and Evidence

Validation commands/results will be recorded in `reports/ugv-benchmark-debug/verification.md`.
Do not include credentials, private configuration or raw environment dumps.

## Outcomes and Retrospective

The passive debug deployment and real warehouse access are operational. Service
readiness is verified; source data and formal scoring are truthfully not ready. The
cross-repository publication gate is closed by the immutable Telemetry producer pin
and passing handoff contract. `waiting_source` and
`EXECUTABLE_RULESET_NOT_CONFIGURED` remain truthful runtime/data eligibility states,
not implementation or publication failures.
