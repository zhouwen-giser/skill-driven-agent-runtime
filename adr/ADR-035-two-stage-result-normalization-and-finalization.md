# ADR-035: Two-stage result normalization and finalization

## Status

Accepted on 2026-07-12.

## Decision

- Every successful MCP node output is converted inside the sole LangGraph runtime into a domain-owned envelope: `data`, normalized `errors`, deterministic `summary`, original JSON size, context-safe value, and truncation flag. Downstream DSL references consume this envelope rather than an SDK/vendor object.
- Context trimming affects only `contextValue`; the full displayable `data` remains in execution/audit evidence. Non-JSON-serializable values fail explicitly.
- Final Task output uses a dedicated fixed `result_processing` model stage. The model receives the immutable Skill version, its output instruction/schema, and normalized source data.
- Model output is strict data containing natural-language text, structured output, key facts, value assessment, and memory candidates. The structured output must pass the authoritative Skill `outputSchema` before anything is persisted or returned.
- Processed-result evidence is immutable PostgreSQL data linked to Task and Skill version. Memory candidates are proposals only; EP-05 policy decides whether they enter long-term memory.

## Consequences

- Text and structured artifacts come from one constrained decision and remain semantically paired.
- Large Tool responses cannot silently flood later model context, while full audit data remains available.
- Result facts and value assessments are queryable without exposing private chain-of-thought.
- Existing DSL expressions that inspect MCP output use `outputs.<node>.data` explicitly.
