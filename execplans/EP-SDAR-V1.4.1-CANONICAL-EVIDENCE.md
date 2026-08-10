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

Control-to-Runtime projection follows Control transaction -> immutable Control observation ledger
-> fixed privileged `node_control.evidence.read` service read -> Runtime projector -> Runtime
evidence outbox. Runtime delivery and receiver-ACK observations come from a separate immutable
Runtime ledger and independently checkpointed source. There is no distributed transaction, and no
public Control principal or Redis state may substitute for either PostgreSQL authority.

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
- [x] 2026-08-10 Phase 9 completed the 21 Node Control records, immutable Control and Runtime
      observation ledgers, exact recovery/references/scope, and the generation-1 export boundary.
      The real PostgreSQL/Redis/HTTP vertical passes 1/1 and independent Review is clean. The full
      gate is not reported as passed: lint failed and was repaired on attempt one; attempt two
      passed 1,058 Unit/performance assertions and stopped on one stale Contract fixture; its
      repaired direct suite passes 10/10. Per explicit user direction, the next whole-repository
      `pnpm verify` is the single Phase 14 final gate.
- [x] 2026-08-10 Phase 10 sealed authority-derived Episode Manifests, implemented all five
      Evidence infrastructure records and ten quality rules, enforced ACK-gated Required coverage,
      and closed independent Review at 0 Blocking/Major/Minor. Focused Unit 3/3, Contract 1/1,
      PostgreSQL 1/1 and typecheck pass; the final full gate remains Phase 14 only.
- [x] 2026-08-10 Phase 11 exposed metadata-only Evidence operations, durable restartable recovery,
      audited Node Control RBAC, DLQ replay, real coverage reconciliation, bounded continuing
      retention and the operator runbook. The existing real PostgreSQL/Redis/HTTP vertical passes
      1/1 with record replay and endpoint-outage isolation; independent Review is 0/0/0. Per user
      direction no intermediate full gate was repeated.
- [x] 2026-08-10 Phase 12 verified all 44 required vertical scenarios across ten explicit evidence
      dimensions with 42 direct tests in 25 resumable shared suites. First failures and repairs are
      retained; the final independent Review is 0/0/0 after one evidence-provenance Major repair.
- [x] 2026-08-10 Phase 13 closed all 25 frozen adversarial findings, added bounded foreground/
      Evidence scheduler fairness and cross-tenant/user-scope reference enforcement, and passed
      the stable balanced performance gates: Runtime P95 regression 9.309%, append P95
      15.576 ms. Final independent Review is 0 Blocking/Major/Minor after 1 Blocking, 2 Major and
      1 Minor repair; the final Phase 14 repository gate passed all ten stages in 1,213,445 ms.
- [x] Phase 14 published final acceptance, committed/pushed the frozen handoff, and marked PR #18 Ready.

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
- PostgreSQL `bigint` authority sequences must be ordered as numeric columns before aliasing them
  as text. Ordering `observation_sequence::text` caused revisions after 9 to sort lexicographically
  and broke the exact published-Configuration reference.
- Exporter self-observation requires an explicit generation boundary: generation-1 delivery and
  ACK observations are exportable, but exporting them may not create generation-2 children. A
  bounded sequential drain also prevents one-partition-per-tick starvation without weakening the
  existing single-flight lock.
- A nullable wrapper around the already-nullable canonical Evidence value creates two matching
  `oneOf` branches and rejects a valid running ManagementOperation. Canonical nullability must be
  expressed exactly once.
- Export delivery partitions are not projection-source partitions and therefore have no source
  checkpoint. `evidence.export_status` lineage uses the exact immutable batch's canonical
  `node_control.telemetry_delivery` record instead of inventing a checkpoint.
- Public Organization, Viewer, Operator, Security or user principals cannot provide projector
  authority. Node Control projection uses one fixed internal service identity with
  `node_control.evidence.read`, `global_authority` and `node_local` scope and no public route.

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
- D-EP-012: Node Control projection reads the immutable Control observation ledger only through a
  fixed privileged service principal and reads immutable Runtime delivery/ACK observations through
  a second independently checkpointed source. Generation-1 delivery/ACK evidence is terminal for
  self-observation; no generation-2 record is created.

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
5. [Complete through Phase 10] Implement source projectors
   family by family in package order. Runtime is 18/18, Skill 16/16, MCP Task 11/11, Capability
   7/7, Experience 10/10, Replay 6/6, Artifact 6/6 and Node Control 21/21. The generated source
   matrix records 95/100 implemented and verified, including 94/95 Required (98.95%). The five
   `evidence.*` records are now 5/5 implemented and verified, for 100/100 total and 95/95 Required.
6. [Complete through Phase 12] Add manifest/quality/coverage enforcement, metadata-only management
   operations, restartable recovery, DLQ retry, coverage reconcile, audited RBAC and bounded
   Diagnostic retention. The resumable Phase 12 runner now maps and passes all 44 required
   scenarios with explicit ten-dimension provenance.
7. [Complete] Run adversarial and performance gates, independent architecture/acceptance audits,
   freeze the ClickHouse handoff, update release documentation, commit/push the exact tree and mark
   PR #18 Ready for Review.

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

Phase 9 projects all 21 Node Control records through immutable Control and Runtime observation
ledgers and two independently checkpointed sources. The real PostgreSQL/Redis/HTTP vertical passes
1/1, the repaired direct Evidence Schema Contract passes 10/10, and final independent Review is
Accepted with zero Blocking, Major or Minor findings. The generated Registry remains 100 records
(95 Required plus five diagnostic); the source matrix records 95 implemented and verified, with
all 21 `node_control.*` records verified and all five remaining `evidence.*` records
source-confirmed for Phase 10. Registry hash is
`sha256:62fd3e06d4b2b5cebf00814a9cee1d8331ac6acd3e2b59bafbce9c2e7099cf88`.

The Phase 9 full gate is not reported as passed. Attempt one stopped at lint and the mechanical
findings were repaired. Attempt two passed format, lint, typecheck and 1,058 Unit/performance
assertions, then stopped on one stale positive Contract fixture; the repaired affected Contract
suite subsequently passed 10/10 directly. Following the user's instruction not to repeat
intermediate whole-repository verification, the next complete `pnpm verify` is deferred to the
single Phase 14 final gate.

Phase 11's existing real Control/Runtime PostgreSQL, Redis and HTTP vertical passes 1/1 after
adding record replay, Control ManagementOperation/Audit, canonical operation Evidence, re-ACK and
receiver-outage isolation. The same failure path exposed and closed duplicate canonical-null
schema branches and an impossible export-partition checkpoint reference. Two preserved Export
Status batches then project 2/2 with exact Telemetry Delivery lineage. Independent Review is
0 Blocking / 0 Major / 0 Minor; no broad intermediate gate was repeated.

Phase 12 passes 44/44 required scenarios using 42 direct tests in 25 resumable shared suites. Each
scenario records explicit provenance for Source Fact, Outbox, stable ID, payload hash, sequence,
references, real HTTP delivery, PostgreSQL ACK, Manifest and business-authority isolation. The
first Review's evidence-provenance Major was repaired without adding redundant tests; the second
read-only Review is 0 Blocking / 0 Major / 0 Minor. First failures, roots and direct reruns remain
under `reports/v1.4.1-evidence/failed-attempts/`. Per the user's reduced intermediate-test
direction, the next and only repository-wide full gate remains Phase 14.

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

Phases 0 through 12 are complete for their scoped implementation and independent Review. The
baseline is reproducible, the append-only route is fixed, and
all 100 catalog types now have source-confirmed authority. The Domain freezes deterministic
IDs/hashes, 100 non-placeholder schemas, and seven protocol schemas. The current regenerated
registry hash is `sha256:62fd3e06d4b2b5cebf00814a9cee1d8331ac6acd3e2b59bafbce9c2e7099cf88`.
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
its final independent Review is clean. Phase 9 Node Control implementation is complete at 95/100
total and 94/95 Required (98.95%), with
all 21 Node Control records verified and five Evidence-family records source-confirmed for Phase 10. Its real vertical passes 1/1 and independent Review is clean. Phase 9's full gate did not pass:
the first attempt stopped at repaired lint findings and the second passed 1,058 Unit/performance
assertions before one stale Contract fixture failed; the repaired direct Contract passes 10/10.
By explicit user direction, whole-repository verification is not repeated in intermediate phases
and remains scheduled once at Phase 14. Phase 10 reaches 100/100 implemented-and-verified records
under its Phase 10 closure registry hash; the current Phase 11 registry hash is
`sha256:2bc75460820a778830bc1c787afa74a4f71571b9658b8dd496b495e528c85567`;
its direct Unit 3/3, Contract 1/1 and PostgreSQL 1/1 checks pass and independent Review is clean.
Phase 11's real recovery/outage vertical passes 1/1 and its independent Review is clean. Phase 12
passes all 44 required scenario mappings with ten-dimension evidence and a clean final Review.
Phase 13 closes the exact 25-item adversarial matrix with zero final Blocking/Major/Minor findings.
The final balanced ABA/BAA/AAB benchmark retains the original thresholds and records 9.309% Runtime
P95 regression, 14.823% baseline median drift and 15.576 ms Evidence append P95. Phase 14's exact
tree `pnpm verify` passed all ten stages in 1,213,445 ms: 1,305 static assertions, 41 Runtime and
9 Control migrations, 175 Integration tests, 73 E2E tests, official A2A TCK, the 44/44 Evidence
demo and all three smoke stages. The generated ClickHouse handoff is adapter-only, reports 95/95
Required and 100/100 total mappings, zero Required deferred items and `fullVerify=passed`. Local
publication is complete and PR #18 is Ready for Review; no merge, tag, release or deployment was
performed or authorized.
