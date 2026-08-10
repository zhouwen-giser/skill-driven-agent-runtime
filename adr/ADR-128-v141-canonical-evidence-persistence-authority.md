# ADR-128: v1.4.1 Canonical Evidence Persistence Authority

- Status: Accepted
- Date: 2026-08-04
- Scope: Runtime persistence and delivery state for `sdar.evidence/v1`

## Context

Canonical evaluation Evidence is derived from existing Runtime and Control business authorities,
but its capture, delivery and recovery state must survive process restart and endpoint outage. The
old P11 Telemetry tables did not model stable Evidence identity, independent source checkpoints,
partition leases, exact send ownership, bounded ACK, dead letters or episode completeness. Redis
cannot safely own any of those facts because it remains an ephemeral wake/queue/cache service.

## Decision

1. Runtime PostgreSQL exclusively owns Evidence export configuration, outbox records, source
   checkpoints, per-export/partition state, dead letters, projection issues, quality issues and
   episode manifests in migration `0144_v14_canonical_evidence`.
2. Capture is idempotent for the same stable record ID and payload hash and fails closed if that ID
   is reused with different content. A database sequence supplies monotonic delivery order.
3. Source checkpoints are independent by family and partition. Callers may append in their own
   transaction so a failed business transaction cannot leave committed Evidence.
4. High Watermark rejection records durable operational state without mutating source business
   facts or invoking a network sink.
5. Delivery leases use monotonically increasing fencing tokens. Marking a record sent persists the
   exact export ID and fencing token; ACK may advance only across a contiguous prefix owned by that
   send and may be partial. Regression, unsent gaps and beyond-sent ACK fail closed.
6. Dead-letter records retain an outbox reference. Required projection failures cannot be reduced
   to diagnostics, and an episode manifest cannot become complete while required Evidence is
   pending, failed or missing.
7. Redis may wake a projector or exporter but owns no Evidence payload, cursor, lease, ACK,
   manifest, issue or run authority.
8. The old P11-named repository is only a Phase 3 compatibility projection over these canonical
   tables. Phase 4 removes that application/wire surface; it does not create a second authority.

## Consequences

Runtime execution remains non-blocking when a downstream sink is unavailable, while delivery can
resume deterministically after restart without duplicate semantic records or stale-worker writes.
Database growth, retention and exporter backpressure must be managed explicitly. Cross-database
Control facts are projected without a distributed transaction and expose their source identity and
checkpoint rather than pretending to be Runtime-owned business data.

## Rejected alternatives

- Redis-owned offsets or leases: rejected because Redis is ephemeral and wake-only.
- A global cursor: rejected because one source family could hide or skip another.
- ACK by high sequence alone: rejected because it could acknowledge unsent gaps.
- Delete on dead letter: rejected because it destroys the canonical payload and audit trail.
- Continue writing old Telemetry tables: rejected because it creates dual authority and contract.
