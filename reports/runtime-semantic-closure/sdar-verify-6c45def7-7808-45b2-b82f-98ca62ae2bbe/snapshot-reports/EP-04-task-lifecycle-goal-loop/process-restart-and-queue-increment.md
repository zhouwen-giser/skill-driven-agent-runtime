# Process restart and queue evidence

Date: 2026-07-12

## Delivered

- Atomic startup failure of executing/paused/evaluating Tasks and running/paused Workflow instances.
- Stable `PROCESS_EXECUTION_LOST` audit and preserved execution history.
- BullMQ attempts fixed at one with no stalled retry.
- Queued Redis jobs survive queue-client restart and execute after a Worker starts.

## Reproducible evidence

- `pnpm test:integration`: real PostgreSQL transaction fails both Task and Workflow instance; real Redis/BullMQ tests prove same-context serialization, `attempts=1`, and queued-job retention across client restart.
- `pnpm test:e2e`: lost LangGraph checkpoint never reconstructs/replays preceding MCP work; the real MCP no-replay confirmation scenario remains green.

## Verification classification

- Real: PostgreSQL, Redis, BullMQ queue restart, transaction results, retained job options, and server composition startup hook.
- Simulated: process loss is represented by authoritative persisted running/paused records before invoking the same startup recovery operation.
- Not verified: operating-system kill during a live external MCP socket; V1 intentionally does not recover such work.
