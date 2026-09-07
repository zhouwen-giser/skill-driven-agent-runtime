# v1.0.1 Implementation

Date: 2026-07-15

## Outcome

Workflow nodes can recursively bind finite JSON data from initial input, node outputs, errors, loop counts and result state. The resolved value is a detached immutable snapshot created immediately before the node call.

## Design

- Workflow domain owns `WorkflowBoundValue` and its exact restricted reference form.
- The sole LangGraph Runtime owns resolution; no second executor or executable expression language was added.
- Planning validates template structure. Static MCP/Skill values retain plan-time business-schema validation; dynamic values are revalidated after resolution against the current MCP Tool or Skill schema.
- LLM nodes receive static instruction plus separately resolved dynamic context. Subworkflows receive their resolved `input`.

No ADR or migration was required because existing domain/runtime authority and JSON persistence boundaries are unchanged.
