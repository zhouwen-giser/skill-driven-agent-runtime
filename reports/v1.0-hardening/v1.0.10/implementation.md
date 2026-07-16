# v1.0.10 Implementation

Date: 2026-07-16

ADR-081 makes `capability_gap` part of the domain-owned Task and WorkflowControl terminal predicates. `recordTaskCapabilityGap` stores the structured evidence and stable `CAPABILITY_GAP` error, the Task transition set becomes empty, and TaskService rejects follow-up resume or any other mutation of the original Task.

The A2A adapter projects the phase as standard `TASK_STATE_FAILED` and exposes only displayable evidence plus `nextAction=register-capability-and-submit-new-task`. The Goal remains active; a new Task submitted to the same Context follows the normal queue/planning path and reuses that Goal. No Tool discovery or refresh path can resume, enqueue or execute the old Task.

PostgreSQL generic Task and WorkflowControl saves reject capability-gap terminal rows. Goal/runtime cancellation does not rewrite the historical Task/Control, wait timeout selects only real waits, and implicit-feedback lookup recognizes capability gap as terminal history.

Migration: none. Existing Task phase, WorkflowControl status, error and capability-gap JSON columns already store the contract.

Feature commit/tag: pending / `v1.0.10`.
