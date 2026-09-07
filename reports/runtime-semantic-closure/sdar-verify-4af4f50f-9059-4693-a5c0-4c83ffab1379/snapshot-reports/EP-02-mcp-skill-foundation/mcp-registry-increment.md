# EP-02 MCP Registry Increment Evidence

Date: 2026-07-11

## Real verification

- `pnpm test:integration`: 2 files, 9 tests passed with Docker PostgreSQL and Redis.
- `pnpm test:contract`: 3 files, 14 tests passed using the official MCP SDK over real loopback Streamable HTTP.
- `pnpm test:e2e`: 1 file, 6 tests passed. The single-process runtime registered, persisted, invoked, validated, and deleted a live Mock MCP Server without restart.

## Static and unit verification

- Format, lint, typecheck, architecture (49 source files), and production build passed.
- `pnpm test:unit`: 8 files, 28 tests passed, including AES-GCM tamper rejection and refresh warnings.

## Regression gate

`pnpm verify:ep01` passed unchanged after this increment: format, lint, typecheck, unit 28, integration 9, contract 14, e2e 6, build, built-server smoke, and the pinned official A2A TCK harness (67 selected MUST tests passed, 0 harness failures). The separately generated production compatibility diagnostic still carries the previously documented fixture/state-boundary limitations and is not represented as full upstream TCK conformance.

## Not yet verified

Management APIs/console, LLM metadata enhancement, persisted dependency warnings, invocation audit records, and LLM failure-decision replay remain open. No idempotency or duplicate-call protection is claimed.
