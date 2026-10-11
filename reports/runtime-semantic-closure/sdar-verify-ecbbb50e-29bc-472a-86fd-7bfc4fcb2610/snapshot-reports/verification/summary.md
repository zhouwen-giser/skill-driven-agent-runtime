# Verification Summary

- Status: **passed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T18:25:50.970Z
- Finished: 2026-10-10T18:55:42.982Z
- Duration: 1792012 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 37626 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10065 ms |
| lint | `pnpm lint` | passed | 136938 ms |
| typecheck | `pnpm typecheck` | passed | 47508 ms |
| unit | `pnpm test:unit` | passed | 129964 ms |
| contract | `pnpm test:contract` | passed | 43400 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 7962 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 4533 ms |
| architecture | `pnpm verify:architecture` | passed | 8159 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 4247 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7432 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 5137 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10198 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7843 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4647 ms |
| sources | `pnpm verify:sources` | passed | 7383 ms |
| protocol | `pnpm verify:protocol` | passed | 5437 ms |
| infra | `pnpm verify:infra` | passed | 7474 ms |
| project-license | `pnpm verify:project-license` | passed | 7308 ms |
| licenses | `pnpm verify:licenses` | passed | 5191 ms |
| build | `pnpm build` | passed | 44635 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7733 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 66829 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 370953 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 215095 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 88060 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 324240 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 21194 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 64594 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 90176 ms |
