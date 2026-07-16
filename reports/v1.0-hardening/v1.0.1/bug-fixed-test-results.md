# v1.0.1 Bug-fixed Test Results

Date: 2026-07-15

The bug-fixed gate passed:

- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed in strict mode.
- `pnpm verify:architecture`: passed across 167 TypeScript source files.
- `pnpm test:unit`: 48 files, 197 tests passed.
- `pnpm test:contract`: 7 files, 57 tests passed.
- `pnpm test:e2e`: 1 file, 41 tests passed over operator-managed PostgreSQL/Redis and loopback MCP/model; no Docker lifecycle operation ran.

New regression evidence covers depth 64 acceptance, template/referenced-value/cyclic-value overflow, absent result, dotted node IDs, immutable snapshots and stable typed errors.
