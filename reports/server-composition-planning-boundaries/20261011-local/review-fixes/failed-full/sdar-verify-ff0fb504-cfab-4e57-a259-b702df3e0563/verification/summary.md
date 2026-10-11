# Verification Summary

- Status: **failed**
- Commit: `59def84c97043481b3a5a9e026479c6a5c724bd9` (dirty working tree)
- Started: 2026-10-11T09:28:29.082Z
- Finished: 2026-10-11T09:45:48.686Z
- Duration: 1039604 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39813 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10481 ms |
| lint | `pnpm lint` | passed | 150701 ms |
| typecheck | `pnpm typecheck` | passed | 47840 ms |
| unit | `pnpm test:unit` | passed | 138613 ms |
| contract | `pnpm test:contract` | passed | 45044 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 7989 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7427 ms |
| architecture | `pnpm verify:architecture` | passed | 8299 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 5240 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7400 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7577 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10332 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7974 ms |
| acceptance | `pnpm verify:acceptance` | passed | 7441 ms |
| sources | `pnpm verify:sources` | passed | 5232 ms |
| protocol | `pnpm verify:protocol` | passed | 7798 ms |
| infra | `pnpm verify:infra` | passed | 4824 ms |
| project-license | `pnpm verify:project-license` | passed | 7482 ms |
| licenses | `pnpm verify:licenses` | passed | 8058 ms |
| build | `pnpm build` | passed | 47830 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7928 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 79282 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 368956 ms |
