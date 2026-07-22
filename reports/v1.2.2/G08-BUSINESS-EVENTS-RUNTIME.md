# G08 Business Events Runtime Client

## Summary

Status: **completed**. Provider-level subscriptions now admit validated events and their receive cursor
atomically to PostgreSQL, while processing advances an independent cursor. Generation, continuity and
relation state survive process restart.

## Implementation and invariants

- `ProviderSubscriptionCoordinator` owns reconnect/backoff/health and calls
  `BusinessEventSubscriptionService`; registration starts the coordinator through the same runtime
  path used by Management API.
- Inbox insert/deduplication and `lastDurablyAdmittedSequence` commit together. Claim/failure/retry and
  `lastProcessedSequence` are separate, so processing failure cannot roll back reception.
- A drained closed generation becomes `retired`; discovery then selects the Provider's current
  generation and its earliest available sequence. Continuity records are idempotent.
- Relation resolution persists immutable pages and completeness. Expired tokens and incomplete
  relations fail closed. Backpressure is bounded and health becomes ready after a durable Ack.

## Validation

The runtime unit suite passed 5 durable-admission, restart/deduplication, generation/continuity,
relation and retry cases. PostgreSQL integration passed 3 Business Events persistence cases. The real
HTTP/PostgreSQL runtime E2E passed discovery → Ack → Inbox → impact processing. Real Provider runtime
evidence is intentionally separate under `reports/v1.2.2-interop`.

## Acceptance

AC-052 through AC-059 are verified.

## Reproduction

```text
pnpm exec vitest run --project unit packages/application/test/business-events.unit.test.ts
pnpm exec vitest run --project integration packages/persistence-postgres/test/user-goal-runtime.integration.test.ts
pnpm exec vitest run --project e2e apps/server/test/business-events-runtime.e2e.test.ts
```

