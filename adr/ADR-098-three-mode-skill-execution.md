# ADR-098: Three-mode Skill Execution through One Workflow Authority

## Status

Accepted on 2026-07-17.

## Context

V1.2 defines guidance, template and procedure usage. These modes must aid planning without creating a
procedure engine beside the existing Workflow DSL, validator and LangGraph.js compiler.

## Decision

- The only execution modes are `guidance`, `template` and `procedure`; mode decisions are structured
  Domain data, not arbitrary model strings.
- All modes ultimately enter the existing Workflow planning, validation, confirmation and execution
  path. Guidance supplies bounded context, template supplies validated declarative mappings, and
  procedure supplies a deterministic `SkillProcedureProgram`.
- Phase 5 procedure output is IR only. Phase 9 may translate it into the existing Workflow DSL and must
  run the existing validator and policy checks before confirmation.
- `SkillProcedureProgram` contains closed step variants and exact Skill references. It cannot contain
  source code, SDK objects, functions, unrestricted expressions or a precompiled LangGraph graph.
- LangGraph.js remains the sole runtime; Workflow instances remain immutable while executing.

## Consequences

Mode choice changes planning input and required gates, not runtime authority. Existing confirmation,
Tool policy, continuation, cancellation and terminal-outcome semantics remain authoritative.

## Rejected Alternatives

- Direct procedure execution: bypasses Workflow validation and confirmation.
- A behavior-tree or second graph runtime: violates the single-runtime invariant.
- Model-generated Workflow code: treats LLM output as executable source.
