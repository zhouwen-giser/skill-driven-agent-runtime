# v1.0.6 Feature Test Results

Date: 2026-07-16

- Formatting, ESLint and strict TypeScript: passed.
- Unit: 51 files, 242 tests passed.
- Contract: 7 files, 58 tests passed.
- Architecture: passed across 175 TypeScript source files.
- Real integration: 2 files, 52 tests passed against operator-managed PostgreSQL/Redis.
- Real E2E: 1 file, 44 tests passed against operator-managed PostgreSQL/Redis and loopback Model/MCP Servers.
- Production Server/Console builds: passed.
- Migration 0058 rollback/reapply, empty database and historical 0049 upgrade paths: passed.
- PostgreSQL fault triggers prove rollback before Processed Result and after Task, Goal, Control and Runtime Event writes.
- Unit fault injection proves model-audit failure writes no terminal outcome and Memory/Quality/Evolution failures cannot reverse authority.
- Real A2A fault injection returns completed output with achieved Goal/Control and Processed Result despite post-commit Memory failure.
- No Docker lifecycle operation ran.
