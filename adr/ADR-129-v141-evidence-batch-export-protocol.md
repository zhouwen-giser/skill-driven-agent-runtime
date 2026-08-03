# ADR-129: v1.4.1 Evidence Batch Export Protocol

- Status: Accepted
- Date: 2026-08-04
- Scope: Configuration, delivery and HTTP transport for `sdar.evidence/v1`

## Context

The v1.4 Telemetry Export surface transported `runtime_event` summaries and used a distinct wire
contract. Canonical Evidence already has stable record identities, hashes and PostgreSQL delivery
authority, so retaining that surface would create two external contracts and ambiguous ACK state.
The replacement must remain non-blocking for Task execution while failing closed on invalid
configuration, payloads and acknowledgements.

## Decision

1. `sdar.evidence/v1` is the only external evidence export contract. Requests carry
   `x-sdar-evidence-contract: sdar.evidence/v1`; the old Telemetry header, payload and routes are
   forbidden.
2. A batch is canonical JSON with a SHA-256 `batchHash`, a single export/partition, a bounded
   contiguous sequence range and canonical Evidence records. The canonical request limit is
   262,144 bytes.
3. The receiver must return an explicit string `lastAcknowledgedSequence`. Empty, numeric,
   authority-shaped, out-of-batch, regressing or gap-skipping responses fail closed. Partial ACK is
   valid only for a contiguous prefix of the exact sent batch.
4. The service obtains a PostgreSQL lease, sends a bounded batch, records exact export/fencing send
   ownership and then advances ACK. PostgreSQL owns configuration projection, pending state,
   retries, DLQ and status. Redis may wake work only; the receiver owns none of these facts.
5. All required record families are always enabled. Configuration may exclude only cataloged
   Diagnostic record types. Credentials are opaque `env:` or `secret:` references and are never
   stored inline.
6. Delivery uses HTTPS except for verified loopback HTTP, rejects redirects and user-info, bounds
   request/response sizes and timeouts, and treats endpoint failure as degraded export health.
   Task execution and its authoritative rows remain unaffected.
7. Control's existing `configuration_revision.target_type=telemetry_link` value is retained only as
   an internal database compatibility key. It is not an external Telemetry contract or authority.

## Consequences

Delivery is at least once and may repeat a batch after response loss. A receiver must therefore use
stable record IDs and hashes idempotently. An explicit ACK is required even for a successful HTTP
status. Endpoint outage accumulates durable pending/error state but cannot fail or roll back a Task.
The 256 KiB limit applies to the complete canonical body, so batching may choose a smaller prefix
than the configured record-count limit.

## Rejected alternatives

- Treat HTTP 204 as ACK: rejected because it loses the exact durable cursor.
- Mark ACK before exact send ownership: rejected because a stale worker could skip records.
- Use the whole catalog as the configured required shape: rejected because required families and
  optional diagnostics have different policy.
- Keep a legacy Telemetry endpoint or dual write: rejected because `sdar.evidence/v1` is sole.
- Let Redis or the sink own the run/cursor: rejected because both are non-authoritative.
