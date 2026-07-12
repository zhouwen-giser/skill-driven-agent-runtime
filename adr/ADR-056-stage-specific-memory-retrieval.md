# ADR-056: Retrieve Memory by decision stage

## Status

Accepted — 2026-07-12

## Context

FR-MEM-003 requires intent recognition, Skill selection, Workflow generation, exception handling and Goal evaluation to use distinct Memory types and query templates. A single generic semantic search would mix unrelated evidence and make model inputs hard to audit.

## Decision

- Define the five `MemoryRetrievalStage` values in the domain and keep one `MemoryService.searchForStage` implementation.
- Use these deterministic policies:
  - intent: facts plus successful/failed experiences;
  - Skill selection: Skill learning plus successful/failed experiences;
  - Workflow generation: Workflow patterns plus successful/failed experiences;
  - exception handling: failed experiences, Skill learning and Workflow patterns;
  - Goal evaluation: facts plus successful/failed experiences.
- Each stage owns an explicit English query template naming its decision purpose. PostgreSQL/pgvector retrieves active candidates; the application filters the domain type whitelist and caps the displayed context.
- Inject source-linked, displayable Memory fields and retrieval score into the existing fixed-stage JSON instruction for `StructuredTaskDecisionService`, `StructuredSkillSelectionDecider`, `WorkflowPlannerService`, `StructuredExecutionExceptionDecider` and `StructuredGoalEvaluator`.
- The normal Model Runtime audit persists the complete rendered request, so the exact stage Memory evidence is replayable without storing private reasoning.

## Consequences

All five decision paths use one domain-owned retrieval policy and the existing model/runtime chain. No Memory record executes code or bypasses Workflow validation, planning confirmation or LangGraph execution. Query/embedding quality depends on the configured provider, while type eligibility and limits remain deterministic.
