# Phase 1 Authority Map

## Authority boundary

`sdar.evidence/v1` is a projection contract, not a new business authority. Runtime PostgreSQL
continues to own execution, Skill, MCP Task, Runtime Capability, Experience, Replay, and Artifact
facts. Control PostgreSQL continues to own Node profile, configuration, provider/route, governance,
Control Capability, exposure/card, operation, audit, and Node Event facts. Runtime Evidence tables
created by migration 0144 own only projection, delivery, issue, checkpoint, and manifest state.

Redis is wake-only. The external sink is a recipient, never authority. Provider APIs remain the
authority for provider-side task state; the Runtime-owned remote-task observations and protocol
attempts are the authoritative record of what this Runtime observed or attempted.

## Family ownership

| Record family | Business authority | Projection boundary | Confirmed / total |
|---|---|---|---:|
| Runtime | Runtime PostgreSQL | Per-table/aggregate Runtime projector | 18 / 18 |
| Skill | Runtime PostgreSQL | Skill execution/selection structured facts | 16 / 16 |
| MCP Task | Runtime PostgreSQL | Remote-task and invocation structured facts | 11 / 11 |
| Capability | Split by fact kind, never duplicated | Control definitions/bindings; Runtime readiness/task attempts/card snapshots | 7 / 7 |
| Experience | Runtime PostgreSQL | Episode, trace, typed trace subrecords, and pattern definitions | 10 / 10 |
| Replay | Runtime PostgreSQL | Dataset/case/run/result/metric/counterexample facts | 6 / 6 |
| Artifact | Runtime PostgreSQL | Artifact authority, match, execution, feedback, promotion facts | 6 / 6 |
| Node Control | Control PostgreSQL plus Runtime delivery state | Authenticated revision/event reads and durable Runtime delivery/ACK | 21 / 21 |
| Evidence | Runtime Evidence tables | Evidence infrastructure is self-describing | 5 / 5 |

The three Phase 1 Node Control gaps are now source-confirmed from `evidence_export_state` and the
unified outbox. `node_control.telemetry_configuration` remains confirmed from Control
`configuration_revision` filtered to `target_type=telemetry_link`; the retired Runtime telemetry
configuration is not reused as canonical authority. Source confirmation does not claim the formal
delivery/ACK projectors are implemented before Phase 4.

## Cross-database rule

Control commit -> Control revision/audit/Node Event -> authenticated read or durable event hint ->
Runtime source-family projector -> Runtime evidence outbox/checkpoint. A Node Event hint that lacks
full state must be resolved against the authoritative revision before mapping. No distributed
transaction and no Runtime write-back into Control are permitted.

## Conflict closures

- Capability definition and implementation binding come from Control; task binding, readiness
  snapshot, execution attempt, and Runtime card snapshots come from Runtime. Their record types are
  distinct, so neither database shadows the other.
- Trace events, activities, process variants, dependencies, recovery patterns, and replay metrics
  are identified structured subrecords inside persisted typed JSON. They are not inferred from
  prompts, hidden reasoning, logs, or test reports.
- Mutable status aggregates use a real version/lock/generation when available. Otherwise every
  emitted revision is keyed by a canonical source-row hash and timestamp/identity cursor.
- Migration 0142 telemetry tables remain immutable historical SQL only. Migration 0144 removes the
  three product tables without migrating old development rows; they receive no dual writes.
