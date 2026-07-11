# ADR-013: Skill Graph Domain Authority

## Status

Accepted on 2026-07-11.

## Context

FR-SKL-009 requires parent-child, dependency, input/output match, alternative, composition, and capability-coverage relations usable by management and planning. UI graph objects must not become domain state.

## Decision

- The domain owns directed `SkillRelation` edges between stable Skill IDs with one of six whitelisted relation types and JSON metadata.
- PostgreSQL `skill_relation` is authoritative and references stable Skill rows, not a particular version.
- Self-relations are rejected. Parent-child and dependency edges are cycle-checked before persistence; other relation types may be represented in both directions using two explicit edges.
- Management HTTP exposes protocol-neutral edges. React Flow will project these DTOs and may not persist its own graph model.
- A relation describes capability knowledge and does not embed or execute a fixed Workflow.

## Consequences

Planning and selection can consume the same graph without importing UI or persistence types. Deleting a stable Skill cascades its graph edges. Concurrent graph writes still rely on the database unique constraint as the final duplicate guard.
