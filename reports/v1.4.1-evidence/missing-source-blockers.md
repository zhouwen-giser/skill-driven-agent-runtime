# Phase 1 Missing Source Blockers

These are implementation blockers for later projection coverage, not blockers to completing the
Phase 1 inventory. They are deliberately not mapped to legacy `runtime_telemetry_*` tables because
Strategy B requires a clean cutover and prohibits dual write.

| Record type | Missing authoritative source | Safe closure | Owning phase |
|---|---|---|---:|
| `node_control.telemetry_delivery` | Canonical evidence delivery state/attempt fact | Append Runtime evidence outbox/export state with stable batch/attempt identity | 3-4 |
| `node_control.telemetry_ack` | Canonical contiguous/partial ACK fact | Persist ACK result and acknowledged range in Runtime evidence export state | 3-4 |
| `evidence.episode_manifest` | Episode evidence manifest | Append `episode_evidence_manifest` with revision/hash/status | 3, 10 |
| `evidence.quality_issue` | Durable quality issue | Append `evidence_quality_issue` | 3, 10 |
| `evidence.projection_issue` | Durable projection issue | Append `evidence_projection_issue` | 3, 5-10 |
| `evidence.source_checkpoint` | Per-family/partition projection checkpoint | Append `evidence_source_checkpoint`; prohibit singleton/global cursor | 3 |
| `evidence.export_status` | Canonical exporter state | Append `evidence_export_state` keyed by exporter/partition | 3-4 |

## Closure gate

Phase 3 must create the authoritative tables after immutable migration 0143, with repositories and
real PostgreSQL transaction tests. Phase 4 must make delivery and ACK facts durable. Phases 5-10
must make checkpoint/issues/manifests executable. Only then may these rows advance from
`source_missing_blocker` to `IMPLEMENTED_AND_VERIFIED`.

No missing source is replaced by a random ID, array ordinal, synthetic success, report-only fact,
or external sink state.
