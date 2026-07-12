# ADR-051: Manual evolution corrections are immutable Experience records

## Status

Accepted — 2026-07-12

## Context

FR-EVO-007 requires an administrator to correct a failed evolution draft, rerun validation, and retain the correction as subsequent evolution experience with actor, diff, and result. The V1 management plane intentionally has no authentication, so an actor value is an operator-supplied audit label rather than a verified identity.

## Decision

- Only a `validation_failed` formalization candidate may be corrected. Published candidates and unevaluated candidates are rejected.
- The capability target and `skillId` remain immutable. An administrator may correct the proposed Skill contract and guidance, including Schemas and Tool combination.
- Revalidation reruns the same static, source, historical Workflow, normal, boundary, and exception gates. Simulation validates each input against the corrected Skill input Schema before invoking MCP.
- Each attempt creates an immutable `SkillEvolutionCorrectionExperience` containing candidate/capability identity, operator-supplied actor, summary, before/after Skill snapshots, deterministic JSON-pointer diff, complete validation report, outcome, and timestamp.
- The correction history is PostgreSQL-authoritative and queryable through management HTTP. It is evolution experience data rather than mutable audit metadata.
- The all-pass publication rule remains unchanged. A corrected draft publishes only when every gate passes; another failure remains a draft and still records the correction attempt.

## Consequences

Manual learning is replayable without overwriting the original failed proposal or report. The actor field is traceable but not authenticated in the trusted-intranet V1 baseline; operators must not interpret it as cryptographic identity proof.
