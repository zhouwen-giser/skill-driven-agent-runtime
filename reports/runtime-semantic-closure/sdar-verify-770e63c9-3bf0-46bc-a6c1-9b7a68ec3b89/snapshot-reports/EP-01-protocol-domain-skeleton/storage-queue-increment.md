# EP-01 Storage and Queue Increment

Date: 2026-07-11 19:04 +08:00

## Result

The domain/application core, PostgreSQL repositories and Redis/BullMQ context queue form a runnable vertical increment. The bootstrap gate passes 26 unit/contract tests, and the dedicated integration runner passes 5 tests against real digest-pinned containers.

## Real verification

- PostgreSQL migration `0002_protocol_domain` is idempotent.
- ConversationContext, AgentTask and RuntimeEvent are persisted and mapped back to domain-owned values.
- Updating a task does not create a second system-of-record row.
- Same-context operations never overlap; a different context progresses while the first is blocked.
- BullMQ jobs have `attempts=1`; a queued job survives queue-client close/reopen and is processed by a later Worker.

## Remaining

The official A2A endpoint still uses the EP-00 compatibility executor. Wiring it to TaskService, full lifecycle endpoints and the official TCK remain required before EP-01 completion.
