# ADR-015: Temporary Skill isolation and formalization gate

## Status

Accepted on 2026-07-11.

## Context

FR-SKL-014/015 require an Agent to use an available MCP Tool when no formal Skill exists, while preventing one successful task from publishing an unverified Skill. Temporary behavior must not contaminate the immutable formal Skill registry or the dynamic Agent Card.

## Decision

- A Temporary Skill is a domain-owned, task- and context-scoped object stored separately from `skill` and `skill_version`.
- Creation accepts only current enabled MCP Tool references and valid input/output JSON Schemas.
- Completion atomically expires the Temporary Skill and stores a displayable Experience record.
- Failed executions never contribute to formalization. The initial repeated-success threshold is two equivalent capability fingerprints.
- Reaching the threshold creates only a `SkillFormalizationCandidate` in `awaiting_simulation`; it does not create, enable, or publish a formal Skill.
- Capability fingerprints use recursively key-sorted JSON plus canonical Tool ordering so equivalent Schema object key order does not split evidence.
- Simulation, evaluation, approval, and publication remain in the Skill Evolution workflow; no execution path is added to the candidate record.

## Consequences

This preserves formal registry and Agent Card authority and makes repeated-success evidence reproducible. FR-SKL-014 remains incomplete until plan/execution orchestration automatically detects the capability gap and executes the generated Temporary Skill. FR-SKL-015 remains incomplete until EP-05 consumes the candidate through simulation and governed publication.
