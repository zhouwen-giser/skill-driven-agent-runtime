# EP-SDAR-V1.3-P02 — Artifact Persistence, Registry and Governance

Status: IN PROGRESS

Branch: `feature/v1.3-sequential-implementation`

## Purpose

Implement P02/G02-G04 as the PostgreSQL authority for immutable Artifact versions, validation,
approval, active pointers, execution evidence and governance. Produce the six frozen Ports without
adding an Experience Compiler, request-path Runtime, API controller, Console, Skill/MCP/A2A call or
second workflow authority.

## Frozen Inputs and Contract Versions

- P01 `READY_FULL` Handoff: `reports/goal/v1.3-p01-handoff.json`.
- Consumed at 1.1 with exact hashes: `CompiledArtifact`, `ArtifactLineage`,
  `ArtifactRuntimeBinding`.
- Produced at 1.1: `ArtifactRepository`, `ArtifactValidationRepository`,
  `ArtifactExecutionRepository`, `ArtifactRegistryService`, `OperatorIdentityPort`,
  `ArtifactGovernancePort`.
- Registry: 1.1 /
  `d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`.
- Canonical table, event, queue and feature-flag names come only from P02 `CONTRACT-LOCK.json`.

## Authority Boundary

- PostgreSQL is the only durable Artifact, Approval, Active Pointer and audit authority.
- Redis/cache/index data is rebuildable and cannot make an activation decision.
- Domain continues to own Artifact data and lifecycle legality.
- Application owns frozen Ports, registry coordination, operator authorization and governance.
- PostgreSQL adapters own SQL, transactions, CAS, locking, outbox writes and row mapping.
- No P03 pattern mining, P04 candidate generation, P05 replay, P06 promotion policy or online request
  integration is implemented.

## Progress

- [x] 2026-07-27 P02 self-check passed for 20 files and exact registry hash.
- [x] 2026-07-27 P01 Handoff, all three consumed hashes, baseline ancestry and zero blockers verified.
- [x] 2026-07-27 Read migration, repository, CAS, outbox and audit patterns.
- [x] 2026-07-27 Implement G02 migration and repository contracts/adapters.
- [x] 2026-07-27 Verify fresh/rollback/reapply, immutable round-trip, CAS activation race and
      invalid-state reject.
- [x] 2026-07-27 Implement and test G03 Registry/projection/outbox/flags.
- [x] 2026-07-27 Implement and test G04 identity/RBAC/governance/audit/idempotency.
- [x] 2026-07-27 Run working-tree full gate and contract alignment.
- [x] 2026-07-27 Create meaningful implementation commit `591cbe4` and pass the same full gate with
      `dirty=false`.
- [x] 2026-07-27 Obtain first independent read-only review: `REJECTED` with 4 Blocking, 6 Major and
      1 Minor finding.
- [x] 2026-07-27 Remediate evidence binding, tenant authorization, monotonic Pointer CAS, late
      Outbox delivery, immutable projections, aggregate revisions, complete rebuild and JSON bounds.
- [x] 2026-07-27 Pass focused post-remediation type/contract/unit, 18-migration replay and five real
      PostgreSQL integration scenarios in an isolated database.
- [x] 2026-07-27 Pass the post-remediation working-tree full gate: 795 unit/contract, 89 integration,
      62 E2E, 447-source architecture, migration replay, build and both smokes.
- [x] 2026-07-27 Commit the first remediation as `ee52158` and pass the complete gate with
      `dirty=false`.
- [x] 2026-07-27 Obtain second independent read-only review: `REJECTED` with 1 Blocking, 2 Major and
      0 Minor findings.
- [x] 2026-07-27 Replace shared Outbox acknowledgement with database-sequenced consumer-private
      cursoring, invalidate version cache for all projection lifecycle events and enforce/compare
      immutable Lineage creation time.
- [x] 2026-07-27 Pass focused typecheck/lint/unit/contract, migration rollback/reapply and seven
      real PostgreSQL integration scenarios including actual mixed-event Server startup.
- [x] 2026-07-27 Pass the second-remediation working-tree complete gate: 795 unit/contract,
      91 integration, 62 E2E, 447-source architecture, 18-migration replay, build and both smokes.
- [x] 2026-07-27 Commit second remediation as `e740fa1` and repeat the complete gate with
      `dirty=false` in 173,409 ms.
- [x] 2026-07-27 Obtain third independent read-only review: `REJECTED` with 1 Blocking and no
      Major/Minor findings because IDENTITY allocation order is not commit order.
- [x] 2026-07-27 Replace IDENTITY allocation with a trigger that acquires a transaction-scoped
      relevant-event lock before assigning the private cursor value; add concurrent blocker/order
      regression.
- [x] 2026-07-27 Pass focused typecheck/lint/contract, 18-migration fresh/rollback/reapply and
      eight real PostgreSQL integration scenarios for the third remediation.
- [x] 2026-07-27 Pass the third-remediation working-tree complete gate: 795 unit/contract,
      92 integration, 62 E2E, 18 migrations, architecture/A2A/OpenAPI/Replay, build and both smokes.
- [ ] Create an exact third-remediation commit and repeat the complete gate with `dirty=false`.
- [ ] Finalize evidence and exact Handoff after independent review.
- [ ] Obtain new independent read-only review, clean-commit gate and push.

## Changed Files

- `infra/postgres/migrations/0125_v13_artifact_authority.{up,down}.sql`
- `packages/application/src/compiler/`
- `packages/persistence-postgres/src/compiler/`
- focused unit/integration/architecture tests
- ADR-117 and P02 evidence/status records

## Migrations

Migration 0125 creates exactly the ten canonical P02 tables, required constraints/indexes and
extends the existing management audit operation constraint for Artifact governance. It reuses
`cognitive_runtime_outbox`; no second outbox authority is created. A generated
`outbox_sequence` is assigned only after a relevant-event transaction acquires the P02 advisory
lock; the lock is retained through commit, making cursor order commit-visible order without claiming
the shared `published_at`. Down migration refuses destructive rollback while any P02 authority row
or Artifact management audit exists.

## Tests

- Package self-check and upstream evidence/hash validation.
- Migration apply, rollback, reapply and idempotency through the existing migration verifier.
- Repository round-trip and immutable version conflict.
- simultaneous activation CAS: exactly one winner and one Active Pointer.
- validation/approval evidence and status failure cases.
- audit actor, permission, reason, idempotency and expected-version cases.
- Registry cache miss/hit, rebuild and duplicate outbox consumption.
- Mixed handled/unhandled Outbox events through actual Server startup without shared publication.
- format, lint, typecheck, unit, contract, integration, architecture and complete `pnpm verify`.

## Failed Attempts

- A first complete gate reached integration after all prior stages passed, then two test files raced
  to create the fresh database extension. `applyRuntimeMigrations` now takes a session advisory lock.
- The next integration run exposed existing shared-database file parallelism: another suite
  truncated the P02 audit/outbox rows mid-test. Integration files are now serialized while the
  within-file double-activation concurrency test remains real and unchanged.
- The rollback regression exposed the existing Outbox uniqueness rule for repeated activation of an
  immutable version. Active Pointer revision now drives Outbox aggregate revision; no constraint or
  assertion was weakened.
- The first second-remediation integration run retained an obsolete expectation that Approval was
  not a projection lifecycle event. The expectation was corrected to distinguish handled Approval
  from unhandled execution/feedback events; implementation behavior and delivery assertions were
  not weakened.
- The third independent review demonstrated that IDENTITY allocation can precede commit visibility.
  The cursor allocator now obtains a transaction-scoped relevant-event advisory lock before reading
  the current maximum and assigning the next value; rolled-back values are safely reusable and a
  later transaction cannot publish a higher cursor first.
- The first formatting command included SQL files unsupported by the configured Prettier parsers and
  exited before verification; supported files were formatted and the subsequent diff/type/lint/
  contract command passed.
- The host has no standalone `psql` binary. The exact isolated database was instead created through
  the healthy repository Compose PostgreSQL service; no operator database was modified.

## Review Findings

The first independent review rejected `591cbe4`; its exact decision is preserved in
`reports/goal/v1.3-p02-review-1.md`. The remediation keeps the Pointer row as a monotonically
versioned tombstone, binds current validation/approval and trusted tenant evidence in PostgreSQL,
uses database insertion sequence rather than client timestamps as delivery authority, and rebuilds
all projection pages while clearing version caches. The second independent review rejected
`ee52158`; its exact decision is preserved in `reports/goal/v1.3-p02-review-2.md`. The second
remediation gives the projection consumer a private cursor without mutating shared publication,
invalidates lifecycle caches and makes Lineage creation time an immutable checked projection. The
third independent review rejected `e740fa1`; its exact decision is preserved in
`reports/goal/v1.3-p02-review-3.md`. Third remediation serializes cursor allocation through relevant
transaction commit visibility. A new independent reviewer must assess all remediation rounds after
the complete gate.

## Completion

Third remediation working-tree complete evidence passes; exact clean commit, new independent review
and final evidence remain pending.

## Handoff

Must conform to the exact 28-field standard envelope, contain six frozen `packageOutputs`, identify
migration 0125 and enumerate only canonical Ports/events/queues/flags. Downstream is P03.
