# EP-02 evidence reconciliation and Tool policy

Date: 2026-07-12

The acceptance audit rechecked FR-SKL-001 through FR-SKL-015 against the current post-EP-04 repository rather than preserving early provisional notes.

## Verified from later vertical evidence

- FR-SKL-001: complete metadata and management lifecycle.
- FR-SKL-002/003: real local HTTP Model Runtime authoring, strict Schema validation/correction, audit, and fail-closed behavior.
- FR-SKL-005: auto-confirm, budgets, cancellation, compensation, and pause thresholds alter execution.
- FR-SKL-012: real pgvector plus fixed structured LLM selection over persisted operational metric snapshots.

## New enforcement

FR-SKL-004 now validates required and forbidden Tool references after generation and again before execution. Unit evidence covers both violation kinds; real A2A E2E proves a selected Skill with a missing required Tool fails and records zero MCP calls.

## Still open

FR-SKL-013 lacks a complete initial-failure to alternative-plan to renewed-confirmation E2E. FR-SKL-014 lacks automatic capability-gap-to-task-scoped-Temporary-Skill execution. FR-SKL-015 remains coupled to EP-05 simulation and publication evidence.

## Full gate

Format, lint, typecheck, architecture, 122 unit tests, 29 integration tests, 35 contract tests, 33 E2E tests, production build, and local server smoke all passed.
