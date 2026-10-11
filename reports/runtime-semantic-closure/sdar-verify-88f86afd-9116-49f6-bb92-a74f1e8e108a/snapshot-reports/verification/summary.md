# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T15:07:04.165Z
- Finished: 2026-10-10T15:22:24.644Z
- Duration: 920479 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 40634 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 11895 ms |
| lint | `pnpm lint` | passed | 130038 ms |
| typecheck | `pnpm typecheck` | passed | 45473 ms |
| unit | `pnpm test:unit` | passed | 127729 ms |
| contract | `pnpm test:contract` | passed | 43307 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8961 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 8644 ms |
| architecture | `pnpm verify:architecture` | passed | 8434 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 5027 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 8237 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7890 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10744 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 8325 ms |
| acceptance | `pnpm verify:acceptance` | passed | 8369 ms |
| sources | `pnpm verify:sources` | passed | 4667 ms |
| protocol | `pnpm verify:protocol` | passed | 8563 ms |
| infra | `pnpm verify:infra` | passed | 8364 ms |
| project-license | `pnpm verify:project-license` | passed | 8755 ms |
| licenses | `pnpm verify:licenses` | passed | 8009 ms |
| build | `pnpm build` | passed | 45866 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 8361 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 62527 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 291627 ms |
