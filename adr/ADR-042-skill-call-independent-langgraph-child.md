# ADR-042: Independent LangGraph child Workflows for skill_call

## Status

Superseded by ADR-073 — 2026-07-15

## Context

FR-SKL-010 and FR-SKL-011 require every `skill_call` node to remain explicit, execute as an independent child Workflow, resolve the currently effective Skill version at call time, and retain independent state, version, and evaluation evidence. The previous runtime called the model directly from the node adapter, so no child execution record existed.

FR-SKL-008 also requires formal Skills to be globally shared rather than scoped by `user_id`.

## Decision

- Keep `skill_call` as a first-class restricted DSL node compiled by LangGraph.js.
- Pass the parent execution and node identity through the domain-neutral runtime port.
- Resolve the current enabled SkillVersion when the node executes.
- Materialize a deterministic child plan from that immutable SkillVersion, covered by the already-confirmed parent `skill_call`; revalidate it through the normal WorkflowExecutionService before execution.
- Execute the child through the same LangGraphWorkflowExecutor and persist a separate WorkflowInstance and ordered node events.
- Persist `skill_call_workflow` linkage with parent instance/node, child plan/instance, actual SkillVersion, terminal status, and a displayable schema-evaluation summary.
- Keep the formal Skill registry global. Task `user_id` affects Task/Context attribution, not Skill visibility or selection.

## Consequences

There remains one Workflow runtime. Child calls consume independent Workflow state and can be audited without external SDK types entering the domain. A new migration, `0034_skill_call_workflow`, adds the parent-child evidence relation. Parent confirmation authorizes the deterministic child template; no new MCP call is introduced before confirmation.
