# P02 Independent Read-only Review

Review scope: committed implementation `deaa555f865861886a480d8ca1c744a4b6becfd4`, frozen Node
Control API 1.0.0 Configuration/Runtime Control schemas, P02 acceptance boundary, Control/Runtime
authority matrix, migrations and generated verification evidence. The review made no product-code
changes.

## Blocking

None.

## Major

None.

## Minor

None.

## Accepted

- Configuration Revision content is canonicalized, SHA-256 protected, size/depth bounded and rejects
  plaintext secret-shaped fields. Published content is immutable in PostgreSQL.
- Control PostgreSQL exclusively owns Revision/Application and Desired/Observed state. Runtime
  PostgreSQL exclusively owns Active/LKG snapshots, durable Ack delivery and immutable Task pins;
  neither adapter writes the other database.
- Publish updates Desired but does not claim Applied. Runtime Ack alone advances Observed and the
  Management Operation; a rejected or partially applied Revision cannot overwrite Active/LKG.
- ETag/If-Match, idempotency receipts, target-scoped advisory locks and CAS generation checks close
  duplicate and concurrent publish races. The real integration proves exactly one concurrent
  publish succeeds.
- Runtime startup falls back to persisted LKG when Control is unavailable. Corrupt, stale,
  immutable and restart-required revisions are rejected or held without replacing the LKG, and Ack
  failures remain durable for later drain.
- Watch is hint-only SSE; authoritative recovery always re-reads Latest. Redis owns no Revision,
  Application, Active/LKG, Ack or Task-pin authority.
- P02 supplies the reusable Runtime source/store/applier boundary and verifies it with the real
  Control API and two real PostgreSQL authorities. Target-specific LLM, SMPP and Telemetry appliers
  remain P03, P04 and P11 scope; no placeholder production applier is claimed.

Verdict: 0 Blocking, 0 Major, 0 Minor; P02 is acceptable for evidence publication.
