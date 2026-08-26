# ADR-141: Persistent Provider Bindings and Registration-owned Agent Cards

## Status

Accepted on 2026-08-26 by the explicit operator decision. Supersedes the health-TTL-as-registration
and readiness-filtered Card portions of ADR-140 and the v1.4 P05/P08 implementation. Preserves
ADR-010/113 enabled-Skill publication and all existing confirmation and execution boundaries.

## Context

The healthy UGV debug service lost its natural-language Card extension after one hour because an
immutable Binding row contained an expiring availability observation. The Source worker renewed
registry observations but not Binding health. Refreshing an unchanged Provider incremented Binding
revision, which then conflicted with immutable Capability deployment constraints. Restart/clean
recovered only temporarily and was not an acceptable service lifecycle.

## Decision

- Provider Binding is a durable registration. Time passing, Source observation expiry or a failed
  health check does not delete or expire its identity. Explicit governance may suspend/remove it.
- PostgreSQL retains immutable semantic Binding revisions and append-only health/catalog
  observations. A small current lifecycle projection owns suspend/remove state; it is not a second
  Runtime or execution authority. Health has its own bounded validity and may be unavailable.
- Successful unchanged discovery and failed health checks append observations at the same Binding
  revision. A validated change of Provider/endpoint/Catalog contract creates a new semantic revision;
  ordinary observation timestamps and registry refresh counters are not semantic changes.
- Periodic read-only discovery renews health without invoking any Provider Tool. Provider readiness
  and exact-argument checks govern execution, never public capability registration.
- Agent Card expresses published/current enabled Skill declarations. A registered Skill and its
  natural-language admission contract remain discoverable while Providers are unhealthy. Explicit
  Skill disable or Exposure withdrawal still removes them. Health status, TTL and readiness hashes
  do not determine Card content or revision.
  The stored `readinessPublicationPolicy` field remains readable for compatibility, but is no
  longer a publication filter. Registration reconciliation removes explicitly disabled/withdrawn
  declarations and is a no-op when registration content is unchanged.
- Capability business versions remain immutable. Their stable Binding identity resolves the latest
  registered semantic revision for subsequent admissions and readiness. New Tasks freeze that exact
  effective revision/Catalog in their existing PostgreSQL Capability snapshot. Existing Tasks,
  confirmations and Workflow plans are never silently retargeted.
- Admission validates the registered contract and input; health may prevent planning/execution but
  does not make the public Exposure cease to exist. The execution boundary continues to reject an
  unavailable/stale Provider, missing tool, incompatible schema, revoked registration or mismatched
  frozen Task authority.
- No infinite TTL, fabricated successful health, direct business-table repair, new dependency or
  additional Workflow runtime is introduced.

## Consequences and Recovery

Existing Binding history is retained by an additive Control migration. Old health timestamps remain
truthful until real discovery produces a new observation. Service restart runs migrations and resumes
periodic health reconciliation; no database clean is required. Control checks health every 30 seconds
and renews unavailable/expiring observations at least 60 seconds before their deadline. Runtime
reconciles semantic contracts every 30 seconds; unchanged contracts keep their existing snapshot,
tool revision and process-independent remote-task anchors. Existing reviewed execution-semantics
overrides are applied identically during Control discovery and Runtime synchronization.

Migration `0012_mcp_binding_registration_health` backfills lifecycle state and exposes the current
read projection without rewriting immutable Binding history. Its down migration rejects rollback
when doing so would discard changed lifecycle or health state. Prefer rolling forward; do not delete
health observations or rewrite history to force a rollback.

This change does not authorize navigation tests or change the physical side-effect gate. Verification
uses fake/loopback Provider contracts, isolated PostgreSQL and read-only live discovery/Card checks.

## Evidence

Implementation, exact commands and results are maintained in
`execplans/EP-SDAR-PERSISTENT-PROVIDER-AUTHORITY.md` and `docs/17_TRACEABILITY_MATRIX.md`.
