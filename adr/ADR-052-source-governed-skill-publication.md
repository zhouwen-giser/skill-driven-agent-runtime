# ADR-052: Skill publication policy is governed by candidate source

## Status

Accepted — 2026-07-12

## Context

FR-EVO-008 distinguishes system-derived Skill evolution from user-requested A2A Skill drafts. A system candidate may publish automatically after all validation gates pass. An A2A request must remain outside the formal registry until an administrator explicitly publishes its persisted draft.

## Decision

- System Experience candidates retain the ADR-046 all-pass automatic publication path and are registered with `sourceKind: experience_evolution`.
- A2A `create_skill_draft`/`update_skill_draft` messages create only a PostgreSQL `skill_draft`. They cannot call the formal Skill registry and never appear in Agent Card while pending.
- `SkillAuthoringService.authorAndRegister` rejects `sourceKind: a2a_draft`; this prevents internal or generic authoring callers from bypassing persisted-draft governance.
- The management-only draft publication operation resolves the persisted draft, uses its original request text for schema-constrained authoring, registers the resulting validated Skill with `sourceKind: a2a_draft`, and records Skill ID/version, operator-supplied publisher, and timestamp on the draft.
- Publication is allowed only once. PostgreSQL constraints require all publication fields together and migration 0041 is idempotent.
- V1 has no authentication. `publishedBy` is a traceable operator-supplied label, not verified identity proof.

## Consequences

System learning remains autonomous only after its stronger simulation gate, while user-requested capability creation has an explicit human management boundary. Source and publication decision remain queryable without exposing pending drafts through Agent Card.
