# ADR-105: Skill Usage Compilation and Workflow Plan Compliance

## Status

Accepted on 2026-07-17.

## Context

Phase 9 must project guidance, template and procedure decisions into the existing Workflow planning
authority and deterministically reject plans that weaken Skill policy. The existing Workflow DSL has
closed node/expression variants but no general-purpose policy language, evidence node or second
procedure runtime. Normative and forbidden-action declarations are bounded human-authored text and
cannot safely be converted into executable predicates by a model.

## Decision

- Domain owns an immutable exact-version `SkillUsagePlanPolicy` and structured compliance result.
  Application derives the policy from the selected Usage candidate, composition IR and live-readiness
  summary; no SDK, ORM or LangGraph type enters it.
- Guidance supplies the bounded policy as structured Planner data. It includes the complete Goal
  contract, normative/adaptive items, context evidence summary, allowed exact Task operations, related
  exact Skill versions, failure policy, evidence requirements, mode decision and readiness summary. It
  never supplies package files, unbounded Markdown, history or private reasoning.
- Template and procedure IR compile deterministically to the existing `WorkflowDefinition`. Exact
  composition mappings become restricted Workflow references, Task bindings become exact selected
  MCP operation nodes, and context/evidence hard gates use restricted `ref` conditions whose false
  branch terminates unsuccessfully.
- Every deterministic candidate and every model-generated or repaired candidate runs through the
  existing `WorkflowValidator`, then the Skill Usage compliance checker. A deterministic candidate is
  the first bounded attempt; an invalid candidate may consume only the Planner's existing remaining
  repair attempts.
- Compliance structurally checks Tool/Task and Provider allowlists, selected bindings, composition
  node budget, exact admitted children, failure handlers and context/evidence false-to-failure gates.
  The complete immutable policy remains attached to the plan, and required confirmation is enforced
  by the existing outer Workflow Plan confirmation boundary. A model explanation is not evidence of
  compliance and no duplicate in-graph confirmation is introduced.
- Confirmation, exact-argument V1.1 readiness, Workflow immutability and LangGraph execution remain
  unchanged. Phase 9 adds no runtime, persistence state or migration.

## Consequences

All three modes converge on one validated Workflow authority. Mechanically enforceable policy fails
closed. Textual safety policy remains attached to the plan for human review instead of being
misrepresented as a proven semantic predicate. Phase 10 may wire this prepared policy into the
existing runtime without changing the compiled graph contract.

## Rejected Alternatives

- Execute `SkillProcedureProgram` directly: creates a second runtime and bypasses confirmation.
- Treat a model's policy explanation as compliance: supplies no deterministic evidence.
- Compile natural-language forbidden actions into guessed code or expressions: converts untrusted text
  into executable authority.
- Add a new behavior-tree/evidence engine or mutable Workflow metadata state: duplicates existing
  Workflow and persistence authority.
