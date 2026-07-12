# FR-ADM-002 MCP Console and Operation Audit Evidence

## Implemented scope

- Real console actions: register/discover, delete, refresh, remote health, Tool inventory, credential validation/rotation, Tool enhancement metadata, invocation history, dependency warnings, and management operation history.
- PostgreSQL append-only evidence for `register`, `refresh`, `health_check`, `credentials_update`, `tool_metadata_update`, and `delete`.
- Credential-safe summaries: credential values are neither returned nor recorded; only header names are audited.
- Operation history remains queryable after Server deletion.

## Reproducible evidence

- `pnpm test:unit -- --run packages/application/test/mcp-registry.unit.test.ts` — 5 tests pass.
- `pnpm test:integration` — 31 tests pass against real PostgreSQL/Redis, including migration `0050`.
- `pnpm test:contract -- --run packages/management-api/test/http-endpoint.contract.test.ts` — 29 tests pass.
- `pnpm --dir apps/console build` — strict TypeScript and production build pass.
- Format, lint, typecheck, architecture, and the 95-operation OpenAPI drift gate pass.

## E2E status

The real same-process E2E scenario was extended to assert ordered lifecycle operations and secret exclusion. Two `pnpm test:e2e` attempts and one isolated `docker compose up -d --wait postgres redis` retry on 2026-07-13 did not reach Vitest because Docker Compose start hung until the outer timeout. `docker version` still responded, while both stopped containers remained unchanged. E2E is implemented but not newly verified and is not counted as passing evidence.

## Boundaries

- Domain owns the operation type and immutable record.
- Application owns safe summaries and successful-operation recording.
- PostgreSQL is authoritative; Redis and React store no audit truth.
- Management API returns read-only evidence; React calls only documented APIs.
