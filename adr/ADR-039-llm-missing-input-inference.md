# ADR-039: LLM missing-input inference from three evidence classes

## Status

Accepted — 2026-07-12

## Context

FR-GOAL-006 forbids immediately asking the user when Goal formation lacks input. The Agent must first consider conversation history, global long-term memory, and existing data, infer only when reliable, record explainable sources, and otherwise ask a clear question.

## Decision

- The initial fixed `goal` formulation may report missing input. It does not itself move the Task into `input-required`.
- A dedicated application service collects bounded candidates from three domain-labelled sources: prior Tasks in the same context, active global pgvector memories, and processed results from the same context.
- The fixed `goal` Model Runtime stage receives the request and all candidates under operation `infer_missing_goal_input`. It is the sole final judge and returns either a complete Goal with selected source IDs or one explicit clarification question.
- Selected source IDs must exist in the supplied candidates. An inferred Goal requires at least one source; unsupported or source-free guesses fail closed.
- PostgreSQL stores the outcome, displayable decision summary, complete selected-source snapshots, inferred Goal or clarification question, Task/context identity, and timestamp. No private reasoning is requested or stored.
- When inference succeeds, normal Skill selection and plan-confirmation flow continues. When it fails, the Task enters `awaiting_user_input` with the model's explicit question.

## Consequences

Retrieval and deterministic validation constrain but never replace LLM judgment. Evidence remains replayable even if a memory is later superseded. The design uses the existing Model Runtime and Task state machine and introduces no executable model output or second Workflow runtime.
