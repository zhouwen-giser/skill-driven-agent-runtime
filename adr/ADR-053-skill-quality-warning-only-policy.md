# ADR-053: Low Skill quality produces warnings only

## Status

Accepted — 2026-07-12

## Context

FR-EVO-009 requires consecutive low scores or a rising failure rate to create visible quality warnings without automatically disabling or repairing the Skill. Evaluation observations must remain version-specific and replayable.

## Decision

- Store immutable quality observations with Skill ID/version, evaluation reference, normalized score, success class, and timestamp.
- Raise `consecutive_low_score` when the latest three scores are all at or below 0.4.
- Raise `failure_rate_increase` when two complete three-sample windows exist, the recent failure rate is at least 0.5, and it increased by at least one third over the preceding window.
- Persist one active warning per Skill version and warning kind with the contributing observation IDs, observed value, threshold, displayable summary, and Skill status at creation.
- `SkillQualityService` has read-only access to Skill versions and no dependency capable of registration, status mutation, repair, or evolution. Only explicit administrator lifecycle operations may disable, roll back, or correct a Skill.
- Management HTTP accepts normalized evaluation observations and lists warnings. Later evaluator orchestration uses the same application service rather than duplicating warning logic.

## Consequences

Warnings are operational evidence, not an automated mutation signal. A warned enabled Skill remains the same current version and stays in Agent Card until an administrator acts.
