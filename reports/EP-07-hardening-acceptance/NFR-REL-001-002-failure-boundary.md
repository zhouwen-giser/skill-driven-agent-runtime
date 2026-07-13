# NFR-REL-001/002 Queue and Failure Boundary

Date: 2026-07-13

## Outcome

NFR-REL-001 is verified from the completed EP-04 recovery increment. Queued BullMQ work remains Redis-authoritative across queue-client restart, while startup recovery atomically fails persisted executing/paused/evaluating Tasks and running/paused Workflow instances with `PROCESS_EXECUTION_LOST` before the Worker starts. No checkpoint or external call is replayed.

NFR-REL-002 remains developing. `attempts: 1`, `maxStalledCount: 0`, retained failed jobs, model fail-fast behavior, and startup no-retry behavior are implemented. This increment adds a direct real-Redis integration scenario whose processor fails after a representative side effect and must be called exactly once, with `attemptsMade: 1` and a retained failed Job. Docker/Redis is unavailable, so that new assertion is defined but not executed.

## Evidence

- Historical `pnpm test:integration` passed real PostgreSQL recovery and real Redis/BullMQ queued-job retention.
- Historical `pnpm test:e2e` proved a lost LangGraph checkpoint does not reconstruct or replay preceding MCP work.
- `apps/server/src/runtime.ts` invokes recovery before constructing/starting the queue Worker.
- `packages/runtime-redis/src/bullmq-context-queue.ts` fixes queue and Job attempts to one, retains completion/failure, and disables stalled retries.
- `packages/application/test/plan-preparation-processor.unit.test.ts` and model-runtime/E2E evidence fail configured model stages without a fallback.
- Current format, lint, and strict typecheck pass for the new Worker-failure integration assertion.
- Current `pnpm verify` passes: 54 files/240 unit+contract tests, 165-file architecture guard, protocol/OpenAPI/source/migration/license gates, and production Server/Console builds.

## Classification

- Real historical: PostgreSQL, Redis/BullMQ queue-client restart, startup transaction, retained job options, Server composition, and no-replay E2E.
- Simulated historical: process loss starts from authoritative persisted running records before invoking the exact production startup operation.
- Unverified current: the new thrown-Worker single-attempt Redis scenario and an operating-system kill during a live external MCP socket.

The OS-kill socket case is not required for NFR-REL-001 verification because V1 explicitly refuses recovery; the persisted-state startup operation and no-replay E2E prove the required externally observable outcome. NFR-REL-002 is not promoted until its direct Worker-failure scenario executes.
