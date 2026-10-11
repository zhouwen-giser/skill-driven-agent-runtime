# Verification Summary

- Status: **failed**
- Commit: `a230bac9b61e6cf901a91c094dbfe63704717fce` (dirty working tree)
- Started: 2026-10-11T05:15:02.249Z
- Finished: 2026-10-11T05:38:00.014Z
- Duration: 1377765 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 41446 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10123 ms |
| lint | `pnpm lint` | passed | 134252 ms |
| typecheck | `pnpm typecheck` | passed | 45549 ms |
| unit | `pnpm test:unit` | passed | 132711 ms |
| contract | `pnpm test:contract` | passed | 43558 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8058 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7924 ms |
| architecture | `pnpm verify:architecture` | passed | 6032 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7803 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7429 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7438 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10569 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7546 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4985 ms |
| sources | `pnpm verify:sources` | passed | 7365 ms |
| protocol | `pnpm verify:protocol` | passed | 8006 ms |
| infra | `pnpm verify:infra` | passed | 7754 ms |
| project-license | `pnpm verify:project-license` | passed | 5012 ms |
| licenses | `pnpm verify:licenses` | passed | 8408 ms |
| build | `pnpm build` | passed | 41833 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7790 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 81000 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 427018 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | failed | 308110 ms |
