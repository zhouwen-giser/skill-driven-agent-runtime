# ADR-094: Remote Task input bridge and cooperative cancellation

## Status

Accepted on 2026-07-17.

## Context

An MCP Task may leave a Workflow node waiting while the Provider requests input or while a local cancellation is being propagated. The official frozen extension wire uses `tasks/update` with `inputResponses` and `tasks/cancel` as acknowledgement-only operations. Neither acknowledgement proves a Provider state transition. The existing Task input path resumes Goal deliberation or Workflow planning, which would incorrectly create a new plan for a remote node that is still active.

The Provider-extension document describes an `expectedRevision` field, but the exact pinned upstream `ext-tasks` schema does not define that field. Adding it to the official wire would break the frozen protocol contract.

## Decision

- The Domain owns protocol-neutral remote-input links and input/cancellation lifecycle states. SDK, A2A, LangGraph, Redis and ORM objects may not cross that boundary.
- PostgreSQL is the sole authority for input activation, answer attempts, operation attempts, cancellation intent, acknowledgement/uncertainty and Provider observations. Redis carries one-attempt scheduling references only.
- A `task.input_required` control is claimed under the shared `context_id` serializer. Its binding, Goal version, confirmed plan, active continuation snapshot, Workflow instance and waiting node-run identities must all match before an existing Task is moved to `awaiting_user_input` and a `source=remote_task` input request/link is created atomically.
- V1 supports Provider form elicitation only. A single-key request may accept A2A text and normalize it to that key. Multiple keys require structured A2A data. Key-set, bounded-JSON and Provider-requested JSON Schema validation fail closed. Sampling, roots and URL elicitation are not guessed from plain user text.
- Answer persistence and Task transition to `executing` precede `tasks/update`. A running update attempt is never automatically retried. Acknowledgement or ambiguous transport failure both re-arm authoritative `tasks/get`; ambiguity is recorded as `update_uncertain`. An unchanged, already-answered `input_required` revision is treated as Provider echo and remains polling; only new control identity can create a later input round.
- `tasks/update` uses the exact official `inputResponses` member. SDAR validates the persisted binding revision locally but does not add the unsupported `expectedRevision` wire member. The documentation mismatch is recorded as a known gap.
- Cancellation is cooperative. Local Task/Goal/Workflow authority may become canceled immediately, and its continuation snapshot is invalidated, but each active remote binding persists a distinct `cancel_requested` lifecycle. `tasks/cancel` acknowledgement records only `acknowledged`; timeout or connection loss records `uncertain`. In both cases polling continues until a later Provider `tasks/get` returns `cancelled`, `completed` or `failed`. SDAR never fabricates Provider cancellation and never blindly retries a running cancellation attempt.
- Goal Patch remains invalidation, not cooperative cancellation: obsolete-version bindings close and later Provider evidence is audit-only. Goal/Task cancellation preserves pollability solely for remote cancellation reconciliation.
- Terminal controls continue through the Phase 4 fresh LangGraph continuation only while local authority remains valid. If local cancellation already terminalized the Task/Goal, Provider terminal evidence closes the remote lifecycle as audit-only and cannot resurrect the Workflow.
- Admission rejection and terminal `completed` with `isError=true` are business rejection, not transport success. Only the bounded outcome kinds `start_window_missed`, `deadline_reached`, `partial_completion` and `business_failure` are accepted as structured Provider business outcomes. `failed` and `cancelled` retain separate facility/provider-cancel categories. ADR-077 remains authoritative for final Task, Goal, Control and Result commit.

## Consequences

Remote input does not invoke Goal formulation, evaluation or planning. Provider acknowledgement never becomes Task completion evidence. Local cancellation can be complete while the remote operation remains explicitly uncertain, so the console and operations evidence must display both states and warn that no authentication, compensation or guaranteed Provider cancellation exists in V1.

The persistence schema requires a forward migration for remote input links, operation attempts and cancellation state. Down migration must fail closed when irreversible Phase 5 evidence exists. LangGraph.js remains the only Workflow runtime; these services only validate, persist and feed external results into the existing continuation boundary.
