# UGV Benchmark debug verification — 2026-08-27

## Scope and safety

This report covers passive Benchmark deployment and warehouse access. It did not
create a Benchmark Run, A2A Task, score or device Tool call. No Grafana, Redis or
additional ClickHouse instance was started. Credentials and private configuration
are intentionally omitted.

## External warehouse

- Target: `192.168.1.7:8123`.
- Additive ProviderOps v2 migration 015 SHA-256:
  `dba7693c2ee3fe52bc4ea61182cce87244c6f83dbf2f5a94048da9fb9ed9740a`.
- Migration result: ten tables/views applied and verified; no destructive DDL.
- Dedicated identities: Reader and Projector.
- Exact grants: Reader 132 SELECT / 0 INSERT; Projector 132 SELECT / 40 INSERT.
- No wildcard/database grants, DDL, UPDATE, DELETE, role, grant option or credential output.
- A second provisioning run returned the same exact counts.

## Runtime evidence

- Compose project: `sdar-ugv-debug-benchmark`.
- Persistent PostgreSQL plus API, Reconciler, Evaluation Worker, passive Benchmark
  Worker and Projector are running.
- API: `0.0.0.0:18090`; anonymous `/ready` returned HTTP 200.
- Frozen bootstrap was idempotent and preserved
  `notBefore=2026-08-27T01:24:49.420Z`.
- Debug status: `dataReadiness=waiting_source`;
  `formalScoring.eligible=false` with
  `EXECUTABLE_RULESET_NOT_CONFIGURED`.

## Projection defect recovery

The first Projector used local observation scope for global registry metadata. It
failed 68 `benchmark.meta/v1` rows before ClickHouse mutation. The default was
restored to `global/global`; recovery accepted only the exact fixed error fingerprint,
cross-checked the five identity fields, validated all payloads through the production
mapper, and transactionally requeued them.

- PostgreSQL Outbox: published 68.
- Projection checkpoint: one `benchmark.meta/v1` authority with source/hash present.
- Dead Letter: unresolved 0; original 68 retained as resolved with fixed resolution note.
- Second recovery invocation: `already_reconciled`, requeued 0.
- External frozen meta tables are readable; release/operator/relation/invariant and
  golden-fixture rows are present. Existing warehouse history was not deleted.

## Verification commands

- Benchmark Projector/recovery/passive focused tests: 4 files / 35 tests PASS.
- Benchmark full unit: 66 files / 445 tests PASS.
- Benchmark isolated PostgreSQL integration: 12 files / 53 tests PASS; four
  ClickHouse-write/restart scenarios remain explicitly skipped by that PG-only command.
- Benchmark contract after immutable source-lock publication: 6 files / 64 tests PASS.
- Benchmark typecheck: PASS.
- Benchmark production build and runtime image build: PASS.
- Benchmark lint, format, migration (10 files), architecture and OpenAPI gates: PASS.
- SDAR Telemetry typecheck/build PASS; Provider/debug focused 16 PASS with two
  real-PG cases skipped in the no-PG command; Provider v2 handoff static verifier PASS.
- SDAR debug command focused tests include the recovery stage and final YES ordering.
- Provider v2 and Domain handoff readiness: PASS in the live anonymous `/ready` response.

## Cross-repository publication gate

`pnpm check:telemetry-handoffs` PASS. The source lock pins Telemetry commit
`4d1dd58697a6deb6e2efabd6c21aa0c8097703c8`, Provider v2 manifest blob
`80cc80c39a870b7a483d1952a0068e53d522d6a7`, and byte SHA-256
`69afb3df6240da2f6e6e3109c53abf29cccab3123ba61aa972e0a6908d6966f9`.
Telemetry main contains merge `3e43350`; Benchmark main contains merge `df1233b`.
