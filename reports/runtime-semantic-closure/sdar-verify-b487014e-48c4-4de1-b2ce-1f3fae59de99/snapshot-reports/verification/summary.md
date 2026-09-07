# Verification Summary

- Status: **passed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T11:44:09.937Z
- Finished: 2026-09-07T12:04:22.001Z
- Duration: 1212064 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 22507 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 2952 ms |
| lint | `pnpm lint` | passed | 95681 ms |
| typecheck | `pnpm typecheck` | passed | 30561 ms |
| unit | `pnpm test:unit` | passed | 102076 ms |
| contract | `pnpm test:contract` | passed | 28702 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 951 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 502 ms |
| architecture | `pnpm verify:architecture` | passed | 1276 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 517 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 512 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 529 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 2888 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 618 ms |
| acceptance | `pnpm verify:acceptance` | passed | 506 ms |
| sources | `pnpm verify:sources` | passed | 535 ms |
| protocol | `pnpm verify:protocol` | passed | 684 ms |
| infra | `pnpm verify:infra` | passed | 620 ms |
| project-license | `pnpm verify:project-license` | passed | 499 ms |
| licenses | `pnpm verify:licenses` | passed | 636 ms |
| build | `pnpm build` | passed | 27657 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 771 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 35204 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 275647 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 200313 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 69974 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 213456 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 10526 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 36417 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 48305 ms |
