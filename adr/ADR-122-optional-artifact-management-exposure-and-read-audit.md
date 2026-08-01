# ADR-122: Optional Artifact management exposure and read audit

## Status

Accepted for SDAR v1.3 P12.

## Context

ADR-012 preserves the trusted-intranet default, ADR-115 permits optional authenticated cognitive
management, and ADR-117 makes `cognitive_management_action` the only Artifact governance
idempotency/audit ledger. P12 requires authenticated RBAC/tenant projections, sensitive-read
auditing, safe A2A metadata and resumable SSE without moving any P02-P11 authority.

## Decision

- P12 endpoints are disabled unless both an operator identity and a deployment-owned
  `ManagementPrincipalResolver` are injected. Identity, roles and tenant never come from JSON.
- P12 A2A metadata is enabled only with that same P12 composition. Feature-off deployments retain
  the existing Agent Card shape and formal Task state transitions.
- Commands continue through P02/P06 authority ports and `cognitive_management_action`. The
  promotion-package operation is added to that ledger; no second command ledger is introduced.
- `artifact_management_read_audit` is an append-only access-evidence projection only. It cannot
  authorize, approve, activate or mutate Artifacts.
- SSE is a bounded, resumable projection of formal PostgreSQL Outbox facts. P12 extends the ordered
  sequence allocator, maps producer names to frozen public names, derives tenant from authoritative
  source rows and redacts the payload.
- Cross-tenant and missing identifiers are concealed as the same 404 result.

## Consequences

The legacy no-auth surface remains available only when P12 is off; P12 itself is authenticated and
tenant bounded. Governance evidence stays in the existing ledger while sensitive reads gain a
separate non-authoritative access trail. SSE disconnection has no domain effect.

## P13 deployment-composition addendum

P13 closes the standard Server composition gap without changing the P12 ports. When
`SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN`, actor ID and roles are configured, the composition root
constructs one deployment-owned identity object and exposes immutable
`ManagementPrincipalResolver` and `ExternalOperatorIdentityProvider` views over it. The exact
`Bearer` header is compared by a timing-safe SHA-256 digest. Actor, optional tenant, human/service
kind and roles come only from validated environment configuration; the request body cannot extend
the fixed role-to-permission mapping. Without the complete credential configuration the standard
Server does not compose the Artifact management surface.

Credential distribution, rotation and revocation remain deployment responsibilities. This adapter
does not convert the trusted-intranet baseline into a general Internet authentication system.

## Rejected alternatives

- Request-body actor/tenant: spoofable.
- A second governance command table: conflicts with ADR-117.
- Redis Pub/Sub as SSE authority: not durable or replayable.
- Unconditional Agent Card extension: violates feature-off compatibility.
- Empty cross-tenant views: leaks object existence.
