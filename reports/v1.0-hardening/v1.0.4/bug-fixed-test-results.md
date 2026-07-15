# v1.0.4 Bug-fixed Test Results

Date: 2026-07-15

- Header-safe stable-ID boundary at 256 visible ASCII characters: passed.
- Case-insensitive duplicate legacy reserved Header removal and canonical overwrite: passed.
- Simulation failure invocation audit with no credential value: passed.
- Paused/resumed LangGraph execution context retention: passed.
- Repeated stable-ID official MCP SDK session reuse: passed against the real loopback server.
- Formatting, ESLint and strict TypeScript: passed.
- Unit: 50 files, 218 tests passed.
- Contract: 7 files, 58 tests passed.
- Architecture: passed across 172 TypeScript source files.
- Real integration: 2 files, 42 tests passed.
- Real E2E: 1 file, 42 tests passed.
- Production Server/Console builds: passed.
- Migration 0056 empty/0049 paths and rollback/reapply: passed in the feature gate; migration code did not change during bug-fixed review.
- No Docker lifecycle operation ran; operator-managed PostgreSQL/Redis were reused.
