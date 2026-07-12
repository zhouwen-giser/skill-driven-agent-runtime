# ADR-063: PostgreSQL Evaluation analytics

## Status

Accepted — 2026-07-13

## Context

FR-EVAL-004 requires management visibility of success rate, latency, call cost, failure types, version stability, and quality trend, filterable by Skill/version/model/Tool. Existing Skill selection metrics are mutable selection inputs and cannot serve as the authoritative historical dashboard.

## Decision

- Define one analytics sample per immutable `EvolutionExperience`/`WorkflowInstance` pair.
- Read success class and duration from Experience, actual call cost from persisted Workflow budget usage, failure codes from structured instance errors or a non-achieved Goal-evaluation decision, and quality trend from the linked `TaskQualityReport`.
- Group samples by actual `skillVersions`. Calculate version stability as success rate multiplied by one minus the population deviation of quality scores (or binary outcomes when no quality report exists). Round public ratios to six decimal places.
- Add an optional `task_id` foreign key to `model_invocation`. Task-owned result processing, quality evaluation, and Prompt optimization calls populate it, enabling exact provider/model filtering without parsing prompt text.
- Filter Tool evidence through the actual Tool references stored on Experience. Skill version and Tool name require their parent Skill/Server identity.
- Aggregate on demand from PostgreSQL through an Evaluation-domain service. Do not create Redis counters, frontend-owned metrics, or a second source of truth.
- Expose one read-only management endpoint with Skill, version, provider, model, server, and Tool filters. The later console consumes this same endpoint.

## Consequences

Metrics are reproducible from immutable evidence and remain consistent with execution replay. Historical model calls created before migration `0049` have no Task link and therefore cannot match model filters, although their invocation audit remains available. Stability is an operational score, not a statistical confidence claim.
