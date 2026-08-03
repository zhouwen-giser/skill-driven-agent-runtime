# ADR-126: v1.4.1 Canonical Evidence Clean Cutover

- Status: Accepted
- Date: 2026-08-04
- Scope: SDAR v1.4.1 Canonical Evidence Export

## Context

SDAR v1.4 merged migrations `0142_v14_telemetry_export` and
`0143_v14_node_event_projection` into `main` at base commit `cc0719f`. The current export is limited
to `runtime_event` summaries and does not satisfy the canonical evaluation evidence contract. The
v1.4.1 task requires clean-slate product semantics and offers two migration strategies: rewrite
0142/0143 only if unpublished and mutable, or preserve them and append a clean cutover.

Repository evidence proves that 0142/0143 are published ancestors of `origin/main`. The migration
gate records and validates incremental SHA-256 checksums, so rewriting either file would create
checksum drift and violate the monotonic ledger.

## Decision

Use Strategy B:

1. Preserve migrations 0142 and 0143 byte-for-byte.
2. Append the next Runtime migration to retire/remove the old `runtime_telemetry_export_*`
   structures and create the `sdar.evidence/v1` persistence structures.
3. Update the clean baseline and seed to the canonical evidence design.
4. Do not migrate old Telemetry rows and do not dual-write old and new contracts.
5. Make `sdar.evidence/v1` the sole external evidence contract.
6. Keep Runtime PostgreSQL authoritative for delivery state/outbox/checkpoint/DLQ/manifest;
   Control PostgreSQL remains authoritative for Control facts, projected without a distributed
   transaction.

## Consequences

The migration history remains reproducible and upgrade tooling can observe an explicit clean
cutover. Existing pre-v1.4.1 Telemetry data is intentionally not converted or replayed. Rollback of
the new migration restores the v1.4 schema only for development verification; the product does not
offer old-contract compatibility or dual operation.

## Rejected alternatives

- Rewrite 0142/0143: rejected because they are published and checksum-protected.
- Preserve the old exporter alongside canonical evidence: rejected because it creates two external
  contracts and ambiguous authority.
- Cross-database transaction between Runtime and Control: rejected because it violates authority
  boundaries and operational reliability.
