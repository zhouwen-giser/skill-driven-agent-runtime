# v1.0.5 Feature Test Results

Date: 2026-07-16

- Formatting, ESLint and strict TypeScript: passed.
- Unit: 51 files, 229 tests passed.
- Contract: 7 files, 58 tests passed.
- Architecture: passed across 174 TypeScript source files.
- Real integration: 2 files, 43 tests passed against operator-managed PostgreSQL/Redis.
- Real E2E: 1 file, 43 tests passed against operator-managed PostgreSQL/Redis and loopback Model/MCP Servers.
- Production Server/Console builds: passed.
- Migration 0057 rollback/reapply, empty database and historical 0049 upgrade paths: passed.
- Complete operator-managed `pnpm verify`: passed, including A2A baseline, OpenAPI, acceptance-map, source-pin, Compose static, license/SBOM and both smoke gates.
- The nested E2E observes zero child MCP calls before independent confirmation, exact pause/linkage metadata, then one successful MCP call after resume.
- No Docker lifecycle operation ran.
