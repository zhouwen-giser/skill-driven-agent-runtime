# Phase 3 Canonical Evidence Persistence Report

## Cutover

Migration `0144_v14_canonical_evidence` implements Strategy B after immutable 0142/0143. It drops
the three `runtime_telemetry_export_*` product tables, migrates no development rows, and creates:

- `evidence_export_configuration`
- `evidence_outbox`
- `evidence_source_checkpoint`
- `evidence_export_state`
- `evidence_dead_letter`
- `evidence_projection_issue`
- `evidence_quality_issue`
- `episode_evidence_manifest`

The down migration restores the exact 0142 table shape so the repository migration verifier can
perform complete rollback/reapply. Reapplying 0144 again performs a clean cutover.

## Invariants

- `record_id` and the full non-null source/schema identity tuple are independently unique.
- Same stable ID and payload hash returns the original sequence; a different hash fails closed.
- `bigserial` supplies monotonic durable sequence; pending work uses a partial partition/time/index.
- Checkpoints are keyed by `(source_family, source_partition)` and reject cursor regression.
- Export state is keyed by `(export_id, source_partition)` with lease owner/token/expiry and a
  monotonically increasing fencing token.
- ACK cannot exceed the sent boundary or regress; partial ACK remains legal.
- High Watermark rejects further Evidence capture and durably records the condition after the
  capture transaction rolls back. It performs no network call and does not mutate Runtime facts.
- Required projection issues cannot be diagnostic-only; complete manifests cannot retain pending,
  failed, or missing required Evidence.
- DLQ rows reference retained outbox records and cannot silently lose the source payload.
- Redis owns no Evidence record, cursor, lease, ACK, manifest, issue, or run authority.

## Real PostgreSQL evidence

- Focused integration: 2 files / 11 tests passed on isolated PostgreSQL 17.10.
- Scenarios: fresh apply, concurrent duplicate, hash conflict, caller rollback, High Watermark,
  independent cursors, cursor regression, lease fencing, partial/invalid ACK, projection issue,
  early manifest completion rejection, DLQ, restart recovery, rollback/reapply.
- Guarded `db:reset:v1.4.1` rebuilt `sdar_v141_phase3_reset`, applied 37 post-baseline migrations,
  produced zero fabricated outbox rows, and left all old Telemetry tables absent.
- Migration verifier passed fresh/idempotent apply, guarded reset, full rollback/reapply, frozen
  v1.2.3 logical upgrade, interruption rollback, rogue ledger, representative-data preservation,
  and incremental SHA-256 drift rejection through 0144.

## Full gate

`pnpm verify` passed in 553,810 ms in operator-managed isolated infrastructure mode:

- static Unit/Contract/build: 185 files / 1,198 tests;
- migration head: 0144, 37 post-baseline migrations;
- Integration: 31 files / 158 tests;
- E2E: 6 files / 72 tests;
- infrastructure, server/console, and Node Control API/worker smoke: passed.

The verification report truthfully records the tested pre-commit SHA `beb6168` and dirty working
tree. Exact committed-SHA verification is a later publication gate.

## Retained failures and repairs

1. Focused integration first ran 5/8: High Watermark state rolled back with its exception, and an
   ambiguous projected sequence alias broke pending/restart reads. State persistence moved after
   capture rollback and SQL columns became explicit; rerun passed.
2. Migration verification first rejected 0144 because the verifier used the wrong PostgreSQL-
   truncated unique-constraint name. The real constraint was present; the verifier now checks its
   actual name and rerun passed.
3. Full integration first timed out because the isolated Redis was mapped to 56441 while frozen
   legacy tests use 56379. The same isolated Redis service was remapped to the repository contract
   port; unchanged tests reran 158/158 passed.
4. Pre-commit semantic review found ACK could rely on a high sequence without proving every earlier
   record was sent. Outbox now persists exact export/fencing send ownership, ACK rejects unsent
   gaps, a regression test passes, and the full gate was rerun after the repair.

## Deferred boundary

The Phase 3 P11 compatibility class projects authoritative `agent_task` rows as canonical
`runtime.episode` records into the sole Evidence outbox. It preserves intermediate full-gate
operation without old tables or dual write. Phase 4 removes the old Telemetry API/Domain/Transport
name and `x-sdar-telemetry-contract` wire protocol; it is not claimed complete here.
