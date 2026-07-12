# ADR-038: Global pgvector memory foundation

## Status

Accepted — 2026-07-12

## Context

FR-GOAL-006 requires missing-input inference to consult global long-term memory, while FR-MEM-001 requires that memory to be globally shared across user identities. The repository previously contained only LLM-produced memory candidates; treating candidates as admitted memory would violate FR-MEM-002.

## Decision

- Introduce the domain-owned `MemoryItem` model aligned with `schemas/memory-item.schema.json`: typed structured content, displayable summary, status, confidence, source references, replacement references, and creation time.
- Store admitted memories in PostgreSQL with a three-dimensional pgvector projection and embedding-provider identity. Search returns only active items using cosine distance and does not filter by `user_id`.
- Every memory requires at least one source reference. The service rejects invalid confidence, empty sources, empty queries, invalid limits, and embeddings whose provider/dimensions are invalid.
- A fixed Model Runtime `goal` route supplies embeddings through an application port. The domain and persistence interfaces do not depend on provider or protocol SDK types.
- Expose create/get/search management contracts so local acceptance and later administration/inference stages use the same real repository.

## Consequences

FR-MEM-001 has reproducible cross-user and real pgvector evidence. This ADR does not approve automatic candidate admission, deduplication, conflict/version handling, or stage-specific retrieval; those remain EP-05 work. FR-GOAL-006 remains open until conversation history, this memory search, and existing task data are combined and passed to a fixed structured LLM inference decision.
