# LangGraph compiler and immutable execution increment

Date: 2026-07-12

This increment converts confirmed, revalidated Workflow DSL into an immutable LangGraph.js `StateGraph` and executes it through protocol-neutral ports. It adds a type-strict restricted expression interpreter; compilation/execution coverage for LLM, MCP Tool, result, condition, parallel convergence, bounded loop, subworkflow, human confirmation, error handler, and Skill nodes; PostgreSQL Workflow instances and ordered node events; confirmation and execution management endpoints; recursion guards; and real local MCP end-to-end execution.

The e2e scenario proves both sides of the confirmation boundary: an initial unconfirmed plan cannot invoke MCP, while a new corrected version sourced from a confirmed plan inherits confirmation and executes without a redundant second confirmation.

Live persisted human-confirmation interrupts, replanning, budgets, and A2A task-runtime orchestration remain open and are not claimed by this increment.

## Verification

Incremental checks completed before the full gate:

- architecture boundary scan: 88 TypeScript source files
- focused compiler/expression/application unit tests: passed
- PostgreSQL integration tests: 17 passed
- management contract test: 6 passed
- same-process PostgreSQL/Redis/model/real-MCP e2e: 15 passed

The full repository gate passed on 2026-07-12 with `pnpm verify:architecture; pnpm verify:ep01`:

- architecture boundary scan: 88 TypeScript source files
- unit tests: 72 passed
- integration tests: 17 passed
- contract tests: 23 passed
- end-to-end tests: 15 passed
- format check, lint, strict typecheck, production build and local server smoke: passed
- selected official A2A HTTP+JSON MUST harness: 67 passed, 0 selected failures

The generated A2A report continues to display diagnostics from deselected/non-target upstream cases; the selected compatibility command itself passed.
