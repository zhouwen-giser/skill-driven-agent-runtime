# Verification Summary

- Status: **passed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T14:31:30.870Z
- Finished: 2026-10-10T15:00:48.913Z
- Duration: 1758043 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 37781 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10125 ms |
| lint | `pnpm lint` | passed | 131282 ms |
| typecheck | `pnpm typecheck` | passed | 46267 ms |
| unit | `pnpm test:unit` | passed | 124184 ms |
| contract | `pnpm test:contract` | passed | 41847 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 10436 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 8081 ms |
| architecture | `pnpm verify:architecture` | passed | 8313 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7908 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 4601 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 8124 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 11570 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 9182 ms |
| acceptance | `pnpm verify:acceptance` | passed | 23600 ms |
| sources | `pnpm verify:sources` | passed | 5307 ms |
| protocol | `pnpm verify:protocol` | passed | 7661 ms |
| infra | `pnpm verify:infra` | passed | 5761 ms |
| project-license | `pnpm verify:project-license` | passed | 7495 ms |
| licenses | `pnpm verify:licenses` | passed | 5122 ms |
| build | `pnpm build` | passed | 44334 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 8990 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 72580 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 337568 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 212029 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 104706 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 295337 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 22330 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 63873 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 81606 ms |
