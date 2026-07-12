# ADR-049: Capability boundary controls version versus new Skill

## Status

Accepted — 2026-07-12

## Context

FR-EVO-004 requires execution improvements within the same capability boundary to create a new version of the existing Skill, while materially different capability boundaries create a new Skill. Duplicate scores alone did not enforce publication identity.

## Decision

- The fixed structured induction decision must declare `evolutionKind` (`new_version` or `new_skill`), `targetSkillId`, and a displayable boundary decision summary.
- `new_version` is accepted only when the target is a current formal Skill and equals the reported duplicate Skill. Publication forcibly uses the existing target ID, regardless of the proposed metadata ID.
- `new_skill` is accepted only when the target ID is absent from the current formal registry and equals the proposed Skill ID.
- Invalid or contradictory decisions fail before simulation or registry mutation.
- The complete boundary decision is persisted in the induction report. Existing immutable Skill versions remain queryable through the registry history.

## Consequences

The model may recommend identity, but application invariants decide whether it is legal. Same-boundary evolution preserves the stable Skill identity and advances its version; distinct capabilities receive a new identity without overwriting an existing Skill.
