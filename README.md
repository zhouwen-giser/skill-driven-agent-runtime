# Skill-Driven Agent Runtime V1.2

A strict TypeScript modular monolith for Skill-driven A2A tasks. LangGraph.js is the only Workflow runtime. PostgreSQL/pgvector is authoritative storage; Redis/BullMQ owns ephemeral queue/runtime coordination; official A2A and MCP SDKs are isolated behind adapters.

V1.2 adds immutable exact-version Skill Usage packages, three safe execution modes, bounded recursive composition, V1.1 Provider readiness/continuation reuse and queryable Skill execution evidence through the existing runtime.

## Safety baseline

V1 has **no authentication, authorization, or tenant isolation**. A2A, management API, and Console must remain on localhost or a firewall-isolated trusted intranet. PostgreSQL and Redis must never have public routes. Non-loopback listeners fail closed unless the operator explicitly acknowledges the risk; that acknowledgement does not add authentication.

## Prerequisites

- Node.js 20.19 or newer (the verified environment uses Node 22.14)
- pnpm 11.7
- Docker Desktop / Docker Engine with Compose

Install the exact lockfile:

```powershell
pnpm install --frozen-lockfile
```

## One-command local acceptance demo

```powershell
pnpm demo:acceptance
```

This builds the Server and Console, starts PostgreSQL/pgvector and Redis, starts the deterministic Mock Model and 16-scenario MCP Tasks Provider inside the acceptance harness, and runs the composed V1/V1.1 acceptance flows. These include plan confirmation, streaming, Skill composition, pause/resume, Goal Patch, outer replanning, Memory, Evaluation, Skill simulation/evolution, Task availability and pre-call guarding, remote wait/continuation, input, cooperative cancellation, restart reconstruction, parallel/child waits, and final A2A delivery. It stops local containers after the run.

PostgreSQL/pgvector, Redis/BullMQ, HTTP protocol exchange, LangGraph execution, persistence, queueing, API paths, and the Console production bundle are real local components. Model decisions and the remote Provider's business behavior are deterministic simulations. No external production MCP Provider interoperability is claimed; see `reports/v1.1-mcp-tasks/V11-ACCEPTANCE.md` for per-scenario classification.

For the short basic task/confirmation/MCP demo:

```powershell
pnpm demo:local
```

`demo:local` is the short V1 regression demo. `demo:acceptance` is the reproducible V1.1 MCP Tasks acceptance command and writes both machine-readable and human-readable reports under `reports/v1.1-mcp-tasks/`.

## Run the Server and Console locally

Start infrastructure:

```powershell
docker compose up -d --wait postgres redis
```

Set the required local-only master key and start the single process:

```powershell
$env:SDAR_MASTER_KEY_BASE64='MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
pnpm build
pnpm start:server
```

Default endpoints:

- A2A Agent Card: `http://127.0.0.1:9999/.well-known/agent-card.json`
- A2A HTTP endpoint: `http://127.0.0.1:9999/a2a`
- Management health: `http://127.0.0.1:9998/api/v1/health`
- Console: `http://127.0.0.1:9998/console/`

The standalone example client can target a configured running Server:

```powershell
pnpm demo:client -- "Complete the local example task."
```

The packaged `start:server` command uses the ordinary V1 runtime profile. The additive MCP Tasks runtime is an explicit composition opt-in (`startServerRuntime({ v11McpTasks: { isolationAcknowledged: true } })`) and is exercised by the V1.1 acceptance harness against an isolated `sdar_v11_*` database. This opt-in is also what enables the narrowly scoped restart reconstruction for valid `waiting_external` continuations; it does not recover ordinary running work.

### Supplying formal Skill input

For a formal top-level Skill, the runtime resolves and validates a structured value against the selected Skill version's `inputSchema` before planning. The highest-priority source is A2A message metadata under `structured_input`:

```json
{
  "message": {
    "role": "user",
    "parts": [{ "kind": "text", "text": "Inspect the requested device." }],
    "metadata": {
      "structured_input": { "deviceId": "device-17" }
    }
  }
}
```

If required fields cannot be resolved, the same Task returns `input-required`; a follow-up message supplies the missing value and creates a new immutable resolution. The structured value—not the raw request envelope—becomes the Workflow initial input. Operators must configure a Provider route and enabled Prompt for the fixed `skill_input_resolution` model stage; its invocation and source-linked resolution history are available through the management API and Console.

## Verification

```powershell
pnpm verify
```

The unified gate runs format, lint, strict typecheck, unit, integration, contract, E2E, architecture, A2A compatibility, OpenAPI drift, source/license/SBOM, production build, infrastructure smoke, and Server/Console-bundle smoke. It writes:

- `reports/verification/summary.json`
- `reports/verification/summary.md`

Useful focused commands include `pnpm test:unit`, `pnpm test:integration`, `pnpm test:contract`, `pnpm test:e2e`, `pnpm smoke`, `pnpm verify:acceptance`, and `pnpm verify:v11-acceptance`.

The Phase 6 local gate evidence contains 493 unit+contract tests, 80 PostgreSQL/Redis integration tests, 49 E2E tests, 232 architecture assertions, 110 OpenAPI operations, and 68 reversible migration pairs. These counts describe the recorded local gate run, not external Provider certification.

## Architecture and operations

- [Architecture baseline](docs/02_ARCHITECTURE_BASELINE.md)
- [Workflow DSL](docs/05_WORKFLOW_DSL_SPEC.md)
- [API and protocol contracts](docs/06_API_AND_PROTOCOL_CONTRACTS.md)
- [Storage schema](docs/07_DATA_STORAGE_SCHEMA.md)
- [Security and risks](docs/08_SECURITY_AND_RISK.md)
- [Test and acceptance strategy](docs/09_TEST_AND_ACCEPTANCE_STRATEGY.md)
- [Demo scenarios](docs/15_DEMO_SCENARIOS.md)
- [Definition of Done](docs/16_DEFINITION_OF_DONE.md)
- [Traceability matrix](docs/17_TRACEABILITY_MATRIX.md)
- [Known assumptions and gaps](docs/18_KNOWN_ASSUMPTIONS_AND_GAPS.md)
- [Configuration, operations, and troubleshooting](docs/20_CONFIGURATION_OPERATIONS_TROUBLESHOOTING.md)
- [Contributing](CONTRIBUTING.md)
- [Release checklist](templates/RELEASE_CHECKLIST.md)

## License

Copyright 2026 zhouwen. Licensed under the [Apache License 2.0](LICENSE).
Third-party licenses and attribution notices are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The original SRS in `source/Agent通用模板Server需求规格说明书_V1.0.docx` remains authoritative. See `AGENTS.md` for engineering invariants and `PLANS.md`/`execplans/` for living execution plans.
