# V1 Local Acceptance Demo

`pnpm demo:acceptance` passed on 2026-07-13. The single command built the Server and production Console, started PostgreSQL/pgvector and Redis, launched deterministic Mock Model and Mock MCP services in the composed harness, ran the official-SDK example A2A Client, and executed all 41 E2E scenarios. Containers were stopped on completion.

The example client observed streamed input-required state, sent an explicit plan-confirmation follow-up, executed exactly one Mock MCP call, polled the authoritative Task, and reached completed. The complete suite covers Skill composition, pause/resume, Goal Patch, outer replanning, Memory retrieval/lifecycle, Evaluation, Prompt/Skill evolution, cancellation, failure, and stream resubscription.

Protocols, persistence, queueing, LangGraph, MCP transport, Server, and Console bundle are real local components. Model/embedding/evaluation semantics are deterministic simulation. No production or vendor-hosted system is claimed.
