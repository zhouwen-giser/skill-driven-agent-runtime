# v1.0.3 Implementation

Date: 2026-07-15

## Outcome

A2A `provide_input` now closes the durable continuation loop on the original Task. Task-owned input request, response and execution-attempt models persist through migration 0055. The answer and its new `input_response` attempt are created atomically, then a BullMQ-safe Task/attempt composite Job enters the existing same-Context serializer with one-attempt failure semantics.

Pre-Goal clarification reforms the Goal from the original request plus saved answers. Goal Evaluation clarification records the exact control round, merges the answer into control input, generates an immutable next Workflow version outside LangGraph, and waits for fresh confirmation without replaying the completed old instance.

ADR-074 records PostgreSQL authority, Redis ephemerality and the continuation boundaries. A2A remains a thin structured-action adapter and accepts an optional `input_request_id`.

## Migration

`0055_task_input_continuation` adds request/response/attempt tables, one-waiting-request-per-Task enforcement, control-round linkage and rollback. Empty and historical-0049 upgrade paths pass.
