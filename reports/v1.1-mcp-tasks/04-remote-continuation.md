# v1.1 MCP Tasks Phase 4 — Remote Continuation

Status: **Phase 4 increment verified**. This report does not claim Phase 5 lifecycle handling or final v1.1 acceptance.

## Intended increment

- A remote MCP Task ends the active LangGraph invocation with a typed `waiting_external` result. PostgreSQL stores a bounded, versioned frontier snapshot; Redis stores only a one-attempt control reference.
- Continuation uses a fresh LangGraph invocation with `Command({ update, goto })`. It never replays `START`, completed nodes, prior side effects, or an old process-local checkpoint.
- Waiting predecessors do not satisfy a parallel join. Other ready branches may finish, and persisted predecessor-arrival evidence permits the fresh invocation to join exactly once.
- Terminal control events are claimed idempotently and validated against Task, Goal, plan, Workflow, node-run, binding, snapshot and state-version authority. Observation-only events never start a graph invocation.
- Child Skill Workflows finish their own continuation before their parent `skill_call` is resumed. The child instance is persisted before its lineage row and before LangGraph execution.
- Goal Patch and Goal cancellation invalidate active/building snapshots and every uninvalidated binding for the affected Goal version, including an admitted binding not yet mapped to a snapshot. Late controls are audit-only.
- Running continuation work has `attempts=1` and is not recovered or automatically retried. Pending PostgreSQL inbox work is reconciled back to BullMQ after Redis or process restart.

Architecture decision: `adr/ADR-093-persisted-frontier-remote-task-continuation.md`.

## Reproducible verification

```text
pnpm format:check               PASS
pnpm lint                       PASS
pnpm typecheck                  PASS
pnpm test:unit                  PASS — 61 files / 362 tests
pnpm test:contract              PASS — 8 files / 79 tests
pnpm test:integration           PASS — 6 files / 72 tests
pnpm test:e2e                   PASS — 2 files / 48 tests
pnpm verify:architecture        PASS — 212 TypeScript source files
pnpm verify:management-openapi  PASS — 107 operations
pnpm verify:migrations          PASS — released + isolated V1.1 through 0102
pnpm build                      PASS
pnpm verify                     PASS — 153,461 ms
```

The unified machine report is `reports/verification/summary.{json,md}`. It also passed 441 combined unit/contract tests, A2A 1.0.1 baseline/TCK evidence, 18 V1 acceptance scenarios, 66 runtime migrations, license/SBOM/source gates, infrastructure smoke and Server/Console smoke. The report truthfully records `dirty=true` because the gate ran before the Phase commit.

## Evidence classification

**Real local verification:** PostgreSQL migration/repository/CAS/lease/attempt/invalidation tests; Redis/BullMQ deduplication, queued-state inspection and no-retry behavior; full PostgreSQL/Redis integration, A2A/model/MCP E2E regression, production build, migrations and both smoke gates.

**Simulated verification:** deterministic remote handles and terminal controls; fresh LangGraph process-boundary simulation; parallel frontier and child Workflow continuation; injected queue, persistence, Provider and activation failures. No production Provider was contacted.

**Unverified:** external production MCP Provider interoperability; Phase 5 `input_required`, `tasks/update`, complete cancellation acknowledgement/uncertainty and final business-result mapping; Phase 6 lifecycle UI/API and all 16 MCP Tasks acceptance scenarios.

## Requirement evidence boundary

- Verified in Phase 4: FR-MCPT-007; the continuation-consumer portion of FR-MCPT-008; NFR-MCPT-002 continuation serialization/no-retry; the Phase 4 portion of NFR-MCPT-003; continuation trace for NFR-MCPT-004; AC-MCPT-04/05/14/15 continuation behavior; the invalidation/late-control portion of AC-MCPT-16.
- Still partial across phases: FR-MCPT-008 remains partial until `input_required` is connected in Phase 5; NFR-MCPT-001/003/004 remain cross-phase; AC-MCPT-04/14 require the final Phase 6 process-restart acceptance run.
- Outside this report: FR-MCPT-012–014 and Phase 5 Provider lifecycle outcomes.
