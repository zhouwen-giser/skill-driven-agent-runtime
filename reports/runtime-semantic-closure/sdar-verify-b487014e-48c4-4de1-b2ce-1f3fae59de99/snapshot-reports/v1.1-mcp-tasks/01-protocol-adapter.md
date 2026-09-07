# v1.1 MCP Tasks Phase 1 — Protocol Adapter

Status: **passed for Phase 1 scope**. This is not final v1.1 acceptance.

## Delivered boundary

- Domain-owned capability, immediate result, remote Task handle, five-state snapshot and operation-ack models contain no MCP SDK types.
- The MCP adapter negotiates modern versus legacy protocol behavior, validates the attributed frozen Tasks Schema, and exposes `tools/call`, `tasks/get`, `tasks/update` and `tasks/cancel` through the application-owned port.
- `tools/call` returns a validated `immediate | remote_task` union. A synchronous `isError=true` response stays immediate, is audited as `failed/MCP_TOOL_BUSINESS_REJECTION`, and never creates or exposes a remote Task ID.
- Unknown result variants, undeclared Task capability, malformed IDs, unknown statuses and unknown top-level fields fail closed with stable adapter errors.
- Exact external `Mcp-Method` and `Mcp-Name` routing headers preserve the existing execution-mode, simulation-ID and replay-ID headers.
- The architecture gate rejects MCP client imports outside `packages/mcp-adapter` and rejects SDK/client leakage into domain or application code.

## Frozen compatibility envelope

- Production client: exact `@modelcontextprotocol/client@2.0.0-beta.4`, tag object `5aa0a828...`, commit `e81758ca...`.
- Legacy loopback Server fixture: exact `@modelcontextprotocol/sdk@1.29.0`, commit `e12cbd70...`.
- Tasks contract: official Apache-2.0 `modelcontextprotocol/ext-tasks` commit `8966bea9...`; TypeScript Schema blob `2634c47c...`, JSON Schema blob `d6ccaff7...`.
- Contract-tested negotiated protocol revision: `2026-07-28`; extension draft source revision: `2026-06-30`.

ADR-090 records why the v1 SDK path was rejected and confines the temporary beta compatibility bridge to the adapter. The HTTP contracts prove that bridge-only aliases and envelopes never escape onto the external wire.

## Reproducible checks

```text
pnpm verify:bootstrap
  PASSED: format, lint, strict typecheck, 57 files / 283 tests
          219 unit, 64 contract, 176-file architecture gate,
          A2A TCK, OpenAPI, acceptance inventory, sources, license/SBOM, builds

pnpm evidence:licenses && pnpm verify:licenses && pnpm verify:sources
  PASSED: 286 npm packages, 19 exact OSS source pins

pnpm verify
  PASSED: 115448 ms, development worktree (`dirty=true`)
          283 unit/contract, 42 real PostgreSQL/Redis integration,
          42 real PostgreSQL/Redis/model/MCP E2E, 55 migrations,
          production builds, infrastructure smoke, Server/Console smoke
```

The unified machine report is `reports/verification/summary.json`; it records the run from `2026-07-15T23:48:58.655Z` through `2026-07-15T23:50:54.103Z`. `dirty=true` is expected because this is the pre-commit Phase 1 evidence run and is disclosed rather than represented as a clean-tag release gate.

The focused adapter suite has 11 contracts covering synchronous success, remote acceptance/get/update/cancel, legacy fallback, undeclared capability, malformed ID/status/field, exact routing headers, and negotiated protocol revision.

## Evidence classification

**Real local verification:** the official v2 Client and Streamable HTTP transport communicate with a real loopback HTTP endpoint; the official v1 Server verifies legacy fallback. Tests inspect exact HTTP methods, bodies, routing headers, capabilities and protocol revision.

**Simulated Provider behavior:** the loopback Provider deterministically models success, remote acceptance, rejection and malformed responses. It is not an external production Provider, and no production credentials are used.

**Unverified:** durable bindings/observations, BullMQ polling/reconciliation, availability/timing, external continuation, input/cancellation lifecycle, management UI and final 16-scenario acceptance belong to Phases 2–6. The Server intentionally raises `MCP_REMOTE_TASK_PHASE_NOT_CONNECTED` for a remote outcome until the durable continuation path exists; direct adapter/application contracts expose the union now.
