# ADR-091: Versioned Remote Task Polling and Isolated Persistence

## Status

Accepted on 2026-07-16.

## Context

Phase 2 must continue observing Provider-owned MCP Tasks after Redis or process restart without replaying `tools/call`, reviving an ordinary running A2A Task, or making Redis authoritative. A single `{bindingId, expectedVersion}` BullMQ Job is not sufficient by itself: concurrent Workers can both call `tasks/get`, a Worker can die after claiming work, and the Provider can return an older snapshot after a newer observation was already accepted.

The v1.1 `0100+` migration range also cannot be applied to the normal development database before the complete v1.0.13 migration chain exists. The current high-water runner would otherwise skip future `0057`–`0099` migrations.

## Decision

- PostgreSQL owns `RemoteTaskBinding`, ordered observations, control inbox events and protocol-attempt records. Redis carries only `{bindingId, expectedVersion}` and is rebuildable.
- A Poll Job enters the existing shared same-context serial gate, re-reads the binding, and claims it with a collision-resistant token and bounded lease. Claiming increments the binding version. Snapshot/failure reduction requires the claim token plus claimed version and atomically clears the lease while incrementing the version again.
- A claim that outlives its Worker becomes eligible only after lease expiry. The Reconciler then schedules the current PostgreSQL version; it never resends `tools/call` or resumes LangGraph.
- BullMQ uses `attempts: 1`, retains completed/failed Jobs and has no automatic retry. Provider unreachability is an application-level new-version Poll with bounded exponential backoff. Failed Jobs at the current version remain queryable dead letters until an explicit retry; a database version advanced after the failure is reconciled independently.
- Provider `lastUpdatedAt` is the monotonic ordering fact; namespaced `remoteRevision` and `eventId` provide deduplication/correlation. Older snapshots are stored as rejected observations and cannot change binding or create control events.
- `input_required`, `completed`, `failed` and `cancelled` create one idempotent control event in the same transaction as the accepted observation and stop ordinary polling. Phase 2 does not consume those events.
- Network/unreachable, invalid contract and incompatible protocol/session outcomes are distinct. Only unreachable outcomes preserve polling and back off. Invalid contract/protocol outcomes quarantine the binding without changing Provider status or fabricating a terminal result.
- `workflowPlanId`, `workflowDefinitionId` and `workflowDefinitionVersion` are stored explicitly. The existing model has no separate Workflow Plan version, so the implementation does not invent one. LangGraph assigns every actual node execution a deterministic `workflowNodeRunId`; no SDK or LangGraph object crosses the domain boundary.
- The Server composition root supplies one `ContextSerialExecutor` to ordinary Task and remote Poll work. This is a single-process V1 guarantee, not a distributed lock claim.
- Migration `0100_remote_mcp_task_tracking` creates four authority tables. Until v1.0.13 is merged, it is available only through the explicit `v1.1-isolated` profile, an acknowledgement flag and a disposable database whose name begins `sdar_v11_`. The default migration profile stops at the released chain and rejects a database that already contains `0100+`.
- Binding stores a non-secret credential revision reference and exact protocol/schema session revisions. It never stores Headers, plaintext credentials, stack traces or model reasoning.

## Consequences

Redis clearing, enqueue-after-commit gaps and process restart can be repaired from PostgreSQL. A crash after claim is bounded by lease expiry, while delayed old Worker responses remain audit-only. Ordinary executing/evaluating Workflows retain the existing `PROCESS_EXECUTION_LOST` behavior; a `waiting_external` recovery exemption is not introduced until Phase 4 has a validated continuation snapshot.

The temporary isolated migration profile adds an explicit development-only path and an additional verification script. Phase 6 must still prove the supported exact v1.0.13-to-0100 upgrade and remove or revise the pre-release guard.

## Rejected Alternatives

- BullMQ retries or a long-running polling Promise: violates attempts=1 and is not restart-authoritative.
- Store remote state only in Redis or `runtime_event`: creates a second source of truth and loses exact ordering/CAS evidence.
- Claim without a lease/token or without version advance: permits concurrent calls and cannot heal a retained failed Job after process loss.
- Treat every adapter error as Provider unreachability: would hot-loop malformed or incompatible responses.
- Apply `0100` to the normal `sdar` database now: can permanently skip later hardening migrations.
- Exempt any Task with a binding from startup failure: falsely claims recovery of ordinary running Workflow execution.
