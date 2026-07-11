# FR-WF-010 plan revision evidence

Date: 2026-07-12

## Delivered

- Immutable plan lineage and revision kinds in the domain and PostgreSQL.
- Atomic source supersede plus revision insert; every new revision requires confirmation.
- A2A natural-language revision through the fixed schema-bound planner and real Task plan binding.
- Administrator canonical DSL/DAG validation, revision, confirmation, and LangGraph execution APIs.

## Reproducible evidence

- `pnpm test:unit`: revision identity, invalid-edit isolation, natural-language planner lineage, and real Task plan actions.
- `pnpm test:integration`: PostgreSQL transaction rolls back the revision insert when the source is inactive.
- `pnpm test:contract`: Task binding and administrator revision HTTP contracts.
- `pnpm test:e2e`: real PostgreSQL/Redis/local-model A2A revision supersedes the source and confirms the new plan; administrator DAG revision is confirmed and executed by LangGraph.

## Verification classification

- Real: PostgreSQL transaction, Redis-backed A2A lifecycle, management HTTP, local structured-model HTTP, and LangGraph execution.
- Simulated: the local deterministic model response represents a schema-compatible external model.
- Not verified: browser-based React DAG editor interaction, which belongs to EP-06.
