# Verification Summary

- Status: **passed**
- Commit: `a230bac9b61e6cf901a91c094dbfe63704717fce` (dirty working tree)
- Started: 2026-10-11T07:00:31.032Z
- Finished: 2026-10-11T07:35:43.658Z
- Duration: 2112626 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 40154 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10274 ms |
| lint | `pnpm lint` | passed | 148120 ms |
| typecheck | `pnpm typecheck` | passed | 48038 ms |
| unit | `pnpm test:unit` | passed | 134555 ms |
| contract | `pnpm test:contract` | passed | 43958 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8026 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7449 ms |
| architecture | `pnpm verify:architecture` | passed | 5941 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7749 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7373 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 5084 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10395 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7578 ms |
| acceptance | `pnpm verify:acceptance` | passed | 5226 ms |
| sources | `pnpm verify:sources` | passed | 7893 ms |
| protocol | `pnpm verify:protocol` | passed | 7595 ms |
| infra | `pnpm verify:infra` | passed | 5085 ms |
| project-license | `pnpm verify:project-license` | passed | 7552 ms |
| licenses | `pnpm verify:licenses` | passed | 7722 ms |
| build | `pnpm build` | passed | 47961 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7829 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 75770 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 427258 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 334775 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 97689 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 378584 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 30346 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 79477 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 107116 ms |
