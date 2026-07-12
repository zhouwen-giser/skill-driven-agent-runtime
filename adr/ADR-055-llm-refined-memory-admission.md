# ADR-055: Admit long-term memory only through structured model refinement

## Status

Accepted — 2026-07-12

## Context

FR-MEM-002 separates complete raw Task/execution evidence from durable memory. PostgreSQL already stores Tasks, Workflow instances/events, processed results and Evolution Experiences, while Result Processing produced memory candidates without admitting them. The management endpoint also exposed the low-level create primitive directly.

## Decision

- Keep complete raw Task, Workflow, Tool/result and evaluation evidence in their authoritative PostgreSQL records; do not copy raw traces into `memory_item`.
- Treat the fixed `result_processing` stage's strict JSON-Schema `memoryCandidates` as the automatic refinement boundary. Admit candidates only when the same decision marks the result valuable.
- Normalize candidate whitespace, map candidate kinds to domain-owned Memory types, store structured `{kind, statement}` content, and require both `task:<id>` and `processed-result:<id>` source references.
- Before every automatic or administrator-initiated admission, retrieve nearby pgvector records and reject an exact normalized summary/type duplicate. Duplicate source evidence remains available in its ProcessedResult even when no second MemoryItem is created.
- Replace management's direct create operation with `refine`: the submitted candidate must pass a separate strict structured generation through the same fixed model stage before the internal create primitive is reachable.
- Keep `MemoryService.create` as an application-internal persistence primitive for controlled composition and tests; it is no longer exposed by management operations.

## Consequences

Long-term memory contains structured, source-linked model refinements rather than raw execution dumps. Model output remains data and is validated before persistence. Production semantic quality depends on the configured provider; local E2E proves the real routing, schema, PostgreSQL and retrieval path with a deterministic loopback provider.
