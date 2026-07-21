# Verification Summary

- Status: **passed**
- Commit: `f7bdd7b2b8e51fe11868e153fd38099699d8cae8`
- Started: 2026-07-21T18:19:25.780Z
- Finished: 2026-07-21T18:22:58.695Z
- Duration: 212915 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 71906 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 539 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 39926 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 24291 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 46774 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 9588 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 19890 ms |
