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
- [ ] Create the meaningful implementation commit and pass the same full gate with `dirty=false`.
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
`cognitive_runtime_outbox`; no second outbox authority is created. Down migration refuses destructive
rollback while any P02 authority row or Artifact management audit exists.

## Tests

- Package self-check and upstream evidence/hash validation.
- Migration apply, rollback, reapply and idempotency through the existing migration verifier.
- Repository round-trip and immutable version conflict.
- simultaneous activation CAS: exactly one winner and one Active Pointer.
- validation/approval evidence and status failure cases.
- audit actor, permission, reason, idempotency and expected-version cases.
- Registry cache miss/hit, rebuild and duplicate outbox consumption.
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

## Review Findings

Pending the required new independent read-only P02 review.

## Completion

Implementation complete; independent review, clean-commit gate and final evidence remain pending.

## Handoff

Must conform to the exact 28-field standard envelope, contain six frozen `packageOutputs`, identify
migration 0125 and enumerate only canonical Ports/events/queues/flags. Downstream is P03.
