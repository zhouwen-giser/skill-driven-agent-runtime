# EP-ZMQ-05 — exact ZMQ Provider consumer

## Purpose / Outcome

Build a separate reviewed ZMQ catalog consumer and governance candidate for SMPP's native Provider.
Keep the MQTT-era Skills/contracts readable. Source qualification and real publication remain gated.

## Requirements Covered

MCP discovery and exact Provider binding (R-MCP / EP-INSPECTION-AREA-V1); explicit confirmation,
no side-effect replay, deterministic timing, evidence-driven degraded area reports and frozen history.

## Context and Orientation

Baseline efeb543f. The current UGV materializer supports explicitly counted legacy catalogs and
area inspection v1. ZMQ supplies a strict four-vertex area with ellipsoid height and a different result
contract. The old adapter cannot silently consume it. SMPP baseline 156c3cc6 + phase-5 changes in
its existing managed worktree. This repository uses a separate worktree; existing evidence is protected.

## Architecture and Interfaces

- Add a pinned ZMQ catalog snapshot and strict resource-normalized contract matcher.
- Separate candidate manifest with exact provider, binding/registry/catalog revision/checksum,
  Task Profile, simulation ID, confirmation, no replay and 300s parent-bound timing.
- Retain native frame evidence and always degrade missing coverage/trajectory/source history.
- A publication candidate is not dispatch authority. Existing governed APIs and human confirmation
  remain mandatory. G0 field qualification is independently pending.
- Do not republish old inspection/patrol IDs under incompatible contracts.

## Progress

- [x] 2026-10-24 Read AGENTS.md and PLANS.md; create isolated phase-5 worktree from efeb543f.
- [x] Implement catalog contract, candidate/adapters and strict rejection tests (11 unit cases).
- [x] Verify SMPP catalog parity and frozen protocol compatibility through the actual isolated
      formal Runtime and frozen discovery adapter; no control calls in this probe.
- [x] Record ADR, traceability, gaps, project state, changelog and required full gate.
- [x] 2026-10-25 Implement strict native CAS Provider materialization, governed Skill packages and the isolated task chain; final frozen acceptance receipts pending.
- [x] 2026-10-25 Exercise actual CAS publication/repetition and native readonly/inspection/cancel/failure Task chains.
- [ ] Complete final frozen gate/evidence delivery and accept a separate native patrol successor.
- [ ] Accept G0 source facts, GOWM owner deployment and field handoff/execution.

## Discoveries and Surprises

Legacy inspection dispatch and patrol evidence readers bind exact legacy schemas, operation names
and semantics. Alias substitution would both bypass deterministic validation and misstate coverage.

The first complete-gate run passed static/unit/contract/build stages and failed at host readiness
of a new Compose bridge. Diagnostics kept the same database/Redis images and ports: container
probes passed, host probes timed out; selecting the Docker default bridge restored both. Add an
explicit fixture-only runner option with owned-project validation and unchanged test thresholds.
Retain the failed run and verify the repaired path with the full gate (ADR-166).

## Decision Log

ZMQ is a separate explicit consumer profile; do not mutate the frozen legacy contract or treat
candidate generation as completed governance/publication. ADR records actual supported scope.

## Implementation Steps

Second increment: extend the shared materializer with a pre-Binding exact-contract guard (no
semantics override for the native profile); add a loopback-only simulation wrapper. Derive native
Skill packages from current persisted authority, use the existing import/publish/CAS APIs, and
exercise retained task results through an isolated Runtime. Keep legacy identities and field gates.

Pin public catalog only (no credentials/endpoints), implement full schema/profile equality,
bind candidate identity and timing; test drift, deadlines and degraded/late results. Update docs.

## Validation

Smallest unit/contract tests, cross-repository catalog hash check and AGENTS.md full isolated gate:
format, lint, types, unit, integration, contract, e2e, build and smoke. Record commands/exit codes/hashes.

## Idempotence and Recovery

Generation is deterministic and read-only. No automatic physical execution or retry. Publication
uses current CAS authority; withdrawal preserves versioned Skills and task/result histories.

## Artifacts and Evidence

reports/ugv-zmq-phase5; execplans/ugv-zmq-phase5-20261024.md; pinned public catalog contract.

## Outcomes and Retrospective

The first isolated consumer increment is verified. Phase 5 remains in progress. Real release and field patrol remain unqualified until source identity, time/geometry,
limits, original implementation/golden frames and single-writer handoff are independently accepted.

Full verification `sdar-verify-d392206e-dc0d-4ad9-ad43-f58fb94f85c2`: all 30 stages passed,
runtime/baseline inputs unchanged, cleanup exit 0. Runtime input SHA-256:
`c55c9427a82490990217dc69e4949ffcd8d50a1979341ae6477ea644ab4a12ec`.
Use explicit fixture default-bridge routing, independent Python 3.12.14 and inherited eight-core
test-process affinity. Retain bridge/ensurepip failures and the 19.064% unstable-baseline attempt;
final drift 4.872%, relative P95 -0.406%, append P95 2.423ms satisfy unchanged 15%/10%/20ms gates.
Reports and individual stage hashes are in reports/ugv-zmq-phase5. Delivery receipt records final
commit/push identities. Governance/field acceptance is separate and remains open.

### Second increment discoveries — 2026-10-25

- Actual CAS validation rejects untyped empty JSON Schema dictionaries; normalize them to the existing finite JSON definition without changing accepted JSON values.
- Frozen Runtime reserves root result fields; preserve raw native DTOs internally and append catalog 1.0.1, retaining the original pin.
- Native revision-zero scheduled ACK was skipped before binding; SMPP now permits exactly the first claimed binding and verifies real cancellation/release.
- Zero replan budget plus unachievable evaluation previously left a layered task executing; submit the exhausted terminal outcome.
- Audit references may follow authority in the same committed mutation. Public authorization-hash schema metadata requires an exact declaration exception, never inline authorization values.
- Add requirement IDs and full-card ArtifactRef handling; current-source full gate and final joint evidence remain pending. Exploratory failures are retained separately.

2026-10-25 exploratory joint run `zmqgov-1eccc345ef7f-6e84d949` passes all five native task cases,
zero confirmation-before-dispatch violations, no control-generation model stages, no unresolved
Canonical Evidence projection issues, and full large-card PostgreSQL/HTTP artifact integrity.
Unauthorized content requests reject and missing revisions return 404. SMPP additionally verifies
cancel-before-start and cancel-during-delayed-ACK without redispatch. Frozen rerun/gates follow.

The first frozen second-increment gate (`sdar-full-30-final`, df639088) passed format/lint/types/unit
and rejected an additional `/card` route at the 131-operation conformance contract. Retain that
failed run unchanged. The repaired implementation negotiates the explicit v1 card-content media
type on the existing authenticated revision GET; default JSON remains frozen metadata, with the
same RBAC and operation inventory. Dedicated HTTP and inventory regressions pass 15 cases. Run
a fresh complete gate; do not reuse prior stage success to close it.

The second frozen gate (`sdar-full-30-media-final`, c20855a9) passed the repaired frozen HTTP
contracts and reached production build, which rejected an inferred exported return type containing
the private WorkflowNodeBase interface (TS4058). Preserve the failure and cleanup receipts. The
native workflow adapter now explicitly returns the existing PreparedSkillUsagePlan interface;
its runtime behavior and strictness are unchanged. Verify declaration emission before starting
another full gate, then rerun all required stages on the frozen repair commit.
