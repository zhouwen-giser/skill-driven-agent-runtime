# EP — SDAR SMPP MCP Tasks Runtime Consumer Sync v0.1

## Purpose / Outcome

Extend the existing Frozen MCP Tasks path so an uncertain mutating `tools/call` can be reconciled to
the one original Provider Task after response loss or process restart, without replaying the physical
operation. Preserve the existing PostgreSQL `RemoteTaskBinding`, continuation and Canonical Evidence
authorities while adding a durable Provider execution companion relation.

## Requirements Covered

- Task-package gates G01–G22 from `SDAR_MCP_Tasks_Runtime_Consumer_Sync_Codex_Goal_Package_v0.1`.
- Existing baseline: FR-MCPT-001..014, FR-MCP-004/005/009, NFR-REL-001, NFR-OBS-001 and
  v1.4.1 Canonical Evidence MCP lifecycle coverage.
- Target cases: UGV-NODE-001, UGV-CORE-001, UGV-MCP-003 and UGV-XCHAIN-003.

## Context and Orientation

- `packages/domain/src/remote-task.ts` owns protocol-neutral remote Task lifecycle authority.
- `packages/application/src/remote-task-admission-recovery.ts` owns the durable pre-dispatch receipt
  boundary and recovery orchestration.
- `packages/mcp-adapter/src/frozen-v1-*` owns Frozen MCP wire mapping.
- `packages/persistence-postgres/src/remote-task-admission-intent-store.ts` owns the current admission
  journal; PostgreSQL is the system of record.
- `packages/runtime-control-application` and `packages/domain/src/evidence` own Canonical Evidence
  projection and identity. Evidence remains observational and cannot mutate Task authority.
- The exact external Producer handoff is recorded in
  `reports/sdar-smpp-mcp-tasks-consumer-sync-v0.1/smpp-producer-handoff-lock.json`.

## Architecture and Interfaces

1. Domain adds a stable logical invocation identity and a separate
   `RemoteTaskProviderExecutionLink`. The latter never replaces or extends the lifecycle authority of
   `RemoteTaskBinding`; optional Mission identity remains unresolved unless explicitly observed.
2. Application adds an exact reconciliation port returning only `found_exact`, `not_found`,
   `conflict`, or `unavailable`, plus an orchestration service that never calls the normal dispatch
   port while an admission is uncertain.
3. PostgreSQL stores logical identity, reconciliation attempts and the companion relation with unique
   constraints that make one logical invocation map to at most one remote Task and external execution.
4. The Frozen adapter implements the reconciliation port only for the source-locked SMPP contract.
   Its repeated wire request is classified as reconciliation, not retry, because the Provider's
   frozen idempotency journal performs a side-effect-free lookup before any possible start. A missing,
   conflicting or unavailable result never authorizes redispatch.
5. Existing admission materialization and continuation services consume the recovered exact receipt;
   LangGraph.js remains the sole Workflow runtime.
6. Canonical Evidence projects stable logical identity, reconciliation, execution-link and later
   continuation/verification facts from Runtime PostgreSQL only.

## Progress

- [x] 2026-08-31 06:32Z Verified package SHA-256 inventory and read all package artifacts.
- [x] 2026-08-31 06:32Z Confirmed SDAR base exactly equals `b0caf69e9f83bc6702e1c0a85e7ca158c3781d4b`.
- [x] 2026-08-31 06:32Z Source-locked SMPP Producer commit `1e67e6e421d70a3cbce2d41bf5007e99463712fe` and frozen contract hashes.
- [x] 2026-08-31 07:30Z Completed R0 gap audit and source-lock reports.
- [x] 2026-08-31 07:30Z Implemented R1 stable logical invocation identity.
- [x] 2026-08-31 07:40Z Implemented R2 durable exact reconciliation and crash recovery.
- [x] 2026-08-31 07:40Z Implemented R3 Provider execution companion relation.
- [x] 2026-08-31 07:45Z Implemented R4 source-locked Frozen adapter integration.
- [x] 2026-08-31 07:45Z Implemented R5 Canonical Evidence closure.
- [x] 2026-08-31 11:47Z Completed R6 full repository, migration, E2E, TCK, performance,
      production-build and smoke gates with `pnpm verify` (exit 0).
- [x] 2026-08-31 11:49Z Regenerated the formal 105-record downstream handoff with
      `fullVerify=passed`; contract and coverage verification both pass.
- [x] 2026-08-31 11:49Z Completed traceability, project status, changelog and final handoff
      evidence without invoking a Provider or Device.

## Discoveries and Surprises

- Current admission intent is persisted before transport, but a transport failure transitions it to
  terminal `uncertain`; startup recovery does not revisit that state.
- The current Frozen client exposes only normal `tools/call` and `tasks/get`. The external SMPP
  Runtime nevertheless has a source-locked idempotency/reconciliation boundary: repeating the exact
  identity enters Provider reconciliation and cannot redispatch an uncertain existing admission.
  SDAR must isolate this behind a reconciliation-only port rather than call the normal dispatch API.
- Existing `McpInvocation` identity is random but persisted. The task package additionally requires a
  content-derived logical identity and hash so process identity and transport attempt identity cannot
  be confused.
- The public Frozen MCP wire does not expose `externalExecutionId` or `deviceMissionId` for the
  observed Provider path. The companion relation therefore records exact Binding/Source origin but
  truthfully leaves those two identities unresolved.
- The actual southbound simulation attempt was rejected with `UGV_EXECUTION_MODE_UNSUPPORTED`; no
  remote Task, movement or Mission was created. That fact is retained as an external qualification
  result and is not converted into Goal or physical success.

## Decision Log

- 2026-08-31: Treat Producer diagnostic schemas plus exact implementation commit as the handoff lock;
  do not read Producer private PostgreSQL or Telemetry.
- 2026-08-31: Keep `RemoteTaskBinding` unchanged as lifecycle authority and add a companion relation.
- 2026-08-31: A `not_found` reconciliation result remains blocked; it never falls through to a new
  physical dispatch.
- 2026-08-31: Scope remote Task uniqueness by Runtime Server plus remote Task ID; different Providers
  may legitimately reuse the same opaque Task ID.
- 2026-08-31: Persist Provider execution lineage as a separate immutable relation with Node Control
  Binding/SMPP origin snapshots; do not extend the lifecycle aggregate.

## Implementation Steps

1. Add domain constructors and unit tests for logical identity and execution link invariants.
2. Add an append-only migration and PostgreSQL repositories for reconciliation attempts/links.
3. Extend the admission journal with recoverable uncertain state and exact reconciliation outcomes.
4. Add the application reconciliation service and Frozen adapter port implementation.
5. Compose startup recovery before normal queue processing; materialize the recovered original Task
   through the existing admission and continuation path.
6. Add Canonical Evidence schemas/projectors and source coverage for new authoritative records.
7. Exercise normal, response-loss, crash-before/after-reconcile, conflict and unavailable cases.

## Validation

- Focused format, ESLint, TypeScript and domain/application/adapter unit tests.
- Real PostgreSQL migration/repository integration including repeat and concurrent reconciliation.
- Frozen protocol contract tests and response-loss E2E proving one Provider start and one binding.
- Existing remote Task lifecycle, cancellation, continuation and Canonical Evidence regressions.
- `pnpm verify:architecture`, production build, migration-path verification and `pnpm verify`.

## Idempotence and Recovery

All identities are canonical and restart-stable. Repeating a successful exact reconciliation returns
the same stored outcome. Conflict, unavailable and not-found outcomes remain explicit durable attempts.
No recovery path calls the ordinary mutating dispatch method. Migration rollback is allowed only when
no new relation/journal rows remain; the down migration must fail safely otherwise.

## Artifacts and Evidence

- `reports/sdar-smpp-mcp-tasks-consumer-sync-v0.1/source-lock-observed.json`
- `reports/sdar-smpp-mcp-tasks-consumer-sync-v0.1/smpp-producer-handoff-lock.json`
- `reports/sdar-smpp-mcp-tasks-consumer-sync-v0.1/r0-gap-audit.md`
- `reports/sdar-smpp-mcp-tasks-consumer-sync-v0.1/acceptance-gates.csv`
- `reports/sdar-smpp-mcp-tasks-consumer-sync-v0.1/test-report.md`
- `reports/sdar-smpp-mcp-tasks-consumer-sync-v0.1/final-report.md`
- `reports/v1.4.1-evidence/clickhouse-handoff/contract-manifest.json`
- `reports/v1.4.1-evidence/clickhouse-handoff/schema-hashes.json`

## Outcomes and Retrospective

Implementation and qualification are complete. The final self-managed `pnpm verify` run passed in
1,472,233 ms: 326 bootstrap test files / 2,838 tests, 40 PostgreSQL/Redis integration files / 228
tests, seven E2E files / 73 tests, the official A2A TCK, 44/44 Canonical Evidence scenarios,
performance thresholds, production build and all three smoke gates. Migration verification covers 68
Runtime migrations through `0175_v14_mcp_task_consumer_sync` and the formal Evidence contract is
105/105 implemented and verified (100/100 Required, 5/5 Diagnostic). The implementation performed no
Provider, Device or navigation action and does not infer Goal or physical success from Provider
completion. G01–G22 are PASS and the downstream adapter handoff is ready for intake.
