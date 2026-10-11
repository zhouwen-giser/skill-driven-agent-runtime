# Verification Summary

- Status: **failed**
- Commit: `6b3fc0e2bda523b8dcd0aa9934ef41f3e1af3766` (dirty working tree)
- Started: 2026-10-11T10:52:30.861Z
- Finished: 2026-10-11T11:15:57.843Z
- Duration: 1406982 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39263 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10970 ms |
| lint | `pnpm lint` | passed | 144048 ms |
| typecheck | `pnpm typecheck` | passed | 46084 ms |
| unit | `pnpm test:unit` | passed | 135745 ms |
| contract | `pnpm test:contract` | passed | 44265 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8507 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7459 ms |
| architecture | `pnpm verify:architecture` | passed | 8360 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7419 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 5125 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7895 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 8576 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7664 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4767 ms |
| sources | `pnpm verify:sources` | passed | 7828 ms |
| protocol | `pnpm verify:protocol` | passed | 7834 ms |
| infra | `pnpm verify:infra` | passed | 4744 ms |
| project-license | `pnpm verify:project-license` | passed | 7453 ms |
| licenses | `pnpm verify:licenses` | passed | 5364 ms |
| build | `pnpm build` | passed | 47793 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7775 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 74101 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 449004 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | failed | 308896 ms |
