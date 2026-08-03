# Phase 0 Repository Map

## Composition roots

- `apps/server/src/runtime.ts`: sole Runtime composition root; wires the canonical Evidence export
  service, PostgreSQL store and bounded HTTP transport.
- `apps/node-control-api/src/runtime.ts`: Control composition root; wires configuration,
  governance, event, and Evidence Export configuration services.
- `apps/node-control-api/src/http-endpoint.ts`: public Control management routes.
- `packages/management-api/src/http-endpoint.ts`: Runtime internal management routes.

## Phase 4 Evidence Export implementation

- Domain: `packages/domain/src/evidence/evidence-contracts.ts` and
  `packages/node-control-domain/src/evidence-export.ts`.
- Control application: `packages/node-control-application/src/evidence-export-service.ts`.
- Runtime application: `packages/runtime-control-application/src/evidence-export-service.ts`.
- Runtime persistence: `packages/runtime-control-persistence-postgres/src/evidence-export-store.ts`
  over the canonical Evidence tables.
- HTTP adapter: `packages/evidence-export-adapter/src/http-evidence-export-transport.ts`.
- Runtime Control client:
  `packages/runtime-control-http-client/src/http-runtime-evidence-export-client.ts`.
- Public/internal API contracts: Evidence-only routes in Node Control and Runtime OpenAPI.
- Real vertical: `apps/node-control-acceptance/test/evidence-export-v141.integration.test.ts`.

## Historical names retained without product authority

- Historical immutable Runtime migration: `infra/postgres/migrations/0142_v14_telemetry_export.*`;
  its product tables are removed by `0144_v14_canonical_evidence`.
- Control-to-Runtime event projection: `infra/postgres/migrations/0143_v14_node_event_projection.*`.
- Control `configuration_revision.target_type=telemetry_link`, the frozen historical Node Event and
  catalog source names remain internal/source identity only. No legacy external route, header,
  payload, service, client or transport remains.

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
- HTTP Evidence adapter: `packages/evidence-export-adapter/`.
- Protocol and schemas: `protocol/evidence/v1/` and `schemas/evidence/`.
- Evidence reports: `reports/v1.4.1-evidence/`.

No new workflow runtime or independent source of truth is introduced by these areas.
