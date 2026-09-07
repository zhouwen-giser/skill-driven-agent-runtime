# Execution control increment evidence

Date: 2026-07-12

## Delivered

- Native LangGraph node-boundary pause checkpoint with persisted pause kind/time.
- Short-pause resume without replay and continuous budget/call accounting.
- Skill-version pause threshold resolution and long-pause immutable replanning with fresh confirmation.
- Skill cancellation-strategy resolution, active-call AbortSignal propagation, terminal cancellation, policy audit, and no automatic compensation.
- A2A Task pause/resume/cancel and management plan-control endpoints backed by the same application service.

## Reproducible evidence

- `pnpm test:unit`: deferred-node pause/cancel proves no subsequent node starts; short resume does not replay; Skill threshold and wait-current policy resolution; long-pause Task transition creates a fresh-confirmation plan.
- `pnpm test:integration`: real PostgreSQL persists typed Task-pause metadata, active-plan lookup, canceled status migration, and ordered events.
- `pnpm test:contract`: management pause/resume/cancel routes and real MCP cancellation propagation.
- `pnpm test:e2e`: a delayed real MCP call settles, pause occurs before the next real MCP call, resume runs it exactly once, running-task cancellation aborts and never starts the next call, and a zero-second Skill threshold produces a new awaiting-confirmation plan.

## Verification classification

- Real: LangGraph MemorySaver checkpoint, PostgreSQL instances/events/plans, A2A follow-ups, management HTTP, official MCP SDK transport and cancellation signal.
- Simulated: local delayed device Tool and fixed-stage local model response for long-pause replanning.
- Not verified: cancellation of a production Tool that ignores AbortSignal; the implemented fallback waits for that active call and prevents subsequent nodes.
