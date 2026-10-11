# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T19:47:40.278Z
- Finished: 2026-10-10T20:03:31.369Z
- Duration: 951091 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39568 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 9720 ms |
| lint | `pnpm lint` | passed | 140159 ms |
| typecheck | `pnpm typecheck` | passed | 45472 ms |
| unit | `pnpm test:unit` | passed | 130706 ms |
| contract | `pnpm test:contract` | passed | 42683 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 7648 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 4450 ms |
| architecture | `pnpm verify:architecture` | passed | 7951 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 4166 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7124 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 5003 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 9959 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 2275 ms |
| acceptance | `pnpm verify:acceptance` | passed | 7081 ms |
| sources | `pnpm verify:sources` | passed | 5095 ms |
| protocol | `pnpm verify:protocol` | passed | 7336 ms |
| infra | `pnpm verify:infra` | passed | 7248 ms |
| project-license | `pnpm verify:project-license` | passed | 7082 ms |
| licenses | `pnpm verify:licenses` | passed | 5231 ms |
| build | `pnpm build` | passed | 44618 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7588 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 68574 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 334320 ms |
