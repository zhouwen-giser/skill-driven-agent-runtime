# Verification Summary

- Status: **passed**
- Commit: `b7219f5923ef8fc6d704b8229cdfeb17a9ba5f1e` (dirty working tree)
- Started: 2026-09-02T11:40:58.235Z
- Finished: 2026-09-02T12:09:46.410Z
- Duration: 1728175 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 421773 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1474 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 58767 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 412909 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 341778 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 77760 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 251160 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 8103 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 57756 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 96688 ms |
