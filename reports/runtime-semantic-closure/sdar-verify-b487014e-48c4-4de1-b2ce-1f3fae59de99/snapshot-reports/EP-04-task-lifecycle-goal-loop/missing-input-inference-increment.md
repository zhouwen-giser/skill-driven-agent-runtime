# Missing-input inference increment

Date: 2026-07-12

## Scope

This increment verifies FR-GOAL-006 by connecting conversation history, globally shared pgvector memory, and existing processed results to a strict fixed-stage LLM decision before `input-required`.

## Evidence

- Unit tests prove all three evidence classes are supplied, selected IDs are validated, source-free inference is rejected, inferred Goals proceed to planning, and unreliable evidence yields an explicit question.
- PostgreSQL integration collects prior same-context Task evidence and replays the persisted selected-source snapshot and inferred Goal.
- Management contract exposes ordered inference records for one Task.
- Real A2A E2E creates source-linked global memory. “Inspect the remembered target” is resolved to device-17 and reaches plan confirmation; “Inspect the unknown target” returns “Which device should be inspected?”.

Final gate results:

- `pnpm verify`: format, lint, strict typecheck, 39 files/152 unit+contract tests, architecture boundaries, OSS pins, Compose, SBOM/licenses, and production build passed.
- `pnpm test:integration`: 2 files/28 tests passed against local PostgreSQL/pgvector and Redis.
- `pnpm test:e2e`: 1 file/28 tests passed.
- `pnpm smoke:server`: server, dynamic Agent Card, and trusted-intranet management health passed.

## Verification boundary

Task queues, PostgreSQL/pgvector, Redis, server, A2A SDK path, management API, and evidence persistence are real local components. Goal/inference decisions and embeddings use deterministic model loopback responses. No external or production system is contacted.
