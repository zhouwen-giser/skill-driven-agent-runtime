# P00 Owner-acceptance Recovery Verification Summary

- Status: **passed**
- Commit: `6e27d706fed2b64abfadc1e57302d93c36cfe334`
- Dirty: `false`
- Started: 2026-07-26T13:56:24.043Z
- Finished: 2026-07-26T13:59:17.949Z
- Duration: 173906 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed
- Database: dedicated clean-slate `sdar_v13_orchestration_verify`

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 98464 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 759 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 7065 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 18323 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 35324 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 568 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 13403 ms |

The generated `reports/verification/summary.{json,md}` was restored after this immutable copy was
recorded so the v1.2.3 release report continues to reference its original exact release verification.
