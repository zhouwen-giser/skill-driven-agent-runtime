# Verification Summary

- Status: **passed**
- Commit: `0f52a6dd277f8ca850b47467814680c8fee09901` (dirty working tree)
- Started: 2026-07-22T07:48:48.601Z
- Finished: 2026-07-22T07:51:11.644Z
- Duration: 143043 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 73620 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 516 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 14587 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 10858 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 33537 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 564 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 9361 ms |
