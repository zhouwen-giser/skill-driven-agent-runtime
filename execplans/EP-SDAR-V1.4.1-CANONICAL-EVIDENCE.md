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
- [x] 2026-08-04 Phase 4 replaced the legacy Telemetry wire/domain path with fenced Evidence batch
      export, explicit contiguous/partial ACK and a real Control-to-Sink outage-safe vertical.
- [x] 2026-08-04 Phase 5 projected all 18 Runtime types with exact references, terminal
      consistency, blocking source-gap issues, checkpoints and a draft manifest.
- [x] 2026-08-04 Phase 6 projected all 16 Skill types with exact version/identity, complete
      execution-tree/failure semantics, blocking no-invention issues and real PostgreSQL replay.
- [x] 2026-08-04 Phase 7 projected all 11 MCP Task and seven Capability types with exact lifecycle,
      binding snapshots, authenticated Control enrichment and real PostgreSQL replay.
- [x] 2026-08-10 Phase 8 completed. Remediation
      closes poison-source starvation, exact schemas for all 22 records, structured
      `CognitiveSourceRef`, latest-per-source reads and lossless 10,000-element Pattern ArtifactRef
      descriptors. Coverage is 74/100 and 74/95 Required (77.89%); final Review is
      `CLEAN_FOR_PHASE8_CLOSURE` with 0 Blocking/Major/Minor.
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
- Phase 7 real PostgreSQL testing exposed a polluted database template, a forbidden
  `credential_revision` in raw Source Revision hashing and an Agent Card SQL alias collision. A
  template0-isolated database plus pre-canonical sensitive-key removal and an unambiguous row alias
  closed all three without weakening constraints.
- Phase 7 full verification exposed incomplete enabled-Skill/active-Agent-Card fixtures, Manifest
  count imbalance, and concurrent projector shutdown contention. Valid authority fixtures,
  conserved expected/projected/pending/failed counts, a PostgreSQL session advisory lease and
  awaited shutdown closed them. Harness-only limits were raised without skipping assertions.
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
- Control's `telemetry_link` target type remains only an internal configuration-revision key; the
  public/internal routes, clients, services, transport and wire header now use Evidence naming.
- The canonical JSON hard limit is 256 KiB, so the configured batch limit and HTTP body limit must
  be identical and the service may send a shorter record prefix.
- The first delivery-failure test exposed that the export-state row may not exist yet. Failure/DLQ
  persistence now uses an atomic upsert transaction.
- A full gate caught a stale generated Node Control manifest hash after the schema size limit was
  aligned. Regenerating the manifest restored deterministic contract verification.
- The sandbox could not read Docker's user config during a full migration gate. The authorized
  escalated rerun against the existing isolated services passed all eight stages.
- Phase 5's first review found that `runtime.action` lacked its required `skill.execution`
  reference. Phase 6 further tightened parent/child correlation with persisted Provider ID and
  Operation metadata, retaining a single-Plan-execution fallback; zero or multiple exact matches
  create a blocking Quality Issue.
- Runtime terminal evidence carries Task, Goal, Control and Workflow statuses separately. Terminal
  Workflow status is checked but is not treated as proof of Goal achievement.
- A Run Seal alone cannot suppress recovery: pending selection also requires the corresponding
  manifest, closing the crash window between idempotent record append and manifest save.
- Phase 6 exposed a `version` table-alias/column collision: `to_jsonb(version)` serialized the
  integer column rather than the row. A distinct row alias plus a real-source assertion prevents
  recurrence.
- Parent/child Skills make Plan-only MCP Action correlation ambiguous. Exact Provider ID and
  Operation metadata now select one Skill Execution; zero/multiple exact matches fail visibly.
- Capability Slot resolution requires the composite Capability ID/version authority. The declared
  slot supplies ID and the immutable Task Capability Binding supplies version; no catalog latest or
  ID-only inference is accepted.
- Blocking cross-family Skill gaps cannot become terminal checkpoints: unresolved blocking Skill
  issues keep the Task pending, successful replay resolves obsolete issues, and the same stable
  issue ID is reopened if the gap returns.
- Independent Phase 8 Review found two Blocking and eight Major semantic defects despite the
  original focused PostgreSQL pass. The accepted repair is source-owned bounded partitions with
  aggregate equality revisions, complete V1.2 payloads, exact references/scopes, resolvable
  ArtifactRefs and persisted Replay safety proof; the original completion claim is withdrawn.
- Evidence capture is currently performed by durable source projectors after the business
  authority transaction. The Catalog therefore declares all 100 records `durable_projection`;
  it does not claim same-transaction capture that the implementation cannot provide.
- Poison source items must not stop healthy projection work. A stable required/blocking durable
  Projection Issue plus restart-safe backoff and exact resolution is part of the shared pipeline,
  not a family-specific test accommodation.
- A Pattern with 10,000 children cannot fit the bounded inline Evidence schema. The accepted
  representation keeps the immutable canonical definition behind an exact ArtifactRef and uses
  URI/JSON-pointer/count/SHA-256 descriptors for collections larger than 256.
- The isolated `sdar-v141-phase8-20260809` PostgreSQL/Redis project is available on ports
  `55484/56384`. It is the only Phase 8 database authority used by the remediation tests.

## Decision Log

- D-EP-001: Use migration Strategy B. Preserve 0142/0143 byte-for-byte and append the next
  migration for the clean cutover. No legacy data migration and no dual write.
- D-EP-002: `sdar.evidence/v1` is the only external evaluation evidence contract.
- D-EP-003: Canonical Evidence is appended by durable source-owned projectors after the business
  authority transaction. All 100 Catalog entries therefore declare `durable_projection`; any
  future same-transaction producer requires a separate contract change and proof.
- D-EP-004: Runtime PostgreSQL owns exporter state; Control PostgreSQL remains Control authority;
  Redis and the external sink remain non-authoritative.
- D-EP-005: Stable IDs derive only from source system/table/record/revision/schema identity.
- D-EP-006: Required evidence cannot be disabled by configuration; only diagnostic records can be
  excluded.
- D-EP-007: New dependencies require the OSS intake gate. The initial design adds none.
- D-EP-008: Runtime core uses a repeatable-read durable source projector over existing authorities;
  it does not retrofit or rewrite their transaction paths.
- D-EP-009: Cross-family Skill Execution references use the same canonical source identity emitted
  by Phase 6; ambiguous matches fail visibly and are never selected by order.
- D-EP-010: Skill Evidence uses post-terminal repeatable-read projection after the Runtime
  checkpoint. It snapshots declared Skill Version usage separately from execution policy and emits
  no derived record when exact selection, child, Plan Step or Capability authority is unavailable.
- D-EP-011: Canonical projection uses a PostgreSQL session advisory lease for cross-process
  coordination and awaits an in-flight projection during shutdown. PostgreSQL remains authority;
  Redis is not a lock or evidence owner.

## Implementation Steps

1. [Complete] Produce the 100-row source matrix, authority map, identity report, coverage baseline,
   and explicit missing-source blockers.
2. [Complete] Add Domain-owned canonical envelope/catalog/policy/manifest/quality types and JSON
   Schema 2020-12 documents with reproducible hashes and fixtures.
3. [Complete] Append Runtime migration 0144; add clean-cutover authorities, repository semantics,
   guarded reset, migration verification, and real transaction/recovery tests. No Control migration
   was necessary because Control authority remains in its existing database.
4. [Complete] Replace the old Telemetry application/adapter/API contract with evidence
   configuration, batch/ACK transport, retry/LKG/export status, and fail-closed security
   validation.
5. [Complete through Phase 8] Implement source projectors
   family by family in package order. Runtime is 18/18, Skill 16/16, MCP Task 11/11, Capability
   7/7, Experience 10/10, Replay 6/6 and Artifact 6/6. The generated source matrix records 74/100
   verified and 74/95 Required (77.89%).
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

Phase 7 mandatory full `pnpm verify` passed in 865,814 ms. Bootstrap covered 1,222
Unit/performance/Contract assertions and 667-source architecture; the remaining stages passed
Cognitive Replay, 37 migrations, 161 Integration tests, 72 E2E tests and infrastructure,
Server/Console and Node Control smokes. The first failures, causes and clean rerun hashes remain in
the Phase 7 Completion and generated verification summary.

Phase 8 Evidence Contract passes 100/100 (95 Required plus five diagnostic), focused Contract 9/9,
real PostgreSQL Runtime Core/Phase 8 5/5 and real 10,000-element Pattern producer/resolver 1/1.
Registry hash is `sha256:a2ce623b2d26371680ba9392a33d10315639e66786d4acbcc244c5627202ba3d`;
contract hash is `sha256:a1ffebfde0902dab632c16a8ffdad781926198a9bf69ed3722b52da1206dfd86`.
Final independent Review is `CLEAN_FOR_PHASE8_CLOSURE` with zero Blocking, Major or Minor findings.
Two later best-effort full verify attempts did not complete: the Architecture allowlist was fixed
before a wrong Redis `56385` timeout; with correct Redis `56379`, the other 32 Integration files /
165 tests passed and the sole Node Control race/non-independent migration file passed 1/1 after
repair. Latest targeted format/lint/typecheck pass; Prettier wrote touched files, so no whole-repo
format claim is made. Task-package section 30 mandates full `pnpm verify` only at Phases
0/3/7/9/12/13/14. Phase 8 therefore closes without representing either attempt as a successful
full gate.

## Idempotence and Recovery

Catalog/schema generation is deterministic. Stable IDs and unique source/revision/schema keys make
projection replay idempotent. Projectors save a checkpoint only after all record writes and exact
source-scoped issue reconciliation complete; a crash before that point replays idempotently.
Exporter ACK advances only through contiguous sequences. Audited replay and DLQ operations remain
Phase 11 work and are not claimed by the current implementation. Failed phases resume from
`reports/v1.4.1-evidence/goal-state.json` and this plan without rewriting pushed history.

## Artifacts and Evidence

- Task package: `docs/sdar_v1_4_1_evidence_goal_package/`
- Baseline and phase evidence: `reports/v1.4.1-evidence/`
- Canonical protocol: `protocol/evidence/v1/`
- Schemas: `schemas/evidence/`
- Frozen downstream bundle: `reports/v1.4.1-evidence/clickhouse-handoff/`
- Full-gate raw logs and summary: `reports/verification/`

## Outcomes and Retrospective

Phases 0 through 7 are complete. The baseline is reproducible, the append-only route is fixed, and
all 100 catalog types now have source-confirmed authority. The Domain freezes deterministic
IDs/hashes, 100 non-placeholder schemas, and seven protocol schemas. The current regenerated
registry hash is `sha256:a2ce623b2d26371680ba9392a33d10315639e66786d4acbcc244c5627202ba3d`.
Migration 0144 removes the three old Telemetry product tables and creates eight constrained
Evidence authorities with no data migration or dual write. Eleven focused PostgreSQL tests, the
37-migration verifier, and Phase 3 full gate pass. Phase 4 replaces the complete external
Telemetry surface with a bounded, fenced `sdar.evidence/v1` batch/ACK service and proves the real
Control -> Runtime -> PostgreSQL/Redis -> HTTP receiver path plus nonblocking receiver outage. Its
601,088 ms full `pnpm verify` passes 1,207 static Unit/Contract, 158 Integration and 72 E2E tests.
Runtime projector coverage is 18/18, Skill is 16/16, MCP Task is 11/11 and Capability is 7/7, for
52/100 total.
The real Skill vertical proves exact Usage Specification and policy snapshots, parent/child
composition, Capability Slot ID/version, seven reference kinds, wait/resume, compliance pass/fail,
degraded missing effects/evidence and replay. Phase 7 additionally proves Remote Task lifecycle,
continuation/cancel semantics, complete Capability Binding snapshots and authenticated Control
enrichment. Its mandatory 865,814 ms full gate passes all eight stages. Phase 8 Experience, Replay
and Artifact implementation is complete at generated coverage 74/100 and 74/95 Required (77.89%);
its final independent Review is clean. Per task-package section 30, the next mandatory full gate is
Phase 9.
This section will be replaced with the final measured outcome after Phase 14.
