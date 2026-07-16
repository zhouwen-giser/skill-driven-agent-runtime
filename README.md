# Skill-Driven Agent Runtime V1.0

A strict TypeScript modular monolith for Skill-driven A2A tasks. LangGraph.js is the only Workflow runtime. PostgreSQL/pgvector is authoritative storage; Redis/BullMQ owns ephemeral queue/runtime coordination; official A2A and MCP SDKs are isolated behind adapters.

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

This builds the Server and Console, starts PostgreSQL/pgvector and Redis, starts the deterministic Mock Model and Mock MCP services inside the E2E harness, runs the documented A2A example client, and executes all composed acceptance flows: plan confirmation, streaming, Skill composition, pause/resume, Goal Patch, outer replanning, Memory, Evaluation, and Skill simulation/evolution. It stops local containers after the run. Model semantics are deterministic simulation; protocols, persistence, LangGraph execution, queueing, Console bundle, and API paths are real local components.

For the short basic task/confirmation/MCP demo:

```powershell
pnpm demo:local
```

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

Useful focused commands include `pnpm test:unit`, `pnpm test:integration`, `pnpm test:contract`, `pnpm test:e2e`, `pnpm smoke`, and `pnpm verify:acceptance`.

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
