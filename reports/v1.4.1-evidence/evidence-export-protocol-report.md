# Evidence Export Protocol Report

## Result

Phase 4 replaces the v1.4 Telemetry configuration, service, routes, client and HTTP transport with
the sole `sdar.evidence/v1` batch export path. Runtime PostgreSQL remains the authority for
configuration projection, outbox, leases, exact sent ownership, ACK, retry and DLQ state. Redis is
wake-only and the HTTP receiver is non-authoritative.

## Contract and configuration

- Header: `x-sdar-evidence-contract: sdar.evidence/v1`.
- Request: one export and partition, contiguous first/last sequence, canonical Evidence records and
  canonical SHA-256 `batchHash`.
- ACK: an explicit string `lastAcknowledgedSequence`; it must name a record in the sent batch and
  may advance only through its contiguous prefix.
- Required record families cannot be omitted. Only catalog Diagnostic record types may be excluded.
- Credentials are opaque `env:` or `secret:` references. Request bodies are bounded to 262,144
  bytes and responses to 4,096 bytes.
- HTTPS is mandatory except for verified loopback HTTP. Redirects, URL user-info, non-loopback
  cleartext endpoints, invalid UTF-8, empty ACKs and oversized bodies fail closed.

## Delivery ordering and outage behavior

The application acquires a fenced partition lease, reads a bounded pending prefix, computes the
canonical batch/hash, sends it, records exact `exportId`/fencing-token ownership, and applies the
validated ACK. Partial ACK leaves the suffix pending. A response-loss retry is safe because record
identity and payload hashes are stable. Delivery failure updates retry/DLQ state transactionally
and reports degraded status; the real acceptance test proves already-completed Tasks remain
completed and Active/LKG configuration remains retained after the sink is stopped.

## Verification

- Focused Unit: 3 files / 21 tests passed.
- Focused Contract: 3 files / 71 tests passed; the final adapter-only rerun passed 7 tests.
- Focused PostgreSQL: 2 files / 11 tests passed after repair.
- Real Control + Runtime PostgreSQL + Redis + local HTTP receiver vertical: 1/1 passed.
- Node Control frozen-contract verifier: 76 files, 28 schemas, 111 operations, 20 events and 7
  fixtures passed.
- Architecture: 654 TypeScript source files passed.
- Full `pnpm verify`: passed in 601,088 ms with 1,207 static Unit/Contract tests, 158 Integration,
  72 E2E, 37 migrations, build and every smoke stage.

## Preserved failed attempts

1. The first real PostgreSQL focused run passed 10/11. Failure retry tried to update a delivery
   state row that did not yet exist. The state write was changed to an atomic upsert; 11/11 passed.
2. The first full gate passed Unit/Contract/build prerequisites but the Node Control manifest held
   the pre-repair Evidence configuration-schema hash after the batch limit was aligned. The
   manifest was regenerated deterministically and its verifier passed.
3. The next full gate reached the migration stage but the sandbox could not read Docker's user
   configuration and attempted an image pull. This was an execution-permission failure, not a
   product failure. The user-authorized escalated rerun used the existing isolated PostgreSQL and
   Redis services and passed all eight verification stages.

## Scope

No source-family projector is claimed by this phase; implementation/verification coverage remains
0/100 until Phases 5-10. No ClickHouse component, OTel path, second runtime, merge, tag, release or
deployment was introduced.
