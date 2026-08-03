# EP-SDAR-V1.4.1 Canonical Evidence Export

## Purpose / Outcome

Replace the v1.4 `runtime_event` summary-only Telemetry Export with the sole formal external
evidence contract `sdar.evidence/v1`. The completed path must capture authoritative Runtime and
Control PostgreSQL facts, project them without creating a second authority, persist canonical
records in a unified Runtime outbox, deliver batches at least once with contiguous ACK semantics,
and seal episode manifests whose required source coverage is 100%.

ClickHouse, OTel, dashboards, a second workflow runtime, physical device command execution,
automatic merge, tags, releases, and deployment are outside this plan.

## Requirements Covered

- CE-001: one external contract, `sdar.evidence/v1`, and no legacy dual write.
- CE-002: deterministic canonical envelope, stable IDs, canonical SHA-256 hashes, schemas,
  redaction, artifact boundaries, and typed catalog.
- CE-003: all 100 required record types across Runtime, Skill, MCP Task, Capability, Experience,
  Replay, Artifact, Node Control, and Evidence Infrastructure.
- CE-004: Runtime PostgreSQL evidence configuration, outbox, per-source checkpoint, export state,
  DLQ, projection/quality issues, and episode manifest.
- CE-005: transactional capture for same-authority facts and durable replayable projection for
  cross-authority/derived facts; Redis remains wake-only and non-authoritative.
- CE-006: HTTP batch delivery using `x-sdar-evidence-contract: sdar.evidence/v1`, at-least-once
  delivery, partial/contiguous ACK, retry, conflict detection, and LKG configuration.
- CE-007: complete source-to-evidence matrix with no guessed sources and 100% required coverage.
- CE-008: management, recovery, reconciliation, RBAC/audit, and readiness operations.
- CE-009: all required vertical, adversarial, performance, migration, architecture, security,
  contract, integration, E2E, smoke, and acceptance gates.
- CE-010: frozen ClickHouse handoff bundle and a Ready (not merged) GitHub PR.

## Context and Orientation

The base commit is `cc0719f4db83dc64dc6e32e6dcad2d558823e796`, the merge of v1.4 Node
Control into `main`. Package version is `1.4.0`. Runtime migrations end at
`0143_v14_node_event_projection`; `0142_v14_telemetry_export` is already published on `main`.
The current implementation projects only `runtime_event` summaries through
`packages/runtime-control-*` and `packages/telemetry-export-adapter`.

Runtime PostgreSQL owns task/goal/plan/workflow/skill/MCP-task/experience/artifact facts and the
new evidence delivery state. Control PostgreSQL owns node profile/configuration/provider/route/
capability/readiness/exposure/card/operation/audit/event facts. Provider state remains external
authority. The exporter and projectors are read/capture paths only and may not mutate those
authorities.

## Architecture and Interfaces

The Domain layer owns `CanonicalEvidenceRecord`, catalog entries, stable identity/hash rules,
manifest policy, redaction policy, delivery classifications, and typed errors. Application owns
transactional writer ports, durable source projectors, export/ACK/manifest services, and
reconciliation. PostgreSQL adapters own evidence tables and cursor transactions. The HTTP adapter
owns wire serialization and TLS/credential handling. Server is the only composition root.

Control-to-Runtime projection follows Control transaction -> Control event/audit/revision ->
authenticated read/event hint -> Runtime projector -> Runtime evidence outbox. There is no
distributed transaction. A hint that lacks full state is resolved through a revision/ETag-aware
Control read before mapping.

## Progress

- [x] 2026-08-04 Phase 0 package integrity, latest-main baseline, branch, migration decision, and
      clean full verification established.
- [x] 2026-08-04 Phase 1 mapped all 100 authoritative source identities: 93 confirmed and 7
      explicit clean-cutover blockers.
- [x] 2026-08-04 Phase 2 froze canonical evidence Domain, all 100 record schemas/hashes, protocol
      schemas, stable identity, canonical hashing, and fail-closed security.
- [x] 2026-08-04 Phase 3 appended 0144, removed old Telemetry product tables, created eight
      Evidence authorities, and passed focused PostgreSQL, migration, and full verification gates.
- [ ] Phase 4 replace legacy Telemetry wire/domain path with evidence batch export.
- [ ] Phase 5 project Runtime core evidence.
- [ ] Phase 6 project complete Skill usage evidence.
- [ ] Phase 7 project MCP Task and Capability evidence.
- [ ] Phase 8 project Experience, Replay, and Artifact evidence.
- [ ] Phase 9 project Node Control governance evidence.
- [ ] Phase 10 seal episode manifests and enforce coverage/quality.
- [ ] Phase 11 expose secured evidence operations and recovery runbooks.
- [ ] Phase 12 verify all required vertical scenarios.
- [ ] Phase 13 run adversarial, authority, security, and performance hardening.
- [ ] Phase 14 publish final acceptance, frozen handoff, and Ready PR.

## Discoveries and Surprises

- `0142` and `0143` are ancestors of `origin/main` and protected by the monotonic checksum gate;
  Strategy A is invalid.
- Local port `55432` belongs to `smpp-continuation-postgres`; it must not be stopped by this work.
- A stale repository P03 Redis container occupied `56379`; it was stopped without deleting its
  container or volume.
- The default `sdar` PostgreSQL named volume had incompatible collation metadata. A new Compose
  project and volume proved the clean baseline without deleting existing data.
- One full-gate attempt passed all 149 integration assertions but timed out in an `afterAll` hook;
  the identical clean rerun passed.
- The existing Control `configuration_revision` rows with `target_type=telemetry_link` are the
  authority for evidence-export configuration governance. The old Runtime telemetry configuration
  is a projection target, not canonical Control authority.
- Ninety-three catalog types have non-guessed sources. The only seven missing sources are the two
  canonical delivery/ACK facts and five evidence-infrastructure facts that Strategy B must append.
- Typed children inside persisted trace, pattern, and replay JSON have stable domain IDs/keys and
  may be projected as structured subrecords; missing child identity is a projection issue.
- A single generated Draft 2020-12 registry can express all 100 record types without a generic
  payload placeholder. Record-specific required fields plus a bounded recursive JSON value retain
  forward-compatible additive data while failing closed on envelope/source/type drift.
- Windows does not resolve `pnpm exec vitest` in this environment; direct repository-local
  `node_modules/.bin/vitest.cmd` is the reliable focused-test entry point.
- PostgreSQL truncates the generated source-identity unique constraint to
  `evidence_outbox_source_system_source_table_source_record_id_key`; migration verification must
  inspect the actual catalog name, not infer a longer identifier.
- Several frozen integration fixtures use Redis port 56379 directly. Operator-managed isolated
  infrastructure must preserve that repository contract even when PostgreSQL uses a custom port.

## Decision Log

- D-EP-001: Use migration Strategy B. Preserve 0142/0143 byte-for-byte and append the next
  migration for the clean cutover. No legacy data migration and no dual write.
- D-EP-002: `sdar.evidence/v1` is the only external evaluation evidence contract.
- D-EP-003: Required facts are captured transactionally when their source transaction is local;
  derived and cross-database facts use durable per-source projection.
- D-EP-004: Runtime PostgreSQL owns exporter state; Control PostgreSQL remains Control authority;
  Redis and the external sink remain non-authoritative.
- D-EP-005: Stable IDs derive only from source system/table/record/revision/schema identity.
- D-EP-006: Required evidence cannot be disabled by configuration; only diagnostic records can be
  excluded.
- D-EP-007: New dependencies require the OSS intake gate. The initial design adds none.

## Implementation Steps

1. [Complete] Produce the 100-row source matrix, authority map, identity report, coverage baseline,
   and explicit missing-source blockers.
2. [Complete] Add Domain-owned canonical envelope/catalog/policy/manifest/quality types and JSON
   Schema 2020-12 documents with reproducible hashes and fixtures.
3. [Complete] Append Runtime migration 0144; add clean-cutover authorities, repository semantics,
   guarded reset, migration verification, and real transaction/recovery tests. No Control migration
   was necessary because Control authority remains in its existing database.
4. Replace the old Telemetry application/adapter/API contract with evidence configuration,
   batch/ACK transport, retry/LKG/export status, and fail-closed security validation.
5. Implement source projectors family by family in package order, updating matrix and tests after
   each phase.
6. Add manifest/quality/coverage enforcement, management recovery operations, and 44 required
   vertical scenarios.
7. Run adversarial and performance gates, independent architecture/acceptance audits, freeze the
   ClickHouse handoff, update release documentation, and mark the PR Ready.

## Validation

Each phase runs format, lint, typecheck, changed-area Unit/Contract, and architecture/migration
checks as applicable. Phases 3, 7, 9, 12, 13, and 14 run full `pnpm verify`; Phase 0 also ran it.
Final validation additionally runs `verify:evidence-contract`, `verify:evidence-coverage`, and
`demo:evidence-e2e`, plus every command named in the task package.

Real PostgreSQL/Redis commands use an isolated Compose project and explicit ports/URLs. Reports
must preserve first failure, root cause, repair, and rerun. Simulated Provider behavior is labelled;
no physical command claim is permitted.

## Idempotence and Recovery

Catalog/schema generation is deterministic. Stable IDs and unique source/revision/schema keys make
projection replay idempotent. Projectors commit record writes and per-source checkpoints together.
Exporter ACK advances only through contiguous sequences; replay and DLQ operations are audited and
bounded. Failed phases resume from `reports/v1.4.1-evidence/goal-state.json` and this plan without
rewriting pushed history.

## Artifacts and Evidence

- Task package: `docs/sdar_v1_4_1_evidence_goal_package/`
- Baseline and phase evidence: `reports/v1.4.1-evidence/`
- Canonical protocol: `protocol/evidence/v1/`
- Schemas: `schemas/evidence/`
- Frozen downstream bundle: `reports/v1.4.1-evidence/clickhouse-handoff/`
- Full-gate raw logs and summary: `reports/verification/`

## Outcomes and Retrospective

Phases 0 through 3 are complete. The baseline is reproducible, the append-only route is fixed, and
all 100 catalog types now have source-confirmed authority. The Domain freezes deterministic
IDs/hashes, 100 non-placeholder schemas, and seven protocol schemas under registry hash
`sha256:b425727078045bd8e710660bd73277993e2c98bfcbd143430f88aee31ddb5b27`.
Migration 0144 removes the three old Telemetry product tables and creates eight constrained
Evidence authorities with no data migration or dual write. Eleven focused PostgreSQL tests, the
37-migration verifier, and a 553,810 ms full `pnpm verify` pass. Formal projector coverage remains
0/100; Phase 4 starts the Evidence batch service/wire replacement. This section will be replaced
with the final measured outcome after Phase 14.
