# ADR-027: Fixed-stage LLM final decision boundaries

## Status

Accepted on 2026-07-12.

## Decision

- Intent classification, Goal formulation, Skill selection, Workflow generation, execution-exception strategy, and Goal evaluation each use their fixed Model Runtime stage and strict structured response schema.
- Retrieval, metrics, graph rules, validator errors, and immutable Workflow structure provide candidates and constraints only. They never select the final Skill, exception strategy, Workflow, or Goal outcome.
- The production Skill decider is the structured Model Runtime decider. An injected decider remains available only as an explicit test/runtime composition option; absence of a configured production model fails instead of applying a score-sort fallback.
- Skill candidates presented to the model include immutable identity/version, name, summary, capabilities, creation time, semantic score, and an operational metric snapshot. This evidence is persisted with the decision.
- Execution exception decisions are constrained to `terminate`/`continue` and, when the immutable graph provides a target, `goto`. The model cannot create nodes, choose an unregistered Tool, or escape the compiled graph.
- A failed fixed-stage decision marks Task preparation failed and is rethrown for queue observability. No alternate model or rule fallback is attempted.
- Only displayable summaries and structured outputs are stored. Private model reasoning is neither requested nor persisted.
- Provider adapters parse only the displayable text block and normalized usage metadata. Vendor thinking/reasoning/signature blocks and undeclared top-level fields are discarded before the Application audit boundary.

## Consequences

- FR-LLM-004 has unit, PostgreSQL, model-audit, queue-path, and same-process e2e evidence across all six required final decisions.
- FR-LLM-005 is strengthened for Skill retrieval, but Experience and long-term Memory retrieval remain EP-05 work.
- The lifecycle processor still stops at the planning boundary; connecting its selected Skill/Goal directly to generated plan execution is part of the broader EP-04 task orchestration closure.
