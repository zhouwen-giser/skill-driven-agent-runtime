# ADR-103: Minimal Skill Execution Record Boundary

## Status

Accepted on 2026-07-17.

## Context

V1.2 needs enough evidence to explain Skill selection, composition and outcome without building a
parallel observability platform or overwriting existing Task, Workflow and remote Provider records.

## Decision

- Domain owns a minimal immutable `SkillExecutionRecord` contract introduced in Phase 11. It links
  Goal/version, exact Skill version, parent/child execution, applicability/mode, composition, Workflow
  plan/instance/node run, Task, Provider/resource, `RemoteTaskBinding`, evidence gates, intervention and
  outcome by stable references.
- PostgreSQL stores append-only records through migration `0106`. The next V1.2 persistence migration
  is allocated as `0105` for Phase 7 Skill usage/version/import authority; no number below the current
  0104 high-water may be reused.
- The record observes but never replaces Task phase, Workflow instance/node state, Provider observation,
  continuation, cancellation or the ADR-077 terminal transaction.
- Evidence stores bounded summaries and references, never credentials, full private model reasoning,
  SDK objects or an unbounded telemetry stream.
- Degraded completion must identify missing effects/evidence. Hard-gate failure cannot be projected as
  Skill success. Parent/child lineage and recursion budget remain queryable.
- Management API and Console projections are additive trusted-intranet reads; they do not create a new
  lifecycle write authority.

## Consequences

Operators can reproduce why a Skill was chosen and whether its declared evidence was satisfied while
existing system-of-record boundaries remain intact. Phase 11 can add one narrow repository instead of a
general scoring or tracing platform.

## Rejected Alternatives

- Store only a final score: loses exact decisions and evidence lineage.
- Copy Task/Workflow/Provider state into mutable Skill rows: creates conflicting terminal authority.
- Persist full prompts or private reasoning as execution evidence: violates privacy and observability
  boundaries.
