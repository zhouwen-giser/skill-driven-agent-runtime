# Outer Goal evaluation and replanning increment

Date: 2026-07-12

This increment adds a PostgreSQL-authoritative Goal repository, strict structured Goal evaluator, application-owned outer controller, ordered round evidence, immutable next-version planning, confirmation pause/continue behavior, all-Skill automatic-confirmation gating, and fail-closed max-replan termination.

Unit tests cover achieved/replan/unachievable decisions, malformed/private evaluation output, a failed instance that replans, normal confirmation pause/continue, all-Skill auto-confirm, and `maxReplans=0`. PostgreSQL integration proves Goal and round replay. Same-process e2e uses the real fixed-stage local model and real MCP server: version 1 executes, evaluation requests a new version, version 2 is generated outside LangGraph and auto-confirmed by an opted-in Skill, the second MCP execution succeeds, evaluation achieves the Goal, and both rounds remain queryable.

## Verification

The full repository gate passed on 2026-07-12 with `pnpm verify:architecture; pnpm verify:ep01`:

- architecture boundary scan: 96 TypeScript source files
- unit tests: 85 passed
- integration tests: 18 passed
- contract tests: 24 passed
- end-to-end tests: 16 passed
- format check, lint, strict typecheck, production build and local server smoke: passed
- selected official A2A HTTP+JSON MUST harness: 67 passed, 0 selected failures

The generated A2A report retains diagnostics for deselected upstream cases; the selected compatibility command itself passed.
