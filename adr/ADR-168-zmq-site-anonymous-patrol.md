# ADR-168 — Anonymous native ZMQ site profiles and single-area patrol

Status: Accepted (2026-10-28). Implementation and field acceptance are tracked independently.

## Context

The operator approved anonymous SDAR access to SMPP on the trusted internal network. The deployed
consumer still pins the MQTT contracts; the isolated native ZMQ contract pins 12 tools and an explicit
simulation identity. Neither may silently authorize the 13-tool live site catalog. Source and Binding
health must recover without approving a changed contract. Existing GOWM ownership and history remain
authoritative.

## Decision

Add exact `zmq_v1_1_0_readonly_13` and `zmq_v1_2_0_site_control_13` profiles. Keep the old profiles.
Readonly publishes seven executable native Skills; site control publishes thirteen plus the independent
`ugv.zmq.area_patrol` composition. Bind each to the actual resource, Provider, Task Profile, catalog
revision/checksum and `live/null` execution identity. Preserve original Provider results in report v2.
Cancellation, uncertain outcomes and missing evidence retain distinct meanings.

SDAR stores `unauthenticated://none` and sends no JWT to MCP. SMPP's explicit `site_anonymous` mode
requires the trusted-network opt-in and fixes the historical tenant/subject to
`default/development-anonymous`. Optional supplied JWTs remain strictly validated. Anonymous MCP
requests never become authenticated operators. Operator replies and administration retain their
existing authentication. HTTP remains the console transport selected by the operator.

Candidate Bindings use actual `direct` lineage. Formal Bindings use the real PMS registration and
revision/checksum. Deployment renewal refreshes the existing Runtime catalog and approved Binding;
it has no import, approval or publication path. Drift blocks admission and requires explicit governance.
Network reconciliation resolves declared Docker service identities and manages only its tagged nft
rules; it preserves networks, volumes and unrelated rules.

The native patrol has exactly two frozen child Tasks: one point navigation to an in-area entry point,
then one inspection of a convex four-vertex CRS84 region with explicit ellipsoid heights. Navigation's
retained native success and confirmed stop gate inspection both in LangGraph and in child admission.
Each child uses the lesser of the remaining original parent deadline and 300 seconds; start tolerance
is at most 60 seconds. Pauses, confirmation and waiting consume the same deadline.

The human's parent confirmation is retained in the existing immutable
`governed_control_confirmation` store under a composition-only scope. Its plan, binding, children and
mapped arguments are hashed. It cannot match a real MCP tool invocation. Only the exact admitted
children may inherit its actor and restricted confirmation permission, and each child obtains its own
physical confirmation record. Existing confirmation expiry (at most 15 minutes) and revocation remain
effective; an expired grant cannot launch a later child. Metadata alone never grants authority.

Actual child Task links, scopes, result identities and digest-verified trajectory objects own the report.
Requested geometry is never substituted for trajectory. Current 1.2.0 has no attested complete target
stream or coverage footprints, so even a successfully executed scan has a degraded patrol report.
Preserve original reports and bounded inline findings with retained Task/report references.

## Verification and rollout

Use real PostgreSQL, Redis, MCP and loopback native wire simulators for software verification. Record
failed attempts as failures. Run both repositories' full gates before recording a completed software
milestone. Build fixed images, then stage candidates without dispatching field commands. Formal
queue consumers are exclusive during a production-storage validation window. Promotion requires
operator-confirmed A2A field evidence; rollback is anonymous readonly and keeps all history.

## Durable lifecycle clarification

A native parent and its current child may pause an active durable external wait. The same snapshot
and remote Task are retained. Resume requires the original Task, Context, controller, catalog and
unexpired deadline; it sends only the declared TaskExecution resume method. Startup preserves
exact child-wait ancestors of a durable remote receipt. This does not recover an ordinary running
graph or retry an uncertain physical dispatch. Deadline-triggered device cancellation remains a
failed owning Task. Immutable Agent Card revisions retain independent status histories.

## Lifecycle command rejection and schema metadata

An invalid pause/resume is a rejected command, not the outcome of its existing Task. Return an
A2A agent Message carrying the same Task/Context identity and `io.sdar/controlAction` with action,
status=rejected and stable code. Keep authoritative Task phase and physical dispatch unchanged.
This receipt is separate from later GET/subscription projections, which remain canonical.

Canonical evidence allows `authorizationContextHash: {type: "string"}` only as JSON Schema
properties metadata. This never permits an actual authorization hash, schema default/example or
bare root value. The historical SHA256-pattern schema exception and redaction guards remain.
