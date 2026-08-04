# Verification Summary

- Status: **passed**
- Commit: `39bad28f4f59175a772aefed80ccdf99ee0a6a3a` (dirty working tree)
- Started: 2026-08-04T00:55:50.601Z
- Finished: 2026-08-04T01:10:16.415Z
- Duration: 865814 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 319414 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1219 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 33967 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 224915 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 128912 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 19326 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 51894 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 86161 ms |
