# ADR-032: LangGraph execution pause, resume, and cancellation

## Status

Accepted on 2026-07-12.

## Decision

- Execution control remains inside the sole LangGraph.js runtime. Each DSL node checks an in-memory control record before it starts. A pause request lets the active node settle, then creates a native LangGraph interrupt before the next node.
- A short pause resumes the same in-process checkpoint. Completed nodes are not replayed. The budget clock excludes paused time, while call and cost usage remain continuous.
- The effective pause-replan threshold is the minimum declared by the immutable Skill versions on the Workflow instance, falling back to 300 seconds. Exceeding it leaves the old instance paused, supersedes its plan through normal plan revision, and creates a new immutable plan requiring fresh confirmation.
- Cancellation resolves the immutable Skill-version policy. `try_interrupt` aborts the active LLM/MCP/Skill signal; `wait_current` and `cleanup_workflow` let the active call settle, then stop before another graph node. In V1, `cleanup_workflow` means graceful current-node cleanup only because the baseline exposes no separate cleanup-workflow identity.
- Cancellation is terminal, stores the selected policy, starts no later node, and never performs automatic compensation. External side effects that completed before cancellation remain visible and are not undone.
- Control is intentionally unavailable after process loss. Missing in-memory execution/checkpoint state fails explicitly rather than reconstructing or replaying work.

## Consequences

- Task status is updated only after the Workflow reaches its real controlled state; a cosmetic Task pause cannot masquerade as execution pause.
- Parallel nodes already running may settle, but no downstream node starts after the pause/cancel boundary.
- The adapter can propagate a safe cancellation attempt to MCP transports while preserving the no-retry rule.
- Long-pause replanning occurs outside LangGraph and preserves the immutable-instance invariant.
