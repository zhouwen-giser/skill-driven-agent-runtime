# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T16:11:37.871Z
- Finished: 2026-10-10T16:22:12.411Z
- Duration: 634540 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 38144 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10604 ms |
| lint | `pnpm lint` | passed | 134231 ms |
| typecheck | `pnpm typecheck` | passed | 45137 ms |
| unit | `pnpm test:unit` | passed | 128868 ms |
| contract | `pnpm test:contract` | passed | 43086 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 9331 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7935 ms |
| architecture | `pnpm verify:architecture` | passed | 8777 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 4364 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7586 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 4939 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10440 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 77582 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4859 ms |
| sources | `pnpm verify:sources` | passed | 7897 ms |
| protocol | `pnpm verify:protocol` | passed | 4737 ms |
| infra | `pnpm verify:infra` | passed | 8992 ms |
| project-license | `pnpm verify:project-license` | passed | 3323 ms |
| licenses | `pnpm verify:licenses` | passed | 7670 ms |
| build | `pnpm build` | passed | 41649 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7958 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | failed | 16391 ms |
