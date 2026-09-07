# FR-LLM-004 fixed-stage final-decision evidence

Date: 2026-07-12

## Delivered

- Strict intent and Goal decision services wired into the BullMQ task preparation path.
- Production structured LLM Skill decider with full candidate metadata, pgvector score, and metric snapshots.
- Schema-constrained execution-exception decision limited by the immutable graph.
- Existing schema-constrained Workflow planning and Goal evaluation retained as the other final-decision boundaries.
- Task failure without model fallback when a configured decision stage fails.

## Reproducible evidence

- `pnpm test:unit`: stage routing, shape failures, candidate context, constrained exception strategy, task failure, and compiler routing.
- `pnpm test:integration`: Skill decision records and expanded candidate snapshots round-trip through PostgreSQL.
- `pnpm test:e2e`: local HTTP model invocations for intent, Goal, Skill selection, Workflow planning, execution exception and Goal evaluation are audited; a stopped real MCP server is recovered through the model-selected graph strategy.

## Verification classification

- Real: PostgreSQL/pgvector, BullMQ/Redis, local model HTTP adapter, Model Runtime audit, LangGraph, and official-SDK MCP failure.
- Simulated: deterministic local model responses stand in for an external model and the embedding provider is deterministic.
- Not verified here: Experience and long-term Memory retrieval context, which belongs to EP-05.
