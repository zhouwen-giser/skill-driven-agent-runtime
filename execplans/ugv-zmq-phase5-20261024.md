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
- [ ] Implement catalog contract, candidate/adapters and strict rejection tests.
- [ ] Verify SMPP catalog parity and frozen protocol compatibility.
- [ ] Record ADR, traceability, gaps, project state, changelog and required full gate.

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

In progress. Real release and field patrol remain unqualified until source identity, time/geometry,
limits, original implementation/golden frames and single-writer handoff are independently accepted.
