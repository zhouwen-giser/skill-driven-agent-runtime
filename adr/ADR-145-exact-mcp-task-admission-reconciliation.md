# ADR-145: Exact MCP Task admission reconciliation

Status: Accepted (2026-08-31)

## Context

A mutating Frozen MCP `tools/call` can commit at the Provider and lose its response before SDAR
records the Task Handle. Reissuing the operation without an exact identity can create a second
physical action. The existing Runtime already journals admission before transport and owns remote
Task lifecycle, continuation and evidence in PostgreSQL, but an uncertain journal had no exact
reconciliation path.

The source-locked SMPP Provider contract guarantees that repeating the exact task-execution
idempotency identity first reconciles its durable admission. It returns the original Task, or a
bounded not-found, conflict or unavailable outcome; it does not authorize a fresh dispatch while an
uncertain admission exists.

## Decision

Derive one logical invocation identity from immutable Task, Goal, Workflow, node run, Provider,
operation, canonical arguments and execution-context authority. Persist that identity before
transport together with the exact reconciliation contract and a precomputed Workflow continuation
checkpoint.

An ambiguous mutating call is marked `uncertain`. Runtime may then use only the reconciliation port;
it may not fall through to the normal dispatch port. Every reconciliation result is append-only. A
`found_exact` result must match the persisted logical identity, intent revision, request hash and
remote Task before the original invocation receipt may be recorded and the existing admission,
`RemoteTaskBinding` and LangGraph continuation path resumed. `not_found`, `conflict`, `unavailable`
and `deferred` remain fail-closed and never redispatch.

Keep `RemoteTaskBinding` protocol-neutral. Persist a separate
`RemoteTaskProviderExecutionLink/v1` companion relation with frozen Runtime Server, Node Control
Provider Binding origin, SMPP Source/external Server lineage, source revision, and optional Provider
execution/Mission identities. Missing `externalExecutionId` or `deviceMissionId` remains explicitly
unresolved; neither value is inferred from a Task ID, Provider completion, Telemetry, or private
Provider storage.

Project the logical identity, admission, uncertainty, reconciliation and companion relation through
the existing `sdar.evidence/v1` outbox. These facts are observational and cannot change Task, Goal or
physical-success authority. Provider Task completion remains distinct from business outcome, Goal
verification and physical success.

## Consequences

- PostgreSQL remains the only Runtime system of record; no second Task or Workflow runtime is added.
- LangGraph.js remains the only Workflow execution runtime.
- The Frozen adapter owns wire mapping; Domain/Application models contain no external SDK types.
- Rollback is refused while reconciliation or companion authority rows exist.
- The external SMPP implementation and schema hashes are frozen in
  `reports/sdar-smpp-mcp-tasks-consumer-sync-v0.1/smpp-producer-handoff-lock.json`.
- The current public wire does not expose a Provider execution or Device Mission identity for the
  observed rejected simulation call. Runtime records the companion as unresolved and does not
  fabricate either relation.
