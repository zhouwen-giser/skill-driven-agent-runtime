# Verification Summary

- Status: **failed**
- Commit: `a230bac9b61e6cf901a91c094dbfe63704717fce` (dirty working tree)
- Started: 2026-10-11T04:15:44.728Z
- Finished: 2026-10-11T04:35:27.360Z
- Duration: 1182632 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39113 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10045 ms |
| lint | `pnpm lint` | passed | 141576 ms |
| typecheck | `pnpm typecheck` | passed | 48185 ms |
| unit | `pnpm test:unit` | passed | 135469 ms |
| contract | `pnpm test:contract` | passed | 42455 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 7687 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 6921 ms |
| architecture | `pnpm verify:architecture` | passed | 8255 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 6955 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 4927 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7531 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 8140 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7957 ms |
| acceptance | `pnpm verify:acceptance` | passed | 8196 ms |
| sources | `pnpm verify:sources` | passed | 4986 ms |
| protocol | `pnpm verify:protocol` | passed | 7670 ms |
| infra | `pnpm verify:infra` | passed | 5650 ms |
| project-license | `pnpm verify:project-license` | passed | 5107 ms |
| licenses | `pnpm verify:licenses` | passed | 7567 ms |
| build | `pnpm build` | passed | 45055 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7962 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 82277 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 391527 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | failed | 141371 ms |
