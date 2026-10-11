# Verification Summary

- Status: **failed**
- Commit: `a230bac9b61e6cf901a91c094dbfe63704717fce` (dirty working tree)
- Started: 2026-10-11T04:43:15.626Z
- Finished: 2026-10-11T05:06:26.001Z
- Duration: 1390375 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39418 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10044 ms |
| lint | `pnpm lint` | passed | 136243 ms |
| typecheck | `pnpm typecheck` | passed | 47308 ms |
| unit | `pnpm test:unit` | passed | 133880 ms |
| contract | `pnpm test:contract` | passed | 44277 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 9037 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7487 ms |
| architecture | `pnpm verify:architecture` | passed | 6002 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7418 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 5267 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7480 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10352 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7551 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4986 ms |
| sources | `pnpm verify:sources` | passed | 7456 ms |
| protocol | `pnpm verify:protocol` | passed | 5281 ms |
| infra | `pnpm verify:infra` | passed | 7938 ms |
| project-license | `pnpm verify:project-license` | passed | 4646 ms |
| licenses | `pnpm verify:licenses` | passed | 30221 ms |
| build | `pnpm build` | passed | 43600 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 8304 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 74650 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 431341 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | failed | 300147 ms |
