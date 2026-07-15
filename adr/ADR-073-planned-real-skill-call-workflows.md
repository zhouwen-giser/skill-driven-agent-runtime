# ADR-073: Planned Real Child Workflows for skill_call

## Status

Accepted on 2026-07-15.

## Context

ADR-042 established independent persisted Workflow instances for `skill_call`, but its child definition was a deterministic single `llm` node. Runtime Hardening v1.0.2 requires the selected current Skill to drive normal Workflow planning and validation so a child can execute its declared MCP Tool policy rather than asking one model call to imitate the Skill result.

The parent Workflow already passed a v1.0.1-resolved immutable input snapshot. The child must preserve the single LangGraph runtime, current Skill version evidence, current MCP schemas and parent cancellation signal. Complete transitive nested confirmation is explicitly assigned to v1.0.5.

## Decision

- `SkillCallWorkflowService` loads and validates the current enabled Skill version, then supplies its description, guidance, input/output schemas, Tool/runtime policies, resolved input and current MCP planning metadata to the existing `WorkflowPlannerService`.
- The normal planner persists bounded model attempts and a validated child plan. The service revalidates the returned definition, confirms it under the existing parent-covered v1.0.2 policy, and executes it through `WorkflowExecutionService` and the sole LangGraph runtime.
- Tool policy is scoped to the Workflow governed by that Skill. A parent graph records and budgets a referenced child Skill, but the child Skill's required/forbidden Tool policy is enforced only against its independently planned child graph.
- The child result is validated again against the actual current Skill output schema. Invalid, failed or canceled child outcomes are recorded and propagated; no model-generated fallback result is allowed.
- Node execution propagates the parent `AbortSignal`. A bounded async Skill ancestry rejects cycles and composition deeper than eight calls before another child plan is generated.
- The existing parent/node → child plan/instance/SkillVersion record remains the audit link for the feature increment. The v1.0.2 bug-fixed phase adds an independent `call_id` so repeated entry is append-only.

## Consequences

Child Workflows may contain real MCP, LLM, control and nested Skill nodes while retaining the same planner, validator, executor, persistence and audit boundaries as top-level Workflows. Planning/model failure, Tool policy failure, MCP failure, cancellation and output-schema failure fail the parent node rather than producing a synthetic success.

Nested confirmation policy will be finalized in v1.0.5.

The v1.0.2 bug-fixed review additionally bounds child results to finite JSON of at most 64,000 serialized characters before returning them to parent state. Migration 0054 preserves every repeated parent-node call; its rollback collapses each parent/node history to the latest relation before restoring the legacy key.
