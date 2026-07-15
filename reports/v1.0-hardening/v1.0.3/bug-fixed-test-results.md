# v1.0.3 Bug-fixed Test Results

Date: 2026-07-15

- Immediate Redis dispatch failure leaves an accepted input-response attempt durably `queued`: passed.
- A 64,001-character answer is rejected before the waiting request or attempt history changes: passed.
- Queued-attempt dispatch maps initial and input-response attempts to their exact Worker modes: passed.
- Real PostgreSQL atomically persists the answered request, response, queued attempt and continued Task phase: passed.
- Real startup recovery marks a running attempt failed and excludes it from redispatch: passed.
- Real Redis replaces a terminal stale composite Job while retaining one-attempt execution: passed.
- Required `pnpm verify`: passed after selecting the existing pnpm store recorded by `node_modules/.modules.yaml`.
- Static unit/contract/build stage: 56 files, 271 tests passed; architecture verified across 170 source TypeScript files; A2A baseline, management OpenAPI, acceptance, source pins, Compose static policy, license, SBOM and production builds passed.
- Empty database and historical 0049 migration paths: passed through migration 0055.
- Real PostgreSQL/Redis integration: 2 files, 41 tests passed.
- Real PostgreSQL/Redis/model/MCP E2E: 1 file, 42 tests passed.
- Infrastructure smoke and Server/Console smoke: passed.
- No Docker lifecycle operation ran; `SDAR_REUSE_EXISTING_INFRA=true` was explicit and the verification report records `operator-managed` mode.
