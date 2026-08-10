# Phase 1 Missing Source Blockers — Closed by Phase 3 Authority Creation

These are implementation blockers for later projection coverage, not blockers to completing the
Phase 1 inventory. They are deliberately not mapped to legacy `runtime_telemetry_*` tables because
Strategy B requires a clean cutover and prohibits dual write.

| Record type | Missing authoritative source | Safe closure | Owning phase |
|---|---|---|---:|
| `node_control.telemetry_delivery` | Canonical evidence delivery state/attempt fact | `evidence_outbox` + partitioned `evidence_export_state` | Closed as source; projector Phase 4 |
| `node_control.telemetry_ack` | Canonical contiguous/partial ACK fact | bounded ACK in `evidence_export_state` | Closed as source; projector Phase 4 |
| `evidence.episode_manifest` | Episode evidence manifest | constrained `episode_evidence_manifest` | Closed as source; lifecycle Phase 10 |
| `evidence.quality_issue` | Durable quality issue | constrained `evidence_quality_issue` | Closed as source; lifecycle Phase 10 |
| `evidence.projection_issue` | Durable projection issue | constrained `evidence_projection_issue` | Closed as source; projectors Phases 5-10 |
| `evidence.source_checkpoint` | Per-family/partition projection checkpoint | composite-key `evidence_source_checkpoint` | Closed as source |
| `evidence.export_status` | Canonical exporter state | `evidence_export_state(export_id,source_partition)` | Closed as source; projector Phase 4 |

## Closure gate

Migration 0144 created all authorities after immutable 0143, and repository tests verify real
transactions, rollback/reapply, partition cursors, fencing, ACK bounds, DLQ, issues, manifest
constraints, restart recovery, and high watermark. The current source matrix therefore reports
100 `source_confirmed` and zero `source_missing_blocker`.

This closes source identity only. Phase 4 must implement formal delivery/ACK records, and Phases
5-10 must implement the remaining catalog projectors and manifest lifecycle before any row becomes
`IMPLEMENTED_AND_VERIFIED`.

No missing source is replaced by a random ID, array ordinal, synthetic success, report-only fact,
or external sink state.
