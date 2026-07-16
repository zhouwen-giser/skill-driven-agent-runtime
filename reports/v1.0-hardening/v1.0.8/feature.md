# v1.0.8 Feature Review

Date: 2026-07-16

## Outcome

Skill choice, Workflow planning/execution and Goal evaluation now operate on one complete six-field Goal Execution Contract. No stage silently falls back to description-only or identity-only semantics.

## Runtime evidence

- ADR-079 preserves Goal-domain ownership and the single LangGraph execution runtime.
- Constraints and success criteria affect retrieval/model decisions, and the exact snapshot is visible in model invocation and plan-attempt audit.
- Selection/replacement records and enriched candidates are durable PostgreSQL evidence.
- Goal Patch advances the version; repair, revision, replan and child planning cannot inherit authority from mismatched Goal content.
- Real A2A/Model/MCP E2E proves enriched Skill evidence and exact model-visible contract content.

Feature commit/tag: reconciled after publication / `v1.0.8`.
