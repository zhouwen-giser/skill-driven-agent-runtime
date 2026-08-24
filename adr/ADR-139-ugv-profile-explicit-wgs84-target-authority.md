# ADR-139: UGV Profile Explicit WGS84 Target Authority

## Status

Accepted for the `UAP-P3-B02` external-simulation recovery boundary on 2026-08-24. The implementation
and offline evidence gates pass; external execution evidence is recorded separately and does not make
the profile production-eligible or qualify a physical vehicle.

## Context

ADR-138 originally narrowed the Profile to a target derived one metre east of the taskless
qualification position and capped the start-to-target displacement at two metres. That boundary was
useful for the first external exercise, but it prevents an operator-authorized A2A request from naming
an explicit simulation destination. The approved recovery target is longitude `106.81344630`, latitude
`29.72034353`. The caller also supplied altitude `500`, while the reviewed `vehicle_navigate` contract
and authoritative Provider telemetry expose a two-dimensional WGS84 point only.

The target remains safety-significant authorization data. It must not come from model prose, a mutable
lookup or the qualification response, and relaxing the displacement cap must not create a second
workflow runtime, bypass confirmation, weaken the exactly-once navigation boundary or remove the
objective final-position check.

## Decision

- Introduce immutable Capability and Exposure version `embodied.move@2` /
  `a2a.embodied.move@2`. Historical `@1` remains the authority for its existing evidence and is not
  mutated in place.
- The formal A2A structured input supplies one bounded WGS84 longitude/latitude target. PostgreSQL's
  initial-admission transaction persists that input in the Task Capability binding; the binding then
  becomes the sole target authority for planning, governed confirmation, MCP dispatch and terminal
  evaluation.
- Freeze an exact Profile constraint with `targetAuthority=task_capability_input_snapshot`,
  `targetDerivation=forbidden` and `distanceLimit=none`. Qualification proves current Provider,
  resource, connection, health, stationary state, position and cursor authority; it neither derives
  nor limits the requested target.
- Mission state `0` is accepted as the Provider-documented ready state. States `1` and `2` remain
  ineligible because they represent running or paused missions. Idle, ready, canceled, completed and
  failed states may qualify when every other stationary/health predicate passes.
- Altitude is neither commanded nor terminally evaluated. The A2A Profile rejects an altitude member,
  `vehicle_navigate` receives only longitude/latitude, and final success compares authoritative WGS84
  longitude/latitude telemetry with the requested point. No value of `500` is inferred, synthesized or
  claimed from two-dimensional Provider evidence.
- Removing the start-to-target maximum does not remove the destination check. Final telemetry must
  still be fresh, strictly correlated and within the existing two-metre horizontal tolerance of the
  explicit requested target. The minimum non-trivial displacement, exactly-one navigate, governed
  confirmation and forbidden-operation checks remain unchanged.
- All execution still uses the existing Skill Usage planner, immutable Workflow DSL, sole
  LangGraph.js runtime, MCP Task continuation, PostgreSQL authorities and atomic terminal writer.

## Consequences

- An authorized simulation request can name a distant WGS84 point without being rewritten to a local
  one-metre move.
- A clean bootstrap publishes only the current v2 Capability/Exposure authority for this execution
  generation; v1 evidence remains historically interpretable.
- The system cannot claim altitude attainment from the current Provider contract. Adding altitude
  later requires a versioned Tool/Capability/telemetry contract and new terminal evidence.
- A Provider completion without fresh two-dimensional position evidence within tolerance still fails
  closed.

## Rejected Alternatives

- Mutate `embodied.move@1`: this would rewrite the authority behind accepted historical evidence.
- Trust text or model output for the point: neither is durable authorization data.
- Forward altitude despite the Tool schema: this would create unaudited semantics the Provider does
  not accept or prove.
- Remove all distance checks: the start-to-target cap is removed, but the objective target-error gate
  is required to prove that the requested movement actually completed.

## Evidence

- `apps/server/test/ugv-move-skill-usage.unit.test.ts`
- `apps/server/test/ugv-simulation-qualification.unit.test.ts`
- `apps/server/test/ugv-move-terminal-outcome.unit.test.ts`
- `apps/node-control-acceptance/test/ugv-agent-profile-a2a-move-contract.unit.test.ts`
- `apps/node-control-acceptance/test/ugv-agent-profile-a2a-move-driver.unit.test.ts`
- `apps/node-control-acceptance/test/ugv-agent-profile-authority-bootstrap-driver.unit.test.ts`
- `apps/node-control-acceptance/test/ugv-agent-profile-b02-authority-gate.unit.test.ts`
- `packages/runtime-control-application/test/skill-provider-dependency-policy.unit.test.ts`
