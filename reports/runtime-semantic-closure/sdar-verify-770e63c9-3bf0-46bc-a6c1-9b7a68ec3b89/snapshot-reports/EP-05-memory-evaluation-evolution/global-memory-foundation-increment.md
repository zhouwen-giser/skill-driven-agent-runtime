# Global memory foundation increment

Date: 2026-07-12

## Scope

This increment establishes the real global long-term-memory source required by FR-GOAL-006 and verifies FR-MEM-001. It deliberately does not treat result-processing memory candidates as admitted memories.

## Reproducible evidence

- Unit tests validate source/confidence/embedding invariants and semantic retrieval.
- Management contract tests validate create and search request/response paths.
- PostgreSQL integration applies migration 0031, writes structured memory plus vector/provider identity, and retrieves it with cosine score 1 and intact source references.
- Real local E2E creates source and consumer Tasks under different `user_id` values, writes a source-linked memory, and retrieves it globally through the management API.

Final gate results:

- `pnpm verify`: format, lint, strict typecheck, 38 files/148 unit+contract tests, architecture boundaries, OSS pins, Compose, SBOM/licenses, and production build passed.
- `pnpm test:integration`: 2 files/27 tests passed against local PostgreSQL/pgvector and Redis.
- `pnpm test:e2e`: 1 file/27 tests passed.
- `pnpm smoke:server`: server, dynamic Agent Card, and trusted-intranet management health passed.

## Verification boundary

PostgreSQL/pgvector, Redis, server, management API, and A2A task creation are real local components. Embeddings are deterministic model-loopback vectors. Automatic LLM refinement, deduplication, status replacement, and stage-specific retrieval are not verified by this increment.
