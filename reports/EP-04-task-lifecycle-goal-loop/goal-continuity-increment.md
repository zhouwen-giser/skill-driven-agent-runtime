# Goal continuity increment evidence

Date: 2026-07-12

## Delivered

- One active PostgreSQL Goal reused by all Tasks in a context.
- Fixed-stage terminal-Goal relationship decision with strict related/unrelated output.
- Atomic new Goal plus immutable relationship record.
- Ordered Goal/transition management history.

## Reproducible evidence

- `pnpm test:unit`: active Goal skips formulation; terminal Goal invokes structured continuity decision and creates related lineage.
- `pnpm test:integration`: real PostgreSQL active/latest/history reads and atomic related/unrelated relationship persistence.
- `pnpm test:contract`: context Goal-history management response.
- `pnpm test:e2e`: two real A2A Tasks reuse one active Goal; after a real evaluated Goal reaches achieved, the next Task creates a model-decided related successor and exposes the relationship history.

## Verification classification

- Real: PostgreSQL transaction/index/history, BullMQ same-context processing, management HTTP, A2A Tasks, model invocation audit.
- Simulated: fixed-stage local model returns deterministic related-successor output.
- Not verified: production-model semantic quality for ambiguous relationship decisions; the strict schema and persisted summary remain identical.
