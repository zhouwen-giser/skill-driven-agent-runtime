# Verification Summary

- Status: **failed**
- Commit: `ac7838dae447955fb7410aaad705530077fc030a` (dirty working tree)
- Started: 2026-10-13T17:36:55.299Z
- Finished: 2026-10-13T18:04:26.958Z
- Duration: 1651659 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 44739 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10284 ms |
| lint | `pnpm lint` | passed | 152741 ms |
| typecheck | `pnpm typecheck` | passed | 52942 ms |
| unit | `pnpm test:unit` | passed | 151284 ms |
| contract | `pnpm test:contract` | passed | 48505 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8570 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 3947 ms |
| architecture | `pnpm verify:architecture` | passed | 8397 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 4045 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7636 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7570 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 8699 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7644 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4849 ms |
| sources | `pnpm verify:sources` | passed | 7424 ms |
| protocol | `pnpm verify:protocol` | passed | 77815 ms |
| infra | `pnpm verify:infra` | passed | 7671 ms |
| project-license | `pnpm verify:project-license` | passed | 4990 ms |
| licenses | `pnpm verify:licenses` | passed | 7579 ms |
| build | `pnpm build` | passed | 48698 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7770 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 97779 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 402947 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 313069 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | failed | 154013 ms |
