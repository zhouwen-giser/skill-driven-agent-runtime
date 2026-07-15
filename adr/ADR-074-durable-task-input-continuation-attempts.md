# ADR-074: Durable Task Input Continuation Attempts

## Status

Accepted on 2026-07-15.

## Context

The original A2A `provide_input` action only moved an `awaiting_user_input` Task back to Goal deliberation. It did not persist the question or answer, and BullMQ used `taskId` as the Job ID. A completed initial Job therefore deduplicated the only continuation Job, while process restart lost the relationship between the answer and the waiting Goal/control round.

Runtime Hardening v1.0.3 requires the same Task and Context to continue after either pre-Goal clarification or a Goal Evaluation `request_input`. PostgreSQL must remain authoritative and same-Context work must remain serialized without recovering or retrying a running Job.

## Decision

- The Task domain owns `TaskInputRequest`, `TaskInputResponse`, and `TaskExecutionAttempt`. PostgreSQL migration 0055 persists their append-only identity and history, permits one waiting request per Task, and associates evaluation questions with the exact Workflow control/round.
- Creating an answer, its `input_response` attempt, and the Task continuation phase is one PostgreSQL transaction. A second answer observes the locked request as non-waiting and conflicts. Timeout/cancellation changes the waiting request to `expired`/`canceled`, so it cannot be answered later.
- Every submission also creates an `initial` attempt. BullMQ Jobs carry `taskId`, `contextId`, `attemptId`, and mode; their custom ID is a BullMQ-safe encoded composite of Task and attempt identities. Jobs retain `attempts: 1` and Redis remains disposable.
- The worker validates and records the queued attempt before processing and records running/completed/failed status in PostgreSQL. Existing `ContextSerialExecutor` serialization covers both initial and continuation attempts.
- A Goal-deliberation answer re-enters formulation on the original Task using the original request plus persisted supplementary answers. It does not create another Task.
- A Goal-evaluation answer must match the waiting control and completed round. `WorkflowControllerService.continueAfterInput` merges it into immutable control input, plans a new Workflow version outside LangGraph, supersedes the old plan, and always stops at fresh confirmation. The completed old Workflow instance is not executed again.
- A2A remains a mapping adapter: `sdar_action=provide_input` and optional `input_request_id` map to the shared `TaskService.followUp` path. The immediate projection is working/queued; normal Task reads or streams expose later progress.

## Consequences

Waiting questions survive process restart and old BullMQ Job identity no longer prevents continuation. Every answer and execution attempt is auditable from the Task, while the one-process/single-LangGraph and no-whole-Task-retry invariants remain unchanged.

PostgreSQL attempts in `queued` status are durable dispatch records. Startup and periodic reconciliation idempotently enqueue only those records and can replace a terminal stale Redis Job with the same composite identity. Running/failed attempts are never selected, and startup marks interrupted running attempts failed with `PROCESS_EXECUTION_LOST`; V1 therefore does not reconstruct or automatically retry running work.
