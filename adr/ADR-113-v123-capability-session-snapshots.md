# ADR-113: Deterministic Capability and CAS-backed Interaction Snapshots

## Status

Accepted on 2026-07-23. Owns KD-04, KD-05, KD-10, KD-16 and KD-17. It extends the existing A2A
projection and immutable planning decisions without superseding their protocol or execution boundaries.

## Context

Runtime capability and multi-turn Goal/Plan interaction must be reviewable and reproducible. Request-time
model calls would make Agent Cards unstable; mutable sessions would lose user corrections or accept
concurrent stale writes.

## Decision

- Runtime Capability Summary is a deterministic projection of enabled exact Skill declarations and
  Outcome Specifications, versioned by a canonical `catalogHash`. Optional narrative is display-only.
- Summary/Card contain no current Provider/device readiness. Public projection uses an allowlist and an
  activated, hash-matched snapshot; the Agent Card request path never invokes a model.
- Capability and knowledge context use Level-0 index → selected Level-1 detail → exact Skill Level-2
  progressive disclosure under explicit budgets.
- Understanding, Goal Contract candidates and Plan candidates are immutable revisions.
- Interactive Goal/Planning writes require `sessionId + expectedVersion + idempotencyKey`; stale CAS
  returns the latest snapshot, and duplicate keys are harmless.
- Only user-confirmed Contract/Plan revisions can cross into v1.2.2 execution.

## Consequences

Concurrent rebuilds or session actions have one accepted revision. Narrative/model outages do not make
the Agent Card unavailable. User patches always outrank Task Type, Experience and defaults.

## Rejected Alternatives

- Request-time card generation: unstable, slow and privacy-sensitive.
- Mutable candidate rows: destroys correction lineage and replay.
- Loading every Skill/knowledge definition into every prompt: violates bounded context requirements.
