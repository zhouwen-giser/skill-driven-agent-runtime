# ADR-022: LangGraph compiler and immutable Workflow execution

## Status

Accepted on 2026-07-12.

## Decision

- `packages/domain` owns only serializable Workflow definitions, instances, and audit-event models. LangGraph types remain confined to `packages/langgraph-runtime`.
- The application revalidates a persisted plan against the current MCP Tool and enabled Skill catalogs immediately before execution. Only a repository-confirmed plan can reach the compiler.
- The compiler clones and recursively freezes the validated definition, then constructs one LangGraph.js `StateGraph`. It never evaluates source text, imports generated modules, or mutates the graph during execution.
- Restricted expressions resolve only explicit state paths (`input`, `nodes`/`outputs`, `result`, `errors`, and `loopCounts`) and use type-strict boolean/scalar operations without JavaScript coercion.
- LLM, MCP Tool, Skill, confirmed subworkflow, and human-confirmation behavior enter through protocol-neutral runtime ports. The production human-confirmation port fails explicitly until EP-04 supplies persisted pause/resume handling.
- Condition and loop nodes use compiled conditional edges; loop counts are capped by the validated DSL bound. Parallel branches fan out and use a LangGraph multi-source edge at their nearest common convergence. Error handlers route only a named handled node through terminate, continue, or goto behavior.
- PostgreSQL stores the immutable plan, Workflow instance transitions, and ordered displayable node events. Tool/model-specific payloads remain in their existing invocation audit records; private reasoning is not stored.
- A repaired plan inherits confirmation only from a repository-confirmed source and can execute without another confirmation. An initial plan still requires confirmation unless later Skill policy explicitly auto-confirms it.
- Confirmed subworkflow lookup is PostgreSQL-authoritative. The composition root rejects recursive/cyclic nesting and a depth greater than 16.

## Consequences

- LangGraph.js remains the sole Workflow engine and external runtime types do not cross the adapter boundary.
- FR-WF-001, FR-WF-005, FR-WF-006, and FR-WF-007 have executable evidence, including a real local MCP task. All ten node types have compiler execution tests; live human pause/resume remains part of EP-04, so FR-WF-002 is not yet claimed complete.
- Replanning, budgets, natural-language/admin plan editing, persisted human interrupts, and task lifecycle integration remain separate increments. Running instances never adopt a replacement graph.
