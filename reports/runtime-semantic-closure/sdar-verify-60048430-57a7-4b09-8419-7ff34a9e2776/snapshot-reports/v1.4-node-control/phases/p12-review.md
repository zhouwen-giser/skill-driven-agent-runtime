# P12 Read-only Review

Review scope: P12 implementation `7eb5b83`, full-verify candidate `a787cbf`, frozen organization
profile and Node Events contracts, Control/Runtime persistence, RBAC, SSE and TaskSummary projection.
The final Review phase was read-only; repairs were made only after earlier Review passes ended.

## Blocking

None.

## Major

None open. Three Major findings were closed:

- SSE polling now respects response backpressure, resumes on `drain` and never writes after close.
- The organization event stream now merges the required Runtime readiness and Task-binding facts
  through a durable high-watermark cursor; Redis is not event authority.
- The frozen organization `task.read` profile now has real list/detail TaskSummary projections,
  excludes request/user/workflow internals and marks every conditional control action unavailable.

## Minor

None open. Two Minor findings were closed:

- Node Profile ETags hash Node identity instead of placing raw Node IDs in a response header.
- PostgreSQL event cursors remain decimal strings through comparisons and are not truncated through
  JavaScript `Number` conversion.

## Accepted

- Node Profile revisions are immutable after publication; draft validation/publication use
  contiguous revision CAS, opaque ETags and request-hash idempotency receipts.
- Node Events contain only resource/change hints, stable Event ID, aggregate revision and
  correlation. Reconnect uses `Last-Event-ID`; authoritative state comes from GET.
- Organization RBAC is a strict frozen GET allowlist. Configuration, internal providers, raw Skill
  or Artifact content, telemetry internals, Audit and writes remain forbidden.
- Runtime source synchronization failure is logged as a stable safe code and leaves durable Control
  events readable. Health reports unprobed Runtime reachability as degraded rather than healthy.
- No organization tree, multi-node orchestrator, second event stream, Console BFF or page-specific
  DTO was introduced.
- Focused tests, 149 real integrations, migration verification, architecture/frozen-contract gates
  and exact-commit full verification all pass after remediation.

Verdict: 0 Blocking, 0 Major, 0 Minor. P12 is acceptable for evidence publication.
