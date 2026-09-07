# v1.0.6 Feature Review

Date: 2026-07-16

## Outcome

Runtime terminal authority is now committed atomically. A successful Workflow cannot expose completed Task output while Goal or Control remains active, and a post-commit learning failure cannot invert a valid terminal result.

## Runtime evidence

- Achieved, unachievable and canceled outcomes share `RuntimeTerminalOutcomeRepository`.
- Processed Result, Task output/phase, Goal, Control, current terminal Round reference and Runtime Event share one PostgreSQL transaction.
- Task/Goal/Control row locks and expected identity/status checks reject stale Workers; exact retries return one existing outcome.
- Model result preparation and model audit finish before authority; Memory, Quality and Evolution run afterward in independent warning boundaries.
- `#advanceOrFail` cannot change a terminal Control to failed.
- Active-control Task cancellation atomically projects Task, Goal, Control and Runtime Event; early Task-only cancellation remains unchanged.

## Known boundary

Goal-wide cancellation retains its existing multi-Task cascade transaction. Runtime terminal outcomes govern an individual Task once it owns an active WorkflowControl. Running LangGraph checkpoints remain process-local and non-recoverable by V1 design.

Feature commit/tag: `4df20a9` / `v1.0.6` (published and remotely verified).
