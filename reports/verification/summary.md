# Verification Summary

- Status: **passed**
- Commit: `3d3ad6fe0075f04edcadaac5cb7c585ed22db238`
- Started: 2026-07-22T14:08:02.504Z
- Finished: 2026-07-22T14:09:52.922Z
- Duration: 110418 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 60479 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 3382 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 9242 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 28707 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 514 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 8094 ms |
