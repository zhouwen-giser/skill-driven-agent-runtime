# P00 Verification Summary

- Status: **passed**
- Commit: `1bcee05792c918a1273b06ee7d58f7adb40bb572`
- Dirty: `false`
- Started: 2026-07-26T12:49:20.714Z
- Finished: 2026-07-26T12:51:58.192Z
- Duration: 157478 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 88614 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 753 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 6937 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 18001 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 32671 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 509 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 9992 ms |

This immutable P00 copy prevents later package verification runs from overwriting the P00 evidence.
