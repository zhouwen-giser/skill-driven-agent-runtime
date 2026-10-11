# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T17:58:56.161Z
- Finished: 2026-10-10T18:14:21.191Z
- Duration: 925030 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39022 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 9999 ms |
| lint | `pnpm lint` | passed | 130103 ms |
| typecheck | `pnpm typecheck` | passed | 46215 ms |
| unit | `pnpm test:unit` | passed | 129484 ms |
| contract | `pnpm test:contract` | passed | 42668 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8105 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7692 ms |
| architecture | `pnpm verify:architecture` | passed | 9400 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7570 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 4963 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7450 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 7831 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7556 ms |
| acceptance | `pnpm verify:acceptance` | passed | 7402 ms |
| sources | `pnpm verify:sources` | passed | 6422 ms |
| protocol | `pnpm verify:protocol` | passed | 7630 ms |
| infra | `pnpm verify:infra` | passed | 4921 ms |
| project-license | `pnpm verify:project-license` | passed | 7391 ms |
| licenses | `pnpm verify:licenses` | passed | 5136 ms |
| build | `pnpm build` | passed | 45838 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7779 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 69800 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 304620 ms |
