# Phase 0 Repository Map

## Composition roots

- `apps/server/src/runtime.ts`: sole Runtime composition root; Phase 3 temporarily wires the P11
  application surface to the canonical Evidence persistence compatibility projection.
- `apps/node-control-api/src/runtime.ts`: Control composition root; wires configuration,
  governance, event, and current Telemetry configuration services.
- `apps/node-control-api/src/http-endpoint.ts`: public Control management routes.
- `packages/management-api/src/http-endpoint.ts`: Runtime internal management routes.

## Remaining Telemetry names to replace in Phase 4

- Domain: `packages/node-control-domain/src/telemetry-export.ts`.
- Control application: `packages/node-control-application/src/telemetry-export-service.ts`.
- Runtime application: `packages/runtime-control-application/src/telemetry-export-service.ts`.
- Runtime persistence compatibility:
  `packages/runtime-control-persistence-postgres/src/telemetry-export-store.ts`; it uses only
  canonical Evidence tables and projects authoritative `agent_task` facts.
- HTTP adapter: `packages/telemetry-export-adapter/src/http-telemetry-export-transport.ts`.
- Historical immutable Runtime migration: `infra/postgres/migrations/0142_v14_telemetry_export.*`;
  its product tables are removed by `0144_v14_canonical_evidence`.
- Control-to-Runtime event projection: `infra/postgres/migrations/0143_v14_node_event_projection.*`.
- Protocol/OpenAPI: `protocol/node-control/v1/contracts/telemetry-export-contract.yaml`,
  `protocol/node-control/v1/schemas/telemetry-export-*.schema.json`, and both Node Control OpenAPI
  documents.

## Runtime authoritative source areas

- Task/Goal/Plan/Outcome: `packages/domain/src/{task,goal,user-goal-runtime,runtime-terminal-outcome}.ts`,
  `packages/persistence-postgres/src/{repositories,user-goal-runtime-repository}.ts`.
- Workflow: `packages/domain/src/workflow*.ts`, `packages/persistence-postgres/src/repositories.ts`.
- Skill: `packages/domain/src/skill*.ts`,
  `packages/persistence-postgres/src/{repositories,skill-execution-repository}.ts`.
- MCP Task: `packages/domain/src/{mcp-task,remote-task,remote-task-input}.ts`,
  `packages/persistence-postgres/src/remote-task-*.ts`.
- Capability: `packages/domain/src/task-capability.ts`,
  `packages/persistence-postgres/src/task-capability-repository.ts`, and Runtime Control readiness
  repositories.
- Experience/Replay: `packages/domain/src/cognitive/`, `packages/application/src/cognitive/`, and
  their PostgreSQL repositories.
- Artifact/compiler: `packages/domain/src/compiler/`, `packages/application/src/compiler/`, and
  `packages/persistence-postgres/src/compiler/`.

## Control authoritative source areas

- Domain: `packages/node-control-domain/src/`.
- Application: `packages/node-control-application/src/`.
- PostgreSQL: `packages/node-control-persistence-postgres/src/`.
- Control migrations: `infra/postgres-control/migrations/0001..0008`.
- Frozen protocol: `protocol/node-control/v1/`.

## Canonical Evidence bounded areas

- Domain evidence contract: `packages/domain/src/evidence/`.
- Application writers/projectors/export/manifest: planned `packages/application/src/evidence/`.
- Runtime PostgreSQL Evidence adapter:
  `packages/runtime-control-persistence-postgres/src/evidence-store.ts`.
- HTTP Evidence adapter: planned `packages/evidence-export-adapter/`.
- Protocol and schemas: `protocol/evidence/v1/` and `schemas/evidence/`.
- Evidence reports: `reports/v1.4.1-evidence/`.

No new workflow runtime or independent source of truth is introduced by these areas.
