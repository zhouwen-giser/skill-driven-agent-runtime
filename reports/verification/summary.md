# Verification Summary

- Status: **passed**
- Commit: `2e398d912a6d3a5dde88d54c3c57ef72d57ef171` (dirty working tree)
- Started: 2026-07-13T16:31:19.031Z
- Finished: 2026-07-13T16:33:15.268Z
- Duration: 116237 ms
- Environment: Node v22.14.0, win32/x64

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 37647 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 11126 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 13015 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 29473 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 10291 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 14684 ms |
