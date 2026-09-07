# Current Capability Audit

Classification: implementation verified; physical/device qualification is outside this Consumer Sync.

## Reused authorities

- PostgreSQL `remote_task_admission_intent` remains the pre-transport admission journal.
- `RemoteTaskBinding`, observations, control events and continuation snapshots remain the remote Task
  lifecycle authority.
- LangGraph.js remains the only Workflow runtime; recovered Task handles re-enter the existing stored
  continuation rather than starting or replaying a graph.
- Frozen MCP adapters remain the only wire boundary. Node Control Binding and SMPP lineage are consumed
  through existing public authority snapshots, never through Provider private storage.
- Existing cancellation, Provider business outcome, verification and Goal outcome authorities are
  unchanged and remain semantically separate.

## Added capability

- A deterministic `sdar.mcp-logical-invocation/v1` identity is persisted before transport.
- An uncertain mutating call enters a reconciliation-only path with durable
  `found_exact/not_found/conflict/unavailable/deferred` attempts and no normal-dispatch fallback.
- `found_exact` may materialize only the identity-matched original Task through the existing admission,
  Binding and continuation path.
- `sdar.remote-task-provider-execution-link/v1` records exact Runtime Server, Provider Binding/origin,
  SMPP Source/external Server and operation lineage; Provider execution and Device Mission identities
  remain explicitly unresolved when absent from the frozen public contract.
- Canonical Evidence now has 16 MCP Task types and 105 total records.

## Excluded authority paths

No code reads SMPP private PostgreSQL, Provider private persistence, Telemetry, ClickHouse or Benchmark
data to create Runtime Task authority. Provider `completed` remains a receipt and cannot directly mark
a Goal or a physical objective successful.
