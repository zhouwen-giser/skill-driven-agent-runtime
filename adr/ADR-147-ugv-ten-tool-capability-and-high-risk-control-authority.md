# ADR-147: UGV Ten-Tool Capability and High-Risk Control Authority

## Status

Accepted for implementation on 2026-09-01.

## Context

The current UGV Agent Profile exposes only the historical point-navigation Skill even though its
current exact Provider Binding contains ten reviewed operations. Copying the point-navigation runtime
for every Tool would create parallel planning, remote-Task and terminal authorities. Publishing the
weapon operation under the existing generic physical confirmation would also remove its separately
requested target and human-decision boundary.

## Decision

- The existing point-navigation Skill, Capability and Exposure remain immutable and continue through
  the deterministic UGV terminal path defined by ADR-138/139/146.
- Other reviewed UGV operations use the existing managed-capability, Skill Usage, Workflow DSL,
  LangGraph.js and Frozen MCP Tasks runtime in the same Server process.
- PostgreSQL Node Control and Runtime stores remain the only governance, Task, confirmation and
  evidence authorities. Provider readiness stays live and exact; health never substitutes for it.
- Read-only operations require no confirmation. Navigation, reconnaissance, tracking and gimbal
  control require the outer Plan decision plus one durable physical-control confirmation.
- An authenticated human holding `physical_control.emergency_stop` may persist one exact direct
  emergency instruction. It can authorize only the deterministic single-node emergency-stop plan.
  Model-detected or ambiguous intent cannot create this authority.
- Governed confirmations carry an immutable authority kind. Weapon use requires a separate
  `weapon_control` confirmation issued after Plan confirmation, bound to the exact target and complete
  invocation argument hash, and consumed once. A2A and Management are adapters over the same service.
- `vehicle_fire_weapon` remains denied by default. Only an injected UGV weapon policy may admit it,
  and only when fresh target/payload evidence passes a strict application-owned schema plus exact
  Provider availability. Lifecycle publication does not imply invocation readiness.
- Governance is append-only. Exact current content is reused; drift creates a successor. An Agent Card
  is activated only after every included Exposure references a published Capability implementation.
- Provider-binding policy validation is open to additive fields: SDAR validates each authority field
  it understands but neither requires an exact object key set nor invents a denylist for unknown
  fields. Canonical persistence preserves the complete object so later versions can adopt new fields
  without rewriting history.
- A non-sensitive PostgreSQL query projection exposes confirmation kind, exact resource/target,
  argument and Plan hashes, expiry, revocation and one-shot consumption to the Management API and
  Console. Issuance from A2A, Management and the Console still converges on the same Application
  service; the query surface grants no execution authority.
- Historical confirmation rows and callers that predate the authority-kind field mean
  `physical_control` only. Emergency and weapon authority must always be explicit.

## Consequences

The UGV profile can expose all reviewed Provider operations without a second runtime or state source.
Historical tasks retain their exact authority. Missing target evidence, stale Binding/Catalog,
unavailable Provider state or incomplete confirmation fails before transport. Provider completion
alone does not establish Goal or physical success.

## Rejected Alternatives

- Duplicate UGV-specific workflows or polling services for each Tool.
- Rewrite existing Skill/Capability/Exposure versions.
- Treat opaque target objects, health or operator prose as weapon readiness.
- Globally remove the weapon hard deny.
