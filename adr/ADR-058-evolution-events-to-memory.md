# ADR-058: Project authoritative evolution events into Memory

## Status

Accepted — 2026-07-12

## Context

FR-MEM-005 requires Skill manual corrections, Prompt corrections, failure reasons and evaluation conclusions to become retrievable evolution experience. These events already have authoritative records but were not consistently projected into long-term Memory.

## Decision

- Add one `MemoryService.recordEvolution` entry point. It routes Skill corrections to `skill_learning`, Prompt corrections to `prompt_learning`, failures to `failure_experience`, achieved evaluations to `success_experience`, and other evaluations to `failure_experience`.
- The projection calls the existing strict model refinement/admission path; it does not copy raw records directly into Memory.
- Project only after the authoritative source write succeeds:
  - Skill correction after immutable correction Experience persistence;
  - Prompt `manual_correction` after the new PromptVersion is stored;
  - Task failure after terminal Task/event persistence;
  - evaluation conclusion after WorkflowControlRound and Evolution Experience persistence.
- Use stable source references (`skill-evolution-correction:`, `prompt:<id>:<version>`, `task:`, `workflow-control-round:`) and structured displayable summaries/content. Prompt summaries include version so distinct corrections retain distinct evidence while replay of the same source remains deduplicable.
- Existing stage-specific retrieval makes `skill_learning`, `prompt_learning`, success and failure experience available to later generation/selection/evaluation according to ADR-056.

## Consequences

Later decisions can retrieve human corrections and runtime lessons without coupling domain services to external frameworks. Projection uses the configured model and may fail visibly if refinement is unavailable; authoritative source records remain persisted and are never replaced by Memory.
