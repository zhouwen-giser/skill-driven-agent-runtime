# Verification Summary

- Status: **passed**
- Commit: `6b3fc0e2bda523b8dcd0aa9934ef41f3e1af3766` (dirty working tree)
- Started: 2026-10-11T11:21:35.488Z
- Finished: 2026-10-11T11:58:08.595Z
- Duration: 2193107 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39490 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10265 ms |
| lint | `pnpm lint` | passed | 149278 ms |
| typecheck | `pnpm typecheck` | passed | 46228 ms |
| unit | `pnpm test:unit` | passed | 136365 ms |
| contract | `pnpm test:contract` | passed | 44066 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8129 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7478 ms |
| architecture | `pnpm verify:architecture` | passed | 6517 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7446 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 5008 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7550 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 33484 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7730 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4833 ms |
| sources | `pnpm verify:sources` | passed | 7864 ms |
| protocol | `pnpm verify:protocol` | passed | 8657 ms |
| infra | `pnpm verify:infra` | passed | 3931 ms |
| project-license | `pnpm verify:project-license` | passed | 7822 ms |
| licenses | `pnpm verify:licenses` | passed | 4643 ms |
| build | `pnpm build` | passed | 46151 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7879 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 84000 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 461191 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 345164 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 96584 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 386573 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 33865 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 74826 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 110043 ms |
