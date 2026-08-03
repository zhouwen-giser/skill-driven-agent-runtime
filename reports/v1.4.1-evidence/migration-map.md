# Phase 0 Migration Map

## Runtime chain

- Clean baseline: `infra/postgres/baseline/0001_sdar_v1_2_2_baseline.sql`.
- Repository contains 108 historical `.up.sql` files; the current post-baseline verification path
  applies 37 additive migrations, `0108` through `0144`.
- Evidence-adjacent v1.3 sources: 0125 artifact authority, 0126 experience compilation, 0127
  candidate generation, 0128 durable candidate runtime, 0129 replay validation, 0130 shadow
  governance, 0131 retrieval audit, 0132 fast gateway, 0133 case/model runtime, 0134 management
  projection.
- v1.4 sources: 0135 Runtime configuration LKG, 0136 model governance, 0137 capability readiness,
  0138 Agent Card, 0139 task capability binding, 0140 Skill governance, 0141 Skill import, 0142 old
  Telemetry Export, 0143 Node Event projection, and 0144 canonical Evidence clean cutover.

## Control chain

Eight Control migrations exist:

1. 0001 node/control/audit/management foundation.
2. 0002 configuration revision/apply/LKG.
3. 0003 LLM provider/model route governance.
4. 0004 SMPP registry federation.
5. 0005 MCP provider binding governance.
6. 0006 node capability authority.
7. 0007 A2A exposure and Agent Card.
8. 0008 organization profile and Node Events.

## Evidence strategy

ADR-126 selects Strategy B. Migration 0144 performs the clean cutover after immutable 0143,
retiring old `runtime_telemetry_export_*` structures and creating evidence configuration, outbox,
source checkpoint, export state, dead letter, projection issue, quality issue, and episode manifest
tables. No Control migration was required; Runtime does not duplicate Control authority.

The immutable baseline is materialized with ordered seeds and migrations through 0144. Fresh
install, guarded reset, rollback/reapply, idempotency, interruption recovery, duplicate/conflict,
cursor, lease/fencing, High Watermark, and ACK tests pass on real PostgreSQL.
