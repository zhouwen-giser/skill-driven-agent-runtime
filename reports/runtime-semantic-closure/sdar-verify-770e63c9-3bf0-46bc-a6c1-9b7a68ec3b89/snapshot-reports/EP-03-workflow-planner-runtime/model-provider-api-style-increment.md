# FR-LLM-001 Provider API-style evidence

Date: 2026-07-12

## Delivered

- Domain-owned Provider kind plus explicit persisted API-style selection.
- Composite transport for OpenAI-compatible/local chat-completions and non-OpenAI Messages protocols.
- Strict Messages request/response normalization, token accounting, credential handling, and unsupported-embedding failure.
- Management API/OpenAPI and migration/rollback support.

## Reproducible evidence

- `pnpm test:contract`: real local HTTP assertions for chat-completions, embeddings, Messages path/headers/body, structured response, usage, and unsupported operations.
- `pnpm test:integration`: Provider API style round-trips through PostgreSQL with encrypted credentials and fixed routing.
- `pnpm test:e2e`: management-configured `other_vendor` Provider performs real Skill authoring through `/messages`; normalized Token usage and Provider identity appear in Model invocation audit, then routing is restored explicitly.

## Verification classification

- Real: HTTP wire behavior, PostgreSQL, encryption envelope persistence, runtime routing, model audit, and failure semantics.
- Simulated: local protocol-faithful servers return deterministic model responses.
- Not verified: credentials or service behavior of a live commercial vendor endpoint.
