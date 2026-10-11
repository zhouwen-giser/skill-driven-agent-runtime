# Verification Summary

- Status: **passed**
- Commit: `870e94b6bfa9ba4889e28c90abd2caf2258420e6` (dirty working tree)
- Started: 2026-10-11T07:35:48.698Z
- Finished: 2026-10-11T08:09:54.601Z
- Duration: 2045903 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39828 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10123 ms |
| lint | `pnpm lint` | passed | 144179 ms |
| typecheck | `pnpm typecheck` | passed | 46785 ms |
| unit | `pnpm test:unit` | passed | 136871 ms |
| contract | `pnpm test:contract` | passed | 44281 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8053 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7440 ms |
| architecture | `pnpm verify:architecture` | passed | 8456 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7594 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 9374 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 3410 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10471 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7891 ms |
| acceptance | `pnpm verify:acceptance` | passed | 7490 ms |
| sources | `pnpm verify:sources` | passed | 5947 ms |
| protocol | `pnpm verify:protocol` | passed | 8161 ms |
| infra | `pnpm verify:infra` | passed | 8057 ms |
| project-license | `pnpm verify:project-license` | passed | 7481 ms |
| licenses | `pnpm verify:licenses` | passed | 6603 ms |
| build | `pnpm build` | passed | 46174 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 8213 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 77883 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 441047 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 246320 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 100126 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 390221 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 28273 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 73839 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 105264 ms |
