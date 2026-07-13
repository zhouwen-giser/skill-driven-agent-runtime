# NFR-REL-001/002 Queue and Failure Boundary

Date: 2026-07-13

## Outcome

NFR-REL-001 is verified from the completed EP-04 recovery increment. Queued BullMQ work remains Redis-authoritative across queue-client restart, while startup recovery atomically fails persisted executing/paused/evaluating Tasks and running/paused Workflow instances with `PROCESS_EXECUTION_LOST` before the Worker starts. No checkpoint or external call is replayed.

NFR-REL-002 is verified against its exact acceptance: Task faults, Worker faults, and model failures cannot cause a whole-Task retry or policy-driven duplicate side effect. The historical real Redis/BullMQ gate exercised production Jobs with `attempts: 1`; startup recovery and real MCP E2E prove interrupted work is failed rather than reconstructed or replayed; the real model-runtime E2E proves an upstream 503 creates exactly one failed invocation without fallback. `maxStalledCount: 0` and retained failed Jobs preserve the same production boundary.

## Evidence

- Historical `pnpm test:integration` passed real PostgreSQL recovery and real Redis/BullMQ queued-job retention.
- Historical `pnpm test:e2e` proved a lost LangGraph checkpoint does not reconstruct or replay preceding MCP work.
- Historical `reports/EP-03-workflow-planner-runtime/model-runtime-increment.md` proves an upstream 503 creates exactly one failed invocation without fallback through the real loopback model protocol and PostgreSQL audit.
- `apps/server/src/runtime.ts` invokes recovery before constructing/starting the queue Worker.
- `packages/runtime-redis/src/bullmq-context-queue.ts` fixes queue and Job attempts to one, retains completion/failure, and disables stalled retries.
- `packages/application/test/plan-preparation-processor.unit.test.ts` and model-runtime/E2E evidence fail configured model stages without a fallback.
- Current focused fail-fast regression passes 2 files/11 tests across plan preparation and model runtime.
- Current `pnpm verify` passes: 54 files/242 unit+contract tests, 165-file architecture guard, protocol/OpenAPI/source/migration/license gates, and production Server/Console builds.

## Classification

- Real historical: PostgreSQL, Redis/BullMQ queue-client restart, startup transaction, retained job options, Server composition, and no-replay E2E.
- Simulated historical: process loss starts from authoritative persisted running records before invoking the exact production startup operation.
- Unverified current: repetition of the new thrown-Worker single-attempt Redis scenario and an operating-system kill during a live external MCP socket.

The OS-kill socket case is not required for NFR-REL-001/002 verification because V1 explicitly refuses recovery. The exact NFR-REL-002 acceptance does not prescribe a live process-kill experiment; the real single-attempt Job behavior, startup failure boundary, no-replay MCP result, and exactly-one failed model invocation directly prove the required externally observable outcome. The newer thrown-Worker scenario remains a stronger current Docker repetition and is not represented as executed evidence.
