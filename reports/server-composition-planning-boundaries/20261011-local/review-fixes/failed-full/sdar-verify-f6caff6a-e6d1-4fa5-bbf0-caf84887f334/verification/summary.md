# Verification Summary

- Status: **failed**
- Commit: `43faa3a9cb88160153c0fc4b7e4ff4fc5f7663bd` (dirty working tree)
- Started: 2026-10-11T09:59:48.598Z
- Finished: 2026-10-11T10:17:31.365Z
- Duration: 1062767 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 38192 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10177 ms |
| lint | `pnpm lint` | passed | 153593 ms |
| typecheck | `pnpm typecheck` | passed | 47137 ms |
| unit | `pnpm test:unit` | passed | 137894 ms |
| contract | `pnpm test:contract` | passed | 46007 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8051 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 8206 ms |
| architecture | `pnpm verify:architecture` | passed | 5316 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 8503 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 5117 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7508 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 8108 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7691 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4930 ms |
| sources | `pnpm verify:sources` | passed | 7392 ms |
| protocol | `pnpm verify:protocol` | passed | 7986 ms |
| infra | `pnpm verify:infra` | passed | 4998 ms |
| project-license | `pnpm verify:project-license` | passed | 7562 ms |
| licenses | `pnpm verify:licenses` | passed | 5476 ms |
| build | `pnpm build` | passed | 46386 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7823 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 73753 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 404925 ms |
