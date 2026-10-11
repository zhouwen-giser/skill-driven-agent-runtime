# Verification Summary

- Status: **passed**
- Commit: `a230bac9b61e6cf901a91c094dbfe63704717fce` (dirty working tree)
- Started: 2026-10-11T06:26:12.923Z
- Finished: 2026-10-11T07:00:26.590Z
- Duration: 2053667 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39888 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10121 ms |
| lint | `pnpm lint` | passed | 138752 ms |
| typecheck | `pnpm typecheck` | passed | 46170 ms |
| unit | `pnpm test:unit` | passed | 132689 ms |
| contract | `pnpm test:contract` | passed | 43601 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8044 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 4435 ms |
| architecture | `pnpm verify:architecture` | passed | 8457 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7692 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 4933 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7480 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10789 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7523 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4932 ms |
| sources | `pnpm verify:sources` | passed | 7468 ms |
| protocol | `pnpm verify:protocol` | passed | 8096 ms |
| infra | `pnpm verify:infra` | passed | 4697 ms |
| project-license | `pnpm verify:project-license` | passed | 7435 ms |
| licenses | `pnpm verify:licenses` | passed | 5227 ms |
| build | `pnpm build` | passed | 47188 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7943 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 77923 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 421989 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 310188 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 100630 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 375889 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 28072 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 74616 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 100757 ms |
