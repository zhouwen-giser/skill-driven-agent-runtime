# Verification Summary

- Status: **passed**
- Commit: `01e2d448796ad89539ec33583aeb5c8b4459a3bd` (dirty working tree)
- Started: 2026-07-16T11:11:37.644Z
- Finished: 2026-07-16T11:13:02.921Z
- Duration: 85277 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 45538 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 2710 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 5295 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 24559 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 596 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 6579 ms |
