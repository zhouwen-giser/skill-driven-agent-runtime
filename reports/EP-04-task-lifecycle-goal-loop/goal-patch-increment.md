# Goal Patch increment evidence

Date: 2026-07-12

## Delivered

- Fixed-stage, schema-validated Goal Patch generation and immutable version history.
- Atomic PostgreSQL invalidation of old Goal-version plans, Workflow instances, Task bindings, confirmations, intermediate and final results.
- A2A `patch_goal` continuation and management apply/read/history endpoints.
- Replanning outside LangGraph with mandatory fresh confirmation and no Tool execution before confirmation.
- Compensation guidance propagation where declared and visible no-auto-compensation warnings otherwise.

## Reproducible evidence

- `pnpm test:unit`: patch validation, versioning, planning identity and forced confirmation.
- `pnpm test:integration`: real PostgreSQL transaction and persisted history/invalidation.
- `pnpm test:contract`: management route shapes and stable responses.
- `pnpm test:e2e`: real A2A Goal Patch after a real MCP side effect; old plan/instance invalidation, zero extra MCP calls before reconfirmation, then successful new-plan execution.

## Verification classification

- Real: PostgreSQL transaction, management/A2A HTTP, LangGraph plan execution, local MCP invocation count and confirmation boundary.
- Simulated: local fixed-stage model responses and local MCP device behavior.
- Not verified: automatic reversal against a production side-effecting Tool. V1 intentionally plans or warns; it does not automatically compensate.
