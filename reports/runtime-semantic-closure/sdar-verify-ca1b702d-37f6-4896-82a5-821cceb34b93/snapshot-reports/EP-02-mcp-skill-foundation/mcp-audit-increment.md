# EP-02 MCP Audit and Dependency Evidence

Date: 2026-07-11

## Verified behavior

- PostgreSQL migration `0009_mcp_audit` stores invocation records and dependency warnings with rollback SQL.
- Real PostgreSQL integration verifies atomic Tool replacement plus warning creation only for a current enabled SkillVersion that references the changed Tool.
- Unit tests verify successful and failed call audit summaries, pre-transport Schema rejection, refresh-stable enhancement metadata, and deliberate absence of repeated-call deduplication.
- Single-process e2e verifies task/context-correlated successful invocation records after an official SDK loopback call.

## Remaining

Management API/console display, LLM-generated enhancements, and replayed LLM retry/alternative/termination decisions are not yet verified.

## Full regression gate

`pnpm verify:ep01` passed after the increment: format, lint, strict typecheck, unit 30, real integration 9, contract 14, e2e 6, production build, built-server smoke, and pinned official A2A TCK harness (67 selected MUST tests passed). Architecture verification separately passed across 49 source files. The known production A2A compatibility diagnostic distinction remains unchanged and is not claimed as full upstream conformance.
