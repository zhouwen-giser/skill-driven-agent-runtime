# Workflow budget enforcement increment

Date: 2026-07-12

This increment adds domain-owned Workflow budget limits/usage, system-default plus Skill-override resolution, conservative multi-Skill composition, instance-local concurrency-safe LangGraph enforcement, deadline AbortSignals, stable fail-closed termination reasons, and PostgreSQL persistence of selected Skill versions and immutable budget evidence.

Unit tests prove default/override resolution, strict invalid-policy rejection, parallel call-count reservation, no external call when cost is exhausted, duration termination, and application-level Skill version pinning. PostgreSQL integration preserves limits/usage. Same-process e2e registers a real enabled Skill with `maxMcpCalls: 0`, derives that override from PostgreSQL, and proves the compiled plan terminates with zero MCP invocations while normal and repaired plans still perform their expected real MCP calls.

`maxReplans` is resolved and persisted but not yet enforced; the outer controller required by FR-WF-008 is the next increment. Therefore FR-WF-009 remains developing rather than being overstated as complete.

## Verification

The full repository gate passed on 2026-07-12 with `pnpm verify:architecture; pnpm verify:ep01`:

- architecture boundary scan: 90 TypeScript source files
- unit tests: 79 passed
- integration tests: 17 passed
- contract tests: 23 passed
- end-to-end tests: 15 passed
- format check, lint, strict typecheck, production build and local server smoke: passed
- selected official A2A HTTP+JSON MUST harness: 67 passed, 0 selected failures

The generated A2A compatibility artifacts retain diagnostics for deselected upstream cases; the selected command itself is green.
