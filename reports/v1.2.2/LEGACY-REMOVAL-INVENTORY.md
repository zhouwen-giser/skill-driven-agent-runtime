# G01 Legacy Removal Inventory

Status: frozen removal input; implementation is G01.

## Product code

- `packages/mcp-adapter/src/mcp-transport-router.ts`: `legacy_v11` route.
- `packages/mcp-adapter/src/mcp-tasks-contract.ts`, `mcp-tasks-transport-bridge.ts` and Legacy mock/client
  support used only by the historical extension-era path.
- `packages/domain/src/mcp-frozen-protocol.ts`: dual `McpProviderProtocolMode`.
- `packages/domain/src/mcp.ts`, `mcp-task.ts`, `mcp-task-availability.ts`, `workflow.ts`,
  `skill-applicability.ts`, `skill-usage-planning.ts`: optional/default Legacy protocol projections.
- `packages/application/src/skill-task-readiness.ts`, `skill-usage-planning.ts`,
  `mcp-protocol-operations.ts`, `frozen-mcp-registry.ts`: Legacy defaults/mode switching.
- `packages/persistence-postgres/src/repositories.ts` and `remote-task-repository.ts`: Legacy enum/default
  and dual-mode persistence.
- `packages/management-api/src/http-endpoint.ts` and Management OpenAPI: mode switch and Legacy enums.
- `apps/console/src/McpPanel.tsx`: Legacy registration/default/mode display.

## Schema and database

- `schemas/workflow-dsl.schema.json`: Legacy-only `protocolMode` branch.
- Migration 0107 Legacy backfill/dual-mode columns and the historical incremental runner.
- Existing migrations remain historical Git evidence but are not the v1.2.2 product baseline/runtime
  path. G02 introduces one clean baseline rather than rewriting old files.

## Skill compatibility

- `legacy_guidance` projection from ADR-097 and Skill Usage code.
- Legacy formal Skill fixtures/packages without mandatory `SkillOutcomeSpecification`.
- Legacy automatic composition/projection tests that grant behavior without an explicit v1.2.2 outcome
  contract.

## Terminal authority

- Workflow/Goal controller paths that call Task/Goal terminal persistence directly.
- Any API or adapter sink that may finish A2A without a User Goal achieved outcome.
- Existing RuntimeTerminalOutcome ports will be audited: reusable atomic transaction mechanics may move
  behind the new controller, but the old public terminal authority will be removed.

## Documentation/tests/reports

Historical version reports and ADRs remain audit evidence and are not deleted. Product documentation,
current OpenAPI, examples and tests must stop advertising/running Legacy mode. Frozen MCP Tasks V1.0
tests remain mandatory.

## Zero gate

G01 completes only when architecture-controlled product paths contain no `legacy_v11`, `LegacyV11`,
Legacy router/mode switch or `legacy_guidance`, while Frozen MCP Tasks regressions pass. Historical ADR,
release report and migration text is excluded from the product zero count and remains immutable evidence.
