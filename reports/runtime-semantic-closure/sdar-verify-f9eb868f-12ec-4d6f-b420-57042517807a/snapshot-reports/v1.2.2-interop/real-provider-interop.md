# SDAR v1.2.2 Real Provider Interop

Status: **passed** on SDAR candidate `325b8d0d9efeb1b02f758399c44eafd3a4351a40`.

## Exact boundary

- Provider Requirements Contract: V0.5.2, required ancestor
  `ee14d2fa2b5130d3c7c016c71737175a124d5134`.
- Provider Runtime Candidate: exact isolated archive commit
  `8a81b1b02971fb124ed96372c440c449f9087c99`.
- Transport: real Streamable HTTP POST/SSE; no Frozen Mock was used.
- Persistence: two disposable PostgreSQL databases owned by this run; Redis was the SDAR local test
  instance.
- External Provider source worktree: read-only and untouched. It independently moved to `375927d` while
  this Goal was active, so the test deliberately used an exact archive instead of that moving tree.

## Passing matrix

- Discovery reported Task protocol `2026-07-28`, Business Events Profile `1.0` and mixed continuity.
- Empty stream/Ack passed.
- 260 real Provider Tasks were created; real Task and Resource Events were received.
- Stable Relation pagination returned 260 items as 128/128/4.
- SDAR durably admitted at least three events before processing.
- Closed-generation drain replayed four messages and advanced to a new current generation.
- Reset preserved Provider code `BUSINESS_EVENT_STREAM_RESET`.
- Provider unavailability preserved typed code `BUSINESS_EVENTS_TRANSPORT_FAILED`.
- Provider restart/discovery and SDAR reconnect passed; eight reconnects were observed.

Machine evidence: `real-provider-interop.json`.

## Claims

`Real Interop Passed` is supported for this exact candidate pair. `Profile 1.0 Frozen` is only claimed
for the vendored requirements contract/assets; a different Provider runtime commit is not implicitly
qualified.

## Reproduction

Use an exact archive of the Provider commit, two databases whose names match the script's disposable
prefix guard, and run:

```text
pnpm exec tsx scripts/run-v122-real-provider-interop.mjs
```

