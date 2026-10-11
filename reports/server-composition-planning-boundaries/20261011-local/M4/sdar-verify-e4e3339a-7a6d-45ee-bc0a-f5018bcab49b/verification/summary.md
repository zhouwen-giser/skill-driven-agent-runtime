# Verification Summary

- Status: **passed**
- Commit: `870e94b6bfa9ba4889e28c90abd2caf2258420e6` (dirty working tree)
- Started: 2026-10-11T08:10:39.728Z
- Finished: 2026-10-11T08:45:45.910Z
- Duration: 2106182 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39254 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10128 ms |
| lint | `pnpm lint` | passed | 142679 ms |
| typecheck | `pnpm typecheck` | passed | 46973 ms |
| unit | `pnpm test:unit` | passed | 137558 ms |
| contract | `pnpm test:contract` | passed | 44349 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8361 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 5190 ms |
| architecture | `pnpm verify:architecture` | passed | 8651 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 4115 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 8438 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 4122 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10326 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7541 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4991 ms |
| sources | `pnpm verify:sources` | passed | 7430 ms |
| protocol | `pnpm verify:protocol` | passed | 6662 ms |
| infra | `pnpm verify:infra` | passed | 7593 ms |
| project-license | `pnpm verify:project-license` | passed | 7666 ms |
| licenses | `pnpm verify:licenses` | passed | 4969 ms |
| build | `pnpm build` | passed | 46595 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7800 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 77755 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 435865 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 324849 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 99956 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 388827 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 33764 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 71203 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 102522 ms |
