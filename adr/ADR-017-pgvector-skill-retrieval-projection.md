# ADR-017: pgvector Skill retrieval projection

## Status

Accepted on 2026-07-11.

## Context

FR-SKL-012 and FR-LLM-005 require semantic Skill retrieval together with operational metrics, but explicitly prohibit retrieval rank from making the final choice. PostgreSQL/pgvector is the required durable retrieval store.

## Decision

- Formal `SkillVersion` remains authoritative. `skill_embedding` is a rebuildable PostgreSQL projection containing the actual version, searchable text, provider ID, dimensions, and pgvector value.
- Application owns `TextEmbeddingProvider` and `SkillEmbeddingRepository` ports; provider and PostgreSQL types cannot cross those boundaries.
- Each retrieval embeds the goal and current enabled candidates, refreshes their projections, and asks PostgreSQL pgvector for cosine similarity.
- Provider ID and vector dimensions must remain fixed within a retrieval and must match stored rows. Invalid or drifting output fails the operation.
- Cosine similarity is normalized to `[0,1]` and stored in the immutable candidate snapshot alongside success, latency, cost, failures, and stability.
- The semantic retriever has no selection method. `SkillSelectionDecider` remains the only final decision boundary and its selected candidate plus displayable summary are persisted.
- If embedding or decision providers are not explicitly configured, management selection fails. No keyword or ranking fallback is allowed.

## Consequences

The implementation proves real pgvector scoring without creating a second Skill source of truth. Current e2e uses deterministic embedding and decider ports; production embedding/model adapters and model-call audit remain EP-03 work.
