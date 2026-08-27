# ADR-143: Incremental Telemetry debug and domain projection

Status: Accepted (user-approved 2026-08-26)

## Decision

Extend ADR-142's explicit trusted-intranet debug profile with SDAR Telemetry. Runtime PostgreSQL
retains sole ownership of Evidence configuration/outbox/ACK. Add optional `deliveryStart` with
legacy `retained` behavior and explicit `from_activation`. The first activation records a durable
exclusive sequence boundary under an insertion barrier. Boundaries survive configuration revisions
and restart; a later policy change on the same export ID is rejected. A boundary is not an ACK.
All eligibility, backlog and contiguous ACK checks use the same delivery range, preserving exact
send/fence ownership within that range. Historical rows and coverage claims remain unchanged.

The external warehouse receives canonical Evidence and an independent optional SMPP ProviderOps
projection target. Diagnostic metrics/traces stay in the existing seven-day local store and are
queried through a fixed bounded upstream, without re-ingestion.

The debug domain worker targets ACTIVE using the existing lifecycle and ten frozen Commander/NPC
mappings. Telemetry Control PostgreSQL owns actual lifecycle/actions, producer registration,
activation boundaries, checkpoints and fenced leases. The worker uses deterministic mappings,
idempotent writes and explicit lineage, never SDAR's business-state tables or an alternative
Workflow runtime. No registered source is invented to satisfy activation; empty registered sources
are ACTIVE but not data-ready. Scope reads to configured sources/tenant/project and new ingestion.

Query/Admin may use the explicit development principal; source ingestion keeps machine credentials.
Production defaults and immutable mapping definitions do not change. Startup, migration and smoke
do not submit Tasks, invoke Devices, destroy history or reset the external warehouse.

## Consequences

An incremental deployment may lack historical references; neither ACK nor ACTIVE makes an episode
complete. Missing source registration or schema drift is a visible startup blocker. Receiver/target
outage is telemetry degradation, never a business retry. Disable/stop retains all state for recovery.

## Addendum: SDAR-derived application projections (deferred)

During implementation the user clarified that Commander and NPC consume SDAR data and require
their own application projections. The ten existing application-to-embodied mappings are a later,
different stage; producer registration does not satisfy the SDAR-to-application requirement.
The user then explicitly requested leaving this additional layer empty. It is not implemented or
claimed as part of this delivery. A future implementation must distinguish shared consumption from
exclusive Task/Episode application ownership and retain root Evidence identities. No SDAR record
is relabeled as a Commander/NPC producer. Application-only facts remain at their real source.
