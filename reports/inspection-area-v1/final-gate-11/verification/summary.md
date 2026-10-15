# Verification Summary

- Status: **passed**
- Commit: `011fa1639dbd2be9d2d047cdcfd52ce08916da6c` (dirty working tree)
- Started: 2026-10-14T13:47:25.978Z
- Finished: 2026-10-14T14:23:02.376Z
- Duration: 2136398 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 43694 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 3622 ms |
| lint | `pnpm lint` | passed | 184102 ms |
| typecheck | `pnpm typecheck` | passed | 44886 ms |
| unit | `pnpm test:unit` | passed | 152488 ms |
| contract | `pnpm test:contract` | passed | 42314 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 1553 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 818 ms |
| architecture | `pnpm verify:architecture` | passed | 1807 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 827 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 776 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 789 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 4679 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 929 ms |
| acceptance | `pnpm verify:acceptance` | passed | 776 ms |
| sources | `pnpm verify:sources` | passed | 754 ms |
| protocol | `pnpm verify:protocol` | passed | 961 ms |
| infra | `pnpm verify:infra` | passed | 923 ms |
| project-license | `pnpm verify:project-license` | passed | 872 ms |
| licenses | `pnpm verify:licenses` | passed | 913 ms |
| build | `pnpm build` | passed | 44569 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1169 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 96538 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 412255 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 321833 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 101772 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 448624 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 23546 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 76107 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 121445 ms |
