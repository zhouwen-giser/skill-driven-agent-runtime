# ADR-132: Project MCP Task and Capability Evidence through Runtime Authority

## Status

Accepted on 2026-08-04.

## Context

MCP Task lifecycle facts and Runtime Capability readiness, Task Binding, Attempt and Agent Card
facts are authoritative in Runtime PostgreSQL. Capability Definition and Implementation Binding
facts are authoritative in Control PostgreSQL. Canonical Evidence must preserve that split, must
not make Redis authoritative, and must not let either process write the other database.

## Decision

`McpCapabilityEvidenceProjector` reconstructs the 11 MCP Task and seven Capability record types.
Runtime facts are loaded in a repeatable-read PostgreSQL snapshot. Control-owned Capability facts
are read through the authenticated Node Control HTTP API and validated at the adapter boundary.
The Runtime projector accepts a Control definition only when the exact
`node_control.capability_revision` Evidence record is already present; otherwise it records a
stable blocking Quality Issue and emits no definition or dependent Capability record. Phase 9
governance projection therefore closes the forward dependency by normal replay, without a
distributed transaction or a second authority.

Tool Call ends after the Task Handle is returned. Observation is evidence only and never invokes
Workflow. Control Event is persisted before continuation. Continuation resumes its stored state
and does not replay completed side effects. Cancel remains requested or uncertain until a Provider
terminal state is observed. Provider completion is a Receipt; Goal success still requires Runtime
Verification.

All Source Revision and payload construction recursively excludes credentials, tokens, secrets
and private reasoning before canonicalization. Stable external `CredentialRef` and `SecretRef`
identifiers remain allowed.

## Consequences

- PostgreSQL remains authoritative; Redis remains wake-only.
- Runtime can project MCP evidence without Node Control availability.
- Capability projection fails closed until both authenticated Control state and its exact
  governance Evidence reference exist.
- The production Control reader is optional but requires a paired URL and service token.
- No ClickHouse, OpenTelemetry pipeline, evaluator, second runtime or dual-write path is added.
