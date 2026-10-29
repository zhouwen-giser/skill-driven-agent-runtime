# Native ZMQ 1.3.0 and field acceptance

## Purpose / Outcome and Requirements Covered

Execute the accepted 2026-10-29 plan. Extend reviewed native contracts and governed patrol with
optional region height default_zero, preserving exact old versions, real Provider evidence,
physical confirmation and no replay. Covers EP-ZMQ-SITE-PATROL contract, control confirmation,
owner routing, deterministic composition, lifecycle and evidence requirements from the active
site-patrol ExecPlan and traceability matrix. Field actions and report completeness remain separate.

## Context and Orientation

Baseline 4cd2c56e64d41e5ec94d3f1e8836a6c53a485853, isolated existing branch; protected SMPP
main checkout untouched. Formal SDAR serves seven readonly Skills on restricted GOWM scope.
The independent candidate serves 13 controls/reads plus patrol, with separate storage/queue.

## Architecture and Interfaces / Decision Log

Add reviewed zmq_v1_3_0_site_control_13 with the same 13 tool names; never rewrite prior exact
catalogs. Resolve absent regional height to 0 before confirmation and retain requested/effective
inputs plus per-point provenance. Null remains invalid. Native ZMQ still receives finite numbers.
Patrol uses the published successor and exactly navigation then inspection with the original
deadline and exact child versions. Speed limit 60 / 3.6 m/s, avoidance true; entry point
106.813064505,29.720529508. Anonymous Binding remains unauthenticated://none.

## Progress

- [x] 2026-10-29 Read applicable instructions, fixed user parameters and baseline.
- [x] Add reviewed 1.3.0 catalog, authority and deterministic normalization.
- [x] Add governed patrol successor and preservation/provenance tests; 21 native joint cases pass.
- [ ] Run focused checks and full isolated frozen gate; record raw evidence.
- [ ] Publish candidate with exclusive production queue consumer for field window.
- [ ] Capture confirmed formal A2A field cases and both simulation target sources.
- [ ] Promote via real PMS source only after field qualification; otherwise keep readonly.
- [ ] Update ADR/traceability/status, commit/push and package delivery.

## Implementation Steps / Validation

Implement SMPP exact contract then copy its generated reviewed snapshot. Normalize before plan
hash/confirmation, never at uncertain redispatch. Cover omitted, explicit 0/nonzero, null/nonfinite,
km/h conversion, parent/child hashes, catalog drift, legacy rejection, old reports and no replay.
Run format, lint, typecheck, unit, integration, contract, e2e, build and local smoke through the
required complete gate; extend real PostgreSQL/Redis/MCP/isolated ZMQ joint scenarios.

## Idempotence and Recovery

Govern with existing CAS and idempotency APIs. Pause original production consumers before
candidate production storage use, stop candidate renewal that could conflict with formal source,
and retain unique writer leases. Reconnect/restart only queries uncertain Tasks. Roll back to
verified anonymous readonly; archive retirement is a separate authorized irreversible operation.

## Artifacts and Evidence

Private configurations remain outside Git. Public evidence root:
/mnt/data/ugv-zmq-zero-height-field-20261029. Record source, commands, exits, original receipts,
image IDs and SHA256. Never count loopback simulation as field action.

## Discoveries and Surprises / Outcomes and Retrospective

Implementation and native joint verification are complete. Current wire protocol requires numeric
region heights; the user explicitly chose default zero. Device rejection cannot be replaced with
invented terrain. SMPP source f1184c76935125fbdbf8a0ad980464d33b31b7e0 passes all 21 site gates.

Full SDAR runs retain their original failures: lint/type errors were repaired; one offline
process-inspection contract passed in isolation and on the next full run; the fourth full run
failed its 15% baseline-stability bound (26.93%). The fifth frozen run has passed performance
with 5.05% baseline drift, 4.71% Runtime P95 regression and 2.93 ms append P95. It is finishing
smoke checks; only its final run receipt can close the software milestone. No assertion changed.

The production device owner remains 0ab6028b-f367-4953-819f-ecca220a9a71 and its immutable
Server identity remains smpp-zmq-site. Field preparation preserves the existing Server URL,
17 credential/storage fields and all current Tasks. Use a successor revision of the current
real PMS Binding, with a temporary private Docker bridge relay to loopback candidate 19110;
formal host port 19100 stays readonly during the window. A new direct Server with a different
ID would violate immutable device ownership; silently changing the existing Server URL would
violate endpoint drift guards. The window is not started and no field action has been sent.

Passive chassis capture confirmed a sensor-time regression: fresh frames arrived, but the old
receiver watermark rejected them. Idle was verified and fresh receiver sessions restored
19100/19110 localization without device commands. Source epoch and clock semantics remain
unverified, and anti-replay checks remain enabled. The separate 65 GB archive retirement is
complete in SMPP, including physical reclamation; protected current Tasks and state snapshots
remain unchanged.
