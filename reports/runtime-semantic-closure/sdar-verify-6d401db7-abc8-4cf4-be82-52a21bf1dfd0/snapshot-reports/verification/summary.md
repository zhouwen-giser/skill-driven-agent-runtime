# Verification Summary

- Status: **passed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T16:25:34.372Z
- Finished: 2026-10-10T16:55:32.102Z
- Duration: 1797730 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 37592 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 12062 ms |
| lint | `pnpm lint` | passed | 139997 ms |
| typecheck | `pnpm typecheck` | passed | 47161 ms |
| unit | `pnpm test:unit` | passed | 127612 ms |
| contract | `pnpm test:contract` | passed | 43850 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 7965 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7427 ms |
| architecture | `pnpm verify:architecture` | passed | 8219 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 4709 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7433 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 5078 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 11117 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7698 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4713 ms |
| sources | `pnpm verify:sources` | passed | 7877 ms |
| protocol | `pnpm verify:protocol` | passed | 8168 ms |
| infra | `pnpm verify:infra` | passed | 5257 ms |
| project-license | `pnpm verify:project-license` | passed | 7595 ms |
| licenses | `pnpm verify:licenses` | passed | 4966 ms |
| build | `pnpm build` | passed | 44722 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7847 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 64099 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 359127 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 222701 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 99691 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 315903 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 24004 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 61716 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 91379 ms |
