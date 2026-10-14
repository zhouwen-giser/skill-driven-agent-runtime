# Verification Summary

- Status: **passed**
- Commit: `ac7838dae447955fb7410aaad705530077fc030a` (dirty working tree)
- Started: 2026-10-13T23:53:51.131Z
- Finished: 2026-10-14T00:32:02.478Z
- Duration: 2291347 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 41799 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 9940 ms |
| lint | `pnpm lint` | passed | 160046 ms |
| typecheck | `pnpm typecheck` | passed | 54722 ms |
| unit | `pnpm test:unit` | passed | 165070 ms |
| contract | `pnpm test:contract` | passed | 50827 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8020 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7245 ms |
| architecture | `pnpm verify:architecture` | passed | 6358 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7402 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 4951 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7257 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10998 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7520 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4718 ms |
| sources | `pnpm verify:sources` | passed | 7291 ms |
| protocol | `pnpm verify:protocol` | passed | 7605 ms |
| infra | `pnpm verify:infra` | passed | 4754 ms |
| project-license | `pnpm verify:project-license` | passed | 7394 ms |
| licenses | `pnpm verify:licenses` | passed | 5082 ms |
| build | `pnpm build` | passed | 53098 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7723 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 95571 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 414574 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 326802 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 97990 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 457246 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 35036 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 86871 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 137383 ms |
