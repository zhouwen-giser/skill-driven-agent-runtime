# ADR-154: Default governance initialization and exact deployment resource identity

Status: Accepted for the user-authorized deployment repair, 2026-09-09.

## Context

ADR-149 defaults did not populate an empty governance installation. Source/Provider wrappers also
assumed an eleven-tool UGV deployment and fresh Runtime snapshots. Point readiness assumed an
already-published version >= 2 and vehicle:ugv1, while sz-gowm's authoritative resource is vehicle:ugv.

## Decision

Deployments orchestrate existing official Source sync, Provider materialization, Skill lifecycle,
Capability implementation/publication, Exposure publication and Card activation APIs. There is no
new public protocol, database schema or workflow engine. Governance is default YES and fail closed.
Explicit operator NO is preserved and reported as disabled rather than accepted governance.

Select a reviewed exact ten- or eleven-tool contract explicitly; do not silently omit tools. Permit
HTTP Compose management hosts only with an explicit deployment option, and only runtime/control-api.
Refresh expired discovery through the official API and reconcile its bounded revision change.

For the immutable embodied.move_to@1 package, readiness accepts an initial Capability version 1
without a predecessor as well as existing append-only successors. The exact resource is taken from
the immutable Capability input-schema const, and must match its output schema, resource policy,
Provider constraint and implementation override. Package/usage hashes, confirmation, evidence,
execution mode and single-dispatch promises remain mandatory. No UGV display whitelist is added.
Live definitions omit simulation-only target policy.

The user authorized official PMS with separate management PostgreSQL. It registers the existing
SMPP identity through native registration and official services; GOWM remains business storage owner.
The user confirmed embodied.inspect_area is absent and will be supplied by GOWM later. Patrol stays
in the manifest as explicitly blocked; this does not count as complete full-manifest acceptance.

## Evidence

See EP-DEFAULT-CAPABILITIES and reports/default-capabilities-20260909. Dedicated regressions cover
catalog profiles, Compose address boundaries, expiry/retry, configured resource identity and the
initial version. Full repository gate and read-only site inventory are required before delivery.

Provider output dictionaries are represented with an explicit recursive JSON-value schema when
the upstream declares an otherwise untyped open object. Named fields, required fields, nullability
and closed-object rules remain unchanged. Equivalence tests cover accepted nested JSON and rejected
scalar/missing/extra fields. Raw MCP catalog hashes remain the lineage authority; no device facts,
keys or evidence are invented, and the strict Skill publication validator remains enabled.
