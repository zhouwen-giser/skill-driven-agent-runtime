# ADR-062: Report-linked Evaluation influence

## Status

Accepted — 2026-07-13

## Context

FR-EVAL-003 requires Task evaluation results to participate in Skill evolution, Workflow Template induction, and candidate Prompt optimization, with evolution records referencing the evaluation report. FR-LLM-007 additionally requires automatically generated Prompt candidates to remain inactive until administrator publication.

## Decision

- Keep `TaskQualityReport` authoritative in the Evaluation domain and persist one `EvaluationInfluenceRecord` per report.
- Link the influence record to the Task and the existing replayable Evolution Experience. For formal Skills, create a version-specific quality observation whose `evaluationRef` names the report.
- Admit an otherwise-successful Evolution Experience into Workflow Template occurrence evidence only when the Task quality report is `passed`. Store the report ID on the occurrence. Warning/failed reports are explicitly recorded as rejected template evidence.
- For warning/failed reports, deterministically map the weakest assessment component to the affected model stage and ask the fixed `evaluation` model route for an improved Prompt containing the mandatory `{{instruction}}` placeholder.
- Add the generated text as an `auto_candidate` version under the stage's current Prompt identity. Never change the current version; existing administrator publication remains the only activation path.
- Persist downstream observation/template/candidate identities and dispositions in PostgreSQL and expose the influence record by report through management HTTP.
- Do not mutate an executing Workflow, auto-publish a Skill, auto-activate a Prompt, or introduce another execution runtime.

## Consequences

Every quality report has auditable downstream influence rather than an untraceable background heuristic. Template induction becomes quality-gated, and Prompt optimization remains reviewable. Prompt semantic quality is model-dependent; strict Schema plus PromptService validation requires the literal placeholder and rejects malformed candidates.
