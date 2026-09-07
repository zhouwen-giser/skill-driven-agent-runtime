# Unified wait timeout evidence

Date: 2026-07-12

## Delivered

- One managed timeout for plan-confirmation and supplementary-input waits.
- PostgreSQL configuration and atomic timeout cancellation/audit.
- Same-process scheduler with restart-safe, database-derived eligibility.
- Trusted-intranet management read/update API and OpenAPI contract.
- A2A projection of timed-out Tasks as standard canceled state.

## Reproducible evidence

- `pnpm test:unit`: policy validation and deterministic cutoff calculation.
- `pnpm test:integration`: real PostgreSQL atomic Task cancellation plus runtime event.
- `pnpm test:contract`: management read/update API.
- `pnpm test:e2e`: set one-second policy, submit a real A2A Task, wait at confirmation, observe automatic cancellation and `TASK_WAIT_TIMEOUT`, then restore the default policy.

## Verification classification

- Real: PostgreSQL policy/transaction, runtime scheduler, management HTTP and A2A Task projection.
- Simulated: fixed-stage local model brings the Task to the confirmation boundary.
- Not verified: wall-clock behavior across an operating-system suspend; overdue persisted waits are designed to expire on the first later scan.
