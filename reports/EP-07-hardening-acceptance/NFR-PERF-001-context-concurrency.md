# NFR-PERF-001 Context Concurrency

Date: 2026-07-13

## Acceptance reconciliation

The SRS requires one instance to support approximately 1–10 concurrent active Tasks, strict serialization for one `context_id`, and a concurrency test that remains stable without conversation-state crossover. It does not prescribe Redis as the only admissible test layer.

## Delivered

- The BullMQ Worker has an explicit default concurrency of 10.
- Every dequeued Job passes through `ContextSerialExecutor` keyed by exact `context_id` before application processing.
- Same-context operations form a strict failure-safe tail chain; different contexts do not share a tail.
- PostgreSQL remains the Task/Goal source of truth; the serializer is only the production scheduling guard.

## Reproducible evidence

Current real deterministic regression:

- `pnpm exec vitest run packages/runtime-redis/test/context-serial-executor.unit.test.ts packages/application/test/task-service.unit.test.ts`
- Result: 2 files and 12 tests passed.
- The scale test starts exactly 10 contexts together, observes maximum active work of 10, queues one tail for every context, and proves per-context active count never exceeds one, exact event ordering, and 20 unique non-crossed results.
- Unified `pnpm verify`: 54 files and 240 tests passed with architecture and production-build gates.

Historical real infrastructure evidence:

- EP-01's digest-pinned Redis/BullMQ integration ran the production Worker/serializer path and proved same-context operations never overlap while a different context progresses.
- EP-01 also passed real HTTP/PostgreSQL/Redis/BullMQ E2E and production smoke, demonstrating that application Task dispatch uses that Worker path.

## Classification

NFR-PERF-001 is verified against its exact concurrency/stability/no-crossover acceptance criterion. The newer 20-Job Redis scenario that forces ten tails through one Worker is implemented but has not been rerun while Docker is unavailable; it remains a current regression gap rather than a requirement-evidence gap.
