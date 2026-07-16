# Verification Summary

- Status: **passed**
- Commit: `4df20a9de0c76aa4f07181c6281b1054137ed76f` (dirty working tree)
- Started: 2026-07-16T04:24:48.914Z
- Finished: 2026-07-16T04:26:10.919Z
- Duration: 82005 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 41175 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 4846 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 4669 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 24260 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 625 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 6430 ms |
