# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T13:31:03.149Z
- Finished: 2026-10-10T13:53:52.174Z
- Duration: 1369025 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 37228 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10496 ms |
| lint | `pnpm lint` | passed | 126982 ms |
| typecheck | `pnpm typecheck` | passed | 45251 ms |
| unit | `pnpm test:unit` | passed | 123479 ms |
| contract | `pnpm test:contract` | passed | 42705 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8063 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 4533 ms |
| architecture | `pnpm verify:architecture` | passed | 8291 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 4293 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7893 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 4990 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10392 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7649 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4910 ms |
| sources | `pnpm verify:sources` | passed | 8732 ms |
| protocol | `pnpm verify:protocol` | passed | 4168 ms |
| infra | `pnpm verify:infra` | passed | 7755 ms |
| project-license | `pnpm verify:project-license` | passed | 4875 ms |
| licenses | `pnpm verify:licenses` | passed | 8313 ms |
| build | `pnpm build` | passed | 41738 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 8310 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 214947 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 395283 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 219946 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | failed | 7761 ms |
