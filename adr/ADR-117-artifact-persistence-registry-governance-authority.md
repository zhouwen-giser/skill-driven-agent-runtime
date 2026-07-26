# ADR-117: Artifact persistence, Registry and governance authority

## Status

Accepted for SDAR v1.3 P02 implementation.

## Context

P02 must preserve the complete P01 Artifact, Lineage and Runtime Binding contracts while using the
frozen relational table and column names. The frozen `compiled_artifact` columns intentionally
provide indexed Artifact attributes but do not individually enumerate every nested P01 field.
PostgreSQL must remain authoritative, Approval must not imply Activation, and Redis/queues must be
fully rebuildable.

## Decision

- Migration 0125 owns the ten canonical frozen tables. No version, validation, execution, feedback,
  match, trace or pattern alias table is permitted.
- `compiled_artifact.definition` stores a bounded, versioned persistence envelope containing the
  complete validated `CompiledArtifact`, `ArtifactLineage` and optional `ArtifactRuntimeBinding`.
  The other frozen columns are transactionally checked/indexed projections of that same envelope.
  This gives lossless P01 round-trip without inventing a non-frozen payload column.
- `artifact_lineage` stores the frozen query projection. Missing P01-only lineage fields remain
  losslessly present in the canonical version envelope; adapters compare the projection with the
  envelope and fail closed on drift. The full Lineage projection, including creation time, is
  database-immutable after insert.
- Artifact version identity and content are immutable. Only lifecycle status and the nullable
  validation summary projection may change through repository CAS operations.
- Activation is one PostgreSQL transaction: lock key, validate status/hash, require a passed
  validation run, require an accepted Approval with matching evidence hash and authorized actor,
  CAS the pointer, transition previous/new status, write audit and write `artifact.activated` to the
  existing `cognitive_runtime_outbox`.
- `cognitive_management_action` is extended with Artifact governance operation values and remains the
  idempotency/audit ledger. No second audit table is created.
- Registry projections are Ports backed by rebuildable cache implementations. Cache misses and
  startup rebuild read PostgreSQL; cache state never authorizes activation. Every lifecycle event
  that can change the projected version status invalidates or rebuilds that version.
- Artifact projection delivery uses the existing Outbox's database-generated insertion sequence and
  a consumer-private durable cursor. It handles only projection lifecycle/dependency events and never
  mutates shared `published_at`, leaving unrelated events available to their actual publishers and
  consumers.
- Production governance fails closed without an `OperatorIdentityPort`. The local adapter requires
  explicit non-production construction and never trusts a request-body actor identifier.
- Feature flags and queue/event names are the frozen P02 values. P02 declares and validates them but
  attaches no request entry point or worker.

## Consequences

The relational schema stays contract-aligned while complete P01 values survive round-trip. SQL
consumers may use indexed columns but must use repository mapping for the canonical aggregate.
Activation and deprecation are auditable, idempotent and CAS-safe. Later packages can add producers
and rebuildable projections but cannot bypass the Ports or create a second authority.

## Rejected alternatives

- Add `artifact_payload`, version aliases or a second lineage table: violates the frozen persistence
  contract.
- Make Redis the Active Pointer: loses transactionality and durable authority.
- Treat Approval insert as Activation: violates the separate governance states.
- Reuse request-body `actorId`: permits identity spoofing.
- Add G03/G04 HTTP controllers now: exceeds P02 scope.
