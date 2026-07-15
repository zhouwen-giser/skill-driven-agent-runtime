# ADR-077: Provider Task Authority and Local Binding

## Status

Accepted on 2026-07-16.

## Context

MCP Providers own remote execution while SDAR owns an A2A Task, Goal and immutable Workflow. Treating either system's Task as the other system's record would make restarts, cancellation, input and audit ambiguous. Existing `mcp_invocation.task_id` is an SDAR Agent Task ID and cannot safely double as a remote identity.

## Decision

- The Provider is authoritative for remote Task admission, status, requested input and final result.
- PostgreSQL is authoritative for SDAR's `RemoteTaskBinding`, observations, controls, availability snapshots and continuation snapshot.
- `serverId` is the v1.1 provider identity. Records use explicit `agentTaskId` and `remoteTaskId` fields.
- A binding includes immutable Workflow plan/instance/node and stable `workflowNodeRunId`, Skill lineage, invocation, execution context, credential/session revision and invalidation/terminal metadata.
- Observations and controls are append-only/idempotent dedicated records. `runtime_event` is a derived operator projection only.
- SDAR never infers that a local timeout or cancellation request changed the Provider's state. Only an acknowledged/observed Provider transition does so.

## Consequences

Remote state can be reconciled after local process restart without claiming to recover ordinary running Workflows. Storage and APIs must keep local and remote identities explicit, and stale Provider events remain auditable but cannot mutate invalidated or terminal local state.

## Rejected Alternatives

- Duplicate `providerId` beside existing `serverId`: creates two authority identifiers with no V1 source of truth.
- Store only the latest Provider status: loses ordering, deduplication and failure analysis.
- Use `runtime_event` as authority: summaries are insufficient for exact wire/control replay protection.
