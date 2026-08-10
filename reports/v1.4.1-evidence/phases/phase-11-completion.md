# Phase 11 Completion

- Phase: 11
- Goal: Evidence operations, durable recovery and operator runbook
- Base SHA: `0868821`
- Runtime authority: PostgreSQL owns recovery requests, claims, actions, completion, DLQ requeue,
  coverage reconciliation and retention progress; Redis remains wake-only
- Management path: authenticated Node Control API -> durable Control ManagementOperation and
  STARTED Audit -> typed Runtime internal API -> durable Runtime recovery run -> terminal Control
  operation and distinct terminal Audit
- Public surface: six metadata-only reads and three recovery commands; no payload, arbitrary SQL,
  ClickHouse query proxy, credential or endpoint disclosure
- RBAC: Viewer/Operator/Security/Admin reads; only Node Admin and Security Admin recover;
  Organization Service is denied
- Recovery: record/source-partition/episode replay, DLQ retry, coverage reconcile, restart resume and
  bounded Diagnostic retention
- Protocol: 77 files / 29 schemas / 94 public operations / 37 internal operations / 131 total
  operation IDs
- Registry: 100 total / 95 Required / 5 diagnostic / 100 durable projection; registry hash
  `sha256:2bc75460820a778830bc1c787afa74a4f71571b9658b8dd496b495e528c85567`
- Direct real vertical: 1/1 passed against PostgreSQL `55484`, Redis `56384` and real HTTP APIs
- Direct export-status recovery: 2/2 previously blocked immutable batches projected successfully
- TypeScript: `pnpm.cmd typecheck` passed before the final two narrow schema/lineage corrections;
  the final repository-wide typecheck remains part of the Phase 14 gate
- Independent Review: Blocking 0 / Major 0 / Minor 0 / Accepted
- Full verify: not rerun by explicit user direction; the single next repository-wide `pnpm verify`
  remains scheduled for Phase 14
- Blockers: none for Phase 11 implementation or handoff
- Next phase: required vertical-scenario acceptance

## Functional closure

- Migration `0148_v14_evidence_operations_recovery` adds durable recovery runs, coverage targets,
  claim leases and retained DLQ requeue audit state with a complete down migration.
- Recovery request persistence, claim and action/terminal persistence use separate commits. Startup
  and the bounded maintenance loop resume `requested` or `running` work after interruption.
- Every action rechecks the exact active export ID and revision. Replay uses the active family and
  Diagnostic filters, and delivery frontiers are recalculated only over the same eligible scope.
- A coverage reconcile remains running until its persisted targets are consumed through the real
  `EpisodeEvidenceCoverageService`; it is never marked successful from an outcome count alone.
- Diagnostic retention deletes at most 1,000 ACKed, expired and eligible rows per transaction.
  Full batches keep the same durable run active across maintenance ticks until drained.
- Node Control commits a running governance intent before invoking Runtime. Transport ambiguity
  leaves that intent running and safely re-drives the idempotent Runtime operation rather than
  recording a false failure.
- The recovery runbook documents endpoint outage, High Watermark, DLQ, projection, coverage,
  retention, backup/restore, credential rotation and rollback procedures.

## Validation and first-failure evidence

- The real vertical first exposed that the Runtime telemetry pending query selected `created_at`
  while its outer predicate read `last_observed_at`. Selecting the real retry clock restored the
  delivery/ACK observation path.
- A test-only audit query initially used PostgreSQL `digest()` although the Control database does
  not install `pgcrypto`; the assertion now uses the unique operation authority directly.
- The outage assertion had assumed `runtime:episodes` must be the first failed delivery partition.
  It now proves the actual contract: an active partition records endpoint unavailability, the
  outage Task's Runtime Episode remains unacknowledged, and both Tasks remain completed.
- The recovery ManagementOperation then exposed a real schema defect: `canonicalValue` already
  includes `null`, so wrapping it in a second nullable `oneOf` rejected the valid running intent.
  The generated schema now uses the single canonical value definition.
- The passing vertical still surfaced a durable `evidence.export_status` issue. Its Catalog had
  required a checkpoint for an export delivery partition, which is not a projector source. The
  exact lineage now references the same immutable batch's `node_control.telemetry_delivery`; the
  two preserved failed batches then projected 2/2 through the production source, schema gate and
  PostgreSQL writer.

## Independent read-only review

- Blocking: none.
- Major: none.
- Minor: none.
- Accepted: durable restartable recovery, exact active scope, bounded retention continuation,
  metadata-only APIs, Control-owned RBAC/audit, transport-ambiguity replay, canonical nullable
  ManagementOperation result and batch-exact Export Status lineage.

Phase 11 is closed for implementation and handoff. Phase 12 may start; the final repository-wide
verification remains intentionally deferred to Phase 14.
