# v1.0.2 Bug-fixed Test Results

Date: 2026-07-15

- Oversized and cyclic child-output regressions: passed.
- Real PostgreSQL repeated-parent-node history and latest lookup: passed.
- Migration 0054 rollback/reapply: passed.
- Production build: passed.
- Empty database and historical 0049 upgrade verification: passed.
- `pnpm test:integration`: 2 files, 37 tests passed.
- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed in strict mode.
- `pnpm verify:architecture`: passed across 167 TypeScript source files.
- `pnpm test:unit`: 48 files, 206 tests passed after the final cyclic-output regression.
- `pnpm test:contract`: 7 files, 57 tests passed.
- `pnpm test:integration`: 2 files, 37 tests passed against real PostgreSQL/Redis.
- `pnpm test:e2e`: 1 file, all 41 tests passed, including the real planned child MCP Workflow.
- No Docker lifecycle operation ran; operator-managed PostgreSQL/Redis were reused.
