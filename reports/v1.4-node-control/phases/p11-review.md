# P11 Independent Read-only Review

Review scope: P11 candidates `a53b4fb`, `363c3d1` and post-remediation `93a901e`; frozen
Telemetry Export 1.0.0 public/internal routes; Control/Runtime authority separation; Runtime
Active/LKG, outbox, retry, ACK and status persistence; endpoint transport; focused and full
verification. Each Review pass was read-only. Repairs were made only after the Review ended.

## Blocking

None.

## Major

None open. Two Major findings were closed:

- `/api/v1/telemetry-export/test` now resolves the newest `applied` revision for the local node;
  a newer unpublished Draft cannot be activated by a connection test.
- Runtime capture is limited by the exact remaining durable outbox capacity, so a batch cannot
  overshoot `outboxPolicy.maxPendingRecords` when the queue is already near its high watermark.

## Minor

None.

## Accepted

- Control reuses the P02 `telemetry_link` Configuration Revision authority and persists only
  command Operation/Audit facts; Runtime owns Active/LKG, cursor, outbox, retry and ACK state.
- Credential material is resolved only from an `env:` reference at the Runtime transport boundary;
  endpoints reject URL userinfo, redirects and non-loopback plaintext HTTP.
- Exact ACK bounds are enforced. Failed delivery retains authoritative records, advances bounded
  retry state and never changes Task state.
- Record families are allowlisted at capture time; an endpoint outage degrades only export status.
- The frozen API exposes configuration, revision commands, status and connection test only. There
  is no telemetry query, timeline, evaluation, reconciliation or ClickHouse route.
- Final focused regressions and the exact-commit full gate pass after both Major repairs.

Verdict: 0 Blocking, 0 Major, 0 Minor. P11 is acceptable for evidence publication.
