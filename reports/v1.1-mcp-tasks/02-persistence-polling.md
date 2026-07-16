# v1.1 MCP Tasks Phase 2 — Persistence and Polling

Status: **passed for Phase 2 scope**. This is not final v1.1 acceptance.

## Delivered increment

- PostgreSQL is authoritative for `RemoteTaskBinding`, ordered Provider observations, idempotent control events and every `tasks/get` protocol attempt. Binding records keep distinct local/remote IDs and exact Task, Goal, Context, Plan, Workflow definition/instance, actual node-run, MCP invocation, protocol/schema and execution-mode correlation.
- BullMQ stores only `{bindingId, expectedVersion}`. Jobs use `attempts: 1`, retain completed/failed evidence, expose dead letters and require explicit operator retry after Worker failure.
- Polling re-reads inside the shared same-context serial gate, claims with PostgreSQL version/token/lease CAS, and reduces the response with the claimed version. A stale Job cannot call the Provider; a delayed older Provider response is retained as rejected evidence and cannot roll state backward or create a control.
- Only Provider unreachability backs off and schedules a new binding version. Invalid contract/protocol/session outcomes quarantine without fabricating a Provider terminal state.
- `input_required`, `completed`, `failed` and `cancelled` snapshots atomically create one pending control event and stop ordinary polling. Phase 2 does not consume the event or resume LangGraph.
- The Server uses one `ContextSerialExecutor` for ordinary Task and remote Poll Workers, reconciles at startup and periodically, and leaves ordinary `PROCESS_EXECUTION_LOST` startup behavior unchanged.
- Migration 0100 is fail-closed behind explicit acknowledgement and a disposable `sdar_v11_*` database. The default runtime path remains released through 0056, preventing the 0100 high-water mark from skipping future hardening migrations.

## Reproducible focused evidence

```text
pnpm format:check                         PASSED
pnpm lint                                 PASSED
pnpm typecheck                            PASSED
pnpm verify:architecture                  PASSED, 183 TypeScript files
pnpm test:unit                            PASSED, 51 files / 227 tests
pnpm test:contract                        PASSED, 7 files / 65 tests
pnpm test:integration                     PASSED, 4 files / 48 tests
pnpm verify:migrations                    PASSED
pnpm verify:infra                         PASSED, 56 repository migration pairs
pnpm verify                               PASSED, 149344 ms, dirty=true
                                          292 unit/contract, 48 integration,
                                          42 E2E, build and both smoke stages
```

Migration evidence covers released empty/0049 paths and isolated V1.1 empty, 0056 upgrade, rollback/reapply, default-no-0100 and non-isolated fail-closed paths. Real integration covers admission uniqueness, live/simulation/replay preservation, concurrent claim CAS, exact Redis payload/delay/deduplication, queue-client restart, dead-letter retention/manual retry, Provider-unreachable backoff/recovery, terminal-control idempotency and stale-Provider audit-only behavior.

The unified machine report is `reports/verification/summary.json`; it records `2026-07-16T00:48:08.959Z` through `2026-07-16T00:50:38.303Z`. `dirty=true` is expected for this pre-commit phase evidence and is disclosed rather than represented as a clean release-tag gate.

## Evidence classification

**Real local verification:** PostgreSQL/pgvector and Redis/BullMQ run in containers; migrations create/drop disposable databases and execute actual SQL; queue and Worker tests use real Redis. The metadata contract uses the official MCP v2 Client over real loopback Streamable HTTP.

**Simulated Provider behavior:** deterministic readers and the loopback Mock Provider produce remote states, revisions, progress, transport unreachability and recovery. No external production Provider or credentials are used.

**Unverified:** Phase 3 availability/timing; Phase 4 Workflow admission, `waiting_external`, control consumption and process-restart no-replay; Phase 5 input/cancel outcomes; Phase 6 management Console and all-scenario release acceptance.

The production Workflow-to-binding admission path remains deliberately disconnected: accepting a remote result without a durable continuation would violate the immutable Workflow and no-replay requirements. Phase 4 owns that connection.
