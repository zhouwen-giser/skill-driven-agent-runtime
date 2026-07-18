# ADR-096: Skill catalog derived classification and lifecycle projection

## Status

Accepted on 2026-07-17.

## Context

SDAR v1.2 Phase 3A requires domain/tag catalog filters and a lifecycle projection. The authoritative
baseline `SkillVersion` already owns status and capabilities, while neither it nor the frozen suggested
`SkillUsageSpecification` defines independent domain, tag or lifecycle state. Adding mutable taxonomy
or lifecycle authorities before the Phase 7 persistence design would create conflicting catalog state
and an unsupported migration requirement.

## Decision

- Catalog domains are derived from the first dot, colon or slash-delimited segment of each exact
  `SkillVersion.capabilities` value. A capability without a delimiter is its own domain.
- Catalog tags are the exact capability values. Domain and tag matching is exact and case-sensitive.
  No inferred synonyms, tokenization, model classification or independent tag store is admitted.
- Lifecycle is a read projection of the existing `SkillStatus`: `enabled → active`,
  `disabled → inactive`, while `draft`, `validating`, `deprecated` and `validation_failed` retain their
  names. It is not a second state machine and has no write operation.
- Native usage summaries project visibility, modes, Task Types, composition presence and bounded counts
  from the immutable exact version. Legacy versions use the existing guidance-only legacy projection.
- `SkillCandidateSnapshot.usageSummary` is additive and optional only so pre-v1.2 persisted selection
  records remain readable. New selection snapshots always populate it.
- The existing `SkillRegistryService` and `SkillRepository` remain the sole catalog/version path.

## Consequences

Phase 3A can provide deterministic filters and lifecycle reads without a migration, parallel Registry,
model call or duplicated state authority. Exact-version reads and catalog snapshots are recursively
immutable. A future independent taxonomy is a schema and persistence change and requires a new additive
ADR; it cannot silently reinterpret this projection.
