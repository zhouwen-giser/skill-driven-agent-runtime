# v1.0.12 Implementation

Date: 2026-07-16

ADR-083 introduces domain-owned Memory durability and authority evidence. The fixed refinement
stage must return `type`, `content`, `summary`, `confidence`, `durability`, `authority`, and
`durabilityReason` as one strictly validated object. Automatic processed-result admission refines
before embedding and admits only durable evidence; volatile and unknown candidates are rejected
without embedding, deduplication or persistence. Dynamic coordinates, battery, online, occupancy
and comparable device state remain live MCP concerns.

Migration 0064 changes only the new forward schema: Memory embeddings use generic pgvector storage,
must have a positive dimension, and are searched only against active durable rows with the exact
provider and dimension. Tests cover 3-, 8- and 1536-dimensional embeddings and provider mismatch.
Legacy rows become `unknown` / `model_inferred` and are excluded rather than guessed. The down
migration refuses rollback while any non-three-dimensional row remains.

Memory enhancement remains after the authoritative Runtime Terminal Outcome transaction. Creation,
embedding, deduplication or storage failure emits a durable warning exposed through the management
terminal-outcome query, while the Task stays completed and no Memory success is fabricated. The
Console explains durable admission and the need to requery live state.

No second workflow engine, SDK-domain type leak or executable model output was introduced.

Feature commit/tag: pending / `v1.0.12`.
