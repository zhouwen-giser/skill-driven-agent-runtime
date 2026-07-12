# ADR-046: Evolution drafts and all-pass automatic publication

## Status

Accepted — 2026-07-12

## Context

FR-SKL-015 and FR-EVO-002/003/005/006/008 require repeated Temporary Skill success to become a formal Skill only after explainable induction and simulation. A failed candidate must not move an existing formal Skill's current pointer or appear in the Agent Card.

## Decision

- Repeated success creates a PostgreSQL-authoritative formalization candidate at a configurable threshold of at least two.
- A fixed schema-constrained `skill_authoring` decision records consistency, stability, generalizability, duplicate score, a proposed Skill, and normal/boundary/exception cases.
- The evolution draft remains in `skill_formalization_candidate`; it is not inserted into the formal Skill registry before validation passes.
- Validation records static Schema/Tool checks, every source Experience replay, and every supplemental case result.
- Runtime simulations call the current registered MCP Tool through the existing adapter and original input Schema. Expected failures must fail before they count as passing. This may invoke side-effecting Tools and therefore retains the trusted-intranet/side-effect warning baseline.
- Any failed induction or case persists `validation_failed` and leaves the formal Registry unchanged. Every gate passing automatically registers an enabled `experience_evolution` SkillVersion, which then appears in the dynamic Agent Card.
- A2A-authored drafts retain their existing administrator-publication rule; this automatic path accepts only repeated system Experience candidates.

## Consequences

Single success cannot publish. Failed drafts remain queryable without contaminating formal current-version authority. Simulation against a real MCP endpoint is reproducible locally but cannot provide third-party sandbox isolation; operators must use safe simulation endpoints for side-effecting Tools.
