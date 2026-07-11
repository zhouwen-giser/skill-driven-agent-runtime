# ADR-014: Skill Selection LLM Decision Boundary

## Status

Accepted on 2026-07-11.

## Context

FR-SKL-012 requires LLM selection based on semantic relevance and operational metrics. FR-LLM-005 forbids retrieval ranking from replacing the final model decision. FR-SKL-013 requires alternative failure handling to produce a newly confirmed plan rather than silently switching execution.

## Decision

- Application builds immutable candidate snapshots containing Skill ID/version, semantic score, sample count, success rate, average duration, average cost, failure count, and stability.
- `SkillSemanticRetriever` supplies relevance scores but cannot select a Skill.
- `SkillSelectionDecider` is the only final decision port. Its structured result must name an enabled candidate and provide a displayable decision summary; invalid outputs are rejected.
- PostgreSQL stores the full candidate snapshot, selected version, and summary. Private model reasoning is neither requested nor persisted.
- Replacement considers only current enabled targets of explicit `alternative` graph edges. The resulting record is always `awaiting_confirmation`; this service has no execution method.

## Consequences

ModelProvider integration can be added without changing domain records, and deterministic retrieval cannot silently become the selector. Current unit tests use a fake decider and therefore prove orchestration and validation, not a real LLM call. Production wiring and management visibility remain required before FR-SKL-012/013 are complete.
