# ADR-130: v1.4.1 Runtime Core Evidence Projection

- Status: Accepted
- Date: 2026-08-04
- Scope: the 18 required Runtime-family records in `sdar.evidence/v1`

## Context

Runtime Task, Goal, Plan, Workflow, policy, action, verification and terminal facts already belong to
Runtime PostgreSQL. Evidence must expose those facts without making the Evidence outbox another
business authority, guessing absent links, or treating Workflow success as Goal achievement.

## Decision

1. A durable projector reads one terminal Task in a repeatable-read, read-only PostgreSQL snapshot
   and maps all 18 Runtime record types into the unified Evidence outbox.
2. Stable revisions are canonical hashes of explicit source identity/status/version fields. Goal
   and Plan versions, superseded Plan identity and Goal Patch invalidations remain visible.
3. Action execution basis comes from persisted MCP invocation mode and semantics. Receipt keeps
   transport, executor and business layers separate; business success is never inferred.
4. `runtime.action` links to the exact Plan Step and stable future `skill.execution` ID only when
   one real Skill Execution matches. Parent/child Plans first correlate persisted Provider ID and
   Operation metadata; a single Plan execution is the bounded fallback. Missing or ambiguous exact
   matches create a blocking Quality Issue.
5. Run Seal projects Task, Goal, Control and Workflow statuses separately. Expected terminal
   mappings are checked; Workflow `succeeded` alone does not establish Goal `achieved`.
6. The Server polls terminal Tasks lacking either a Run Seal or its corresponding manifest. This
   makes a crash between idempotent record append and manifest save replayable. PostgreSQL owns
   source facts, checkpoints, outbox records, issues and manifests; Redis is not involved.
7. The Phase 5 manifest remains `projecting`; final cross-family sealing belongs to Phase 10.

## Consequences

Existing source transactions are not rewritten. Projection is replayable and idempotent. A source
gap remains visible as a blocking issue until repaired and replayed.

## Rejected alternatives

- Emit untyped summaries: rejected because the chain must be reconstructable.
- Pick one of several Skill Executions by time: rejected as inference.
- Equate Workflow success with Goal achievement: rejected by terminal authority.
- Use Redis as cursor authority: rejected because Redis is wake-only.
