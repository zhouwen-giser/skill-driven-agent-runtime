# NFR-MNT-001 Modular Boundary Evidence

## Outcome

The runtime is a strict-TypeScript modular monolith whose application layer depends on internal ports rather than protocol SDK, transport, database, queue, schema-engine, or LangGraph types.

## Boundary map

| Boundary | Application-owned port/model | Production adapter | Test substitution evidence |
| --- | --- | --- | --- |
| A2A | `AgentTask`, `TaskService`, `ExternalTaskProjectionRepository` | `packages/a2a-adapter` | official-SDK compatibility and HTTP contracts map to/from application-owned commands |
| MCP transport | `McpTransportAdapter` | `StreamableHttpMcpAdapter` in `packages/mcp-adapter` | `mcp-registry.unit.test.ts` injects an in-memory changing/failing transport |
| Model Provider | `StructuredModelProvider` and `ModelProviderAdapterFactory` | `packages/model-provider-adapter` plus `ModelRuntimeService` | model-runtime and decision tests inject deterministic providers/factories |
| Storage | repository interfaces in `packages/application/src/ports.ts` | `packages/persistence-postgres` | application tests use in-memory repositories; PostgreSQL integration tests cover production adapters |
| Workflow Compiler/runtime | `WorkflowExecutor` | `LangGraphWorkflowExecutor` and the compiler in `packages/langgraph-runtime` | execution tests inject a fake executor; compiler tests exercise the sole StateGraph implementation |

The Server is only the composition root. It may instantiate the PostgreSQL driver and adapters, but it does not import A2A SDK, MCP SDK, LangGraph, BullMQ, Ajv, or React types directly.

## Automated guard

`scripts/check-architecture.mjs` now scans all package source plus the Server composition root (164 TypeScript files). It rejects:

- A2A, MCP, and LangGraph SDK imports outside their named adapters;
- PostgreSQL, BullMQ, and Ajv imports outside their infrastructure adapters, with only the Server composition root allowed to instantiate PostgreSQL;
- SDK/infrastructure imports in Domain or Application;
- dynamic `eval`/`Function` execution;
- absence of `@langchain/langgraph` or addition of a known second agent/workflow runtime dependency.

## Executed evidence

- `pnpm verify:architecture` currently passes across 165 TypeScript source files.
- A focused substitution regression across A2A, MCP, Model Provider, Storage/Application services, and Workflow Compiler/runtime passes 6 files/57 tests.
- Unified `pnpm verify` currently passes: format, lint, strict typecheck, 54-file/240-test unit+contract, the 165-file architecture guard, OpenAPI, source-pin, Compose-static, SBOM/license, and production-build gates.
- Existing unit and contract suites exercise every port listed above using injected substitutes.

## Evidence classification

The module boundaries and substitution tests are locally executed real evidence and do not require Docker. Production PostgreSQL behavior is verified by its separate storage requirements and historical integration suites; it is not part of the NFR-MNT-001 acceptance criterion that module interfaces be unit-testable. NFR-MNT-001 is therefore **verified**. Current Docker unavailability remains a project-release limitation but does not invalidate this requirement-specific evidence.
