# ADR-043: Fail-closed Skill Tool policy enforcement

## Status

Accepted — 2026-07-12

## Context

Skill metadata already persisted required, optional, and forbidden MCP Tool sets, but plan preparation and confirmed execution did not consume those boundaries. FR-SKL-004 requires missing required Tools to be detected and forbidden Tools never to execute.

## Decision

- Validate selected immutable SkillVersion policies against the complete Workflow definition.
- Reject a missing required Tool and any referenced forbidden Tool with structured version-specific evidence.
- Run the check immediately after Task plan generation and again after confirmed-plan revalidation, before creating a running instance or invoking LangGraph/MCP.
- Keep optional Tools non-mandatory. Policy sets remain disjoint by the existing Skill domain invariant.

## Consequences

Stale or administratively attached plans cannot bypass Tool policy. A generated invalid plan may remain as non-confirmed audit evidence, while its Task fails closed. No new permission model or runtime is introduced.
