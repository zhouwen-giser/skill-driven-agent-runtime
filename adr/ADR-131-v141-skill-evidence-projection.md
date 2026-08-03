# ADR-131: Canonical Skill Evidence Projection

- Status: Accepted
- Date: 2026-08-04

## Context

`sdar.evidence/v1` requires all sixteen Skill-family records to reconstruct discovery, exact
version selection, context resolution, parent/child composition, Capability Slot resolution,
procedure/compliance decisions, execution references and failure propagation. Runtime PostgreSQL
already owns these facts; Evidence must not become a competing authority or infer missing facts.

## Decision

Use a repeatable-read, read-only `PostgresSkillEvidenceSource` and a durable
`SkillEvidenceProjector` after Runtime Core projection. The projector:

- derives `skill.execution` from the same immutable revision input used by Runtime Action future
  references;
- snapshots the exact persisted `skill_version.usage_specification_json` separately from the
  execution policy;
- resolves Plan Steps by exact Plan ID and selections by exact execution correlation;
- resolves a Capability Slot only from the declared Skill Version slot, the unique immutable Task
  Capability Binding version, and the matching `capability.definition` Evidence payload;
- preserves parent/child edges, external waits/resumes, all seven execution-reference kinds,
  compliance failures and `fail_fast`/`recoverable`/`optional`/`degraded` propagation;
- records a blocking Quality Issue and emits no invented derived record when identity or authority
  is missing; and
- appends idempotently to Runtime PostgreSQL and advances a per-Task `skill/v1` checkpoint.

The Server runs Runtime Core before Skill projection. Redis remains wake-only and owns neither the
source facts nor canonical Evidence.

## Consequences

The full Skill tree is reproducible without prompts, hidden reasoning, timing guesses or
`unresolved` sentinels. Control-owned Capability definitions remain cross-family prerequisites;
their formal projector is completed in the later Control phase. Missing prerequisites are visible
as blocking issues, never silently substituted.
