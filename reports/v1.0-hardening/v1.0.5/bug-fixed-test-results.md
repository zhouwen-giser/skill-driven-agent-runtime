# v1.0.5 Bug-fixed Test Results

Date: 2026-07-16

- Exact duplicate child confirmation is idempotent; concurrent Task confirmations execute one plan action: passed.
- Stale checkpoint metadata and superseded immutable plans fail closed: passed.
- Confirmation on an already canceled parent is rejected before plan side effects: passed.
- User and unified-timeout cancellation release waiting child checkpoints: passed.
- Repeated pause projection after version invalidation: passed in unit and real A2A/MCP E2E.
- Formatting, ESLint and strict TypeScript: passed.
- Unit: 238 passed; contract: 58 passed.
- Architecture: passed across 174 TypeScript source files.
- Real integration: 43 passed; real E2E: 43 passed.
- Empty/0049 migration paths, production Server/Console builds, infrastructure smoke and Server smoke: passed.
- Complete operator-managed `pnpm verify`: passed in 78,901 ms.
- No Docker lifecycle operation ran.
