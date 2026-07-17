# ADR-097: Versioned Skill Usage Specification

## Status

Accepted on 2026-07-17.

## Context

`SkillVersion` is already the authoritative immutable unit for Skill schemas, guidance, Tool policy,
runtime policy and lifecycle. V1.2 needs richer usage semantics without creating a second Registry or
silently changing legacy Skills.

## Decision

- `SkillUsageSpecification` is Domain-owned, enum-closed, bounded and immutable. It is an additive
  optional snapshot on an exact `SkillVersion`, never a mutable side document.
- Native usage uses API version `sdar.io/v1alpha1`. A missing snapshot is projected as
  `legacy_guidance`; template, procedure, Provider binding and composition behavior are never inferred.
- Exact-version catalog, selection, composition, planning, execution and evidence records must carry
  the same usage snapshot identity. A stale or non-current production version fails closed.
- Phase 7 persists the snapshot through the existing Skill Registry path using append-only migration
  `0105`; normative changes create a new Skill version.
- Package files remain import inputs. Only a validated, checksummed persisted version is production
  authority.

## Consequences

Existing Skills remain readable and behavior-compatible while native V1.2 Skills gain one reproducible
contract. No package loader, model response or filesystem artifact can bypass version publication.

## Rejected Alternatives

- A parallel usage registry: duplicates Skill identity and lifecycle authority.
- In-place JSON mutation: makes plans and evidence irreproducible.
- Inferring procedure semantics from legacy text: elevates unvalidated prose into authority.
