# ADR-060: Cross-evaluate completed Tasks with five fixed components

## Status

Accepted — 2026-07-13

## Context

FR-EVAL-001 requires completed Tasks to be cross-evaluated by Goal, Workflow, Skill, result-quality and Tool-call evaluators and persisted as one structured quality report. Existing Goal evaluation controls execution but is not the final multi-perspective quality artifact.

## Decision

- Run five independent structured model calls at the fixed `evaluation` stage after Result Processing for both formal and Temporary Skill Tasks.
- Give each component the same replayable evidence envelope: Goal and Goal evaluation, immutable Workflow DSL and instance/budget/errors, actual Skill identity/Schemas, and ProcessedResult facts/value/errors.
- Require each strict response to contain normalized score, displayable summary, findings and at least one evidence reference. Private reasoning is neither requested nor persisted.
- Deterministically average the five scores. Classify at least 0.8 as passed, at least 0.5 as warning, otherwise failed.
- Persist exactly one PostgreSQL `TaskQualityReport` per Task linked to Goal/version, WorkflowInstance and ProcessedResult. Expose it by Task through management HTTP.
- Do not reuse these evaluators as a second Workflow runtime or let quality evaluation alter the immutable execution that produced the evidence.

## Consequences

Quality evidence is cross-perspective, structured and replayable. Model semantic calibration remains provider-dependent; schema, aggregation and source identity are deterministic. A Task may become terminal immediately before the report transaction finishes, so API consumers may briefly observe report-not-found and retry.
