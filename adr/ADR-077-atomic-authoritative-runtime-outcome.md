# ADR-077: Atomic Authoritative Runtime Outcome

## Status

Accepted on 2026-07-16.

## Context

The outer Goal loop previously persisted Processed Result, Task output, Goal status, WorkflowControl status and the terminal Round through independent repositories. Long-term Memory, Task Quality and evolution work also ran inside that sequence. A failure after any earlier write could therefore expose contradictory authority, such as a completed Task with an active Goal, or turn an achieved Workflow into a failed control because a non-authoritative Memory write failed.

Runtime completion also races with cancellation and stale Workers. Terminal state must be monotonic, while post-completion learning remains useful but cannot own the A2A result.

## Decision

- PostgreSQL owns one `runtime_terminal_outcome` record for every terminal WorkflowControl. The domain record links Task when present, exact Goal/version, Control, terminal status, current Round/final instance, Processed Result and enhancement warnings.
- `RuntimeTerminalOutcomeRepository` exposes `commitAchieved`, `commitUnachievable` and `commitCanceled`. The PostgreSQL adapter locks Task, Goal and Control in one transaction, validates their expected identities/statuses, saves the Processed Result, projects Task output and phase, transitions Goal and Control, attaches the current Round terminal reference, and emits the terminal Runtime Event before commit.
- Exact retries return the existing outcome. A different retry for the same Control conflicts. Generic Task, Goal and WorkflowControl saves cannot overwrite an existing terminal state, so a stale Worker cannot revive or invert the outcome.
- Result-model processing is split into preparation and enhancement. Structured result generation and model audit finish before the authoritative transaction; a failure there commits no terminal projection. Result Memory, evaluation Memory, Task Quality, Evolution Experience, Temporary Skill completion and Skill Evolution run only after commit.
- Each post-commit enhancement is isolated. Failure appends a structured warning to the terminal outcome and is logged, but does not change Task, Goal, Control, Processed Result, Round or the A2A terminal response. Failure to persist the warning is itself logged and remains non-authoritative.
- `WorkflowControllerService.#advanceOrFail` reads the current Control after an error and never changes an already terminal Control to `failed`.
- Task cancellation asks the runtime for an atomic cancellation first. When a matching active Control exists, the same repository projects Task, Goal, Control and Runtime Event together; early Tasks without a Control retain the existing Task-local cancellation path.
- Migration 0058 adds the terminal-outcome table, terminal references and the `canceled` WorkflowControl status. Rollback is refused while terminal-outcome evidence or canceled controls remain.

## Consequences

Authoritative completion is a single durable commit and can be replayed safely. Memory, Quality and evolution may lag or fail without hiding a valid terminal result. The transaction deliberately does not make Redis, external MCP state, model audit or learning stores a second source of truth.

The pre-commit model call can be repeated if a process fails before the PostgreSQL transaction, but it performs no Tool action and its stable result identity makes the later authoritative retry deterministic. Running Workflow checkpoints remain non-recoverable as required by V1.

Goal-wide cancellation still retains its separate atomic cascade transaction for multiple Tasks and instances. That transaction now creates a canceled Runtime Terminal Outcome for every active Control and cancels waiting Task input in the same commit. The runtime terminal repository governs an individual Task cancellation once it has an active WorkflowControl; bulk lock ordering and cascade evidence remain owned by the Goal cancellation boundary.
