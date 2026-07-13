# NFR-PERF-001 Context Concurrency

Date: 2026-07-13

## Delivered

- BullMQ Worker has an explicit exported default concurrency of 10.
- Every dequeued Job passes through `ContextSerialExecutor` keyed by exact `context_id` before application processing.
- Same-context operations form a strict tail chain, including failure-safe release in `finally`; different contexts do not share a tail.
- PostgreSQL remains the Task/Goal source of truth; the serializer is an in-process scheduling guard, not a second state store.

## Verification

Real deterministic unit verification:

- One test starts exactly 10 distinct contexts concurrently, proves maximum application activity reaches 10, and queues a second operation for every context.
- Every context independently records `first:start, first:end, second:start, second:end`; active count per context never exceeds one and all 20 results remain unique to their context.
- The existing two-context test independently proves a blocked context does not prevent another context from completing.
- Target unit tests, strict typecheck, and lint pass.
- Unified `pnpm verify` passes with 54 unit/contract files and 222 tests plus all architecture, OpenAPI, source-pin, Compose-static, SBOM/license, and production-build gates.

Implemented but unverified:

- A Redis/BullMQ integration scenario now uses 20 Worker slots to force ten same-context tails into the serializer while ten first-wave contexts are active. It asserts maximum application concurrency 10 and exact per-context ordering.
- The isolated Redis integration command produced no test output and timed out after 49 seconds while Docker/Redis remained unavailable. Same-process E2E is likewise unverified.

NFR-PERF-001 remains `开发中` until the real Redis integration and full same-process concurrency acceptance scenario pass reproducibly.
