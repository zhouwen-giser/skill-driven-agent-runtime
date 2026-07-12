# Goal cancellation increment evidence

Date: 2026-07-12

## Delivered

- Runtime-first Skill-policy cancellation of every active Goal instance.
- Atomic PostgreSQL Goal/Task/Plan/instance cancellation cascade and immutable history.
- A2A `cancel_goal` and management cancellation/history APIs.
- Terminal-monotonic Task persistence preventing stale Worker resurrection.

## Reproducible evidence

- `pnpm test:unit`: all active plans are controlled before cascade; reason validation and no-compensation warnings.
- `pnpm test:integration`: real PostgreSQL Goal, Task, plan and canceled-instance cascade; stale Task save rejection; cancellation history.
- `pnpm test:contract`: management cancellation and history routes.
- `pnpm test:e2e`: two real A2A Tasks sharing one Goal both become canceled through one `cancel_goal`; Goal and evidence are queryable. The execution-control e2e separately proves running cancellation starts no next MCP node.

## Verification classification

- Real: PostgreSQL transaction/terminal guard, A2A follow-up, management HTTP, shared-Goal Task projections and LangGraph execution control composition.
- Simulated: local MCP/model behavior in the complementary running-cancellation scenario.
- Not verified: a production Tool that ignores AbortSignal; successful Goal cancellation waits for such an active call before committing the cascade.
