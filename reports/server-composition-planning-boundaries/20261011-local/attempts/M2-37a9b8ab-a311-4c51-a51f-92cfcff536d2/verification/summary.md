# Verification Summary

- Status: **failed**
- Commit: `a230bac9b61e6cf901a91c094dbfe63704717fce` (dirty working tree)
- Started: 2026-10-11T04:14:33.074Z
- Finished: 2026-10-11T04:36:49.704Z
- Duration: 1336630 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 40540 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10081 ms |
| lint | `pnpm lint` | passed | 146285 ms |
| typecheck | `pnpm typecheck` | passed | 47169 ms |
| unit | `pnpm test:unit` | passed | 134321 ms |
| contract | `pnpm test:contract` | passed | 44578 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8454 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7524 ms |
| architecture | `pnpm verify:architecture` | passed | 6000 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7568 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7508 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 8780 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 6697 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7660 ms |
| acceptance | `pnpm verify:acceptance` | passed | 7494 ms |
| sources | `pnpm verify:sources` | passed | 4951 ms |
| protocol | `pnpm verify:protocol` | passed | 7820 ms |
| infra | `pnpm verify:infra` | passed | 7309 ms |
| project-license | `pnpm verify:project-license` | passed | 7485 ms |
| licenses | `pnpm verify:licenses` | passed | 5152 ms |
| build | `pnpm build` | passed | 47485 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7881 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 73333 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 407054 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 269434 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | failed | 8027 ms |
