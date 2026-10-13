# Verification Summary

- Status: **passed**
- Commit: `4112a90bfd11de337db056dc083c4f05bd5360c1` (dirty working tree)
- Started: 2026-10-13T16:39:32.378Z
- Finished: 2026-10-13T17:16:06.075Z
- Duration: 2193697 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 43372 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10833 ms |
| lint | `pnpm lint` | passed | 163824 ms |
| typecheck | `pnpm typecheck` | passed | 53712 ms |
| unit | `pnpm test:unit` | passed | 150015 ms |
| contract | `pnpm test:contract` | passed | 48803 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8304 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 4679 ms |
| architecture | `pnpm verify:architecture` | passed | 8928 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 4340 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7562 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 5130 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 11141 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 8634 ms |
| acceptance | `pnpm verify:acceptance` | passed | 7662 ms |
| sources | `pnpm verify:sources` | passed | 7992 ms |
| protocol | `pnpm verify:protocol` | passed | 7844 ms |
| infra | `pnpm verify:infra` | passed | 7628 ms |
| project-license | `pnpm verify:project-license` | passed | 7237 ms |
| licenses | `pnpm verify:licenses` | passed | 7628 ms |
| build | `pnpm build` | passed | 47271 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 8010 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 99246 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 407583 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 296179 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 102690 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 408947 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 31436 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 82989 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 134017 ms |
