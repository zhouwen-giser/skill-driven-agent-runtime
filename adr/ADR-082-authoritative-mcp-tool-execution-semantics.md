# ADR-082: Authoritative MCP Tool execution semantics

- Status: Accepted
- Date: 2026-07-16
- Supersedes: none

## Context

The runtime needs stable Tool execution semantics for planning, confirmation, simulation/replay
audit, invocation evidence and Skill Tool Policy inspection. MCP SDK types must remain behind the
transport adapter, Tool annotations are explicitly hints, and an LLM-generated enhancement cannot
become execution authority. The v1.0.11 requirement orders sources as an available MCP discovery
declaration, then an administrator override, then conservative unknown values.

## Decision

The MCP domain owns `McpToolExecutionSemantics`, containing effect, execution, cancellation,
idempotency, replay and source. Every registered Tool has an effective, complete snapshot. The
registry also retains the MCP-declared snapshot and the administrator override separately so a
refresh can replace protocol discovery data without discarding administrator input.

Resolution follows the requirement order for the complete snapshot:

1. use a validated MCP declaration when discovery provides any authoritative protocol field;
2. otherwise use a validated administrator override;
3. otherwise use the complete `unknown` snapshot.

Consequently an administrator override is retained but dormant while an MCP declaration exists,
and becomes effective if a later discovery no longer declares semantics. This makes the stated
source priority observable and refresh-safe.

The official SDK adapter translates protocol-neutral declarations as follows:

- `execution.taskSupport` maps `forbidden`, `optional`, and `required` to `synchronous`,
  `task_capable`, and `task_required`;
- explicit Tool annotation values map `readOnlyHint: true` to `read_only`, and
  `readOnlyHint: false` or `destructiveHint: true` to `side_effecting`;
- the optional `_meta["io.sdar/tool-execution-semantics"]` object may declare the five exact SDAR
  values and takes precedence over weaker protocol hints inside the MCP-declared snapshot;
- absent fields remain `unknown`; `idempotentHint` is not promoted to server-managed
  idempotency because it does not prove a request-key or deduplication mechanism.

The adapter validates and translates these SDK values before they cross the application port.
The domain validates discovered and administrator values again. LLM Tool Enhancement remains
descriptive only and is never read during resolution.

The effective snapshot is included in Tool planning metadata, persisted with every immutable
Workflow plan and planning attempt, and copied into every invocation, including failed, canceled
and simulation invocations. Plan confirmation therefore shows the exact Planner-time snapshot,
not a newly refreshed Tool value. The management API and Console expose both the effective Tool
snapshot and its retained sources. No MCP Task binding, remote Task polling, device state
authority, or conflict control is introduced.

## Consequences

- Planner and confirmation inputs receive deterministic, fail-closed semantics.
- Historical invocations remain auditable after discovery or override changes.
- Refreshes preserve administrator input without allowing it to silently outrank an available MCP
  declaration.
- New database columns and JSON validation are required for Tool sources and invocation snapshots.
- Future MCP Task execution can build on the model, but v1.0.11 still invokes Tools synchronously.
