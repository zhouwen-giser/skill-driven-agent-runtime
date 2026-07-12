# ADR-061: Task-linked low-confidence implicit feedback

## Status

Accepted — 2026-07-13

## Context

FR-EVAL-002 requires V1 to infer feedback from accepting a result, continuing modification, repeating a submission, requesting a redo, or switching Skill. These behavioral signals are ambiguous and must not be represented as explicit user ratings.

## Decision

- Persist a domain-owned `ImplicitFeedbackRecord` with source Task, trigger Task, context, evidence summary, timestamp, and a fixed confidence of `0.35`.
- Infer acceptance or repetition when a new Task follows the most recent terminal Task in the same context. Normalized equal request text means repetition; other text means acceptance.
- Infer continued modification or redo only after a successful natural-language plan revision. Recognize a narrow English/Chinese redo vocabulary; all other revisions are continued modification.
- Infer Skill switching only when failure recovery binds a different replacement Skill.
- Keep inference synchronous with the authoritative lifecycle write and expose records by related Task through management HTTP.
- Do not treat inferred feedback as an explicit rating or automatically mutate Skills, Prompts, or Workflows.

## Consequences

All five V1 behaviors are source-linked and auditable, while their ambiguity remains visible through low confidence. Vocabulary-based redo detection is intentionally conservative and may require later model-assisted classification, but V1 never upgrades the confidence silently.
